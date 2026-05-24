'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useReadContract, useReadContracts, useAccount, useConnect, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  ArrowUpRight,
  BarChart3,
  Bitcoin,
  Clock,
  Cpu,
  DollarSign,
  Loader2,
  Search,
  Tag,
  TrendingUp,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  factoryMarketReadContracts,
  factoryEventReadContracts,
  managerResolutionReadContracts,
  parseMarketsFromMulticall,
  parseEventsFromMulticall,
  parseResolutionsFromMulticall,
  type DiscoveredEvent,
  type MarketResolution,
} from '@/lib/markets-from-chain'
import { mustGetContract } from '@/lib/contracts'
import { WalletApprovals } from '@/components/wallet-approvals'
import { NewsBanner } from '@/components/news-banner'
import { walletConnectProjectId } from '@/lib/env'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'

const ALL_CATEGORIES = ['All', 'Macro', 'Earnings', 'Crypto', 'Tech'] as const
const PAGE_SIZE = 6

type GroupMarket = {
  id: number
  question: string
  status: 'Open' | 'Resolved'
  winningOutcome: 'YES' | 'NO' | null
}

type EventGroup = {
  eventId: bigint
  /** Normalised display category, e.g. "Earnings". May be empty if the chain stored no category. */
  category: string
  /** Lowercase raw category string from chain, used for filtering. */
  categoryRaw: string
  title: string
  closeTime: number
  markets: GroupMarket[]
  /** 'none' = no markets resolved · 'partial' = some · 'all' = every market in the event is resolved */
  resolutionStage: 'none' | 'partial' | 'all'
}

