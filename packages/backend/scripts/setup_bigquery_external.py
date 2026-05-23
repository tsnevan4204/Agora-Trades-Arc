"""
One-time bootstrap: create the BigQuery dataset + external table over the
Parquet trade fills that already live in `gs://<GCS_BUCKET>/trades/`.

Run after you've set the following in the root `.env`:

    BQ_PROJECT=<your-gcp-project-id>          # e.g. agora-492710
    BQ_DATASET=agora_lake                     # any name you want
    BQ_LOCATION=US                            # must match where the bucket is
    GCS_BUCKET=agora_datalake
    GOOGLE_APPLICATION_CREDENTIALS=<abs/path/sa.json>

Idempotent — re-running is safe:
  • Dataset created if missing, otherwise reused.
  • External table dropped + recreated so a schema bump applies cleanly.

What this gives you:
  • `agora_lake.trades_fills` external table over `gs://<bucket>/trades/*/fills.parquet`
    Schema is auto-detected from the Parquet files at query time, so any
    new column you add via `event_listener.append_trade_fill` shows up
    automatically without re-running this script.

Usage:
    cd packages/backend
    source .venv/bin/activate
    python scripts/setup_bigquery_external.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow `python scripts/setup_bigquery_external.py` from the package root by
# making the parent dir importable as `app.*`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402  (sys.path mod above)
from app.bigquery_client import bq_dataset, bq_location, bq_project  # noqa: E402


def main() -> int:
    project = bq_project()
    if not project:
        print(
            "ERROR: BQ_PROJECT is not set. Add it to the root .env and re-run.",
            file=sys.stderr,
        )
        return 2

    bucket = settings.gcs_bucket
    dataset_id = bq_dataset()
    location = bq_location()

    from google.cloud import bigquery
    from google.cloud.exceptions import NotFound

    client = bigquery.Client(project=project, location=location)

    # 1. Ensure the dataset exists in the right region.
    ds_ref = bigquery.DatasetReference(project, dataset_id)
    try:
        existing = client.get_dataset(ds_ref)
        print(f"✓ dataset already exists: {project}.{dataset_id} (location={existing.location})")
        if existing.location != location:
            print(
                f"  WARNING: dataset is in {existing.location}, you asked for {location}. "
                "BigQuery does not support relocating datasets — pick a different BQ_DATASET "
                "or use the existing region."
            )
    except NotFound:
        ds = bigquery.Dataset(ds_ref)
        ds.location = location
        ds.description = "Agora prediction-market data lake (external tables over GCS)."
        client.create_dataset(ds)
        print(f"✓ dataset created: {project}.{dataset_id} (location={location})")

    # 2. Create / recreate the external table over the Parquet fills.
    #
    # We intentionally do NOT use BigQuery hive partitioning here:
    #   • Hive partitioning requires `key=value` path segments (e.g.
    #     `trades/market_id=24/fills.parquet`) — our paths are plain integer
    #     directories. CUSTOM mode is *supposed* to handle this, but in
    #     practice BQ trips on edge cases (empty parquet files, single-row
    #     partitions) and refuses the table.
    #   • The query layer (`/data/trades` in `app/data_api.py`) extracts
    #     `market_id` from `_FILE_NAME` via REGEXP_EXTRACT, which gives the
    #     same filtering behaviour without the bootstrap fragility. Queries
    #     don't pay extra to scan partitions because BQ still prunes file
    #     reads based on the regex predicate.
    #
    # If trade volume grows enough that file-pruning matters, we can revisit
    # by repartitioning the GCS layout to `trades/market_id={int}/` and
    # turning on hive partitioning in a single subsequent migration.
    table_id = f"{project}.{dataset_id}.trades_fills"
    source_uri = f"gs://{bucket}/trades/*/fills.parquet"

    ext_config = bigquery.ExternalConfig("PARQUET")
    ext_config.source_uris = [source_uri]
    # Auto-detect schema so adding columns to `append_trade_fill` propagates
    # without re-running this bootstrap.
    ext_config.autodetect = True

    table = bigquery.Table(table_id)
    table.external_data_configuration = ext_config
    table.description = (
        f"External Parquet table over gs://{bucket}/trades/<market_id>/fills.parquet "
        "— written by `app/event_listener.py:append_trade_fill`. `market_id` is "
        "extracted from _FILE_NAME at query time; see app/data_api.py."
    )

    # Recreate the table so schema/auto-detect changes apply cleanly.
    try:
        client.delete_table(table_id, not_found_ok=True)
    except Exception as e:
        print(f"  WARNING: could not delete existing table (continuing): {e}")
    client.create_table(table)
    print(f"✓ external table created: {table_id}")
    print(f"  source: {source_uri}")
    print("  market_id: extracted at query time from _FILE_NAME")

    # 3. Smoke-test query.
    sql = f"SELECT COUNT(*) AS n FROM `{table_id}`"
    try:
        result = list(client.query(sql, location=location).result())
        n = result[0]["n"] if result else 0
        print(f"✓ smoke-test OK — {n} rows visible in {table_id}")
    except Exception as e:
        print(f"  WARNING: smoke-test query failed (table may need data): {e}")

    print()
    print("All set. Hit the public API:")
    print("    curl -H 'X-API-Key: <DATA_API_KEYS-token>' \\")
    print(f"         '{os.getenv('PUBLIC_API_BASE', 'http://localhost:8001')}/data/trades?market_id=0&limit=10'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
