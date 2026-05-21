"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArrowUpDown, TrendingUp, Activity } from 'lucide-react'
import { backendBaseUrl, fetchOrders, type OffchainOrder } from '@/lib/agora-api'

interface OrderLevel {
  price: number
  size: number
  total: number
}

function generateOrders(basePrice: number, isBid: boolean, count: number = 8): OrderLevel[] {
  const orders: OrderLevel[] = []
  let total = 0
  
  for (let i = 0; i < count; i++) {
    const price = isBid 
      ? basePrice - (i * 0.01) - Math.random() * 0.005
      : basePrice + (i * 0.01) + Math.random() * 0.005
    const size = Math.floor(Math.random() * 5000) + 500
    total += size
    orders.push({
      price: Number(price.toFixed(2)),
      size,
      total,
    })
  }
  
  return orders
}

function OrderBookRow({ 
  order, 
  maxTotal, 
  isBid, 
  index 
}: { 
  order: OrderLevel
  maxTotal: number
  isBid: boolean
  index: number
}) {
  const width = (order.total / maxTotal) * 100

  return (
    <div 
      className="relative group animate-fade-in"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Background fill */}
      <div 
        className={cn(
          'absolute inset-y-0 transition-all duration-300',
          isBid ? 'left-0 bg-success/10' : 'right-0 bg-destructive/10'
        )}
        style={{ width: `${width}%` }}
      />
      
      <div className="relative grid grid-cols-3 gap-4 py-2 px-3 text-sm font-mono">
        <span className={cn(
          'transition-colors',
          isBid ? 'text-success' : 'text-destructive'
        )}>
          {order.price.toFixed(2)}
        </span>
        <span className="text-center text-foreground">
          {order.size.toLocaleString()}
        </span>
        <span className="text-right text-muted-foreground">
          {order.total.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

export function OrderBookDemo() {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.2 })
  const [currentPrice, setCurrentPrice] = useState(0.73)
  const [bids, setBids] = useState<OrderLevel[]>([])
  const [asks, setAsks] = useState<OrderLevel[]>([])
  const [selectedTab, setSelectedTab] = useState<'yes' | 'no'>('yes')
  const [liveOrders, setLiveOrders] = useState<OffchainOrder[]>([])

  useEffect(() => {
    const pull = () => {
      void fetchOrders(0).then((r) => setLiveOrders(r.orders))
    }
    pull()
    const apiPoll = setInterval(pull, 10_000)
    return () => clearInterval(apiPoll)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const newPrice = 0.73 + (Math.random() - 0.5) * 0.02
      setCurrentPrice(Number(newPrice.toFixed(2)))
      setBids(generateOrders(newPrice, true))
      setAsks(generateOrders(newPrice, false))
    }, 2000)

    // Initial generation
    setBids(generateOrders(currentPrice, true))
    setAsks(generateOrders(currentPrice, false))

    return () => clearInterval(interval)
  }, [])

  const maxTotal = Math.max(
    ...bids.map(o => o.total),
    ...asks.map(o => o.total)
  )

  return (
    <section id="data" className="py-24 md:py-32">
      <div className="container mx-auto px-6">
        <div 
          ref={ref}
          className={cn(
            'grid lg:grid-cols-2 gap-12 lg:gap-16 items-center transition-all duration-700',
            isVisible ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/* Left: Content */}
          <div className={cn(
            'transition-all duration-700 delay-100',
            isVisible ? 'translate-x-0' : '-translate-x-8'
          )}>
            <span className="text-sm font-medium text-accent uppercase tracking-widest mb-4 block">
              Professional Trading
            </span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold mb-6">
              Institutional-Grade <span className="text-gradient">Order Books</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
              Deep liquidity pools with real-time bid/ask spreads. Place market orders for instant execution 
              or set limit orders to trade at your preferred prices. Every transaction is transparent and 
              settled on-chain.
            </p>
            <p className="text-sm text-muted-foreground mb-8">
              Live off-chain mirror from{' '}
              <code className="text-xs bg-muted px-1 rounded">{backendBaseUrl}/orders/0</code>
              {liveOrders.length > 0 ? ` · ${liveOrders.length} row(s)` : ' · (empty or API down)'}
            </p>

            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="p-4 rounded-xl bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-accent" />
                  <span className="text-sm text-muted-foreground">Avg Spread</span>
                </div>
                <span className="text-2xl font-bold">0.3%</span>
              </div>
              <div className="p-4 rounded-xl bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-success" />
                  <span className="text-sm text-muted-foreground">24h Volume</span>
                </div>
                <span className="text-2xl font-bold">$2.4M</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Button className="bg-primary hover:bg-primary/90" asChild>
                <Link href="/trade">Start Trading</Link>
              </Button>
              <Button variant="outline" asChild>
                <a href={`${backendBaseUrl}/docs`} target="_blank" rel="noopener noreferrer">
                  API docs (FastAPI)
                </a>
              </Button>
            </div>
          </div>

          {/* Right: Order Book */}
          <div className={cn(
            'transition-all duration-700 delay-300',
            isVisible ? 'translate-x-0' : 'translate-x-8'
          )}>
            <div className="bg-card rounded-3xl border border-border p-6 shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-semibold text-lg">Fed Rate Cut June 2025</h3>
                  <p className="text-sm text-muted-foreground">Order Book</p>
                </div>
                <div className="flex gap-1 p-1 bg-muted rounded-lg">
                  <button
                    onClick={() => setSelectedTab('yes')}
                    className={cn(
                      'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                      selectedTab === 'yes' 
                        ? 'bg-success text-success-foreground' 
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setSelectedTab('no')}
                    className={cn(
                      'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                      selectedTab === 'no' 
                        ? 'bg-destructive text-destructive-foreground' 
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    No
                  </button>
                </div>
              </div>

              {/* Current Price */}
              <div className="flex items-center justify-center gap-3 py-4 mb-4 bg-muted/50 rounded-xl">
                <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                <span className="text-2xl font-bold font-mono">${currentPrice.toFixed(2)}</span>
                <span className="text-sm text-success">= {(currentPrice * 100).toFixed(0)}% probability</span>
              </div>

              {/* Column Headers */}
              <div className="grid grid-cols-3 gap-4 px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                <span>Price</span>
                <span className="text-center">Size</span>
                <span className="text-right">Total</span>
              </div>

              {/* Asks (reversed to show lowest at bottom) */}
              <div className="border-b border-border">
                {[...asks].reverse().map((order, index) => (
                  <OrderBookRow 
                    key={`ask-${index}`} 
                    order={order} 
                    maxTotal={maxTotal}
                    isBid={false}
                    index={asks.length - 1 - index}
                  />
                ))}
              </div>

              {/* Spread Indicator */}
              <div className="py-2 px-3 text-center text-xs text-muted-foreground bg-muted/30">
                Spread: ${Math.abs(asks[0]?.price - bids[0]?.price).toFixed(3) || '0.010'}
              </div>

              {/* Bids */}
              <div>
                {bids.map((order, index) => (
                  <OrderBookRow 
                    key={`bid-${index}`} 
                    order={order} 
                    maxTotal={maxTotal}
                    isBid={true}
                    index={index}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
