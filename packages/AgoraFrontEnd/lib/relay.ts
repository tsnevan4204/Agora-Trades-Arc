import type { Address, WalletClient, PublicClient, Hex } from 'viem'
import { encodeFunctionData } from 'viem'
import { backendBaseUrl } from '@/lib/env'
import type { Abi } from 'viem'

const forwardTypes = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const

/** 6 decimals — matches tests (`toShares`) and backend relay script. */
export const SHARE_DECIMALS = 6
export const shareUnits = (whole: string) => {
  const [a, b = ''] = whole.trim().split('.')
  const frac = (b + '000000').slice(0, SHARE_DECIMALS)
  return BigInt(a || '0') * 10n ** BigInt(SHARE_DECIMALS) + BigInt(frac || '0')
}

export function encodeSplit(managerAbi: Abi, marketId: bigint, amount: bigint): Hex {
  return encodeFunctionData({
    abi: managerAbi,
    functionName: 'split',
    args: [marketId, amount],
  })
}

export function encodeMerge(managerAbi: Abi, marketId: bigint, amount: bigint): Hex {
  return encodeFunctionData({
    abi: managerAbi,
    functionName: 'merge',
    args: [marketId, amount],
  })
}

export function encodeRedeem(managerAbi: Abi, marketId: bigint): Hex {
  return encodeFunctionData({
    abi: managerAbi,
    functionName: 'redeem',
    args: [marketId],
  })
}

/** Side: 0 BUY_YES, 1 BUY_NO, 2 SELL_YES, 3 SELL_NO */
export function encodePostOffer(
  exchangeAbi: Abi,
  marketId: bigint,
  side: number,
  priceBps: bigint,
  amount: bigint,
): Hex {
  return encodeFunctionData({
    abi: exchangeAbi,
    functionName: 'postOffer',
    args: [marketId, side, priceBps, amount],
  })
}

export function encodeFillOffer(exchangeAbi: Abi, offerId: bigint, fillAmount: bigint): Hex {
  return encodeFunctionData({
    abi: exchangeAbi,
    functionName: 'fillOffer',
    args: [offerId, fillAmount],
  })
}

export function encodeCancelOffer(exchangeAbi: Abi, offerId: bigint): Hex {
  return encodeFunctionData({
    abi: exchangeAbi,
    functionName: 'cancelOffer',
    args: [offerId],
  })
}

function normalizeTxHash(txHash?: string): `0x${string}` | undefined {
  if (!txHash) return undefined
  return (txHash.startsWith('0x') ? txHash : `0x${txHash}`) as `0x${string}`
}

export async function relayForward(params: {
  walletClient: WalletClient
  publicClient: PublicClient
  chainId: number
  userAddress: Address
  forwarder: Address
  forwarderAbi: Abi
  target: Address
  data: Hex
  gas?: bigint
}): Promise<{ ok: boolean; txHash?: string; reason?: string }> {
  const {
    walletClient,
    publicClient,
    chainId,
    userAddress,
    forwarder,
    forwarderAbi,
    target,
    data,
    gas = 500_000n,
  } = params

  console.debug('[relay] starting relay', { userAddress, target, chainId, dataPrefix: data.slice(0, 10) })

  const nonceRaw = await publicClient.readContract({
    address: forwarder,
    abi: forwarderAbi,
    functionName: 'nonces',
    args: [userAddress],
  })
  const nonce = BigInt(nonceRaw as bigint)
  console.debug('[relay] forwarder nonce:', nonce.toString())

  const block = await publicClient.getBlock({ blockTag: 'latest' })
  const deadline = BigInt(block.timestamp) + BigInt(3600)

  const domain = {
    name: 'AgoraForwarder',
    version: '1',
    chainId,
    verifyingContract: forwarder,
  } as const

  const message = {
    from: userAddress,
    to: target,
    value: BigInt(0),
    gas,
    nonce,
    deadline,
    data,
  }

  console.debug('[relay] signing EIP-712 forward request', {
    from: message.from,
    to: message.to,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    selector: data.slice(0, 10),
  })

  const signature = await walletClient.signTypedData({
    domain,
    types: forwardTypes,
    primaryType: 'ForwardRequest',
    message: {
      ...message,
      deadline: Number(message.deadline),
    },
    account: userAddress,
  })

  const payload = {
    from: userAddress,
    to: target,
    value: 0,
    gas: Number(gas),
    deadline: Number(deadline),
    data,
    signature,
  }

  console.debug('[relay] sending to backend /relay/forward', { from: payload.from, to: payload.to })

  const r = await fetch(`${backendBaseUrl}/relay/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = (await r.json()) as { ok?: boolean; txHash?: string; reason?: string }
  console.debug('[relay] backend response', { httpStatus: r.status, body })

  if (!r.ok) {
    return { ok: false, reason: typeof body === 'object' && body?.reason ? body.reason : r.statusText }
  }
  return { ok: Boolean(body.ok), txHash: normalizeTxHash(body.txHash), reason: body.reason }
}
