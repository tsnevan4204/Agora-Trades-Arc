from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from web3 import Web3
from web3.types import TxParams

from .config import settings


def _web3_for_rpc(rpc_url: str) -> Web3:
    """Build a Web3 client for Circle Arc testnet."""
    return Web3(Web3.HTTPProvider(rpc_url))
from .contracts import load_abi

MANAGER_ABI: list[dict[str, Any]] = load_abi("PredictionMarketManager")
FACTORY_ABI: list[dict[str, Any]] = load_abi("MarketFactory")


def _normalize_pk(pk: str) -> str:
    s = pk.strip()
    if not s.startswith("0x"):
        s = "0x" + s
    return s


def _hex_to_bytes32(hash_hex: str) -> bytes:
    h = hash_hex.strip()
    if h.startswith("0x"):
        h = h[2:]
    if len(h) != 64:
        raise ValueError("bytes32 hex must be 64 hex chars (optionally 0x-prefixed)")
    return bytes.fromhex(h)


def _pending_nonce(w3: Web3, address: str) -> int:
    # Use the pending pool so back-to-back writes do not reuse a just-broadcast nonce.
    return int(w3.eth.get_transaction_count(address, "pending"))


def _outcome_uint8(label: str) -> int:
    u = label.strip().upper()
    if u == "YES":
        return 0
    if u == "NO":
        return 1
    raise ValueError(f"Invalid outcome {label!r}, expected YES or NO")


@dataclass
class TxRecord:
    market_id: int
    tx_hash: str
    ok: bool
    error: str | None = None


