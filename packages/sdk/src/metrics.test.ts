import { x402Metrics, X402MetricsResult, MetricsSnapshot } from './metrics';

// Real @x402/core PaymentRequired schema (V1) — used for schema validation
// This catches field-name mismatches between our mock and the actual protocol.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parsePaymentRequired } = require('@x402/core/schemas');

// ─── Real402 Response Fixtures (match @x402/core PaymentRequired schema) ─

const VALID_G_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function makeChallenge402(
  overrides?: Partial<{
    amount: string;
    asset: string;
    description: string;
  }>,
): { x402Version: 2; resource: any; accepts: any[]; error?: string } {
  return {
    x402Version: 2,
    resource: {
      url: '/signals',
      description: overrides?.description || 'Access to signals',
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

function makeVerifyFail402() {
  return {
    x402Version: 2 as const,
    error: 'payment verification failed',
    resource: {
      url: '/signals',
      description: 'Access to signals',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '20000',
        payTo: VALID_G_ADDRESS,
        maxTimeoutSeconds: 60,
        asset: 'USDC',
      },
    ],
  };
}

// ─── Test Helpers ──────────────────────────────────────────────

function createMockReqRes(method: string, path: string) {
  const listeners: Record<string, Function[]> = {};
  const res: any = {
    statusCode: 200,
    _body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      res.emit('finish');
      return res;
    },
    send(body: any) {
      res._body = body;
      res.emit('finish');
      return res;
    },
    setHeader(_name: string, _value: string) {
      return res;
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
function okNext(req: any, res: any) {
  return (err?: any) => {
    if (!err) res.status(200).json({ data: 'ok' });
  };
}

type Scenario =
  | { type: 'challenge'; amount?: string; asset?: string }
  | { type: 'paid' }
  | { type: 'verify_fail' }
  | { type: 'settle_fail' };

function createMockHandler(scenarios: Scenario[]) {
  let idx = 0;
  return async (req: any, res: any, next: any) => {
    const s = scenarios[idx++ % scenarios.length];
    switch (s.type) {
      case 'challenge':
        // Real x402 response:402 WITHOUT error, WITH accepts[]
        res.status(402).json(
          makeChallenge402({
            amount: s.amount || '20000',
            asset: s.asset || 'USDC',
          }),
        );
        break;
      case 'paid':
        next(); // downstream handler sets 200
        break;
      case 'verify_fail':
        // Real x402 response:402 WITH error field
        res.status(402).json(makeVerifyFail402());
        break;
      case 'settle_fail':
        res.status(500).json({ error: 'settlement failed' });
        break;
    }
  };
}

// ─── Schema Validation ─────────────────────────────────────────

describe('mock schema validity', () => {
  it('challenge402 fixture satisfies @x402/core PaymentRequired schema', () => {
    const fixture = makeChallenge402();
    const result = parsePaymentRequired(fixture);
    expect(result.success).toBe(true);
  });

  it('verify-fail402 fixture satisfies @x402/core PaymentRequired schema', () => {
    const fixture = makeVerifyFail402();
    const result = parsePaymentRequired(fixture);
    expect(result.success).toBe(true);
  });

  it('challenge fixture has no error field', () => {
    const fixture = makeChallenge402();
    expect(fixture.error).toBeUndefined();
  });

  it('verify-fail fixture has error field', () => {
    const fixture = makeVerifyFail402();
    expect(typeof fixture.error).toBe('string');
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

      expect(inner).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledWith(req, res, nextFn);
      expect(res.statusCode).toBe(200);
      expect(res._body).toEqual({ data: 'ok' });
    });
  });

  describe('challenge tracking', () => {
    it('increments challengesIssued on402 without error field', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge', amount: '20000' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      const snap = metrics.snapshot();
      expect(snap.challengesIssued['GET /signals']).toBe(1);
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

      expect(metrics.snapshot().challengesIssued['GET /signals']).toBe(3);
    });
  });

  describe('402 classification (matches @x402/core schema)', () => {
    it('classifies402 without error as challenge', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      const snap = metrics.snapshot();
      expect(snap.challengesIssued['GET /signals']).toBe(1);
      expect(snap.verifyFail['GET /signals']).toBeUndefined();
    });

    it('classifies402 with error as verify failure', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'verify_fail' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      const snap = metrics.snapshot();
      expect(snap.verifyFail['GET /signals']).toBe(1);
      expect(snap.challengesIssued['GET /signals']).toBeUndefined();
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

      const snap = metrics.snapshot();
      expect(snap.verifySuccess['GET /data']).toBe(2);
    });

    it('increments verifyFail on402 with error field', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'verify_fail' }]),
      );

      const { req, res } = createMockReqRes('POST', '/pay');
      await metrics.handler(req, res, okNext(req, res));

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

      expect(metrics.snapshot().settleSuccess['GET /signals']).toBe(1);
    });

    it('increments settleFail on 5xx responses', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'settle_fail' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

      expect(metrics.snapshot().settleFail['GET /signals']).toBe(1);
    });
  });

  describe('revenue tracking', () => {
    it('tracks revenue across a scripted paid sequence', async () => {
      // Sequence: challenge (20000) → paid → paid → challenge (50000) → paid
      const handler = createMockHandler([
        { type: 'challenge', amount: '20000', asset: 'USDC' },
        { type: 'paid' },
        { type: 'paid' },          { type: 'challenge', amount: '50000', asset: 'USDC' },
        { type: 'paid' },
      ]);
      metrics = x402Metrics(handler);

      // Request 1: challenge (no revenue)
      let { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));
      expect(metrics.snapshot().revenue).toEqual({});

      // Request 2: paid → revenue += 20000
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(20000);

      // Request 3: paid → revenue += 20000 (total: 40000)
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));
      expect(metrics.snapshot().revenue['GET /signals']?.USDC).toBe(40000);

      // Request 4: challenge for premium (different route, 50000)
      ({ req, res } = createMockReqRes('GET', '/premium'));
      await metrics.handler(req, res, okNext(req, res));
      expect(metrics.snapshot().revenue['GET /premium']).toBeUndefined();

      // Request 5: paid for premium → revenue += 50000
      ({ req, res } = createMockReqRes('GET', '/premium'));
      await metrics.handler(req, res, okNext(req, res));
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

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

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

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

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

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

      const rev = metrics.snapshot().revenue['GET /signals'];
      expect(rev?.USDC).toBe(20000);
      expect(rev?.CETES).toBe(5000);
    });

    it('uses routes config when provided (more reliable than402 body)', async () => {
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

      // Settle
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

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
      ({ req, res } = createMockReqRes('GET', '/signals'));
      await metrics.handler(req, res, okNext(req, res));

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
      expect(snap.revenue).toEqual({});
    });
  });

  describe('PII exclusion', () => {
    it('never includes payer addresses in metrics output', async () => {
      metrics = x402Metrics(
        createMockHandler([{ type: 'challenge', amount: '20000' }]),
      );

      const { req, res } = createMockReqRes('GET', '/signals');
      await metrics.handler(req, res, okNext(req, res));

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
