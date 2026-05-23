'use client'

/**
 * Portfolio page.
 *
 * Lists every market where the connected wallet currently holds YES or NO
 * outcome shares. For each position we show:
 *   • The event/market it belongs to
 *   • Current YES + NO balances (token units, 6 decimals → display whole shares)
 *   • Live status (Open vs Resolved · YES/NO won)
 *   • Estimated USDC value:
 *       – Resolved → winning balance is worth 1 USDC each, losing balance $0
 *       – Open     → not priced here (a market-aware mid is shown on the trade
 *         page itself). We surface the share count instead so the user can
 *         still see they hold a position.
 *
 * Auto-redeem: on mount we iterate every resolved market where the wallet
 * still holds winning shares and submit a `redeem()` via the gas-sponsored
 * relayer. Each redemption is fired at most once per (address, marketId)
 * per page-load — guarded by `redeemedRef`.
 *
 * PnL: not shown yet — historical cost basis requires either an indexer or
 * the backend trade store. Surfaced in the UI as a "coming soon" placeholder
 * so it's obvious that's where it'll plug in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount, useReadContract, useReadContracts, usePublicClient, useWalletClient } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ArrowUpRight, Briefcase, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { mustGetContract } from '@/lib/contracts'
import { arcUsdcContract } from '@/lib/usdc'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'
import { walletConnectProjectId } from '@/lib/env'
import {
  factoryMarketReadContracts,
  factoryEventReadContracts,
  managerResolutionReadContracts,
  parseMarketsFromMulticall,
  parseEventsFromMulticall,
  parseResolutionsFromMulticall,
  type DiscoveredEvent,
} from '@/lib/markets-from-chain'
import {
  exchangeOfferReadContracts,
  parseAllActiveOffers,
  type ParsedOnchainOffer,
} from '@/lib/offers-from-chain'
import { encodeRedeem, relayForward } from '@/lib/relay'

/**
 * How many recent on-chain offer ids to scan when pricing positions. Same
 * sliding window the trade page uses — covers a healthy backlog without
 * fanning out into thousands of multicalls.
 */
const OFFER_SCAN_WINDOW = 500n

type PortfolioRow = {
  marketId: number
  question: string
  eventId: bigint
  eventTitle: string
  category: string
  closeTime: number
  /** Wallet balances (liquid, not locked in any offer). */
  yesBalRaw: bigint
  noBalRaw: bigint
  /** Shares locked in this user's open SELL_YES / SELL_NO offers for this market. */
  yesEscrowRaw: bigint
  noEscrowRaw: bigint
  /** USDC locked in this user's open BUY_YES / BUY_NO offers for this market. */
  usdcEscrowRaw: bigint
  status: 'Open' | 'Resolved'
  winningOutcome: 'YES' | 'NO' | null
  /**
   * Best bid price in basis points (0..10_000) for each side, sourced from
   * the highest BUY_YES / BUY_NO open offer respectively. We use the best
   * bid as the conservative "fair sell now" price when valuing positions.
   */
  bestBidYesBps: bigint | null
  bestBidNoBps: bigint | null
  /**
   * Estimated USDC value of this row right now.
   *   • Resolved markets → winning_balance × $1 + losing_balance × $0
   *   • Open markets     → (yes+escrowYes) × bestBidYes + (no+escrowNo) × bestBidNo
   *     (escrowed USDC bids are counted separately in the summary; not here).
   * `null` only when there's no liquidity to price an open position.
   */
  estimatedValueUsdc: number | null
  /** Winning balance still sitting unredeemed in the user's wallet. */
  redeemableRaw: bigint
}

const SHARE_DECIMALS = 6
const USDC_DECIMALS = 6
const BPS_DIVISOR = 10_000n

