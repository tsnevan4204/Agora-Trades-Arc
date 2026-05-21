'use client'

import { useCallback, useEffect, useMemo, useState, use } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid } from 'lucide-react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Loader2,
  Sparkles,
  SquareSplitHorizontal,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatUnits, maxUint256 } from 'viem'
import {
  useAccount,
  useConfig,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
  useWriteContract,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'
import { arcTestnet } from '@/lib/chains/arcTestnet'
import {
  arcAddEthereumChainParameter,
  arcChainMismatchMessage,
  ensureArcWalletChain,
} from '@/lib/ensure-arc-chain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { WalletApprovals } from '@/components/wallet-approvals'
import { factoryMarketReadContracts, parseMarketsFromMulticall } from '@/lib/markets-from-chain'
import { exchangeOfferReadContracts, parseOfferReadResults } from '@/lib/offers-from-chain'
import { explorerAddressUrl, explorerTxUrl } from '@/lib/explorer'
import { fetchBackendHealth } from '@/lib/agora-api'
import { walletConnectProjectId } from '@/lib/env'
import { mustGetContract } from '@/lib/contracts'
import { arcUsdcContract, usdcErc20Abi } from '@/lib/usdc'
import {
  encodeCancelOffer,
  encodeFillOffer,
  encodeMerge,
  encodePostOffer,
  encodeRedeem,
  encodeSplit,
  relayForward,
  shareUnits,
} from '@/lib/relay'
import { cn } from '@/lib/utils'

const OFFER_SCAN_WINDOW = 80n
const SIDE_LABELS = ['BUY YES', 'BUY NO', 'SELL YES', 'SELL NO'] as const

const erc20Abi = usdcErc20Abi

// ─── helpers ──────────────────────────────────────────────────────────────────

function bpsToPercent(bps: bigint | number) {
  return `${(Number(bps) / 100).toFixed(0)}%`
}

function fmtShares(raw: bigint) {
  return formatUnits(raw, 6)
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full',
        ok ? 'bg-success animate-pulse' : 'bg-destructive',
      )}
    />
  )
}

// ─── main component ────────────────────────────────────────────────────────────

