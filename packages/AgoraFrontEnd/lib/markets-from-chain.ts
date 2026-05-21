import type { Abi, Address } from 'viem'

export type DiscoveredMarket = {
  id: number
  question: string
  eventId: bigint
  resolutionSpecURI: string
  closeTime: number // unix timestamp; 0 if unknown
}

type MarketDataResult = {
  eventId: bigint
  question: string
  resolutionSpecHash: `0x${string}`
  resolutionSpecURI: string
  exists: boolean
}

/**
 * Rows layout (interleaved):
 *   row[2i]   = getMarketData(i)
 *   row[2i+1] = getMarketCloseTime(i)
 */
export function parseMarketsFromMulticall(
  nextMarketId: bigint | undefined,
  rows: readonly { status: string; result?: unknown }[] | undefined,
): DiscoveredMarket[] {
  if (nextMarketId === undefined || rows === undefined || nextMarketId === 0n) return []
  const n = Number(nextMarketId)
  const out: DiscoveredMarket[] = []
  for (let i = 0; i < n; i++) {
    const dataRow = rows[i * 2]
    const timeRow = rows[i * 2 + 1]
    if (!dataRow || dataRow.status !== 'success' || dataRow.result == null || typeof dataRow.result !== 'object') continue
    const r = dataRow.result as MarketDataResult
    if (!r.exists) continue
    const closeTime = timeRow?.status === 'success' && typeof timeRow.result === 'bigint'
      ? Number(timeRow.result)
      : 0
    out.push({
      id: i,
      question: r.question,
      eventId: r.eventId,
      resolutionSpecURI: r.resolutionSpecURI,
      closeTime,
    })
  }
  return out
}

/** Build interleaved multicall: [getMarketData(0), getMarketCloseTime(0), getMarketData(1), ...] */
export function factoryMarketReadContracts(
  factoryAddress: Address,
  factoryAbi: Abi,
  nextMarketId: bigint | undefined,
): Array<{
  address: Address
  abi: Abi
  functionName: string
  args: readonly [bigint]
}> {
  if (nextMarketId === undefined || nextMarketId === 0n) return []
  const n = Number(nextMarketId)
  const calls: Array<{ address: Address; abi: Abi; functionName: string; args: readonly [bigint] }> = []
  for (let i = 0; i < n; i++) {
    const id = BigInt(i)
    calls.push({ address: factoryAddress, abi: factoryAbi, functionName: 'getMarketData', args: [id] })
    calls.push({ address: factoryAddress, abi: factoryAbi, functionName: 'getMarketCloseTime', args: [id] })
  }
  return calls
}
