'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NewsItem } from '@/app/api/news/route'

const CATEGORY_COLOR: Record<string, string> = {
  Macro: 'text-primary bg-primary/10',
  Earnings: 'text-success bg-success/10',
  Crypto: 'text-accent bg-accent/10',
  Tech: 'text-primary/70 bg-primary/5',
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function NewsBanner() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/news')
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="h-10 w-full border-b border-border/40 bg-card/20">
        <div className="h-full w-1/3 animate-pulse bg-border/20 rounded" />
      </div>
    )
  }

  if (items.length === 0) return null

  // Duplicate items so the track loops seamlessly (CSS animation moves -50%)
  const doubled = [...items, ...items]

  return (
    <>
      {/* Keyframe injected once — scoped name avoids collisions */}
      <style>{`
        @keyframes agora-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .agora-marquee-track {
          animation: agora-marquee 130s linear infinite;
          will-change: transform;
        }
        .agora-marquee-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      <div className="relative w-full border-b border-border/40 bg-card/30 backdrop-blur-sm overflow-hidden">
        {/* "Market News" label pinned left with fade-out gradient */}
        <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center gap-2 pl-4 pr-10 pointer-events-none select-none bg-gradient-to-r from-card/95 via-card/70 to-transparent">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary whitespace-nowrap">
            Market News
          </span>
        </div>

        {/* Scrolling strip */}
        <div className="overflow-hidden pl-36">
          <div className="agora-marquee-track flex items-center w-max">
            {doubled.map((item, i) => (
              <a
                key={i}
                href={item.link || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 px-4 py-2.5 shrink-0 hover:opacity-75 transition-opacity cursor-pointer"
              >
                {/* Category pill */}
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0',
                    CATEGORY_COLOR[item.category] ?? 'text-muted-foreground bg-muted',
                  )}
                >
                  {item.category}
                </span>

                {/* Headline — generous max width, truncated */}
                <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors max-w-sm truncate">
                  {item.title}
                </span>

                {/* Recency */}
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                  {timeAgo(item.pubDate)}
                </span>

                {/* External link icon appears on hover */}
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />

                {/* Separator dot */}
                <span className="mx-1 text-border/50 text-base shrink-0 select-none" aria-hidden>
                  ·
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Right fade — mirrors the left badge gradient */}
        <div className="absolute right-0 top-0 bottom-0 w-20 pointer-events-none z-10 bg-gradient-to-l from-card/80 to-transparent" />
      </div>
    </>
  )
}
