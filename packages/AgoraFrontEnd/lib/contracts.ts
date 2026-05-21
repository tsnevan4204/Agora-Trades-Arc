import type { Abi, Address } from 'viem'
import { deployedContracts } from '@/contracts/deployedContracts'

export type ContractName = keyof (typeof deployedContracts)[keyof typeof deployedContracts]

export function getContractsForChain(chainId: number) {
  const row = deployedContracts[chainId as keyof typeof deployedContracts]
  if (!row) return null
  return row
}

export function mustGetContract(chainId: number, name: ContractName): { address: Address; abi: Abi } {
  const row = getContractsForChain(chainId)
  if (!row) throw new Error(`No deployments for chain ${chainId}. Run yarn hardhat deploy --tags sync-frontend.`)
  const c = row[name] as { address: string; abi: Abi }
  if (!c?.address) throw new Error(`Missing contract ${String(name)} on chain ${chainId}`)
  return { address: c.address as Address, abi: c.abi }
}
