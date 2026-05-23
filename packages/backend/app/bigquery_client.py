"""
Lazy wrapper around `google.cloud.bigquery.Client`.

We don't import the heavy BQ client at module load — many code paths don't
need it (tests, local-only deployments) and lazy construction means the
service starts even when BQ creds are missing in non-prod envs. The first
call to `get_bq_client()` will raise a clear error pointing at the env vars
the operator forgot.

Configuration (root `.env`):

    BQ_PROJECT=agora-492710         # GCP project that owns the dataset
    BQ_DATASET=agora_lake           # dataset to query (created by the
                                    # `scripts/setup_bigquery_external.py`)
    BQ_LOCATION=US                  # optional, defaults to "US"
"""

from __future__ import annotations

import os
from typing import Any


_client: Any | None = None  # google.cloud.bigquery.Client; Any to avoid import at module load


def bq_project() -> str:
    return os.getenv("BQ_PROJECT", "").strip()


def bq_dataset() -> str:
    return os.getenv("BQ_DATASET", "agora_lake").strip()


def bq_location() -> str:
    return os.getenv("BQ_LOCATION", "US").strip() or "US"


def bq_configured() -> bool:
    return bool(bq_project())


def get_bq_client() -> Any:
    """Return a memoised BigQuery client; raises if not configured."""
    global _client
    if _client is not None:
        return _client
    if not bq_configured():
        raise RuntimeError(
            "BigQuery not configured. Set BQ_PROJECT (and optionally "
            "BQ_DATASET, BQ_LOCATION) in the root .env, then restart the "
            "backend. See scripts/setup_bigquery_external.py for the "
            "one-time external-table bootstrap."
        )
    from google.cloud import bigquery  # local import keeps cold start cheap

    _client = bigquery.Client(project=bq_project(), location=bq_location())
    return _client


def fully_qualified(table: str) -> str:
    """`project.dataset.table` — handy when writing SQL strings."""
    return f"`{bq_project()}.{bq_dataset()}.{table}`"
