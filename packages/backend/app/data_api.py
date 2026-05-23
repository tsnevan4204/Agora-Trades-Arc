"""
Public read-only data API for the Agora data lake.

Two-tier architecture:

  • Low-cardinality JSON resources (proposals, resolutions, markets, the live
    orderbook snapshot) → served straight out of GCS by re-using the existing
    `store` abstraction. Total file count is in the hundreds, so a list-then-
    fetch loop is fine and there's no point in adding BigQuery overhead.

  • High-volume time-series data (trade fills, eventually orderbook snapshots
    if we start time-bucketing them) → served via BigQuery external tables
    over the existing Parquet files in `gs://<bucket>/trades/`. Zero data
    movement, standard SQL, scales as trade volume grows.

Auth model: API-key in `X-API-Key` header, validated against the env-driven
`DATA_API_KEYS` (comma-separated). Set `DATA_API_PUBLIC=1` to disable the
check entirely (use only for fully open public read access).

NOTE: this router only serves data already persisted by the rest of the
backend; it never mutates anything. That's intentional — keep the read API
strictly side-effect-free so it's safe to expose broadly.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from .bigquery_client import bq_configured, bq_dataset, fully_qualified, get_bq_client
from .config import settings
from .rate_limit import rate_limit
from .storage import store


router = APIRouter(prefix="/data", tags=["data"])


def _bq_max_bytes_billed() -> int:
    """Hard ceiling on bytes a single BQ query is allowed to bill.

    Defaults to 1 GiB. With ~200 bytes/row for trades that's well over a
    million rows per query — plenty for any reasonable dashboard, while
    making a runaway query *literally impossible* to bill more than the cap.
    Operator can override via env when justified.
    """
    raw = os.getenv("BQ_MAX_BYTES_BILLED", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return 1024 * 1024 * 1024  # 1 GiB


# ── auth dependency ──────────────────────────────────────────────────────────


def _allowed_api_keys() -> set[str]:
    raw = os.getenv("DATA_API_KEYS", "").strip()
    if not raw:
        return set()
    return {k.strip() for k in raw.split(",") if k.strip()}


def _public_access() -> bool:
    return os.getenv("DATA_API_PUBLIC", "").strip() in {"1", "true", "yes"}


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Soft auth: if `DATA_API_PUBLIC=1` we skip the check entirely.

    Otherwise we expect `X-API-Key: <token>` and reject anything else with a
    401. Tokens are compared via a Python `in` against a set — cheap, since
    operator-issued keys are short and the set rarely exceeds a handful.
    """
    if _public_access():
        return
    allowed = _allowed_api_keys()
    if not allowed:
        raise HTTPException(
            status_code=503,
            detail=(
                "Data API not configured. Set DATA_API_PUBLIC=1 in .env to "
                "enable public read access, OR set DATA_API_KEYS=key1,key2,… "
                "to require an X-API-Key header."
            ),
        )
    if not x_api_key or x_api_key not in allowed:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-API-Key",
        )


# ── helpers ──────────────────────────────────────────────────────────────────


def _safe_int(s: str | None, default: int, lo: int, hi: int) -> int:
    if s is None:
        return default
    try:
        v = int(s)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _read_jsons_under(prefix: str, limit: int, predicate=None) -> list[dict]:
    """List every key under `prefix` and return parsed JSON for non-empty rows.

    Used for the low-volume JSON resources. We sort keys deterministically so
    pagination is stable even though we don't (yet) accept a page token.
    """
    keys = sorted(store.list_keys(prefix))
    out: list[dict] = []
    for k in keys:
        if not k.endswith(".json"):
            continue
        payload = store.read_json(k)
        if not isinstance(payload, dict):
            continue
        if predicate is not None and not predicate(payload):
            continue
        out.append(payload)
        if len(out) >= limit:
            break
    return out


# ── endpoints ────────────────────────────────────────────────────────────────


