"use client"

import { useState } from 'react'
import Link from 'next/link'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Clock, Users, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Market {
  id: string
  title: string
  category: string
  probability: number
  change: number
  volume: string
  traders: number
  endsIn: string
  trending: boolean
}

const markets: Market[] = [
  {
    id: '1',
    title: 'Fed cuts rates by 50bps in June 2025',
    category: 'Macro',
    probability: 73,
    change: 5.2,
    volume: '$12.4M',
    traders: 2847,
    endsIn: '45 days',
    trending: true,
  },
  {
    id: '2',
    title: 'NVIDIA beats Q2 earnings estimates',
    category: 'Earnings',
    probability: 82,
    change: -2.1,
    volume: '$8.7M',
    traders: 1923,
    endsIn: '23 days',
    trending: true,
  },
  {
    id: '3',
    title: 'Apple announces new product category',
    category: 'Tech',
    probability: 34,
    change: 8.4,
    volume: '$5.2M',
    traders: 1456,
    endsIn: '67 days',
    trending: false,
  },
  {
    id: '4',
    title: 'BTC crosses $150K before 2026',
    category: 'Crypto',
    probability: 45,
    change: 12.3,
    volume: '$18.9M',
    traders: 4521,
    endsIn: '234 days',
    trending: true,
  },
  {
    id: '5',
    title: 'US GDP growth exceeds 3% in 2025',
    category: 'Macro',
    probability: 28,
    change: -4.7,
    volume: '$3.8M',
    traders: 892,
    endsIn: '178 days',
    trending: false,
  },
  {
    id: '6',
    title: 'Tesla delivers 500K vehicles in Q3',
    category: 'Earnings',
    probability: 61,
    change: 1.8,
    volume: '$7.1M',
    traders: 1678,
    endsIn: '89 days',
    trending: false,
  },
]

const categories = ['All', 'Macro', 'Earnings', 'Tech', 'Crypto']

function MarketCard({ market, index }: { market: Market; index: number }) {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.1 })

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-500',
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      )}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <Link
        href="/markets"
        className="group relative bg-card rounded-2xl p-8 border border-border/50 hover-lift cursor-pointer transition-all duration-300 block hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 hover:bg-primary/[0.03]"
      >
      {/* Trending badge */}
      {market.trending && (
        <div className="absolute -top-2 -right-2 px-2 py-1 bg-accent text-accent-foreground text-xs font-medium rounded-full">
          Trending
        </div>
      )}

      {/* Category */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {market.category}
        </span>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Title */}
      <h3 className="font-serif text-xl font-semibold mb-5 leading-tight group-hover:text-primary transition-colors duration-300">
        {market.title}
      </h3>

      {/* Probability Bar */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-2xl font-bold">{market.probability}%</span>
          <span className={cn(
            'flex items-center gap-1 text-sm font-medium',
            market.change > 0 ? 'text-success' : 'text-destructive'
          )}>
            {market.change > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {market.change > 0 ? '+' : ''}{market.change}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-1000"
            style={{ width: `${market.probability}%` }}
          />
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {market.endsIn}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {market.traders.toLocaleString()}
          </span>
        </div>
        <span className="font-medium text-foreground">{market.volume}</span>
      </div>
      </Link>
    </div>
  )
}

export function MarketsShowcase() {
  const [activeCategory, setActiveCategory] = useState('All')
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation<HTMLDivElement>()

  const filteredMarkets = activeCategory === 'All' 
    ? markets 
    : markets.filter(m => m.category === activeCategory)

  return (
    <section id="markets" className="py-24 md:py-32 bg-muted/30">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div 
          ref={headerRef}
          className={cn(
            'text-center mb-16 transition-all duration-700',
            headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          )}
        >
          <span className="text-sm font-medium text-accent uppercase tracking-widest mb-4 block">
            Live Markets
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Trade the <span className="text-gradient">Narrative</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Access institutional-grade prediction markets for macro, earnings, tech, and crypto events. 
            Real-time probabilities powered by crowd wisdom.
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={cn(
                'px-5 py-2 rounded-full text-sm font-medium transition-all duration-300',
                activeCategory === category
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Markets Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredMarkets.map((market, index) => (
            <MarketCard key={market.id} market={market} index={index} />
          ))}
        </div>

        {/* View All CTA */}
        <div className="text-center mt-12">
          <Button variant="outline" size="lg" className="group px-8" asChild>
            <Link href="/markets">
              Browse all markets
              <ArrowUpRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
