/**
 * Creates curated finance/tech/economics prediction markets.
 * Run on Arc testnet:  npx hardhat run scripts/createFinanceMarkets.ts --network arcTestnet
 */
import * as dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../../../.env') })
dotenv.config({ path: resolve(__dirname, '../.env') })

import { ethers, deployments } from 'hardhat'
const FACTORY_ABI = [
  'function createEvent(string title, string category, uint256 closeTime) returns (uint256)',
  'function createMarket(uint256 eventId, string question, bytes32 resolutionSpecHash, string resolutionSpecURI) returns (uint256)',
  'function nextMarketId() view returns (uint256)',
  'function nextEventId() view returns (uint256)',
]

// Close time: 1 year from now
const ONE_YEAR = 365 * 24 * 60 * 60

const EVENTS_AND_MARKETS = [
  {
    title: 'Federal Reserve & US Macro 2026',
    category: 'macro',
    markets: [
      {
        question: 'Will the Federal Reserve cut interest rates at least once before September 2026?',
        spec: '{"source":"federalreserve.gov","metric":"fed_funds_rate","condition":"cut_before_sep_2026"}',
      },
      {
        question: 'Will US CPI inflation fall below 2.5% year-over-year by Q3 2026?',
        spec: '{"source":"bls.gov","metric":"cpi_yoy","threshold":"2.5","period":"Q3_2026"}',
      },
      {
        question: 'Will US GDP growth exceed 2.0% annualized in Q1 2026?',
        spec: '{"source":"bea.gov","metric":"real_gdp_growth_annualized","threshold":"2.0","period":"Q1_2026"}',
      },
      {
        question: 'Will the S&P 500 close above 6,000 by end of Q2 2026?',
        spec: '{"source":"sp500","metric":"closing_price","threshold":"6000","date":"2026-06-30"}',
      },
    ],
  },
  {
    title: 'Tech Earnings & Corporate Performance 2026',
    category: 'earnings',
    markets: [
      {
        question: 'Will Apple (AAPL) report diluted EPS above $1.85 for Q3 FY2026?',
        spec: '{"ticker":"AAPL","metric":"diluted_eps","threshold":"1.85","period":"Q3_FY2026"}',
      },
      {
        question: 'Will NVIDIA report Q2 FY2027 revenue exceeding $45 billion?',
        spec: '{"ticker":"NVDA","metric":"revenue_usd","threshold":"45000000000","period":"Q2_FY2027"}',
      },
      {
        question: 'Will Tesla deliver more than 450,000 vehicles in Q2 2026?',
        spec: '{"ticker":"TSLA","metric":"vehicle_deliveries","threshold":"450000","period":"Q2_2026"}',
      },
      {
        question: 'Will Amazon AWS revenue exceed $30 billion in Q2 2026?',
        spec: '{"ticker":"AMZN","segment":"AWS","metric":"revenue_usd","threshold":"30000000000","period":"Q2_2026"}',
      },
    ],
  },
  {
    title: 'Crypto & Digital Assets 2026',
    category: 'crypto',
    markets: [
      {
        question: 'Will Bitcoin (BTC) exceed $120,000 USD at any point in Q3 2026?',
        spec: '{"asset":"BTC","metric":"spot_price_usd","threshold":"120000","condition":"any_close_q3_2026"}',
      },
      {
        question: 'Will Ethereum (ETH) exceed $5,000 USD by end of Q2 2026?',
        spec: '{"asset":"ETH","metric":"spot_price_usd","threshold":"5000","date":"2026-06-30"}',
      },
    ],
  },
  {
    title: 'AI & Technology Milestones 2026',
    category: 'tech',
    markets: [
      {
        question: 'Will Microsoft Azure revenue grow more than 20% year-over-year in Q3 2026?',
        spec: '{"ticker":"MSFT","segment":"Azure","metric":"yoy_revenue_growth","threshold":"0.20","period":"Q3_2026"}',
      },
      {
        question: 'Will Alphabet (GOOGL) report Search ad revenue above $55 billion in Q2 2026?',
        spec: '{"ticker":"GOOGL","segment":"search_advertising","metric":"revenue_usd","threshold":"55000000000","period":"Q2_2026"}',
      },
      {
        question: 'Will Meta Platforms report daily active users above 3.5 billion in Q2 2026?',
        spec: '{"ticker":"META","metric":"daily_active_people","threshold":"3500000000","period":"Q2_2026"}',
      },
      {
        question: 'Will Salesforce (CRM) report operating margin above 20% for Q2 FY2027?',
        spec: '{"ticker":"CRM","metric":"operating_margin","threshold":"0.20","period":"Q2_FY2027"}',
      },
    ],
  },
]

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY?.trim()
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY not set')

  const provider = ethers.provider
  const deployer = new ethers.Wallet(pk.startsWith('0x') ? pk : `0x${pk}`, provider)

  // Resolve factory address: env var first, then hardhat-deploy artifact
  const factoryAddress = process.env.FACTORY_ADDRESS?.trim() ||
    (await deployments.get('MarketFactory')).address
  if (!factoryAddress) throw new Error('Could not resolve MarketFactory address')

  const { name: networkName } = await provider.getNetwork()
  console.log(`\n🌐 Network: ${networkName}`)
  console.log(`👤 Deployer: ${deployer.address}`)
  const balance = await provider.getBalance(deployer.address)
  console.log(`💰 Balance: ${ethers.formatEther(balance)} (native gas token)\n`)

  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer)
  const startMarketId = Number(await factory.nextMarketId())
  const startEventId = Number(await factory.nextEventId())
  console.log(`📊 Current nextMarketId: ${startMarketId}, nextEventId: ${startEventId}\n`)

  const closeTime = Math.floor(Date.now() / 1000) + ONE_YEAR
  const createdMarketIds: number[] = []

  for (const event of EVENTS_AND_MARKETS) {
    console.log(`\n📅 Creating event: "${event.title}"`)
    const eventTx = await factory.createEvent(event.title, event.category, closeTime)
    const eventReceipt = await eventTx.wait()
    const eventId = Number(await factory.nextEventId()) - 1
    console.log(`   ✅ Event #${eventId} created | tx: ${eventReceipt.hash}`)

    for (const market of event.markets) {
      const specHash = ethers.keccak256(ethers.toUtf8Bytes(market.spec))
      const specURI = `ipfs://agora/markets/${specHash.slice(2, 18)}`
      console.log(`   📌 Creating market: "${market.question.slice(0, 60)}..."`)
      const marketTx = await factory.createMarket(eventId, market.question, specHash, specURI)
      const marketReceipt = await marketTx.wait()
      const marketId = Number(await factory.nextMarketId()) - 1
      createdMarketIds.push(marketId)
      console.log(`      ✅ Market #${marketId} created | tx: ${marketReceipt.hash}`)
    }
  }

  const endBalance = await provider.getBalance(deployer.address)
  console.log(`\n✅ Done! Created ${createdMarketIds.length} markets`)
  console.log(`📋 Market IDs: [${createdMarketIds.join(', ')}]`)
  console.log(`💰 Remaining balance: ${ethers.formatEther(endBalance)}`)
  console.log(`\n📝 Add these IDs to packages/AgoraFrontEnd/lib/curated-markets.ts`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
