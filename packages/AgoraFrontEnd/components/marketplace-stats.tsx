"use client"

import { useEffect, useRef, useState } from 'react'
import { useScrollAnimation } from '@/hooks/use-scroll-animation'
import { cn } from '@/lib/utils'

const STATS = [
  { value: '$847M', label: 'Total Volume' },
  { value: '12.4K', label: 'Active Traders' },
  { value: '156',   label: 'Live Markets'  },
]

const STALL_DELAY = 420   // ms between each stall lighting up
const FIRST_DELAY = 120   // initial pause before first stall

export function MarketplaceStats() {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({
    threshold: 0.3,
    once: false,
  })
  const [lit, setLit] = useState([false, false, false])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setLit([false, false, false])

    if (isVisible) {
      STATS.forEach((_, i) => {
        const t = setTimeout(
          () => setLit((prev) => prev.map((v, idx) => (idx === i ? true : v))),
          FIRST_DELAY + i * STALL_DELAY,
        )
        timers.current.push(t)
      })
    }

    return () => timers.current.forEach(clearTimeout)
  }, [isVisible])

  return (
    <div
      ref={ref}
      className={cn(
        'w-full transition-all duration-700',
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}
    >
      <svg
        viewBox="0 0 480 172"
        className="w-full max-w-xl mx-auto"
        aria-label="Agora marketplace statistics"
      >
        {/* Ground line */}
        <rect x="0" y="158" width="480" height="3" rx="1.5" fill="var(--color-border)" opacity="0.5" />

        {/* Bunting string between the three peaks */}
        <path
          d="M 80 28 Q 160 58 240 28 Q 320 58 400 28"
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="1"
          strokeDasharray="3 5"
          opacity="0.55"
        />

        {/* Small pennant flags at the low points of the bunting scallops */}
        <polygon points="156,49 163,57 156,64" fill="var(--color-border)" opacity="0.38" />
        <polygon points="316,49 323,57 316,64" fill="var(--color-border)" opacity="0.38" />

        {/* Three stalls — centers at 80, 240, 400 on a 480-wide canvas */}
        {([80, 240, 400] as const).map((cx, i) => (
          <StallGroup key={cx} cx={cx} stat={STATS[i]} lit={lit[i]} />
        ))}
      </svg>
    </div>
  )
}

interface StallProps {
  cx: number
  stat: { value: string; label: string }
  lit: boolean
}

function StallGroup({ cx, stat, lit }: StallProps) {
  const hw   = 55   // half-width of stall
  const x1   = cx - hw
  const x2   = cx + hw
  const peakY      = 28   // tip of canopy
  const roofBaseY  = 72   // where canopy meets walls
  const valanceH   = 8    // depth of the scalloped valance
  const bodyTop    = roofBaseY + valanceH
  const bodyBottom = 148
  const counterH   = 9
  const textMidY   = bodyTop + (bodyBottom - bodyTop) / 2

  return (
    <g>
      {/* Soft radial glow when lit */}
      <ellipse
        cx={cx}
        cy={peakY + 14}
        rx={52}
        ry={34}
        fill="var(--color-primary)"
        opacity={lit ? 0.11 : 0}
        style={{ transition: 'opacity 0.5s ease' }}
      />

      {/* Canopy — triangular tent shape */}
      <polygon
        points={`${x1},${roofBaseY} ${cx},${peakY} ${x2},${roofBaseY}`}
        fill={lit ? 'var(--color-primary)' : 'var(--color-muted)'}
        opacity={lit ? 0.88 : 0.38}
        style={{ transition: 'fill 0.45s ease, opacity 0.45s ease' }}
      />

      {/* Valance strip — bottom edge of canopy */}
      <rect
        x={x1}
        y={roofBaseY - 1}
        width={hw * 2}
        height={valanceH + 1}
        fill={lit ? 'var(--color-primary)' : 'var(--color-border)'}
        opacity={lit ? 0.68 : 0.38}
        style={{ transition: 'fill 0.45s ease, opacity 0.45s ease' }}
      />

      {/* Stall body */}
      <rect
        x={x1 + 5}
        y={bodyTop}
        width={hw * 2 - 10}
        height={bodyBottom - bodyTop}
        rx="3"
        fill={lit ? 'var(--color-card)' : 'var(--color-secondary)'}
        stroke="var(--color-border)"
        strokeWidth="0.75"
        opacity={lit ? 1 : 0.45}
        style={{ transition: 'fill 0.45s ease, opacity 0.45s ease' }}
      />

      {/* Counter ledge at the bottom */}
      <rect
        x={x1}
        y={bodyBottom}
        width={hw * 2}
        height={counterH}
        rx="2"
        fill={lit ? 'var(--color-primary)' : 'var(--color-border)'}
        opacity={lit ? 0.5 : 0.28}
        style={{ transition: 'fill 0.45s ease, opacity 0.45s ease' }}
      />

      {/* Peak finial circle */}
      <circle
        cx={cx}
        cy={peakY}
        r={3.5}
        fill={lit ? 'var(--color-primary)' : 'var(--color-muted-foreground)'}
        opacity={lit ? 1 : 0.45}
        style={{ transition: 'fill 0.45s ease, opacity 0.45s ease' }}
      />

      {/* Stat value */}
      <text
        x={cx}
        y={textMidY - 6}
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
        fill="var(--color-foreground)"
        opacity={lit ? 1 : 0}
        style={{ transition: 'opacity 0.4s ease 0.12s' }}
      >
        {stat.value}
      </text>

      {/* Stat label */}
      <text
        x={cx}
        y={textMidY + 14}
        textAnchor="middle"
        fontSize="9"
        fontWeight="500"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="var(--color-muted-foreground)"
        opacity={lit ? 0.82 : 0}
        letterSpacing="0.7"
        style={{ transition: 'opacity 0.4s ease 0.18s' }}
      >
        {stat.label.toUpperCase()}
      </text>
    </g>
  )
}
