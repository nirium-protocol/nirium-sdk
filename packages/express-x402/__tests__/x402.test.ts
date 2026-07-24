import { x402Serve, nirium, build402Challenge, verifyX402Payment } from '../src';
import type { Request, Response } from 'express';

const PAY_TO = 'GABC123DEF456TESTSTELLARADDRESSNO_REAL_FUNDS_9XQ2';
const OPTS = { price: '0.02', payTo: PAY_TO, network: 'stellar:testnet' as const };

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    json(b: any) { this.body = b; return this; },
    end() { return this; },
  };
  return res as any;
}

function mockReq(headers: Record<string, string> = {}) {
  return { header: (k: string) => headers[k] || headers[k.toLowerCase()] } as any;
}

const next = jest.fn() as any;

describe('x402Serve middleware', () => {
  beforeEach(() => next.mockClear());

  it('returns 402 Payment Required when no X-PAYMENT header', async () => {
    const mw = x402Serve(OPTS);
    const req = mockReq();
    const res = mockRes();
    await mw(req, res, next);
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe('Payment Required');
    expect(res.body.accepts[0].payTo).toBe(PAY_TO);
    expect(res.body.accepts[0].maxAmountRequired).toBe('0.02');
    expect(next).not.toHaveBeenCalled();
  });

  it('exposes helper via nirium.x402Serve', () => {
    expect(typeof nirium.x402Serve).toBe('function');
    const mw = nirium.x402Serve(OPTS);
    expect(typeof mw).toBe('function');
  });

  it('calls next() when a valid X-PAYMENT header is present', async () => {
    // base64 of a minimal x402 v1 payload with a fake signed transaction
    const payload = Buffer.from(JSON.stringify({
      x402Version: 1, scheme: 'exact', network: 'stellar:testnet',
      payload: { transaction: 'AAAAfakeSignedEnvelope==' },
    })).toString('base64');
    const mw = x402Serve(OPTS);
    const req = mockReq({ 'X-PAYMENT': payload });
    const res = mockRes();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('rejects malformed X-PAYMENT header with 402', async () => {
    const mw = x402Serve(OPTS);
    const req = mockReq({ 'X-PAYMENT': 'not-base64-json' });
    const res = mockRes();
    await mw(req, res, next);
    expect(res.statusCode).toBe(402);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects wrong network', async () => {
    const payload = Buffer.from(JSON.stringify({
      x402Version: 1, scheme: 'exact', network: 'stellar:mainnet',
      payload: { transaction: 'AAAA' },
    })).toString('base64');
    const mw = x402Serve(OPTS);
    const req = mockReq({ 'X-PAYMENT': payload });
    const res = mockRes();
    await mw(req, res, next);
    expect(res.statusCode).toBe(402);
  });
});

describe('verifyX402Payment', () => {
  it('fails without header', async () => {
    const r = await verifyX402Payment(undefined, OPTS);
    expect(r.ok).toBe(false);
  });
});

describe('build402Challenge', () => {
  it('produces an x402 v1 requirement', () => {
    const c = build402Challenge(OPTS);
    expect(c.x402Version).toBe(1);
    expect(c.accepts[0].scheme).toBe('exact');
    expect(c.accepts[0].asset).toBe('USDC');
  });
});
