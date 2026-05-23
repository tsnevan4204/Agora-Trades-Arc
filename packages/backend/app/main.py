from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3.exceptions import ContractCustomError

from .admin_auth import (
    AdminPrincipal,
    admin_auth_configured,
    check_admin_credentials,
    issue_admin_token,
    require_admin,
)
from .chain import create_event_and_markets, submit_resolves
from .config import settings
from .data_api import router as data_router
from . import fills_indexer
from .models import (
    AdminResolveRequest,
    EventProposal,
    ProposalApproveRequest,
    ProposalRejectRequest,
    RelayExecuteResponse,
    RelayForwardRequest,
)
from .orderbook import OffchainOrder, delete_order, list_orders, upsert_order
from .relayer import relay_forward_request
from .resolution import evidence_hash
from .storage import store, store_backend_kind


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    expiresAt: int
    username: str

app = FastAPI(title="Agora Backend", version="0.1.0")


# Start the on-chain OfferFilled indexer alongside the API server. The
# indexer writes new fills to gs://<bucket>/trades/{market_id}/fills.parquet,
# which the `agora_lake.trades_fills` external table picks up on the next
# BigQuery query. See `app/fills_indexer.py` for the polling cadence + env
# toggles. Both handlers are no-ops when FILLS_INDEXER_ENABLED=0.
@app.on_event("startup")
async def _start_fills_indexer() -> None:
    fills_indexer.start()


@app.on_event("shutdown")
async def _stop_fills_indexer() -> None:
    await fills_indexer.stop()

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allow_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public read-only data router (BigQuery + direct-GCS proxy). Mounted as
# `/data/*` and gated by either DATA_API_PUBLIC=1 or X-API-Key against
# DATA_API_KEYS — see `app/data_api.py` for the auth model.
app.include_router(data_router)


@app.get("/health")
def health() -> dict:
    # Cheap GCS read for the indexer cursor so ops can verify the poller is
    # advancing without having to ssh into the box or poke GCS directly.
    indexer_state = store.read_json("state/fills_indexer.json") or {}
    return {
        "ok": True,
        "storage": store_backend_kind(),
        "contracts": {
            "factory": settings.factory_address,
            "manager": settings.manager_address,
            "exchange": settings.exchange_address,
            "forwarder": settings.forwarder_address,
        },
        # Surface whether the admin auth env vars are filled so the frontend
        # can show a useful banner instead of failing the login mysteriously.
        "adminAuthConfigured": admin_auth_configured(),
        "fillsIndexer": {
            "enabled": fills_indexer.fills_indexer_enabled(),
            "lastBlock": indexer_state.get("lastBlock"),
            "updatedAtUtc": indexer_state.get("updatedAtUtc"),
        },
    }


@app.post("/admin/login", response_model=AdminLoginResponse)
def admin_login(body: AdminLoginRequest) -> AdminLoginResponse:
    """Exchange env-driven username/password for a short-lived HMAC bearer token."""
    if not admin_auth_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Admin auth not configured on backend. Set ADMIN_USERNAME, "
                "ADMIN_PASSWORD, ADMIN_SESSION_SECRET in the root .env."
            ),
        )
    if not check_admin_credentials(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    token, exp = issue_admin_token(body.username)
    return AdminLoginResponse(token=token, expiresAt=exp, username=body.username)


@app.get("/admin/me")
def admin_me(principal: AdminPrincipal = Depends(require_admin)) -> dict:
    """Cheap endpoint the frontend can hit on mount to validate a stored token."""
    return {"username": principal.username, "expiresAt": principal.expires_at}


@app.post("/proposals")
def create_proposal(proposal: EventProposal) -> dict:
    store.write_json(f"proposals/{proposal.proposalId}.json", proposal.model_dump(mode="json"))
    return {"saved": True, "proposalId": proposal.proposalId}


@app.post("/proposals/{proposal_id}/approve")
def approve_proposal(
    proposal_id: str,
    body: ProposalApproveRequest,
    _admin: AdminPrincipal = Depends(require_admin),
) -> dict:
    raw = store.read_json(f"proposals/{proposal_id}.json")
    if not raw:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if raw.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Proposal is not pending")

    markets_tuples = [
        (m.question, m.resolutionSpecHash, m.resolutionSpecURI) for m in body.markets
    ]

    print(f"[approve] proposal={proposal_id} title={raw.get('title')!r}")
    print(f"[approve] closeTimeUnix={body.closeTimeUnix} markets={markets_tuples}")
    print(f"[approve] RPC_URL={settings.rpc_url!r}")
    print(f"[approve] FACTORY_ADDRESS={settings.factory_address!r}")
    print(f"[approve] FACTORY_OWNER_KEY present={bool(settings.factory_owner_private_key)}")

    try:
        result = create_event_and_markets(
            title=raw["title"],
            category=raw["category"],
            close_time_unix=body.closeTimeUnix,
            markets=markets_tuples,
        )
    except RuntimeError as e:
        print(f"[approve] ERROR: {e}")
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        print(f"[approve] VALIDATION ERROR: {e}")
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ContractCustomError as e:
        err = str(e).lower()
        print(f"[approve] CONTRACT ERROR: {e!r}")
        if "0x5f2db5ce" in err or "invalidclosetime" in err:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Market close time must be in the future (MarketFactory__InvalidCloseTime). "
                    "Pick a later date/time in the admin form and try again."
                ),
            ) from e
        raise HTTPException(status_code=502, detail=f"On-chain createEvent/createMarket reverted: {e}") from e

    print(f"[approve] SUCCESS eventId={result.event_id} marketIds={result.market_ids}")
    print(f"[approve] createEventTx={result.create_event_tx}")
    print(f"[approve] createMarketTxs={result.create_market_txs}")

    raw["status"] = "approved"
    raw["approvedBy"] = body.confirmedBy
    raw["approvedAtUtc"] = datetime.now(timezone.utc).isoformat()
    raw["onChain"] = {
        "eventId": result.event_id,
        "marketIds": result.market_ids,
        "createEventTx": result.create_event_tx,
        "createMarketTxs": result.create_market_txs,
    }
    store.write_json(f"proposals/{proposal_id}.json", raw)
    return {"approved": True, "proposalId": proposal_id, **raw["onChain"]}


