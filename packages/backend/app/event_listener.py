from __future__ import annotations

"""
Chain event ingestion helpers (no long-running loop in-repo).

Call `append_trade_fill` when you have decoded `OfferFilled` (or similar) payloads from your
poller/WebSocket worker. Trade rows are stored as JSON (`fills.json`) and mirrored to Parquet
(`fills.parquet`) for GCS analytics-friendly reads.
"""

from datetime import datetime, timezone

from .storage import store

_FILLS_JSON = "trades/{market_id}/fills.json"
_FILLS_PARQUET = "trades/{market_id}/fills.parquet"


def append_trade_fill(market_id: int, payload: dict) -> None:
    payload["capturedAtUtc"] = datetime.now(timezone.utc).isoformat()
    path = _FILLS_JSON.format(market_id=market_id)
    existing = store.read_json(path)
    if existing is None:
        existing = {"fills": []}
    fills = existing.get("fills")
    if not isinstance(fills, list):
        fills = []
        existing["fills"] = fills
    fills.append(payload)
    store.write_json(path, existing)
    try:
        store.write_parquet(_FILLS_PARQUET.format(market_id=market_id), fills)
    except Exception:
        # Parquet is best-effort (e.g. optional pyarrow missing in stripped env).
        pass


def write_orderbook_snapshot(market_id: int, snapshot: dict) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    store.write_json(f"orderbooks/{market_id}/{ts}.json", snapshot)