function formatShares(raw: bigint): string {
  return Number(formatUnits(raw, SHARE_DECIMALS)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
}

function formatUsd(v: number): string {
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

/**
 * shares × priceBps / 10_000 → USDC in 6-decimal token units. Pulled into a
 * helper so the same bigint-safe math is used for both escrow calculations
 * (where we know the price exactly) and live market valuation (where we use
 * the best bid as a sell-now proxy).
 */
function sharesAtBpsToUsdcRaw(shares: bigint, priceBps: bigint): bigint {
  return (shares * priceBps) / BPS_DIVISOR
}

function rawToUsdc(raw: bigint): number {
  return Number(formatUnits(raw, USDC_DECIMALS))
}

export function Portfolio() {
  const chainId = useWalletChainId()
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const contracts = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return {
        forwarder: mustGetContract(chainId, 'AgoraForwarder'),
        manager: mustGetContract(chainId, 'PredictionMarketManager'),
        factory: mustGetContract(chainId, 'MarketFactory'),
        token: mustGetContract(chainId, 'OutcomeToken1155'),
        exchange: mustGetContract(chainId, 'Exchange'),
        usdc: arcUsdcContract,
      }
    } catch {
      return null
    }
  }, [chainId])

  // ── 1. Discover all markets (factory.nextMarketId + getMarketData * N) ──
  const { data: nextMarketId, isPending: nextPending } = useReadContract({
    address: contracts?.factory.address,
    abi: contracts?.factory.abi,
    functionName: 'nextMarketId',
    query: { enabled: Boolean(contracts) },
  })

  const marketReadCalls = useMemo(
    () =>
      contracts?.factory && typeof nextMarketId === 'bigint' && nextMarketId > 0n
        ? factoryMarketReadContracts(contracts.factory.address, contracts.factory.abi, nextMarketId)
        : [],
    [contracts?.factory, nextMarketId],
  )
  const { data: marketRows, isPending: marketRowsPending } = useReadContracts({
    contracts: marketReadCalls,
    query: { enabled: marketReadCalls.length > 0 },
  })

  const allMarkets = useMemo(
    () => parseMarketsFromMulticall(typeof nextMarketId === 'bigint' ? nextMarketId : undefined, marketRows),
    [nextMarketId, marketRows],
  )

  // ── 2. Event metadata for grouping (title/category) ──
  const uniqueEventIds = useMemo(() => {
    const seen = new Set<string>()
    const out: bigint[] = []
    for (const m of allMarkets) {
      const k = m.eventId.toString()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(m.eventId)
    }
    return out
  }, [allMarkets])

  const eventReadCalls = useMemo(
    () =>
      contracts?.factory && uniqueEventIds.length > 0
        ? factoryEventReadContracts(contracts.factory.address, contracts.factory.abi, uniqueEventIds)
        : [],
    [contracts?.factory, uniqueEventIds],
  )
  const { data: eventRows } = useReadContracts({
    contracts: eventReadCalls,
    query: { enabled: eventReadCalls.length > 0 },
  })
  const discoveredEvents = useMemo(
    () => parseEventsFromMulticall(uniqueEventIds, eventRows),
    [uniqueEventIds, eventRows],
  )

  // ── 3. Resolution state per market ──
  const resolutionReadCalls = useMemo(
    () =>
      contracts?.manager && typeof nextMarketId === 'bigint' && nextMarketId > 0n
        ? managerResolutionReadContracts(contracts.manager.address, contracts.manager.abi, nextMarketId)
        : [],
    [contracts?.manager, nextMarketId],
  )
  const { data: resolutionRows } = useReadContracts({
    contracts: resolutionReadCalls,
    query: { enabled: resolutionReadCalls.length > 0 },
  })
  const resolutions = useMemo(
    () =>
      parseResolutionsFromMulticall(
        typeof nextMarketId === 'bigint' ? nextMarketId : undefined,
        resolutionRows,
      ),
    [nextMarketId, resolutionRows],
  )

  // ── 4. balanceOfBatch for user's YES + NO across every market ──
  // Token id layout (from OutcomeToken1155): yes = marketId*2, no = marketId*2+1.
  // One batch call returns 2*N balances. Ordering: yes[0],no[0],yes[1],no[1]…
  const balanceArgs = useMemo<readonly [readonly `0x${string}`[], readonly bigint[]] | null>(() => {
    if (!address || allMarkets.length === 0) return null
    const accounts: `0x${string}`[] = []
    const ids: bigint[] = []
    for (const m of allMarkets) {
      const yesId = BigInt(m.id) * 2n
      const noId = yesId + 1n
      accounts.push(address, address)
      ids.push(yesId, noId)
    }
    return [accounts, ids] as const
  }, [address, allMarkets])

  const { data: balances, refetch: refetchBalances, isPending: balancesPending } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'balanceOfBatch',
    args: balanceArgs ?? undefined,
    query: { enabled: Boolean(contracts && balanceArgs) },
  })

  // ── 4b. USDC balance for the connected wallet ──
  // The "Liquid USDC" tile in the summary and the total-account-value math
  // both need this. USDC on Arc is the canonical Circle deployment, so we use
  // the standard ERC-20 ABI; viem's `erc20Abi` is good enough.
  const { data: usdcBalRaw, refetch: refetchUsdcBal } = useReadContract({
    address: contracts?.usdc.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(contracts && address) },
  })

  // ── 4c. Recent on-chain offers across every market ──
  // We walk a sliding window of the last `OFFER_SCAN_WINDOW` offer ids and
  // use them for two things:
  //   • per-market best bid (BUY_YES / BUY_NO) used to mark open positions to
  //     market at the price they could sell at right now, and
  //   • the user's escrow per-market (SELL_YES/NO shares + BUY_YES/NO USDC).
  // Anything older than the window is excluded; in practice an aged offer is
  // either filled, cancelled, or stale enough that it doesn't reflect the
  // current market.
  const { data: nextOfferId, refetch: refetchNextOfferId } = useReadContract({
    address: contracts?.exchange.address,
    abi: contracts?.exchange.abi,
    functionName: 'nextOfferId',
    query: { enabled: Boolean(contracts) },
  })

  const offerStartId = useMemo(() => {
    if (typeof nextOfferId !== 'bigint' || nextOfferId === 0n) return 0n
    return nextOfferId > OFFER_SCAN_WINDOW ? nextOfferId - OFFER_SCAN_WINDOW : 0n
  }, [nextOfferId])

  const offerReadCalls = useMemo(
    () =>
      contracts?.exchange && typeof nextOfferId === 'bigint' && nextOfferId > 0n
        ? exchangeOfferReadContracts(
            contracts.exchange.address,
            contracts.exchange.abi,
            offerStartId,
            nextOfferId,
          )
        : [],
    [contracts?.exchange, offerStartId, nextOfferId],
  )
  const { data: offerRows, refetch: refetchOfferRows } = useReadContracts({
    contracts: offerReadCalls,
    query: { enabled: offerReadCalls.length > 0 },
  })
  const allActiveOffers: ParsedOnchainOffer[] = useMemo(
    () => parseAllActiveOffers(offerStartId, offerRows),
    [offerStartId, offerRows],
  )

  // ── 5a. Per-market best bid for each side, and the user's escrow ──
  //
  // Best bid YES = highest BUY_YES priceBps among open offers (someone willing
  // to pay that much for one YES share). Same idea for NO. We use the best
  // bid (not the midpoint) as the "fair sell now" mark — a holder could
  // realistically liquidate at that price, modulo size/slippage.
  //
  // Escrow: when the wallet has open SELL_* offers, the Exchange holds the
  // tokens. When it has open BUY_* offers, the Exchange holds USDC. Both
  // count toward the user's position even though `balanceOf` returns 0 for
  // the escrowed slice.
  const { bestBidYesByMarket, bestBidNoByMarket, escrowByMarket, userUsdcEscrowRaw } =
    useMemo(() => {
      const yesBidMap = new Map<string, bigint>()
      const noBidMap = new Map<string, bigint>()
      const escrowMap = new Map<string, { yes: bigint; no: bigint; usdc: bigint }>()
      const me = address?.toLowerCase() ?? ''
      let usdcEscrow = 0n
      for (const o of allActiveOffers) {
        const key = o.marketId.toString()
        // Best bids — every open BUY_* offer is a candidate, not just the user's.
        if (o.side === 0) {
          const cur = yesBidMap.get(key) ?? 0n
          if (o.priceBps > cur) yesBidMap.set(key, o.priceBps)
        } else if (o.side === 1) {
          const cur = noBidMap.get(key) ?? 0n
          if (o.priceBps > cur) noBidMap.set(key, o.priceBps)
        }
        // Escrow — restricted to the connected wallet.
        if (me && o.maker.toLowerCase() === me) {
          const bucket = escrowMap.get(key) ?? { yes: 0n, no: 0n, usdc: 0n }
          if (o.side === 2) bucket.yes += o.remainingAmount
          else if (o.side === 3) bucket.no += o.remainingAmount
          else if (o.side === 0 || o.side === 1) {
            const locked = sharesAtBpsToUsdcRaw(o.remainingAmount, o.priceBps)
            bucket.usdc += locked
            usdcEscrow += locked
          }
          escrowMap.set(key, bucket)
        }
      }
      return {
        bestBidYesByMarket: yesBidMap,
        bestBidNoByMarket: noBidMap,
        escrowByMarket: escrowMap,
        userUsdcEscrowRaw: usdcEscrow,
      }
    }, [allActiveOffers, address])

  // ── 5b. Stitch markets + balances + escrow + resolution into rows. We
  // include a row whenever the wallet has *any* exposure to that market —
  // liquid balance OR shares in escrow — so users see SELL offers they posted
  // even when their wallet shows 0 of that side.
  const rows: PortfolioRow[] = useMemo(() => {
    if (allMarkets.length === 0) return []
    const eventMeta = new Map<string, DiscoveredEvent>()
    for (const e of discoveredEvents) eventMeta.set(e.eventId.toString(), e)
    const resByMarketId = new Map<number, (typeof resolutions)[number]>()
    for (const r of resolutions) resByMarketId.set(r.marketId, r)
    const bals = Array.isArray(balances) ? (balances as readonly bigint[]) : []

    const out: PortfolioRow[] = []
    allMarkets.forEach((m, idx) => {
      const yesBal = bals[idx * 2] ?? 0n
      const noBal = bals[idx * 2 + 1] ?? 0n
      // `escrowByMarket` is keyed by marketId (not eventId) because escrow is
      // per-market; a SELL_YES on market #4 shouldn't be counted on market #5
      // just because they belong to the same event.
      const escrowEntry = escrowByMarket.get(String(m.id))
      const yesEscrowForMarket = escrowEntry?.yes ?? 0n
      const noEscrowForMarket = escrowEntry?.no ?? 0n
      const usdcEscrowForMarket = escrowEntry?.usdc ?? 0n

      if (
        yesBal === 0n &&
        noBal === 0n &&
        yesEscrowForMarket === 0n &&
        noEscrowForMarket === 0n &&
        usdcEscrowForMarket === 0n
      ) {
        return
      }

      const res = resByMarketId.get(m.id)
      const status: 'Open' | 'Resolved' = res?.status ?? 'Open'
      const winning = res?.winningOutcome ?? null
      const meta = eventMeta.get(m.eventId.toString())

      const bestBidYes = bestBidYesByMarket.get(String(m.id)) ?? null
      const bestBidNo = bestBidNoByMarket.get(String(m.id)) ?? null

      // Redeemable = winning shares (wallet + escrowed) still un-redeemed.
      // After resolution, an escrowed SELL offer would also be cancellable
      // and the user could redeem those shares, so include them.
      const redeemable =
        status === 'Resolved'
          ? winning === 'YES'
            ? yesBal + yesEscrowForMarket
            : winning === 'NO'
              ? noBal + noEscrowForMarket
              : 0n
          : 0n

      // Estimated USDC value of the row.
      let estimated: number | null = null
      if (status === 'Resolved' && winning) {
        estimated = rawToUsdc(redeemable)
      } else {
        // Mark each side to its best bid. If there's no bid for a side and
        // the wallet still holds it, we leave it out of the dollar number
        // (but keep showing the share count) to avoid implying $0.
        let total = 0
        let priced = false
        if ((yesBal + yesEscrowForMarket) > 0n && bestBidYes !== null) {
          total += rawToUsdc(sharesAtBpsToUsdcRaw(yesBal + yesEscrowForMarket, bestBidYes))
          priced = true
        }
        if ((noBal + noEscrowForMarket) > 0n && bestBidNo !== null) {
          total += rawToUsdc(sharesAtBpsToUsdcRaw(noBal + noEscrowForMarket, bestBidNo))
          priced = true
        }
        estimated = priced ? total : null
      }

      out.push({
        marketId: m.id,
        question: m.question,
        eventId: m.eventId,
        eventTitle: meta?.title ?? `Event ${m.eventId.toString()}`,
        category: meta?.category ?? '',
        closeTime: meta?.closeTime || m.closeTime,
        yesBalRaw: yesBal,
        noBalRaw: noBal,
        yesEscrowRaw: yesEscrowForMarket,
        noEscrowRaw: noEscrowForMarket,
        usdcEscrowRaw: usdcEscrowForMarket,
        status,
        winningOutcome: winning,
        bestBidYesBps: bestBidYes,
        bestBidNoBps: bestBidNo,
        estimatedValueUsdc: estimated,
        redeemableRaw: redeemable,
      })
    })
    // Redeemable winnings first, then open positions, then resolved-losing.
    out.sort((a, b) => {
      if (a.redeemableRaw > 0n && b.redeemableRaw === 0n) return -1
      if (b.redeemableRaw > 0n && a.redeemableRaw === 0n) return 1
      if (a.status !== b.status) return a.status === 'Open' ? -1 : 1
      return a.marketId - b.marketId
    })
    return out
  }, [
    allMarkets,
    discoveredEvents,
    resolutions,
    balances,
    bestBidYesByMarket,
    bestBidNoByMarket,
    escrowByMarket,
  ])

  /**
   * Top-of-page totals. We surface every meaningful capital bucket separately
   * so the user can see exactly where their money is sitting:
   *
   *   liquidUsdc        wallet USDC, freely spendable now
   *   usdcInOpenOffers  USDC locked behind unfilled BUY_* offers
   *   openPositionsUsd  YES/NO (wallet + escrow) marked to best bid
   *   resolvedUsd       resolved-winning shares × $1 (drops to 0 after auto-redeem)
   *   accountTotalUsd   sum of the four → total economic value
   *
   * `openPositionsUsd` excludes resolved markets (those are counted as
   * `resolvedUsd` to avoid double-counting).
   */
  const totals = useMemo(() => {
    const liquidUsdc = typeof usdcBalRaw === 'bigint' ? rawToUsdc(usdcBalRaw) : 0
    const usdcInOpenOffers = rawToUsdc(userUsdcEscrowRaw)
    let openPositionsUsd = 0
    let resolvedUsd = 0
    let totalRedeemableShares = 0n
    let openCount = 0
    let resolvedCount = 0
    for (const r of rows) {
      if (r.status === 'Resolved') {
        resolvedCount += 1
        if (r.estimatedValueUsdc) resolvedUsd += r.estimatedValueUsdc
        totalRedeemableShares += r.redeemableRaw
      } else {
        openCount += 1
        if (r.estimatedValueUsdc) openPositionsUsd += r.estimatedValueUsdc
      }
    }
    const accountTotalUsd = liquidUsdc + usdcInOpenOffers + openPositionsUsd + resolvedUsd
    return {
      liquidUsdc,
      usdcInOpenOffers,
      openPositionsUsd,
      resolvedUsd,
      accountTotalUsd,
      totalRedeemableShares,
      openCount,
      resolvedCount,
    }
  }, [rows, usdcBalRaw, userUsdcEscrowRaw])

  // ── 6. Auto-redeem on mount for every resolved market with winning shares ──
  // Guard with a Set so we don't double-submit when balances refetch.
  const redeemedRef = useRef<Set<string>>(new Set())
  const [autoRedeemBusy, setAutoRedeemBusy] = useState(false)
  const autoRedeemAll = useCallback(async () => {
    if (!contracts || !address || !walletClient || !publicClient) return
    const candidates = rows.filter((r) => r.redeemableRaw > 0n)
    if (candidates.length === 0) return
    setAutoRedeemBusy(true)
    try {
      for (const c of candidates) {
        const key = `${address.toLowerCase()}::${c.marketId}`
        if (redeemedRef.current.has(key)) continue
        redeemedRef.current.add(key)
        try {
          // Pre-flight simulate so we surface a precise error before the user
          // is asked to sign — same pattern as the trade page.
          await publicClient.simulateContract({
            address: contracts.manager.address,
            abi: contracts.manager.abi,
            functionName: 'redeem',
            args: [BigInt(c.marketId)],
            account: address,
          })
        } catch (err) {
          redeemedRef.current.delete(key)
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(`Redeem #${c.marketId} simulation failed`, { description: msg.slice(0, 140) })
          continue
        }
        toast.info(
          `Redeeming ${formatShares(c.redeemableRaw)} ${c.winningOutcome} from #${c.marketId}…`,
        )
        const res = await relayForward({
          walletClient,
          publicClient,
          chainId: arcTestnet.id,
          userAddress: address,
          forwarder: contracts.forwarder.address,
          forwarderAbi: contracts.forwarder.abi,
          target: contracts.manager.address,
          data: encodeRedeem(contracts.manager.abi, BigInt(c.marketId)),
        })
        if (res.ok && res.txHash) {
          await publicClient.waitForTransactionReceipt({ hash: res.txHash as `0x${string}` })
          toast.success(`Redeemed #${c.marketId}`)
        } else {
          redeemedRef.current.delete(key)
          toast.error(`Redeem #${c.marketId} failed`, { description: res.reason })
        }
      }
      await Promise.allSettled([refetchBalances(), refetchUsdcBal(), refetchOfferRows()])
    } finally {
      setAutoRedeemBusy(false)
    }
  }, [contracts, address, walletClient, publicClient, rows, refetchBalances, refetchUsdcBal, refetchOfferRows])

  // Fire-and-forget auto-redeem when redeemable rows appear. This catches the
  // first render after balances + resolutions load, and any subsequent refetch
  // that introduces a new winning position.
  useEffect(() => {
    if (!autoRedeemBusy && rows.some((r) => r.redeemableRaw > 0n)) {
      void autoRedeemAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, rows.map((r) => r.redeemableRaw.toString()).join(',')])

  const isLoading =
    (Boolean(contracts) && nextPending) ||
    (typeof nextMarketId === 'bigint' && nextMarketId > 0n && marketRowsPending) ||
    (Boolean(balanceArgs) && balancesPending)

  // ── Render ──
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
            <span className="text-muted-foreground text-sm hidden sm:block">/ Portfolio</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/markets">Markets</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/analytics">Analytics</Link>
            </Button>
            <div className="rounded-md border border-input bg-background px-2 py-1">
              {walletConnectProjectId ? (
                <ConnectButton chainStatus="icon" showBalance={false} />
              ) : isConnected && address ? (
                <span className="text-xs font-mono text-muted-foreground px-1">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground px-1">Not connected</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-12 max-w-5xl">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-primary uppercase tracking-widest">Portfolio</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3">Your positions</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            On-chain YES/NO shares the connected wallet currently holds. Winning shares from resolved
            markets are auto-redeemed when this page loads.
          </p>
        </div>

        {!isConnected || !address ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center">
            <Wallet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1">Connect your wallet</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Sign in to see the positions tied to your address.
            </p>
          </div>
        ) : !contracts ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center text-muted-foreground">
            Connect to Circle Arc Testnet to view your positions.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading positions…
          </div>
        ) : (
          <>
            {/* Headline total — sum of every USDC-denominated bucket. */}
            <div className="mb-6 rounded-2xl border border-border/50 bg-gradient-to-br from-primary/[0.06] to-card p-6 flex items-center justify-between gap-6 flex-wrap">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Total account value
                </div>
                <div className="text-4xl font-semibold mt-1">
                  {formatUsd(totals.accountTotalUsd)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Liquid USDC + open-offer escrow + open positions marked to best bid + redeemable winnings.
                </div>
              </div>
              <div className="text-xs text-muted-foreground max-w-xs text-right">
                Cost-basis PnL is coming once trade history is indexed per wallet — until then this
                page shows current value, not realised gain.
              </div>
            </div>

            {/* Capital-bucket breakdown */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <SummaryTile
                label="Liquid USDC"
                value={formatUsd(totals.liquidUsdc)}
                hint="In your wallet, ready to trade"
              />
              <SummaryTile
                label="In open offers"
                value={formatUsd(totals.usdcInOpenOffers)}
                hint="USDC escrowed behind your unfilled bids"
              />
              <SummaryTile
                label="Open positions"
                value={formatUsd(totals.openPositionsUsd)}
                hint={`${totals.openCount} market${totals.openCount === 1 ? '' : 's'} · valued at best bid`}
              />
              <SummaryTile
                label="Redeemable winnings"
                value={formatUsd(totals.resolvedUsd)}
                hint={
                  autoRedeemBusy
                    ? 'Submitting redeem txs…'
                    : totals.totalRedeemableShares > 0n
                      ? `${formatShares(totals.totalRedeemableShares)} shares queued · ${totals.resolvedCount} resolved`
                      : `${totals.resolvedCount} resolved · auto-redeemed`
                }
              />
            </div>

            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Briefcase className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">No positions yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
                    Pick a market on the markets page, buy YES or NO shares, and your position will
                    show up here automatically.
                  </p>
                </div>
                <Button asChild>
                  <Link href="/markets">Browse markets</Link>
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <div className="grid grid-cols-12 gap-3 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50 bg-background/30">
                  <div className="col-span-5">Market</div>
                  <div className="col-span-2 text-right">YES shares</div>
                  <div className="col-span-2 text-right">NO shares</div>
                  <div className="col-span-2 text-right">Value</div>
                  <div className="col-span-1 text-right">Open</div>
                </div>
                <ul className="divide-y divide-border/40">
                  {rows.map((r) => (
                    <li
                      key={r.marketId}
                      className={cn(
                        'grid grid-cols-12 gap-3 px-5 py-4 text-sm items-center',
                        r.status === 'Resolved' && 'bg-muted/20',
                      )}
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate" title={r.question}>
                            {r.question || `Market #${r.marketId}`}
                          </span>
                          {r.status === 'Resolved' && r.winningOutcome && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] font-semibold uppercase tracking-wider shrink-0',
                                r.winningOutcome === 'YES'
                                  ? 'text-success border-success/40 bg-success/5'
                                  : 'text-destructive border-destructive/40 bg-destructive/5',
                              )}
                            >
                              {r.winningOutcome} won
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.eventTitle}
                          {r.category && <span className="ml-1">· {r.category}</span>}
                          <span className="ml-1">· #{r.marketId}</span>
                        </div>
                      </div>
                      <SharesCell
                        liquid={r.yesBalRaw}
                        escrow={r.yesEscrowRaw}
                        struckOut={r.status === 'Resolved' && r.winningOutcome === 'NO' && (r.yesBalRaw + r.yesEscrowRaw) > 0n}
                      />
                      <SharesCell
                        liquid={r.noBalRaw}
                        escrow={r.noEscrowRaw}
                        struckOut={r.status === 'Resolved' && r.winningOutcome === 'YES' && (r.noBalRaw + r.noEscrowRaw) > 0n}
                      />
                      <div className="col-span-2 text-right">
                        {r.estimatedValueUsdc !== null ? (
                          <>
                            <span className="font-medium">{formatUsd(r.estimatedValueUsdc)}</span>
                            {r.status === 'Open' && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                @ best bid
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No bid yet</span>
                        )}
                        {r.usdcEscrowRaw > 0n && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            + {formatUsd(rawToUsdc(r.usdcEscrowRaw))} USDC in bids
                          </div>
                        )}
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          title="Open in trade view"
                        >
                          <Link href={`/trade?marketId=${r.marketId}`}>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions / hints */}
            <div className="mt-6 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <div>
                PnL with cost basis is coming once trade history is wired in. For now, value reflects
                in-wallet shares at resolution payout.
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  void Promise.allSettled([
                    refetchBalances(),
                    refetchUsdcBal(),
                    refetchNextOfferId(),
                    refetchOfferRows(),
                  ])
                }}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

/**
 * Two-line cell that shows total shares plus an optional "X liquid + Y in
 * offers" subline when the wallet has any escrowed shares for that side. The
 * `struckOut` flag is set on a resolved-losing position so the share count
 * gets a line-through to telegraph the $0 outcome.
 */
function SharesCell({
  liquid,
  escrow,
  struckOut,
}: {
  liquid: bigint
  escrow: bigint
  struckOut: boolean
}) {
  const total = liquid + escrow
  return (
    <div className="col-span-2 text-right font-mono">
      <span
        className={cn(
          struckOut ? 'text-muted-foreground line-through decoration-muted-foreground/40' : '',
        )}
      >
        {formatShares(total)}
      </span>
      {escrow > 0n && (
        <div className="text-[10px] text-muted-foreground mt-0.5 font-sans">
          {formatShares(liquid)} liquid + {formatShares(escrow)} in offers
        </div>
      )}
    </div>
  )
}
