'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  BookOpen,
  Home,
  LayoutGrid,
  Lightbulb,
  Settings,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/markets', label: 'Markets', icon: LayoutGrid },
  { href: '/trade', label: 'Trade', icon: BookOpen },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/propose', label: 'Propose', icon: Lightbulb },
  { href: '/admin', label: 'Admin', icon: Settings },
]

export function GlobalNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      {/* Waffle button — fixed bottom-right on all pages */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open navigation"
        className={cn(
          'fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl shadow-xl transition-all duration-300',
          'flex items-center justify-center',
          'bg-primary text-primary-foreground',
          'hover:scale-110 hover:shadow-primary/30',
          open && 'rotate-90',
        )}
      >
        {open ? (
          <X className="w-5 h-5" />
        ) : (
          /* 3×3 waffle grid icon */
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <rect x="0" y="0" width="5" height="5" rx="1" />
            <rect x="6.5" y="0" width="5" height="5" rx="1" />
            <rect x="13" y="0" width="5" height="5" rx="1" />
            <rect x="0" y="6.5" width="5" height="5" rx="1" />
            <rect x="6.5" y="6.5" width="5" height="5" rx="1" />
            <rect x="13" y="6.5" width="5" height="5" rx="1" />
            <rect x="0" y="13" width="5" height="5" rx="1" />
            <rect x="6.5" y="13" width="5" height="5" rx="1" />
            <rect x="13" y="13" width="5" height="5" rx="1" />
          </svg>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Menu panel */}
      <div
        className={cn(
          'fixed bottom-20 right-6 z-50 w-52 rounded-2xl border border-border/60 bg-card shadow-2xl shadow-primary/10 p-2 transition-all duration-300 origin-bottom-right',
          open ? 'scale-100 opacity-100 pointer-events-auto' : 'scale-90 opacity-0 pointer-events-none',
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pt-2 pb-1">
          Navigate
        </p>
        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
