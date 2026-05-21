# TESTING.md

Practical runbook for validating the Arc-testnet-only architecture.

## Scope

- Smart contracts on Circle Arc testnet (`arcTestnet`, chain ID 5042002)
- Gas sponsorship flow via `AgoraForwarder` + Python relayer endpoint
- Backend pipeline tests (API + resolution + storage wiring)
- Multi-wallet integration on Arc (up to 6 wallets)

---

## 0) Prerequisites

- Root `.env` populated from `env.example`
- Arc testnet RPC configured: `ARC_TESTNET_RPC_URL=...`
- Deployer and every `TEST_WALLET_*` address pre-funded with testnet USDC from
  <https://faucet.circle.com>. USDC pays gas on Arc, so this also covers
  transaction fees.
- Python virtualenv created for the backend.

Install deps:

```bash
yarn install
cd packages/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

---

## 1) Deploy contracts + sync ABIs

Run from the repo root:

```bash
yarn compile
yarn deploy:arc-testnet
```

`deploy:arc-testnet` runs the full deploy + `sync-frontend` / `sync-backend`
hardhat-deploy tags, so:
- Deploy logs print for `AgoraForwarder`, `MarketFactory`, `OutcomeToken1155`,
  `PredictionMarketManager`, `Exchange`. **No MockUSDT/MockUSDC is deployed** —
  the protocol uses canonical Circle USDC at `0x3600…0000`.
- `packages/AgoraFrontEnd/contracts/deployedContracts.ts` is regenerated.
- `packages/backend/app/contracts/manifest.json` is regenerated.

Copy the new addresses into `.env`:

- `MANAGER_ADDRESS`
- `EXCHANGE_ADDRESS`
- `FORWARDER_ADDRESS`
- `FACTORY_ADDRESS`

`USDC_ADDRESS` can stay blank — defaults to Circle USDC on Arc.

---

## 2) Prepare test wallets (max 6)

Populate in `.env`:

- `TEST_WALLET_1_ADDRESS` … `TEST_WALLET_6_ADDRESS`
- `TEST_WALLET_1_PRIVATE_KEY` … `TEST_WALLET_6_PRIVATE_KEY`

Then fund each address with **≥ 100 USDC** from <https://faucet.circle.com>.
There is no mock-mint path; if a wallet is under-funded, the
`00-fund-six-wallets` preflight test will fail with a list of addresses to
top up.

---

## 3) Backend unit/integration tests (pytest)

```bash
yarn backend:test
```

Verbose stdout:

```bash
cd packages/backend
python3 -m pytest tests/ -vv -s
```

Run a single test by node id:

```bash
cd packages/backend
python3 -m pytest tests/test_main_health_proposals.py::test_health_returns_ok -vv -s
```

Collect-only (list names):

```bash
cd packages/backend
python3 -m pytest tests/ --collect-only -q
```

These tests mock scraper/chain interactions for deterministic coverage —
real Yahoo/GCS checks happen in the live integration steps below.

---

## 4) Gas sponsorship integration (Arc testnet)

The canonical path: Python signs the same EIP-712 `ForwardRequest` as
production and calls `POST /relay/forward` on the FastAPI backend (relayer
wallet pays gas).

1. Start the backend with relay env set (`RELAYER_PRIVATE_KEY`,
   `FORWARDER_ADDRESS`, `RPC_URL`/`ARC_TESTNET_RPC_URL`, `MANAGER_ADDRESS`,
   `EXCHANGE_ADDRESS`). Use a **different** key for `RESOLVER_PRIVATE_KEY`
   when testing resolution (see `PROJECT_PLAN.md` — Backend hot wallets).
2. From the repo root:

```bash
yarn hardhat:integration:gas-sponsored
```

What it does:
- Builds calldata for `split(marketId, amount)` and an OpenZeppelin
  `ForwardRequest` typed-data payload.
- Signs as `TEST_WALLET_1_PRIVATE_KEY`.
- POSTs to `BACKEND_URL` (default `http://127.0.0.1:8000`).

