"use client"

import { useScrollAnimation, useScrollProgress } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { 
  BarChart3, 
  Shield, 
  Zap, 
  Globe, 
  LineChart, 
  Lock,
  ArrowRight
} from 'lucide-react'

const features = [
  {
    icon: BarChart3,
    title: 'Real-Time Order Books',
    description: 'Deep liquidity with live bid/ask spreads. Execute trades instantly with minimal slippage on our high-performance matching engine.',
    accent: 'from-accent/20 to-primary/20',
  },
  {
    icon: LineChart,
    title: 'Crowd-Implied Probabilities',
    description: 'Market prices encode collective beliefs. Access live probability estimates derived from actual capital at risk.',
    accent: 'from-primary/20 to-accent/20',
  },
  {
    icon: Zap,
    title: 'Instant Settlement',
    description: 'Built on BNB Chain for sub-second finality. Markets resolve automatically with on-chain verification.',
    accent: 'from-accent/20 to-primary/20',
  },
  {
    icon: Globe,
    title: 'Alternative Data API',
    description: 'Export probability time series, volume metrics, and sentiment aggregates. Integrate crowd signals into your research workflow.',
    accent: 'from-primary/20 to-accent/20',
  },
  {
    icon: Shield,
    title: 'Institutional Security',
    description: 'Audited smart contracts, multi-sig treasury, and enterprise-grade custody solutions for institutional participants.',
    accent: 'from-accent/20 to-primary/20',
  },
  {
    icon: Lock,
    title: 'Non-Custodial',
    description: 'Your keys, your funds. Trade directly from your wallet with full transparency and no counterparty risk.',
    accent: 'from-primary/20 to-accent/20',
  },
]

function FeatureCard({ 
  feature, 
  index 
}: { 
  feature: typeof features[0]
  index: number 
}) {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.2 })
  const Icon = feature.icon

  return (
    <div
      ref={ref}
      className={cn(
        'group relative p-8 rounded-3xl transition-all duration-700 hover-lift',
        'bg-gradient-to-br',
        feature.accent,
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
      )}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      {/* Icon */}
      <div className="w-14 h-14 rounded-2xl bg-background/80 backdrop-blur flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
        <Icon className="w-7 h-7 text-primary" />
      </div>

      {/* Content */}
      <h3 className="font-serif text-xl font-semibold mb-3 group-hover:text-primary transition-colors">
        {feature.title}
      </h3>
      <p className="text-muted-foreground leading-relaxed">
        {feature.description}
      </p>

      {/* Hover indicator */}
      <div className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
        <ArrowRight className="w-5 h-5 text-primary" />
      </div>
    </div>
  )
}

export function FeaturesSection() {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation<HTMLDivElement>()
  const { ref: progressRef, progress } = useScrollProgress()

  return (
    <section id="features" className="py-24 md:py-32 relative overflow-hidden">
      {/* Progress indicator line */}
      <div 
        ref={progressRef}
        className="absolute left-8 top-32 bottom-32 w-px bg-border hidden lg:block"
      >
        <div 
          className="w-full bg-gradient-to-b from-primary via-accent to-primary transition-all duration-100"
          style={{ height: `${progress * 100}%` }}
        />
      </div>

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
            Why Agora
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Built for <span className="text-gradient">Excellence</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Every feature designed with institutional requirements in mind. 
            Performance, security, and data quality without compromise.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
