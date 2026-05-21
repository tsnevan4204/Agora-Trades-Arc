import { defineChain } from 'viem'

/** Circle Arc public testnet — https://docs.arc.network/arc/references/connect-to-arc */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Testnet Explorer',
      url: 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
})
