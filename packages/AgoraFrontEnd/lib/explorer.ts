import { arcTestnet } from '@/lib/chains/arcTestnet'

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const h = txHash.startsWith('0x') ? txHash : `0x${txHash}`
  if (chainId === arcTestnet.id) {
    return `${arcTestnet.blockExplorers.default.url}/tx/${h}`
  }
  return null
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === arcTestnet.id) {
    return `${arcTestnet.blockExplorers.default.url}/address/${address}`
  }
  return null
}
