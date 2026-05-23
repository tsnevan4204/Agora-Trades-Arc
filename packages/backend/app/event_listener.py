from __future__ import annotations

"""
Chain event ingestion helpers.

`append_trade_fill` / `batch_append_trade_fills` are the only entry points
into the trades data lake. Both are idempotent: callers can replay the same
event (e.g. on indexer restart, or because two pollers raced) and we will
not write duplicate rows — dedup is keyed on `(txHash, logIndex)` if both
are present, otherwise on the full payload dict.

Both write JSON (`trades/{market_id}/fills.json`) and Parquet
(`trades/{market_id}/fills.parquet`); the Parquet copy is what the BigQuery
external table reads from. Parquet is best-effort; if pyarrow is missing we
keep JSON working so the rest of the system isn't blocked.
"""

from datetime import datetime, timezone

from .storage import store

_FILLS_JSON = "trades/{market_id}/fills.json"
_FILLS_PARQUET = "trades/{market_id}/fills.parquet"


def _row_key(row: dict) -> tuple:
    """Stable dedup key. Prefer (txHash, logIndex) when present (true chain
    events) — falls back to a serialised view of the row for synthetic
    payloads that lack those fields.
    """
    tx = row.get("txHash")
    li = row.get("logIndex")
    if tx is not None and li is not None:
        return ("by-log", str(tx), int(li))
    # Sorted tuple of (k, v) makes the key order-insensitive and stable
    # across dict iteration orders.
    return ("by-payload", tuple(sorted((k, str(v)) for k, v in row.items())))


def _write_fills(market_id: int, fills: list[dict]) -> None:
    payload = {"fills": fills, "updatedAtUtc": datetime.now(timezone.utc).isoformat()}
    store.write_json(_FILLS_JSON.format(market_id=market_id), payload)
    try:
        store.write_parquet(_FILLS_PARQUET.format(market_id=market_id), fills)
    except Exception as e:
        print(f"[event_listener] parquet write failed for market {market_id}: {e}")


def _load_existing_fills(market_id: int) -> list[dict]:
    existing = store.read_json(_FILLS_JSON.format(market_id=market_id))
    if not isinstance(existing, dict):
        return []
    fills = existing.get("fills")
    return [r for r in fills if isinstance(r, dict)] if isinstance(fills, list) else []


def append_trade_fill(market_id: int, payload: dict) -> bool:
    """Single-row append. Returns True if the row was new, False if dedup
    suppressed it.

    `capturedAtUtc` is stamped here if the caller didn't already provide
    one, so backfill paths that ingest historical events with their own
    timestamps don't get clobbered.
    """
    payload.setdefault("capturedAtUtc", datetime.now(timezone.utc).isoformat())
    fills = _load_existing_fills(market_id)
    seen = {_row_key(r) for r in fills}
    if _row_key(payload) in seen:
        return False
    fills.append(payload)
    _write_fills(market_id, fills)
    return True


def batch_append_trade_fills(market_id: int, rows: list[dict]) -> int:
    """Append multiple rows in one read-modify-write cycle. Returns the
    number of rows that were actually new (i.e. not deduped).

    The single-shot read/write is critical when the indexer drains a 500-
    block window — `append_trade_fill` in a loop would do N reads and N
    writes of an ever-growing file, which is both slow and racy when two
    pollers run by accident.
    """
    if not rows:
        return 0
    fills = _load_existing_fills(market_id)
    seen = {_row_key(r) for r in fills}
    added = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for row in rows:
        row.setdefault("capturedAtUtc", now_iso)
        key = _row_key(row)
        if key in seen:
            continue
        seen.add(key)
        fills.append(row)
        added += 1
    if added > 0:
        _write_fills(market_id, fills)
    return added


def write_orderbook_snapshot(market_id: int, snapshot: dict) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    store.write_json(f"orderbooks/{market_id}/{ts}.json", snapshot)
