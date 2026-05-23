'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAccount, useReadContracts } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { toast } from 'sonner'

import { arcTestnet } from '@/lib/chains/arcTestnet'
import { mustGetContract } from '@/lib/contracts'
import {
  managerResolutionReadContracts,
  parseResolutionsFromMulticall,
  type MarketResolution,
} from '@/lib/markets-from-chain'
import { useWalletChainId } from '@/hooks/use-wallet-chain-id'
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileCheck,
  Gavel,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  fetchAdminMe,
  fetchProposals,
  fetchProposal,
  getAdminToken,
  postAdminLogin,
  postApproveProposal,
  postRejectProposal,
  postResolveMarkets,
  setAdminToken,
  type ProposalMarketSpecPayload,
  type ProposalRecord,
} from '@/lib/agora-api'
import { backendBaseUrl } from '@/lib/env'
import { cn } from '@/lib/utils'

const DEFAULT_MARKETS_JSON = `[
  {
    "question": "Example EPS > $1.60?",
    "resolutionSpecHash": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "resolutionSpecURI": "ipfs://example/spec/0"
  }
]`

const DEFAULT_OUTCOMES_JSON = `{
  "0": "YES",
  "1": "NO"
}`

/**
 * Decode the small set of HTML entities the propose form serialises into
 * `suggestedRanges` (e.g. `&gt;`, `&lt;`, `&amp;`). Keeps things readable when
 * the admin sees the prefilled question.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * Build a default Markets JSON array from the raw proposal so the admin sees
 * one market per `suggestedRange` instead of a generic example. The spec hash
 * is deterministic per (proposalId, index, question) — non-zero and unique
 * enough for the factory to accept it; the admin can still edit before approving.
 */
function buildMarketsJsonFromProposal(p: ProposalRecord): string {
  const ranges = Array.isArray(p.suggestedRanges)
    ? (p.suggestedRanges as unknown[]).map((r) => String(r))
    : []

  const decoded = ranges
    .map((r) => decodeEntities(r).trim())
    .filter((r) => r.length > 0)

  if (decoded.length === 0) return DEFAULT_MARKETS_JSON

  const markets = decoded.map((question, i) => {
    const seed = `${p.proposalId}:${i}:${question}`
    const specHash = keccak256(toBytes(seed))
    return {
      question,
      resolutionSpecHash: specHash,
      resolutionSpecURI: `ipfs://agora/proposals/${p.proposalId}/markets/${i}`,
    }
  })

  return JSON.stringify(markets, null, 2)
}

/**
 * Parse a binary question / range like:
 *   "EPS > $1.60?"       → { kind: 'gt', n: 1.60 }
 *   "EPS < $1.40?"       → { kind: 'lt', n: 1.40 }
 *   "EPS $1.50–$1.60?"   → { kind: 'between', lo: 1.50, hi: 1.60 }
 *   "Rate >= 5.25%?"     → { kind: 'gte', n: 5.25 }
 *
 * Strips currency symbols (`$`), percent signs, commas, the trailing `?`, and
 * common HTML entities (`&gt;`, `&lt;`). Returns `unknown` for questions whose
 * truthiness can't be derived from a single numeric value (e.g. yes/no
 * categorical questions); those default to NO and the admin can override.
 */
type ParsedQuestion =
  | { kind: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; n: number }
  | { kind: 'between'; lo: number; hi: number }
  | { kind: 'unknown' }

function parseQuestion(qRaw: string): ParsedQuestion {
  const s = decodeEntities(qRaw)
    .replace(/[$%,?]/g, '')
    .trim()

  // Range first: "1.50–1.60", "1.50-1.60", "1.50 to 1.60", em-dash.
  const between = s.match(/(-?\d+(?:\.\d+)?)\s*(?:–|—|-|to)\s*(-?\d+(?:\.\d+)?)/i)
  if (between) {
    const a = parseFloat(between[1])
    const b = parseFloat(between[2])
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      return { kind: 'between', lo: Math.min(a, b), hi: Math.max(a, b) }
    }
  }
  const gte = s.match(/(?:>=|≥|>\s*=)\s*(-?\d+(?:\.\d+)?)/)
  if (gte) return { kind: 'gte', n: parseFloat(gte[1]) }
  const lte = s.match(/(?:<=|≤|<\s*=)\s*(-?\d+(?:\.\d+)?)/)
  if (lte) return { kind: 'lte', n: parseFloat(lte[1]) }
  const gt = s.match(/>\s*(-?\d+(?:\.\d+)?)/)
  if (gt) return { kind: 'gt', n: parseFloat(gt[1]) }
  const lt = s.match(/<\s*(-?\d+(?:\.\d+)?)/)
  if (lt) return { kind: 'lt', n: parseFloat(lt[1]) }
  const eq = s.match(/=\s*(-?\d+(?:\.\d+)?)/)
  if (eq) return { kind: 'eq', n: parseFloat(eq[1]) }
  return { kind: 'unknown' }
}

