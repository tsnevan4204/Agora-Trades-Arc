"""
Integration lifecycle tests — runs against Circle Arc testnet.

Each test creates its own fresh event + market for isolation.
Resolve/redeem tests use short close windows and real-time waits.

Requires:
  - ARC_TESTNET_RPC_URL pointing to a live chain with deployments
  - DEPLOYER_PRIVATE_KEY with resolver + factory-owner roles
  - TEST_WALLET_{1..6}_PRIVATE_KEY funded with testnet USDC (faucet.circle.com)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from web3 import Web3

_tests_dir = str(Path(__file__).resolve().parents[1])
if _tests_dir not in sys.path:
    sys.path.insert(0, _tests_dir)

from chain_helpers import ChainKit, to_shares  # noqa: E402

CLOSE_DELAY = 90  # seconds until market closes (testnet real-time wait)


def _fresh_market(kit: ChainKit, title: str, *, close_delay: int | None = None) -> int:
    """Create a new event + market, return the market_id."""
    now = kit.w3.eth.get_block("latest")["timestamp"]
    delay = close_delay if close_delay is not None else 3600
    event_id, _ = kit.create_event(title, "integration-test", now + delay)
    spec_hash = Web3.keccak(text=f"spec-{title}-{now}")
    market_id, _ = kit.create_market(event_id, f"{title}?", spec_hash, f"ipfs://{title}")
    return market_id


class TestLifecycle:
    """Full lifecycle: split, exchange trading, resolve, redeem."""

    def test_end_to_end_lifecycle(self, kit: ChainKit) -> None:
        alice, bob, charlie = kit.wallets[0], kit.wallets[1], kit.wallets[2]

        market_id = _fresh_market(kit, "E2E-Lifecycle", close_delay=CLOSE_DELAY)

        for w in [alice, bob, charlie]:
            kit.seed_wallet(w, to_shares("100"))

        kit.split(alice, market_id, to_shares("20"))
        kit.split(bob, market_id, to_shares("10"))

        sell_offer_id, _ = kit.post_offer(alice, market_id, 2, 6000, to_shares("8"))
        kit.fill_offer(charlie, sell_offer_id, to_shares("5"))

        buy_offer_id, _ = kit.post_offer(charlie, market_id, 1, 3000, to_shares("3"))
        kit.fill_offer(bob, buy_offer_id, to_shares("3"))

        print(f"  ⏳ waiting for market {market_id} close ({CLOSE_DELAY}s) …")
        kit.wait_for_close(market_id)

        ev_hash = Web3.keccak(text=f"evidence-{market_id}")
        kit.resolve(kit.deployer, market_id, 0, ev_hash)

        before = kit.usdc_balance(charlie.address)
        kit.redeem(charlie, market_id)
        after = kit.usdc_balance(charlie.address)
        assert after > before, "charlie should have received collateral from redeem"

    def test_cancel_open_offer_after_close(self, kit: ChainKit) -> None:
        alice = kit.wallets[0]

        market_id = _fresh_market(kit, "Cancel-After-Close", close_delay=CLOSE_DELAY)

        kit.seed_wallet(alice, to_shares("100"))
        kit.split(alice, market_id, to_shares("8"))

        offer_id, _ = kit.post_offer(alice, market_id, 2, 6000, to_shares("8"))

        print(f"  ⏳ waiting for market {market_id} close ({CLOSE_DELAY}s) …")
        kit.wait_for_close(market_id)

        yes_token_id = kit.token1155.functions.getYesTokenId(market_id).call()
        before = kit.token1155.functions.balanceOf(alice.address, yes_token_id).call()
        kit.cancel_offer(alice, offer_id)
        after = kit.token1155.functions.balanceOf(alice.address, yes_token_id).call()
        assert after > before, "alice should have gotten YES tokens back"

    def test_repeated_partial_fills(self, kit: ChainKit) -> None:
        alice, bob, charlie, dave = (
            kit.wallets[0], kit.wallets[1], kit.wallets[2], kit.wallets[3],
        )

        market_id = _fresh_market(kit, "Partial-Fills")

        for w in [alice, bob, charlie, dave]:
            kit.seed_wallet(w, to_shares("100"))

        kit.split(alice, market_id, to_shares("30"))
        offer_id, _ = kit.post_offer(alice, market_id, 2, 6500, to_shares("30"))

        kit.fill_offer(bob, offer_id, to_shares("7"))
        kit.fill_offer(charlie, offer_id, to_shares("9"))
        kit.fill_offer(dave, offer_id, to_shares("14"))

        offer = kit.exchange.functions.offers(offer_id).call()
        remaining = offer[5]
        status = offer[6]
        assert remaining == 0, f"expected remaining=0, got {remaining}"
        assert status == 2, f"expected status=Filled(2), got {status}"

    def test_isolates_balances_between_markets(self, kit: ChainKit) -> None:
        alice, bob = kit.wallets[0], kit.wallets[1]

        market_id_0 = _fresh_market(kit, "Isolate-A")
        market_id_1 = _fresh_market(kit, "Isolate-B")

        for w in [alice, bob]:
            kit.seed_wallet(w, to_shares("100"))

        kit.split(alice, market_id_0, to_shares("5"))
        kit.split(bob, market_id_1, to_shares("5"))

        offer_id, _ = kit.post_offer(alice, market_id_0, 2, 6000, to_shares("2"))
        kit.fill_offer(bob, offer_id, to_shares("2"))

        yes_0 = kit.token1155.functions.getYesTokenId(market_id_0).call()
        yes_1 = kit.token1155.functions.getYesTokenId(market_id_1).call()
        assert kit.token1155.functions.balanceOf(bob.address, yes_0).call() == to_shares("2")
        assert kit.token1155.functions.balanceOf(bob.address, yes_1).call() == to_shares("5")


class TestSixWalletStress:
    """Multi-wallet flows exercising all 6 test wallets — mirrors the Hardhat
    ``six-wallet-stress`` spec but in Python against a live testnet."""

    @pytest.fixture(autouse=True)
    def _require_six_wallets(self, kit: ChainKit) -> None:
        if len(kit.wallets) < 6:
            pytest.skip(f"Need 6 wallets, only {len(kit.wallets)} available")

    def test_all_wallets_approve_and_micro_split(self, kit: ChainKit) -> None:
        market_id = _fresh_market(kit, "Six-Split")

        for w in kit.wallets:
            kit.seed_wallet(w, to_shares("10"))

        for w in kit.wallets:
            kit.split(w, market_id, to_shares("0.5"))

        yes_id = kit.token1155.functions.getYesTokenId(market_id).call()
        no_id = kit.token1155.functions.getNoTokenId(market_id).call()
        for w in kit.wallets:
            assert kit.token1155.functions.balanceOf(w.address, yes_id).call() >= to_shares("0.5")
            assert kit.token1155.functions.balanceOf(w.address, no_id).call() >= to_shares("0.5")

    def test_one_sell_yes_three_partial_takers(self, kit: ChainKit) -> None:
        w1, _, _, w4, w5, w6 = kit.wallets[:6]
        market_id = _fresh_market(kit, "Six-SELL-YES")

        for w in [w1, w4, w5, w6]:
            kit.seed_wallet(w, to_shares("50"))

        kit.split(w1, market_id, to_shares("12"))
        offer_id, _ = kit.post_offer(w1, market_id, 2, 6100, to_shares("12"))

        kit.fill_offer(w4, offer_id, to_shares("4"))
        kit.fill_offer(w5, offer_id, to_shares("3"))
        kit.fill_offer(w6, offer_id, to_shares("5"))

        offer = kit.exchange.functions.offers(offer_id).call()
        assert offer[5] == 0, "remaining should be 0"
        assert offer[6] == 2, "status should be Filled"

        yes_id = kit.token1155.functions.getYesTokenId(market_id).call()
        assert kit.token1155.functions.balanceOf(w4.address, yes_id).call() >= to_shares("4")

    def test_sell_no_maker_and_taker(self, kit: ChainKit) -> None:
        _, w2, w3, *_ = kit.wallets
        market_id = _fresh_market(kit, "Six-SELL-NO")

        for w in [w2, w3]:
            kit.seed_wallet(w, to_shares("50"))

        kit.split(w2, market_id, to_shares("6"))

        no_id = kit.token1155.functions.getNoTokenId(market_id).call()
        w3_no_before = kit.token1155.functions.balanceOf(w3.address, no_id).call()

        offer_id, _ = kit.post_offer(w2, market_id, 3, 5200, to_shares("6"))
        kit.fill_offer(w3, offer_id, to_shares("2"))

        w3_no_after = kit.token1155.functions.balanceOf(w3.address, no_id).call()
        assert w3_no_after - w3_no_before == to_shares("2")

    def test_self_fill_reverts(self, kit: ChainKit) -> None:
        w1 = kit.wallets[0]
        market_id = _fresh_market(kit, "Six-SelfFill")

        kit.seed_wallet(w1, to_shares("50"))
        kit.split(w1, market_id, to_shares("3"))

        offer_id, _ = kit.post_offer(w1, market_id, 2, 6000, to_shares("3"))

        with pytest.raises(Exception):
            kit.fill_offer(w1, offer_id, to_shares("1"))

    def test_merge_burns_back_to_collateral(self, kit: ChainKit) -> None:
        _, _, w3, *_ = kit.wallets
        market_id = _fresh_market(kit, "Six-Merge")

        kit.seed_wallet(w3, to_shares("100"))

        collateral_before = kit.usdc_balance(w3.address)
        yes_id = kit.token1155.functions.getYesTokenId(market_id).call()
        no_id = kit.token1155.functions.getNoTokenId(market_id).call()
        yes_before = kit.token1155.functions.balanceOf(w3.address, yes_id).call()
        no_before = kit.token1155.functions.balanceOf(w3.address, no_id).call()

        split_amt = to_shares("20")
        merge_amt = to_shares("7")

        kit.split(w3, market_id, split_amt)
        assert kit.usdc_balance(w3.address) == collateral_before - split_amt
        assert kit.token1155.functions.balanceOf(w3.address, yes_id).call() == yes_before + split_amt
        assert kit.token1155.functions.balanceOf(w3.address, no_id).call() == no_before + split_amt

        kit.merge(w3, market_id, merge_amt)
        assert kit.token1155.functions.balanceOf(w3.address, yes_id).call() == yes_before + split_amt - merge_amt
        assert kit.token1155.functions.balanceOf(w3.address, no_id).call() == no_before + split_amt - merge_amt
        assert kit.usdc_balance(w3.address) == collateral_before - split_amt + merge_amt

    def test_round_robin_post_and_fill(self, kit: ChainKit) -> None:
        market_id = _fresh_market(kit, "Six-RoundRobin")

        for w in kit.wallets:
            kit.seed_wallet(w, to_shares("20"))
            kit.split(w, market_id, to_shares("2"))

        yes_id = kit.token1155.functions.getYesTokenId(market_id).call()

        for i in range(len(kit.wallets)):
            maker = kit.wallets[i]
            taker = kit.wallets[(i + 1) % len(kit.wallets)]
            taker_yes_before = kit.token1155.functions.balanceOf(taker.address, yes_id).call()

            offer_id, _ = kit.post_offer(maker, market_id, 2, 5800, to_shares("1"))
            kit.fill_offer(taker, offer_id, to_shares("1"))

            taker_yes_after = kit.token1155.functions.balanceOf(taker.address, yes_id).call()
            assert taker_yes_after - taker_yes_before == to_shares("1")


class TestRelayerIntegration:
    """Integration tests for the relayer path against a real chain."""

    def test_relay_split_via_forwarder(self, kit: ChainKit) -> None:
        """Gas-sponsored split via the forwarder + relayer code path."""
        from eth_abi import encode as abi_encode
        from eth_account.messages import encode_typed_data

        from app.relayer import relay_forward_request
        from app.models import RelayForwardRequest
        import app.relayer as rm

        alice = kit.wallets[0]
        market_id = _fresh_market(kit, "Relay-Split")
        kit.seed_wallet(alice, to_shares("1000"))

        split_selector = None
        for item in kit.manager.abi:
            if item.get("name") == "split" and item.get("type") == "function":
                from web3._utils.abi import get_abi_input_types
                sig = "split(" + ",".join(get_abi_input_types(item)) + ")"
                split_selector = Web3.keccak(text=sig)[:4].hex()
                break
        if split_selector is None:
            pytest.skip("Could not find split selector in manager ABI")

        calldata = "0x" + split_selector + abi_encode(
            ["uint256", "uint256"], [market_id, to_shares("10")]
        ).hex()

        now = kit.w3.eth.get_block("latest")["timestamp"]
        nonce = kit.forwarder.functions.nonces(alice.address).call()
        chain_id = kit.w3.eth.chain_id
        deadline = now + 3600

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
                "verifyingContract": kit.forwarder.address,
            },
            "message": {
                "from": alice.address,
                "to": kit.manager.address,
                "value": 0,
                "gas": 500_000,
                "nonce": nonce,
                "deadline": deadline,
                "data": calldata,
            },
        }

        signable = encode_typed_data(full_message=typed_data)
        signed = alice.sign_message(signable)
        sig_hex = "0x" + signed.signature.hex()

        original_settings = {
            "rpc_url": rm.settings.rpc_url,
            "relayer_private_key": rm.settings.relayer_private_key,
            "forwarder_address": rm.settings.forwarder_address,
            "manager_address": rm.settings.manager_address,
            "exchange_address": rm.settings.exchange_address,
        }

        rm.settings.rpc_url = kit.w3.provider.endpoint_uri
        rm.settings.relayer_private_key = kit.deployer.key.hex()
        rm.settings.forwarder_address = kit.forwarder.address
        rm.settings.manager_address = kit.manager.address
        rm.settings.exchange_address = kit.exchange.address

        try:
            req = RelayForwardRequest.model_validate({
                "from": alice.address,
                "to": kit.manager.address,
                "value": 0,
                "gas": 500_000,
                "deadline": deadline,
                "data": calldata,
                "signature": sig_hex,
            })
            result = relay_forward_request(req, w3=kit.w3)
            assert result.ok, f"Relay failed: {result.reason}"
            assert result.tx_hash is not None
        finally:
            for k, v in original_settings.items():
                setattr(rm.settings, k, v)
