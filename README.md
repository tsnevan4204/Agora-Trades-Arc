# Agora Prediction Markets

USDC-collateralized prediction markets on **Circle Arc testnet** with:
- `MarketFactory` for event/market metadata
- `OutcomeToken1155` for YES/NO positions (`marketId * 2`, `marketId * 2 + 1`)
- `PredictionMarketManager` for split/merge/resolve/redeem
- `Exchange` for on-chain posted offers (`postOffer`/`fillOffer`/`cancelOffer`)
- `AgoraForwarder` for EIP-2771 meta-transaction support

Collateral is the canonical Circle USDC ERC-20 on Arc testnet
(`0x3600000000000000000000000000000000000000`, 6 decimals). USDC also pays
gas on Arc via the chain's dual-interface model.

## Monorepo Structure

- `packages/hardhat`: contracts, deploy scripts, Arc testnet integration tests
- `packages/AgoraFrontEnd`: Next.js marketing + trading UI (ABIs from deploy sync)
- `packages/backend`: Python backend (proposals, manual resolution, event archiving)

## Quick Start (Circle Arc testnet)

This project targets Arc testnet only — there is no local Hardhat chain wiring.

1. Install deps: `yarn install`
2. Copy `env.example` → `.env` and fill in `ARC_TESTNET_RPC_URL`, `DEPLOYER_PRIVATE_KEY`,
   `RELAYER_PRIVATE_KEY`, `RESOLVER_PRIVATE_KEY`, the `TEST_WALLET_*` entries, etc.
3. Fund the deployer and each `TEST_WALLET_*` address with testnet USDC from
   <https://faucet.circle.com>. USDC is also the gas token on Arc.
4. Deploy contracts: `yarn deploy:arc-testnet`
5. Update `.env` with the new `MANAGER_ADDRESS`, `EXCHANGE_ADDRESS`,
   `FORWARDER_ADDRESS`, `FACTORY_ADDRESS` printed by the deploy command
   (also available under `packages/hardhat/deployments/arcTestnet/`).
6. Backend: `cd packages/backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8001`
7. Frontend: `yarn agora:dev` → <http://localhost:3000>

## Environment

Configure via the repo-root `.env`. See `env.example`.

Key variables:
- `ARC_TESTNET_RPC_URL` — Circle Arc testnet JSON-RPC (chain ID **5042002**)
- `DEPLOYER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `RESOLVER_PRIVATE_KEY`
- `MANAGER_ADDRESS`, `EXCHANGE_ADDRESS`, `FORWARDER_ADDRESS`, `FACTORY_ADDRESS`
- `USDC_ADDRESS` (optional; defaults to the canonical Circle USDC at `0x3600…`)
- `NEXT_PUBLIC_ARC_TESTNET_RPC_URL`, `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`
- `NEXT_PUBLIC_BACKEND_URL`

## Testing

- `yarn backend:test` — backend pytest (unit suites, no live RPC)
- `yarn hardhat:test:arc-testnet` — full live Arc testnet Mocha suite
  (preflight balance check + six-wallet stress + finance markets E2E).
  Requires each `TEST_WALLET_*` to hold ≥ 100 testnet USDC. See [TESTING.md](TESTING.md).
- Start the backend before `yarn hardhat:integration:gas-sponsored`.

## Notes

- Legacy AMM challenge contracts and AMM UI routes have been removed.
- Current implementation is orderbook-focused.
- **`Exchange` is intentionally high-trust in this MVP** — tighter invariants are a follow-up.
