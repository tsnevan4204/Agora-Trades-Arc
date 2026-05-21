/**
 * Curated finance/tech/economics markets on Circle Arc testnet (chain 5042002).
 * Market IDs 0–29 when seeded via createFinanceMarkets / createMoreFinanceMarkets on Arc.
 *
 * createFinanceMarkets.ts     → IDs 0–13
 * createMoreFinanceMarkets.ts → IDs 14–29
 */

export type CuratedMarket = {
  id: number
  category: 'Macro' | 'Earnings' | 'Crypto' | 'Tech'
  tags: string[]
  emoji: string
}

export const CURATED_MARKET_IDS: CuratedMarket[] = [
  { id: 0, category: 'Macro', tags: ['Fed', 'Interest Rates'], emoji: '🏦' },
  { id: 1, category: 'Macro', tags: ['Inflation', 'CPI'], emoji: '📈' },
  { id: 2, category: 'Macro', tags: ['GDP', 'Economy'], emoji: '🇺🇸' },
  { id: 3, category: 'Macro', tags: ['S&P 500', 'Equities'], emoji: '📊' },
  { id: 14, category: 'Macro', tags: ['Treasury', 'Yield', 'Bonds'], emoji: '🏛️' },
  { id: 15, category: 'Macro', tags: ['Jobs', 'Unemployment'], emoji: '👷' },
  { id: 16, category: 'Macro', tags: ['Oil', 'WTI', 'Energy'], emoji: '🛢️' },
  { id: 17, category: 'Macro', tags: ['Deficit', 'Fiscal Policy'], emoji: '📉' },
  { id: 4, category: 'Earnings', tags: ['AAPL', 'Apple', 'EPS'], emoji: '🍎' },
  { id: 5, category: 'Earnings', tags: ['NVDA', 'NVIDIA', 'AI'], emoji: '🎮' },
  { id: 6, category: 'Earnings', tags: ['TSLA', 'Tesla', 'EV'], emoji: '⚡' },
  { id: 7, category: 'Earnings', tags: ['AMZN', 'Amazon', 'AWS'], emoji: '☁️' },
  { id: 22, category: 'Earnings', tags: ['NFLX', 'Netflix', 'Streaming'], emoji: '🎬' },
  { id: 23, category: 'Earnings', tags: ['DIS', 'Disney+', 'Streaming'], emoji: '🏰' },
  { id: 24, category: 'Earnings', tags: ['SPOT', 'Spotify', 'Audio'], emoji: '🎵' },
  { id: 25, category: 'Earnings', tags: ['UBER', 'Rideshare', 'Mobility'], emoji: '🚗' },
  { id: 8, category: 'Crypto', tags: ['BTC', 'Bitcoin'], emoji: '₿' },
  { id: 9, category: 'Crypto', tags: ['ETH', 'Ethereum'], emoji: '🔷' },
  { id: 26, category: 'Crypto', tags: ['SOL', 'Solana'], emoji: '◎' },
  { id: 27, category: 'Crypto', tags: ['Crypto', 'Market Cap', 'Total'], emoji: '🌐' },
  { id: 28, category: 'Crypto', tags: ['XRP', 'ETF', 'SEC'], emoji: '⚖️' },
  { id: 29, category: 'Crypto', tags: ['ETH', 'Staking', 'APY'], emoji: '🔐' },
  { id: 10, category: 'Tech', tags: ['MSFT', 'Microsoft', 'Azure'], emoji: '🪟' },
  { id: 11, category: 'Tech', tags: ['GOOGL', 'Alphabet', 'Search'], emoji: '🔍' },
  { id: 12, category: 'Tech', tags: ['META', 'Meta', 'Social'], emoji: '📱' },
  { id: 13, category: 'Tech', tags: ['CRM', 'Salesforce'], emoji: '☁️' },
  { id: 18, category: 'Tech', tags: ['TSM', 'TSMC', 'Semiconductor'], emoji: '🔬' },
  { id: 19, category: 'Tech', tags: ['AMD', 'Semiconductor', 'GPU'], emoji: '💻' },
  { id: 20, category: 'Tech', tags: ['PLTR', 'Palantir', 'AI'], emoji: '🛡️' },
  { id: 21, category: 'Tech', tags: ['OpenAI', 'GPT-5', 'AI'], emoji: '🤖' },
]

export const CURATED_ID_SET = new Set(CURATED_MARKET_IDS.map((m) => m.id))

export function getCuratedMeta(id: number): CuratedMarket | undefined {
  return CURATED_MARKET_IDS.find((m) => m.id === id)
}

export const CATEGORY_COLORS: Record<CuratedMarket['category'], string> = {
  Macro: 'text-primary bg-primary/10',
  Earnings: 'text-success bg-success/10',
  Crypto: 'text-accent bg-accent/10',
  Tech: 'text-primary/70 bg-primary/5',
}
