import type { Abi, Address } from 'viem'

const SIDE_LABELS = ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO'] as const
const STATUS_LABELS = ['Active', 'Cancelled', 'Filled'] as const

export type ParsedOnchainOffer = {
  offerId: number
  maker: string
  marketId: bigint
  side: number
  sideLabel: string
  priceBps: bigint
  initialAmount: bigint
  remainingAmount: bigint
  status: number
  statusLabel: string
}

export function sideLabel(side: number): string {
  return SIDE_LABELS[side] ?? `SIDE_${side}`
}

export function offerStatusLabel(status: number): string {
  return STATUS_LABELS[status] ?? `STATUS_${status}`
}

/** Build readContract list for `offers(uint256)` for ids in [startId, endId). */
export function exchangeOfferReadContracts(
  exchangeAddress: Address,
  exchangeAbi: Abi,
  startId: bigint,
  endId: bigint,
): Array<{
  address: Address
  abi: Abi
  functionName: 'offers'
  args: readonly [bigint]
}> {
  if (endId <= startId) return []
  const out: Array<{
    address: Address
    abi: Abi
    functionName: 'offers'
    args: readonly [bigint]
  }> = []
  for (let i = startId; i < endId; i++) {
    out.push({
      address: exchangeAddress,
      abi: exchangeAbi,
      functionName: 'offers',
      args: [i],
    })
  }
  return out
}

export function parseOfferReadResults(
  startOfferId: bigint,
  rows: readonly { status: string; result?: unknown }[] | undefined,
  filterMarketId: bigint,
): ParsedOnchainOffer[] {
  if (rows === undefined) return []
  const out: ParsedOnchainOffer[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.status !== 'success' || row.result == null || typeof row.result !== 'object') continue
    const raw = row.result as {
      maker?: string
      marketId?: bigint
      side?: number | bigint
      price?: bigint
      initialAmount?: bigint
      remainingAmount?: bigint
      status?: number | bigint
    } & readonly unknown[]

    const maker = typeof raw.maker === 'string'
      ? raw.maker
      : typeof raw[0] === 'string'
        ? (raw[0] as string)
        : null
    const marketId = typeof raw.marketId === 'bigint'
      ? raw.marketId
      : typeof raw[1] === 'bigint'
        ? (raw[1] as bigint)
        : null
    const side = raw.side ?? (typeof raw[2] === 'number' || typeof raw[2] === 'bigint' ? raw[2] as number | bigint : null)
    const price = typeof raw.price === 'bigint'
      ? raw.price
      : typeof raw[3] === 'bigint'
        ? (raw[3] as bigint)
        : null
    const initialAmount = typeof raw.initialAmount === 'bigint'
      ? raw.initialAmount
      : typeof raw[4] === 'bigint'
        ? (raw[4] as bigint)
        : null
    const remainingAmount = typeof raw.remainingAmount === 'bigint'
      ? raw.remainingAmount
      : typeof raw[5] === 'bigint'
        ? (raw[5] as bigint)
        : null
    const status = raw.status ?? (typeof raw[6] === 'number' || typeof raw[6] === 'bigint' ? raw[6] as number | bigint : null)

    if (!maker || marketId === null || side === null || price === null || initialAmount === null || remainingAmount === null || status === null) continue
    if (maker === '0x0000000000000000000000000000000000000000') continue
    if (marketId !== filterMarketId) continue
    const st = Number(status)
    if (st !== 0) continue
    const sideN = Number(side)
    const offerId = Number(startOfferId) + i
    out.push({
      offerId,
      maker,
      marketId,
      side: sideN,
      sideLabel: sideLabel(sideN),
      priceBps: price,
      initialAmount,
      remainingAmount,
      status: st,
      statusLabel: offerStatusLabel(st),
    })
  }
  return out
}