def submit_resolves(
    market_ids: list[int],
    outcomes_by_market: dict[int, str],
    evidence_hash_hex: str,
    *,
    w3: Web3 | None = None,
) -> tuple[list[TxRecord], str]:
    """
    Submit resolve() for each market from resolver wallet. Returns per-tx records and overall status:
    confirmed | partial_failure | failed
    """
    if not settings.rpc_url or not settings.manager_address:
        raise RuntimeError("Missing RPC_URL or MANAGER_ADDRESS")
    if not settings.resolver_private_key:
        raise RuntimeError("Missing RESOLVER_PRIVATE_KEY")

    if w3 is None:
        w3 = _web3_for_rpc(settings.rpc_url)
    acct = w3.eth.account.from_key(_normalize_pk(settings.resolver_private_key))
    manager = w3.eth.contract(
        address=Web3.to_checksum_address(settings.manager_address),
        abi=MANAGER_ABI,
    )
    ev_bytes = _hex_to_bytes32(evidence_hash_hex)
    records: list[TxRecord] = []

    for mid in market_ids:
        label = outcomes_by_market.get(mid)
        if label is None:
            records.append(TxRecord(market_id=mid, tx_hash="", ok=False, error="missing outcome"))
            continue
        try:
            out = _outcome_uint8(label)
        except ValueError as e:
            records.append(TxRecord(market_id=mid, tx_hash="", ok=False, error=str(e)))
            continue
        try:
            nonce = _pending_nonce(w3, acct.address)
            tx: TxParams = manager.functions.resolve(mid, out, ev_bytes).build_transaction(
                {
                    "from": acct.address,
                    "nonce": nonce,
                    "chainId": w3.eth.chain_id,
                }
            )
            gas_est = w3.eth.estimate_gas(tx)
            tx["gas"] = int(gas_est * 12 // 10)
            signed = acct.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            ok = receipt.status == 1
            records.append(
                TxRecord(
                    market_id=mid,
                    tx_hash=tx_hash.hex(),
                    ok=ok,
                    error=None if ok else "reverted",
                )
            )
        except Exception as e:
            records.append(TxRecord(market_id=mid, tx_hash="", ok=False, error=str(e)))

    oks = [r for r in records if r.ok]
    bad = [r for r in records if not r.ok]
    if len(oks) == len(market_ids) and market_ids:
        overall = "confirmed"
    elif oks:
        overall = "partial_failure"
    else:
        overall = "failed"
    return records, overall


@dataclass
class CreateMarketsResult:
    event_id: int
    market_ids: list[int]
    create_event_tx: str
    create_market_txs: list[str]


def validate_close_time_unix(close_time_unix: int, *, w3: Web3 | None = None) -> None:
    """MarketFactory.createEvent requires closeTime > block.timestamp."""
    if close_time_unix <= 0:
        raise ValueError("closeTimeUnix must be a positive unix timestamp")
    if w3 is None:
        if not settings.rpc_url:
            raise RuntimeError("Missing RPC_URL")
        w3 = _web3_for_rpc(settings.rpc_url)
    chain_now = int(w3.eth.get_block("latest")["timestamp"])
    if close_time_unix <= chain_now:
        from datetime import datetime, timezone

        close_iso = datetime.fromtimestamp(close_time_unix, tz=timezone.utc).isoformat()
        now_iso = datetime.fromtimestamp(chain_now, tz=timezone.utc).isoformat()
        raise ValueError(
            f"Market close time must be after the current chain time. "
            f"You sent {close_iso} (unix {close_time_unix}) but the chain is at {now_iso} (unix {chain_now}). "
            f"Pick a future close time in the admin form."
        )


def create_event_and_markets(
    title: str,
    category: str,
    close_time_unix: int,
    markets: list[tuple[str, str, str]],
    *,
    w3: Web3 | None = None,
) -> CreateMarketsResult:
    """
    markets: list of (question, resolutionSpecHash_hex, resolutionSpecURI)
    """
    if not settings.rpc_url or not settings.factory_address:
        raise RuntimeError("Missing RPC_URL or FACTORY_ADDRESS")
    if not settings.factory_owner_private_key:
        raise RuntimeError("Missing FACTORY_OWNER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY")

    if w3 is None:
        w3 = _web3_for_rpc(settings.rpc_url)
    validate_close_time_unix(close_time_unix, w3=w3)
    acct = w3.eth.account.from_key(_normalize_pk(settings.factory_owner_private_key))
    factory = w3.eth.contract(
        address=Web3.to_checksum_address(settings.factory_address),
        abi=FACTORY_ABI,
    )

    event_id_before = factory.functions.nextEventId().call()

    nonce = _pending_nonce(w3, acct.address)
    tx_e: TxParams = factory.functions.createEvent(title, category, close_time_unix).build_transaction(
        {
            "from": acct.address,
            "nonce": nonce,
            "chainId": w3.eth.chain_id,
        }
    )
    tx_e["gas"] = int(w3.eth.estimate_gas(tx_e) * 12 // 10)
    signed_e = acct.sign_transaction(tx_e)
    h_e = w3.eth.send_raw_transaction(signed_e.raw_transaction)
    rec_e = w3.eth.wait_for_transaction_receipt(h_e)
    if rec_e.status != 1:
        raise RuntimeError("createEvent reverted")

    # nextEventId is post-incremented in createEvent; value before tx is the assigned eventId.
    event_id = int(event_id_before)
    nonce += 1

    market_txs: list[str] = []
    m_ids: list[int] = []
    for question, spec_hash_hex, uri in markets:
        market_id_before = factory.functions.nextMarketId().call()
        spec_bytes = _hex_to_bytes32(spec_hash_hex)
        tx_m: TxParams = factory.functions.createMarket(event_id, question, spec_bytes, uri).build_transaction(
            {
                "from": acct.address,
                "nonce": nonce,
                "chainId": w3.eth.chain_id,
            }
        )
        tx_m["gas"] = int(w3.eth.estimate_gas(tx_m) * 12 // 10)
        signed_m = acct.sign_transaction(tx_m)
        h_m = w3.eth.send_raw_transaction(signed_m.raw_transaction)
        rec_m = w3.eth.wait_for_transaction_receipt(h_m)
        if rec_m.status != 1:
            raise RuntimeError(f"createMarket reverted for {question!r}")
        market_txs.append(h_m.hex())
        m_ids.append(int(market_id_before))
        nonce += 1

    return CreateMarketsResult(
        event_id=event_id,
        market_ids=m_ids,
        create_event_tx=h_e.hex(),
        create_market_txs=market_txs,
    )
