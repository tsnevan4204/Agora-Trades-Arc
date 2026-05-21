"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Menu, X, Wallet } from 'lucide-react'
import { useAccount, useEnsName, useDisconnect } from 'wagmi'

const navLinks = [
  { href: '/markets', label: 'Markets' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#data', label: 'Data' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/propose', label: 'Propose' },
]

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const { address, isConnected } = useAccount()
  const { data: ensName } = useEnsName({ address, chainId: 1 })
  const { disconnect } = useDisconnect()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const displayName = ensName
    ? ensName
    : address
    ? truncateAddress(address)
    : null

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500',
        isScrolled
          ? 'glass border-b border-border/50 py-4'
          : 'py-6 bg-transparent'
      )}
    >
      <nav className="container mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 group"
        >
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="text-primary-foreground font-serif text-xl font-bold">A</span>
          </div>
          <span className="font-serif text-2xl font-semibold tracking-tight">Agora</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground transition-colors duration-300 text-sm tracking-wide"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* CTA — wallet-aware */}
        <div className="hidden md:flex items-center gap-4">
          {mounted && isConnected && displayName ? (
            <>
              <button
                onClick={() => disconnect()}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                title="Disconnect wallet"
              >
                <Wallet className="w-4 h-4 text-primary" />
                <span>Welcome, <span className="font-medium text-foreground">{displayName}</span></span>
              </button>
              <Button className="text-sm bg-primary hover:bg-primary/90 transition-all duration-300 hover:shadow-lg" asChild>
                <Link href="/trade">Trade</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="text-sm" asChild>
                <Link href="/signin">Sign In</Link>
              </Button>
              <Button className="text-sm bg-primary hover:bg-primary/90 transition-all duration-300 hover:shadow-lg" asChild>
                <Link href="/trade">Launch App</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {isMobileMenuOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>
      </nav>

      {/* Mobile Menu */}
      <div
        className={cn(
          'md:hidden absolute top-full left-0 right-0 glass border-b border-border/50 overflow-hidden transition-all duration-300',
          isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="container mx-auto px-6 py-6 flex flex-col gap-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            {mounted && isConnected && displayName ? (
              <>
                <div className="flex items-center gap-2 text-sm py-1">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span>Welcome, <span className="font-medium">{displayName}</span></span>
                </div>
                <Button className="w-full justify-center" asChild>
                  <Link href="/trade" onClick={() => setIsMobileMenuOpen(false)}>Trade</Link>
                </Button>
                <Button variant="ghost" className="w-full justify-center text-muted-foreground" onClick={() => { disconnect(); setIsMobileMenuOpen(false) }}>
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="w-full justify-center" asChild>
                  <Link href="/signin">Sign In</Link>
                </Button>
                <Button className="w-full justify-center" asChild>
                  <Link href="/trade">Launch App</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
