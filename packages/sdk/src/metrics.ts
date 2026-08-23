/**
 * x402Metrics — Prometheus observability wrapper for x402Serve.
 *
 * Wraps the Express middleware returned by x402Serve and records counters,
 * histograms, and revenue without altering payment-verification behavior.
 * The inner middleware runs unmodified — this layer only observes response
 * status and timing after the fact.
 *
 * Classification approach (matches @x402/core PaymentRequired schema):
 * - 402 without `error` field → challenge issued (fresh402 with accepts[])
 * - 402 with `error` field → verify failure (payment rejected)
 * - 2xx → verify + settle success
 * - 5xx → settle failure (facilitator error)
 *
 * The402 status code is overloaded in the x402 protocol — it's used for
 * challenges, verify failures, AND settle failures. We disambiguate by
 * inspecting the `error` field in the response body: present = failure,
 * absent = fresh challenge.
 *
 * Monkeypatching is minimal: only `res.json` is intercepted (to capture
 *402 response bodies for classification and pricing). We do NOT patch
 * `res.send` or `res.end`, avoiding conflicts with @x402/express's own
 * internal buffering of `res.writeHead/write/end/flushHeaders`.
 *
 * @example
 * ```typescript
 * import { x402Serve, x402Metrics } from 'nirium';
 *
 * const { handler, metricsHandler } = x402Metrics(
 *   x402Serve({
 *     payTo: 'G...',
 *     routes: { 'GET /signals': '$0.02' },
 *     facilitatorApiKey: 'oz_...',
 *   }),
 * );
 *
 * app.use('/premium', handler);
 * app.get('/metrics', metricsHandler); // no payment required
 * ```
 */

// Histogram bucket boundaries (seconds) — matches Prometheus convention
const DEFAULT_LATENCY_BUCKETS: readonly number[] = [0.1, 0.5, 1, 2.5, 5, 10];

export interface X402MetricsResult {
  /** Wrapped middleware — mount on paid routes in place of raw x402Serve output */
  handler: (req: any, res: any, next: any) => Promise<void>;
  /** GET /metrics endpoint handler — mount on a separate, unpaid route */
  metricsHandler: (req: any, res: any) => void;
  /** Return current metrics as a structured object */
  snapshot(): MetricsSnapshot;
  /** Zero all counters and histograms */
  reset(): void;
}

export interface MetricsSnapshot {
  challengesIssued: Record<string, number>;
  verifySuccess: Record<string, number>;
  verifyFail: Record<string, number>;
  settleSuccess: Record<string, number>;
  settleFail: Record<string, number>;
  revenue: Record<string, Record<string, number>>;
  settlementLatency: {
    buckets: Record<string, Record<string, number>>;
    sums: Record<string, number>;
    counts: Record<string, number>;
  };
}

export interface X402MetricsOptions {
  /**
   * Route → price mapping for revenue tracking. Keys should match the
   * request method+path (e.g. 'GET /signals'). Values can be a price
   * string like '$0.02' or an object with `price` and optional `asset`.
   *
   * If provided, revenue is tracked from this config (reliable).
   * If omitted, revenue is extracted from 402 challenge accepts[] (best-effort).
   */
  routes?: Record<string, string | { price: string; asset?: string }>;
  /** Custom histogram bucket boundaries (seconds). Default: [0.1, 0.5, 1, 2.5, 5, 10] */
  buckets?: readonly number[];
}

interface LatencyBucket {
  buckets: number[];
  sum: number;
  count: number;
}

interface MetricsState {
  challenges: Record<string, number>;
  vSuccess: Record<string, number>;
  vFail: Record<string, number>;
  sSuccess: Record<string, number>;
  sFail: Record<string, number>;
  revenue: Record<string, Record<string, number>>;
  latency: Record<string, LatencyBucket>;
  /** Last-known price per route, for revenue tracking without routes config */
  lastPrice: Record<string, { amount: number; asset: string }>;
  buckets: readonly number[];
  /** Pre-parsed route prices from options.routes */
  routePrices: Record<string, { amount: number; asset: string }>;
}

function parsePriceString(
  price: string,
): { amount: number; asset: string } | null {
  // '$0.02' → 0.02, '20000' → 20000
  if (typeof price === 'string') {
    const num = price.startsWith('$')
      ? parseFloat(price.slice(1))
      : parseFloat(price);
    if (!isNaN(num) && num > 0) {
      return { amount: num, asset: 'USDC' };
    }
  }
  return null;
}

function inc(counter: Record<string, number>, route: string): void {
  counter[route] = (counter[route] || 0) + 1;
}

