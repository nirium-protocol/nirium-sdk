/**
 * Jest tests for @nirium/express-x402 middleware.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { nirium, x402Serve, X402ValidationResult } from '../src';

declare module 'express-serve-static-core' {
  interface Request {
    x402Validation?: X402ValidationResult;
  }
}

function buildApp(timeoutMs = 1500) {
  const app = express();

  app.get(
    '/premium',
    nirium.x402Serve({
      price: '0.02',
      payTo: 'GXXXX_STELLAR_ADDRESS',
      timeoutMs,
      settlementUrl: 'http://127.0.0.1:1/v1/verify',
    }),
    (req: Request, res: Response) => {
      const validation = req.x402Validation;
      res.json({ ok: true, valid: validation?.valid ?? false });
    },
  );

  app.get('/free', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}

async function runRequest(
  app: express.Express,
  path: string,
  headers: Record<string, string> = {},
) {
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const resp = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await resp.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    const headerMap: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headerMap[k] = v; });
    return {
      status: resp.status,
      headers: headerMap,
      body: parsed,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('@nirium/express-x402', () => {
  it('exposes nirium.x402Serve helper', () => {
    expect(typeof nirium.x402Serve).toBe('function');
    expect(typeof x402Serve).toBe('function');
  });

  it('returns HTTP 402 when X-402-Signature is missing', async () => {
    const app = buildApp();
    const resp = await runRequest(app, '/premium');
    expect(resp.status).toBe(402);
    expect(resp.headers['x-402-price']).toBe('0.02');
    expect(resp.headers['x-402-currency']).toBe('USDC');
    expect(resp.headers['x-402-network']).toBe('stellar-mainnet');
    expect(resp.headers['x-402-payto']).toBe('GXXXX_STELLAR_ADDRESS');
    const body = resp.body as Record<string, unknown>;
    expect(body.error).toBe('payment_required');
    expect(body.price).toBe('0.02');
    expect(body.reason).toBe('missing_x402_signature');
    expect(String(resp.headers['www-authenticate'])).toMatch(/X402/);
  });

  it('returns HTTP 402 for too-short signature without settlement call', async () => {
    const app = buildApp();
    const resp = await runRequest(app, '/premium', { 'X-402-Signature': 'short' });
    expect(resp.status).toBe(402);
    const body = resp.body as Record<string, unknown>;
    expect(body.reason).toBe('signature_missing_or_too_short');
  });

  it('returns HTTP 402 when settlement is unreachable', async () => {
    const app = buildApp(500);
    const resp = await runRequest(app, '/premium', { 'X-402-Signature': 'a'.repeat(64) });
    expect(resp.status).toBe(402);
    const body = resp.body as Record<string, unknown>;
    expect(['settlement_unreachable', 'settlement_timeout']).toContain(body.reason);
  });

  it('passes through undecorated routes', async () => {
    const app = buildApp();
    const resp = await runRequest(app, '/free');
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ ok: true });
  });
});