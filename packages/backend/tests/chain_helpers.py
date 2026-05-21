"""
Reusable pytest helpers and fixtures for chain integration tests.

Connects to Circle Arc testnet (chain id 5042002) over JSON-RPC and provides the
Python equivalent of the Hardhat ``deployProtocolFixture()`` and six-wallet
stress-test helpers.

Wallets must be pre-funded with testnet USDC from https://faucet.circle.com;
USDC also pays gas on Arc.

Usage in tests::

    from chain_helpers import ChainKit

    @pytest.fixture(scope="module")
    def kit():
        return ChainKit.from_rpc()
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from eth_account import Account  # noqa: E402
from eth_account.signers.local import LocalAccount  # noqa: E402
from web3 import Web3  # noqa: E402
from web3.contract import Contract  # noqa: E402

from app.contracts import load_abi  # noqa: E402


RPC_URL = (
    os.getenv("ARC_TESTNET_RPC_URL")
    or os.getenv("RPC_URL")
    or ""
)

_DEPLOY_DIR = Path(__file__).resolve().parents[2] / "hardhat" / "deployments"

_ARC_TESTNET_CHAIN_ID = 5042002

# Canonical Circle USDC ERC-20 on Arc testnet (6 decimals).
# https://docs.arc.network/arc/references/contract-addresses
ARC_TESTNET_USDC_ADDRESS = "0x3600000000000000000000000000000000000000"

# Minimal ERC-20 ABI for the surface our tests use.
_USDC_ABI: list[dict[str, Any]] = [
    {
        "constant": True,
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def _load_deployment(network: str, contract_name: str) -> dict[str, Any]:
    p = _DEPLOY_DIR / network / f"{contract_name}.json"
    if not p.exists():
        raise FileNotFoundError(f"No deployment artifact: {p}")
    with open(p) as f:
        return json.load(f)


@dataclass
class ChainKit:
    """Lightweight wrapper giving tests access to deployed protocol contracts."""

    w3: Web3
    deployer: LocalAccount
    usdc: Contract
    factory: Contract
    token1155: Contract
    manager: Contract
    exchange: Contract
    forwarder: Contract
    wallets: list[LocalAccount] = field(default_factory=list)

    @classmethod
    def from_rpc(cls, rpc_url: str = RPC_URL) -> ChainKit:
        if not rpc_url:
            raise RuntimeError(
                "ARC_TESTNET_RPC_URL (or RPC_URL) must be set to a Circle Arc testnet RPC."
            )
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 10}))
        if not w3.is_connected():
            raise ConnectionError(f"Cannot connect to chain at {rpc_url}")

        chain_id_int = w3.eth.chain_id
        if chain_id_int != _ARC_TESTNET_CHAIN_ID and not os.getenv("USDC_ADDRESS", "").strip():
            raise RuntimeError(
                f"Unexpected chain_id={chain_id_int}. This project only supports Circle Arc testnet "
                f"(chain {_ARC_TESTNET_CHAIN_ID}). Set USDC_ADDRESS to override."
            )

        network = _resolve_network(str(chain_id_int))
        deployer = _get_deployer()

        def _contract(name: str) -> Contract:
            dep = _load_deployment(network, name)
            return w3.eth.contract(
                address=Web3.to_checksum_address(dep["address"]),
                abi=dep["abi"],
            )

        usdc = _resolve_usdc_contract(w3)
        wallets = _get_test_wallets()

        return cls(
            w3=w3,
            deployer=deployer,
            usdc=usdc,
            factory=_contract("MarketFactory"),
            token1155=_contract("OutcomeToken1155"),
            manager=_contract("PredictionMarketManager"),
            exchange=_contract("Exchange"),
            forwarder=_contract("AgoraForwarder"),
            wallets=wallets,
        )

    # ------------------------------------------------------------------
    # Helpers that mirror Hardhat fixture convenience methods
    # ------------------------------------------------------------------

    def approve_usdc(self, wallet: LocalAccount, spender: str, amount: int | None = None) -> str:
        if amount is None:
            amount = 2**256 - 1
        return self._send(self.usdc.functions.approve(spender, amount), wallet)

    def split(self, wallet: LocalAccount, market_id: int, amount: int) -> str:
        return self._send(self.manager.functions.split(market_id, amount), wallet)

    def merge(self, wallet: LocalAccount, market_id: int, amount: int) -> str:
        return self._send(self.manager.functions.merge(market_id, amount), wallet)

    def redeem(self, wallet: LocalAccount, market_id: int) -> str:
        return self._send(self.manager.functions.redeem(market_id), wallet)

    def post_offer(
        self, wallet: LocalAccount, market_id: int, side: int, price_bps: int, amount: int
    ) -> tuple[int, str]:
        """Post offer and return (offerId, txHash)."""
        offer_id = self.exchange.functions.nextOfferId().call()
        tx_hash = self._send(
            self.exchange.functions.postOffer(market_id, side, price_bps, amount), wallet
        )
        return offer_id, tx_hash

    def fill_offer(self, wallet: LocalAccount, offer_id: int, amount: int) -> str:
        return self._send(self.exchange.functions.fillOffer(offer_id, amount), wallet)

    def cancel_offer(self, wallet: LocalAccount, offer_id: int) -> str:
        return self._send(self.exchange.functions.cancelOffer(offer_id), wallet)

    def resolve(self, resolver: LocalAccount, market_id: int, outcome: int, evidence_hash: bytes) -> str:
        return self._send(
            self.manager.functions.resolve(market_id, outcome, evidence_hash), resolver
        )

    def create_event(self, title: str, category: str, close_time: int) -> tuple[int, str]:
        """Create event and return (eventId, txHash)."""
        event_id = self.factory.functions.nextEventId().call()
        tx_hash = self._send(
            self.factory.functions.createEvent(title, category, close_time), self.deployer
        )
        return event_id, tx_hash

    def create_market(
        self, event_id: int, question: str, spec_hash: bytes, spec_uri: str
    ) -> tuple[int, str]:
        market_id = self.factory.functions.nextMarketId().call()
        tx_hash = self._send(
            self.factory.functions.createMarket(event_id, question, spec_hash, spec_uri),
            self.deployer,
        )
        return market_id, tx_hash

    def usdc_balance(self, addr: str) -> int:
        return self.usdc.functions.balanceOf(addr).call()

    def seed_wallet(self, wallet: LocalAccount, _usdc_amount: int | None = None) -> None:
        """Approve manager + exchange for a wallet.

        Wallets must already hold USDC from the Circle faucet. The optional
        amount argument is kept for backward compatibility with old call sites
        but is ignored — there is no minting path.
        """
        self.approve_usdc(wallet, self.manager.address)
        self.approve_usdc(wallet, self.exchange.address)

    def wait_for_close(self, market_id: int, poll_interval: float = 5.0) -> None:
        """Block until the market's close time has passed on-chain."""
        close_time = self.factory.functions.getMarketCloseTime(market_id).call()
        while True:
            now = self.w3.eth.get_block("latest")["timestamp"]
            if now >= close_time:
                break
            remaining = close_time - now
            sleep_for = min(remaining + 3, poll_interval)
            time.sleep(sleep_for)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    _nonce_cache: dict[str, int] = field(default_factory=dict, repr=False)

    def _next_nonce(self, account: LocalAccount) -> int:
        addr = account.address.lower()
        if addr not in self._nonce_cache:
            self._nonce_cache[addr] = self.w3.eth.get_transaction_count(
                account.address, "pending"
            )
        nonce = self._nonce_cache[addr]
        self._nonce_cache[addr] = nonce + 1
        return nonce

    def _send(self, fn, account: LocalAccount, *, retries: int = 3) -> str:
        nonce = self._next_nonce(account)
        for attempt in range(retries):
            try:
                tx = fn.build_transaction({
                    "from": account.address,
                    "nonce": nonce,
                    "chainId": self.w3.eth.chain_id,
                })
                tx["gas"] = int(self.w3.eth.estimate_gas(tx) * 12 // 10)
                break
            except Exception:
                if attempt == retries - 1:
                    self._nonce_cache.pop(account.address.lower(), None)
                    raise
                time.sleep(3 * (attempt + 1))

        signed = account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.status != 1:
            self._nonce_cache.pop(account.address.lower(), None)
            raise RuntimeError(f"Transaction reverted: {tx_hash.hex()}")
        return tx_hash.hex()


def _resolve_usdc_contract(w3: Web3) -> Contract:
    """Return the canonical Arc USDC contract (or ``USDC_ADDRESS`` override)."""
    address = os.getenv("USDC_ADDRESS", "").strip() or ARC_TESTNET_USDC_ADDRESS
    return w3.eth.contract(address=Web3.to_checksum_address(address), abi=_USDC_ABI)


def _resolve_network(chain_id: str) -> str:
    """Map chain_id to a deployments directory name."""
    known = {str(_ARC_TESTNET_CHAIN_ID): "arcTestnet"}
    name = known.get(chain_id)
    if name and (_DEPLOY_DIR / name).exists():
        return name
    for d in _DEPLOY_DIR.iterdir():
        cid_file = d / ".chainId"
        if cid_file.exists() and cid_file.read_text().strip() == chain_id:
            return d.name
    raise RuntimeError(f"No deployment found for chain_id={chain_id}")


def _get_deployer() -> LocalAccount:
    """Get deployer account from env."""
    pk = os.getenv("DEPLOYER_PRIVATE_KEY", "").strip()
    if not pk:
        raise RuntimeError("DEPLOYER_PRIVATE_KEY must be set for Arc testnet integration tests.")
    return Account.from_key(pk if pk.startswith("0x") else f"0x{pk}")


def _get_test_wallets() -> list[LocalAccount]:
    """Return test wallets from env (up to 6)."""
    wallets: list[LocalAccount] = []
    for i in range(1, 7):
        env_name = f"TEST_WALLET_{i}_PRIVATE_KEY"
        pk = os.getenv(env_name, "").strip()
        if not pk:
            continue
        if not pk.startswith("0x"):
            pk = f"0x{pk}"
        wallets.append(Account.from_key(pk))
    return wallets


def to_shares(value: str, decimals: int = 6) -> int:
    """Convert a human-readable amount to token units (like ethers.parseUnits)."""
    parts = value.split(".")
    if len(parts) == 1:
        return int(parts[0]) * (10 ** decimals)
    integer, frac = parts
    frac = frac[:decimals].ljust(decimals, "0")
    return int(integer) * (10 ** decimals) + int(frac)
