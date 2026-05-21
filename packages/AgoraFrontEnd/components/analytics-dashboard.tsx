'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useReadContract, useReadContracts, useChainId } from 'wagmi'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
  RadialBarChart,
  RadialBar,
} from 'recharts'
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  ExternalLink,
  Lock,
  LogOut,
  Newspaper,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { factoryMarketReadContracts, parseMarketsFromMulticall } from '@/lib/markets-from-chain'
import { mustGetContract } from '@/lib/contracts'
import { CURATED_MARKET_IDS, CURATED_ID_SET, getCuratedMeta, CATEGORY_COLORS } from '@/lib/curated-markets'
import { fetchOrders, type OffchainOrder } from '@/lib/agora-api'
import type { NewsItem } from '@/app/api/news/route'

// ─── Theme colours (olive-green / sage / silver palette) ─────────────────────
// Recharts SVG can't resolve CSS vars, so we use static hex values that match
// the app's oklch olive-green theme.
const T = {
  primary:     '#7a9a4e', // olive green (--primary approx)
  primaryMid:  '#5a7a34', // darker olive
  accent:      '#9aaab8', // silver-blue (--accent approx)
  success:     '#5a8a48', // sage green (--success approx)
  warn:        '#b09060', // warm sand
  muted:       '#8a9e88', // muted sage
  no:          '#b07850', // terracotta (NO side)
  grid:        'rgba(100,120,80,0.12)',
  tooltip:     { bg: 'var(--card)', border: 'var(--border)', color: 'var(--foreground)' },
} as const

// ─── Auth ────────────────────────────────────────────────────────────────────

