"""Unit tests for ``app.relayer`` — allowlists, calldata guard, relay with injectable Web3."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from web3 import Web3 as RealWeb3

from app.contracts import get_relayer_selectors
from app.models import RelayForwardRequest
import app.relayer as relayer_mod
from app.relayer import (
    ALLOWED_SELECTORS,
    RelayResult,
    _is_allowed_target,
    _normalize_pk,
    _selector,
    relay_forward_request,
)


MGR = "0x1111111111111111111111111111111111111111"
EXC = "0x2222222222222222222222222222222222222222"
FWD = "0x3333333333333333333333333333333333333333"

SAMPLE_SELECTOR = sorted(ALLOWED_SELECTORS)[0]


def _calldata(selector: str = SAMPLE_SELECTOR) -> str:
    return selector + "0" * 128


def _req(
    *,
    to_addr: str = MGR,
    data: str | None = None,
    from_addr: str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
) -> RelayForwardRequest:
    return RelayForwardRequest.model_validate(
        {
            "from": from_addr,
            "to": to_addr,
            "value": 0,
            "gas": 300_000,
            "deadline": 9_999_999_999,
            "data": data or _calldata(),
            "signature": "0x" + "ab" * 65,
        }
    )


def _patch_relayer_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(relayer_mod.settings, "rpc_url", "http://mock.rpc")
    monkeypatch.setattr(relayer_mod.settings, "relayer_private_key", "0x" + "1" * 64)
    monkeypatch.setattr(relayer_mod.settings, "forwarder_address", FWD)
    monkeypatch.setattr(relayer_mod.settings, "manager_address", MGR)
    monkeypatch.setattr(relayer_mod.settings, "exchange_address", EXC)


# ---------------------------------------------------------------------------
# Pure helper tests
# ---------------------------------------------------------------------------


def test_selector_extracts_four_byte_prefix() -> None:
    assert _selector("") == ""
    assert _selector("0x") == ""
    assert _selector("0x6114f3") == ""
    assert _selector(_calldata()) == SAMPLE_SELECTOR


def test_normalize_pk_adds_0x() -> None:
    assert _normalize_pk("abc") == "0xabc"
    assert _normalize_pk("0xdef") == "0xdef"
    assert _normalize_pk("  0x11  ") == "0x11"


def test_is_allowed_target_respects_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(relayer_mod.settings, "manager_address", MGR)
    monkeypatch.setattr(relayer_mod.settings, "exchange_address", EXC)
    assert _is_allowed_target(MGR) is True
    assert _is_allowed_target(MGR.upper()) is True
    assert _is_allowed_target(EXC) is True
    assert _is_allowed_target("0x9999999999999999999999999999999999999999") is False


def test_allowed_selectors_from_manifest() -> None:
    """Selectors come from the generated manifest, not hardcoded values."""
    manifest_selectors = get_relayer_selectors()
    assert ALLOWED_SELECTORS == manifest_selectors
    assert len(ALLOWED_SELECTORS) == 6


# ---------------------------------------------------------------------------
# Early-exit tests (no Web3 needed)
# ---------------------------------------------------------------------------


def test_relay_rejects_missing_rpc_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    monkeypatch.setattr(relayer_mod.settings, "rpc_url", "")
    r = relay_forward_request(_req())
    assert r.ok is False
    assert "Missing" in (r.reason or "")


def test_relay_rejects_missing_forwarder_address(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    monkeypatch.setattr(relayer_mod.settings, "forwarder_address", "")
    r = relay_forward_request(_req())
    assert r.ok is False
    assert "Missing" in (r.reason or "")


def test_relay_rejects_missing_relayer_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    monkeypatch.setattr(relayer_mod.settings, "relayer_private_key", "")
    r = relay_forward_request(_req())
    assert r.ok is False


def test_relay_rejects_invalid_relayer_private_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    monkeypatch.setattr(relayer_mod.settings, "relayer_private_key", "0x" + "ab" * 20)
    mock_w3 = _build_mock_w3()
    mock_w3.eth.account.from_key.side_effect = ValueError("bad key")
    r = relay_forward_request(_req(), w3=mock_w3)
    assert r.ok is False
    assert "invalid" in (r.reason or "").lower()


def test_relay_rejects_disallowed_target_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    r = relay_forward_request(_req(to_addr="0x9999999999999999999999999999999999999999"))
    assert r.ok is False
    assert "allowlist" in (r.reason or "").lower()


def test_relay_rejects_unknown_function_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    bad_data = "0xdeadbeef" + "0" * 64
    r = relay_forward_request(_req(data=bad_data))
    assert r.ok is False
    assert "selector" in (r.reason or "").lower()


# ---------------------------------------------------------------------------
# Mock Web3 for relay path tests — injected via w3= instead of monkeypatching
# ---------------------------------------------------------------------------


def _build_mock_w3(
    *,
    verify_ok: bool = True,
    receipt_status: int = 1,
    raise_on_estimate: str | None = None,
) -> MagicMock:
    """Build a MagicMock that satisfies the Web3 interface relay_forward_request needs."""
    w3 = MagicMock()
    w3.eth.chain_id = 97

    acct = MagicMock()
    acct.address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    acct.sign_transaction.return_value = MagicMock(raw_transaction=b"\x02\xf8")
    w3.eth.account.from_key.return_value = acct

    verify_call = MagicMock()
    verify_call.call.return_value = verify_ok

    execute_call = MagicMock()
    execute_call.build_transaction.return_value = {"to": FWD, "data": "0x"}

    forwarder = MagicMock()
    forwarder.functions.verify.return_value = verify_call
    forwarder.functions.execute.return_value = execute_call
    w3.eth.contract.return_value = forwarder

    w3.eth.get_transaction_count.return_value = 42

    if raise_on_estimate:
        w3.eth.estimate_gas.side_effect = RuntimeError(raise_on_estimate)
    else:
        w3.eth.estimate_gas.return_value = 200_000

    tx_hash = MagicMock()
    tx_hash.hex.return_value = "0x" + "c0" * 32
    w3.eth.send_raw_transaction.return_value = tx_hash

    receipt = MagicMock()
    receipt.status = receipt_status
    w3.eth.wait_for_transaction_receipt.return_value = receipt

    return w3


def test_relay_verify_fails_returns_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    mock_w3 = _build_mock_w3(verify_ok=False)
    r = relay_forward_request(_req(), w3=mock_w3)
    assert r.ok is False
    assert "verification" in (r.reason or "").lower()


def test_relay_success_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    mock_w3 = _build_mock_w3(verify_ok=True, receipt_status=1)
    r = relay_forward_request(_req(), w3=mock_w3)
    assert r.ok is True
    assert r.tx_hash and r.tx_hash.startswith("0x")


def test_relay_on_chain_revert_sets_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    mock_w3 = _build_mock_w3(verify_ok=True, receipt_status=0)
    r = relay_forward_request(_req(), w3=mock_w3)
    assert r.ok is False
    assert "reverted" in (r.reason or "").lower()
    assert r.tx_hash is not None


@pytest.mark.parametrize(
    "exc_msg, want_substr",
    [
        ("insufficient funds for gas", "insufficient funds"),
        ("nonce too low", "nonce"),
        ("replacement transaction underpriced", "nonce"),
        ("could not connect to rpc", "rpc connection"),
        ("execution timed out", "rpc connection"),
    ],
)
def test_relay_exception_message_mapping(
    monkeypatch: pytest.MonkeyPatch, exc_msg: str, want_substr: str
) -> None:
    _patch_relayer_settings(monkeypatch)
    mock_w3 = _build_mock_w3(raise_on_estimate=exc_msg)
    r = relay_forward_request(_req(), w3=mock_w3)
    assert r.ok is False
    assert want_substr.lower() in (r.reason or "").lower()


def test_relay_to_exchange_with_allowed_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_relayer_settings(monkeypatch)
    mock_w3 = _build_mock_w3(verify_ok=True, receipt_status=1)
    r = relay_forward_request(_req(to_addr=EXC), w3=mock_w3)
    assert r.ok is True