/**
 * Decide YES / NO for a single binary market when the reported numeric value
 * is known. Returns `null` for questions we can't auto-evaluate.
 *
 * Between buckets are inclusive on both ends — most ranges admins write are
 * non-overlapping in practice (e.g. "$1.40–$1.50?", "$1.50–$1.60?"), and on
 * the rare boundary value the admin can flip the toggle before submitting.
 */
function evaluateForValue(parsed: ParsedQuestion, value: number): 'YES' | 'NO' | null {
  switch (parsed.kind) {
    case 'gt':
      return value > parsed.n ? 'YES' : 'NO'
    case 'gte':
      return value >= parsed.n ? 'YES' : 'NO'
    case 'lt':
      return value < parsed.n ? 'YES' : 'NO'
    case 'lte':
      return value <= parsed.n ? 'YES' : 'NO'
    case 'between':
      return value >= parsed.lo && value <= parsed.hi ? 'YES' : 'NO'
    case 'eq':
      return value === parsed.n ? 'YES' : 'NO'
    default:
      return null
  }
}

function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Default close = 7 days from now, for `<input type="datetime-local">`. */
function defaultCloseTimeLocal(): string {
  return formatDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
}

/** Earliest selectable close = now (browser + on-chain require future close). */
function minCloseTimeLocal(): string {
  return formatDateTimeLocal(new Date())
}

// ─── Login wall ─────────────────────────────────────────────────────────────

function LoginWall({ onAuth }: { onAuth: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    // Trade credentials for a backend-signed bearer. `postAdminLogin` caches
    // the token in sessionStorage on success; subsequent admin API calls
    // pick it up automatically via the `adminHeaders` helper.
    const res = await postAdminLogin({ username: username.trim(), password })
    setLoading(false)
    if (res.error) {
      setError(
        res.error.toLowerCase().includes('not configured')
          ? 'Admin auth not configured on backend. Set ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_SESSION_SECRET in .env and restart.'
          : res.error || 'Invalid credentials. Please try again.',
      )
      return
    }
    onAuth()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background via-background to-muted/30 px-6">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 mb-10 group">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
          <span className="text-primary-foreground font-serif text-xl font-bold">A</span>
        </div>
        <span className="font-serif text-2xl font-semibold tracking-tight">Agora</span>
      </Link>

      <div className="w-full max-w-sm glass rounded-2xl border border-border/60 p-8 shadow-xl shadow-primary/5 space-y-6">
        <div className="space-y-1 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <h1 className="font-serif text-2xl font-bold">Admin Access</h1>
          <p className="text-sm text-muted-foreground">
            Restricted area — authorised personnel only.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-user" className="text-sm">Username</Label>
            <Input
              id="admin-user"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-pw" className="text-sm">Password</Label>
            <div className="relative">
              <Input
                id="admin-pw"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              <X className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading || !username || !password}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
          </Button>
        </form>

        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground text-center max-w-xs">
        This panel performs on-chain and backend operations. Never expose to the public internet without proper authentication.
      </p>
    </div>
  )
}

// ─── Main admin console ──────────────────────────────────────────────────────

