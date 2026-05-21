"""
Adversarial tests: corrupt data and edge cases in orderbook and event listener.

Run: ``pytest -vv tests/test_adversarial_edges.py``
"""

from __future__ import annotations

from typing import Any

import pytest

from app.orderbook import OffchainOrder, list_orders, upsert_order
from app.event_listener import append_trade_fill


# --- orderbook: corrupted JSON shapes ---


def test_list_orders_drops_non_dict_rows(memory_store: Any) -> None:
    memory_store.write_json(
        "orderbooks/3/live.json",
        {
            "orders": [
                42,
                "oops",
                {"orderId": "keep", "marketId": 3, "maker": "0x1", "side": "X", "priceBps": 1, "amount": 1},
            ],
            "updatedAtUtc": "old",
        },
    )
    rows = list_orders(3)
    assert len(rows) == 1
    assert rows[0]["orderId"] == "keep"


def test_upsert_rebuilds_after_orders_was_string(memory_store: Any) -> None:
    memory_store.write_json("orderbooks/9/live.json", {"orders": "corrupt", "updatedAtUtc": "x"})
    upsert_order(
        OffchainOrder(
            orderId="fresh",
            marketId=9,
            maker="0x2",
            side="BUY_YES",
            priceBps=100,
            amount=1,
        )
    )
    stored = memory_store.items["orderbooks/9/live.json"]
    assert isinstance(stored["orders"], list)
    assert len(stored["orders"]) == 1
    assert stored["orders"][0]["orderId"] == "fresh"


# --- event_listener: corrupt tape ---


def test_append_trade_fill_repairs_non_list_fills(memory_store: Any) -> None:
    memory_store.write_json("trades/8/fills.json", {"fills": None})
    append_trade_fill(8, {"k": 1})
    doc = memory_store.items["trades/8/fills.json"]
    assert isinstance(doc["fills"], list)
    assert len(doc["fills"]) == 1

    memory_store.write_json("trades/8/fills.json", {"fills": "broken"})
    append_trade_fill(8, {"k": 2})
    doc2 = memory_store.items["trades/8/fills.json"]
    assert doc2["fills"][-1]["k"] == 2
