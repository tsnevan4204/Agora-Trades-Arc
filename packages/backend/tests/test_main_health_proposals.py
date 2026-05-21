"""
Proposal lifecycle: create, read, approve (on-chain stub), reject, validation and error paths.

Uses in-memory storage (``memory_store``) and mocks ``create_event_and_markets`` so tests stay deterministic.

Run with ``pytest -s`` (or ``-vv -s``) to see all ``print`` output — pytest hides stdout by default.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.chain import CreateMarketsResult, _hex_to_bytes32
from app.main import app, approve_proposal, create_proposal, get_proposal, health, reject_proposal
from app.models import EventProposal, ProposalApproveRequest, ProposalMarketSpec, ProposalRejectRequest


def _proposal_body(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "proposalId": "prop-001",
        "proposerAddress": "0x" + "a" * 40,
        "title": "Apple Q2 2026 Earnings",
        "category": "earnings",
        "ticker": "AAPL",
        "metric": "eps",
        "fiscalYear": 2026,
        "fiscalQuarter": 2,
        "suggestedRanges": ["> 1.60", "1.50–1.60"],
    }
    base.update(overrides)
    return base


def _valid_bytes32_hex(suffix: str = "ab") -> str:
    """64 hex chars after 0x (placeholder spec hashes for approve payloads)."""
    pad = "0" * (64 - len(suffix))
    return "0x" + pad + suffix


def _market(question: str, h_suffix: str = "01") -> dict[str, str]:
    return {
        "question": question,
        "resolutionSpecHash": _valid_bytes32_hex(h_suffix),
        "resolutionSpecURI": f"https://example.com/spec/{h_suffix}.json",
    }


def _approve_body(
    *,
    markets: list[dict[str, str]] | None = None,
    close_time_unix: int = 2_000_000_000,
    confirmed_by: str = "0x" + "b" * 40,
) -> dict[str, Any]:
    return {
        "confirmedBy": confirmed_by,
        "closeTimeUnix": close_time_unix,
        "markets": markets
        if markets is not None
        else [
            _market("EPS > 1.60?", "01"),
            _market("EPS 1.50–1.60?", "02"),
        ],
    }


@pytest.fixture
def client(memory_store: Any) -> TestClient:
    print("🌐 (fixture client) Built a FastAPI TestClient so we can hit routes like a real HTTP client.")
    return TestClient(app)


@pytest.fixture
def stub_create_markets(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str]]:
    """Capture args passed to create_event_and_markets; return a fixed result."""
    captured: list[tuple[str, str, str]] = []

    def fake_create_event_and_markets(
        title: str,
        category: str,
        close_time_unix: int,
        markets: list[tuple[str, str, str]],
    ) -> CreateMarketsResult:
        captured.clear()
        captured.extend(markets)
        print("\n🔗 (stub create_event_and_markets) Fake chain call — no real RPC!")
        print(f"   • event title from stored proposal: {title!r}")
        print(f"   • category: {category!r}")
        print(f"   • closeTimeUnix: {close_time_unix}")
        print(f"   • number of sub-markets in this approve request: {len(markets)}")
        for i, (q, h, uri) in enumerate(markets):
            print(f"   • market[{i}] question={q!r}")
            print(f"            hash   ={h[:18]}…{h[-6:]} (len {len(h)})")
            print(f"            uri    ={uri!r}")
        result = CreateMarketsResult(
            event_id=42,
            market_ids=[100, 101],
            create_event_tx="0x" + "e" * 64,
            create_market_txs=["0x" + "1" * 64, "0x" + "2" * 64],
        )
        print(f"   ➜ returning fake eventId={result.event_id}, marketIds={result.market_ids}")
        return result

    monkeypatch.setattr("app.main.create_event_and_markets", fake_create_event_and_markets)
    return captured


# --- health ---


def test_health_returns_ok() -> None:
    print("\n" + "=" * 60)
    print("🏥 TEST: Health check")
    print("=" * 60)
    print("We call health() exactly like the GET /health route does.")
    out = health()
    print(f"📤 Returned payload: {out!r}")
    assert out.get("ok") is True
    assert out.get("storage") in ("gcs", "local", "memory")
    print("✅ Status: service reports OK — exactly what we expected.")


# --- create + get ---


def test_create_proposal_persists_and_get_round_trip(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📝 TEST: Create proposal (Python model) then read it back")
    print("=" * 60)
    prop = EventProposal(
        proposalId="p-1",
        proposerAddress="0xabc",
        title="Apple Q2",
        category="earnings",
        ticker="AAPL",
        metric="eps",
        fiscalYear=2026,
        fiscalQuarter=2,
        suggestedRanges=[">1.5"],
    )
    print(f"📋 Built EventProposal: id={prop.proposalId!r} title={prop.title!r} metric={prop.metric}")
    saved = create_proposal(prop)
    print(f"💾 create_proposal() response: {saved!r}")

    payload = get_proposal("p-1")
    print(f"📖 Loaded back from store — title={payload['title']!r} status={payload['status']!r}")
    print(f"   suggestedRanges: {payload.get('suggestedRanges')}")
    assert payload["title"] == "Apple Q2"
    assert payload["status"] == "pending"
    assert payload["suggestedRanges"] == [">1.5"]
    assert payload["metric"] == "eps"
    print("✅ Round-trip matches; proposal is still pending as expected.")


def test_get_proposal_missing_raises_404(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🔍 TEST: GET proposal that does not exist → 404")
    print("=" * 60)
    print("Asking for proposalId='missing' — storage should be empty for that key.")
    with pytest.raises(HTTPException) as ctx:
        get_proposal("missing")
    print(f"🚫 Caught HTTPException status_code={ctx.value.status_code} detail={ctx.value.detail!r}")
    assert ctx.value.status_code == 404
    print("✅ Correct: 404 Not Found.")


def test_create_proposal_via_http_persists(client: TestClient, memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🌍 TEST: POST /proposals then GET /proposals/{id} over HTTP")
    print("=" * 60)
    body = _proposal_body(proposalId="http-1")
    print(f"📨 POST /proposals body (summary): proposalId={body['proposalId']!r} ticker={body['ticker']!r}")
    print(f"   full JSON: {json.dumps(body, indent=2)}")
    r = client.post("/proposals", json=body)
    print(f"📥 POST status={r.status_code} body={r.text}")
    assert r.status_code == 200
    assert r.json() == {"saved": True, "proposalId": "http-1"}

    r2 = client.get("/proposals/http-1")
    print(f"📥 GET /proposals/http-1 status={r2.status_code}")
    data = r2.json()
    print(f"📖 Retrieved: ticker={data.get('ticker')!r} suggestedRanges={data.get('suggestedRanges')}")
    assert data["ticker"] == "AAPL"
    assert data["suggestedRanges"] == ["> 1.60", "1.50–1.60"]
    print("✅ HTTP path persisted the same structured data we sent.")


# --- create validation (malformed payloads) ---


def test_create_proposal_rejects_missing_required_field(client: TestClient) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: Create proposal without proposalId → 422 validation error")
    print("=" * 60)
    body = _proposal_body()
    del body["proposalId"]
    print(f"📨 Sending broken payload (keys only): {list(body.keys())} — note: no proposalId")
    r = client.post("/proposals", json=body)
    print(f"📥 Response status={r.status_code}")
    if r.status_code == 422:
        print(f"   Pydantic/FastAPI errors (truncated): {r.json()}")
    assert r.status_code == 422
    print("✅ Server rejected the request before it touched storage — good.")


def test_create_proposal_rejects_wrong_type_fiscal_quarter(client: TestClient) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: fiscalQuarter as string → 422")
    print("=" * 60)
    body = _proposal_body(fiscalQuarter="two")
    print(f"📨 fiscalQuarter={body['fiscalQuarter']!r} (should be an integer)")
    r = client.post("/proposals", json=body)
    print(f"📥 status={r.status_code}")
    assert r.status_code == 422
    print("✅ Type error surfaced correctly.")


# --- approve success: event + multiple markets ---


def test_approve_proposal_success_updates_store_and_returns_on_chain(
    memory_store: Any,
    stub_create_markets: list[tuple[str, str, str]],
) -> None:
    print("\n" + "=" * 60)
    print("✨ TEST: Approve pending proposal — happy path with stubbed chain")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="ap-1",
            proposerAddress="0xp",
            title="Mega Event",
            category="earnings",
            ticker="MSFT",
            metric="revenue",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    print("📋 Stored event-level proposal ap-1 (pending). Admin will attach 2 sub-markets in approve body.")
    body = ProposalApproveRequest(
        confirmedBy="0xadmin",
        closeTimeUnix=2_010_000_000,
        markets=[
            ProposalMarketSpec(
                question="Q1",
                resolutionSpecHash=_valid_bytes32_hex("aa"),
                resolutionSpecURI="uri-a",
            ),
            ProposalMarketSpec(
                question="Q2",
                resolutionSpecHash=_valid_bytes32_hex("bb"),
                resolutionSpecURI="uri-b",
            ),
        ],
    )
    print(f"🖊️ Approving as {body.confirmedBy!r} with closeTimeUnix={body.closeTimeUnix}")
    out = approve_proposal("ap-1", body)
    print(f"📤 approve_proposal() returned keys: {list(out.keys())}")
    print(f"   eventId={out.get('eventId')} marketIds={out.get('marketIds')}")
    assert out["approved"] is True
    assert out["proposalId"] == "ap-1"
    assert out["eventId"] == 42
    assert out["marketIds"] == [100, 101]
    assert "createEventTx" in out

    stored = get_proposal("ap-1")
    print(f"📖 After approve, stored status={stored['status']!r} approvedBy={stored.get('approvedBy')!r}")
    print(f"   onChain snapshot: {json.dumps(stored.get('onChain', {}), indent=2)[:400]}…")
    assert stored["status"] == "approved"
    assert stored["approvedBy"] == "0xadmin"
    assert stored["onChain"]["eventId"] == 42
    assert stored["onChain"]["marketIds"] == [100, 101]

    assert stub_create_markets == [
        ("Q1", _valid_bytes32_hex("aa"), "uri-a"),
        ("Q2", _valid_bytes32_hex("bb"), "uri-b"),
    ]
    print(f"🎯 Stub saw exactly these market tuples: {stub_create_markets}")
    print("✅ Full approve flow: chain stub called with right data, GCS-shaped store updated.")


def test_approve_proposal_via_http_success(client: TestClient, memory_store: Any, stub_create_markets: Any) -> None:
    print("\n" + "=" * 60)
    print("🌍 TEST: POST /proposals/{id}/approve over HTTP")
    print("=" * 60)
    client.post("/proposals", json=_proposal_body(proposalId="http-ap"))
    print("📋 Seeded proposal http-ap via POST /proposals")
    approve_json = _approve_body()
    print(f"📨 POST /proposals/http-ap/approve with {len(approve_json['markets'])} markets")
    r = client.post("/proposals/http-ap/approve", json=approve_json)
    print(f"📥 status={r.status_code} json={r.json()}")
    assert r.status_code == 200
    j = r.json()
    assert j["approved"] is True
    assert j["eventId"] == 42
    print("✅ HTTP approve matches stubbed chain response.")


# --- approve failures: missing / wrong state ---


def test_approve_proposal_not_found_returns_404(memory_store: Any, stub_create_markets: Any) -> None:
    print("\n" + "=" * 60)
    print("🚫 TEST: Approve unknown proposal id → 404")
    print("=" * 60)
    body = ProposalApproveRequest(
        confirmedBy="0xa",
        closeTimeUnix=2_000_000_000,
        markets=[ProposalMarketSpec(question="Q", resolutionSpecHash=_valid_bytes32_hex(), resolutionSpecURI="u")],
    )
    print("📨 Approve body is valid, but proposal id 'nope' was never created.")
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("nope", body)
    print(f"🚫 HTTPException {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 404
    print("✅ Expected 404.")


def test_approve_proposal_not_pending_after_approve_returns_400(
    memory_store: Any,
    stub_create_markets: Any,
) -> None:
    print("\n" + "=" * 60)
    print("🔁 TEST: Double approve same proposal → second call 400")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="twice",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    req = ProposalApproveRequest(
        confirmedBy="0xa",
        closeTimeUnix=2_000_000_000,
        markets=[ProposalMarketSpec(question="Q", resolutionSpecHash=_valid_bytes32_hex(), resolutionSpecURI="u")],
    )
    print("1️⃣ First approve…")
    approve_proposal("twice", req)
    print("   first call succeeded; status should now be 'approved'")
    print("2️⃣ Second approve (should fail)…")
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("twice", req)
    print(f"🚫 Got {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400
    assert "not pending" in str(ctx.value.detail).lower()
    print("✅ Idempotency guard works — cannot approve twice.")


def test_approve_proposal_not_pending_after_reject_returns_400(
    memory_store: Any,
    stub_create_markets: Any,
) -> None:
    print("\n" + "=" * 60)
    print("🔁 TEST: Approve after reject → 400")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="rej-first",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    reject_proposal("rej-first", ProposalRejectRequest(confirmedBy="0xa", reason="no"))
    print("📛 Proposal rejected first; status is no longer pending.")
    req = ProposalApproveRequest(
        confirmedBy="0xa",
        closeTimeUnix=2_000_000_000,
        markets=[ProposalMarketSpec(question="Q", resolutionSpecHash=_valid_bytes32_hex(), resolutionSpecURI="u")],
    )
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("rej-first", req)
    print(f"🚫 Got {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400
    print("✅ Cannot revive a rejected proposal via approve.")


# --- approve: chain errors; proposal stays pending when chain fails ---


def test_approve_proposal_value_error_from_chain_returns_400_and_leaves_pending(
    memory_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    print("\n" + "=" * 60)
    print("💥 TEST: Chain raises ValueError (bad bytes32) → 400, proposal stays pending")
    print("=" * 60)

    def boom(*_a: Any, **_k: Any) -> None:
        print("   💣 (patched create_event_and_markets) Raising ValueError like bad calldata would.")
        raise ValueError("bytes32 hex must be 64 hex chars")

    monkeypatch.setattr("app.main.create_event_and_markets", boom)
    create_proposal(
        EventProposal(
            proposalId="ve",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    req = ProposalApproveRequest(
        confirmedBy="0xa",
        closeTimeUnix=2_000_000_000,
        markets=[ProposalMarketSpec(question="Q", resolutionSpecHash="0xbad", resolutionSpecURI="u")],
    )
    print(f"📨 resolutionSpecHash in request is intentionally invalid: {req.markets[0].resolutionSpecHash!r}")
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("ve", req)
    print(f"🚫 Mapped to HTTP {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400

    assert get_proposal("ve")["status"] == "pending"
    print("✅ Proposal JSON was NOT flipped to approved — still pending for a retry.")


def test_approve_proposal_runtime_error_from_chain_returns_503(
    memory_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    print("\n" + "=" * 60)
    print("💥 TEST: Chain raises RuntimeError → 503, proposal stays pending")
    print("=" * 60)

    def boom(*_a: Any, **_k: Any) -> None:
        print("   💣 (patched) Simulating RPC / node failure.")
        raise RuntimeError("RPC down")

    monkeypatch.setattr("app.main.create_event_and_markets", boom)
    create_proposal(
        EventProposal(
            proposalId="rt",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    req = ProposalApproveRequest(
        confirmedBy="0xa",
        closeTimeUnix=2_000_000_000,
        markets=[ProposalMarketSpec(question="Q", resolutionSpecHash=_valid_bytes32_hex(), resolutionSpecURI="u")],
    )
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("rt", req)
    print(f"🚫 HTTP {ctx.value.status_code} (service unavailable style): {ctx.value.detail!r}")
    assert ctx.value.status_code == 503
    assert get_proposal("rt")["status"] == "pending"
    print("✅ Still pending — operator can retry when RPC is back.")


# --- approve: one invalid market hash (body wrong though event proposal ok) ---


def test_approve_with_one_invalid_spec_hash_fails_without_mutating_proposal(
    memory_store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    print("\n" + "=" * 60)
    print("🧩 TEST: Stored event proposal is fine; ONE market line in approve has bad hash")
    print("=" * 60)
    print("This mirrors admin pasting a broken spec hash for the second market only.")

    def strict_create(
        title: str,
        category: str,
        close_time_unix: int,
        markets: list[tuple[str, str, str]],
    ) -> CreateMarketsResult:
        print("   🔍 strict_create validating each bytes32 before 'broadcast'…")
        for q, h, u in markets:
            print(f"      checking hash for question={q!r} hash_prefix={h[:10]}…")
            _hex_to_bytes32(h)
        return CreateMarketsResult(1, [1], "0xev", ["0xm"])

    monkeypatch.setattr("app.main.create_event_and_markets", strict_create)
    create_proposal(
        EventProposal(
            proposalId="mix",
            proposerAddress="0x1",
            title="Good title",
            category="earnings",
            ticker="NVDA",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    markets = [
        ProposalMarketSpec(question="OK", resolutionSpecHash=_valid_bytes32_hex("11"), resolutionSpecURI="u1"),
        ProposalMarketSpec(question="Bad hash", resolutionSpecHash="0xdead", resolutionSpecURI="u2"),
    ]
    req = ProposalApproveRequest(confirmedBy="0xa", closeTimeUnix=2_000_000_000, markets=markets)
    with pytest.raises(HTTPException) as ctx:
        approve_proposal("mix", req)
    print(f"🚫 HTTP {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400
    assert get_proposal("mix")["status"] == "pending"
    print("✅ First market never made it on-chain in this test; proposal untouched — admin can fix the hash and retry.")


# --- approve HTTP validation ---


def test_approve_rejects_empty_markets_list(client: TestClient, memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: Approve with markets=[] → 422")
    print("=" * 60)
    client.post("/proposals", json=_proposal_body(proposalId="empty-m"))
    payload = {"confirmedBy": "0xa", "closeTimeUnix": 2_000_000_000, "markets": []}
    print(f"📨 POST body: {payload}")
    r = client.post("/proposals/empty-m/approve", json=payload)
    print(f"📥 status={r.status_code} {r.text[:400]}")
    assert r.status_code == 422
    print("✅ Pydantic min_length=1 on markets list enforced.")


def test_approve_rejects_market_missing_resolution_uri(client: TestClient, memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: Market object missing resolutionSpecURI → 422")
    print("=" * 60)
    client.post("/proposals", json=_proposal_body(proposalId="no-uri"))
    bad_market = {"question": "Q", "resolutionSpecHash": _valid_bytes32_hex()}
    print(f"📨 markets=[{bad_market}]  (no URI field)")
    r = client.post(
        "/proposals/no-uri/approve",
        json={
            "confirmedBy": "0xa",
            "closeTimeUnix": 2_000_000_000,
            "markets": [bad_market],
        },
    )
    print(f"📥 status={r.status_code}")
    assert r.status_code == 422
    print("✅ Required field missing — rejected at validation layer.")


# --- reject ---


def test_reject_proposal_success(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("📛 TEST: Reject a pending proposal")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="rj",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    out = reject_proposal("rj", ProposalRejectRequest(confirmedBy="0xmod", reason="Duplicate of prop-9"))
    print(f"📤 reject_proposal response: {out!r}")

    stored = get_proposal("rj")
    print(f"📖 Stored record: status={stored['status']!r} rejectedBy={stored.get('rejectedBy')!r}")
    print(f"   rejectReason={stored.get('rejectReason')!r} rejectedAtUtc={stored.get('rejectedAtUtc')!r}")
    assert out == {"rejected": True, "proposalId": "rj"}
    assert stored["status"] == "rejected"
    assert stored["rejectedBy"] == "0xmod"
    assert stored["rejectReason"] == "Duplicate of prop-9"
    assert "rejectedAtUtc" in stored
    print("✅ Rejection metadata landed in the JSON blob.")


def test_reject_proposal_not_found_returns_404(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🚫 TEST: Reject missing proposal → 404")
    print("=" * 60)
    with pytest.raises(HTTPException) as ctx:
        reject_proposal("ghost", ProposalRejectRequest(confirmedBy="0xa", reason="x"))
    print(f"🚫 {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 404
    print("✅ As expected.")


def test_reject_proposal_not_pending_returns_400(memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🔁 TEST: Double reject → second is 400")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="rj2",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    reject_proposal("rj2", ProposalRejectRequest(confirmedBy="0xa", reason="first"))
    print("Second reject attempt…")
    with pytest.raises(HTTPException) as ctx:
        reject_proposal("rj2", ProposalRejectRequest(confirmedBy="0xb", reason="second"))
    print(f"🚫 {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400
    print("✅ Cannot reject twice.")


def test_reject_proposal_empty_reason_rejected_by_validation(client: TestClient, memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("⚠️ TEST: Reject with empty reason string → 422")
    print("=" * 60)
    client.post("/proposals", json=_proposal_body(proposalId="empty-reason"))
    r = client.post(
        "/proposals/empty-reason/reject",
        json={"confirmedBy": "0xa", "reason": ""},
    )
    print(f"📥 status={r.status_code} body={r.text[:500]}")
    assert r.status_code == 422
    print("✅ min_length=1 on reason field works.")


# --- interaction: reject cannot run after approve ---


def test_reject_after_approve_returns_400(memory_store: Any, stub_create_markets: Any) -> None:
    print("\n" + "=" * 60)
    print("🔒 TEST: Cannot reject after approve (terminal state)")
    print("=" * 60)
    create_proposal(
        EventProposal(
            proposalId="ar",
            proposerAddress="0x1",
            title="T",
            category="c",
            ticker="X",
            metric="eps",
            fiscalYear=2026,
            fiscalQuarter=1,
        )
    )
    approve_proposal(
        "ar",
        ProposalApproveRequest(
            confirmedBy="0xa",
            closeTimeUnix=2_000_000_000,
            markets=[ProposalMarketSpec(question="Q", resolutionSpecHash=_valid_bytes32_hex(), resolutionSpecURI="u")],
        ),
    )
    print("Proposal is now approved / on-chain stub ran. Trying reject…")
    with pytest.raises(HTTPException) as ctx:
        reject_proposal("ar", ProposalRejectRequest(confirmedBy="0xb", reason="too late"))
    print(f"🚫 {ctx.value.status_code}: {ctx.value.detail!r}")
    assert ctx.value.status_code == 400
    print("✅ Business rule: only pending proposals accept reject.")


# --- stored proposal shape ---


def test_create_proposal_includes_created_at_and_pending_status(client: TestClient, memory_store: Any) -> None:
    print("\n" + "=" * 60)
    print("🕐 TEST: New proposals get createdAtUtc + pending status")
    print("=" * 60)
    r = client.post("/proposals", json=_proposal_body(proposalId="ts-1"))
    print(f"📥 POST status={r.status_code}")
    data = client.get("/proposals/ts-1").json()
    print(f"📖 GET payload keys: {sorted(data.keys())}")
    print(f"   status={data.get('status')!r}")
    print(f"   createdAtUtc={data.get('createdAtUtc')!r}")
    print(f"   adminNotes={data.get('adminNotes')!r}")
    assert r.status_code == 200
    assert data["status"] == "pending"
    assert "createdAtUtc" in data and data["createdAtUtc"]
    assert data.get("adminNotes") is None
    print("✅ Defaults look right for a freshly submitted proposal.")