Expected: HTTP 200 with `{ "ok": true, "txHash": "0x..." }`.

If it fails, verify:
- `FORWARDER_ADDRESS`, `MANAGER_ADDRESS`, `RELAYER_PRIVATE_KEY`,
  `TEST_WALLET_1_PRIVATE_KEY`, `ARC_TESTNET_RPC_URL`
- Backend reachable at `BACKEND_URL`
- The user has approved USDC to the manager before `split` (the six-wallet
  flow below establishes approvals).

---

## 5) Six-wallet testnet scenario (Hardhat + Mocha)

Run (requires `.env` with Arc testnet RPC, deployed addresses, and the six
`TEST_WALLET_*` entries):

```bash
yarn hardhat:test:arc-testnet
```

What it runs:
- `00-fund-six-wallets`: balance preflight — fails fast if any wallet has
  less than 100 USDC (no mint path; fund from the Circle faucet).
- `six-wallet-stress`: approvals, micro-splits, multi-taker fills,
  SELL_NO, self-fill revert, merge, dust-quote revert, round-robin fills.
- `finance-markets-e2e`: split / post / fill / merge against the curated
  finance markets (IDs 87–100).

---

## 6) Combined testnet integration command

Runs both live testnet scripts (requires the backend to be running for the
relay step):

```bash
yarn hardhat:test:testnet
```

Runs:
1. Gas-sponsored flow (Python → `POST /relay/forward`).
2. `yarn hardhat:test:arc-testnet` (full Arc testnet Mocha suite).

---

## 7) Backend live checks (non-mocked)

Start the backend:

```bash
cd packages/backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8001
```

Sanity check:

```bash
curl http://127.0.0.1:8001/health
```

For the resolution path:
- Call `/resolution/pending/{eventId}` with a real ticker/spec payload.
- Verify objects written under GCS:
  - `resolutions/{eventId}/pending.json`
  - `resolutions/{eventId}/scraped_page.html`
  - `resolutions/{eventId}/extracted_data.json`

Then call `/resolution/confirm/{eventId}` and verify:
- `resolutions/{eventId}/admin_confirmation.json`
- `resolutions/{eventId}/resolution_results.json` (includes `onChain` with
  tx records when `RESOLVER_PRIVATE_KEY` + `MANAGER_ADDRESS` +
  `ARC_TESTNET_RPC_URL` are set)

**Evidence hash:** `evidenceHash = keccak256(utf8(canonical_json))` with
sorted keys (see `packages/backend/app/resolution.py`). Re-fetch stored
fields from GCS and use `verify_evidence_hash(...)` to confirm they match
the hash passed to `resolve()` and the `MarketResolved` log.

---

## 8) Tuning intervals for integration testing

In `.env`:

- `SCHEDULER_POLL_INTERVAL_SECONDS`
- `EVENT_LISTENER_POLL_INTERVAL_SECONDS`
- `GCS_BATCH_INTERVAL_SECONDS`

Suggested aggressive test settings:

```env
SCHEDULER_POLL_INTERVAL_SECONDS=10
EVENT_LISTENER_POLL_INTERVAL_SECONDS=5
GCS_BATCH_INTERVAL_SECONDS=15
```

---

## 9) Common failure checklist

- Missing env var values (`ARC_TESTNET_RPC_URL`, addresses, keys)
- Wallets not funded with testnet USDC (USDC also pays gas on Arc)
- USDC approvals not done before sponsored `split`
- Wrong network selected in the frontend wallet
- Stale addresses from a previous deployment

---

## 10) Current limitations (known)

- Full end-to-end auto-resolution on live earnings data still depends on
  operator timing (market close, resolver key funding, Yahoo availability).
- Frontend E2E is intentionally deferred until contract/backend confidence
  is high.
