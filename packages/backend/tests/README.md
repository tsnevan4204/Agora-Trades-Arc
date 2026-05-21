# Backend tests — how to run

From **`packages/backend`** (so `pytest` picks up `pyproject.toml`):

```bash
cd packages/backend
```

## Whole suite (default)

```bash
python3 -m pytest tests/ -q
```

Verbose + print output:

```bash
python3 -m pytest tests/ -vv -s
```

Note: `tests/test_resolution_pipeline.py` is **ignored** by default (see `pyproject.toml`). To run it manually:

```bash
python3 -m pytest tests/test_resolution_pipeline.py -vv -s
```

## One file at a time

```bash
python3 -m pytest tests/test_main_health_proposals.py -vv -s
python3 -m pytest tests/test_relayer_api.py -vv -s
python3 -m pytest tests/test_relayer_unit.py -vv -s
python3 -m pytest tests/test_scraper_unit.py -vv -s
python3 -m pytest tests/test_scraper_live.py -vv -s          # needs RUN_LIVE_YAHOO=1
python3 -m pytest tests/test_worker_unit.py -vv -s
python3 -m pytest tests/test_orderbook_unit.py -vv -s
python3 -m pytest tests/test_event_listener_unit.py -vv -s
python3 -m pytest tests/test_adversarial_edges.py -vv -s
```

## Live Yahoo (optional)

```bash
RUN_LIVE_YAHOO=1 python3 -m pytest tests/test_scraper_live.py -vv -s
```

## From repo root (yarn)

```bash
yarn backend:test
```

That runs `cd packages/backend && python3 -m pytest tests/ -q` (no `-s`).

---

## Relay integration script (real backend + testnet)

Requires **uvicorn** running with relayer env set, plus RPC, addresses, `TEST_WALLET_1_PRIVATE_KEY`, USDT approval, etc. (see script header).

From **repository root**:

```bash
PYTHONPATH=packages/backend python3 packages/backend/scripts/run_relay_integration.py
```

Or from **`packages/backend`**:

```bash
PYTHONPATH=. python3 scripts/run_relay_integration.py
```

Optional: `BACKEND_URL=http://127.0.0.1:8001` if your API is not on port 8000.
