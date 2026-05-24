"""
On-chain `Exchange.OfferFilled` poller → GCS trade fills data lake.

Why a poller and not a websocket subscription:
  • Circle Arc's RPC supports `eth_getLogs` reliably; websockets are less
    consistent across providers, and the polling code reuses the same Web3
    instance as the rest of the backend.
  • Backfill on restart is trivial — just resume from the last persisted
    block (`state/fills_indexer.json`).
  • The polling loop tolerates RPC blips and indexing failures by simply
    not advancing the cursor; the next iteration retries the same range.

Per poll we:
  1. Read the last-seen block from `state/fills_indexer.json` (cold start
     uses `current_head - FILLS_BACKFILL_BLOCKS`).
  2. Pull `OfferFilled` logs over a bounded block window (capped by
     `FILLS_BLOCK_RANGE` so a long catch-up doesn't fire one giant RPC).
  3. For each event resolve `marketId` + `side` via a `Exchange.offers(id)`
     read (cheap and deterministic).
  4. Group rows by market and call `batch_append_trade_fills` — idempotent,
     so a crash mid-batch only causes a few rows to be re-checked, not
     duplicated.
  5. Advance the cursor in GCS *after* successful writes.

Configuration (root `.env`):

    # Indexer toggle — set to `0` to disable on this instance (e.g. if you
    # run a dedicated indexer process elsewhere). Default: 1 in prod.
    FILLS_INDEXER_ENABLED=1
    # How often to poll, in seconds. Each poll = up to FILLS_BLOCK_RANGE / FILLS_RPC_MAX_BLOCK_SPAN sub-windows.
    FILLS_POLL_INTERVAL_SECONDS=30
    # Max blocks the indexer attempts to scan per poll tick (chained as
    # multiple smaller `eth_getLogs` calls, see FILLS_RPC_MAX_BLOCK_SPAN).
    FILLS_BLOCK_RANGE=500
    # Max blocks a single `eth_getLogs` request will ask for. Alchemy's
    # free tier caps this at 10; paid tiers go to 2000+. We start
    # conservative because exceeding this returns a 400 that aborts the
    # whole window.
    FILLS_RPC_MAX_BLOCK_SPAN=10
    # On cold start, how far back to seed the cursor.
    FILLS_BACKFILL_BLOCKS=5000
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from web3 import Web3
from web3.contract import Contract

from .chain import _web3_for_rpc
from .config import settings
from .contracts import load_abi
from .event_listener import batch_append_trade_fills
from .storage import store


_STATE_PATH = "state/fills_indexer.json"

# Defer ABI load until we know the actual connected chain id, so we never
# accidentally pick up a hardhat-local ABI shape in production. See the
# OfferFilled regression notes in PR notes — the chain 31337 entry historically
# used `totalUSDTWei`, while chain 5042002 (Arc) uses `totalCollateral`.
_EXCHANGE_ABI_BY_CHAIN: dict[int, list] = {}


def _exchange_abi_for(chain_id: int) -> list:
    if chain_id not in _EXCHANGE_ABI_BY_CHAIN:
        _EXCHANGE_ABI_BY_CHAIN[chain_id] = load_abi("Exchange", str(chain_id))
    return _EXCHANGE_ABI_BY_CHAIN[chain_id]


# ── env helpers ──────────────────────────────────────────────────────────────


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return max(lo, min(hi, v))


def fills_indexer_enabled() -> bool:
    raw = os.getenv("FILLS_INDEXER_ENABLED", "1").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _poll_interval_seconds() -> int:
    return _env_int("FILLS_POLL_INTERVAL_SECONDS", 30, 2, 3600)


def _block_range() -> int:
    return _env_int("FILLS_BLOCK_RANGE", 500, 1, 50_000)


def _rpc_max_block_span() -> int:
    # 10 = Alchemy free tier. Bump up for paid tiers.
    return _env_int("FILLS_RPC_MAX_BLOCK_SPAN", 10, 1, 10_000)


def _backfill_blocks() -> int:
    return _env_int("FILLS_BACKFILL_BLOCKS", 5_000, 0, 5_000_000)


# ── state ────────────────────────────────────────────────────────────────────


def _read_cursor() -> int:
    state = store.read_json(_STATE_PATH)
    if not isinstance(state, dict):
        return 0
    try:
        return int(state.get("lastBlock", 0))
    except (TypeError, ValueError):
        return 0


def _write_cursor(block: int, **extra: Any) -> None:
    state = {
        "lastBlock": int(block),
        "updatedAtUtc": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    store.write_json(_STATE_PATH, state)


# ── one poll cycle ───────────────────────────────────────────────────────────


def _exchange_contract(w3: Web3) -> Contract:
    return w3.eth.contract(
        address=Web3.to_checksum_address(settings.exchange_address),
        abi=_exchange_abi_for(int(w3.eth.chain_id)),
    )


def _resolve_market_and_side(exchange: Contract, offer_id: int) -> tuple[int, int]:
    """Read the `offers(id)` struct to map an OfferFilled event to its
    market_id + side. Cached per (chain id, offer id) is overkill for our
    volume — just call directly.
    """
    tup = exchange.functions.offers(offer_id).call()
    # struct Offer { maker, marketId, side, price, initialAmount, remainingAmount, status }
    market_id = int(tup[1])
    side = int(tup[2])
    return market_id, side


_rate_limit_warned_once = False


def _log_to_row(exchange: Contract, log: Any) -> dict | None:
    """Convert a single OfferFilled log entry into a serialisable dict, or
    return None if we can't resolve its market_id. Failures here only drop
    the single row — they don't break the rest of the batch.
    """
    offer_id = int(log.args.offerId)
    try:
        market_id, side = _resolve_market_and_side(exchange, offer_id)
    except Exception as e:
        print(f"[fills_indexer] could not resolve offer #{offer_id}: {e}")
        return None
    # `totalCollateral` is the field name from the current Exchange.sol
    # (chain 5042002). Older ABIs called the same field `totalUSDTWei` —
    # tolerate either so an accidental ABI mismatch only loses an attribute,
    # not the whole tick.
    total_collateral = getattr(
        log.args, "totalCollateral", getattr(log.args, "totalUSDTWei", 0)
    )
    return {
        "kind": "OfferFilled",
        "offerId": offer_id,
        "marketId": market_id,
        "side": side,
        "maker": log.args.maker,
        "taker": log.args.taker,
        # bigints serialise cleanly as strings so we don't lose precision in JSON
        "fillAmount": str(int(log.args.fillAmount)),
        "price": int(log.args.price),
        "totalCollateral": str(int(total_collateral)),
        "blockNumber": int(log.blockNumber),
        "txHash": log.transactionHash.hex(),
        "logIndex": int(log.logIndex),
    }


def poll_once() -> dict:
    """Run one indexer cycle. Returns a small summary dict for logging.

    Strategy: chain up to `FILLS_BLOCK_RANGE / FILLS_RPC_MAX_BLOCK_SPAN`
    small `eth_getLogs` calls so we can stay within free-tier RPC limits
    while still moving the cursor forward in bigger jumps. Each successful
    sub-window persists the cursor immediately, so any failure mid-batch
    still preserves prior progress.
    """
    global _rate_limit_warned_once

    if not settings.rpc_url or not settings.exchange_address:
        return {"skipped": "missing RPC_URL or EXCHANGE_ADDRESS"}

    w3 = _web3_for_rpc(settings.rpc_url)
    exchange = _exchange_contract(w3)

    head = int(w3.eth.block_number)
    cursor = _read_cursor()
    if cursor <= 0:
        cursor = max(0, head - _backfill_blocks())
        print(f"[fills_indexer] cold start — cursor seeded to block {cursor} (head={head})")
        # Persist immediately so a startup-time get_logs failure doesn't
        # cause us to re-seed (and skip the same range) on every tick.
        _write_cursor(cursor, coldStart=True)

    if head <= cursor:
        return {"head": head, "cursor": cursor, "newRows": 0, "noted": "no new blocks"}

    max_per_tick = _block_range()
    max_per_call = _rpc_max_block_span()
    target_end = min(head, cursor + max_per_tick)
    event = exchange.events.OfferFilled()

    total_added = 0
    total_logs = 0
    scanned_from = cursor + 1

    while cursor < target_end:
        sub_from = cursor + 1
        sub_to = min(target_end, cursor + max_per_call)
        try:
            raw_logs = event.get_logs(from_block=sub_from, to_block=sub_to)
        except Exception as e:
            msg = str(e)
            # Alchemy free tier returns 400 when the block range exceeds 10.
            # We surface this once with actionable advice and abort the tick.
            if "10 block range" in msg or "Bad Request" in msg:
                if not _rate_limit_warned_once:
                    print(
                        "[fills_indexer] RPC capped get_logs to a small window — "
                        f"using FILLS_RPC_MAX_BLOCK_SPAN={max_per_call}. "
                        "If on Alchemy free tier, this is expected; "
                        "upgrade or raise the env var on a paid tier."
                    )
                    _rate_limit_warned_once = True
            print(f"[fills_indexer] get_logs failed [{sub_from}..{sub_to}]: {e}")
            # Don't advance cursor past the failing window so the next tick
            # retries from the same point.
            break

        total_logs += len(raw_logs)
        by_market: dict[int, list[dict]] = {}
        for log in raw_logs:
            row = _log_to_row(exchange, log)
            if row is None:
                continue
            by_market.setdefault(row["marketId"], []).append(row)

        for mid, rows in by_market.items():
            added = batch_append_trade_fills(mid, rows)
            total_added += added
            if added > 0:
                print(
                    f"[fills_indexer] +{added} fills for market {mid} "
                    f"(blocks {sub_from}..{sub_to})"
                )

        cursor = sub_to
        # Persist incrementally so a partial-tick crash never re-processes
        # already-written sub-windows.
        _write_cursor(cursor, lastFillsAdded=total_added)

    return {
        "head": head,
        "scannedFrom": scanned_from,
        "scannedTo": cursor,
        "rawLogs": total_logs,
        "newRows": total_added,
    }


# ── long-running async loop ──────────────────────────────────────────────────


_task: asyncio.Task | None = None
_shutdown = asyncio.Event()


async def _run_loop() -> None:
    """Run `poll_once` on a fixed interval until shutdown is requested."""
    print(
        f"[fills_indexer] started — exchange={settings.exchange_address} "
        f"interval={_poll_interval_seconds()}s range={_block_range()} blocks"
    )
    while not _shutdown.is_set():
        try:
            # Run sync web3 + GCS work in a worker thread so we don't block
            # the FastAPI event loop. asyncio.to_thread is the canonical
            # wrapper for "I have a sync function that does I/O".
            summary = await asyncio.to_thread(poll_once)
            if summary.get("newRows"):
                print(f"[fills_indexer] tick: {summary}")
        except Exception as e:
            # Don't let one bad tick kill the loop.
            print(f"[fills_indexer] tick error: {e}")
        try:
            await asyncio.wait_for(
                _shutdown.wait(),
                timeout=_poll_interval_seconds(),
            )
        except asyncio.TimeoutError:
            pass


def start() -> None:
    """Spin up the background task. Idempotent; calling twice is a no-op."""
    global _task
    if _task is not None and not _task.done():
        return
    if not fills_indexer_enabled():
        print("[fills_indexer] disabled by FILLS_INDEXER_ENABLED=0")
        return
    if not settings.rpc_url or not settings.exchange_address:
        print("[fills_indexer] cannot start — missing RPC_URL or EXCHANGE_ADDRESS")
        return
    _shutdown.clear()
    _task = asyncio.create_task(_run_loop(), name="fills_indexer")


async def stop() -> None:
    """Signal the loop to exit and wait for it to drain (≤ 1 tick)."""
    global _task
    _shutdown.set()
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
        _task = None
