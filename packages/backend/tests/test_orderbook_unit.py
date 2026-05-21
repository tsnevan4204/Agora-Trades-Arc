"""
Unit tests for ``app.orderbook`` (off-chain live orderbook JSON in storage).

``pytest -vv -s`` for prints. Relayer not involved.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.orderbook import OffchainOrder, list_orders, upsert_order


def test_list_orders_empty_when_no_file(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📭 TEST: list_orders with missing live.json → []")
    print("=" * 60)
    got = list_orders(404)
    print(f"   result={got!r}")
    assert got == []
    print("✅ Empty list.")


def test_upsert_then_list_round_trip(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📝 TEST: upsert new order then list_orders returns it")
    print("=" * 60)
    o = OffchainOrder(
        orderId="ord-1",
        marketId=7,
        maker="0x" + "1" * 40,
        side="BUY_YES",
        priceBps=6500,
        amount=100,
    )
    print(f"   upsert {o.orderId!r} marketId={o.marketId}")
    upsert_order(o)
    rows = list_orders(7)
    print(f"   list_orders(7) → {rows}")
    assert len(rows) == 1
    assert rows[0]["orderId"] == "ord-1"
    assert rows[0]["priceBps"] == 6500
    assert rows[0]["status"] == "open"
    path = "orderbooks/7/live.json"
    assert path in memory_store.items
    assert "updatedAtUtc" in memory_store.items[path]
    print(f"   stored keys: {list(memory_store.items[path].keys())}")
    print("✅ Round trip OK.")


def test_upsert_replaces_same_order_id(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🔁 TEST: second upsert with same orderId replaces row")
    print("=" * 60)
    upsert_order(
        OffchainOrder(
            orderId="same",
            marketId=1,
            maker="0xaa",
            side="SELL_YES",
            priceBps=5000,
            amount=10,
        )
    )
    upsert_order(
        OffchainOrder(
            orderId="same",
            marketId=1,
            maker="0xaa",
            side="SELL_YES",
            priceBps=5100,
            amount=5,
            status="partially_filled",
        )
    )
    rows = list_orders(1)
    print(f"   rows={rows}")
    assert len(rows) == 1
    assert rows[0]["priceBps"] == 5100
    assert rows[0]["amount"] == 5
    assert rows[0]["status"] == "partially_filled"
    print("✅ Single row updated in place.")


def test_multiple_orders_same_market(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📚 TEST: multiple distinct orderIds append")
    print("=" * 60)
    for i in range(3):
        upsert_order(
            OffchainOrder(
                orderId=f"id-{i}",
                marketId=99,
                maker="0xbb",
                side="BUY_NO",
                priceBps=4000 + i,
                amount=50,
            )
        )
    rows = list_orders(99)
    ids = sorted(r["orderId"] for r in rows)
    print(f"   order ids={ids}")
    assert ids == ["id-0", "id-1", "id-2"]
    print("✅ Three orders coexist.")


def test_list_orders_ignores_missing_orders_key_gracefully(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: corrupt payload without 'orders' key → []")
    print("=" * 60)
    memory_store.write_json("orderbooks/2/live.json", {"updatedAtUtc": "x"})
    got = list_orders(2)
    print(f"   list_orders → {got!r}")
    assert got == []
    print("✅ Defensive .get('orders', []) behavior.")
