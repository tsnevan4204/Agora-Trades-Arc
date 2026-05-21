'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { ArrowLeft, Lightbulb, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { postProposal } from '@/lib/agora-api'
import { cn } from '@/lib/utils'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `p-${Date.now()}`
}

const CATEGORIES = ['earnings', 'macro', 'crypto', 'politics', 'sports', 'other']
const METRICS = ['eps', 'revenue', 'guidance', 'price', 'rate', 'index', 'other']

export default function ProposePage() {
  const { address, isConnected } = useAccount()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('earnings')
  const [ticker, setTicker] = useState('AAPL')
  const [metric, setMetric] = useState('eps')
  const [fy, setFy] = useState('2026')
  const [fq, setFq] = useState('2')
  const [ranges, setRanges] = useState('EPS > $1.60?\nEPS $1.50–$1.60?')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const submit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    const proposer = address ?? '0x0000000000000000000000000000000000000000'
    if (!isConnected) {
      toast.message('No wallet connected', {
        description: 'Your proposal will use the zero address. Connect a wallet on the Trade page to record your address.',
      })
    }
    setLoading(true)
    try {
      const res = await postProposal({
        proposalId: randomId(),
        proposerAddress: proposer,
        title: title.trim(),
        category,
        ticker: ticker.toUpperCase(),
        metric,
        fiscalYear: Number(fy),
        fiscalQuarter: Number(fq),
        suggestedRanges: ranges.split('\n').map((s) => s.trim()).filter(Boolean),
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Proposal submitted!', { description: 'An admin will review your proposal.' })
        setSubmitted(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/30">

      {/* Back navigation */}
      <div className="p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 pb-16">
        <div className="w-full max-w-2xl space-y-6">

          {/* Header */}
          <div className="space-y-3">
            <Link href="/" className="inline-flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-primary-foreground font-serif text-lg font-bold">A</span>
              </div>
              <span className="font-serif text-xl font-semibold tracking-tight">Agora</span>
            </Link>
            <div>
              <h1 className="font-serif text-3xl md:text-4xl font-bold leading-tight">
                Propose a <span className="text-gradient">Market</span>
              </h1>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-lg">
                Suggest an event for the Agora marketplace. Admins review proposals and create
                on-chain prediction markets once approved.
              </p>
            </div>
          </div>

          {/* Wallet status */}
          {!isConnected && (
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertDescription className="text-sm">
                You're not connected. Your proposal will record the zero address as proposer.{' '}
                <Link href="/signin" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>{' '}
                to record your wallet address.
              </AlertDescription>
            </Alert>
          )}

          {/* Success state */}
          {submitted ? (
            <div className="rounded-xl border border-success/30 bg-success/10 p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-success/20 flex items-center justify-center mx-auto">
                <Send className="w-6 h-6 text-success" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">Proposal submitted!</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  An admin will review your proposal and create the market on-chain once approved.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => { setSubmitted(false); setTitle('') }} variant="secondary">
                  Submit another
                </Button>
                <Button asChild>
                  <Link href="/trade">Go to Trade</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 space-y-6">

              {/* Event details */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-5 rounded-full bg-primary" />
                  <h2 className="font-semibold text-sm">Event Details</h2>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="title" className="text-sm">
                    Market title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Apple Q2 2026 Earnings Beat"
                    className="text-sm"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Category */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cat" className="text-sm">Category</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategory(c)}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-all capitalize',
                            category === c
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Metric */}
                  <div className="space-y-1.5">
                    <Label htmlFor="met" className="text-sm">Metric</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {METRICS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMetric(m)}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border transition-all uppercase',
                            metric === m
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Asset & period */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-5 rounded-full bg-primary" />
                  <h2 className="font-semibold text-sm">Asset & Period</h2>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="tick" className="text-sm">Ticker</Label>
                    <Input
                      id="tick"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                      className="font-mono uppercase"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fy" className="text-sm">Fiscal Year</Label>
                    <Input
                      id="fy"
                      value={fy}
                      onChange={(e) => setFy(e.target.value)}
                      placeholder="2026"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fq" className="text-sm">Quarter</Label>
                    <Input
                      id="fq"
                      value={fq}
                      onChange={(e) => setFq(e.target.value)}
                      placeholder="2"
                      className="font-mono"
                    />
                  </div>
                </div>

                {/* Preview badge */}
                {title && ticker && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="font-mono">{ticker.toUpperCase()}</Badge>
                    <Badge variant="outline">{category}</Badge>
                    <Badge variant="outline">{metric}</Badge>
                    <Badge variant="outline">FY{fy} Q{fq}</Badge>
                  </div>
                )}
              </div>

              <Separator />

              {/* Suggested ranges */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-5 rounded-full bg-primary" />
                  <div>
                    <h2 className="font-semibold text-sm">Suggested Ranges</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      One outcome question per line. The admin can modify these before approving.
                    </p>
                  </div>
                </div>
                <Textarea
                  id="rng"
                  value={ranges}
                  onChange={(e) => setRanges(e.target.value)}
                  className="min-h-[110px] font-mono text-sm leading-relaxed"
                  placeholder={"EPS > $1.60?\nEPS $1.50–$1.60?\nEPS < $1.50?"}
                />
                <p className="text-xs text-muted-foreground">
                  {ranges.split('\n').filter((s) => s.trim()).length} outcome{ranges.split('\n').filter((s) => s.trim()).length !== 1 ? 's' : ''} suggested
                </p>
              </div>

              {/* Submit */}
              <Button
                className="w-full h-11 font-semibold gap-2"
                disabled={!title.trim() || loading}
                onClick={() => void submit()}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Submit Proposal
              </Button>
            </div>
          )}

          {/* Footer note */}
          <p className="text-xs text-muted-foreground text-center">
            Proposals are reviewed by Agora administrators before any on-chain market is created.
          </p>
        </div>
      </div>
    </div>
  )
}
