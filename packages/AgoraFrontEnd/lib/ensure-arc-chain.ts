import { getWalletClient, switchChain, type Config } from '@wagmi/core'
import { arcTestnet } from '@/lib/chains/arcTestnet'

/** Params for `wallet_addEthereumChain` when Arc is not in MetaMask yet. */
export const arcAddEthereumChainParameter = {
  chainName: arcTestnet.name,
  nativeCurrency: {
    name: arcTestnet.nativeCurrency.name,
    symbol: arcTestnet.nativeCurrency.symbol,
    decimals: arcTestnet.nativeCurrency.decimals,
  },
  rpcUrls: [...arcTestnet.rpcUrls.default.http] as [string, ...string[]],
  blockExplorerUrls: [arcTestnet.blockExplorers.default.url] as string[],
}

const POLL_MS = 200
const POLL_ATTEMPTS = 25

async function readWalletChainId(config: Config): Promise<number | null> {
  try {
    const client = await getWalletClient(config)
    if (!client) return null
    return client.getChainId()
  } catch {
    return null
  }
}

/**
 * Ensure the connected wallet is on Circle Arc Testnet (5042002) before sending txs.
 * Adds the chain to MetaMask if missing, switches, then polls until the wallet reports Arc.
 */
export async function ensureArcWalletChain(config: Config): Promise<boolean> {
  let walletChainId = await readWalletChainId(config)
  if (walletChainId === arcTestnet.id) return true
  if (walletChainId == null) return false

  try {
    await switchChain(config, {
      chainId: arcTestnet.id,
      addEthereumChainParameter: arcAddEthereumChainParameter,
    })
  } catch {
    return false
  }

  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    walletChainId = await readWalletChainId(config)
    if (walletChainId === arcTestnet.id) return true
  }

  return false
}

export function arcChainMismatchMessage(walletChainId: number | undefined): string {
  if (walletChainId === 97) {
    return 'MetaMask is on BNB Smart Chain Testnet (97). Switch to Arc Testnet (5042002), then approve again.'
  }
  return `MetaMask is on chain ${walletChainId ?? 'unknown'}. Switch to Arc Testnet (5042002), then approve again.`
}
