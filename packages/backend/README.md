# Agora Backend (Python)

Python services for:
- proposal storage and admin updates (GCS)
- resolution worker (Yahoo Finance scrape + FMP fallback)
- gas relayer (meta-tx) and resolver wallet (`resolve()`)
- orderbook/trade event archiving

## Quick start

```bash
cd packages/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

## Environment

Set these in the repository root `.env`:

- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
- `GCS_BUCKET=agora-market-data`
- `ARC_TESTNET_RPC_URL=https://arc-testnet.g.alchemy.com/v2/...` (or `RPC_URL` for the same network)
- `RELAYER_PRIVATE_KEY=0x...` (gas-only; **must not** equal `RESOLVER_PRIVATE_KEY` — see root `PROJECT_PLAN.md`, Backend hot wallets)
- `RESOLVER_PRIVATE_KEY=0x...` (on-chain resolver; proposal approve / `resolve()` path)
- `MANAGER_ADDRESS=0x...`
- `EXCHANGE_ADDRESS=0x...`
- `FMP_API_KEY=...`
- `OPENAI_API_KEY=...` (optional; enables LLM-assisted Yahoo HTML extraction)
- `OPENAI_MODEL=gpt-4o-mini`

## Yahoo + LLM parsing

The scraper fetches:
- `https://finance.yahoo.com/quote/<TICKER>/financials/`

If `OPENAI_API_KEY` is present, the backend asks the LLM to extract structured values from raw HTML and then applies deterministic threshold comparison in the resolution step. If LLM extraction fails or the key is unset, regex parsing fallback is used.

