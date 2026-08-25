import { x402Metrics, X402MetricsResult, MetricsSnapshot } from './metrics';

// Real @x402/core PaymentRequired schema — used for schema validation
// This catches field-name mismatches between our fixtures and the actual protocol.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parsePaymentRequired } = require('@x402/core/schemas');

// ─── Helpers: Build schema-faithful PAYMENT-REQUIRED headers ────────────
//
// @x402/core encodes the full PaymentRequired object as base64 JSON in
// the PAYMENT-REQUIRED response header. These helpers build real objects
// that satisfy the Zod schema, then base64-encode them — exactly the way
// createPaymentRequiredResponse → encodePaymentRequiredHeader works in
// the actual dependency.

const VALID_G_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Build a V2 PaymentRequired object matching @x402/core's schema.
 * This is the object that goes into the PAYMENT-REQUIRED header.
 */
function buildPaymentRequiredV2(overrides?: {
  error?: string;
  amount?: string;
  asset?: string;
}): any {
  return {
    x402Version: 2,
    // error is always present per createPaymentRequiredResponse — it's
    // nullish in the schema but @x402/core always sets it.
    ...(overrides?.error !== undefined ? { error: overrides.error } : {}),
    resource: {
      url: '/signals',
      description: 'Access to signals',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: overrides?.amount || '20000',
        payTo: VALID_G_ADDRESS,
        maxTimeoutSeconds: 60,
        asset: overrides?.asset || 'USDC',
      },
    ],
  };
}

/** Encode a PaymentRequired object into the base64 header value */
function encodePaymentRequiredHeader(paymentRequired: any): string {
  return Buffer.from(JSON.stringify(paymentRequired), 'utf-8').toString('base64');
}

/** Build a base64 PAYMENT-REQUIRED header value for a challenge */
function challengeHeader(overrides?: { amount?: string; asset?: string }): string {
  return encodePaymentRequiredHeader(
    buildPaymentRequiredV2({
      error: 'Payment required',
      ...overrides,
    }),
  );
}

/** Build a base64 PAYMENT-REQUIRED header value for a verify failure */
function verifyFailHeader(): string {
  return encodePaymentRequiredHeader(
    buildPaymentRequiredV2({
      error: 'payment verification failed',
    }),
  );
}

// ─── Test Helpers ──────────────────────────────────────────────

function createMockReqRes(method: string, path: string) {
  const listeners: Record<string, Function[]> = {};
  const setHeaderCalls: Array<{ name: string; value: string | string[] }> = [];
  const res: any = {
    statusCode: 200,
    _body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      // Emit 'finish' asynchronously so that setHeader calls (which happen
      // before json) are captured before the classifier runs.
      Promise.resolve().then(() => res.emit('finish'));
      return res;
    },
    send(body: any) {
      res._body = body;
      Promise.resolve().then(() => res.emit('finish'));
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      setHeaderCalls.push({ name, value });
      return res;
    },
    getHeader(name: string): string | undefined {
      const lower = name.toLowerCase();
      const call = setHeaderCalls.find(
        (c) => c.name.toLowerCase() === lower,
      );
      return call ? (Array.isArray(call.value) ? call.value[0] : call.value) : undefined;
    },
    on(event: string, cb: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return res;
    },
    emit(event: string, ...args: any[]) {
      for (const cb of listeners[event] || []) cb(...args);
    },
  };
  const req: any = { method, path, url: path, headers: {} };
  return { req, res };
}

/** Create a `next` callback that acts as the downstream handler (sets 200) */
function okNext(_req: any, res: any) {
  return (err?: any) => {
    if (!err) res.status(200).json({ data: 'ok' });
  };
}

type Scenario =
  | { type: 'challenge'; amount?: string; asset?: string }
  | { type: 'paid' }
  | { type: 'verify_fail' }
  | { type: 'settle_fail' }
  | { type: 'rejected'; reason?: string };

