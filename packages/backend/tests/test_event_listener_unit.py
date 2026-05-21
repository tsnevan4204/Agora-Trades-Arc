"""
Unit tests for ``app.event_listener`` (trade tape JSON + optional Parquet, orderbook snapshots).

``pytest -vv -s`` for prints.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.event_listener import append_trade_fill, write_orderbook_snapshot


def test_append_trade_fill_creates_document(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📈 TEST: append_trade_fill first row creates fills.json")
    print("=" * 60)
    append_trade_fill(
        market_id=3,
        payload={"offerId": 1, "fillAmount": 10, "txHash": "0xabc"},
    )
    path = "trades/3/fills.json"
    assert path in memory_store.items
    doc = memory_store.items[path]
    print(f"   document keys={list(doc.keys())}")
    assert len(doc["fills"]) == 1
    row = doc["fills"][0]
    assert row["offerId"] == 1
    assert "capturedAtUtc" in row
    print(f"   first row={row}")
    print("✅ JSON tape started.")


def test_append_trade_fill_appends_second_row(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📈 TEST: append_trade_fill stacks rows")
    print("=" * 60)
    append_trade_fill(4, {"n": 1})
    append_trade_fill(4, {"n": 2})
    fills = memory_store.items["trades/4/fills.json"]["fills"]
    print(f"   len(fills)={len(fills)}")
    assert len(fills) == 2
    assert fills[0]["n"] == 1 and fills[1]["n"] == 2
    print("✅ Order preserved.")


def test_write_orderbook_snapshot_uses_utc_timestamp(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📸 TEST: write_orderbook_snapshot path includes UTC timestamp")
    print("=" * 60)
    snap = {"bids": [], "asks": []}
    write_orderbook_snapshot(market_id=8, snapshot=snap)
    keys = [k for k in memory_store.items if k.startswith("orderbooks/8/") and k.endswith(".json")]
    print(f"   written paths: {keys}")
    assert len(keys) == 1
    assert "orderbooks/8/" in keys[0]
    assert keys[0].endswith("Z.json")
    assert memory_store.items[keys[0]] == snap
    print("✅ Snapshot stored.")


def test_append_trade_fill_parquet_best_effort(memory_store: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    print("\n" + "=" * 60)
    print("🗃️ TEST: Parquet failure does not break JSON append")
    print("=" * 60)

    def boom(_path: str, _rows: list) -> None:
        raise RuntimeError("no pyarrow")

    monkeypatch.setattr("app.event_listener.store.write_parquet", boom)
    append_trade_fill(5, {"ok": True})
    assert "trades/5/fills.json" in memory_store.items
    print("✅ JSON still written when Parquet raises.")
