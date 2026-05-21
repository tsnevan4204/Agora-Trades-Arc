# Backend testing tracker

Living notes for **what pytest already covers**, **what belongs in integration tests**, and **ideas that keep coming up**. Update this as you add tests or ship new storage paths.

---

## Quick reality check: unit tests vs the real bucket

All current backend tests under `packages/backend/tests/` patch storage with an **in-memory dict** (`conftest.py` → `InMemoryStore`). Nothing hits **Google Cloud Storage** in CI or local pytest.

So we can prove **routing, validation, and write/read logic** against a fake store, but we **cannot** prove from these tests alone that:

- objects actually land in your `GCS_BUCKET`
- IAM / credentials / network behave correctly
- content types, object names, or sizes match what you expect in production
- Parquet writes succeed when `pyarrow` is installed (the code swallows Parquet failures)

That verification belongs in **integration or end-to-end** runs (real bucket, or emulator, with env configured).

---

## Backlog: integration / E2E (bucket truth)

- [ ] **Assert real GCS persistence** after representative flows: create proposal, approve (if chain stubbed or testnet), resolution pending + confirm, POST `/orders`, trade fill append, orderbook snapshot. For each path, list expected **object path**, **format**, and optionally **checksum or size** bounds.
- [ ] **Parquet mirror**: with `pyarrow` installed in the integration environment, confirm `trades/{marketId}/fills.parquet` exists and is readable (column set matches fill rows).
- [ ] **Idempotent / concurrent writers** (if you ever run multiple workers): two appends to `fills.json` without lost updates (today’s read-modify-write pattern is race-prone under concurrency—worth a dedicated test if you scale workers).

Add more bullets here as you think of them.

---

## What the code is designed to store in GCS (by path)

These paths come straight from `app/main.py`, `app/orderbook.py`, `app/event_listener.py`, and `app/worker.py`. Layout matches the broader plan in repo docs (`PROJECT_PLAN.md`, `ORDER_LIFECYCLE.md`).

| Prefix / pattern | Format | Written by | Purpose |
|------------------|--------|------------|---------|
| `proposals/{proposalId}.json` | JSON | `main.create_proposal`, approve/reject updates | Event proposal from users; updated when admin approves/rejects and adds `onChain` |
| `resolutions/{eventId}/pending.json` | JSON | `main.create_pending_resolution` | Queued resolution packet (outcomes, hashes, extracted values, etc.) |
| `resolutions/{eventId}/scraped_page.html` | HTML (`text/html`) | `main.create_pending_resolution`, `worker.poll_event` | Raw scrape snapshot for audit |
| `resolutions/{eventId}/extracted_data.json` | JSON | `main.create_pending_resolution`, `worker.poll_event` | Parsed headline numbers from scraper |
| `resolutions/{eventId}/admin_confirmation.json` | JSON | `main.confirm_resolution` | Admin confirm/override action payload |
| `resolutions/{eventId}/resolution_results.json` | JSON | `main.confirm_resolution` | Final outcomes, `evidenceHash`, `onChain` summary |
| `orderbooks/{marketId}/live.json` | JSON | `orderbook.upsert_order` | Live off-chain order list + `updatedAtUtc` |
| `orderbooks/{marketId}/{timestamp}.json` | JSON | `event_listener.write_orderbook_snapshot` | Point-in-time snapshot (`timestamp` = UTC `strftime`) |
| `trades/{marketId}/fills.json` | JSON (document with `fills` array) | `event_listener.append_trade_fill` | Append-only trade tape |
| `trades/{marketId}/fills.parquet` | Parquet | `event_listener.append_trade_fill` (best-effort) | Same rows as JSON fills, analytics-friendly |

**Not implemented in this backend package yet** (mentioned in `PROJECT_PLAN.md` but no matching `store.*` in `packages/backend/app/` today): e.g. `events/{eventId}/metadata.json`, `markets/{marketId}/metadata.json`. If you add them, extend the table here.

---

## Current automated tests (pytest) — what they actually touch

Run from repo root: `yarn backend:test` or `cd packages/backend && python3 -m pytest tests/ -q`. Use `-vv -s` if you want stdout prints.

Per-file commands and the **relay integration script** are listed in [`tests/README.md`](tests/README.md).

| File | Focus |
|------|--------|
| `tests/test_main_health_proposals.py` | `/health`; proposal create/get; approve/reject (with mocked `create_event_and_markets`); HTTP validation (`422`); chain error mapping (`400`/`503`); in-memory store only |
| `tests/test_resolution_pipeline.py` | **Not run by default** (ignored in `pyproject.toml`). Covers pending/confirm resolution API and evidence hash — re-enable when policy allows. Proposal approve/reject smoke in that file is duplicated in `test_main_health_proposals.py`. |
| `tests/test_relayer_api.py` | `relay_forward` handler maps `RelayResult` → response model |
| `tests/test_relayer_unit.py` | `_selector`, allowlist, missing env, mock Web3 verify/execute, revert + exception reason mapping, exchange + `fillOffer` selector |
| `tests/test_scraper_unit.py` | `_parse_number` / `_safe_*` / JSON helpers; `scrape_yahoo_earnings` with mocked HTTP (regex, Diluted EPS fallback, LLM override, `ScrapeError` paths); verbose prints |
| `tests/test_worker_unit.py` | `_parse_expected_utc`; `poll_event` time gate, scrape success/failure, missing EPS; storage side effects |
| `tests/test_orderbook_unit.py` | `list_orders` / `upsert_order`; replace-by-`orderId`; corrupt `live.json` edge case |
| `tests/test_event_listener_unit.py` | `append_trade_fill` tape; `write_orderbook_snapshot`; Parquet failure swallowed |
| `tests/test_scraper_live.py` | **Optional real Yahoo** — exploratory smoke only; skipped unless `RUN_LIVE_YAHOO=1` |
| `tests/test_adversarial_edges.py` | Corrupt GCS-shaped payloads, ambiguous HTML (first EPS wins), empty ticker, non-numeric EPS for worker — forces defensive behavior |
| `tests/conftest.py` | `memory_store` fixture; no GCS |

**Live Yahoo** is diagnostic, not correctness proof — see module docstring in `test_scraper_live.py`. **Adversarial** tests drove hardening in `orderbook.py`, `event_listener.py`, `worker.py`, and empty-ticker guard in `scraper.py`.

**Gaps for later:** mocked `Web3` tests for `chain.py` (`create_event_and_markets`, `submit_resolves`); `resolution.py` comparison edge cases; full `run_scheduler` loop (infinite — needs refactor or subprocess kill to test safely).

---

## How to run “does it hit the bucket?” manually

1. Configure root `.env`: `GCS_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS`, etc.
2. Run the API (`uvicorn`) and exercise endpoints, **or** run a small script that calls the same `store` helpers against `GcsStore`.
3. In Cloud Console (or `gsutil ls -r`), confirm objects under the paths in the table above.

When you automate this, add a subsection here with the command or CI job name.
