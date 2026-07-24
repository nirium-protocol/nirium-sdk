import * as React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { AuditTrailViewer } from '../src/AuditTrailViewer'
import type { AuditReceipt } from '../src/types'

afterEach(() => cleanup())

function makeReceipt(overrides: Partial<AuditReceipt> = {}): AuditReceipt {
  return {
    ipfsCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3gexkd3xhfwyqlq',
    stellarTxHash:
      'a'.repeat(56), // realistic Stellar hash length (32 bytes hex-encoded)
    resourceId: 'route:/api/v1/premium/signals',
    anchoredAt: '2026-07-24T08:15:00Z',
    memo: 'x402 receipt',
    ...overrides,
  }
}

describe('<AuditTrailViewer />', () => {
  it('renders an empty state when the API returns zero receipts', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appId: 'demo', receipts: [] }),
    })
    render(<AuditTrailViewer appId="demo" fetcher={fetcher as unknown as typeof fetch} />)
    expect(await screen.findByText(/No receipts anchored yet/i)).toBeInTheDocument()
    expect(screen.getByTestId('audit-trail-viewer').getAttribute('data-status')).toBe('empty')
  })

  it('renders one row per receipt with IPFS CID + Stellar tx links', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        appId: 'demo',
        receipts: [
          makeReceipt(),
          makeReceipt({ resourceId: 'route:/api/v1/premium/market' }),
        ],
      }),
    })
    render(<AuditTrailViewer appId="demo" fetcher={fetcher as unknown as typeof fetch} />)
    await waitFor(() =>
      expect(screen.getAllByTestId('audit-receipt-row')).toHaveLength(2),
    )
    expect(screen.getAllByTestId('audit-ipfs-link')).toHaveLength(2)
    expect(screen.getAllByTestId('audit-stellar-link')).toHaveLength(2)
    const links = screen.getAllByTestId('audit-stellar-link')
    expect(links[0].getAttribute('href')).toMatch(/^https:\/\/stellar\.expert\//)
  })

  it('surfaces an error message when the API fails', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
    })
    render(<AuditTrailViewer appId="demo" fetcher={fetcher as unknown as typeof fetch} />)
    expect(await screen.findByText(/Failed to load receipts/i)).toBeInTheDocument()
    expect(screen.getByTestId('audit-trail-viewer').getAttribute('data-status')).toBe('error')
  })

  it('invokes the onReceiptClick callback when a row is clicked', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appId: 'demo', receipts: [makeReceipt({ resourceId: 'only' })] }),
    })
    const onClick = vi.fn()
    render(
      <AuditTrailViewer
        appId="demo"
        fetcher={fetcher as unknown as typeof fetch}
        onReceiptClick={onClick}
      />,
    )
    const row = await screen.findByTestId('audit-receipt-row')
    row.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0][0].resourceId).toBe('only')
  })
})
