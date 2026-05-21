"use client"

import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Sparkles } from 'lucide-react'

export function CTASection() {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.3 })

  return (
    <section className="py-24 md:py-32 relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/50 to-background" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 blur-3xl animate-pulse-subtle" />

      <div className="container mx-auto px-6 relative z-10">
        <div 
          ref={ref}
          className={cn(
            'max-w-4xl mx-auto text-center transition-all duration-700',
            isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          )}
        >
          {/* Icon */}
          <div className={cn(
            'inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-8 transition-all duration-700 delay-100',
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            <Sparkles className="w-8 h-8 text-primary" />
          </div>

          {/* Headline */}
          <h2 className={cn(
            'font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6 transition-all duration-700 delay-200',
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            Ready to Trade the{' '}
            <span className="text-gradient">Future</span>?
          </h2>

          {/* Subheadline */}
          <p className={cn(
            'text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed transition-all duration-700 delay-300',
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            Join thousands of traders and institutions accessing crowd-implied probabilities 
            on the most sophisticated prediction market platform.
          </p>

          {/* CTA Buttons */}
          <div className={cn(
            'flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-700 delay-400',
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            <Button
              size="lg"
              className="group px-8 py-6 text-base bg-primary hover:bg-primary/90 transition-all duration-300 hover:shadow-xl hover:shadow-primary/20"
              asChild
            >
              <Link href="/trade">
                Launch App
                <ArrowRight className="ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-6 text-base border-border hover:bg-secondary/50 transition-all duration-300" asChild>
              <Link href="/propose">Propose a market</Link>
            </Button>
          </div>

          {/* Trust badges */}
          <div className={cn(
            'mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground transition-all duration-700 delay-500',
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span>Non-Custodial</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span>Audited Contracts</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span>BNB Chain</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