function formatCloseDate(ts: number): string {
  if (!ts) return 'TBD'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Title-case a freeform category string ("earnings" → "Earnings"). */
function prettyCategory(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * Pick a Lucide icon based on the category. Falls back to a generic tag icon
 * so the visual hierarchy stays consistent across mixed event types.
 */
function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const c = category.toLowerCase()
  if (c === 'earnings') return <DollarSign className={className} />
  if (c === 'crypto') return <Bitcoin className={className} />
  if (c === 'tech') return <Cpu className={className} />
  if (c === 'macro') return <TrendingUp className={className} />
  return <Tag className={className} />
}

const CATEGORY_COLOR: Record<string, string> = {
  Macro: 'text-primary bg-primary/10',
  Earnings: 'text-success bg-success/10',
  Crypto: 'text-accent bg-accent/10',
  Tech: 'text-primary/70 bg-primary/5',
}

function EventCard({ group }: { group: EventGroup }) {
  const colorClass = CATEGORY_COLOR[group.category] ?? 'text-muted-foreground bg-muted'
  const isFullyResolved = group.resolutionStage === 'all'
  const isPartiallyResolved = group.resolutionStage === 'partial'

  return (
    <div
      className={cn(
        'group relative bg-card rounded-2xl p-6 border border-border/50 transition-all duration-300 flex flex-col gap-4',
        // Resolved events are visually de-emphasised but still clickable so
        // winners can navigate in to redeem from the trade page.
        isFullyResolved
          ? 'opacity-70 grayscale-[0.4] hover:opacity-90 hover:grayscale-0 hover:border-muted-foreground/40'
          : 'hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10',
      )}
    >
      {/* Header: icon + category */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center',
              colorClass,
            )}
          >
            <CategoryIcon category={group.category} className="w-4 h-4" />
          </span>
          {group.category && (
            <span
              className={cn(
                'text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full',
                colorClass,
              )}
            >
              {group.category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isFullyResolved && (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-muted-foreground/40"
            >
              Resolved
            </Badge>
          )}
          {isPartiallyResolved && (
            <Badge
              variant="outline"
              className="text-[10px] font-semibold uppercase tracking-wider text-amber-500 border-amber-500/40"
            >
              Partial
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            Event #{group.eventId.toString()}
          </Badge>
        </div>
      </div>

      {/* Event title */}
      <p className="font-semibold text-base leading-snug">{group.title || 'Untitled event'}</p>

      {/* Sub-markets */}
      <ul className="flex flex-col gap-1.5">
        {group.markets.map((m) => (
          <li key={m.id}>
            <Link
              href={`/trade?marketId=${m.id}`}
              className={cn(
                'group/row flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2 transition-all',
                m.status === 'Resolved'
                  ? 'hover:border-muted-foreground/40'
                  : 'hover:border-primary/40 hover:bg-primary/[0.04]',
              )}
            >
              <span
                className={cn(
                  'text-sm leading-snug truncate',
                  m.status === 'Resolved'
                    ? 'text-muted-foreground line-through decoration-muted-foreground/40 decoration-1'
                    : 'group-hover/row:text-primary transition-colors',
                )}
              >
                {m.question}
              </span>
              <span className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
                {m.status === 'Resolved' && m.winningOutcome && (
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md border',
                      m.winningOutcome === 'YES'
                        ? 'text-success border-success/40 bg-success/5'
                        : 'text-destructive border-destructive/40 bg-destructive/5',
                    )}
                  >
                    {m.winningOutcome} won
                  </span>
                )}
                <span className="font-mono">#{m.id}</span>
                {m.status !== 'Resolved' && (
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover/row:opacity-100 transition-opacity" />
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Footer */}
      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <BarChart3 className="w-3 h-3" />
          {group.markets.length} market{group.markets.length === 1 ? '' : 's'}
        </span>
        {group.closeTime > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {isFullyResolved ? 'Closed' : 'Resolves'} {formatCloseDate(group.closeTime)}
          </span>
        )}
      </div>
    </div>
  )
}

export function MarketsDashboard() {
  const chainId = useWalletChainId()
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending: isConnectPending } = useConnect()
  const { disconnect } = useDisconnect()
  const injectedConnector = connectors.find((c) => c.id === 'injected')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const contracts = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return mustGetContract(chainId, 'MarketFactory')
    } catch {
      return null
    }
  }, [chainId])

  // We also need the Manager ABI to fetch each market's resolution status
  // (auto-generated mapping getter). Resolved markets are still listed, just
  // visually de-emphasised so users with winning shares can still navigate
  // in and redeem.
  const managerContract = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return mustGetContract(chainId, 'PredictionMarketManager')
    } catch {
      return null
    }
  }, [chainId])

  const { data: nextMarketId, isPending: nextPending } = useReadContract({
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

  const { data: marketRows, isPending: rowsPending } = useReadContracts({
    contracts: marketReadContracts,
    query: { enabled: marketReadContracts.length > 0 },
  })

  const allMarkets = useMemo(
    () => parseMarketsFromMulticall(typeof nextMarketId === 'bigint' ? nextMarketId : undefined, marketRows),
    [nextMarketId, marketRows],
  )

  // Unique eventIds discovered in markets, in first-seen order.
  const uniqueEventIds = useMemo(() => {
    const seen = new Set<string>()
    const out: bigint[] = []
    for (const m of allMarkets) {
      const key = m.eventId.toString()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m.eventId)
    }
    return out
  }, [allMarkets])

  const eventReadContracts = useMemo(
    () =>
      contracts && uniqueEventIds.length > 0
        ? factoryEventReadContracts(contracts.address, contracts.abi, uniqueEventIds)
        : [],
    [contracts, uniqueEventIds],
  )

  const { data: eventRows, isPending: eventsPending } = useReadContracts({
    contracts: eventReadContracts,
    query: { enabled: eventReadContracts.length > 0 },
  })

  const discoveredEvents = useMemo(
    () => parseEventsFromMulticall(uniqueEventIds, eventRows),
    [uniqueEventIds, eventRows],
  )

  // Resolution status multicall keyed by Manager.markets(id). Reuses the
  // factory's `nextMarketId` since market ids are dense from 0..n-1.
  const resolutionReadContracts = useMemo(
    () =>
      managerContract && typeof nextMarketId === 'bigint' && nextMarketId > 0n
        ? managerResolutionReadContracts(
            managerContract.address,
            managerContract.abi,
            nextMarketId,
          )
        : [],
    [managerContract, nextMarketId],
  )

  const { data: resolutionRows, isPending: resolutionsPending } = useReadContracts({
    contracts: resolutionReadContracts,
    query: { enabled: resolutionReadContracts.length > 0 },
  })

  const resolutionByMarketId = useMemo(() => {
    const arr = parseResolutionsFromMulticall(
      typeof nextMarketId === 'bigint' ? nextMarketId : undefined,
      resolutionRows,
    )
    const map = new Map<number, MarketResolution>()
    for (const r of arr) map.set(r.marketId, r)
    return map
  }, [nextMarketId, resolutionRows])

  const isLoading =
    (Boolean(contracts) && nextPending) ||
    (typeof nextMarketId === 'bigint' && nextMarketId > 0n && rowsPending) ||
    (eventReadContracts.length > 0 && eventsPending) ||
    (resolutionReadContracts.length > 0 && resolutionsPending)

  useEffect(() => {
    if (typeof nextMarketId === 'bigint') {
      console.debug('[markets] nextMarketId from chain:', nextMarketId.toString())
    }
  }, [nextMarketId])

  useEffect(() => {
    console.debug('[markets] allMarkets from chain:', allMarkets.map(m => ({ id: m.id, question: m.question, eventId: m.eventId.toString() })))
  }, [allMarkets])

  useEffect(() => {
    console.debug('[markets] chainId:', chainId, '| contracts loaded:', Boolean(contracts))
  }, [chainId, contracts])

  /**
   * Group markets by their on-chain eventId, then attach the real event
   * metadata (title / category / closeTime) fetched separately. We sort
   * markets within each event by id (creation order) and sort events newest-first.
   */
  const eventGroups: EventGroup[] = useMemo(() => {
    if (allMarkets.length === 0) return []
    const eventMeta = new Map<string, DiscoveredEvent>()
    for (const e of discoveredEvents) eventMeta.set(e.eventId.toString(), e)

    const buckets = new Map<string, EventGroup>()
    for (const m of allMarkets) {
      const key = m.eventId.toString()
      const res = resolutionByMarketId.get(m.id)
      const subMarket: GroupMarket = {
        id: m.id,
        question: m.question,
        status: res?.status ?? 'Open',
        winningOutcome: res?.winningOutcome ?? null,
      }
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.markets.push(subMarket)
        if (m.closeTime > bucket.closeTime) bucket.closeTime = m.closeTime
        continue
      }
      const meta = eventMeta.get(key)
      const categoryRaw = (meta?.category ?? '').toLowerCase()
      buckets.set(key, {
        eventId: m.eventId,
        title: meta?.title ?? `Event ${key}`,
        category: prettyCategory(categoryRaw),
        categoryRaw,
        closeTime: meta?.closeTime || m.closeTime,
        markets: [subMarket],
        resolutionStage: 'none', // computed below once all markets are collected
      })
    }

    const groups = Array.from(buckets.values())
    for (const g of groups) {
      g.markets.sort((a, b) => a.id - b.id)
      const resolved = g.markets.filter((m) => m.status === 'Resolved').length
      g.resolutionStage =
        resolved === 0 ? 'none' : resolved === g.markets.length ? 'all' : 'partial'
    }
    // Newest event first; ties broken by lowest market id (stable).
    groups.sort((a, b) => {
      if (a.eventId === b.eventId) return 0
      return a.eventId < b.eventId ? 1 : -1
    })
    return groups
  }, [allMarkets, discoveredEvents, resolutionByMarketId])

  const filtered = useMemo(() => {
    let list = eventGroups
    if (activeCategory !== 'All') {
      const want = activeCategory.toLowerCase()
      list = list.filter((g) => g.categoryRaw === want)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.markets.some((m) => m.question.toLowerCase().includes(q)),
      )
    }
    return list
  }, [eventGroups, activeCategory, search])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-serif text-base font-bold">A</span>
              </div>
              <span className="font-serif text-xl font-semibold hidden sm:block">Agora</span>
            </Link>
            <span className="text-muted-foreground text-sm hidden sm:block">/ Markets</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portfolio">Portfolio</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/analytics">Analytics</Link>
            </Button>
            <div className="rounded-md border border-input bg-background px-2 py-1">
              {walletConnectProjectId ? (
                <ConnectButton chainStatus="icon" showBalance={false} />
              ) : isConnected ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
                    {address?.slice(0, 6)}…{address?.slice(-4)}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => disconnect()}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isConnectPending || !injectedConnector}
                  onClick={() => injectedConnector && connect({ connector: injectedConnector })}
                >
                  {isConnectPending ? 'Connecting…' : 'Connect Wallet'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* News ticker — full-width below the sticky nav */}
      <NewsBanner />

      <div className="container mx-auto px-6 py-12">
        {/* One-time wallet approvals (covers ALL markets) */}
        <WalletApprovals className="mb-8" />

        {/* Hero text */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-primary uppercase tracking-widest">Live Markets</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3">
            Prediction Markets
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Trade YES/NO outcomes on finance, tech, and macro events. Every trade is on-chain on Circle Arc.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          {/* Category tabs */}
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setVisibleCount(PAGE_SIZE) }}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                  activeCategory === cat
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative sm:ml-auto sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search markets…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
              className="pl-9"
            />
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading markets from chain…
          </div>
        ) : !contracts ? (
          <div className="text-center h-64 flex items-center justify-center text-muted-foreground">
            Connect to Circle Arc Testnet to view markets.
          </div>
        ) : eventGroups.length === 0 ? (
          <div className="text-center py-16 px-6 rounded-xl border border-dashed border-border bg-card/30 space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No markets deployed yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                The factory at <code className="text-xs bg-background/40 px-1 rounded">{contracts.address.slice(0, 8)}…{contracts.address.slice(-4)}</code>{' '}
                has zero markets. Spin one up from the admin tools to start trading.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button asChild>
                <Link href="/admin">Open admin → propose market</Link>
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center h-64 flex items-center justify-center text-muted-foreground">
            No events match your search.
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {visible.map((g) => (
                <EventCard key={g.eventId.toString()} group={g} />
              ))}
            </div>

            {hasMore && (
              <div className="text-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-10"
                >
                  Load more events ({filtered.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
