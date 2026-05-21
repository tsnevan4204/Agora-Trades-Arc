/**
 * Demo seed script — populates curated markets with realistic on-chain activity
 * on Circle Arc testnet.
 *
 * Run BEFORE your demo:
 *   yarn workspace @se-2/hardhat hardhat run scripts/seedDemoVolume.ts --network arcTestnet
 *
 * Prerequisites:
 *   - Contracts deployed on Arc testnet (`yarn deploy:arc-testnet`).
 *   - `.env` has DEPLOYER_PRIVATE_KEY and TEST_WALLET_1_PRIVATE_KEY set.
 *   - Both wallets are pre-funded with USDC from https://faucet.circle.com
 *     (USDC doubles as Arc's native gas token).
 *
 * What it does:
 *   - Approves the Manager + Exchange to spend USDC for deployer + one helper wallet.
 *   - For 6 selected markets: creates splits, cross-fills, and posts open order depth.
 *   - YES/NO pricing reflects realistic market sentiment for each question.
 */
import * as dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../../../.env') })

import { ethers, deployments } from 'hardhat'
import type { Contract as EthersContract, Wallet as EthersWallet } from 'ethers'

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000'

// Minimal ERC-20 ABI: enough to read balance/allowance + approve.
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
] as const

// Markets to seed — a spread across categories.
const DEMO_MARKET_IDS = [0, 3, 4, 8, 10, 21]

// Realistic YES implied probabilities (in basis points, 10000 = 100%).
const MARKET_YES_PRICE: Record<number, number> = {
  0:  7200,
  3:  5500,
  4:  6500,
  8:  4800,
  10: 6800,
  21: 5200,
}

function normalizeKey(pk: string): string {
  const t = pk.trim()
  return t.startsWith('0x') ? t : `0x${t}`
}

function requireEnv(k: string): string {
  const v = process.env[k]?.trim()
  if (!v) throw new Error(`Missing env: ${k}`)
  return v
}

const to6 = (s: string) => ethers.parseUnits(s, 6)

