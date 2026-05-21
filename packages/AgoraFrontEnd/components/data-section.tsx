"use client"

import { useScrollAnimation, useScrollProgress } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArrowRight, Database, Code2, LineChart, Webhook } from 'lucide-react'

const apiEndpoints = [
  {
    method: 'GET',
    endpoint: '/api/markets',
    description: 'List all active markets',
  },
  {
    method: 'GET',
    endpoint: '/api/markets/{id}/probability',
    description: 'Real-time probability data',
  },
  {
    method: 'GET',
    endpoint: '/api/markets/{id}/orderbook',
    description: 'Current order book state',
  },
  {
    method: 'POST',
    endpoint: '/api/orders',
    description: 'Place new order',
  },
]

const dataFeatures = [
  {
    icon: Database,
    title: 'Historical Data',
    description: 'Access full probability time series and volume data for backtesting and research.',
  },
  {
    icon: LineChart,
    title: 'Real-Time Streams',
    description: 'WebSocket feeds for live price updates, order book changes, and trade executions.',
  },
  {
    icon: Code2,
    title: 'SDK Support',
    description: 'Official libraries for Python, TypeScript, and Go with full type safety.',
  },
  {
    icon: Webhook,
    title: 'Webhooks',
    description: 'Get notified on market resolutions, large trades, and significant price movements.',
  },
]

function CodeBlock() {
  return (
    <div className="bg-[#1a1816] rounded-2xl p-6 font-mono text-sm overflow-x-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-3 h-3 rounded-full bg-destructive/80" />
        <div className="w-3 h-3 rounded-full bg-accent/80" />
        <div className="w-3 h-3 rounded-full bg-success/80" />
      </div>
      <pre className="text-[#e8e0d8]">
        <code>
          <span className="text-[#9d8b7a]">{"// Fetch market probability time series"}</span>
          {"\n"}
          <span className="text-[#c9a86c]">const</span>{" response = "}
          <span className="text-[#c9a86c]">await</span>{" fetch("}
          {"\n"}
          {"  "}
          <span className="text-[#a8c97a]">{'"https://api.agora.market/v1/markets/fed-rate-cut/probability"'}</span>
          {"\n"}
          {");"}
          {"\n\n"}
          <span className="text-[#c9a86c]">const</span>{" data = "}
          <span className="text-[#c9a86c]">await</span>{" response.json();"}
          {"\n\n"}
          <span className="text-[#9d8b7a]">{"// Output:"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"// {"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"//   market: 'fed-rate-cut-june-2025',"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"//   probability: 0.73,"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"//   change_24h: 0.052,"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"//   volume_24h: 2400000,"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"//   timestamp: '2025-04-09T10:30:00Z'"}</span>
          {"\n"}
          <span className="text-[#9d8b7a]">{"// }"}</span>
        </code>
      </pre>
    </div>
  )
}

export function DataSection() {
  const { ref: headerRef, isVisible: headerVisible } = useScrollAnimation<HTMLDivElement>()
  const { ref: contentRef, isVisible: contentVisible } = useScrollAnimation<HTMLDivElement>({ threshold: 0.1 })

  return (
    <section className="py-24 md:py-32 bg-muted/30">
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
            For Institutions
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Alternative <span className="text-gradient">Data API</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Integrate crowd-implied probabilities and sentiment data into your research workflow. 
            Real-time feeds designed for quantitative strategies.
          </p>
        </div>

        {/* Content Grid */}
        <div 
          ref={contentRef}
          className="grid lg:grid-cols-2 gap-12 lg:gap-16"
        >
          {/* Left: Code Example */}
          <div className={cn(
            'transition-all duration-700',
            contentVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
          )}>
            <CodeBlock />
            
            {/* API Endpoints Preview */}
            <div className="mt-6 space-y-2">
              {apiEndpoints.map((endpoint, index) => (
                <div 
                  key={endpoint.endpoint}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50 transition-all duration-500',
                    contentVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
                  )}
                  style={{ transitionDelay: `${(index + 1) * 100}ms` }}
                >
                  <span className={cn(
                    'px-2 py-0.5 rounded text-xs font-mono font-bold',
                    endpoint.method === 'GET' ? 'bg-success/20 text-success' : 'bg-accent/20 text-accent'
                  )}>
                    {endpoint.method}
                  </span>
                  <code className="text-sm font-mono text-foreground flex-1 truncate">
                    {endpoint.endpoint}
                  </code>
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {endpoint.description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Features */}
          <div className={cn(
            'space-y-6 transition-all duration-700 delay-200',
            contentVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
          )}>
            {dataFeatures.map((feature, index) => {
              const Icon = feature.icon
              return (
                <div 
                  key={feature.title}
                  className={cn(
                    'flex gap-5 p-5 rounded-2xl bg-card border border-border/50 hover-lift transition-all duration-500',
                    contentVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  )}
                  style={{ transitionDelay: `${(index + 2) * 100}ms` }}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              )
            })}

            <div className="pt-4">
              <Button className="group bg-primary hover:bg-primary/90">
                Explore API Docs
                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
