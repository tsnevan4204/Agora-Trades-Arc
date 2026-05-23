import type { Abi, Address } from 'viem'

export type DiscoveredMarket = {
  id: number
  question: string
  eventId: bigint
  resolutionSpecURI: string
  closeTime: number // unix timestamp; 0 if unknown
}

export type DiscoveredEvent = {
  eventId: bigint
  title: string
  category: string
  closeTime: number
}

type MarketDataResult = {
  eventId: bigint
  question: string
  resolutionSpecHash: `0x${string}`
  resolutionSpecURI: string
  exists: boolean
}

type EventDataResult = {
  title: string
  category: string
  closeTime: bigint
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

/** Build one getEventData call per eventId (preserves the input order). */
export function factoryEventReadContracts(
  factoryAddress: Address,
  factoryAbi: Abi,
  eventIds: readonly bigint[],
): Array<{ address: Address; abi: Abi; functionName: string; args: readonly [bigint] }> {
  return eventIds.map((eid) => ({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: 'getEventData',
    args: [eid] as const,
  }))
}

/**
 * Parse the result of `factoryEventReadContracts`. The output mirrors the
 * input `eventIds` order; missing or non-existent events are skipped.
 */
export function parseEventsFromMulticall(
  eventIds: readonly bigint[],
  rows: readonly { status: string; result?: unknown }[] | undefined,
): DiscoveredEvent[] {
  if (!rows || rows.length === 0) return []
  const out: DiscoveredEvent[] = []
  eventIds.forEach((eid, i) => {
    const row = rows[i]
    if (!row || row.status !== 'success' || row.result == null || typeof row.result !== 'object') return
    const r = row.result as EventDataResult
    if (!r.exists) return
    out.push({
      eventId: eid,
      title: r.title,
      category: r.category,
      closeTime: typeof r.closeTime === 'bigint' ? Number(r.closeTime) : 0,
    })
  })
  return out
}

/**
 * Resolution state for a single market read from
 * `PredictionMarketManager.markets(marketId)` (auto-generated public mapping
 * getter). `Open` = trading still allowed; `Resolved` = winner declared and
 * winning-side holders can redeem 1:1.
 */
export type MarketResolution = {
  marketId: number
  status: 'Open' | 'Resolved'
  winningOutcome: 'YES' | 'NO' | null
}

/**
 * Build a multicall that fetches `markets(marketId)` from the Manager for
 * every existing on-chain market id. Used by the markets dashboard and
 * portfolio page to flag which events have already been resolved.
 */
export function managerResolutionReadContracts(
  managerAddress: Address,
  managerAbi: Abi,
  nextMarketId: bigint | undefined,
): Array<{ address: Address; abi: Abi; functionName: string; args: readonly [bigint] }> {
  if (nextMarketId === undefined || nextMarketId === 0n) return []
  const n = Number(nextMarketId)
  const out: Array<{ address: Address; abi: Abi; functionName: string; args: readonly [bigint] }> = []
  for (let i = 0; i < n; i++) {
    out.push({
      address: managerAddress,
      abi: managerAbi,
      functionName: 'markets',
      args: [BigInt(i)] as const,
    })
  }
  return out
}

/**
 * Parse multicall results for `Manager.markets(marketId)`.
 *
 * The auto-generated mapping getter returns a tuple `(status, winningOutcome,
 * totalShares)` where `status` is the `MarketStatus` enum (0=Open, 1=Resolved)
 * and `winningOutcome` is the `Outcome` enum (0=YES, 1=NO). The viem multicall
 * returns each tuple as a JS array `[number, number, bigint]`.
 *
 * Returns one `MarketResolution` per requested id (in input order). Rows whose
 * call failed are returned as `Open` with `winningOutcome: null` so callers
 * can still render the market — failure usually means an out-of-range id that
 * we should treat as not-yet-resolved rather than blowing up.
 */
export function parseResolutionsFromMulticall(
  nextMarketId: bigint | undefined,
  rows: readonly { status: string; result?: unknown }[] | undefined,
): MarketResolution[] {
  if (nextMarketId === undefined || nextMarketId === 0n) return []
  const n = Number(nextMarketId)
  const out: MarketResolution[] = []
  for (let i = 0; i < n; i++) {
    const row = rows?.[i]
    let statusEnum = 0
    let outcomeEnum = 0
    if (row?.status === 'success' && Array.isArray(row.result)) {
      const tuple = row.result as readonly [number, number, bigint] | readonly unknown[]
      if (typeof tuple[0] === 'number') statusEnum = tuple[0]
      if (typeof tuple[1] === 'number') outcomeEnum = tuple[1]
    }
    const resolved = statusEnum === 1
    out.push({
      marketId: i,
      status: resolved ? 'Resolved' : 'Open',
      winningOutcome: resolved ? (outcomeEnum === 0 ? 'YES' : 'NO') : null,
    })
  }
  return out
}
