/**
 * Creates 16 more curated finance markets based on current news (April 2026).
 * Run on Arc testnet:  npx hardhat run scripts/createMoreFinanceMarkets.ts --network arcTestnet
 */
import * as dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../../../.env') })

import { ethers, deployments } from 'hardhat'
const FACTORY_ABI = [
  'function createEvent(string title, string category, uint256 closeTime) returns (uint256)',
  'function createMarket(uint256 eventId, string question, bytes32 resolutionSpecHash, string resolutionSpecURI) returns (uint256)',
  'function nextMarketId() view returns (uint256)',
  'function nextEventId() view returns (uint256)',
]

const SIX_MONTHS = 180 * 24 * 60 * 60
const NINE_MONTHS = 270 * 24 * 60 * 60

const EVENTS_AND_MARKETS = [
  {
    title: 'US Economic Policy & Macro H2 2026',
    category: 'macro',
    offsetSecs: NINE_MONTHS,
    markets: [
      {
        question: 'Will the US 10-year Treasury yield exceed 5.0% at any point in Q3 2026?',
        spec: '{"source":"treasury.gov","metric":"10yr_yield","threshold":"5.0","period":"Q3_2026"}',
      },
      {
        question: 'Will US unemployment rate rise above 5.0% by Q3 2026?',
        spec: '{"source":"bls.gov","metric":"unemployment_rate","threshold":"5.0","period":"Q3_2026"}',
      },
      {
        question: 'Will WTI crude oil close above $85 per barrel by end of Q2 2026?',
        spec: '{"source":"eia.gov","asset":"WTI_crude","metric":"closing_price","threshold":"85","date":"2026-06-30"}',
      },
      {
        question: 'Will the US federal budget deficit exceed $2 trillion for fiscal year 2026?',
        spec: '{"source":"cbo.gov","metric":"federal_deficit_usd","threshold":"2000000000000","period":"FY2026"}',
      },
    ],
  },
  {
    title: 'AI & Semiconductor Industry 2026',
    category: 'tech',
    offsetSecs: NINE_MONTHS,
    markets: [
      {
        question: 'Will TSMC report Q2 2026 revenue exceeding $25 billion USD?',
        spec: '{"ticker":"TSM","metric":"quarterly_revenue_usd","threshold":"25000000000","period":"Q2_2026"}',
      },
      {
        question: 'Will AMD report Q2 2026 revenue above $7 billion?',
        spec: '{"ticker":"AMD","metric":"quarterly_revenue_usd","threshold":"7000000000","period":"Q2_2026"}',
      },
      {
        question: 'Will Palantir (PLTR) report Q2 2026 revenue above $950 million?',
        spec: '{"ticker":"PLTR","metric":"quarterly_revenue_usd","threshold":"950000000","period":"Q2_2026"}',
      },
      {
        question: 'Will OpenAI publicly release a model described as GPT-5 class or above before October 2026?',
        spec: '{"source":"openai.com","event":"gpt5_class_public_release","deadline":"2026-10-01"}',
      },
    ],
  },
  {
    title: 'Media & Consumer Tech Q2 2026',
    category: 'earnings',
    offsetSecs: SIX_MONTHS,
    markets: [
      {
        question: 'Will Netflix (NFLX) report Q2 2026 revenue above $11 billion?',
        spec: '{"ticker":"NFLX","metric":"quarterly_revenue_usd","threshold":"11000000000","period":"Q2_2026"}',
      },
      {
        question: 'Will Disney+ reach 130 million paid subscribers by end of Q2 2026?',
        spec: '{"ticker":"DIS","segment":"disney_plus","metric":"paid_subscribers","threshold":"130000000","date":"2026-06-30"}',
      },
      {
        question: 'Will Spotify report monthly active users above 700 million by Q2 2026?',
        spec: '{"ticker":"SPOT","metric":"monthly_active_users","threshold":"700000000","period":"Q2_2026"}',
      },
      {
        question: 'Will Uber (UBER) report Q2 2026 gross bookings above $45 billion?',
        spec: '{"ticker":"UBER","metric":"gross_bookings_usd","threshold":"45000000000","period":"Q2_2026"}',
      },
    ],
  },
  {
    title: 'Crypto Market Structure Q3 2026',
    category: 'crypto',
    offsetSecs: NINE_MONTHS,
    markets: [
      {
        question: 'Will Solana (SOL) exceed $300 USD at any point in Q2 2026?',
        spec: '{"asset":"SOL","metric":"spot_price_usd","threshold":"300","condition":"any_close_q2_2026"}',
      },
      {
        question: 'Will total global crypto market cap exceed $4 trillion at any point in Q3 2026?',
        spec: '{"source":"coingecko.com","metric":"total_market_cap_usd","threshold":"4000000000000","period":"Q3_2026"}',
      },
      {
        question: 'Will a spot XRP ETF receive SEC approval before September 2026?',
        spec: '{"asset":"XRP","event":"spot_etf_sec_approval","deadline":"2026-09-01"}',
      },
      {
        question: 'Will Ethereum monthly staking rewards APY exceed 5% in Q3 2026?',
        spec: '{"asset":"ETH","metric":"staking_apy_pct","threshold":"5","period":"Q3_2026"}',
      },
    ],
  },
]

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY not set')

  const provider = ethers.provider
  const deployer = new ethers.Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider)

  const { name: networkName } = await provider.getNetwork()
  console.log(`\n🌐 Network: ${networkName}`)
  console.log(`👤 Deployer: ${deployer.address}`)
  const balance = await provider.getBalance(deployer.address)
  console.log(`💰 Balance: ${ethers.formatEther(balance)}`)

  const factoryAddress = process.env.FACTORY_ADDRESS?.trim() ||
    (await deployments.get('MarketFactory')).address
  if (!factoryAddress) throw new Error('Could not resolve MarketFactory address')

  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer)
  const startMarketId = Number(await factory.nextMarketId())
  console.log(`📊 Current nextMarketId: ${startMarketId}\n`)

  const now = Math.floor(Date.now() / 1000)
  const createdMarketIds: number[] = []

  for (const event of EVENTS_AND_MARKETS) {
    const closeTime = now + event.offsetSecs
    console.log(`📅 Creating event: "${event.title}"`)
    const eventTx = await factory.createEvent(event.title, event.category, closeTime)
    await eventTx.wait()
    const eventId = Number(await factory.nextEventId()) - 1
    console.log(`   ✅ Event #${eventId}`)

    for (const market of event.markets) {
      const specHash = ethers.keccak256(ethers.toUtf8Bytes(market.spec))
      const specURI = `ipfs://agora/markets/${specHash.slice(2, 18)}`
      const tx = await factory.createMarket(eventId, market.question, specHash, specURI)
      await tx.wait()
      const marketId = Number(await factory.nextMarketId()) - 1
      createdMarketIds.push(marketId)
      console.log(`   ✅ Market #${marketId}: "${market.question.slice(0, 60)}…"`)
    }
  }

  const endBalance = await provider.getBalance(deployer.address)
  console.log(`\n✅ Done! Created ${createdMarketIds.length} markets`)
  console.log(`📋 Market IDs: [${createdMarketIds.join(', ')}]`)
  console.log(`💰 Remaining: ${ethers.formatEther(endBalance)}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
