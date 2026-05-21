# Agora — Demo Script
## Circle Arc Testnet | Prediction Markets for Institutional Alternative Data

---

## PRE-DEMO SETUP (do this 30 min before presenting)

### Step 1 — Fund the deployer + test wallets with USDC

1. Open <https://faucet.circle.com> and request testnet USDC for each of the
   six `TEST_WALLET_*_ADDRESS` entries plus the deployer.
2. USDC also pays gas on Arc, so this single faucet step covers both
   collateral and transaction fees.

### Step 2 — Confirm `.env` has the six TEST_WALLET keys

The seed script needs private keys for all six test wallets:

```
TEST_WALLET_1_PRIVATE_KEY=0x...
TEST_WALLET_2_PRIVATE_KEY=0x...
TEST_WALLET_3_PRIVATE_KEY=0x...
TEST_WALLET_4_PRIVATE_KEY=0x...
TEST_WALLET_5_PRIVATE_KEY=0x...
TEST_WALLET_6_PRIVATE_KEY=0x...
```

### Step 3 — Seed demo volume on Arc testnet

```bash
yarn workspace @se-2/hardhat hardhat run scripts/seedDemoVolume.ts --network arcTestnet
```

This takes ~60 seconds and creates real on-chain orders across the six
showcase markets. Deployer + helper wallet must already hold enough USDC
(the script asserts ≥ 5,000 USDC for deployer and ≥ 1,000 for the helper).

### Step 4 — Start the app

```bash
# Terminal 1 — Frontend
yarn agora:dev

# Terminal 2 — Backend (for off-chain order book + relay)
cd packages/backend && source .venv/bin/activate && uvicorn app.main:app --port 8001 --reload
```

### Step 5 — MetaMask setup for your demo wallet

- Add Circle Arc Testnet (Chain ID **5042002**, RPC = your `ARC_TESTNET_RPC_URL`)
- Fund the demo wallet with testnet USDC from <https://faucet.circle.com>
  (USDC is the gas token on Arc, so no separate gas funding step)

---

## DEMO FLOW (~8 minutes)

### SCENE 1 — The Problem & Platform (1 min)

*Open the landing page at `localhost:3000`.*

> "Hedge funds and institutional investors spend millions trying to understand
> what the market believes about upcoming events — earnings, Fed decisions,
> macro data. Agora is a decentralized prediction market that turns crowd
> wisdom into structured alternative data, live on Circle Arc testnet.
> Every single trade is on-chain. Every probability you see here is real
> market signal, not an estimate."

*Scroll through the landing page — hero → market preview → features → how it works.*

---

### SCENE 2 — The Markets Dashboard (1.5 min)

*Click "Start Trading" → Markets.*

> "30 curated prediction markets across macro, earnings, crypto, and tech.
> All created on-chain. Each one has a resolution date and covers the biggest
> questions markets are asking right now."

*Demo points:*
- Filter by category — click "Crypto", then "Earnings", then "All"
- Point out resolve dates
- Click "Load more"
- Search for "Apple"
- Highlight the emoji/category system

---

### SCENE 3 — Live Trading (2.5 min)

*Click the Fed rate cut market (#87) → opens `/trade?marketId=87`.*

> "Trading interface. The question is: will the Fed cut rates before
> September 2026? The order book on the right shows real on-chain offers,
> placed by actual wallets."

*Connect MetaMask.*

**If first time connecting (setup panel shows):**

> "Before trading, I give the contracts permission to use my USDC — a
> standard ERC-20 approval. One-time, both Manager + Exchange."

*Click both Approve buttons.*

**After approvals:**

> "Now let's take a position. I think the Fed will cut, so I'm buying YES."

1. In Portfolio, type `5` in the USDC amount box.
2. Click **Split** → confirm in MetaMask.
   > "Split converts 5 USDC into 5 YES + 5 NO. Collateral locked on-chain."
3. Order form → **Sell** tab, **YES** outcome, price `6500`, size `5`.
4. Click **Sell YES** → confirm.
   > "Posting a limit offer: 5 YES at 65 cents. The offer lives in the
   > on-chain exchange contract."
5. Show the order appearing in the order book.
6. Click the explorer link in the toast.
   > "Here's the transaction on the Arc testnet explorer — anyone can
   > verify it."

---

### SCENE 4 — Analytics Dashboard (1.5 min)

*Waffle nav → Analytics → login: `company` / `company`.*

> "Institutional analytics layer. Gated with a company login."

1. **Overview charts:**
   > "Average YES probability by category — instantly see where crowds are
   > bullish or bearish."
2. **Sentiment spectrum:**
   > "Full YES/NO sentiment split. 72% YES on an Apple earnings beat is a
   > signal a hedge fund can incorporate."
3. **Single-market drill-down** (e.g., Fed market #87):
   > "Implied-probability gauge, order distribution, plain-English synopsis."
4. **News panel:**
   > "Related financial headlines pulled in real time."

---

### SCENE 5 — Propose a Market (45 sec)

*Waffle nav → Propose. Submit a quick proposal.*

> "Anyone can propose a market. Goes to admin review before it hits the chain."

---

### SCENE 6 — Admin Panel (45 sec)

*Waffle nav → Admin → login: `username` / `password`.*

> "Admin handles proposal review + on-chain resolution. When the real Fed
> decision lands, the admin resolves the market YES or NO and winning
> shares become redeemable for USDC."

---

### SCENE 7 — Wrap-Up (30 sec)

> "Recap:
> - 30 prediction markets on Circle Arc testnet
> - Fully on-chain order book — every trade verifiable on the Arc explorer
> - Institutional analytics with sentiment + live news
> - Open proposal flow with admin governance
> - Alternative data hedge funds can actually use"

---

## QUICK REFERENCE

| Page | URL | Credentials |
|------|-----|-------------|
| Landing | `/` | — |
| Markets | `/markets` | — |
| Trade | `/trade?marketId=87` | Wallet + USDC |
| Analytics | `/analytics` | company / company |
| Propose | `/propose` | Wallet (optional) |
| Admin | `/admin` | username / password |

**Key contracts (Arc Testnet, Chain 5042002):** check `.env` for the latest
`MANAGER_ADDRESS`, `EXCHANGE_ADDRESS`, `FORWARDER_ADDRESS`,
`FACTORY_ADDRESS`. Collateral is canonical Circle USDC at
`0x3600000000000000000000000000000000000000`.

---

## IF SOMETHING GOES WRONG

| Problem | Fix |
|---------|-----|
| Wallet won't connect | Make sure MetaMask is on Arc Testnet (Chain 5042002) |
| "Wrong network" alert | Click "Switch network" in the alert bar |
| Split fails | Check the approvals banner — both approvals needed first |
| Order book empty | Re-run `seedDemoVolume.ts --network arcTestnet` |
| Backend unreachable | Start backend: `uvicorn app.main:app --port 8001` |
| Analytics login fails | Use exactly: `company` / `company` |
| Admin login fails | Use exactly: `username` / `password` |
| "Need 100 USDC" preflight | Re-fund the wallet from <https://faucet.circle.com> |