export function AdminConsole() {
  const { address } = useAccount()
  const [authenticated, setAuthenticated] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    // Validate any cached token against the backend before assuming the
    // admin session is still good. `fetchAdminMe` returns null and clears
    // the token on a 401, so an expired/forged token can't trick the UI
    // into rendering the admin pages.
    let cancelled = false
    void (async () => {
      const token = getAdminToken()
      if (!token) {
        if (!cancelled) setAuthChecked(true)
        return
      }
      const me = await fetchAdminMe()
      if (cancelled) return
      setAuthenticated(Boolean(me))
      setAuthChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = () => {
    setAdminToken(null)
    setAuthenticated(false)
  }

  // ── Proposal list state ──
  const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Per-proposal action state (keyed by proposalId) ──
  const [closeLocals, setCloseLocals] = useState<Record<string, string>>({})
  const [marketsJsons, setMarketsJsons] = useState<Record<string, string>>({})
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // ── Confirmed-by (shared) ──
  const [confirmedBy, setConfirmedBy] = useState('')

  // ── Resolution state ──
  const [eventId, setEventId] = useState('0')
  const [resolveMarketIds, setResolveMarketIds] = useState('0')
  const [outcomesJson, setOutcomesJson] = useState(DEFAULT_OUTCOMES_JSON)
  const [resolveReason, setResolveReason] = useState('')

  // Approved-proposal picker (resolution prefill).
  const [approvedProposals, setApprovedProposals] = useState<ProposalRecord[]>([])
  const [selectedApprovedId, setSelectedApprovedId] = useState<string>('')

  // ── On-chain resolution status for approved proposals ──
  // We need this both to (a) filter already-resolved events out of the dropdown
  // so the admin can't double-resolve, and (b) re-render the post-resolve UI
  // without a manual refresh. We read `PredictionMarketManager.markets(id)`
  // for every market id referenced by any approved proposal.
  const chainId = useWalletChainId()
  const managerContract = useMemo(() => {
    try {
      if (chainId !== arcTestnet.id) return null
      return mustGetContract(chainId, 'PredictionMarketManager')
    } catch {
      return null
    }
  }, [chainId])

  // Flat, deduped list of (proposalId → marketIds) gathered from approved
  // proposals' on-chain envelope. Order is preserved so we can map results
  // back to (proposalId, marketId) without extra bookkeeping.
  const approvedMarketIds = useMemo(() => {
    const ids = new Set<number>()
    for (const p of approvedProposals) {
      const onChain = (p.onChain ?? {}) as { marketIds?: number[] }
      if (Array.isArray(onChain.marketIds)) {
        for (const m of onChain.marketIds) if (typeof m === 'number') ids.add(m)
      }
    }
    return Array.from(ids).sort((a, b) => a - b)
  }, [approvedProposals])

  // Multicall returns one tuple per marketId. We translate the largest id
  // into a synthetic `nextMarketId` so the existing parser can iterate from 0
  // and we only look at the ids we care about.
  const maxMarketId = approvedMarketIds.length > 0 ? approvedMarketIds[approvedMarketIds.length - 1] : -1
  const resolutionReadContracts = useMemo(() => {
    if (!managerContract || maxMarketId < 0) return []
    return managerResolutionReadContracts(
      managerContract.address,
      managerContract.abi,
      BigInt(maxMarketId + 1),
    )
  }, [managerContract, maxMarketId])

  const { data: resolutionRows, refetch: refetchResolutionRows } = useReadContracts({
    contracts: resolutionReadContracts,
    query: {
      enabled: resolutionReadContracts.length > 0,
      // Re-poll every 8s so the dropdown self-heals after an external resolve.
      refetchInterval: 8_000,
    },
  })

  const resolutionByMarketId = useMemo(() => {
    const arr = parseResolutionsFromMulticall(
      maxMarketId >= 0 ? BigInt(maxMarketId + 1) : undefined,
      resolutionRows,
    )
    const map = new Map<number, MarketResolution>()
    for (const r of arr) map.set(r.marketId, r)
    return map
  }, [maxMarketId, resolutionRows])

  /**
   * `approved` ∩ `not-yet-resolved-on-chain`. An event is considered
   * still-resolvable if at least one of its markets is still Open. Fully
   * resolved events are hidden so the admin can't submit `resolve()` again
   * (which would revert with `PredictionMarketManager__MarketResolved()`).
   */
  const unresolvedApprovedProposals = useMemo(() => {
    if (resolutionByMarketId.size === 0) return approvedProposals
    return approvedProposals.filter((p) => {
      const onChain = (p.onChain ?? {}) as { marketIds?: number[] }
      const mids = Array.isArray(onChain.marketIds) ? onChain.marketIds : []
      if (mids.length === 0) return true
      return mids.some((m) => (resolutionByMarketId.get(m)?.status ?? 'Open') === 'Open')
    })
  }, [approvedProposals, resolutionByMarketId])
  // Map of marketId (string) → 'YES' | 'NO'. Drives the per-market toggles and
  // the auto-derived Outcomes JSON. Source of truth once a proposal is picked.
  const [outcomeByMarketId, setOutcomeByMarketId] = useState<Record<string, 'YES' | 'NO'>>({})
  // Optional reported numeric value used to auto-fill the YES/NO toggles
  // against the parsed `suggestedRanges` for the picked proposal.
  const [reportedValue, setReportedValue] = useState('')

  useEffect(() => {
    setConfirmedBy((prev) => (prev === '' && address ? address : prev))
  }, [address])

  const loadProposals = async () => {
    setProposalsLoading(true)
    try {
      const [pending, approved] = await Promise.all([
        fetchProposals('pending'),
        fetchProposals('approved'),
      ])
      setPendingProposals(pending)
      setApprovedProposals(approved)
      // Seed the per-proposal Markets JSON from suggestedRanges, but never
      // overwrite an entry the admin has already edited in this session.
      setMarketsJsons((prev) => {
        const next = { ...prev }
        for (const p of pending) {
          if (next[p.proposalId] === undefined) {
            next[p.proposalId] = buildMarketsJsonFromProposal(p)
          }
        }
        return next
      })
      if (pending.length === 0) toast.info('No pending proposals found')
    } finally {
      setProposalsLoading(false)
    }
  }

  // Back-compat alias: existing call sites still use this name.
  const loadPendingProposals = loadProposals

  // Auto-load on mount when authenticated
  useEffect(() => {
    if (authenticated) void loadProposals()
  }, [authenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the Outcomes JSON textarea in sync whenever the per-market toggles
  // change. The admin can still hand-edit the textarea afterward — it just
  // gets overwritten next time they change a toggle or reported value.
  useEffect(() => {
    const keys = Object.keys(outcomeByMarketId)
    if (keys.length === 0) return
    setOutcomesJson(JSON.stringify(outcomeByMarketId, null, 2))
  }, [outcomeByMarketId])

  // When admin types a Reported value, auto-evaluate each market's question
  // against it. Markets whose questions don't parse are left at NO.
  useEffect(() => {
    if (!selectedApprovedId) return
    const proposal = approvedProposals.find((x) => x.proposalId === selectedApprovedId)
    if (!proposal) return
    const num = parseFloat(reportedValue)
    if (Number.isNaN(num)) return

    const ranges = Array.isArray(proposal.suggestedRanges)
      ? proposal.suggestedRanges.map((r) => decodeEntities(String(r)))
      : []
    const onChain = (proposal.onChain ?? {}) as { marketIds?: number[] }
    const mids = Array.isArray(onChain.marketIds) ? onChain.marketIds : []

    const next: Record<string, 'YES' | 'NO'> = {}
    for (let i = 0; i < mids.length; i++) {
      const parsed = parseQuestion(ranges[i] ?? '')
      next[String(mids[i])] = evaluateForValue(parsed, num) ?? 'NO'
    }
    setOutcomeByMarketId(next)
  }, [reportedValue, selectedApprovedId, approvedProposals])

  const onPickApprovedProposal = (pid: string) => {
    setSelectedApprovedId(pid)
    const proposal = approvedProposals.find((x) => x.proposalId === pid)
    if (!proposal) return
    const onChain = (proposal.onChain ?? {}) as {
      eventId?: number
      marketIds?: number[]
    }
    const mids = Array.isArray(onChain.marketIds) ? onChain.marketIds : []
    if (typeof onChain.eventId === 'number') setEventId(String(onChain.eventId))
    if (mids.length > 0) setResolveMarketIds(mids.join(', '))
    const seeded: Record<string, 'YES' | 'NO'> = {}
    for (const mid of mids) seeded[String(mid)] = 'NO'
    setOutcomeByMarketId(seeded)
    setReportedValue('')
  }

  if (!authChecked) return null

  if (!authenticated) {
    return <LoginWall onAuth={() => setAuthenticated(true)} />
  }

  // ── Actions ──
  const approve = async (pid: string) => {
    const by = confirmedBy.trim()
    if (!by) { toast.error('Set "Confirmed by" address'); return }
    const proposal = pendingProposals.find((x) => x.proposalId === pid)
    const fallbackJson = proposal ? buildMarketsJsonFromProposal(proposal) : DEFAULT_MARKETS_JSON
    const mj = marketsJsons[pid] ?? fallbackJson
    const cl = closeLocals[pid] ?? ''
    let markets: ProposalMarketSpecPayload[]
    try {
      markets = JSON.parse(mj) as ProposalMarketSpecPayload[]
      if (!Array.isArray(markets) || markets.length === 0) throw new Error('must be a non-empty array')
    } catch (e) {
      toast.error('Invalid Markets JSON', { description: String(e) }); return
    }
    const t = cl ? Math.floor(new Date(cl).getTime() / 1000) : 0
    if (!t || Number.isNaN(t)) { toast.error('Set a valid close time'); return }
    if (new Date(cl).getTime() <= Date.now()) {
      toast.error('Close time must be in the future', {
        description: 'The factory rejects past close times. Pick a date/time after now.',
      })
      return
    }
    setActionLoadingId(pid)
    try {
      const res = await postApproveProposal(pid, { confirmedBy: by, closeTimeUnix: t, markets })
      if (res.error) toast.error(res.error, { description: JSON.stringify(res.detail) })
      else {
        toast.success('Proposal approved — market created on-chain')
        void loadPendingProposals()
      }
    } finally {
      setActionLoadingId(null)
    }
  }

  const reject = async (pid: string) => {
    const by = confirmedBy.trim()
    if (!by) { toast.error('Set "Confirmed by" address'); return }
    const reason = rejectReasons[pid]?.trim() ?? ''
    if (!reason) { toast.error('Rejection reason required'); return }
    setActionLoadingId(pid)
    try {
      const res = await postRejectProposal(pid, { confirmedBy: by, reason })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Proposal rejected')
        void loadPendingProposals()
      }
    } finally {
      setActionLoadingId(null)
    }
  }

  const resolve = async () => {
    const by = confirmedBy.trim()
    if (!by) { toast.error('Set "Confirmed by" address'); return }
    let outcomes: Record<string, string>
    try {
      outcomes = JSON.parse(outcomesJson) as Record<string, string>
    } catch (e) {
      toast.error('Invalid Outcomes JSON', { description: String(e) })
      return
    }
    const mids = resolveMarketIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map(Number)
    if (mids.some((n) => Number.isNaN(n))) { toast.error('Market IDs must be numbers'); return }
    const eid = Number(eventId)
    if (Number.isNaN(eid)) { toast.error('Invalid event ID'); return }
    setActionLoadingId('resolve')
    try {
      const res = await postResolveMarkets(eid, { confirmedBy: by, marketIds: mids, outcomes, reason: resolveReason.trim() || null })

      // The backend persists the resolution record + returns HTTP 200 even when
      // the on-chain `resolve()` call fails (e.g. RESOLVER_PRIVATE_KEY missing,
      // wallet not the on-chain resolver, market already resolved → revert).
      // We have to inspect `res.onChain` to know whether anything actually
      // landed on-chain — otherwise the admin sees a misleading "submitted"
      // success and the resolved-event UI stays stale.
      if (res.error) {
        toast.error(res.error, { description: JSON.stringify(res.detail) })
        return
      }

      const oc = res.onChain ?? {}
      if (oc.skipped) {
        toast.error('On-chain resolve skipped by backend', {
          description: oc.reason ?? 'Set RESOLVER_PRIVATE_KEY, MANAGER_ADDRESS and RPC_URL on the backend.',
        })
        return
      }
      if (oc.overall === 'error') {
        toast.error('On-chain resolve failed', { description: oc.error ?? 'Backend caught an exception during resolve().' })
        return
      }
      if (oc.overall === 'failed' || oc.overall === 'partial_failure') {
        const txs = oc.txRecords ?? []
        const failed = txs.filter((r) => !r.ok)
        const lines = failed
          .slice(0, 3)
          .map((r) => `#${r.market_id}: ${r.error ?? 'reverted'}`)
          .join(' · ')
        toast.error(
          oc.overall === 'partial_failure'
            ? `Only ${txs.length - failed.length}/${txs.length} markets resolved on-chain`
            : 'All resolve() calls reverted on-chain',
          { description: lines || 'See backend logs for details.' },
        )
        // Still refresh — the successful slice (if any) updated chain state.
        await refetchResolutionRows()
        return
      }

      // overall === 'confirmed'
      toast.success('Resolution confirmed on-chain', {
        description: res.evidenceHash ? res.evidenceHash.slice(0, 18) + '…' : undefined,
      })
      // Refresh on-chain status + the approved-proposals list so the picker
      // and Outcomes JSON no longer reference the just-resolved markets.
      await Promise.allSettled([refetchResolutionRows(), loadProposals()])
      // Clear the selection so the next resolve starts clean.
      setSelectedApprovedId('')
      setOutcomeByMarketId({})
      setReportedValue('')
    } finally {
      setActionLoadingId(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 h-16 border-b border-border glass flex items-center px-6 gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="text-primary-foreground font-serif text-base font-bold">A</span>
          </div>
          <span className="font-serif text-xl font-semibold tracking-tight hidden sm:block">Agora</span>
        </Link>

        <Separator orientation="vertical" className="h-6 shrink-0" />

        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Admin Console</span>
          <Badge variant="outline" className="text-xs hidden sm:inline-flex">Ops Only</Badge>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono">{backendBaseUrl}</span>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/trade">Trade</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/portfolio">Portfolio</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">Home</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </Button>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 container mx-auto px-6 py-8 max-w-4xl space-y-6">

        {/* Warning banner */}
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Restricted access</AlertTitle>
          <AlertDescription>
            Actions here trigger on-chain transactions and backend state changes via your Python relayer.
            Approve/reject/resolve are irreversible operations — verify all inputs carefully.
          </AlertDescription>
        </Alert>

        {/* Confirmed-by address (shared across all actions) */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Operator Identity</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            This address is recorded as the confirming authority on every action below.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cby" className="text-xs text-muted-foreground">Confirmed by (wallet address)</Label>
            <Input
              id="cby"
              value={confirmedBy}
              onChange={(e) => setConfirmedBy(e.target.value)}
              placeholder="0x…"
              className="font-mono text-sm"
            />
          </div>
        </div>

        {/* Main tabs */}
        <Tabs defaultValue="proposals">
          <TabsList className="w-full">
            <TabsTrigger value="proposals" className="flex-1 gap-2">
              <FileCheck className="w-4 h-4" />
              Proposals
            </TabsTrigger>
            <TabsTrigger value="resolution" className="flex-1 gap-2">
              <Gavel className="w-4 h-4" />
              Resolution
            </TabsTrigger>
          </TabsList>

          {/* ── Proposals tab ── */}
          <TabsContent value="proposals" className="space-y-5 mt-5">

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Pending Proposals</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingProposals.length === 0
                    ? 'No pending proposals'
                    : `${pendingProposals.length} awaiting review`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={proposalsLoading}
                onClick={() => void loadPendingProposals()}
              >
                {proposalsLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </Button>
            </div>

            {proposalsLoading && pendingProposals.length === 0 && (
              <div className="flex items-center justify-center h-32 text-muted-foreground gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading proposals…
              </div>
            )}

            {!proposalsLoading && pendingProposals.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No pending proposals — check back later or refresh.
              </div>
            )}

            {/* Proposal cards */}
            {pendingProposals.map((p) => {
              const isExpanded = expandedId === p.proposalId
              const isBusy = actionLoadingId === p.proposalId
              const mj = marketsJsons[p.proposalId] ?? buildMarketsJsonFromProposal(p)
              const cl = closeLocals[p.proposalId] ?? ''
              const rr = rejectReasons[p.proposalId] ?? ''

              return (
                <div
                  key={p.proposalId}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  {/* Card header — always visible */}
                  <button
                    className="w-full flex items-start gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      const next = isExpanded ? null : p.proposalId
                      setExpandedId(next)
                      if (next) {
                        setCloseLocals((prev) =>
                          prev[p.proposalId] !== undefined
                            ? prev
                            : { ...prev, [p.proposalId]: defaultCloseTimeLocal() },
                        )
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-mono shrink-0">
                          {p.proposalId.slice(0, 8)}…
                        </Badge>
                        <Badge className="text-xs bg-amber-500/15 text-amber-600 border-amber-400/30 shrink-0">
                          pending
                        </Badge>
                        {p.category && (
                          <Badge variant="secondary" className="text-xs shrink-0">{p.category}</Badge>
                        )}
                      </div>
                      <p className="font-semibold text-sm leading-snug">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.ticker && <span className="font-mono mr-2">{p.ticker}</span>}
                        {p.metric && <span className="mr-2">{p.metric}</span>}
                        {p.proposerAddress && (
                          <span className="font-mono">{p.proposerAddress.slice(0, 10)}…</span>
                        )}
                      </p>
                      {p.submittedAtUtc && (
                        <p className="text-xs text-muted-foreground">
                          Submitted {new Date(p.submittedAtUtc).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 mt-0.5 text-muted-foreground">
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4" />
                        : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {/* Expanded action area */}
                  {isExpanded && (
                    <div className="border-t border-border p-5 space-y-5 bg-muted/20">

                      {/* Raw data */}
                      <details className="group">
                        <summary className="text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                          Raw proposal data
                        </summary>
                        <pre className="mt-2 text-xs bg-muted/50 p-4 rounded-xl overflow-x-auto max-h-48 font-mono leading-relaxed">
                          {JSON.stringify(p, null, 2)}
                        </pre>
                      </details>

                      {/* Approve form */}
                      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-success">Approve</p>
                          <Badge className="text-xs bg-success/15 text-success border-success/30">Creates on-chain market</Badge>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Market close time (local)</Label>
                          <Input
                            type="datetime-local"
                            value={cl || defaultCloseTimeLocal()}
                            min={minCloseTimeLocal()}
                            onChange={(e) =>
                              setCloseLocals((prev) => ({ ...prev, [p.proposalId]: e.target.value }))
                            }
                            className="max-w-xs text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Must be after now — on-chain <code className="font-mono">createEvent</code> rejects past close times.
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Markets JSON — array of market specs</Label>
                          <Textarea
                            value={mj}
                            onChange={(e) =>
                              setMarketsJsons((prev) => ({ ...prev, [p.proposalId]: e.target.value }))
                            }
                            className="min-h-[120px] font-mono text-xs leading-relaxed"
                          />
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-muted-foreground">
                              Prefilled from <code className="font-mono">suggestedRanges</code>. Edit before approving if needed.
                            </p>
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                              onClick={() =>
                                setMarketsJsons((prev) => ({
                                  ...prev,
                                  [p.proposalId]: buildMarketsJsonFromProposal(p),
                                }))
                              }
                            >
                              Reset to proposal
                            </button>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="bg-success hover:bg-success/90 text-white gap-2"
                          disabled={isBusy || !confirmedBy.trim()}
                          onClick={() => void approve(p.proposalId)}
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <CheckCircle className="w-3.5 h-3.5" />}
                          Approve + create on-chain
                        </Button>
                      </div>

                      {/* Reject form */}
                      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-destructive">Reject</p>
                          <Badge variant="destructive" className="text-xs">Irreversible</Badge>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Rejection reason</Label>
                          <Input
                            value={rr}
                            onChange={(e) =>
                              setRejectReasons((prev) => ({ ...prev, [p.proposalId]: e.target.value }))
                            }
                            placeholder="Reason for rejection…"
                            className="text-sm"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy || !rr.trim() || !confirmedBy.trim()}
                          onClick={() => void reject(p.proposalId)}
                          className="gap-2"
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <X className="w-3.5 h-3.5" />}
                          Reject Proposal
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </TabsContent>

          {/* ── Resolution tab ── */}
          <TabsContent value="resolution" className="space-y-5 mt-5">
            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Resolve Markets</h3>
                <Badge variant="outline" className="text-xs">
                  POST /resolution/resolve/{'{eventId}'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick an approved event, optionally enter the reported numeric value, then
                review the YES/NO toggle for each market and submit. The backend records
                the decision (with an evidence hash) and calls{' '}
                <code className="text-[10px] bg-background/40 px-1 rounded">
                  Manager.resolve()
                </code>{' '}
                for each market when the resolver wallet is configured.
              </p>

              {/* ── Approved-proposal picker ── */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Approved event ({unresolvedApprovedProposals.length} unresolved · {approvedProposals.length} total)
                </Label>
                {approvedProposals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No approved proposals found. Approve a proposal first, then come back.
                  </p>
                ) : unresolvedApprovedProposals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    All approved proposals are fully resolved on-chain. Approve a new event to
                    resolve another market.
                  </p>
                ) : (
                  <Select
                    value={selectedApprovedId}
                    onValueChange={onPickApprovedProposal}
                  >
                    <SelectTrigger className="w-full text-sm">
                      <SelectValue placeholder="Choose an approved proposal…" />
                    </SelectTrigger>
                    <SelectContent>
                      {unresolvedApprovedProposals.map((p) => {
                        const oc = (p.onChain ?? {}) as {
                          eventId?: number
                          marketIds?: number[]
                        }
                        const eid =
                          typeof oc.eventId === 'number' ? `Event #${oc.eventId}` : 'Event #?'
                        const mids = Array.isArray(oc.marketIds) ? oc.marketIds : []
                        // Annotate partially-resolved events so the admin can
                        // see which markets they still need to call resolve()
                        // for in the picker itself.
                        const resolvedMids = mids.filter(
                          (m) => resolutionByMarketId.get(m)?.status === 'Resolved',
                        )
                        const midsLabel =
                          mids.length === 0
                            ? ''
                            : resolvedMids.length === 0
                              ? ` · markets [${mids.join(', ')}]`
                              : ` · markets [${mids
                                  .map((m) =>
                                    resolutionByMarketId.get(m)?.status === 'Resolved'
                                      ? `${m}✓`
                                      : String(m),
                                  )
                                  .join(', ')}]`
                        return (
                          <SelectItem key={p.proposalId} value={p.proposalId}>
                            {p.title} — {eid}
                            {midsLabel}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* ── Event ID / Market IDs (auto-filled, still editable) ── */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="eid" className="text-xs text-muted-foreground">
                    Event ID
                  </Label>
                  <Input
                    id="eid"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    className="font-mono"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mids" className="text-xs text-muted-foreground">
                    Market IDs (comma-separated)
                  </Label>
                  <Input
                    id="mids"
                    value={resolveMarketIds}
                    onChange={(e) => setResolveMarketIds(e.target.value)}
                    className="font-mono"
                    placeholder="0, 1, 2"
                  />
                </div>
              </div>

              {/* ── Per-market outcome table (only when a proposal is picked) ── */}
              {selectedApprovedId &&
                (() => {
                  const proposal = approvedProposals.find(
                    (x) => x.proposalId === selectedApprovedId,
                  )
                  if (!proposal) return null
                  const onChain = (proposal.onChain ?? {}) as { marketIds?: number[] }
                  const mids = Array.isArray(onChain.marketIds) ? onChain.marketIds : []
                  const ranges = Array.isArray(proposal.suggestedRanges)
                    ? proposal.suggestedRanges.map((r) => decodeEntities(String(r)))
                    : []
                  const reportedNum = parseFloat(reportedValue)
                  const hasReportedNum = !Number.isNaN(reportedNum)

                  return (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="reported"
                          className="text-xs text-muted-foreground"
                        >
                          Reported value (optional — auto-fills outcomes)
                        </Label>
                        <Input
                          id="reported"
                          value={reportedValue}
                          onChange={(e) => setReportedValue(e.target.value)}
                          placeholder="e.g. 1.55 for EPS, 5.25 for a rate, …"
                          className="font-mono text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Numbers strip <code>$</code>, <code>%</code>, and commas. Ranges
                          like <code>$1.50–$1.60?</code> and comparators like{' '}
                          <code>&gt; $1.60?</code> are auto-evaluated.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Per-market outcome
                        </Label>
                        {mids.length === 0 ? (
                          <p className="text-xs text-destructive">
                            This approved proposal has no on-chain market IDs recorded.
                          </p>
                        ) : (
                          <div className="divide-y divide-border rounded-md border border-border bg-background">
                            {mids.map((mid, i) => {
                              const q = ranges[i] ?? '(no question recorded)'
                              const current = outcomeByMarketId[String(mid)] ?? 'NO'
                              const parsed = parseQuestion(q)
                              const isUnparseable = parsed.kind === 'unknown'
                              const autoEval = hasReportedNum
                                ? evaluateForValue(parsed, reportedNum)
                                : null
                              return (
                                <div
                                  key={mid}
                                  className="flex items-center gap-3 px-3 py-2.5"
                                >
                                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                                    #{mid}
                                  </span>
                                  <span className="text-sm flex-1 min-w-0 truncate">
                                    {q}
                                  </span>
                                  {hasReportedNum && autoEval && !isUnparseable && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] hidden sm:inline-flex shrink-0"
                                    >
                                      auto: {autoEval}
                                    </Badge>
                                  )}
                                  {isUnparseable && hasReportedNum && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] hidden sm:inline-flex shrink-0 text-amber-500 border-amber-500/40"
                                    >
                                      manual
                                    </Badge>
                                  )}
                                  <Select
                                    value={current}
                                    onValueChange={(v) =>
                                      setOutcomeByMarketId((prev) => ({
                                        ...prev,
                                        [String(mid)]: v as 'YES' | 'NO',
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="w-24 h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="YES">YES</SelectItem>
                                      <SelectItem value="NO">NO</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

              {/* ── Outcomes JSON — auto-derived but editable for power users ── */}
              <details className="rounded-md border border-border bg-muted/20 group">
                <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 select-none text-xs text-muted-foreground">
                  <span className="font-medium">Outcomes JSON (advanced)</span>
                  <span className="ml-auto text-[10px]">
                    Auto-built from toggles above
                  </span>
                </summary>
                <div className="p-3 space-y-2 border-t border-border">
                  <Textarea
                    id="out"
                    value={outcomesJson}
                    onChange={(e) => setOutcomesJson(e.target.value)}
                    className="min-h-[100px] font-mono text-xs leading-relaxed"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Keys are <span className="font-mono">marketId</span> strings, values
                    are <span className="font-mono">"YES"</span> or{' '}
                    <span className="font-mono">"NO"</span>. Editing here lets you submit a
                    payload that diverges from the toggles, but the next toggle change
                    will overwrite your edit.
                  </p>
                </div>
              </details>

              <div className="space-y-1.5">
                <Label htmlFor="rr" className="text-xs text-muted-foreground">
                  Reason / evidence (optional)
                </Label>
                <Input
                  id="rr"
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  placeholder="Link or description of resolution source…"
                />
              </div>

              <Button
                className="gap-2"
                disabled={actionLoadingId === 'resolve'}
                onClick={() => void resolve()}
              >
                {actionLoadingId === 'resolve' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Gavel className="w-4 h-4" />
                )}
                Submit Resolution
              </Button>
            </div>
          </TabsContent>
        </Tabs>

      </main>
    </div>
  )
}
