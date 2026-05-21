import { backendBaseUrl } from '@/lib/env'

export { backendBaseUrl }

export type HealthResponse = { ok?: boolean; storage?: string }

export async function fetchBackendHealth(): Promise<HealthResponse | null> {
  try {
    const r = await fetch(`${backendBaseUrl}/health`, { cache: 'no-store' })
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

export type OffchainOrder = {
  orderId: string
  marketId: number
  maker: string
  side: string
  priceBps: number
  amount: number
  status?: string
}

export async function fetchOrders(marketId: number): Promise<{ orders: OffchainOrder[]; ok: boolean }> {
  try {
    const r = await fetch(`${backendBaseUrl}/orders/${marketId}`, { cache: 'no-store' })
    if (!r.ok) return { orders: [], ok: false }
    const j = (await r.json()) as { orders?: OffchainOrder[] }
    return { orders: Array.isArray(j.orders) ? j.orders : [], ok: true }
  } catch {
    return { orders: [], ok: false }
  }
}

export async function postOffchainOrder(order: OffchainOrder): Promise<{ saved?: boolean; error?: string }> {
  const r = await fetch(`${backendBaseUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: (j as { detail?: string }).detail ?? r.statusText }
  return j as { saved?: boolean }
}

export type EventProposalPayload = {
  proposalId: string
  proposerAddress: string
  title: string
  category: string
  ticker: string
  metric: string
  fiscalYear: number
  fiscalQuarter: number
  suggestedRanges: string[]
  status?: string
}

export async function postProposal(body: EventProposalPayload): Promise<{ saved?: boolean; error?: string }> {
  const r = await fetch(`${backendBaseUrl}/proposals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: (j as { detail?: string }).detail ?? r.statusText }
  return j as { saved?: boolean }
}

export type ProposalRecord = {
  proposalId: string
  title: string
  category: string
  ticker?: string
  metric?: string
  proposerAddress?: string
  submittedAtUtc?: string
  status: 'pending' | 'approved' | 'rejected'
  rejectReason?: string
  approvedBy?: string
  rejectedBy?: string
  [key: string]: unknown
}

export async function fetchProposals(status?: string): Promise<ProposalRecord[]> {
  try {
    const url = status
      ? `${backendBaseUrl}/proposals?status=${encodeURIComponent(status)}`
      : `${backendBaseUrl}/proposals`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return []
    const j = (await r.json()) as { proposals?: ProposalRecord[] }
    return Array.isArray(j.proposals) ? j.proposals : []
  } catch {
    return []
  }
}

export async function fetchProposal(proposalId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${backendBaseUrl}/proposals/${encodeURIComponent(proposalId)}`, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export type ProposalMarketSpecPayload = {
  question: string
  resolutionSpecHash: string
  resolutionSpecURI: string
}

export async function postApproveProposal(
  proposalId: string,
  body: { confirmedBy: string; closeTimeUnix: number; markets: ProposalMarketSpecPayload[] },
): Promise<{ approved?: boolean; error?: string; detail?: unknown }> {
  const r = await fetch(`${backendBaseUrl}/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: (j as { detail?: string }).detail ?? r.statusText, detail: j }
  return j as { approved?: boolean }
}

export async function postRejectProposal(
  proposalId: string,
  body: { confirmedBy: string; reason: string },
): Promise<{ rejected?: boolean; error?: string }> {
  const r = await fetch(`${backendBaseUrl}/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: (j as { detail?: string }).detail ?? r.statusText }
  return j as { rejected?: boolean }
}

export async function postResolveMarkets(
  eventId: number,
  body: { confirmedBy: string; marketIds: number[]; outcomes: Record<string, string>; reason?: string | null },
): Promise<{ resolved?: boolean; error?: string; evidenceHash?: string; detail?: unknown }> {
  const r = await fetch(`${backendBaseUrl}/resolution/resolve/${eventId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: (j as { detail?: string }).detail ?? r.statusText, detail: j }
  return j as { resolved?: boolean; evidenceHash?: string }
}