@router.get(
    "/health",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_health() -> dict:
    """Tiny endpoint clients can hit to verify their API key + connectivity."""
    return {
        "ok": True,
        "bucket": settings.gcs_bucket,
        "bigquery": {
            "configured": bq_configured(),
            "dataset": bq_dataset() if bq_configured() else None,
        },
        "publicAccess": _public_access(),
    }


@router.get(
    "/proposals",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_proposals(
    status: str | None = Query(default=None, description="pending | approved | rejected"),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict:
    pred = (lambda p: p.get("status") == status) if status else None
    rows = _read_jsons_under("proposals/", limit=limit, predicate=pred)
    # Sort newest-first to mirror the admin console; ties broken by id.
    rows.sort(
        key=lambda p: (p.get("submittedAtUtc") or p.get("createdAtUtc") or ""),
        reverse=True,
    )
    return {"proposals": rows, "count": len(rows)}


@router.get(
    "/resolutions",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_resolutions(
    event_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict:
    """Public read of `resolutions/{eventId}/resolution_results.json` blobs.

    When `event_id` is provided we go straight to that key for an O(1) lookup;
    otherwise we list under the prefix and return up to `limit` results.
    """
    if event_id is not None:
        payload = store.read_json(f"resolutions/{event_id}/resolution_results.json")
        if payload is None:
            return {"resolutions": [], "count": 0}
        return {"resolutions": [{"eventId": event_id, **payload}], "count": 1}

    keys = sorted(k for k in store.list_keys("resolutions/") if k.endswith("/resolution_results.json"))
    rows: list[dict] = []
    for k in keys:
        payload = store.read_json(k)
        if not isinstance(payload, dict):
            continue
        # Extract the eventId from the path: `resolutions/<id>/resolution_results.json`.
        try:
            eid = int(k.split("/")[1])
        except (IndexError, ValueError):
            continue
        rows.append({"eventId": eid, **payload})
        if len(rows) >= limit:
            break
    return {"resolutions": rows, "count": len(rows)}


@router.get(
    "/orderbook/{market_id}",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_orderbook(market_id: int) -> dict:
    """Returns the post-prune live snapshot (terminal statuses already filtered)."""
    payload = store.read_json(f"orderbooks/{market_id}/live.json")
    if payload is None:
        return {"marketId": market_id, "orders": [], "updatedAtUtc": None}
    return {"marketId": market_id, **payload}


@router.get(
    "/markets",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_markets(limit: int = Query(default=200, ge=1, le=2000)) -> dict:
    """Whatever the backend has stashed in `markets/` (manifest snapshots, etc.)."""
    rows = _read_jsons_under("markets/", limit=limit)
    return {"markets": rows, "count": len(rows)}


# ── BigQuery-backed: trade fills ─────────────────────────────────────────────


@router.get(
    "/trades",
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
def data_trades(
    market_id: int | None = Query(default=None, ge=0),
    since: int | None = Query(
        default=None,
        description="Unix seconds — return fills with capturedAt >= since",
    ),
    until: int | None = Query(default=None, description="Unix seconds upper bound"),
    limit: int = Query(default=500, ge=1, le=5000),
) -> dict:
    """Time-series read of `trades/{marketId}/fills.parquet` via BigQuery.

    Requires the `trades_fills` external table created by
    `scripts/setup_bigquery_external.py`. If BQ isn't configured we return
    a clear 503 rather than silently falling back to slow GCS scans — when
    the operator hits this they should run the bootstrap script.
    """
    if not bq_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "BigQuery not configured. Run "
                "`python scripts/setup_bigquery_external.py` once, then set "
                "BQ_PROJECT and BQ_DATASET in .env."
            ),
        )

    table = fully_qualified("trades_fills")
    clauses: list[str] = []
    params: list[Any] = []

    # Build a small parameterised WHERE — no string interpolation of user
    # input goes into the SQL. `market_id` is NOT a real column in the
    # parquet files (it lives in the path: `trades/{mid}/fills.parquet`),
    # so we extract it from `_FILE_NAME` via REGEXP_EXTRACT. This matches
    # the bootstrap script's "no hive partitioning" decision — see the
    # comment block in scripts/setup_bigquery_external.py for why.
    from google.cloud import bigquery  # local import for ScalarQueryParameter

    # SAFE_CAST keeps any oddly-named files from blowing up the query.
    market_id_expr = (
        "SAFE_CAST(REGEXP_EXTRACT(_FILE_NAME, r'/trades/([0-9]+)/') AS INT64)"
    )

    if market_id is not None:
        clauses.append(f"{market_id_expr} = @market_id")
        params.append(bigquery.ScalarQueryParameter("market_id", "INT64", market_id))
    if since is not None:
        clauses.append("UNIX_SECONDS(TIMESTAMP(capturedAtUtc)) >= @since")
        params.append(bigquery.ScalarQueryParameter("since", "INT64", since))
    if until is not None:
        clauses.append("UNIX_SECONDS(TIMESTAMP(capturedAtUtc)) <= @until")
        params.append(bigquery.ScalarQueryParameter("until", "INT64", until))

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT
            *,
            {market_id_expr} AS market_id
        FROM {table}
        {where}
        ORDER BY capturedAtUtc DESC
        LIMIT @limit
    """
    params.append(bigquery.ScalarQueryParameter("limit", "INT64", limit))

    client = get_bq_client()
    # `maximum_bytes_billed` is a hard, server-enforced ceiling. If the query
    # would scan more than this BigQuery aborts before billing — so even a
    # crafted query with `limit=5000` can't run away with cost.
    job = client.query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=params,
            maximum_bytes_billed=_bq_max_bytes_billed(),
        ),
    )
    try:
        rows = [dict(r) for r in job.result()]
    except Exception as e:
        # Surface the "would scan more than X bytes" error as a clean 400
        # so abusive callers see a stable failure mode and we don't leak a
        # 500 stack trace.
        msg = str(e)
        if "exceed" in msg.lower() and "bytes" in msg.lower():
            raise HTTPException(
                status_code=400,
                detail=(
                    "Query would scan more bytes than the BQ_MAX_BYTES_BILLED "
                    "ceiling allows. Narrow the filter (market_id, since, until) "
                    "or lower `limit`."
                ),
            ) from e
        raise
    # BigQuery row values can include non-JSON types (datetime, Decimal); the
    # cheapest serialisation that handles all of them is to round-trip through
    # `json.dumps(default=str)` so we don't introduce a per-type serialiser.
    serialised = json.loads(json.dumps(rows, default=str))
    return {"trades": serialised, "count": len(serialised)}
