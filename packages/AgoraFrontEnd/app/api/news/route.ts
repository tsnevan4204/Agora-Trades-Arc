import { NextResponse } from 'next/server'

export type NewsItem = {
  title: string
  link: string
  pubDate: string
  source: string
  category: string
}

// Yahoo Finance RSS feeds (no API key needed — public RSS)
const FEEDS = [
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US', category: 'Earnings' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US', category: 'Earnings' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US', category: 'Earnings' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=MSFT&region=US&lang=en-US', category: 'Tech' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=GOOGL&region=US&lang=en-US', category: 'Tech' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=META&region=US&lang=en-US', category: 'Tech' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AMZN&region=US&lang=en-US', category: 'Earnings' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US', category: 'Crypto' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=ETH-USD&region=US&lang=en-US', category: 'Crypto' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US', category: 'Macro' },
]

function parseItems(xml: string, category: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of itemMatches) {
    const block = match[1]
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? block.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
    const link = block.match(/<link>(.*?)<\/link>/)?.[1]
      ?? block.match(/<guid>(.*?)<\/guid>/)?.[1] ?? ''
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? ''
    const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? 'Yahoo Finance'
    if (title) items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim(), source, category })
  }
  return items.slice(0, 3)
}

export async function GET() {
  const results = await Promise.allSettled(
    FEEDS.map(async ({ url, category }) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgoraBot/1.0)' },
        next: { revalidate: 300 }, // cache 5 min
      })
      if (!res.ok) return []
      const xml = await res.text()
      return parseItems(xml, category)
    }),
  )

  const items: NewsItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value)
  }

  // Sort newest first, dedupe by title
  const seen = new Set<string>()
  const deduped = items
    .sort((a, b) => (new Date(b.pubDate).getTime() || 0) - (new Date(a.pubDate).getTime() || 0))
    .filter((item) => {
      if (seen.has(item.title)) return false
      seen.add(item.title)
      return true
    })
    .slice(0, 30)

  return NextResponse.json({ items: deduped })
}
