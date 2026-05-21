'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
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
  fetchProposals,
  fetchProposal,
  postApproveProposal,
  postRejectProposal,
  postResolveMarkets,
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
    // Small artificial delay for UX
    await new Promise((r) => setTimeout(r, 400))
    if (username === 'username' && password === 'password') {
      sessionStorage.setItem('agora_admin_auth', '1')
      onAuth()
    } else {
      setError('Invalid credentials. Please try again.')
    }
    setLoading(false)
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
    const saved = sessionStorage.getItem('agora_admin_auth')
    if (saved === '1') setAuthenticated(true)
    setAuthChecked(true)
  }, [])

  const handleLogout = () => {
    sessionStorage.removeItem('agora_admin_auth')
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

  useEffect(() => {
    setConfirmedBy((prev) => (prev === '' && address ? address : prev))
  }, [address])

  const loadPendingProposals = async () => {
    setProposalsLoading(true)
    try {
      const list = await fetchProposals('pending')
      setPendingProposals(list)
      if (list.length === 0) toast.info('No pending proposals found')
    } finally {
      setProposalsLoading(false)
    }
  }

  // Auto-load on mount when authenticated
  useEffect(() => {
    if (authenticated) void loadPendingProposals()
  }, [authenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!authChecked) return null

  if (!authenticated) {
    return <LoginWall onAuth={() => setAuthenticated(true)} />
  }

  // ── Actions ──
  const approve = async (pid: string) => {
    const by = confirmedBy.trim()
    if (!by) { toast.error('Set "Confirmed by" address'); return }
    const mj = marketsJsons[pid] ?? DEFAULT_MARKETS_JSON
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
      if (res.error) toast.error(res.error, { description: JSON.stringify(res.detail) })
      else toast.success('Resolution submitted', { description: res.evidenceHash })
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
              const mj = marketsJsons[p.proposalId] ?? DEFAULT_MARKETS_JSON
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
                    onClick={() => setExpandedId(isExpanded ? null : p.proposalId)}
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
                            value={cl}
                            onChange={(e) =>
                              setCloseLocals((prev) => ({ ...prev, [p.proposalId]: e.target.value }))
                            }
                            className="max-w-xs text-sm"
                          />
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
                Submits final outcomes for the specified markets. Requires the resolver
                environment on the backend server for on-chain settlement.
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="eid" className="text-xs text-muted-foreground">Event ID</Label>
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

              <div className="space-y-1.5">
                <Label htmlFor="out" className="text-xs text-muted-foreground">
                  Outcomes JSON — keys as string indices
                </Label>
                <Textarea
                  id="out"
                  value={outcomesJson}
                  onChange={(e) => setOutcomesJson(e.target.value)}
                  className="min-h-[120px] font-mono text-xs leading-relaxed"
                />
              </div>

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