async function main() {
  const provider = ethers.provider

  const deployerPk = normalizeKey(requireEnv('DEPLOYER_PRIVATE_KEY'))
  const helperPk   = normalizeKey(requireEnv('TEST_WALLET_1_PRIVATE_KEY'))
  const deployer   = new ethers.Wallet(deployerPk, provider)
  const helper     = new ethers.Wallet(helperPk,   provider)

  const usdcAddr     = (process.env.USDC_ADDRESS?.trim() || ARC_TESTNET_USDC)
  const managerAddr  = process.env.MANAGER_ADDRESS?.trim()  || (await deployments.get('PredictionMarketManager')).address
  const exchangeAddr = process.env.EXCHANGE_ADDRESS?.trim() || (await deployments.get('Exchange')).address

  const usdc     = new ethers.Contract(usdcAddr, USDC_ABI, provider)
  const manager  = await ethers.getContractAt('PredictionMarketManager', managerAddr)
  const exchange = await ethers.getContractAt('Exchange', exchangeAddr)
  const token1155Addr = await manager.outcomeToken()
  const token1155 = await ethers.getContractAt('OutcomeToken1155', token1155Addr)

  const { name: networkName, chainId } = await provider.getNetwork()
  console.log(`\n🌐 Network: ${networkName} (chainId=${chainId})`)
  console.log(`💵 USDC:    ${usdcAddr}`)
  console.log(`👤 Deployer: ${deployer.address}`)
  const deployerUsdc = (await usdc.balanceOf(deployer.address)) as bigint
  console.log(`   USDC bal: ${ethers.formatUnits(deployerUsdc, 6)}`)
  const helperUsdc = (await usdc.balanceOf(helper.address)) as bigint
  console.log(`👤 Helper:   ${helper.address}`)
  console.log(`   USDC bal: ${ethers.formatUnits(helperUsdc, 6)}\n`)

  // ── 1. Sanity: both wallets must already hold enough USDC ─────────────────
  const DEPLOYER_MIN = to6('5000')
  const HELPER_MIN   = to6('1000')
  if (deployerUsdc < DEPLOYER_MIN) {
    throw new Error(
      `Deployer needs ≥ 5,000 USDC, has ${ethers.formatUnits(deployerUsdc, 6)}. ` +
        `Fund from https://faucet.circle.com`,
    )
  }
  if (helperUsdc < HELPER_MIN) {
    throw new Error(
      `Helper (TEST_WALLET_1) needs ≥ 1,000 USDC, has ${ethers.formatUnits(helperUsdc, 6)}. ` +
        `Fund from https://faucet.circle.com`,
    )
  }

  // ── 2. Approve Manager + Exchange for both wallets ────────────────────────
  console.log('🔑 Approving Manager + Exchange…')
  const maxUint = ethers.MaxUint256
  for (const [wallet, label] of [[deployer, 'Deployer'], [helper, 'Helper']] as const) {
    const w = wallet as EthersWallet
    const wUsdc = usdc.connect(w) as EthersContract
    const manA = (await usdc.allowance(w.address, managerAddr)) as bigint
    if (manA < maxUint / 2n) {
      await (await wUsdc.approve(managerAddr, maxUint)).wait()
    }
    const exA = (await usdc.allowance(w.address, exchangeAddr)) as bigint
    if (exA < maxUint / 2n) {
      await (await wUsdc.approve(exchangeAddr, maxUint)).wait()
    }
    console.log(`   ✅ ${label} approved`)
  }

  // ── 3. Seed each demo market ──────────────────────────────────────────────
  for (const marketId of DEMO_MARKET_IDS) {
    const yesPriceBps = MARKET_YES_PRICE[marketId] ?? 5500
    const noPriceBps  = 10000 - yesPriceBps
    const mid = BigInt(marketId)

    console.log(`\n📊 Seeding market #${marketId} — YES @ ${yesPriceBps / 100}% / NO @ ${noPriceBps / 100}%`)

    // Round A: deployer splits, posts SELL_YES, helper fills (completed trade)
    const splitA = to6('60')
    await (await (manager.connect(deployer) as typeof manager).split(mid, splitA)).wait()

    const offerIdA = await (exchange.connect(deployer) as typeof exchange)
      .postOffer.staticCall(mid, 2n /* SELL_YES */, BigInt(yesPriceBps), to6('20'))
    await (await (exchange.connect(deployer) as typeof exchange)
      .postOffer(mid, 2n, BigInt(yesPriceBps), to6('20'))).wait()

    const fillA = await (exchange.connect(helper) as typeof exchange).fillOffer(offerIdA, to6('20'))
    await fillA.wait()
    console.log(`   🔄 Completed: deployer→helper  20 YES @ ${yesPriceBps / 100}% | ${fillA.hash.slice(0, 18)}…`)

    // Round B: helper splits, posts SELL_NO, deployer fills (opposite side)
    const splitB = to6('30')
    await (await (manager.connect(helper) as typeof manager).split(mid, splitB)).wait()

    const offerIdB = await (exchange.connect(helper) as typeof exchange)
      .postOffer.staticCall(mid, 3n /* SELL_NO */, BigInt(noPriceBps), to6('15'))
    await (await (exchange.connect(helper) as typeof exchange)
      .postOffer(mid, 3n, BigInt(noPriceBps), to6('15'))).wait()

    const fillB = await (exchange.connect(deployer) as typeof exchange).fillOffer(offerIdB, to6('15'))
    await fillB.wait()
    console.log(`   🔄 Completed: helper→deployer  15 NO  @ ${noPriceBps / 100}% | ${fillB.hash.slice(0, 18)}…`)

    // Round C: post open depth on both sides (unfilled, shows live order book)
    await (await (manager.connect(deployer) as typeof manager).split(mid, to6('80'))).wait()

    await (await (exchange.connect(deployer) as typeof exchange).postOffer(mid, 0n /* BUY_YES */, BigInt(yesPriceBps - 300), to6('12'))).wait()
    await (await (exchange.connect(deployer) as typeof exchange).postOffer(mid, 0n, BigInt(yesPriceBps - 600), to6('18'))).wait()
    await (await (exchange.connect(deployer) as typeof exchange).postOffer(mid, 0n, BigInt(yesPriceBps - 1000), to6('25'))).wait()

    await (await (exchange.connect(deployer) as typeof exchange).postOffer(mid, 2n /* SELL_YES */, BigInt(yesPriceBps + 200), to6('10'))).wait()
    await (await (exchange.connect(deployer) as typeof exchange).postOffer(mid, 2n, BigInt(yesPriceBps + 500), to6('15'))).wait()

    await (await (exchange.connect(helper) as typeof exchange).postOffer(mid, 1n /* BUY_NO */, BigInt(noPriceBps - 400), to6('10'))).wait()

    console.log(`   📋 Order book depth posted — ${3} BUY_YES + ${2} SELL_YES + ${1} BUY_NO`)
  }

  const endUsdc = (await usdc.balanceOf(deployer.address)) as bigint
  console.log(`\n✅ Demo seed complete!`)
  console.log(`   Markets seeded: [${DEMO_MARKET_IDS.join(', ')}]`)
  console.log(`   Deployer remaining USDC: ${ethers.formatUnits(endUsdc, 6)}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
