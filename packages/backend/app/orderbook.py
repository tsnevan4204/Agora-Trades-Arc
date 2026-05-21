from __future__ import annotations

from datetime import datetime, timezone
from pydantic import BaseModel
from .storage import store


class OffchainOrder(BaseModel):
    orderId: str
    marketId: int
    maker: str
    side: str
    priceBps: int
    amount: int
    signature: str | None = None
    status: str = "open"
    createdAtUtc: str = datetime.now(timezone.utc).isoformat()


def list_orders(market_id: int) -> list[dict]:
    payload = store.read_json(f"orderbooks/{market_id}/live.json")
    if payload is None:
        return []
    raw = payload.get("orders", [])
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def upsert_order(order: OffchainOrder) -> None:
    path = f"orderbooks/{order.marketId}/live.json"
    payload = store.read_json(path) or {"orders": []}
    orders = payload.get("orders")
    if not isinstance(orders, list):
        orders = []
        payload["orders"] = orders
    else:
        orders = [o for o in orders if isinstance(o, dict)]
        payload["orders"] = orders
    for i, existing in enumerate(orders):
        if existing.get("orderId") == order.orderId:
            orders[i] = order.model_dump(mode="json")
            break
    else:
        orders.append(order.model_dump(mode="json"))
    payload["updatedAtUtc"] = datetime.now(timezone.utc).isoformat()
    store.write_json(path, payload)