function LoginWall({ onAuth }: { onAuth: () => void }) {
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErr('')
    await new Promise((r) => setTimeout(r, 300))
    if (user === 'company' && pw === 'company') {
      sessionStorage.setItem('agora_analytics_auth', '1')
      onAuth()
    } else {
      setErr('Invalid credentials.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background via-background to-muted/30 px-6">
      <Link href="/" className="flex items-center gap-3 mb-10 group">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-serif text-xl font-bold">A</span>
        </div>
        <span className="font-serif text-2xl font-semibold">Agora</span>
      </Link>

      <div className="w-full max-w-sm bg-card rounded-2xl border border-border/60 p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <h1 className="font-serif text-2xl font-bold">Analytics Access</h1>
          <p className="text-sm text-muted-foreground">Institutional alternative data — restricted.</p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ana-user">Username</Label>
            <Input id="ana-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ana-pw">Password</Label>
            <Input id="ana-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Verifying…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MarketStats = {
  id: number
  question: string
  category: string
  emoji: string
  totalVolume: number
  buyYesOrders: number
  buyNoOrders: number
  openOrders: number
  impliedYesPct: number // 0–100
  sentimentLabel: string
}

function computeStats(marketId: number, question: string, orders: OffchainOrder[]): MarketStats {
  const meta = getCuratedMeta(marketId)
  const open = orders.filter((o) => o.status === 'open' || !o.status)
  const buyYes = open.filter((o) => o.side === 'BUY_YES')
  const buyNo = open.filter((o) => o.side === 'BUY_NO')
  const totalVolume = orders.reduce((s, o) => s + (o.amount ?? 0), 0)

  // Implied YES probability = avg BUY_YES price / 10000
  const avgYesPrice =
    buyYes.length > 0
      ? buyYes.reduce((s, o) => s + o.priceBps, 0) / buyYes.length / 100
      : 50

  const impliedYesPct = Math.min(99, Math.max(1, Math.round(avgYesPrice)))

  let sentimentLabel = 'Neutral'
  if (impliedYesPct >= 70) sentimentLabel = 'Bullish YES'
  else if (impliedYesPct >= 55) sentimentLabel = 'Lean YES'
  else if (impliedYesPct <= 30) sentimentLabel = 'Bearish YES'
  else if (impliedYesPct <= 45) sentimentLabel = 'Lean NO'

  return {
    id: marketId,
    question,
    category: meta?.category ?? 'Other',
    emoji: meta?.emoji ?? '📊',
    totalVolume,
    buyYesOrders: buyYes.length,
    buyNoOrders: buyNo.length,
    openOrders: open.length,
    impliedYesPct,
    sentimentLabel,
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const COLORS = [T.primary, T.accent, T.success, T.no, T.warn]

function SentimentGauge({ pct }: { pct: number }) {
  const data = [{ value: pct }, { value: 100 - pct }]
  return (
    <div className="flex flex-col items-center gap-1">
      <PieChart width={120} height={70}>
        <Pie data={data} cx={55} cy={60} startAngle={180} endAngle={0} innerRadius={38} outerRadius={55} dataKey="value" strokeWidth={0}>
          <Cell fill={T.primary} />
          <Cell fill="var(--muted)" opacity={0.3} />
        </Pie>
      </PieChart>
      <span className="text-2xl font-bold -mt-6">{pct}%</span>
      <span className="text-xs text-muted-foreground">YES probability</span>
    </div>
  )
}

function MarketCard({ stats, orders }: { stats: MarketStats; orders: OffchainOrder[] }) {
  const colorClass = CATEGORY_COLORS[stats.category] ?? 'text-muted-foreground bg-muted'
  const volumeFmt = stats.totalVolume > 0 ? (stats.totalVolume / 1e6).toFixed(2) + ' USDC' : '—'

  const sideData = [
    { name: 'BUY YES', value: stats.buyYesOrders, fill: T.primary },
    { name: 'BUY NO', value: stats.buyNoOrders, fill: T.no },
    { name: 'SELL YES', value: orders.filter((o) => o.side === 'SELL_YES').length, fill: T.success },
    { name: 'SELL NO', value: orders.filter((o) => o.side === 'SELL_NO').length, fill: T.warn },
  ]

  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">{stats.emoji}</span>
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', colorClass)}>
              {stats.category}
            </span>
          </div>
          <p className="text-sm font-medium leading-snug">{stats.question}</p>
        </div>
        <Link href={`/trade?marketId=${stats.id}`} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        {/* Gauge */}
        <div className="flex items-center justify-center">
          <SentimentGauge pct={stats.impliedYesPct} />
        </div>

        {/* Order distribution bar */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Order Sides</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={sideData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {sideData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-xs text-muted-foreground">Sentiment</p>
          <p className="text-xs font-semibold mt-0.5">{stats.sentimentLabel}</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-xs text-muted-foreground">Open Orders</p>
          <p className="text-sm font-bold mt-0.5">{stats.openOrders}</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2">
          <p className="text-xs text-muted-foreground">Volume</p>
          <p className="text-xs font-semibold mt-0.5">{volumeFmt}</p>
        </div>
      </div>

      {/* Synopsis */}
      <div className="bg-muted/30 rounded-lg p-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Market Synopsis: </span>
          {stats.openOrders === 0
            ? 'No orders yet. This market has not seen activity — first-mover opportunity.'
            : `Crowd implies a ${stats.impliedYesPct}% chance of YES. ${stats.buyYesOrders} buy-YES vs ${stats.buyNoOrders} buy-NO orders in the book. Sentiment: ${stats.sentimentLabel}.`}
        </p>
      </div>
    </div>
  )
}

function NewsPanel({ items, loading }: { items: NewsItem[]; loading: boolean }) {
  const CATEGORY_BADGE: Record<string, string> = {
    Macro: 'text-blue-400 bg-blue-400/10',
    Earnings: 'text-green-400 bg-green-400/10',
    Crypto: 'text-orange-400 bg-orange-400/10',
    Tech: 'text-purple-400 bg-purple-400/10',
  }

  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Latest Headlines</h3>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      {items.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No headlines available right now.</p>
      )}
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
        {items.map((item, i) => (
          <div key={i} className="space-y-1 pb-3 border-b border-border/30 last:border-0 last:pb-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', CATEGORY_BADGE[item.category] ?? 'text-muted-foreground bg-muted')}>
                {item.category}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ''}
              </span>
            </div>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium hover:text-primary transition-colors flex items-start gap-1 group"
            >
              <span className="flex-1">{item.title}</span>
              <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}

function OverviewCharts({ allStats }: { allStats: MarketStats[] }) {
  const categoryData = useMemo(() => {
    const map: Record<string, { name: string; markets: number; avgYesPct: number }> = {}
    for (const s of allStats) {
      if (!map[s.category]) map[s.category] = { name: s.category, markets: 0, avgYesPct: 0 }
      map[s.category].markets++
      map[s.category].avgYesPct += s.impliedYesPct
    }
    return Object.values(map).map((d) => ({ ...d, avgYesPct: Math.round(d.avgYesPct / d.markets) }))
  }, [allStats])

  const sentimentData = useMemo(
    () =>
      allStats
        .filter((s) => s.openOrders > 0)
        .sort((a, b) => b.impliedYesPct - a.impliedYesPct)
        .slice(0, 8)
        .map((s) => ({
          name: s.question.split(' ').slice(0, 4).join(' ') + '…',
          yesPct: s.impliedYesPct,
          noPct: 100 - s.impliedYesPct,
        })),
    [allStats],
  )

  const volumeData = useMemo(
    () =>
      allStats
        .filter((s) => s.totalVolume > 0)
        .sort((a, b) => b.totalVolume - a.totalVolume)
        .slice(0, 8)
        .map((s) => ({
          name: s.emoji + ' ' + s.question.split(' ').slice(0, 3).join(' ') + '…',
          volume: parseFloat((s.totalVolume / 1e6).toFixed(4)),
        })),
    [allStats],
  )

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Category avg YES sentiment */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Average YES Probability by Category
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={categoryData}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
            <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem' }} />
            <Bar dataKey="avgYesPct" fill={T.primary} radius={[4, 4, 0, 0]} name="Avg YES %" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Volume chart */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Volume by Market (USDC)
        </h3>
        {volumeData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
            No volume yet — trades will appear here.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={volumeData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={120} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem' }} />
              <Bar dataKey="volume" fill={T.success} radius={[0, 4, 4, 0]} name="Volume (USDC)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Sentiment spectrum */}
      {sentimentData.length > 0 && (
        <div className="bg-card rounded-2xl border border-border/50 p-5 md:col-span-2">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> YES vs NO Sentiment Spectrum (top active markets)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sentimentData} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={150} />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.5rem' }} />
              <Legend />
              <Bar dataKey="yesPct" name="YES %" stackId="a" fill={T.primary} radius={[0, 0, 0, 0]} />
              <Bar dataKey="noPct" name="NO %" stackId="a" fill={T.no} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const [authed, setAuthed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [allStats, setAllStats] = useState<MarketStats[]>([])
  const [allOrders, setAllOrders] = useState<Record<number, OffchainOrder[]>>({})
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [selectedMarket, setSelectedMarket] = useState<number | null>(null)
  const chainId = useChainId()

  useEffect(() => {
    setMounted(true)
    setAuthed(sessionStorage.getItem('agora_analytics_auth') === '1')
  }, [])

  const contracts = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return mustGetContract(chainId, 'MarketFactory')
    } catch { return null }
  }, [chainId])

  const { data: nextMarketId } = useReadContract({
    address: contracts?.address,
    abi: contracts?.abi,
    functionName: 'nextMarketId',
    query: { enabled: Boolean(contracts) },
  })

  const marketReadContracts = useMemo(
    () =>
      contracts && typeof nextMarketId === 'bigint' && nextMarketId > 0n
        ? factoryMarketReadContracts(contracts.address, contracts.abi, nextMarketId)
        : [],
    [contracts, nextMarketId],
  )

  const { data: marketRows } = useReadContracts({
    contracts: marketReadContracts,
    query: { enabled: marketReadContracts.length > 0 },
  })

  const chainMarkets = useMemo(
    () => parseMarketsFromMulticall(typeof nextMarketId === 'bigint' ? nextMarketId : undefined, marketRows),
    [nextMarketId, marketRows],
  )

  const curatedChainMarkets = useMemo(
    () => chainMarkets.filter((m) => CURATED_ID_SET.has(m.id)),
    [chainMarkets],
  )

  const loadStats = useCallback(async () => {
    if (curatedChainMarkets.length === 0) return
    setStatsLoading(true)
    try {
      const entries = await Promise.all(
        curatedChainMarkets.map(async (m) => {
          try {
            const { orders } = await fetchOrders(m.id)
            return { id: m.id, question: m.question, orders }
          } catch {
            return { id: m.id, question: m.question, orders: [] }
          }
        }),
      )
      const ordersMap: Record<number, OffchainOrder[]> = {}
      const stats: MarketStats[] = []
      for (const e of entries) {
        ordersMap[e.id] = e.orders
        stats.push(computeStats(e.id, e.question, e.orders))
      }
      setAllOrders(ordersMap)
      setAllStats(stats)
    } finally {
      setStatsLoading(false)
    }
  }, [curatedChainMarkets])

  const loadNews = useCallback(async () => {
    setNewsLoading(true)
    try {
      const res = await fetch('/api/news')
      if (res.ok) {
        const data = await res.json() as { items: NewsItem[] }
        setNews(data.items ?? [])
      }
    } finally {
      setNewsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    void loadStats()
    void loadNews()
    const t = setInterval(() => void loadStats(), 30_000)
    return () => clearInterval(t)
  }, [authed, loadStats, loadNews])

  if (!mounted) return null
  if (!authed) return <LoginWall onAuth={() => setAuthed(true)} />

  const displayStats = selectedMarket !== null
    ? allStats.filter((s) => s.id === selectedMarket)
    : allStats

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-serif text-base font-bold">A</span>
              </div>
              <span className="font-serif text-xl font-semibold hidden sm:block">Agora</span>
            </Link>
            <span className="text-muted-foreground text-sm hidden sm:block">/ Analytics</span>
            <Badge variant="outline" className="text-xs">Institutional</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void loadStats(); void loadNews() }}
              disabled={statsLoading}
              className="gap-1.5"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', statsLoading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/markets" className="gap-1.5 flex items-center">
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Markets</span>
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { sessionStorage.removeItem('agora_analytics_auth'); setAuthed(false) }}
              className="gap-1.5 text-muted-foreground"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-10 space-y-10">
        {/* Page title */}
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold mb-2">Market Intelligence</h1>
          <p className="text-muted-foreground">
            Alternative data for institutional analysis — crowd-sourced probability signals from Agora prediction markets.
          </p>
        </div>

        {/* Overview charts */}
        {allStats.length > 0 && (
          <section>
            <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" /> Portfolio Overview
            </h2>
            <OverviewCharts allStats={allStats} />
          </section>
        )}

        {/* Market filter pills */}
        {allStats.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground font-medium">Filter:</span>
            <button
              onClick={() => setSelectedMarket(null)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all',
                selectedMarket === null ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:bg-secondary',
              )}
            >
              All Markets
            </button>
            {allStats.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedMarket(s.id)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-all',
                  selectedMarket === s.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:bg-secondary',
                )}
              >
                {s.emoji} #{s.id}
              </button>
            ))}
          </div>
        )}

        {/* Per-market cards */}
        <section className="space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Market Deep Dive
            {statsLoading && <span className="text-sm text-muted-foreground font-normal">Updating…</span>}
          </h2>

          {!contracts ? (
            <p className="text-muted-foreground text-sm">Connect to Circle Arc Testnet to load market data.</p>
          ) : displayStats.length === 0 ? (
            <p className="text-muted-foreground text-sm">Loading market data from chain…</p>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
              {displayStats.map((s) => (
                <MarketCard key={s.id} stats={s} orders={allOrders[s.id] ?? []} />
              ))}
            </div>
          )}
        </section>

        {/* News */}
        <section className="space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-primary" /> Related Headlines
          </h2>
          <NewsPanel items={news} loading={newsLoading} />
        </section>

        {/* Data methodology note */}
        <section className="bg-muted/30 rounded-2xl border border-border/30 p-6 space-y-2">
          <h3 className="font-semibold text-sm">About This Data</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            All probabilities are derived from live on-chain order book prices on Circle Arc via the Agora prediction market protocol.
            Implied YES probability is computed from the volume-weighted average of active BUY_YES orders.
            Volume represents total notional across all order sides in USDC (6 decimals).
            This data is intended as an alternative dataset — crowd-sourced market intelligence separate from traditional price feeds.
            News headlines are sourced in real-time from Yahoo Finance RSS feeds.
          </p>
        </section>
      </div>
    </div>
  )
}