function createMockHandler(scenarios: Scenario[]) {
  let idx = 0;
  return async (req: any, res: any, next: any) => {
    const s = scenarios[idx++ % scenarios.length];
    switch (s.type) {
      case 'challenge': {
        // Simulates @x402/core's createHTTPResponse for a fresh challenge:
        // status 402, PAYMENT-REQUIRED header with base64-encoded body,
        // JSON body = {} (empty for API clients).
        res.setHeader('PAYMENT-REQUIRED', challengeHeader({
          amount: s.amount || '20000',
          asset: s.asset || 'USDC',
        }));
        res.setHeader('Cache-Control', 'no-store');
        res.status(402).json({});
        break;
      }
      case 'paid':
        next(); // downstream handler sets 200
        break;
      case 'verify_fail': {
        // Simulates @x402/core's createHTTPResponse for a verify failure:
        // status 402, PAYMENT-REQUIRED header with error != "Payment required",
        // JSON body = {} (empty for API clients).
        res.setHeader('PAYMENT-REQUIRED', verifyFailHeader());
        res.setHeader('Cache-Control', 'no-store');
        res.status(402).json({});
        break;
      }
      case 'settle_fail': {
        // Simulates @x402/core's buildSettlementFailureResponse:
        // status 402, NO PAYMENT-REQUIRED header, PAYMENT-RESPONSE header,
        // JSON body = {} (empty by default).
        res.setHeader('PAYMENT-RESPONSE', encodePaymentRequiredHeader({ success: false }));
        res.setHeader('Cache-Control', 'no-store');
        res.status(402).json({});
        break;
      }
      case 'rejected': {
        // Simulates @x402/core's 403 from protected-request hook:
        // status 403, JSON body = { error: reason }.
        res.status(403).json({ error: s.reason || 'access denied' });
        break;
      }
    }
  };
}

// ─── Schema Validation ─────────────────────────────────────────

describe('mock schema validity', () => {
  it('challenge PAYMENT-REQUIRED header decodes to valid @x402/core PaymentRequired schema', () => {
    const header = challengeHeader();
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    const result = parsePaymentRequired(decoded);
    expect(result.success).toBe(true);
  });

  it('verify-fail PAYMENT-REQUIRED header decodes to valid schema', () => {
    const header = verifyFailHeader();
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    const result = parsePaymentRequired(decoded);
    expect(result.success).toBe(true);
  });

  it('challenge header decodes with error = "Payment required"', () => {
    const header = challengeHeader();
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    expect(decoded.error).toBe('Payment required');
  });

  it('verify-fail header decodes with error ≠ "Payment required"', () => {
    const header = verifyFailHeader();
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    expect(decoded.error).toBe('payment verification failed');
  });

  it('challenge header has accepts[] with amount', () => {
    const header = challengeHeader({ amount: '50000', asset: 'CETES' });
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    expect(decoded.accepts[0].amount).toBe('50000');
    expect(decoded.accepts[0].asset).toBe('CETES');
  });
});

// ─── Tests ─────────────────────────────────────────────────────

