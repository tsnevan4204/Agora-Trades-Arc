"use client"

import { useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useScrollProgress, useScrollAnimation } from '@/hooks/use-scroll-animation'

interface ShowcaseItem {
  label: string
  value: string
  description: string
}

const showcaseItems: ShowcaseItem[] = [
  {
    label: 'Markets',
    value: '156+',
    description: 'Active prediction markets spanning macro, earnings, tech, and crypto events.',
  },
  {
    label: 'Total Volume',
    value: '$847M',
    description: 'Cumulative trading volume processed through our high-performance matching engine.',
  },
  {
    label: 'Avg Settlement',
    value: '< 2s',
    description: 'Sub-second finality on BNB Chain ensures instant trade execution and settlement.',
  },
  {
    label: 'Uptime',
    value: '99.99%',
    description: 'Enterprise-grade infrastructure with continuous monitoring and redundancy.',
  },
]

function ShowcaseCard({ 
  item, 
  index, 
  progress 
}: { 
  item: ShowcaseItem
  index: number
  progress: number
}) {
  // Calculate when this card should be active based on scroll progress
  const cardProgress = (progress - (index * 0.2)) * 5
  const isActive = cardProgress > 0 && cardProgress < 2
  const opacity = Math.max(0, Math.min(1, cardProgress > 1 ? 2 - cardProgress : cardProgress))
  const scale = 0.9 + (Math.min(1, cardProgress) * 0.1)
  const translateY = Math.max(0, (1 - cardProgress) * 50)

  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center transition-all duration-100'
      )}
      style={{
        opacity,
        transform: `scale(${scale}) translateY(${translateY}px)`,
        zIndex: isActive ? 10 : 1,
      }}
    >
      <div className="text-center max-w-2xl px-6">
        <span className="text-sm font-medium text-accent uppercase tracking-widest mb-4 block">
          {item.label}
        </span>
        <div className="font-serif text-7xl md:text-8xl lg:text-9xl font-bold text-gradient mb-6">
          {item.value}
        </div>
        <p className="text-lg md:text-xl text-muted-foreground max-w-lg mx-auto">
          {item.description}
        </p>
      </div>
    </div>
  )
}

function ProgressIndicator({ 
  total, 
  current 
}: { 
  total: number
  current: number 
}) {
  return (
    <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'w-2 h-2 rounded-full transition-all duration-300',
            i <= current 
              ? 'bg-primary scale-100' 
              : 'bg-border scale-75'
          )}
        />
      ))}
    </div>
  )
}

export function ImmersiveShowcase() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return
      
      const rect = containerRef.current.getBoundingClientRect()
      const windowHeight = window.innerHeight
      const elementHeight = rect.height
      
      // Progress: 0 when element enters, 1 when element leaves
      const start = windowHeight
      const end = -elementHeight
      const current = rect.top
      const total = start - end
      const scrolled = start - current
      
      const newProgress = Math.max(0, Math.min(1, scrolled / total))
      setProgress(newProgress)
      
      // Calculate current card index
      const index = Math.floor(newProgress * showcaseItems.length)
      setCurrentIndex(Math.min(index, showcaseItems.length - 1))
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <section 
      ref={containerRef}
      className="relative bg-background"
      style={{ height: `${(showcaseItems.length + 1) * 100}vh` }}
    >
      {/* Sticky container */}
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-muted/30 via-background to-muted/30" />
        
        {/* Subtle background circles */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />

        {/* Cards container */}
        <div className="relative h-full">
          {showcaseItems.map((item, index) => (
            <ShowcaseCard 
              key={item.label}
              item={item}
              index={index}
              progress={progress}
            />
          ))}
        </div>

        {/* Progress indicator */}
        <ProgressIndicator total={showcaseItems.length} current={currentIndex} />

        {/* Scroll hint */}
        <div 
          className={cn(
            'absolute bottom-8 left-1/2 -translate-x-1/2 text-sm text-muted-foreground transition-opacity duration-500',
            progress > 0.1 ? 'opacity-0' : 'opacity-100'
          )}
        >
          Scroll to explore
        </div>
      </div>
    </section>
  )
}
