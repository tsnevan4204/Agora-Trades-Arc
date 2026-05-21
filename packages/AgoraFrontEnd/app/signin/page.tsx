'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Wallet, ShieldCheck, Zap, Globe } from 'lucide-react'
import { walletConnectProjectId } from '@/lib/env'
import { cn } from '@/lib/utils'

const features = [
  {
    icon: ShieldCheck,
    title: 'Non-custodial',
    description: 'Your keys, your funds. We never hold your assets.',
  },
  {
    icon: Zap,
    title: 'Gasless trading',
    description: 'Meta-transaction relay covers gas so you trade freely.',
  },
  {
    icon: Globe,
    title: 'On-chain settlement',
    description: 'All outcomes settled transparently on Circle Arc.',
  },
]

export default function SignInPage() {
  const { isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isConnected) {
      router.push('/trade')
    }
  }, [isConnected, router])

  const injectedConnector = connectors.find((c) => c.id === 'injected')

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-muted/30">
      {/* Back link */}
      <div className="p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-12 items-center">

          {/* Left: branding */}
          <div
            className={cn(
              'space-y-8 transition-all duration-700',
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
            )}
          >
            {/* Logo */}
            <Link href="/" className="inline-flex items-center gap-3 group">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-primary-foreground font-serif text-2xl font-bold">A</span>
              </div>
              <span className="font-serif text-3xl font-semibold tracking-tight">Agora</span>
            </Link>

            <div className="space-y-3">
              <h1 className="font-serif text-4xl md:text-5xl font-bold leading-[1.15]">
                Connect your <span className="text-gradient">wallet</span> to trade
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Access prediction markets, trade outcomes, and earn from your convictions — all on-chain.
              </p>
            </div>

            <div className="space-y-4">
              {features.map((f, i) => {
                const Icon = f.icon
                return (
                  <div
                    key={f.title}
                    className={cn(
                      'flex items-start gap-4 transition-all duration-700',
                      mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
                    )}
                    style={{ transitionDelay: `${150 + i * 100}ms` }}
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{f.title}</p>
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: connect panel */}
          <div
            className={cn(
              'transition-all duration-700 delay-200',
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
            )}
          >
            <div className="glass rounded-2xl border border-border/60 p-8 space-y-6 shadow-xl shadow-primary/5">
              {/* Header */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold text-lg">Connect Wallet</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Choose your wallet to sign in. You'll be redirected to the trading terminal.
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-border/50" />

              {/* Connect button(s) */}
              <div className="space-y-3">
                {walletConnectProjectId ? (
                  <div className="flex justify-center">
                    <ConnectButton chainStatus="icon" showBalance={false} />
                  </div>
                ) : (
                  <>
                    <Button
                      className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 transition-all duration-300 hover:shadow-lg hover:shadow-primary/20"
                      disabled={isPending || !injectedConnector}
                      onClick={() => injectedConnector && connect({ connector: injectedConnector })}
                    >
                      {isPending ? 'Connecting…' : 'Connect Browser Wallet'}
                    </Button>
                    {!injectedConnector && (
                      <p className="text-xs text-muted-foreground text-center">
                        No browser wallet detected. Install MetaMask or another Web3 wallet.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Fine print */}
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By connecting you agree to use this application at your own risk.
                Markets settle in Circle USDC on Arc testnet — fund your wallet from the Circle faucet.
              </p>

              {/* Already have an account? hint */}
              <div className="border-t border-border/50 pt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Want to explore first?{' '}
                  <Link
                    href="/#markets"
                    className="text-foreground hover:text-primary transition-colors font-medium"
                  >
                    View live markets
                  </Link>
                </p>
              </div>
            </div>

            {/* Network info */}
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Running on Circle Arc Testnet
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
