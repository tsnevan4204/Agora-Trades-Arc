# BNB Chain Hackathon — Project Vision

**Working title:** Agora (or your chosen product name)  
**Track:** DeFi and Financial Tools  
**One-liner:** A finance-focused prediction market on BNB Smart Chain that surfaces crowd-implied probabilities and aggregated sentiment as an alternative dataset for traders and institutions.

---

## 1. Competition context

### Category: DeFi and Financial Tools

Practical financial infrastructure for real users. DeFi is early; tokenized and always-on markets can improve price discovery and efficiency. The hackathon encourages tools that help users and traders interact with those markets: yield dashboards, cross-chain liquidity, risk scoring, stablecoin flows, and similar.

### Judging criteria (weights)

| Criterion | Weight | What judges look for |
|-----------|--------|----------------------|
| Technical execution | 30% | It works; on-chain logic is real, not cosmetic. |
| Originality | 25% | A fresh angle on a real problem. |
| Real-world relevance | 25% | Clear user and a plausible adoption path. |
| Demo and presentation | 10% | Video/demo explains the product clearly. |
| Builder profile | 10% | Team conviction and execution. |

### Submission requirements (must satisfy)

- **On-chain proof:** Contract address or transaction hash on **BSC** (BNB Chain).
- **Reproducibility:** Public demo and/or video, repo, or step-by-step reproduction instructions.
- **No token launches during the event:** No fundraising, liquidity “opening,” or airdrop-driven pumping until results are announced — violations can disqualify the submission.
- **AI:** Encouraged but optional; not using AI does not affect eligibility.

---

## 2. The problem

- **Retail and pros** lack a single venue focused on **finance, tech, and macro** outcomes (as opposed to sports and culture-heavy markets elsewhere).
- **Hedge funds and analysts** want **probabilistic crowd views** and **alternative data** tied to events that move stocks, sectors, and narratives — not only post-hoc headlines.
- **Information aggregation:** Prediction markets encode beliefs in prices; that signal is valuable when separated from noise and presented for decision support.

---

## 3. The solution (high level)

Build a **prediction market exchange on BNB Chain** where:

1. **Markets resolve around finance / tech / economy questions** (e.g., product launches, earnings beats, policy or sector outcomes — always within your legal and platform guardrails).
2. **Prices imply probabilities**, giving participants and institutions a **live, tradeable view** of “what the crowd thinks.”
3. **Optional pipeline:** Social/signals (e.g., Twitter/X) plus an **LLM (e.g., Ollama)** help **discover themes** and **suggest timely market ideas** — not a replacement for human curation at MVP.
4. **APIs / dashboards** expose **aggregates** (volume, open interest, probability paths, maybe sentiment buckets) as an **alternative dataset** for funds that care about narrative and event risk.
5. **Later:** **User-proposed markets** with **moderation, deduplication, and audit** so quality stays high and spam duplicates are blocked.

**Why institutions might care (narrative for pitch, not a promise of regulated product):**

- Event contracts can be **high-beta** expressions of a thesis vs. a single stock move; the pitch is “another way to express conviction with clear payoff structure,” subject to jurisdiction and compliance.
- **Aggregated market + metadata** becomes a **dataset** for research, risk, and narrative monitoring alongside traditional feeds.

---

## 4. Example use cases

| Actor | Example |
|-------|---------|
| Retail trader | Trade “Will Company X announce Product Y by date Z?” — price ≈ implied probability. |
| Fund / analyst | Monitor probability drift into earnings, launches, or macro events; export time series via API. |
| Platform | Surface “trending finance topics” from public discourse → candidate markets (human-approved). |

---

## 5. Phased build plan (incremental)

Work in **small, shippable slices**. Order can shift; this is the intended arc.

### Foundation tutorial (basic prediction market structure)

