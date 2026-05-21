"""
Shared fixtures for chain integration tests.

Talks to Circle Arc testnet (chain 5042002) over ``ARC_TESTNET_RPC_URL``.
Skipped automatically if the configured RPC is unreachable.

Run:  pytest tests/integration/ -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from web3 import Web3

_tests_dir = str(Path(__file__).resolve().parents[1])
if _tests_dir not in sys.path:
    sys.path.insert(0, _tests_dir)

from chain_helpers import ChainKit, RPC_URL  # noqa: E402


@pytest.fixture(scope="module")
def kit() -> ChainKit:
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 10}))
        if not w3.is_connected():
            raise ConnectionError()
    except Exception:
        pytest.skip(f"No chain reachable at {RPC_URL}")
    return ChainKit.from_rpc()
