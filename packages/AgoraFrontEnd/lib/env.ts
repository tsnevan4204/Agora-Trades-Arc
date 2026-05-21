export const backendBaseUrl =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, '')) ||
  'http://127.0.0.1:8001'

export const publicRpcUrl =
  (typeof process !== 'undefined' &&
    (
      process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ||
      process.env.NEXT_PUBLIC_RPC_URL
    )?.trim()) ||
  undefined

/** WalletConnect Cloud project id — enables the WalletConnect connector in Wagmi. */
export const walletConnectProjectId =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID?.trim()) || undefined
