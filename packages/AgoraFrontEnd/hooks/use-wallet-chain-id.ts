'use client'

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'

/**
 * Chain ID reported by the wallet (MetaMask), not wagmi's configured default.
 * Updates on connect and on `chainChanged` so the UI matches what txs will use.
 */
export function useWalletChainId(): number | undefined {
  const { chainId: accountChainId, isConnected } = useAccount()
  const [chainId, setChainId] = useState<number | undefined>(accountChainId)

  useEffect(() => {
    setChainId(accountChainId)
  }, [accountChainId])

  useEffect(() => {
    if (!isConnected || typeof window === 'undefined') return
    type EthProvider = {
      request?(args: { method: string }): Promise<string>
      on?(event: string, handler: (hex: string) => void): void
      removeListener?(event: string, handler: (hex: string) => void): void
    }
    const eth = (window as typeof window & { ethereum?: EthProvider }).ethereum
    if (!eth?.request) return

    let cancelled = false
    void eth
      .request({ method: 'eth_chainId' })
      .then((hex) => {
        if (!cancelled) setChainId(parseInt(hex, 16))
      })
      .catch(() => {})

    const onChainChanged = (hex: string) => setChainId(parseInt(hex, 16))
    eth.on?.('chainChanged', onChainChanged)
    return () => {
      cancelled = true
      eth.removeListener?.('chainChanged', onChainChanged)
    }
  }, [isConnected])

  return chainId
}