This repo’s starting point is the **[Speedrun Ethereum — Prediction Markets](https://speedrunethereum.com/challenge/prediction-markets)** challenge: a checkpoint-based Scaffold-ETH 2 extension that implements a binary AMM prediction market (outcome tokens, liquidity, oracle reporting, buy/sell/redeem). Follow that tutorial here to lock in the core on-chain and UI structure; the phases below extend it for **BSC**, collateral choices, and the Agora product story.

### Phase 1 — Core prediction market (MVP)

- Deploy **real smart contracts on BSC**: market creation (or admin-created markets), collateral (e.g., stablecoin), mint/burn of outcome shares, resolution rules, and **at least one end-to-end trade path** verifiable on-chain.
- Minimal **frontend**: connect wallet, view markets, buy/sell, see implied odds.
- **Deliverable for judging:** Live **contract address / tx hashes** + reproducible demo.

### Phase 2 — Finance-only positioning

- Curate **categories and copy** so the product is clearly **finance / tech / econ**, not generic sports betting.
- Seed markets that tell a **hedge-fund-relevant story** in the demo.

### Phase 3 — Twitter/X signal → market ideas (Ollama)

- Ingest **public posts** (rate limits, ToS, and API rules apply — document what you actually use).
- Use **Ollama** (or similar local/API LLM) to **cluster topics**, **extract candidate questions**, and **score timeliness**.
- **Human-in-the-loop:** Auto-suggestions only; **approval** before any market goes live.

### Phase 4 — Integration

- Wire approved suggestions into **market creation** flow (permissions and caps in the contract or via admin).
- Ensure **trading** remains the same user path for all approved markets.

### Phase 5 — Analytics for “pro” users

- **Aggregation endpoints:** e.g., volume, OI, probability history, top movers, category breakdowns.
- Simple **insights UI** or docs for “how to read this as a signal” (honest about limits: not investment advice, not oracle truth).

### Phase 6 — User-submitted markets (higher complexity; can be stretch)

- **Submission flow** + **moderation queue** (manual or semi-automated).
- **Deduplication** (semantic similarity via embeddings + rules).
- **Guardrails:** banned topics, clarity checks, resolution source defined up front.

---

## 6. Technical notes (for the repo)

- **Ops keys:** The **gas relayer** hot wallet (EIP-2771 sponsorship) and the on-chain **resolver** wallet (`resolve()`) are **different keys** by design — see `PROJECT_PLAN.md` (**Backend hot wallets**). Do not merge them in production.
- **Core market tutorial:** [Speedrun Ethereum — Prediction Markets](https://speedrunethereum.com/challenge/prediction-markets) (checkpoint walkthrough used as the base structure; see §5 Foundation tutorial).
- **Chain:** BNB Smart Chain (BSC); keep **addresses and deployment scripts** in-repo.
- **Repro:** `README` or `docs/SETUP.md` with env vars, contract deploy commands, and how to run the app locally or hit the deployed demo.
- **Compliance:** Avoid implying regulated investment advice; respect X/Twitter and data policies; no token sale mechanics during the hackathon window.

---

## 7. Demo checklist (aligns with criteria)

- [ ] Show **wallet → trade → on-chain tx** on BSC.
- [ ] Explain **one novel angle** (finance-focused PM + optional signal → market pipeline).
- [ ] Name **who it’s for** (traders, researchers, funds) and **next step** after hackathon (API, curation, partnerships).
- [ ] Keep the video **under the time limit** and **walk through repo + live app** if possible.

---

## 8. Glossary (quick)

- **Prediction market:** Tradeable claims that pay out if an outcome occurs; pre-resolution prices often interpreted as **crowd-implied probability**.
- **Alternative data:** Non-traditional inputs (here: structured market stats + optional discourse signals) for research and risk.
- **On-chain proof:** Judges can verify your logic via **BscScan** (contracts and transactions).

---

*This document is the single source of truth for hackathon scope and story; update it as the product name, architecture, and milestones solidify.*