@app.post("/proposals/{proposal_id}/reject")
def reject_proposal(
    proposal_id: str,
    body: ProposalRejectRequest,
    _admin: AdminPrincipal = Depends(require_admin),
) -> dict:
    raw = store.read_json(f"proposals/{proposal_id}.json")
    if not raw:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if raw.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Proposal is not pending")

    raw["status"] = "rejected"
    raw["rejectedBy"] = body.confirmedBy
    raw["rejectedAtUtc"] = datetime.now(timezone.utc).isoformat()
    raw["rejectReason"] = body.reason
    store.write_json(f"proposals/{proposal_id}.json", raw)
    return {"rejected": True, "proposalId": proposal_id}


@app.get("/orders/{market_id}")
def get_orders(market_id: int) -> dict:
    return {"orders": list_orders(market_id)}


@app.post("/orders")
def post_order(order: OffchainOrder) -> dict:
    upsert_order(order)
    return {"saved": True, "orderId": order.orderId}


@app.delete("/orders/{market_id}/{order_id}")
def remove_order(market_id: int, order_id: str) -> dict:
    """Drop an order from the off-chain mirror.

    Called by the frontend after a successful on-chain `cancelOffer` /
    `fillOffer` so the live snapshot in GCS stays consistent with the
    Exchange. Idempotent: returns `{deleted: false}` when the order had
    already been pruned (e.g. duplicate cancel, or the post-call prune ran
    first because the upsert path already saw a terminal status).
    """
    deleted = delete_order(market_id, order_id)
    return {"deleted": deleted, "marketId": market_id, "orderId": order_id}


@app.get("/proposals")
def list_proposals(status: str | None = None) -> dict:
    """Return all proposals, optionally filtered by status (pending, approved, rejected)."""
    keys = store.list_keys("proposals/")
    proposals = []
    for key in keys:
        raw = store.read_json(key)
        if raw is None:
            continue
        if status and raw.get("status") != status:
            continue
        proposals.append(raw)
    proposals.sort(key=lambda p: p.get("submittedAtUtc", ""), reverse=True)
    return {"proposals": proposals, "total": len(proposals)}


@app.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str) -> dict:
    payload = store.read_json(f"proposals/{proposal_id}.json")
    if not payload:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return payload


@app.post("/resolution/resolve/{event_id}")
def resolve_markets(
    event_id: int,
    body: AdminResolveRequest,
    _admin: AdminPrincipal = Depends(require_admin),
) -> dict:
    """Admin manually resolves markets with specified outcomes."""
    try:
        outcomes_by_market = {int(k): str(v) for k, v in body.outcomes.items()}
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid outcomes keys: {e}") from e

    for mid in body.marketIds:
        if mid not in outcomes_by_market:
            raise HTTPException(status_code=400, detail=f"Missing outcome for marketId {mid}")

    confirmed_at = datetime.now(timezone.utc).isoformat()

    hash_hex = evidence_hash(
        outcomes=body.outcomes,
        confirmed_utc=confirmed_at,
        admin_address=body.confirmedBy,
        reason=body.reason,
    )

    on_chain: dict = {}
    if (
        settings.resolver_private_key.strip()
        and settings.manager_address.strip()
        and settings.rpc_url.strip()
    ):
        try:
            records, overall = submit_resolves(body.marketIds, outcomes_by_market, hash_hex)
            on_chain = {
                "overall": overall,
                "txRecords": [asdict(r) for r in records],
            }
        except Exception as e:
            on_chain = {"overall": "error", "error": str(e)}
    else:
        on_chain = {"skipped": True, "reason": "missing RESOLVER_PRIVATE_KEY, MANAGER_ADDRESS, or RPC_URL"}

    store.write_json(f"resolutions/{event_id}/admin_confirmation.json", body.model_dump(mode="json"))
    resolution_results = {
        "outcomes": body.outcomes,
        "evidenceHash": hash_hex,
        "confirmedAtUtc": confirmed_at,
        "onChain": on_chain,
    }
    store.write_json(f"resolutions/{event_id}/resolution_results.json", resolution_results)
    return {
        "resolved": True,
        "eventId": event_id,
        "evidenceHash": hash_hex,
        "onChain": on_chain,
    }


@app.post("/relay/forward", response_model=RelayExecuteResponse)
def relay_forward(body: RelayForwardRequest) -> RelayExecuteResponse:
    result = relay_forward_request(body)
    return RelayExecuteResponse(ok=result.ok, txHash=result.tx_hash, reason=result.reason)
