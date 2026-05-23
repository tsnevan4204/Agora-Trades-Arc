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


# Statuses that mean the order is no longer fillable. We aggressively prune
# these from the live snapshot so `GET /orders/{marketId}` always returns a
# clean working set and the GCS file size stays bounded — previously the file
# accumulated every order ever posted and the frontend had to filter client-
# side, which both wasted bandwidth and could mislead the UI if the chain
# said "cancelled" but the off-chain mirror still said "open".
_TERMINAL_STATUSES = frozenset({"filled", "cancelled", "expired"})


def _orderbook_path(market_id: int) -> str:
    return f"orderbooks/{market_id}/live.json"


def _load_orderbook(market_id: int) -> dict:
    payload = store.read_json(_orderbook_path(market_id)) or {"orders": []}
    orders = payload.get("orders")
    if not isinstance(orders, list):
        orders = []
    # Defensively keep only well-formed entries (dropping `None`s and the rare
    # str that slipped through from corrupted writes).
    payload["orders"] = [o for o in orders if isinstance(o, dict)]
    return payload


def _save_orderbook(market_id: int, payload: dict) -> None:
    payload["updatedAtUtc"] = datetime.now(timezone.utc).isoformat()
    store.write_json(_orderbook_path(market_id), payload)


def _prune_terminal(orders: list[dict]) -> list[dict]:
    """Drop filled/cancelled/expired rows. Used on every upsert and delete."""
    return [
        o for o in orders
        if str(o.get("status", "open")).lower() not in _TERMINAL_STATUSES
    ]


def list_orders(market_id: int) -> list[dict]:
    payload = store.read_json(_orderbook_path(market_id))
    if payload is None:
        return []
    raw = payload.get("orders", [])
    if not isinstance(raw, list):
        return []
    # Filter terminal statuses on the read path too — protects callers in case
    # an older snapshot was written before pruning was added (back-compat).
    return _prune_terminal([o for o in raw if isinstance(o, dict)])


def upsert_order(order: OffchainOrder) -> None:
    """Insert or update one off-chain order; auto-prune terminal statuses.

    If the incoming order itself is terminal we still write the snapshot,
    but the entry is filtered out — equivalent to calling `delete_order`.
    """
    payload = _load_orderbook(order.marketId)
    orders = payload["orders"]
    replaced = False
    for i, existing in enumerate(orders):
        if existing.get("orderId") == order.orderId:
            orders[i] = order.model_dump(mode="json")
            replaced = True
            break
    if not replaced:
        orders.append(order.model_dump(mode="json"))
    payload["orders"] = _prune_terminal(orders)
    _save_orderbook(order.marketId, payload)


def delete_order(market_id: int, order_id: str) -> bool:
    """Remove an order from the live snapshot. Returns True if a row was deleted.

    Used by the frontend after a successful on-chain `cancelOffer` or
    `fillOffer` so the off-chain mirror stays in sync with the Exchange.
    """
    payload = _load_orderbook(market_id)
    before = len(payload["orders"])
    payload["orders"] = [o for o in payload["orders"] if o.get("orderId") != order_id]
    after = len(payload["orders"])
    if after == before:
        return False
    _save_orderbook(market_id, payload)
    return True
