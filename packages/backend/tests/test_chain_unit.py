from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import app.chain as chain_mod
from app.chain import create_event_and_markets


class _TxHash:
    def __init__(self, value: str) -> None:
        self._value = value

    def hex(self) -> str:
        return self._value


class _Receipt:
    def __init__(self, status: int = 1) -> None:
        self.status = status


class _BuildableCall:
    def __init__(self, tx_factory) -> None:
        self._tx_factory = tx_factory

    def build_transaction(self, params):
        return self._tx_factory(dict(params))


class _CallableValue:
    def __init__(self, value) -> None:
        self._value = value

    def call(self):
        return self._value


def test_create_event_and_markets_uses_pending_nonce_and_increments(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain_mod.settings, "rpc_url", "http://mock.rpc")
    monkeypatch.setattr(chain_mod.settings, "factory_address", "0x" + "1" * 40)
    monkeypatch.setattr(chain_mod.settings, "factory_owner_private_key", "0x" + "2" * 64)

    signed_nonces: list[int] = []
    acct = MagicMock()
    acct.address = "0x" + "a" * 40

    def sign_transaction(tx):
        signed_nonces.append(tx["nonce"])
        return SimpleNamespace(raw_transaction=f"raw-{tx['nonce']}".encode())

    acct.sign_transaction.side_effect = sign_transaction

    next_market_ids = iter([101, 102])

    def create_event_tx(params):
        return {"kind": "event", **params}

    def create_market_tx(params):
        return {"kind": "market", **params}

    factory = MagicMock()
    factory.functions.nextEventId.return_value = _CallableValue(77)
    factory.functions.nextMarketId.side_effect = lambda: _CallableValue(next(next_market_ids))
    factory.functions.createEvent.side_effect = lambda *_args: _BuildableCall(create_event_tx)
    factory.functions.createMarket.side_effect = lambda *_args: _BuildableCall(create_market_tx)

    w3 = MagicMock()
    w3.eth.chain_id = 97
    w3.eth.account.from_key.return_value = acct
    w3.eth.contract.return_value = factory
    w3.eth.get_transaction_count.return_value = 9
    w3.eth.estimate_gas.side_effect = lambda tx: 100_000 if tx["kind"] == "event" else 120_000
    w3.eth.send_raw_transaction.side_effect = [
        _TxHash("0x" + "e" * 64),
        _TxHash("0x" + "1" * 64),
        _TxHash("0x" + "2" * 64),
    ]
    w3.eth.wait_for_transaction_receipt.side_effect = [_Receipt(), _Receipt(), _Receipt()]

    result = create_event_and_markets(
        title="Test Event",
        category="integration",
        close_time_unix=2_000_000_000,
        markets=[
            ("Q1", "0x" + "0" * 63 + "1", "ipfs://q1"),
            ("Q2", "0x" + "0" * 63 + "2", "ipfs://q2"),
        ],
        w3=w3,
    )

    assert result.event_id == 77
    assert result.market_ids == [101, 102]
    assert signed_nonces == [9, 10, 11]
    w3.eth.get_transaction_count.assert_called_once_with(acct.address, "pending")

