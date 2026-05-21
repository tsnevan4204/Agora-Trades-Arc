#!/usr/bin/env python3
"""
Canonical testnet gas-sponsored path: user signs EIP-712 ForwardRequest, backend POST /relay/forward executes via relayer.

Requires a running FastAPI backend (uvicorn) with RELAYER_PRIVATE_KEY, FORWARDER_ADDRESS, RPC_URL, MANAGER_ADDRESS, EXCHANGE_ADDRESS set.
Also requires TEST_WALLET_1_PRIVATE_KEY and funded collateral allowance as for the TS script this replaced.

Usage (from repo root):
  PYTHONPATH=packages/backend python3 packages/backend/scripts/run_relay_integration.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

from app.contracts import get_relayer_selector_details, load_abi

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
RPC_URL = (os.getenv("RPC_URL") or os.getenv("ARC_TESTNET_RPC_URL") or "").strip()
MANAGER = os.getenv("MANAGER_ADDRESS", "").strip()
FORWARDER = os.getenv("FORWARDER_ADDRESS", "").strip()
USER_KEY = (os.getenv("TEST_WALLET_1_PRIVATE_KEY") or "").strip()

_split_entry = next(
    (s for s in get_relayer_selector_details() if s["name"] == "split"),
    None,
)
SPLIT_SELECTOR = bytes.fromhex((_split_entry["selector"] if _split_entry else "0x00000000")[2:])


def _normalize_pk(pk: str) -> str:
    s = pk.strip()
    return s if s.startswith("0x") else f"0x{s}"


def _split_calldata(market_id: int, amount_wei: int) -> str:
    body = abi_encode(["uint256", "uint256"], [market_id, amount_wei])
    return "0x" + SPLIT_SELECTOR.hex() + body.hex()


def main() -> int:
    missing = [
        n
        for n, v in [
            ("RPC_URL or ARC_TESTNET_RPC_URL", RPC_URL),
            ("MANAGER_ADDRESS", MANAGER),
            ("FORWARDER_ADDRESS", FORWARDER),
            ("TEST_WALLET_1_PRIVATE_KEY", USER_KEY),
        ]
        if not v
    ]
    if missing:
        print("Missing env:", ", ".join(missing), file=sys.stderr)
        return 1

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    chain_id = int(w3.eth.chain_id)
    acct = Account.from_key(_normalize_pk(USER_KEY))
    forwarder = w3.eth.contract(
        address=Web3.to_checksum_address(FORWARDER),
        abi=load_abi("AgoraForwarder"),
    )
    nonce = int(forwarder.functions.nonces(acct.address).call())
    gas = 500_000
    deadline = int(w3.eth.get_block("latest")["timestamp"]) + 3600
    amount = 10**6  # 1 share unit @ 6 decimals
    data = _split_calldata(0, amount)

    typed_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "ForwardRequest": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "gas", "type": "uint256"},
                {"name": "nonce", "type": "uint256"},
                {"name": "deadline", "type": "uint48"},
                {"name": "data", "type": "bytes"},
            ],
        },
        "primaryType": "ForwardRequest",
        "domain": {
            "name": "AgoraForwarder",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": Web3.to_checksum_address(FORWARDER),
        },
        "message": {
            "from": acct.address,
            "to": Web3.to_checksum_address(MANAGER),
            "value": 0,
            "gas": gas,
            "nonce": nonce,
            "deadline": deadline,
            "data": data,
        },
    }

    signable = encode_typed_data(full_message=typed_data)
    signed = Account.sign_message(signable, private_key=_normalize_pk(USER_KEY))
    sig_hex = signed.signature.hex()
    if not sig_hex.startswith("0x"):
        sig_hex = "0x" + sig_hex

    payload = {
        "from": acct.address,
        "to": Web3.to_checksum_address(MANAGER),
        "value": 0,
        "gas": gas,
        "deadline": deadline,
        "data": data,
        "signature": sig_hex,
    }

    url = f"{BACKEND_URL}/relay/forward"
    print(f"POST {url} (user={acct.address}, chainId={chain_id})")
    r = requests.post(url, json=payload, timeout=120)
    print(r.status_code, r.text)
    if r.status_code != 200:
        return 1
    body = r.json()
    if not body.get("ok"):
        print("Relay rejected:", body.get("reason"), file=sys.stderr)
        return 1
    print("txHash:", body.get("txHash"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
