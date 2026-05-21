"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, ChevronDown, TrendingUp, Users, Activity } from 'lucide-react'
import { MarketplaceStats } from '@/components/marketplace-stats'

function FloatingCard({ 
  children, 
  className,
}: { 
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`glass rounded-2xl p-4 shadow-lg border border-border/30 ${className}`}>
      {children}
    </div>
  )
}

export function HeroSection() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/30" />
      
      {/* Accent circles */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
      
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div 
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 border border-border/50 mb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          >
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-sm text-muted-foreground">Live on Circle Arc Testnet</span>
          </div>

          {/* Main headline */}
          <h1 
            className={`font-serif text-5xl md:text-7xl lg:text-8xl font-bold leading-[1.1] tracking-tight mb-6 transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          >
            <span className="block">The Future of</span>
            <span className="text-gradient">Prediction Markets</span>
          </h1>

          {/* Subheadline */}
          <p 
            className={`text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          >
            Institutional-grade prediction markets with real-time crowd-implied probabilities. 
            Trade convictions. Access alternative data. Make informed decisions.
          </p>

          {/* CTA Buttons */}
          <div 
            className={`flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          >
            <Button
              size="lg"
              className="group px-8 py-6 text-base bg-primary hover:bg-primary/90 transition-all duration-300 hover:shadow-xl hover:shadow-primary/20"
              asChild
            >
              <Link href="/markets">
                Start Trading
                <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-6 text-base border-border hover:bg-secondary/50 transition-all duration-300" asChild>
              <Link href="#markets">View Markets</Link>
            </Button>
          </div>

          {/* Stats — marketplace stalls animation */}
          <div
            className={`transition-all duration-700 delay-400 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          >
            <MarketplaceStats />
          </div>
        </div>

        {/* Floating UI Elements */}
        <div className="hidden lg:block">
          <FloatingCard className="absolute top-1/3 left-8 xl:left-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fed Rate Cut</p>
                <p className="font-semibold">73% Yes</p>
              </div>
            </div>
          </FloatingCard>

          <FloatingCard className="absolute top-1/2 right-8 xl:right-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NVDA Earnings Beat</p>
                <p className="font-semibold">82% Yes</p>
              </div>
            </div>
          </FloatingCard>

          <FloatingCard className="absolute bottom-1/3 left-12 xl:left-24">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Traders Online</p>
                <p className="font-semibold">2,847</p>
              </div>
            </div>
          </FloatingCard>
        </div>
      </div>

      {/* Scroll indicator — z-20 keeps it above all content layers */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20">
        <span className="text-xs text-muted-foreground tracking-widest uppercase">Explore</span>
        <ChevronDown className="w-5 h-5 text-muted-foreground animate-bounce" />
      </div>
    </section>
  )
}
