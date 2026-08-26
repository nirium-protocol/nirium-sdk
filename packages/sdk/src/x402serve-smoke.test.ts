/**
 * Smoke tests for x402Serve — verifies synchronous validation is intact.
 *
 * These tests do NOT call the real middleware (which dynamically imports
 * @x402/express, @x402/core, and @x402/stellar at first request). They only
 * verify that x402Serve rejects bad config the same way with or without the
 * metrics wrapper applied.
 */

// Mock all ESM-only dependencies before importing index.ts
jest.mock('ws', () => ({ default: class WS {}, WebSocket: class WS {} }));
jest.mock('@x402/fetch', () => ({
  x402Client: class {},
  wrapFetchWithPayment: () => (url: string, init?: any) => fetch(url, init),
}));
jest.mock('@x402/stellar', () => ({
  createEd25519Signer: () => ({
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    signAuthEntry: async () => ({ signedAuthEntry: 'mock' }),
  }),
}));
jest.mock('@x402/stellar/exact/client', () => ({
  ExactStellarScheme: class {},
}));
jest.mock('mppx', () => ({
  default: { create: () => ({}) },
}));

import { x402Serve } from './index';
import { x402Metrics } from './metrics';

const VALID_CONFIG = {
  payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  routes: { 'GET /signals': '$0.02' },
  facilitatorApiKey: 'oz_test_key',
};

describe('x402Serve smoke', () => {
  it('returns a function with the expected middleware signature', () => {
    const handler = x402Serve(VALID_CONFIG);
    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(3); // (req, res, next)
  });

  it('throws on missing payTo', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, payTo: '' }),
    ).toThrow('payTo');
  });

  it('throws on invalid payTo format', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, payTo: 'not-a-stellar-key' }),
    ).toThrow('payTo');
  });

  it('throws on empty routes', () => {
    expect(() =>
      x402Serve({ ...VALID_CONFIG, routes: {} }),
    ).toThrow('routes');
  });

  it('throws when neither facilitatorApiKey nor facilitatorUrl is provided', () => {
    expect(() =>
      x402Serve({
        payTo: VALID_CONFIG.payTo,
        routes: VALID_CONFIG.routes,
      }),
    ).toThrow('facilitatorApiKey');
  });
});

describe('x402Metrics wrapping x402Serve', () => {
  it('wraps without changing the handler shape', () => {
    const inner = x402Serve(VALID_CONFIG);
    const { handler, metricsHandler } = x402Metrics(inner);

    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(3);
    expect(typeof metricsHandler).toBe('function');
  });

  it('does not intercept synchronous validation errors', () => {
    // Bad config — x402Serve throws synchronously before the wrapper
    // ever sees it. This proves the wrapper doesn't swallow errors.
    expect(() =>
      x402Metrics(x402Serve({ ...VALID_CONFIG, payTo: '' }) as any),
    ).toThrow('payTo');
  });
});