function observeLatency(
  state: MetricsState,
  route: string,
  seconds: number,
): void {
  if (!state.latency[route]) {
    state.latency[route] = {
      buckets: state.buckets.map(() => 0),
      sum: 0,
      count: 0,
    };
  }
  const b = state.latency[route];
  b.sum += seconds;
  b.count += 1;
  for (let i = 0; i < state.buckets.length; i++) {
    if (seconds <= state.buckets[i]) b.buckets[i]++;
  }
}

function renderPrometheus(state: MetricsState): string {
  const lines: string[] = [];
  const b = state.buckets;

  const writeCounter = (
    name: string,
    help: string,
    data: Record<string, number>,
  ): void => {
    if (Object.keys(data).length === 0) return;
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [route, value] of Object.entries(data)) {
      lines.push(`${name}{route="${route}"} ${value}`);
    }
  };

  writeCounter(
    'x402_challenges_total',
    'Total 402 payment challenges issued',
    state.challenges,
  );
  writeCounter(
    'x402_verify_success_total',
    'Total successful payment verifications',
    state.vSuccess,
  );
  writeCounter(
    'x402_verify_fail_total',
    'Total failed payment verifications',
    state.vFail,
  );
  writeCounter(
    'x402_settle_success_total',
    'Total successful settlements',
    state.sSuccess,
  );
  writeCounter(
    'x402_settle_fail_total',
    'Total failed settlements',
    state.sFail,
  );

  // Revenue — only emitted when there is data
  if (Object.keys(state.revenue).length > 0) {
    lines.push(
      '# HELP x402_revenue_total Revenue collected per route and asset',
    );
    lines.push('# TYPE x402_revenue_total counter');
    for (const [route, assets] of Object.entries(state.revenue)) {
      for (const [asset, amount] of Object.entries(assets)) {
        lines.push(
          `x402_revenue_total{route="${route}",asset="${asset}"} ${amount}`,
        );
      }
    }
  }

  // Latency histogram — only emitted when there is data
  if (Object.keys(state.latency).length > 0) {
    lines.push(
      '# HELP x402_settlement_latency_seconds Request latency in seconds (approximate settlement time)',
    );
    lines.push('# TYPE x402_settlement_latency_seconds histogram');
    for (const [route, data] of Object.entries(state.latency)) {
      for (let i = 0; i < b.length; i++) {
        lines.push(
          `x402_settlement_latency_seconds_bucket{route="${route}",le="${b[i]}"} ${data.buckets[i]}`,
        );
      }
      lines.push(
        `x402_settlement_latency_seconds_bucket{route="${route}",le="+Inf"} ${data.count}`,
      );
      lines.push(
        `x402_settlement_latency_seconds_sum{route="${route}"} ${data.sum}`,
      );
      lines.push(
        `x402_settlement_latency_seconds_count{route="${route}"} ${data.count}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Create an x402Metrics wrapper around an x402Serve handler.
 *
 * The wrapper patches only `res.json` (to capture402 response bodies for
 * classification and pricing). It does NOT patch `res.send` or `res.end`,
 * avoiding conflicts with @x402/express's own internal buffering.
 *
 * Observations are made via `res.on('finish')`, which fires after the
 * response is fully sent — this is safe regardless of what the inner
 * middleware does to buffer or discard intermediate writes.
 *
 * @param inner - The Express middleware returned by x402Serve
 * @param options - Optional configuration for routes and histogram buckets
 */
export function x402Metrics(
  inner: (req: any, res: any, next: any) => Promise<void>,
  options?: X402MetricsOptions,
): X402MetricsResult {
  const state: MetricsState = {
    challenges: {},
    vSuccess: {},
    vFail: {},
    sSuccess: {},
    sFail: {},
    revenue: {},
    latency: {},
    lastPrice: {},
    buckets: options?.buckets || DEFAULT_LATENCY_BUCKETS,
    routePrices: {},
  };

  // Pre-parse route prices from options.routes if provided
  if (options?.routes) {
    for (const [key, value] of Object.entries(options.routes)) {
      const routeKey = /^[A-Z]+\s/.test(key) ? key : `GET ${key}`;
      if (typeof value === 'object' && value.price) {
        const parsed = parsePriceString(value.price);
        if (parsed) {
          state.routePrices[routeKey] = {
            amount: parsed.amount,
            asset: value.asset || parsed.asset,
          };
        }
      } else if (typeof value === 'string') {
        const parsed = parsePriceString(value);
        if (parsed) {
          state.routePrices[routeKey] = parsed;
        }
      }
    }
  }

  const wrappedHandler = async function x402MetricsHandler(
    req: any,
    res: any,
    next: any,
  ): Promise<void> {
    const route = `${req.method} ${req.path || req.url || '/'}`;
    const start = performance.now();

    // Intercept res.json to capture402 response bodies. This is the ONLY
    // monkeypatch — we do NOT touch res.send or res.end, which @x402/express
    // patches internally for response buffering.
    const originalJson: ((body: any) => any) | undefined =
      typeof res?.json === 'function' ? res.json.bind(res) : undefined;
    let capturedBody: any = null;

    if (originalJson) {
      res.json = function interceptedJson(body: any): any {
        // Capture 402 bodies for classification and pricing
        if (res.statusCode === 402 && body && !capturedBody) {
          capturedBody = body;
        }
        return originalJson(body);
      };
    }

    // Listen on 'finish' to capture the final status after the middleware
    // chain completes. The event fires after the response body is fully sent.
    // This is safe regardless of @x402/express's internal buffering.
    res.on('finish', () => {
      const elapsed = (performance.now() - start) / 1000;
      const status = res.statusCode;

      if (status === 402) {
        // Disambiguate402 responses using the @x402/core PaymentRequired schema:
        // - No `error` field → challenge issued (fresh402 with accepts[])
        // - `error` present → verify failure (payment was attempted and rejected)
        const isChallenge = !capturedBody?.error;

        if (isChallenge) {
          inc(state.challenges, route);

          // Extract pricing from accepts[] for revenue tracking.
          // V2 schema uses `amount` (string); V1 uses `maxAmountRequired`.
          if (capturedBody?.accepts?.length) {
            const accept = capturedBody.accepts[0];
            const raw = accept.amount || accept.maxAmountRequired;
            const amt =
              typeof raw === 'string' ? parseFloat(raw) : Number(raw);
            if (!isNaN(amt) && amt > 0) {
              state.lastPrice[route] = {
                amount: amt,
                asset: accept.asset || 'USDC',
              };
            }
          }
        } else {
          //402 with error = verify failure
          inc(state.vFail, route);
        }
      } else if (status >= 200 && status < 300) {
        inc(state.vSuccess, route);
        inc(state.sSuccess, route);
        observeLatency(state, route, elapsed);

        // Count revenue on successful settlement. Prefer routes config
        // (reliable), fall back to last-known price from 402 body (best-effort).
        const priceSource =
          state.routePrices[route] || state.lastPrice[route];
        if (priceSource) {
          const { asset, amount } = priceSource;
          if (!state.revenue[route]) state.revenue[route] = {};
          state.revenue[route][asset] =
            (state.revenue[route][asset] || 0) + amount;
        }
      } else if (status >= 500) {
        inc(state.sFail, route);
      }
    });

    return inner(req, res, next);
  };

  const metricsHandler = (req: any, res: any): void => {
    res.setHeader(
      'Content-Type',
      'text/plain; version=0.0.4; charset=utf-8',
    );
    res.send(renderPrometheus(state));
  };

  const snapshot = (): MetricsSnapshot => ({
    challengesIssued: { ...state.challenges },
    verifySuccess: { ...state.vSuccess },
    verifyFail: { ...state.vFail },
    settleSuccess: { ...state.sSuccess },
    settleFail: { ...state.sFail },
    revenue: JSON.parse(JSON.stringify(state.revenue)),
    settlementLatency: {
      buckets: Object.fromEntries(
        Object.entries(state.latency).map(([route, data]) => [
          route,
          Object.fromEntries(
            state.buckets.map((b, i) => [String(b), data.buckets[i]]),
          ),
        ]),
      ),
      sums: Object.fromEntries(
        Object.entries(state.latency).map(([r, d]) => [r, d.sum]),
      ),
      counts: Object.fromEntries(
        Object.entries(state.latency).map(([r, d]) => [r, d.count]),
      ),
    },
  });

  const reset = (): void => {
    for (const obj of [
      state.challenges,
      state.vSuccess,
      state.vFail,
      state.sSuccess,
      state.sFail,
    ]) {
      for (const key of Object.keys(obj)) delete obj[key];
    }
    for (const key of Object.keys(state.revenue)) delete state.revenue[key];
    for (const key of Object.keys(state.latency)) delete state.latency[key];
    for (const key of Object.keys(state.lastPrice))
      delete state.lastPrice[key];
  };

  return { handler: wrappedHandler, metricsHandler, snapshot, reset };
}
