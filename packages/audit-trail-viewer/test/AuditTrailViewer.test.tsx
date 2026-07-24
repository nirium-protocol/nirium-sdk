import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditTrailViewer } from '../src';
import { normalizeAuditReceipts } from '../src/normalize';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AuditTrailViewer', () => {
  it('fetches by app_id and renders IPFS and Stellar links', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      receipts: [{
        id: 'receipt-1',
        ipfs_cid: 'bafy-example-cid',
        stellar_tx_hash: 'abc123transaction',
        anchored_at: '2026-07-21T18:30:00Z',
        status: 'anchored',
      }],
    }));

    render(
      <AuditTrailViewer
        app_id="merchant/demo"
        apiBaseUrl="https://api.example.com/"
        fetcher={fetcher}
        stellarNetwork="testnet"
      />,
    );

    expect(screen.getByText('Loading audit receipts…')).toBeInTheDocument();
    expect(await screen.findByText('anchored')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/audit/info?app_id=merchant%2Fdemo',
      expect.objectContaining({ method: 'GET' }),
    );

    expect(screen.getByRole('link', { name: 'bafy-example-cid' })).toHaveAttribute(
      'href',
      'https://ipfs.io/ipfs/bafy-example-cid',
    );
    expect(screen.getByRole('link', { name: 'abc123transaction' })).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/tx/abc123transaction',
    );
  });

  it('renders an empty state for a successful response without receipts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }));
    render(<AuditTrailViewer app_id="empty-app" fetcher={fetcher} />);
    expect(await screen.findByText('No anchored receipts found.')).toBeInTheDocument();
  });

  it('renders an error state when the API request fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
    render(<AuditTrailViewer app_id="unavailable-app" fetcher={fetcher} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load audit receipts (503)');
  });

  it('calls onLoad with normalized records', async () => {
    const onLoad = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { items: [{ receiptId: 'nested-1', ipfs: { cid: 'bafy-nested' } }] },
    }));

    render(<AuditTrailViewer app_id="nested-app" fetcher={fetcher} onLoad={onLoad} />);
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0][0][0]).toMatchObject({ id: 'nested-1', cid: 'bafy-nested' });
  });

  it('does not refetch when only the onLoad callback changes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ receipts: [] }));
    const firstOnLoad = vi.fn();
    const secondOnLoad = vi.fn();
    const { rerender } = render(
      <AuditTrailViewer app_id="stable-app" fetcher={fetcher} onLoad={firstOnLoad} />,
    );

    await waitFor(() => expect(firstOnLoad).toHaveBeenCalledTimes(1));
    rerender(<AuditTrailViewer app_id="stable-app" fetcher={fetcher} onLoad={secondOnLoad} />);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses a provided Stellar Expert link when no transaction hash is present', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      receipts: [{ id: 'linked-1', stellar_expert_url: 'https://stellar.expert/explorer/public/tx/known' }],
    }));

    render(<AuditTrailViewer app_id="linked-app" fetcher={fetcher} />);
    expect(await screen.findByRole('link', { name: 'View on Stellar Expert' })).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/public/tx/known',
    );
  });
});

describe('normalizeAuditReceipts', () => {
  it('accepts common response envelopes and snake_case fields', () => {
    expect(normalizeAuditReceipts({
      data: {
        receipts: [{ receipt_id: 'r-1', transaction_hash: 'tx-1', created_at: 'now' }],
      },
    })).toMatchObject([{ id: 'r-1', transactionHash: 'tx-1', timestamp: 'now' }]);
  });
});