describe('x402Metrics', () => {
  let metrics: X402MetricsResult;

  afterEach(() => {
    metrics?.reset();
  });

  describe('basic wrapping', () => {
    it('returns handler, metricsHandler, snapshot, and reset', () => {
      metrics = x402Metrics(async (_req, _res, next) => next());
      expect(typeof metrics.handler).toBe('function');
      expect(typeof metrics.metricsHandler).toBe('function');
      expect(typeof metrics.snapshot).toBe('function');
      expect(typeof metrics.reset).toBe('function');
    });

    it('does not modify the inner middleware behavior', async () => {
      const inner = jest.fn(async (_req: any, _res: any, next: any) => {
        next();
      });
      metrics = x402Metrics(inner);

      const { req, res } = createMockReqRes('GET', '/test');
      const nextFn = okNext(req, res);
      await metrics.handler(req, res, nextFn);

      // Wait for async finish emission
      await new Promise((r) => setTimeout(r, 10));

      expect(inner).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledWith(req, res, nextFn);
      expect(res.statusCode).toBe(200);
      expect(res._body).toEqual({ data: 'ok' });
    });
  });

  describe('challenge tracking', () => {
    it('increments challengesIssued on402 with PAYMENT-REQUIRED header (error = "Payment required")', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge', amount: '20000' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.challengesIssued['GET /signals']).toBe(1);
      expect(snap.verifyFail['GET /signals']).toBeUndefined();
    });

    it('counts multiple challenges for the same route', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge' },
          { type: 'challenge' },
          { type: 'challenge' },
        ]),
      );

      for (let i = 0; i < 3; i++) {
        const { req, res } = createMockReqRes('GET', '/signals');
        await metrics.handler(req, res, okNext(req, res));
      }

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().challengesIssued['GET /signals']).toBe(3);
    });
  });

  describe('402 classification (matches @x402/core schema)', () => {
    it('classifies402 with PAYMENT-REQUIRED header (error = "Payment required") as challenge', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.challengesIssued['GET /signals']).toBe(1);
      expect(snap.verifyFail['GET /signals']).toBeUndefined();
    });

    it('classifies402 with PAYMENT-REQUIRED header (error ≠ "Payment required") as verify failure', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'verify_fail' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.verifyFail['GET /signals']).toBe(1);
      expect(snap.challengesIssued['GET /signals']).toBeUndefined();
    });

    it('classifies402 with PAYMENT-RESPONSE but no PAYMENT-REQUIRED as settlement failure', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'settle_fail' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.settleFail['GET /signals']).toBe(1);
      expect(snap.challengesIssued['GET /signals']).toBeUndefined();
      expect(snap.verifyFail['GET /signals']).toBeUndefined();
    });
  });

  describe('verify tracking', () => {
    it('increments verifySuccess on 2xx responses', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'paid' }, { type: 'paid' }]),
      );

      for (let i = 0; i < 2; i++) {
        const { req, res } = createMockReqRes('GET', '/data');
        await metrics.handler(req, res, okNext(req, res));
      }

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.verifySuccess['GET /data']).toBe(2);
    });

    it('increments verifyFail on402 with PAYMENT-REQUIRED header (verify error)', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'verify_fail' }]),
      );

      const { req, res } = createMockReqRes('POST', '/pay');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().verifyFail['POST /pay']).toBe(1);
    });
  });

  describe('settle tracking', () => {
    it('increments settleSuccess on 2xx responses', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'paid' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().settleSuccess['GET /signals']).toBe(1);
    });

    it('increments settleFail on402 settlement failures (PAYMENT-RESPONSE without PAYMENT-REQUIRED)', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'settle_fail' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().settleFail['GET /signals']).toBe(1);
    });

    it('counts5xx as infraErrors (FacilitatorResponseError from verify or settlement path)', async () => {
      // 500 from sendInternalError
      const inner500 = async (req: any, res: any, _next: any) => {
        res.status(500).json({ error: 'facilitator down' });
      };
      metrics = x402Metrics(inner500);

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().infraErrors['GET /signals']).toBe(1);
      expect(metrics.snapshot().settleFail['GET /signals']).toBeUndefined();
    });

    it('counts502 as infraErrors (FacilitatorResponseError)', async () => {
      // 502 from sendFacilitatorError — happens on both verify and settlement paths
      const inner502 = async (req: any, res: any, _next: any) => {
        res.status(502).json({ error: 'facilitator rejected the API key' });
      };
      metrics = x402Metrics(inner502);

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().infraErrors['GET /signals']).toBe(1);
      expect(metrics.snapshot().settleFail['GET /signals']).toBeUndefined();
    });
  });

  describe('403 rejection tracking', () => {
    it('counts403 rejections', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'rejected', reason: 'rate limited' }]),
      );

      const { req, res } = createMockReqRes('GET', '/premium');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.rejections['GET /premium']).toBe(1);
      expect(snap.challengesIssued['GET /premium']).toBeUndefined();
      expect(snap.verifyFail['GET /premium']).toBeUndefined();
    });

    it('counts multiple403 rejections for the same route', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'rejected' },
          { type: 'rejected' },
        ]),
      );

      for (let i = 0; i < 2; i++) {
        const { req, res } = createMockReqRes('GET', '/premium');
        await metrics.handler(req, res, okNext(req, res));
      }

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().rejections['GET /premium']).toBe(2);
    });
  });

  describe('revenue tracking', () => {
    it('tracks revenue from PAYMENT-REQUIRED header accepts[]', async () => {
      // Sequence: challenge (20000) → paid → paid → challenge (50000) → paid
      const handler = createMockHandler([
        { type: 'challenge', amount: '20000', asset: 'USDC' },
        { type: 'paid' },
        { type: 'paid' },
        { type: 'challenge', amount: '50000', asset: 'USDC' },
        { type: 'paid' },
      ]);
      metrics = x402Metrics(handler);

      // Request 1: challenge (price cached from header accepts[])
      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));
      expect(metrics.snapshot().revenue).toEqual({});

      // Request 2: paid → revenue += 20000
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(20000);

      // Request 3: paid → revenue += 20000 (total: 40000)
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(40000);

      // Request 4: challenge for premium (different route, 50000)
      ({ req, res } = createMockReqRes('GET', '/premium'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));
      expect(metrics.snapshot().revenue['GET /premium']).toBeUndefined();

      // Request 5: paid for premium → revenue += 50000
      ({ req, res } = createMockReqRes('GET', '/premium'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));
      expect(metrics.snapshot().revenue['GET /premium']?.USDC).toBe(50000);

      // Total for /signals should still be 40000
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(40000);
    });

    it('does not count revenue on failed verifications', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge', amount: '20000' },
          { type: 'verify_fail' },
        ]),
      );

      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().revenue).toEqual({});
    });

    it('does not count revenue on settlement failures', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge', amount: '20000' },
          { type: 'settle_fail' },
        ]),
      );

      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().revenue).toEqual({});
    });

    it('handles multiple assets per route', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge', amount: '20000', asset: 'USDC' },
          { type: 'paid' },
          { type: 'challenge', amount: '5000', asset: 'CETES' },
          { type: 'paid' },
        ]),
      );

      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const rev = metrics.snapshot().revenue['GET /signals'];
      expect(rev?.USDC).toBe(20000);
      expect(rev?.CETES).toBe(5000);
    });

    it('uses routes config when provided (more reliable than402 header)', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'paid' }]),
        {
          routes: {
            'GET /signals': '$0.03',
          },
        },
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      // Revenue should be 0.03 from the routes config
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(0.03);
    });
  });

  describe('latency histogram', () => {
    it('records latency on successful settlements', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'paid' }]),
        { buckets: [0.1, 0.5, 1] },
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.settlementLatency.counts['GET /signals']).toBe(1);
      expect(
        snap.settlementLatency.sums['GET /signals'],
      ).toBeGreaterThanOrEqual(0);
    });

    it('does not record latency on non-2xx responses', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge' }]),
        { buckets: [0.1, 0.5, 1] },
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(
        snap.settlementLatency.counts['GET /signals'],
      ).toBeUndefined();
    });
  });

  describe('metricsHandler', () => {
    it('returns valid Prometheus text exposition', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge', amount: '20000' },
          { type: 'paid' },
        ]),
      );

      // Issue challenge
      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      // Settle
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      // Get metrics
      let metricsBody: string = '';
      const mockMetricsRes: any = {
        setHeader: jest.fn(),
        send: jest.fn((body: string) => {
          metricsBody = body;
        }),
      };
      metrics.metricsHandler({}, mockMetricsRes);

      expect(mockMetricsRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(metricsBody).toContain('# HELP x402_challenges_total');
      expect(metricsBody).toContain(
        '# TYPE x402_challenges_total counter',
      );
      expect(metricsBody).toContain(
        'x402_challenges_total{route="GET /signals"} 1',
      );
      expect(metricsBody).toContain(
        'x402_verify_success_total{route="GET /signals"} 1',
      );
      expect(metricsBody).toContain(
        'x402_settle_success_total{route="GET /signals"} 1',
      );
      expect(metricsBody).toContain(
        'x402_revenue_total{route="GET /signals",asset="USDC"} 20000',
      );
    });

    it('returns empty output when no requests have been made', () => {
      metrics = x402Metrics(async (_req, _res, next) => next());

      let metricsBody: string = '';
      const mockMetricsRes: any = {
        setHeader: jest.fn(),
        send: jest.fn((body: string) => {
          metricsBody = body;
        }),
      };
      metrics.metricsHandler({}, mockMetricsRes);

      // Should only have a trailing newline, no metric lines
      expect(metricsBody.trim()).toBe('');
    });

    it('includes x402_rejections_total when403s have been counted', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'rejected', reason: 'rate limited' }]),
      );

      const { req, res } = createMockReqRes('GET', '/premium');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      let metricsBody = '';
      const mockMetricsRes: any = {
        setHeader: jest.fn(),
        send: jest.fn((body: string) => {
          metricsBody = body;
        }),
      };
      metrics.metricsHandler({}, mockMetricsRes);

      expect(metricsBody).toContain('# HELP x402_rejections_total');
      expect(metricsBody).toContain(
        'x402_rejections_total{route="GET /premium"} 1',
      );
    });
  });

  describe('reset', () => {
    it('zeros all counters', async () => {
      metrics = x402Metrics(
        createMockHandler([
          { type: 'challenge', amount: '20000' },
          { type: 'paid' },
        ]),
      );

      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().challengesIssued['GET /signals']).toBe(1);
      expect(
        metrics.snapshot().revenue['GET /signals']?.USDC,
      ).toBe(20000);

      metrics.reset();

      const snap = metrics.snapshot();
      expect(snap.challengesIssued).toEqual({});
      expect(snap.verifySuccess).toEqual({});
      expect(snap.verifyFail).toEqual({});
      expect(snap.settleSuccess).toEqual({});
      expect(snap.settleFail).toEqual({});
      expect(snap.infraErrors).toEqual({});
      expect(snap.rejections).toEqual({});
      expect(snap.revenue).toEqual({});
    });
  });

  describe('header casing robustness', () => {
    it('captures PAYMENT-REQUIRED header regardless of @x402/express casing', async () => {
      // @x402/express passes the exact key "PAYMENT-REQUIRED" from @x402/core.
      // Verify our case-insensitive interception works.
      const inner = async (req: any, res: any, _next: any) => {
        // Simulate exact @x402/express behavior:
        // Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value))
        res.setHeader('PAYMENT-REQUIRED', challengeHeader({ amount: '30000' }));
        res.setHeader('Cache-Control', 'no-store');
        res.status(402).json({});
      };
      metrics = x402Metrics(inner);

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      const snap = metrics.snapshot();
      expect(snap.challengesIssued['GET /signals']).toBe(1);
      expect(snap.verifyFail['GET /signals']).toBeUndefined();
    });

    it('captures lowercase payment-required header variant', async () => {
      // Some HTTP stacks may normalize header casing.
      const inner = async (req: any, res: any, _next: any) => {
        res.setHeader('payment-required', challengeHeader());
        res.status(402).json({});
      };
      metrics = x402Metrics(inner);

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      expect(metrics.snapshot().challengesIssued['GET /signals']).toBe(1);
    });
  });

  describe('PII exclusion', () => {
    it('never includes payer addresses in metrics output', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge', amount: '20000' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      await new Promise((r) => setTimeout(r, 10));

      let metricsBody = '';
      const mockMetricsRes: any = {
        setHeader: jest.fn(),
        send: jest.fn((body: string) => {
          metricsBody = body;
        }),
      };
      metrics.metricsHandler({}, mockMetricsRes);

      // Payer addresses are G... Stellar addresses
      expect(metricsBody).not.toMatch(/G[A-Z2-7]{55}/);
    });
  });
});
