from __future__ import annotations

from dataclasses import dataclass
from web3 import Web3
from web3.types import TxParams

from .config import settings
from .contracts import load_abi, get_relayer_selectors
from .models import RelayForwardRequest

FORWARDER_ABI = load_abi("AgoraForwarder")
ALLOWED_SELECTORS = get_relayer_selectors()


@dataclass
class RelayResult:
    ok: bool
    tx_hash: str | None = None
    reason: str | None = None


def _selector(calldata_hex: str) -> str:
    if not calldata_hex.startswith("0x") or len(calldata_hex) < 10:
        return ""
    return calldata_hex[:10].lower()


def _is_allowed_target(addr: str) -> bool:
    allowed = {settings.manager_address.lower(), settings.exchange_address.lower()}
    return addr.lower() in allowed


def _normalize_pk(pk: str) -> str:
    s = pk.strip()
    return s if s.startswith("0x") else f"0x{s}"


def _normalize_tx_hash(h: str | None) -> str | None:
    if not h:
        return None
    return h if h.startswith("0x") else f"0x{h}"


def relay_forward_request(request: RelayForwardRequest, *, w3: Web3 | None = None) -> RelayResult:
    allowed_targets = {settings.manager_address.lower(), settings.exchange_address.lower()}
    print(f"[relay] from={request.from_address} to={request.to} selector={_selector(request.data)}")
    print(f"[relay] allowed_targets={allowed_targets}")
    print(f"[relay] ALLOWED_SELECTORS={ALLOWED_SELECTORS}")
    print(f"[relay] forwarder_address={settings.forwarder_address!r}")
    print(f"[relay] rpc_url={settings.rpc_url!r}")

    if not settings.rpc_url or not settings.relayer_private_key or not settings.forwarder_address:
        print("[relay] REJECT: missing config")
        return RelayResult(ok=False, reason="Missing RPC_URL/RELAYER_PRIVATE_KEY/FORWARDER_ADDRESS")
    if not _is_allowed_target(request.to):
        print(f"[relay] REJECT: target {request.to!r} not in allowlist {allowed_targets}")
        return RelayResult(ok=False, reason="Target contract not allowlisted")
    if _selector(request.data) not in ALLOWED_SELECTORS:
        print(f"[relay] REJECT: selector {_selector(request.data)!r} not in allowlist")
        return RelayResult(ok=False, reason="Function selector not allowlisted")

    if w3 is None:
        from .chain import _web3_for_rpc

        w3 = _web3_for_rpc(settings.rpc_url)
    try:
        acct = w3.eth.account.from_key(_normalize_pk(settings.relayer_private_key))
    except Exception:
        return RelayResult(ok=False, reason="Invalid RELAYER_PRIVATE_KEY")
    forwarder = w3.eth.contract(address=Web3.to_checksum_address(settings.forwarder_address), abi=FORWARDER_ABI)

    req_tuple = (
        Web3.to_checksum_address(request.from_address),
        Web3.to_checksum_address(request.to),
        int(request.value),
        int(request.gas),
        int(request.deadline),
        request.data,
        request.signature,
    )

    try:
        is_valid = forwarder.functions.verify(req_tuple).call()
        if not is_valid:
            return RelayResult(ok=False, reason="Forward request verification failed")

        nonce = w3.eth.get_transaction_count(acct.address)
        tx: TxParams = forwarder.functions.execute(req_tuple).build_transaction(
            {
                "from": acct.address,
                "nonce": nonce,
                "value": int(request.value),
                "chainId": w3.eth.chain_id,
            }
        )
        gas_estimate = w3.eth.estimate_gas(tx)
        tx["gas"] = int(gas_estimate * 12 // 10)

        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        print(f"[relay] tx sent: {tx_hash.hex()}")
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        print(f"[relay] receipt status={receipt.status} gasUsed={receipt.gasUsed}")
        if receipt.status != 1:
            print(f"[relay] REVERTED: tx={tx_hash.hex()}")
            return RelayResult(
                ok=False,
                reason="Relay tx reverted on-chain",
                tx_hash=_normalize_tx_hash(tx_hash.hex()),
            )
        print(f"[relay] SUCCESS: tx={tx_hash.hex()}")
        return RelayResult(ok=True, tx_hash=_normalize_tx_hash(tx_hash.hex()))
    except Exception as exc:
        err = str(exc)
        err_lower = err.lower()
        print(f"[relay] EXCEPTION: {exc!r}")
        reason = "Relay transaction failed"
        if "insufficient funds" in err_lower:
            reason = "Relayer wallet insufficient funds for gas"
        elif "nonce too low" in err_lower or "replacement transaction" in err_lower:
            reason = "Nonce conflict; wait for pending transaction"
        elif "could not connect" in err_lower or "timeout" in err_lower or "timed out" in err_lower:
            reason = "RPC connection error"
        elif "0x1425ea42" in err_lower or "failedinnercall" in err_lower:
            # ERC2771Forwarder bubbles FailedInnerCall() when the target reverts; the
            # underlying reason is swallowed by the forwarder's low-level call. The
            # frontend should simulate the inner call to surface the real reason.
            reason = (
                "Inner call reverted (forwarder hides the reason). "
                "Common causes: insufficient USDC balance, missing USDC allowance "
                "for the manager/exchange, missing outcome-token approval, or market closed."
            )
        elif "execution reverted" in err_lower or "revert" in err_lower:
            reason = f"On-chain call would revert: {err[:400]}"
        elif "forward request verification failed" in err_lower:
            reason = "Forward request verification failed"
        return RelayResult(ok=False, reason=reason)
