import { type Abi, type Address, parseAbi } from 'viem'

/**
 * Canonical Circle USDC ERC-20 on Arc testnet (6 decimals).
 * Source: https://docs.arc.network/arc/references/contract-addresses
 *
 * USDC on Arc has a dual interface — the native gas token and the ERC-20 share
 * the same balance — so this same address is what the protocol uses as collateral.
 */
export const ARC_TESTNET_USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000'

export const usdcErc20Abi: Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

/**
 * Convenience handle for the Arc testnet USDC contract (canonical address +
 * minimal ERC-20 ABI). Matches the shape returned by `mustGetContract` so it
 * can be used as a drop-in collateral handle in components.
 */
export const arcUsdcContract = {
  address: ARC_TESTNET_USDC_ADDRESS,
  abi: usdcErc20Abi,
} as const
