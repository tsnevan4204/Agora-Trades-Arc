"""
Relayer route tests. Use ``pytest -s`` to see print output.
"""

from __future__ import annotations

import pytest

from app import main as main_module
from app.main import relay_forward
from app.models import RelayForwardRequest
from app.relayer import RelayResult


@pytest.fixture()
def mock_relayer(monkeypatch: pytest.MonkeyPatch):
    def _ok(_: object) -> RelayResult:
        return RelayResult(ok=True, tx_hash="0x123")

    monkeypatch.setattr(main_module, "relay_forward_request", _ok)
    print(
        "\n⛽ (fixture mock_relayer) Patched relay_forward_request → always RelayResult(ok=True, tx_hash=0x123).",
    )


def test_relay_forward_handler_calls_relayer_and_maps_response(mock_relayer) -> None:
    print("\n" + "=" * 60)
    print("⛽ TEST: POST /relay/forward handler maps RelayResult → RelayExecuteResponse")
    print("=" * 60)
    print("We build a RelayForwardRequest like the frontend would (EIP-2771 forwarder calldata + sig).")
    req = RelayForwardRequest.model_validate(
        {
            "from": "0x0000000000000000000000000000000000000001",
            "to": "0x0000000000000000000000000000000000000002",
            "value": 0,
            "gas": 300000,
            "deadline": 9999999999,
            "data": "0x6114f3f40000000000000000000000000000000000000000000000000000000000000000",
            "signature": "0x1234",
        }
    )
    print(f"📨 Request summary: from={req.from_address} to={req.to} gas={req.gas} deadline={req.deadline}")
    print(f"   data (prefix): {req.data[:20]}… (len={len(req.data)})")
    resp = relay_forward(req)
    print(f"📤 Response: ok={resp.ok} txHash={resp.txHash!r} reason={resp.reason!r}")
    assert resp.ok is True
    assert resp.txHash == "0x123"
    print("✅ Handler forwarded to our stub and mapped fields correctly.")
