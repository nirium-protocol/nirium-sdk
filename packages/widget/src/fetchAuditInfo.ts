import type { AuditInfoResponse } from './types'

/**
 * Fetch anchored audit receipts for an app from `GET /api/audit/info`.
 *
 * Pure function — exported so consumers can call it directly without React.
 * Throws on network or non-2xx responses.
 */
export async function fetchAuditInfo(
  appId: string,
  options: { fetcher?: typeof fetch; baseUrl?: string; signal?: AbortSignal } = {},
): Promise<AuditInfoResponse> {
  if (!appId || typeof appId !== 'string') {
    throw new Error('fetchAuditInfo: appId is required')
  }
  const baseUrl = options.baseUrl ?? 'https://nirium-agent.fly.dev'
  const url = `${baseUrl.replace(/\/+$/, '')}/api/audit/info?app_id=${encodeURIComponent(appId)}`
  const f = options.fetcher ?? globalThis.fetch
  if (typeof f !== 'function') {
    throw new Error('fetchAuditInfo: no fetch implementation available')
  }

  const res = await f(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  })
  if (!res.ok) {
    throw new Error(`fetchAuditInfo: HTTP ${res.status} ${res.statusText}`)
  }
  const body = (await res.json()) as Partial<AuditInfoResponse>
  if (!body || typeof body !== 'object' || !Array.isArray(body.receipts)) {
    throw new Error('fetchAuditInfo: malformed response — expected { receipts: AuditReceipt[] }')
  }
  return {
    appId: body.appId ?? appId,
    receipts: body.receipts,
    nextCursor: body.nextCursor,
  }
}
