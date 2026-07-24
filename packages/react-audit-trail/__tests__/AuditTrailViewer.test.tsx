import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditTrailViewer } from '../src/AuditTrailViewer';

// jsdom has no fetch; stub it.
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        appId: 'app_123',
        cid: 'bafy123',
        txHash: 'a1b2c3d4e5f6',
        anchoredAt: '2026-07-24T00:00:00Z',
        status: 'anchored',
      }),
  })
) as any;

describe('AuditTrailViewer', () => {
  it('renders loading then the anchored receipt', async () => {
    render(<AuditTrailViewer appId="app_123" />);
    expect(screen.getByText(/Loading audit trail/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Audit Trail')).toBeTruthy());
    expect(screen.getByText('bafy123')).toBeTruthy();
    expect(screen.getByText('app_123')).toBeTruthy();
  });

  it('shows error state on fetch failure', async () => {
    (global.fetch as any) = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    render(<AuditTrailViewer appId="bad" />);
    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeTruthy());
  });
});
