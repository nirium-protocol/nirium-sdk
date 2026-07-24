import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchAuditInfo } from '../src/fetchAuditInfo'

const sampleResponse = (n = 2) => ({
  appId: 'demo',
  receipts: Array.from({ length: n }, (_, i) => ({
    ipfsCid: `bafycid-${i}`,
    stellarTxHash: `${i}${'a'.repeat(50)}`,
    resourceId: `res-${i}`,
    anchoredAt: new Date(2026, 0, 1 + i, 12).toISOString(),
  })),
})

afterEach(() => vi.restoreAllMocks())

describe('fetchAuditInfo', () => {
  it('throws when appId is missing', async () => {
    await expect(fetchAuditInfo('')).rejects.toThrow(/appId/)
  })

  it('returns parsed receipts on 200 response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => sampleResponse(3),
    })
    const res = await fetchAuditInfo('demo', { fetcher: fetcher as unknown as typeof fetch })
    expect(res.receipts).toHaveLength(3)
    expect(res.appId).toBe('demo')
    expect(fetcher).toHaveBeenCalledWith(
      'https://nirium-agent.fly.dev/api/audit/info?app_id=demo',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses provided baseUrl and strips trailing slash', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleResponse(1),
    })
    await fetchAuditInfo('demo', {
      fetcher: fetcher as unknown as typeof fetch,
      baseUrl: 'https://example.test///',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/audit/info?app_id=demo',
      expect.anything(),
    )
  })

  it('throws on non-2xx response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    })
    await expect(
      fetchAuditInfo('demo', { fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('throws when response is missing receipts array', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appId: 'demo' }),
    })
    await expect(
      fetchAuditInfo('demo', { fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toThrow(/malformed/)
  })
})
