"""
🧭 Full prediction-market lifecycle on Circle Arc testnet + FastAPI + GCS.

Phases (one serial story):
  0️⃣  Preconditions & bucket visibility
  1️⃣  HTTP health
  2️⃣  Proposal → GCS `proposals/`
  3️⃣  Admin approve → on-chain `createEvent` + `createMarket` (via backend) → GCS update
  4️⃣  Off-chain orderbook API → GCS `orderbooks/`
  5️⃣  Simulated fill log → GCS `trades/` (+ Parquet best-effort)
  6️⃣  On-chain trading (6 wallets): split, postOffer, fillOffer, merge, cancel path optional
  7️⃣  Meta-tx relay HTTP `POST /relay/forward`
  8️⃣  Wait past market close (real time on testnet)
  9️⃣  Admin resolve via `POST /resolution/resolve/{event_id}` → GCS `resolutions/` + on-chain `resolve`
  🔟 Redeem winning collateral on-chain

Also: separate test for `POST /proposals/.../reject`.

**You need in repo-root `.env` (non-exhaustive):**
  • `ARC_TESTNET_RPC_URL` or `RPC_URL` (Arc testnet, chain 5042002)
  • `DEPLOYER_PRIVATE_KEY` (factory owner + must match on-chain resolver if you use that key as resolver)
  • `FACTORY_ADDRESS` — optional; filled from `manifest.json` chain `5042002` if empty
  • `MANAGER_ADDRESS`, `EXCHANGE_ADDRESS`, `FORWARDER_ADDRESS`, `USDC_ADDRESS` (Arc testnet defaults to `0x3600…` USDC)
  • `RELAYER_PRIVATE_KEY` ≠ `RESOLVER_PRIVATE_KEY` (backend startup rule); resolver key must be the on-chain resolver
  • `TEST_WALLET_1_PRIVATE_KEY` … `TEST_WALLET_6_PRIVATE_KEY`
  • `GOOGLE_APPLICATION_CREDENTIALS` → path to service account JSON
  • `GCS_BUCKET` (optional; defaults to `agora-market-data`)

**Redeploy?** Only if your deployed contracts changed. Backend/Hardhat refactor does not require redeploy
if addresses in `.env` / manifest still match the live testnet deployment.

Run (from `packages/backend`):
  python3 -m pytest tests/integration/test_market_lifecycle_e2e.py -v -s
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from web3 import Web3

# Same import path as other integration tests
_tests_dir = str(Path(__file__).resolve().parents[1])
if _tests_dir not in sys.path:
    sys.path.insert(0, _tests_dir)

from chain_helpers import ChainKit, RPC_URL, to_shares  # noqa: E402

# Repo root (…/Agora) — same place as `.env`; relative credential paths usually live here.
_REPO_ROOT = Path(__file__).resolve().parents[4]


def _p(msg: str) -> None:
    print(msg, flush=True)


def _resolve_gcs_credentials_path() -> str | None:
    """Resolve `GOOGLE_APPLICATION_CREDENTIALS` when pytest cwd is `packages/backend`."""
    raw = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not raw:
        return None
    trials: list[Path] = [Path(raw)]
    p = Path(raw)
    if not p.is_absolute():
        trials.append(_REPO_ROOT / raw)
        trials.append(Path.cwd() / raw)
    for candidate in trials:
        try:
            if candidate.is_file():
                return str(candidate.resolve())
        except OSError:
            continue
    return None


def _gcs_credentials_ok() -> bool:
    resolved = _resolve_gcs_credentials_path()
    if not resolved:
        return False
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved
    return True


def _list_gcs_keys(*, bucket_name: str, prefix: str, max_results: int = 80) -> list[str]:
    """🔭 List object names under a prefix (like `gsutil ls gs://bucket/prefix`)."""
    from google.cloud import storage

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blobs = list(bucket.list_blobs(prefix=prefix, max_results=max_results))
    return sorted(b.name for b in blobs)


def _ensure_factory_address() -> None:
    from app.config import settings
    from app.contracts import get_address

    if settings.factory_address.strip():
        _p(f"🏭 FACTORY_ADDRESS from env: {settings.factory_address}")
        return
    try:
        settings.factory_address = get_address("MarketFactory", "5042002")
        _p(f"🏭 FACTORY_ADDRESS filled from manifest (chain 5042002): {settings.factory_address}")
    except Exception as e:
        pytest.fail(f"Set FACTORY_ADDRESS in .env or regenerate manifest for chain 5042002: {e}")


def _require_resolver_config() -> None:
    from app.config import settings

    if not settings.resolver_private_key.strip():
        pytest.fail(
            "🛑 RESOLVER_PRIVATE_KEY is required for POST /resolution/resolve to submit on-chain. "
            "Use the key for the on-chain resolver (often same as deployer); must differ from RELAYER_PRIVATE_KEY."
        )


def _has_valid_private_key(raw: str) -> bool:
    s = raw.strip()
    if s.startswith("0x"):
        s = s[2:]
    return len(s) == 64 and all(c in "0123456789abcdefABCDEF" for c in s)


def _ensure_relayer_config(kit: ChainKit) -> None:
    from app.config import settings

    if _has_valid_private_key(settings.relayer_private_key):
        return
    settings.relayer_private_key = kit.wallets[-1].key.hex()
    _p(f"🚚 RELAYER_PRIVATE_KEY fallback set from test wallet: {kit.wallets[-1].address}")


def _build_split_relay_payload(kit: ChainKit, wallet, market_id: int, amount: int, *, data: str | None = None) -> dict:
    from eth_abi import encode as abi_encode
    from eth_account.messages import encode_typed_data

    calldata = data
    if calldata is None:
        split_sel = None
        for item in kit.manager.abi:
            if item.get("name") == "split" and item.get("type") == "function":
                from web3._utils.abi import get_abi_input_types

                sig = "split(" + ",".join(get_abi_input_types(item)) + ")"
                split_sel = Web3.keccak(text=sig)[:4].hex()
                break
        assert split_sel
        calldata = "0x" + split_sel + abi_encode(["uint256", "uint256"], [market_id, amount]).hex()

    n = kit.w3.eth.get_block("latest")["timestamp"]
    nonce_f = kit.forwarder.functions.nonces(wallet.address).call()
    deadline = int(n) + 3600
    typed = {
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
            "chainId": kit.w3.eth.chain_id,
            "verifyingContract": kit.forwarder.address,
        },
        "message": {
            "from": wallet.address,
            "to": kit.manager.address,
            "value": 0,
            "gas": 500_000,
            "nonce": nonce_f,
            "deadline": deadline,
            "data": calldata,
        },
    }
    signed = wallet.sign_message(encode_typed_data(full_message=typed))
    return {
        "from": wallet.address,
        "to": kit.manager.address,
        "value": 0,
        "gas": 500_000,
        "deadline": deadline,
        "data": calldata,
        "signature": "0x" + signed.signature.hex(),
    }


@pytest.fixture(scope="module")
def kit() -> ChainKit:
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 15}))
        if not w3.is_connected():
            raise ConnectionError()
    except Exception:
        pytest.skip(f"No chain at {RPC_URL}")
    return ChainKit.from_rpc()


@pytest.mark.integration
@pytest.mark.slow
def test_full_prediction_market_lifecycle_arc_with_gcs_and_backend(kit: ChainKit) -> None:
    if not _gcs_credentials_ok():
        raw = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        pytest.skip(
            "🧊 GCS service account JSON not found. "
            f"GOOGLE_APPLICATION_CREDENTIALS={raw!r} — tried cwd={Path.cwd()} and repo_root={_REPO_ROOT}. "
            "Put the file next to repo-root `.env` or use an absolute path."
        )

    from fastapi.testclient import TestClient

    from app.config import settings
    from app.event_listener import append_trade_fill
    from app.main import app

    _ensure_factory_address()
    _require_resolver_config()
    _ensure_relayer_config(kit)

    bucket = settings.gcs_bucket
    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 0 — Preconditions")
    _p("=" * 72)
    _p(f"🌐 RPC endpoint (masked): …{RPC_URL[-28:]}")
    _p(f"🪣 GCS bucket: {bucket}")
    _p(f"⛓️  chain_id={kit.w3.eth.chain_id} deployer={kit.deployer.address}")
    _p(f"👛 Test wallets loaded: {len(kit.wallets)}")
    if len(kit.wallets) < 6:
        pytest.fail("Need 6 TEST_WALLET_*_PRIVATE_KEY entries for this scenario.")

    try:
        keys_before = _list_gcs_keys(bucket_name=bucket, prefix="proposals/", max_results=5)
        _p(f"📂 GCS sample under proposals/ (up to 5): {keys_before or '(empty or no access)'}")
    except Exception as e:
        _p(f"⚠️ Could not list GCS (check IAM on bucket): {e}")
        raise

    client = TestClient(app)

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 1 — GET /health")
    _p("=" * 72)
    h = client.get("/health")
    _p(f"🏥 /health → {h.status_code} {h.json()}")
    assert h.status_code == 200

    proposal_id = f"e2e-{uuid.uuid4().hex[:12]}"
    spec_hash = Web3.keccak(text=f"lifecycle-spec-{proposal_id}").hex()

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 2 — Proposal (POST /proposals) → GCS")
    _p("=" * 72)
    prop_body = {
        "proposalId": proposal_id,
        "proposerAddress": kit.wallets[0].address,
        "title": "E2E Co Lifecycle",
        "category": "integration",
        "ticker": "E2E",
        "metric": "custom",
        "fiscalYear": 2026,
        "fiscalQuarter": 1,
        "suggestedRanges": ["0-1", "1-2"],
        "status": "pending",
    }
    r = client.post("/proposals", json=prop_body)
    _p(f"📝 POST /proposals → {r.status_code} {r.text[:500]}")
    assert r.status_code == 200

    g1 = _list_gcs_keys(bucket_name=bucket, prefix=f"proposals/{proposal_id}", max_results=10)
    _p(f"☁️ GCS keys after proposal: {g1}")
    assert any(proposal_id in k for k in g1), "Expected proposals/{id}.json in bucket"

    gr = client.get(f"/proposals/{proposal_id}")
    _p(f"📖 GET /proposals/{{id}} → {gr.status_code}")
    assert gr.status_code == 200

    close_delta = int(os.getenv("E2E_CLOSE_DELAY_SECONDS", "120"))
    now = kit.w3.eth.get_block("latest")["timestamp"]
    close_ts = int(now) + close_delta
    _p(f"⏰ Market close will be +{close_delta}s from t0 (chain now≈{now}) → close_ts={close_ts}")

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 3 — Approve proposal → chain + GCS")
    _p("=" * 72)
    approve_body = {
        "confirmedBy": kit.deployer.address,
        "closeTimeUnix": close_ts,
        "markets": [
            {
                "question": f"E2E market {proposal_id[:8]} resolves YES?",
                "resolutionSpecHash": spec_hash,
                "resolutionSpecURI": f"ipfs://e2e-{proposal_id}",
            }
        ],
    }
    ra = client.post(f"/proposals/{proposal_id}/approve", json=approve_body)
    _p(f"✅ POST /proposals/.../approve → {ra.status_code}")
    if ra.status_code != 200:
        _p(ra.text)
    assert ra.status_code == 200, ra.text
    data = ra.json()
    event_id = int(data["eventId"])
    market_ids = [int(x) for x in data["marketIds"]]
    market_id = market_ids[0]
    _p(f"🎯 On-chain eventId={event_id} marketIds={market_ids}")
    _p(f"🔗 createEvent tx: {data.get('createEventTx', '')[:20]}…")

    g2 = _list_gcs_keys(bucket_name=bucket, prefix=f"proposals/{proposal_id}", max_results=10)
    _p(f"☁️ GCS keys after approve: {g2}")
    body = client.get(f"/proposals/{proposal_id}").json()
    assert body.get("status") == "approved"
    assert body.get("onChain", {}).get("eventId") == event_id
    _p(f"📄 Proposal JSON status={body['status']} onChain keys={list(body.get('onChain', {}).keys())}")

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 4 — Off-chain orderbook REST → GCS orderbooks/")
    _p("=" * 72)
    oid_a = f"ord-{proposal_id}-a"
    oid_b = f"ord-{proposal_id}-b"
    for oid, side, bps, amt in [
        (oid_a, "SELL_YES", 6200, int(to_shares("5"))),
        (oid_b, "BUY_YES", 4000, int(to_shares("3"))),
    ]:
        po = client.post(
            "/orders",
            json={
                "orderId": oid,
                "marketId": market_id,
                "maker": kit.wallets[1].address,
                "side": side,
                "priceBps": bps,
                "amount": amt,
                "signature": None,
                "status": "open",
            },
        )
        _p(f"📊 POST /orders {oid} {side} → {po.status_code}")
        assert po.status_code == 200

    og = client.get(f"/orders/{market_id}")
    _p(f"📈 GET /orders/{market_id} → {og.status_code} count={len(og.json().get('orders', []))}")
    assert og.status_code == 200
    assert len(og.json()["orders"]) >= 2

    g3 = _list_gcs_keys(bucket_name=bucket, prefix=f"orderbooks/{market_id}/", max_results=20)
    _p(f"☁️ GCS orderbooks/{market_id}/ → {g3}")
    assert any("live.json" in k for k in g3)

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 5 — Listener-style trade row → GCS trades/")
    _p("=" * 72)
    append_trade_fill(
        market_id,
        {
            "kind": "OfferFilled",
            "offerId": 999001,
            "maker": kit.wallets[1].address,
            "taker": kit.wallets[2].address,
            "fillAmount": str(to_shares("1")),
            "note": "synthetic row for E2E visibility",
        },
    )
    g4 = _list_gcs_keys(bucket_name=bucket, prefix=f"trades/{market_id}/", max_results=20)
    _p(f"☁️ GCS trades/{market_id}/ → {g4}")
    assert any("fills.json" in k for k in g4), "Expected fills.json from append_trade_fill"

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 6 — On-chain CLOB + manager (6 wallets)")
    _p("=" * 72)
    w = kit.wallets
    for acc in w:
        kit.seed_wallet(acc)
        _p(f"🔑 approved manager + exchange for {acc.address[:10]}…")

    kit.split(w[0], market_id, to_shares("40"))
    kit.split(w[1], market_id, to_shares("25"))
    _p("✂️ split wallet0 + wallet1")

    offer_id, _ = kit.post_offer(w[0], market_id, 2, 6100, to_shares("15"))
    kit.fill_offer(w[2], offer_id, to_shares("6"))
    kit.fill_offer(w[3], offer_id, to_shares("4"))
    _p(f"🤝 postOffer SELL_YES + partial fills offerId={offer_id}")

    # BUY_YES takers must deliver YES shares, so pre-split wallet4 first.
    kit.split(w[4], market_id, to_shares("3"))
    bo_id, _ = kit.post_offer(w[2], market_id, 0, 3500, to_shares("4"))
    kit.fill_offer(w[4], bo_id, to_shares("2"))
    _p(f"🤝 postOffer BUY_YES + fill offerId={bo_id}")

    kit.merge(w[1], market_id, to_shares("3"))
    _p("🔥 merge on wallet1")

    kit.split(w[5], market_id, to_shares("4"))
    leftover_id, _ = kit.post_offer(w[5], market_id, 2, 5900, to_shares("2"))
    kit.cancel_offer(w[5], leftover_id)
    _p(f"🚫 post+cancel offer {leftover_id} on wallet5")

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 7 — POST /relay/forward (meta-tx split)")
    _p("=" * 72)
    relay_payload = _build_split_relay_payload(kit, w[2], market_id, to_shares("2"))
    rr = client.post("/relay/forward", json=relay_payload)
    _p(f"⚡ POST /relay/forward → {rr.status_code} {rr.json()}")
    assert rr.status_code == 200
    assert rr.json().get("ok") is True

    _p("")
    _p("=" * 72)
    _p(f"🚀 PHASE 8 — Wait until close ({close_delta}s real time on testnet) ☕")
    _p("=" * 72)
    kit.wait_for_close(market_id)
    _p("✅ Close time reached on-chain")

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 9 — POST /resolution/resolve (backend + resolver key)")
    _p("=" * 72)
    res_body = {
        "confirmedBy": kit.deployer.address,
        "marketIds": [market_id],
        "outcomes": {str(market_id): "YES"},
        "reason": "E2E manual resolution",
    }
    rx = client.post(f"/resolution/resolve/{event_id}", json=res_body)
    _p(f"⚖️ POST /resolution/resolve/{event_id} → {rx.status_code}")
    _p(rx.text[:1200])
    assert rx.status_code == 200
    js = rx.json()
    assert js.get("evidenceHash")
    on = js.get("onChain", {})
    if on.get("skipped"):
        pytest.fail(f"Resolution did not hit chain: {on}")
    assert on.get("overall") == "confirmed", f"Unexpected onChain: {on}"

    g5 = _list_gcs_keys(bucket_name=bucket, prefix=f"resolutions/{event_id}/", max_results=20)
    _p(f"☁️ GCS resolutions/{event_id}/ → {g5}")
    assert any("resolution_results.json" in k for k in g5)

    _p("")
    _p("=" * 72)
    _p("🚀 PHASE 10 — Redeem (PredictionMarketManager.redeem)")
    _p("=" * 72)
    yes_id = kit.token1155.functions.getYesTokenId(market_id).call()
    bal_yes = kit.token1155.functions.balanceOf(w[2].address, yes_id).call()
    _p(f"🎫 wallet2 YES balance before redeem: {bal_yes}")
    if bal_yes > 0:
        usdc_before = kit.usdc_balance(w[2].address)
        kit.redeem(w[2], market_id)
        usdc_after = kit.usdc_balance(w[2].address)
        _p(f"💵 wallet2 USDC before={usdc_before} after={usdc_after}")
        assert usdc_after >= usdc_before
    else:
        _p("⚠️ wallet2 had no YES to redeem; redeeming wallet0 instead")
        kit.redeem(w[0], market_id)

    _p("")
    _p("=" * 72)
    _p("🎉 E2E lifecycle finished — proposals, GCS, orderbook, trades, chain, relay, resolve, redeem")
    _p("=" * 72)


@pytest.mark.integration
def test_proposal_reject_happy_path_gcs(kit: ChainKit) -> None:
    if not _gcs_credentials_ok():
        pytest.skip(
            "GCS credentials JSON not found (see test_full… skip message for path hints)."
        )

    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    pid = f"rej-{uuid.uuid4().hex[:10]}"
    client = TestClient(app)
    client.post(
        "/proposals",
        json={
            "proposalId": pid,
            "proposerAddress": kit.wallets[0].address,
            "title": "Reject me",
            "category": "test",
            "ticker": "NO",
            "metric": "n/a",
            "fiscalYear": 2026,
            "fiscalQuarter": 2,
        },
    )
    r = client.post(f"/proposals/{pid}/reject", json={"confirmedBy": kit.deployer.address, "reason": "E2E reject"})
    _p(f"🙅 POST reject → {r.status_code} {r.json()}")
    assert r.status_code == 200
    keys = _list_gcs_keys(bucket_name=settings.gcs_bucket, prefix=f"proposals/{pid}", max_results=5)
    _p(f"☁️ GCS: {keys}")
    body = client.get(f"/proposals/{pid}").json()
    assert body["status"] == "rejected"


@pytest.mark.integration
@pytest.mark.slow
def test_adversarial_prediction_market_lifecycle_arc_survives_chaos(kit: ChainKit) -> None:
    if not _gcs_credentials_ok():
        raw = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        pytest.skip(
            "🧊 GCS service account JSON not found. "
            f"GOOGLE_APPLICATION_CREDENTIALS={raw!r} — tried cwd={Path.cwd()} and repo_root={_REPO_ROOT}. "
            "Put the file next to repo-root `.env` or use an absolute path."
        )

    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    _ensure_factory_address()
    _require_resolver_config()
    _ensure_relayer_config(kit)

    bucket = settings.gcs_bucket
    client = TestClient(app)
    w = kit.wallets
    if len(w) < 6:
        pytest.fail("Need 6 TEST_WALLET_*_PRIVATE_KEY entries for this scenario.")

    _p("")
    _p("=" * 72)
    _p("🧨 CHAOS E2E — Stress lifecycle with intentional bad actions")
    _p("=" * 72)

    proposal_id = f"chaos-{uuid.uuid4().hex[:12]}"
    spec_hash = Web3.keccak(text=f"chaos-spec-{proposal_id}").hex()
    now = kit.w3.eth.get_block("latest")["timestamp"]
    close_delta = max(int(os.getenv("E2E_CLOSE_DELAY_SECONDS", "120")), 120)
    close_ts = int(now) + close_delta

    create_body = {
        "proposalId": proposal_id,
        "proposerAddress": w[0].address,
        "title": "Chaos Lifecycle",
        "category": "integration-chaos",
        "ticker": "CHAOS",
        "metric": "stress",
        "fiscalYear": 2026,
        "fiscalQuarter": 2,
        "suggestedRanges": ["break", "recover"],
        "status": "pending",
    }
    r = client.post("/proposals", json=create_body)
    _p(f"📝 POST /proposals chaos → {r.status_code} {r.text[:300]}")
    assert r.status_code == 200

    bad_approve = client.post(
        f"/proposals/{proposal_id}/approve",
        json={
            "confirmedBy": kit.deployer.address,
            "closeTimeUnix": close_ts,
            "markets": [
                {
                    "question": "broken hash should fail",
                    "resolutionSpecHash": "0xdead",
                    "resolutionSpecURI": "ipfs://broken",
                }
            ],
        },
    )
    _p(f"💥 bad approve attempt → {bad_approve.status_code} {bad_approve.text[:200]}")
    assert bad_approve.status_code == 400
    assert client.get(f"/proposals/{proposal_id}").json()["status"] == "pending"

    approve_body = {
        "confirmedBy": kit.deployer.address,
        "closeTimeUnix": close_ts,
        "markets": [
            {
                "question": f"Chaos market {proposal_id[:8]} survives attacks?",
                "resolutionSpecHash": spec_hash,
                "resolutionSpecURI": f"ipfs://chaos-{proposal_id}",
            }
        ],
    }
    ra = client.post(f"/proposals/{proposal_id}/approve", json=approve_body)
    _p(f"✅ good approve → {ra.status_code} {ra.text[:300]}")
    assert ra.status_code == 200, ra.text
    approved = ra.json()
    event_id = int(approved["eventId"])
    market_id = int(approved["marketIds"][0])

    second_approve = client.post(f"/proposals/{proposal_id}/approve", json=approve_body)
    _p(f"🔁 second approve blocked → {second_approve.status_code}")
    assert second_approve.status_code == 400

    reject_after_approve = client.post(
        f"/proposals/{proposal_id}/reject",
        json={"confirmedBy": kit.deployer.address, "reason": "too late"},
    )
    _p(f"🙅 reject after approve blocked → {reject_after_approve.status_code}")
    assert reject_after_approve.status_code == 400

    for acc in w:
        kit.seed_wallet(acc, to_shares("700"))
        _p(f"💰 chaos seeded {acc.address[:10]}…")

    kit.split(w[0], market_id, to_shares("50"))
    kit.split(w[1], market_id, to_shares("35"))
    kit.split(w[4], market_id, to_shares("10"))
    _p("✂️ preloaded maker and adversarial wallets")

    offer_id, _ = kit.post_offer(w[0], market_id, 2, 6300, to_shares("20"))
    _p(f"📌 base SELL_YES offer posted id={offer_id}")

    with pytest.raises(Exception):
        kit.fill_offer(w[0], offer_id, to_shares("1"))
    _p("🛑 self-fill reverted as expected")

    with pytest.raises(Exception):
        kit.fill_offer(w[2], offer_id, to_shares("25"))
    _p("🛑 overfill reverted as expected")

    kit.fill_offer(w[2], offer_id, to_shares("7"))
    kit.fill_offer(w[3], offer_id, to_shares("5"))
    _p("🤝 valid partial fills succeeded after bad attempts")

    order_id = f"chaos-order-{proposal_id}"
    first_order = client.post(
        "/orders",
        json={
            "orderId": order_id,
            "marketId": market_id,
            "maker": w[1].address,
            "side": "SELL_YES",
            "priceBps": 6100,
            "amount": int(to_shares("4")),
            "signature": None,
            "status": "open",
        },
    )
    second_order = client.post(
        "/orders",
        json={
            "orderId": order_id,
            "marketId": market_id,
            "maker": w[1].address,
            "side": "SELL_YES",
            "priceBps": 6400,
            "amount": int(to_shares("6")),
            "signature": None,
            "status": "open",
        },
    )
    _p(f"📚 duplicate order upserts → {first_order.status_code}/{second_order.status_code}")
    assert first_order.status_code == 200
    assert second_order.status_code == 200
    orders = client.get(f"/orders/{market_id}").json()["orders"]
    matching = [o for o in orders if o["orderId"] == order_id]
    assert len(matching) == 1
    assert matching[0]["priceBps"] == 6400
    assert matching[0]["amount"] == int(to_shares("6"))

    invalid_relay = _build_split_relay_payload(kit, w[2], market_id, to_shares("2"), data="0xdeadbeef")
    bad_relay = client.post("/relay/forward", json=invalid_relay)
    _p(f"⚠️ invalid selector relay → {bad_relay.status_code} {bad_relay.json()}")
    assert bad_relay.status_code == 200
    assert bad_relay.json().get("ok") is False
    assert "selector" in (bad_relay.json().get("reason") or "").lower()

    good_relay = client.post("/relay/forward", json=_build_split_relay_payload(kit, w[2], market_id, to_shares("2")))
    _p(f"⚡ valid relay after failure → {good_relay.status_code} {good_relay.json()}")
    assert good_relay.status_code == 200
    assert good_relay.json().get("ok") is True

    early_resolve = client.post(
        f"/resolution/resolve/{event_id}",
        json={
            "confirmedBy": kit.deployer.address,
            "marketIds": [market_id],
            "outcomes": {str(market_id): "YES"},
            "reason": "too early on purpose",
        },
    )
    _p(f"⏰ early resolve probe → {early_resolve.status_code} {early_resolve.text[:500]}")
    assert early_resolve.status_code == 200
    early_on_chain = early_resolve.json().get("onChain", {})
    assert early_on_chain.get("overall") != "confirmed"

    _p(f"☕ waiting for chaos market close (+{close_delta}s)")
    kit.wait_for_close(market_id)
    _p("✅ chaos market closed")

    final_resolve = client.post(
        f"/resolution/resolve/{event_id}",
        json={
            "confirmedBy": kit.deployer.address,
            "marketIds": [market_id],
            "outcomes": {str(market_id): "YES"},
            "reason": "final chaos resolution",
        },
    )
    _p(f"⚖️ final resolve → {final_resolve.status_code} {final_resolve.text[:500]}")
    assert final_resolve.status_code == 200
    final_on_chain = final_resolve.json().get("onChain", {})
    assert final_on_chain.get("overall") == "confirmed"

    res_keys = _list_gcs_keys(bucket_name=bucket, prefix=f"resolutions/{event_id}/", max_results=20)
    _p(f"☁️ chaos resolutions/{event_id}/ → {res_keys}")
    assert any("resolution_results.json" in k for k in res_keys)

    yes_id = kit.token1155.functions.getYesTokenId(market_id).call()
    winner = w[2] if kit.token1155.functions.balanceOf(w[2].address, yes_id).call() > 0 else w[0]
    usdc_before = kit.usdc_balance(winner.address)
    kit.redeem(winner, market_id)
    usdc_after = kit.usdc_balance(winner.address)
    _p(f"💵 redeem winner={winner.address[:10]}… before={usdc_before} after={usdc_after}")
    assert usdc_after >= usdc_before

    proposal_keys = _list_gcs_keys(bucket_name=bucket, prefix=f"proposals/{proposal_id}", max_results=10)
    _p(f"☁️ chaos proposal keys → {proposal_keys}")
    assert any(proposal_id in k for k in proposal_keys)

    _p("🎯 chaos lifecycle survived malformed approve, blocked state transitions, bad fills, bad relay, early resolve, then finished cleanly")
