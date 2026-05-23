import { backendBaseUrl } from '@/lib/env'

export { backendBaseUrl }

// ─── Admin auth token storage ────────────────────────────────────────────────

/**
 * Where the bearer token returned by `POST /admin/login` is cached for the
 * tab session. We use `sessionStorage` (not localStorage) so the token dies
 * with the tab — short-lived by design, since it's an admin credential.
 *
 * All admin-mutating helpers (`postApproveProposal`, `postRejectProposal`,
 * `postResolveMarkets`) read this token and send it as
 * `Authorization: Bearer <token>`. If the backend rejects the token (401)
 * the helpers clear it so the next call surfaces a clean "log in again"
 * state to the UI.
 */
const ADMIN_TOKEN_KEY = 'agora_admin_token'

function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY)
  } catch {
    return null
  }
}

export function getAdminToken(): string | null {
  return readAdminToken()
}

export function setAdminToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
    else window.sessionStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    // sessionStorage can throw in private windows / iframes; silently noop.
  }
}

/**
 * Build a `fetch` headers object that includes the admin bearer if we have
 * one. Helper exists so we don't repeat the conditional in five places, and
 * so a future migration (cookie session, refresh token, etc.) is one edit.
 */
function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = readAdminToken()
  return token
    ? { ...extra, Authorization: `Bearer ${token}` }
    : { ...extra }
}

/**
 * Drop the cached token if the backend says it's invalid. Centralised so any
 * admin helper can call this on a 401 and we don't end up with stale tokens
 * surviving across log-out scenarios.
 */
function clearAdminTokenOn401(status: number): void {
  if (status === 401) setAdminToken(null)
}

// ─── Backend status ──────────────────────────────────────────────────────────

export type HealthResponse = {
  ok?: boolean
  storage?: string
  adminAuthConfigured?: boolean
}

export async function fetchBackendHealth(): Promise<HealthResponse | null> {
  try {
    const r = await fetch(`${backendBaseUrl}/health`, { cache: 'no-store' })
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

// ─── Admin login ─────────────────────────────────────────────────────────────

export type AdminLoginResponse = {
  token: string
  expiresAt: number
  username: string
}

/**
 * Exchange admin credentials for a bearer token. The token is stored in
 * sessionStorage on success — callers can then use the protected admin
 * helpers without threading the token through. Returns `{ error }` for
 * anything other than HTTP 200 so the UI can surface the backend message
 * verbatim.
 */
export async function postAdminLogin(body: {
  username: string
  password: string
}): Promise<{ data?: AdminLoginResponse; error?: string }> {
  const r = await fetch(`${backendBaseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    return { error: (j as { detail?: string }).detail ?? r.statusText }
  }
  const data = j as AdminLoginResponse
  setAdminToken(data.token)
  return { data }
}

/** Cheap server-side validation of the cached token. */
export async function fetchAdminMe(): Promise<{ username: string; expiresAt: number } | null> {
  try {
    const r = await fetch(`${backendBaseUrl}/admin/me`, {
      headers: adminHeaders(),
      cache: 'no-store',
    })
    if (!r.ok) {
      clearAdminTokenOn401(r.status)
      return null
    }
    return (await r.json()) as { username: string; expiresAt: number }
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

/**
 * Remove an off-chain order from the live snapshot. Call this any time the
 * on-chain Exchange marks the underlying offer as Filled or Cancelled so the
 * GCS mirror doesn't grow unboundedly with terminal entries. Idempotent —
 * `deleted: false` just means it had already been pruned.
 */
export async function deleteOffchainOrder(
  marketId: number,
  orderId: string,
): Promise<{ deleted: boolean }> {
  const r = await fetch(
    `${backendBaseUrl}/orders/${marketId}/${encodeURIComponent(orderId)}`,
    { method: 'DELETE' },
  )
  if (!r.ok) return { deleted: false }
  const j = (await r.json().catch(() => ({}))) as { deleted?: boolean }
  return { deleted: Boolean(j.deleted) }
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
  fiscalYear?: number
  fiscalQuarter?: number
  suggestedRanges?: string[]
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
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    clearAdminTokenOn401(r.status)
    return { error: (j as { detail?: string }).detail ?? r.statusText, detail: j }
  }
  return j as { approved?: boolean }
}

export async function postRejectProposal(
  proposalId: string,
  body: { confirmedBy: string; reason: string },
): Promise<{ rejected?: boolean; error?: string }> {
  const r = await fetch(`${backendBaseUrl}/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    clearAdminTokenOn401(r.status)
    return { error: (j as { detail?: string }).detail ?? r.statusText }
  }
  return j as { rejected?: boolean }
}

/**
 * Per-market on-chain submission record returned by the backend after a
 * resolution attempt. Mirrors `TxRecord` in `packages/backend/app/chain.py`.
 */
export type ResolveTxRecord = {
  market_id: number
  tx_hash: string
  ok: boolean
  error?: string | null
}

/**
 * `onChain` envelope returned by `POST /resolution/resolve/{eventId}`.
 *
 *   • `overall = "confirmed"`         → every market resolved on-chain.
 *   • `overall = "partial_failure"`   → at least one resolve() reverted.
 *   • `overall = "failed"`            → all resolve() calls reverted.
 *   • `overall = "error"`             → an exception was raised before/while
 *                                       submitting (bad config, RPC down, …).
 *   • `skipped = true`                → backend isn't configured to submit
 *                                       on-chain (no RESOLVER_PRIVATE_KEY,
 *                                       MANAGER_ADDRESS, or RPC_URL).
 */
export type ResolveOnChain = {
  overall?: 'confirmed' | 'partial_failure' | 'failed' | 'error'
  error?: string
  txRecords?: ResolveTxRecord[]
  skipped?: boolean
  reason?: string
}

export async function postResolveMarkets(
  eventId: number,
  body: { confirmedBy: string; marketIds: number[]; outcomes: Record<string, string>; reason?: string | null },
): Promise<{
  resolved?: boolean
  error?: string
  evidenceHash?: string
  detail?: unknown
  onChain?: ResolveOnChain
}> {
  const r = await fetch(`${backendBaseUrl}/resolution/resolve/${eventId}`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    clearAdminTokenOn401(r.status)
    return { error: (j as { detail?: string }).detail ?? r.statusText, detail: j }
  }
  return j as { resolved?: boolean; evidenceHash?: string; onChain?: ResolveOnChain }
}
