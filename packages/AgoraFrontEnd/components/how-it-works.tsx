"use client"

import { useScrollAnimation, useScrollProgress } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { Wallet, Search, BarChart2, Banknote } from 'lucide-react'

const steps = [
  {
    number: '01',
    icon: Wallet,
    title: 'Connect Wallet',
    description: 'Link your Web3 wallet to access the platform. We support MetaMask, WalletConnect, and all major providers.',
    detail: 'Non-custodial architecture means you always control your funds.',
  },
  {
    number: '02',
    icon: Search,
    title: 'Discover Markets',
    description: 'Browse curated prediction markets across macro, earnings, tech, and crypto categories.',
    detail: 'Filter by category, volume, or probability to find opportunities.',
  },
  {
    number: '03',
    icon: BarChart2,
    title: 'Place Your Trade',
    description: 'Buy Yes or No shares at current market prices, or place limit orders in the order book.',
    detail: 'Real-time order matching with transparent on-chain execution.',
  },
  {
    number: '04',
    icon: Banknote,
    title: 'Collect Winnings',
    description: 'Markets resolve based on verified outcomes. Winning shares are automatically settled.',
    detail: 'Instant payouts directly to your wallet. No intermediaries.',
  },
]

function StepCard({ 
  step, 
  index, 
  isLast 
}: { 
  step: typeof steps[0]
  index: number
  isLast: boolean
}) {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.3 })
  const Icon = step.icon

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex gap-8 transition-all duration-700',
        isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
      )}
      style={{ transitionDelay: `${index * 150}ms` }}
    >
      {/* Timeline */}
      <div className="hidden md:flex flex-col items-center">
        <div className={cn(
          'w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500',
          isVisible ? 'bg-primary text-primary-foreground scale-100' : 'bg-muted scale-90'
        )}>
          <Icon className="w-7 h-7" />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-gradient-to-b from-primary to-border my-4" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        'flex-1 pb-16',
        isLast ? 'pb-0' : ''
      )}>
        {/* Mobile icon */}
        <div className={cn(
          'md:hidden w-14 h-14 rounded-full flex items-center justify-center mb-4',
          isVisible ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}>
          <Icon className="w-6 h-6" />
        </div>

        <div className="flex items-center gap-4 mb-4">
          <span className="font-serif text-4xl font-bold text-muted-foreground/30">
            {step.number}
          </span>
          <h3 className="font-serif text-2xl md:text-3xl font-semibold">
            {step.title}
          </h3>
        </div>
        
        <p className="text-lg text-muted-foreground mb-3 max-w-lg">
          {step.description}
        </p>
        
        <p className="text-sm text-accent font-medium">
          {step.detail}
        </p>
      </div>
    </div>
  )
}

export function HowItWorks() {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation<HTMLDivElement>()

  return (
    <section id="how-it-works" className="py-24 md:py-32 bg-muted/30">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div 
          ref={headerRef}
          className={cn(
            'text-center mb-20 transition-all duration-700',
            headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          )}
        >
          <span className="text-sm font-medium text-accent uppercase tracking-widest mb-4 block">
            Getting Started
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Trade in <span className="text-gradient">Four Steps</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From wallet connection to winnings collection, 
            the entire flow is streamlined for efficiency.
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-3xl mx-auto">
          {steps.map((step, index) => (
            <StepCard 
              key={step.number} 
              step={step} 
              index={index}
              isLast={index === steps.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
