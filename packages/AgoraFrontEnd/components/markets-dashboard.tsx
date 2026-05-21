'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useReadContract, useReadContracts, useAccount, useConnect, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ArrowUpRight, BarChart3, Clock, Loader2, Search, TrendingUp } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { factoryMarketReadContracts, parseMarketsFromMulticall } from '@/lib/markets-from-chain'
import {
  getCuratedMeta,
  CATEGORY_COLORS,
  type CuratedMarket,
} from '@/lib/curated-markets'
import { mustGetContract } from '@/lib/contracts'
import { WalletApprovals } from '@/components/wallet-approvals'
import { walletConnectProjectId } from '@/lib/env'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'

const ALL_CATEGORIES = ['All', 'Macro', 'Earnings', 'Crypto', 'Tech'] as const
const PAGE_SIZE = 6

type EnrichedMarket = {
  id: number
  question: string
  closeTime: number
  meta: CuratedMarket | undefined
}

function formatCloseDate(ts: number): string {
  if (!ts) return 'TBD'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MarketCard({ market }: { market: EnrichedMarket }) {
  const colorClass = market.meta
    ? (CATEGORY_COLORS[market.meta.category] ?? 'text-muted-foreground bg-muted')
    : 'text-muted-foreground bg-muted'

  return (
    <Link
      href={`/trade?marketId=${market.id}`}
      className="group relative bg-card rounded-2xl p-6 border border-border/50 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 hover:bg-primary/[0.02] transition-all duration-300 flex flex-col gap-4 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <span className="text-2xl">{market.meta?.emoji ?? '📋'}</span>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
      </div>

      {/* Category badge */}
      <div>
        <span className={cn('text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full', colorClass)}>
          {market.meta?.category ?? 'Community'}
        </span>
      </div>

      {/* Question */}
      <p className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors flex-1">
        {market.question}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {market.meta?.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs font-normal">
            {tag}
          </Badge>
        ))}
        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
          #{market.id}
        </Badge>
      </div>

      {/* Resolve date + CTA */}
      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 group-hover:text-primary transition-colors">
          <BarChart3 className="w-3 h-3" />
          Open order book
        </span>
        {market.closeTime > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Resolves {formatCloseDate(market.closeTime)}
          </span>
        )}
      </div>
    </Link>
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

  const isLoading =
    (Boolean(contracts) && nextPending) ||
    (typeof nextMarketId === 'bigint' && nextMarketId > 0n && rowsPending)

  const allMarkets = useMemo(
    () => parseMarketsFromMulticall(typeof nextMarketId === 'bigint' ? nextMarketId : undefined, marketRows),
    [nextMarketId, marketRows],
  )

  useEffect(() => {
    if (typeof nextMarketId === 'bigint') {
      console.debug('[markets] nextMarketId from chain:', nextMarketId.toString())
    }
  }, [nextMarketId])

  useEffect(() => {
    console.debug('[markets] allMarkets from chain:', allMarkets.map(m => ({ id: m.id, question: m.question })))
  }, [allMarkets])

  useEffect(() => {
    console.debug('[markets] chainId:', chainId, '| contracts loaded:', Boolean(contracts))
  }, [chainId, contracts])

  const enrichedMarkets: EnrichedMarket[] = useMemo(
    () =>
      allMarkets
        .map((m) => ({ id: m.id, question: m.question, closeTime: m.closeTime, meta: getCuratedMeta(m.id) }))
        .sort((a, b) => a.id - b.id),
    [allMarkets],
  )

  const filtered = useMemo(() => {
    let list = enrichedMarkets
    if (activeCategory !== 'All') list = list.filter((m) => m.meta?.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (m) =>
          m.question.toLowerCase().includes(q) ||
          m.meta?.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [enrichedMarkets, activeCategory, search])

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
        ) : enrichedMarkets.length === 0 ? (
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
            No markets match your search.
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {visible.map((m) => (
                <MarketCard key={m.id} market={m} />
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
                  Load more markets ({filtered.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