export function TradeApp({ searchParams }: { searchParams?: Promise<{ marketId?: string }> }) {
  const { address, isConnected, status: connStatus } = useAccount()
  const router = useRouter()
  const config = useConfig()
  const chainId = useWalletChainId()
  const urlSearchParams = useSearchParams()
  const resolvedParams = searchParams ? use(searchParams) : null
  const urlMarketId = resolvedParams?.marketId ?? urlSearchParams?.get('marketId') ?? null
  const { connect, connectors, isPending: isConnectPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()

  // Auth guard — redirect to /signin if wallet is not connected
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!mounted) return
    if (connStatus === 'disconnected') {
      router.replace('/signin')
    }
  }, [mounted, connStatus, router])

  const injectedConnector = connectors.find((c) => c.id === 'injected')
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { writeContractAsync, isPending: isWritePending, data: txHash } = useWriteContract()

  // ── API & backend state ──
  const [health, setHealth] = useState<string>('…')
  const [lastRelayTx, setLastRelayTx] = useState<string | null>(null)
  const [relayPending, setRelayPending] = useState(false)

  // ── form state ──
  const [splitAmt, setSplitAmt] = useState('1')
  const [offerPrice, setOfferPrice] = useState('6000')
  const [offerSize, setOfferSize] = useState('10')
  const [fillOfferId, setFillOfferId] = useState('')
  const [fillAmt, setFillAmt] = useState('')
  const [cancelId, setCancelId] = useState('')
  const [marketId, setMarketId] = useState(() => {
    const parsed = urlMarketId !== null ? parseInt(urlMarketId, 10) : NaN
    return isNaN(parsed) ? 0 : parsed
  })

  // ── UI state ──
  const [tradeTab, setTradeTab] = useState<'buy' | 'sell'>('buy')
  const [outcomeTab, setOutcomeTab] = useState<'yes' | 'no'>('yes')
  const [obTab, setObTab] = useState<'yes' | 'no'>('yes')

  // ── derived ──
  const tradeSide = useMemo(
    () => (tradeTab === 'buy' ? (outcomeTab === 'yes' ? 0 : 1) : outcomeTab === 'yes' ? 2 : 3),
    [tradeTab, outcomeTab],
  )

  const estimatedCost = useMemo(() => {
    const price = Number(offerPrice) || 0
    const size = Number(offerSize) || 0
    if (!price || !size) return null
    return (size * (price / 10000)).toFixed(2)
  }, [offerPrice, offerSize])

  // ── contracts ──
  const contracts = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return {
        forwarder: mustGetContract(chainId, 'AgoraForwarder'),
        manager: mustGetContract(chainId, 'PredictionMarketManager'),
        exchange: mustGetContract(chainId, 'Exchange'),
        // Circle USDC on Arc testnet is at a canonical fixed address — not
        // deployed by us, so it's not in the hardhat-deploy bundle.
        usdc: arcUsdcContract,
        token: mustGetContract(chainId, 'OutcomeToken1155'),
        factory: mustGetContract(chainId, 'MarketFactory'),
      }
    } catch {
      return null
    }
  }, [chainId])

  const {
    data: nextMarketId,
    isPending: nextMarketIdPending,
    isError: nextMarketIdError,
  } = useReadContract({
    address: contracts?.factory.address,
    abi: contracts?.factory.abi,
    functionName: 'nextMarketId',
    query: { enabled: Boolean(contracts?.factory) },
  })

  const marketReadContracts = useMemo(
    () =>
      contracts?.factory && typeof nextMarketId === 'bigint' && nextMarketId > 0n
        ? factoryMarketReadContracts(contracts.factory.address, contracts.factory.abi, nextMarketId)
        : [],
    [contracts?.factory, nextMarketId],
  )

  const { data: marketRows, isPending: marketRowsPending } = useReadContracts({
    contracts: marketReadContracts,
    query: { enabled: marketReadContracts.length > 0 },
  })

  // True loading: nextMarketId is still fetching, OR we know there are markets but details haven't arrived yet
  const marketsPending =
    (Boolean(contracts?.factory) && nextMarketIdPending) ||
    (typeof nextMarketId === 'bigint' && nextMarketId > 0n && marketRowsPending)

  const discoveredMarkets = useMemo(
    () =>
      parseMarketsFromMulticall(
        typeof nextMarketId === 'bigint' ? nextMarketId : undefined,
        marketRows,
      ),
    [nextMarketId, marketRows],
  )

  useEffect(() => {
    if (discoveredMarkets.length === 0) return
    const ids = new Set(discoveredMarkets.map((m) => m.id))
    // If URL specified a valid marketId, keep it; otherwise fall back to first market
    if (!ids.has(marketId)) setMarketId(discoveredMarkets[0].id)
  }, [discoveredMarkets]) // eslint-disable-line react-hooks/exhaustive-deps

  const marketIdBn = BigInt(marketId)

  // ── Backend status polling ──
  const refreshBackendStatus = useCallback(async () => {
    const h = await fetchBackendHealth()
    if (h?.ok) setHealth(h.storage ? `ok · ${h.storage}` : 'ok')
    else setHealth('unreachable')
  }, [])

  useEffect(() => {
    void refreshBackendStatus()
    const t = setInterval(() => void refreshBackendStatus(), 15_000)
    return () => clearInterval(t)
  }, [refreshBackendStatus])

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  // ── balances / allowances ──
  const { data: usdcBal } = useReadContract({
    address: contracts?.usdc.address,
    abi: contracts?.usdc.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(contracts && address) },
  })

  const { data: allowanceMgr } = useReadContract({
    address: contracts?.usdc.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contracts ? [address, contracts.manager.address] : undefined,
    query: { enabled: Boolean(contracts && address) },
  })

  const { data: allowanceEx } = useReadContract({
    address: contracts?.usdc.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contracts ? [address, contracts.exchange.address] : undefined,
    query: { enabled: Boolean(contracts && address) },
  })

  const { data: yesTokenId } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'getYesTokenId',
    args: [marketIdBn],
    query: { enabled: Boolean(contracts) },
  })

  const { data: noTokenId } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'getNoTokenId',
    args: [marketIdBn],
    query: { enabled: Boolean(contracts) },
  })

  const { data: yesBal } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'balanceOf',
    args: address && yesTokenId !== undefined ? [address, yesTokenId] : undefined,
    query: { enabled: Boolean(contracts && address && yesTokenId !== undefined) },
  })

  const { data: noBal } = useReadContract({
    address: contracts?.token.address,
    abi: contracts?.token.abi,
    functionName: 'balanceOf',
    args: address && noTokenId !== undefined ? [address, noTokenId] : undefined,
    query: { enabled: Boolean(contracts && address && noTokenId !== undefined) },
  })

  // ── on-chain offers ──
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

  const offerReadContracts = useMemo(
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

  const { data: offerRows, isPending: offersScanPending, refetch: refetchOfferRows } = useReadContracts({
    contracts: offerReadContracts,
    query: { enabled: offerReadContracts.length > 0 },
  })

  useEffect(() => {
    if (!contracts?.exchange) return
    const t = setInterval(() => {
      void refetchNextOfferId()
      void refetchOfferRows()
    }, 8_000)
    return () => clearInterval(t)
  }, [contracts?.exchange, refetchNextOfferId, refetchOfferRows])

  const onchainOffers = useMemo(
    () => parseOfferReadResults(offerStartId, offerRows, marketIdBn),
    [offerStartId, offerRows, marketIdBn],
  )

  // Split by side for proper order book display
  const yesAsks = useMemo(
    () => onchainOffers.filter((o) => o.side === 2).sort((a, b) => Number(a.priceBps - b.priceBps)),
    [onchainOffers],
  )
  const yesBids = useMemo(
    () => onchainOffers.filter((o) => o.side === 0).sort((a, b) => Number(b.priceBps - a.priceBps)),
    [onchainOffers],
  )
  const noAsks = useMemo(
    () => onchainOffers.filter((o) => o.side === 3).sort((a, b) => Number(a.priceBps - b.priceBps)),
    [onchainOffers],
  )
  const noBids = useMemo(
    () => onchainOffers.filter((o) => o.side === 1).sort((a, b) => Number(b.priceBps - a.priceBps)),
    [onchainOffers],
  )

  const activeAsks = obTab === 'yes' ? yesAsks : noAsks
  const activeBids = obTab === 'yes' ? yesBids : noBids

  const bestAsk = activeAsks[0]?.priceBps
  const bestBid = activeBids[0]?.priceBps
  const spread =
    bestAsk !== undefined && bestBid !== undefined
      ? Number(bestAsk - bestBid)
      : null

  // ── actions ──
  const ensureArc = async () => {
    const ok = await ensureArcWalletChain(config)
    if (ok) return true
    toast.error('Switch to Arc Testnet first', {
      description: arcChainMismatchMessage(chainId),
    })
    return false
  }

  const approveUsdc = async (spender: `0x${string}`) => {
    if (!contracts || !address) return
    if (!(await ensureArc())) return
    await writeContractAsync({
      address: contracts.usdc.address,
      abi: erc20Abi,
      chainId: arcTestnet.id,
      functionName: 'approve',
      args: [spender, maxUint256],
    })
    toast.success('Approval submitted')
  }

  const runRelay = async (label: string, target: `0x${string}`, data: `0x${string}`) => {
    if (!contracts || !address || !walletClient || !publicClient) {
      toast.error('Connect wallet first')
      return
    }
    setRelayPending(true)
    try {
      if (!(await ensureArc())) return
      const res = await relayForward({
        walletClient,
        publicClient,
        chainId: arcTestnet.id,
        userAddress: address,
        forwarder: contracts.forwarder.address,
        forwarderAbi: contracts.forwarder.abi,
        target,
        data,
      })
      if (res.ok && res.txHash) {
        setLastRelayTx(res.txHash)
        toast.success(`${label} submitted`, { description: res.txHash.slice(0, 18) + '…' })
        await publicClient.waitForTransactionReceipt({ hash: res.txHash as `0x${string}` })
        void refetchNextOfferId()
        void refetchOfferRows()
      } else if (res.ok) {
        toast.success(`${label} submitted`)
      } else {
        toast.error(`${label} failed`, { description: res.reason })
      }
    } finally {
      setRelayPending(false)
    }
  }

  const onSplit = async () => {
    if (!contracts) return
    await runRelay('Split', contracts.manager.address, encodeSplit(contracts.manager.abi, marketIdBn, shareUnits(splitAmt)))
  }

  const onMerge = async () => {
    if (!contracts) return
    await runRelay('Merge', contracts.manager.address, encodeMerge(contracts.manager.abi, marketIdBn, shareUnits(splitAmt)))
  }

  const onRedeem = async () => {
    if (!contracts) return
    await runRelay('Redeem', contracts.manager.address, encodeRedeem(contracts.manager.abi, marketIdBn))
  }

  const onPostOffer = async () => {
    if (!contracts) return
    const price = BigInt(offerPrice)
    const amt = shareUnits(offerSize)
    const data = encodePostOffer(contracts.exchange.abi, marketIdBn, tradeSide, price, amt)
    await runRelay(SIDE_LABELS[tradeSide], contracts.exchange.address, data)
  }

  const onFill = async () => {
    if (!contracts || !fillOfferId) return
    const id = BigInt(fillOfferId)
    const amt = shareUnits(fillAmt)
    const data = encodeFillOffer(contracts.exchange.abi, id, amt)
    await runRelay(`Fill #${fillOfferId}`, contracts.exchange.address, data)
  }

  const onCancel = async () => {
    if (!contracts || !cancelId) return
    const data = encodeCancelOffer(contracts.exchange.abi, BigInt(cancelId))
    await runRelay(`Cancel #${cancelId}`, contracts.exchange.address, data)
  }

  const wrongChain = isConnected && chainId !== arcTestnet.id
  const apiOk = health.startsWith('ok')
  const isRelayBusy = relayPending || isWritePending || isConfirming

  const approveTxUrl = txHash ? explorerTxUrl(arcTestnet.id, txHash) : null
  const relayTxUrl = lastRelayTx ? explorerTxUrl(arcTestnet.id, lastRelayTx) : null

  const activeMarket = discoveredMarkets.find((x) => x.id === marketId)

  const needsManagerApproval = typeof allowanceMgr === 'bigint' && allowanceMgr === 0n
  const needsExchangeApproval = typeof allowanceEx === 'bigint' && allowanceEx === 0n
  const needsAnyApproval = needsManagerApproval || needsExchangeApproval

  function formatResolveDate(ts: number): string {
    if (!ts) return ''
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  // Show nothing (or a spinner) while wagmi is reconnecting or before mount
  if (!mounted || connStatus === 'connecting' || connStatus === 'reconnecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // After mount, if still not connected, the redirect effect fires — render nothing
  if (connStatus === 'disconnected') {
    return null
  }

  // Connected, on Arc, contracts present, but the factory has zero markets.
  // Don't drop the user into a non-functional trade UI — send them back to /markets.
  const noMarketsYet =
    isConnected &&
    !wrongChain &&
    Boolean(contracts?.factory) &&
    !nextMarketIdError &&
    typeof nextMarketId === 'bigint' &&
    nextMarketId === 0n
  if (noMarketsYet) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-bold">No markets to trade yet</h1>
          <p className="text-sm text-muted-foreground">
            The factory at{' '}
            <code className="text-xs bg-card px-1 rounded">
              {contracts?.factory.address.slice(0, 8)}…{contracts?.factory.address.slice(-4)}
            </code>{' '}
            on Circle Arc Testnet hasn't deployed any markets. Propose the first one,
            or browse the (empty) markets page.
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <Button asChild>
              <Link href="/admin">Open admin → propose market</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/markets">Back to markets</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Trading header ── */}
      <header className="sticky top-0 z-40 h-16 border-b border-border glass flex items-center gap-4 px-5">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="text-primary-foreground font-serif text-base font-bold">A</span>
          </div>
          <span className="font-serif text-xl font-semibold tracking-tight hidden sm:block">Agora</span>
        </Link>

        <Separator orientation="vertical" className="h-6 shrink-0" />

        {/* Market name */}
        <div className="flex-1 min-w-0">
          {activeMarket ? (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" title={activeMarket.question}>
                {activeMarket.question.length > 60 ? activeMarket.question.slice(0, 60) + '…' : activeMarket.question}
              </p>
              {activeMarket.closeTime > 0 && (
                <p className="text-xs text-muted-foreground">
                  Resolves {formatResolveDate(activeMarket.closeTime)} · #{activeMarket.id}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No market loaded</p>
          )}
        </div>

        {/* Status badges */}
        <div className="hidden md:flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StatusDot ok={apiOk} />
            API {apiOk ? 'live' : 'down'}
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot ok={isConnected && !wrongChain} />
            {isConnected && !wrongChain ? 'Arc Testnet' : 'Not connected'}
          </span>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/markets" className="flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Markets</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin">Admin</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/">Home</Link>
          </Button>
        </div>
      </header>

      {/* ── Alerts strip ── */}
      {(health === 'unreachable' || wrongChain || !contracts) && (
        <div className="px-5 pt-4 space-y-2">
          {health === 'unreachable' && (
            <Alert variant="destructive">
              <AlertTitle>Backend unreachable</AlertTitle>
              <AlertDescription>
                Make sure the FastAPI server is running and{' '}
                <code className="text-xs bg-background/40 px-1 rounded">NEXT_PUBLIC_BACKEND_URL</code>{' '}
                is correct.
              </AlertDescription>
            </Alert>
          )}
          {wrongChain && (
            <Alert>
              <AlertTitle>Wrong network</AlertTitle>
              <AlertDescription className="flex items-center gap-3 flex-wrap">
                <span>Switch to Circle Arc Testnet (chain {arcTestnet.id}).</span>
                <Button
                  size="sm"
                  onClick={() =>
                    void (async () => {
                      const ok = await ensureArcWalletChain(config)
                      if (ok) toast.success('Switched to Arc Testnet')
                      else {
                        try {
                          await switchChainAsync?.({
                            chainId: arcTestnet.id,
                            addEthereumChainParameter: arcAddEthereumChainParameter,
                          })
                          toast.success('Switched to Arc Testnet')
                        } catch (e: any) {
                          toast.error('Network switch failed', {
                            description: e?.shortMessage ?? arcChainMismatchMessage(chainId),
                          })
                        }
                      }
                    })()
                  }
                >
                  Switch network
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!contracts && chainId === arcTestnet.id && (
            <Alert variant="destructive">
              <AlertTitle>Contracts not found</AlertTitle>
              <AlertDescription>
                No ABI bundle for chain {arcTestnet.id}. Re-run{' '}
                <code className="text-xs bg-background/40 px-1 rounded">hardhat deploy --tags sync-frontend</code>.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* ── Main grid ── */}
      <main className="flex-1 grid lg:grid-cols-[390px_1fr] overflow-hidden">

        {/* ══ LEFT PANEL ══ */}
        <aside className="border-r border-border overflow-y-auto p-5 space-y-4">

          {/* ─ One-time wallet setup (shared component handles wrong-chain + approvals) ─ */}
          <WalletApprovals />

          {/* ─ All approved confirmation ─ */}
          {isConnected && !wrongChain && contracts && !needsAnyApproval && typeof allowanceMgr === 'bigint' && (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 border border-success/20 px-3 py-2 text-xs text-success">
              <span>✓</span>
              <span>Wallet ready — both approvals active</span>
            </div>
          )}

          {/* Market selector */}
          {contracts ? (
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">Market</h2>
              </div>

              {/* Still fetching from chain */}
              {marketsPending && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading markets from chain…
                </p>
              )}

              {/* RPC error */}
              {!marketsPending && nextMarketIdError && (
                <p className="text-xs text-destructive">
                  Could not reach Arc RPC. Check your network connection.
                </p>
              )}

              {/* No markets exist on-chain yet */}
              {!marketsPending && !nextMarketIdError && typeof nextMarketId === 'bigint' && nextMarketId === 0n && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    No markets have been created on-chain yet.
                  </p>
                  <Link href="/admin" className="text-xs text-primary hover:underline">
                    → Go to Admin to create the first market
                  </Link>
                </div>
              )}

              {/* Markets loaded */}
              {!marketsPending && discoveredMarkets.length > 0 && (
                <Select value={String(marketId)} onValueChange={(v) => setMarketId(Number(v))}>
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue placeholder="Select market" />
                  </SelectTrigger>
                  <SelectContent>
                    {discoveredMarkets.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        #{m.id} — {m.question.length > 72 ? m.question.slice(0, 72) + '…' : m.question}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>
          ) : (
            /* Not on Arc testnet */
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-1">
              <p className="text-xs font-medium text-destructive">Wrong network</p>
              <p className="text-xs text-muted-foreground">
                Switch your wallet to <span className="font-medium">Circle Arc Testnet</span> (chain {arcTestnet.id}) to trade.
              </p>
            </section>
          )}

          {/* ─ Order form ─ */}
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            {/* BUY / SELL tabs */}
            <div className="grid grid-cols-2">
              <button
                onClick={() => setTradeTab('buy')}
                className={cn(
                  'py-3 text-sm font-semibold transition-colors',
                  tradeTab === 'buy'
                    ? 'bg-success/15 text-success border-b-2 border-success'
                    : 'text-muted-foreground hover:text-foreground border-b border-border',
                )}
              >
                <TrendingUp className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Buy
              </button>
              <button
                onClick={() => setTradeTab('sell')}
                className={cn(
                  'py-3 text-sm font-semibold transition-colors',
                  tradeTab === 'sell'
                    ? 'bg-destructive/10 text-destructive border-b-2 border-destructive'
                    : 'text-muted-foreground hover:text-foreground border-b border-border',
                )}
              >
                <TrendingDown className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Sell
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* YES / NO outcome toggle */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Outcome</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['yes', 'no'] as const).map((o) => (
                    <button
                      key={o}
                      onClick={() => setOutcomeTab(o)}
                      className={cn(
                        'py-2 rounded-lg text-sm font-semibold border transition-all',
                        outcomeTab === o
                          ? o === 'yes'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted-foreground/20 text-foreground border-foreground/30'
                          : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30',
                      )}
                    >
                      {o.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Current action label */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Action</span>
                <Badge variant="secondary" className="text-xs font-mono">
                  {SIDE_LABELS[tradeSide]}
                </Badge>
              </div>

              {/* Price */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="price" className="text-xs text-muted-foreground">
                    Price (basis points)
                  </Label>
                  <span className="text-xs text-muted-foreground font-mono">
                    = {bpsToPercent(Number(offerPrice) || 0)}
                  </span>
                </div>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  max={10000}
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="font-mono"
                  placeholder="6000"
                />
              </div>

              {/* Size */}
              <div className="space-y-1.5">
                <Label htmlFor="size" className="text-xs text-muted-foreground">
                  Size (shares)
                </Label>
                <Input
                  id="size"
                  type="number"
                  min={0}
                  value={offerSize}
                  onChange={(e) => setOfferSize(e.target.value)}
                  className="font-mono"
                  placeholder="10"
                />
              </div>

              {/* Estimated cost / proceeds */}
              {estimatedCost && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {tradeTab === 'buy' ? 'Est. cost' : 'Est. proceeds'}
                  </span>
                  <span className="font-mono font-medium">~{estimatedCost} USDC</span>
                </div>
              )}

              {/* Submit */}
              <Button
                className={cn(
                  'w-full font-semibold transition-all',
                  tradeTab === 'buy'
                    ? 'bg-success hover:bg-success/90 text-white'
                    : 'bg-destructive hover:bg-destructive/90 text-white',
                )}
                disabled={!contracts || !walletClient || isRelayBusy}
                onClick={() => void onPostOffer()}
              >
                {isRelayBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {tradeTab === 'buy' ? (
                      <ArrowDownLeft className="w-4 h-4 mr-1.5" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 mr-1.5" />
                    )}
                    {SIDE_LABELS[tradeSide]}
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* ─ Portfolio actions (split / merge / redeem) ─ */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <SquareSplitHorizontal className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Portfolio</h2>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="splitAmt" className="text-xs text-muted-foreground">
                USDC amount (split / merge)
              </Label>
              <Input
                id="splitAmt"
                value={splitAmt}
                onChange={(e) => setSplitAmt(e.target.value)}
                className="font-mono"
                placeholder="1"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!contracts || !walletClient || isRelayBusy}
                onClick={() => void onSplit()}
                className="text-xs"
              >
                Split
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!contracts || !walletClient || isRelayBusy}
                onClick={() => void onMerge()}
                className="text-xs"
              >
                Merge
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!contracts || !walletClient || isRelayBusy}
                onClick={() => void onRedeem()}
                className="text-xs"
              >
                Redeem
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Split: USDC → YES + NO · Merge: YES + NO → USDC · Redeem: claim after resolution
            </p>
          </section>

          {/* ─ Wallet & approvals ─ */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Wallet</h2>
            </div>

            {walletConnectProjectId ? (
              <div className="flex flex-wrap items-center gap-3">
                <ConnectButton chainStatus="icon" showBalance={false} />
              </div>
            ) : (
              <>
                {!isConnected && (
                  <Button
                    className="w-full"
                    disabled={isConnectPending || !injectedConnector}
                    onClick={() => injectedConnector && connect({ connector: injectedConnector })}
                  >
                    {isConnectPending ? 'Connecting…' : 'Connect Browser Wallet'}
                  </Button>
                )}
                {isConnected && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono truncate text-muted-foreground">
                      {address}
                    </p>
                    <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => disconnect()}>
                      Disconnect
                    </Button>
                  </div>
                )}
              </>
            )}

            {isConnected && approveTxUrl && (
              <a
                href={approveTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline block mt-1"
              >
                View approval tx →
              </a>
            )}
          </section>

        </aside>

        {/* ══ RIGHT PANEL ══ */}
        <section className="overflow-y-auto p-5 space-y-4">

          {/* Top row: Order book + Positions */}
          <div className="grid xl:grid-cols-[1fr_260px] gap-4">

            {/* ─ Order Book ─ */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="font-semibold text-sm">Order Book</h2>
                <div className="flex items-center gap-3">
                  {offersScanPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  )}
                  {/* YES / NO toggle */}
                  <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                    {(['yes', 'no'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setObTab(t)}
                        className={cn(
                          'px-3 py-1.5 font-medium transition-colors',
                          obTab === t
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Asks (sells) */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-destructive/5">
                      <th className="px-4 py-2 text-left font-medium text-destructive/70">
                        Ask Price
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                        Size
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                        Maker
                      </th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {activeAsks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-muted-foreground text-center">
                          No asks
                        </td>
                      </tr>
                    ) : (
                      activeAsks.slice(0, 8).map((o) => (
                        <tr key={o.offerId} className="border-b border-border/30 hover:bg-destructive/5 transition-colors">
                          <td className="px-4 py-2 font-mono font-semibold text-destructive">
                            {bpsToPercent(o.priceBps)}
                          </td>
                          <td className="px-4 py-2 font-mono text-right">{fmtShares(o.remainingAmount)}</td>
                          <td className="px-4 py-2 font-mono text-right">
                            <a
                              href={explorerAddressUrl(arcTestnet.id, o.maker) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {o.maker.slice(0, 6)}…
                            </a>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => { setFillOfferId(String(o.offerId)); setFillAmt(fmtShares(o.remainingAmount)) }}
                            >
                              Fill
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Spread */}
              <div className="px-4 py-2 border-y border-border bg-muted/30 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Spread</span>
                <span className="text-xs font-mono font-medium">
                  {spread !== null ? `${(spread / 100).toFixed(1)}%` : '—'}
                </span>
                {bestAsk !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    Mid: {bpsToPercent((Number(bestAsk) + Number(bestBid ?? bestAsk)) / 2)}
                  </span>
                )}
              </div>

              {/* Bids (buys) */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-success/5">
                      <th className="px-4 py-2 text-left font-medium text-success/70">
                        Bid Price
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                        Size
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                        Maker
                      </th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {activeBids.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-muted-foreground text-center">
                          No bids
                        </td>
                      </tr>
                    ) : (
                      activeBids.slice(0, 8).map((o) => (
                        <tr key={o.offerId} className="border-b border-border/30 hover:bg-success/5 transition-colors">
                          <td className="px-4 py-2 font-mono font-semibold text-success">
                            {bpsToPercent(o.priceBps)}
                          </td>
                          <td className="px-4 py-2 font-mono text-right">{fmtShares(o.remainingAmount)}</td>
                          <td className="px-4 py-2 font-mono text-right">
                            <a
                              href={explorerAddressUrl(arcTestnet.id, o.maker) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {o.maker.slice(0, 6)}…
                            </a>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => { setFillOfferId(String(o.offerId)); setFillAmt(fmtShares(o.remainingAmount)) }}
                            >
                              Fill
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                  Scanning offer IDs {offerStartId.toString()}–{(typeof nextOfferId === 'bigint' && nextOfferId > 0n ? nextOfferId - 1n : 0n).toString()}
                </p>
              </div>
            </div>

            {/* ─ Positions & balances ─ */}
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="font-semibold text-sm">Positions</h2>

                {!isConnected ? (
                  <p className="text-xs text-muted-foreground">Connect wallet to view balances.</p>
                ) : (
                  <div className="space-y-2.5">
                    {[
                      {
                        label: 'USDC',
                        value:
                          typeof usdcBal === 'bigint' ? Number(formatUnits(usdcBal, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
                        color: 'text-foreground',
                      },
                      {
                        label: 'YES',
                        value:
                          typeof yesBal === 'bigint' ? fmtShares(yesBal) : '—',
                        color: 'text-success',
                      },
                      {
                        label: 'NO',
                        value:
                          typeof noBal === 'bigint' ? fmtShares(noBal) : '—',
                        color: 'text-muted-foreground',
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5"
                      >
                        <span className="text-xs text-muted-foreground font-medium">{row.label}</span>
                        <span className={cn('text-sm font-mono font-semibold', row.color)}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {isConnected && address && (
                  <p className="text-xs text-muted-foreground font-mono break-all">{address}</p>
                )}
              </div>

              {/* Last tx link */}
              {relayTxUrl && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-1.5">Last transaction</p>
                  <a
                    href={relayTxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline font-mono break-all"
                  >
                    {lastRelayTx?.slice(0, 20)}…
                  </a>
                </div>
              )}
            </div>
          </div>
          {/* ─ Fill / Cancel offers ─ */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h2 className="font-semibold text-sm">Fill / Cancel Offer</h2>
            <p className="text-xs text-muted-foreground">
              Click "Fill" on any order book row to populate these fields.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Fill form */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fill Offer</p>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="oid" className="text-xs text-muted-foreground">Offer ID</Label>
                    <Input
                      id="oid"
                      value={fillOfferId}
                      onChange={(e) => setFillOfferId(e.target.value)}
                      className="mt-1 font-mono text-sm"
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div>
                    <Label htmlFor="fa" className="text-xs text-muted-foreground">Fill size (shares)</Label>
                    <Input
                      id="fa"
                      value={fillAmt}
                      onChange={(e) => setFillAmt(e.target.value)}
                      className="mt-1 font-mono text-sm"
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!contracts || !walletClient || !fillOfferId || !fillAmt || isRelayBusy}
                  onClick={() => void onFill()}
                  className="w-full"
                >
                  {isRelayBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fill Offer'}
                </Button>
              </div>

              {/* Cancel form */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cancel Offer</p>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="cid" className="text-xs text-muted-foreground">Offer ID</Label>
                    <Input
                      id="cid"
                      value={cancelId}
                      onChange={(e) => setCancelId(e.target.value)}
                      className="mt-1 font-mono text-sm"
                      placeholder="e.g. 3"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!contracts || !walletClient || !cancelId || isRelayBusy}
                  onClick={() => void onCancel()}
                  className="w-full"
                >
                  {isRelayBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel Offer'}
                </Button>
              </div>
            </div>
          </div>

        </section>
      </main>
    </div>
  )
}
