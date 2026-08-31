# nirium

Autonomous treasury and agentic-payments infrastructure for **Nirium Protocol** on Stellar/Soroban.

Nirium agents rebalance USDC ↔ CETES (tokenized Mexican T-bills via Etherfuse) 24/7 without human intervention. Built for developers who want to integrate autonomous treasury management, agentic payments (x402 + MPP), and real-time market signals into their applications.

## Install

```bash
npm install nirium
```

## Quick Start

```typescript
import { Agent } from 'nirium';

const agent = new Agent({
  apiKey: 'sk_inst_your_key_here',
  baseUrl: 'https://nirium-agent.fly.dev',
});

// Health check
const alive = await agent.ping();
console.log('Agent alive:', alive);

// Real market data from Stellar Horizon
const market = await agent.getMarket();
console.log('XLM Price:', market.xlmPrice);

// Execute a treasury rebalance strategy
const result = await agent.execute('blend-yield', 'USDC', { amount: 5000 });
console.log('Result:', result.success, result.txHash);

// Real-time signals via WebSocket
agent.subscribe((signal) => {
  console.log('Signal:', signal.signal_type, signal.data.details);
});
```

## API Coverage

| Category | Methods |
|---|---|
| Health | `ping()`, `health()`, `systemHealth()` |
| Execution | `execute()`, `executeDemo()` |
| Market | `getTickers()`, `getMarket()`, `getStats()`, `getLoopStatus()`, `startLoop()`, `stopLoop()`, `triggerScan()` |
| Signals | `createSubscription()`, `getSubscriptions()`, `deleteSubscription()`, `getSubscriptionStats()`, `getRecentSignals()` |
| Skills | `getSkills()`, `installSkill()`, `uninstallSkill()`, `getSkillMarketplace()`, `executeSkillAction()` |
| Strategies | `getStrategies()` |
| Webhooks | `registerWebhook()`, `getWebhooks()`, `deleteWebhook()`, `testWebhook()` |
| Auth | `getAuthToken()`, `createAuthKey()`, `getAuthKeys()`, `revokeAuthKey()` |
| Revenue | `getRevenue()`, `getInfo()` |
| Nodes | `getNodes()` |
| Payouts | `createPayoutRun()`, `submitPayout()`, `onboardPayoutRecipient()`, `submitPayoutOnboard()`, `getPayoutRuns()`, `getPayoutTerms()`, `getPayoutInfo()` |
| Audit Trail | `anchorAuditRecord()`, `getAuditInfo()` |
| Reporting | `getReportingSummary()`, `getReportingExport()`, `getReportingExportUrl()` |
| Admin | `configureLLM()` |
| WebSocket | `subscribe()`, `onLog()`, `disconnect()` |
| x402 Payments | `initX402()`, `x402Fetch()` |
| MPP Payments | `initMpp()`, `mppFetch()` |

## Authentication

```typescript
// API Key for REST endpoints
const agent = new Agent({
  apiKey: 'sk_inst_...',
  baseUrl: 'https://nirium-agent.fly.dev',
});

// With JWT token for WebSocket (optional)
const agent = new Agent({
  apiKey: 'sk_inst_...',
  baseUrl: 'https://nirium-agent.fly.dev',
  token: 'eyJhbG...', // JWT from /api/auth/token
});
```

## Payment Protocols

### x402 — Pay-Per-Request
```typescript
agent.initX402({
  secretKey: 'S...',           // Stellar secret key
  network: 'stellar:testnet',
});

const response = await agent.x402Fetch('https://nirium-agent.fly.dev/api/v1/premium/signals');
const data = await response.json();
```

### MPP — Session-Based Budget Delegation
```typescript
agent.initMpp({
  secretKey: 'S...',
  network: 'stellar:testnet',
  mode: 'pull',
});

const response = await agent.mppFetch('https://nirium-agent.fly.dev/api/v1/mpp/signals');
const data = await response.json();
```

### Endpoint Access Model

| Access | Endpoints |
|---|---|
| **Public** (no key) | `health`, `loop/status`, `execute-demo`, `signals/recent`, `skills` list |
| **Protected** (API key) | `execute`, `market`, `loop/start\|stop\|scan`, `subscriptions`, `skills/install`, `webhooks` |
| **WebSocket** (JWT) | `/ws/signals` — real-time signal stream |
| **x402 Premium** | `/api/v1/premium/signals` ($0.02 USDC), `/api/v1/premium/market` ($0.05 USDC) |
| **MPP** | `/api/v1/mpp/signals`, `/api/v1/mpp/market` |

### x402 Metrics — Observability Wrapper

Wrap your `x402Serve` handler with `x402Metrics` to get Prometheus-format counters, histograms, and revenue tracking — no changes to your payment logic.

```typescript
import express from 'express';
import { x402Serve, x402Metrics } from 'nirium';

const app = express();

const { handler, metricsHandler } = x402Metrics(
  x402Serve({
    payTo: 'G...',
    routes: { 'GET /signals': '$0.02' },
    facilitatorApiKey: 'oz_...',
  }),
);

app.use('/premium', handler);
app.get('/metrics', metricsHandler); // no payment required

app.listen(3000);
```

Scrape the endpoint with curl:

```bash
curl -s http://localhost:3000/metrics
```

Output:

```
# HELP x402_challenges_total Total402 payment challenges issued
# TYPE x402_challenges_total counter
x402_challenges_total{route="GET /signals"} 12
# HELP x402_verify_success_total Total successful payment verifications
# TYPE x402_verify_success_total counter
x402_verify_success_total{route="GET /signals"} 8
# HELP x402_verify_fail_total Total failed payment verifications
# TYPE x402_verify_fail_total counter
x402_verify_fail_total{route="GET /signals"} 2
# HELP x402_settle_success_total Total successful settlements
# TYPE x402_settle_success_total counter
x402_settle_success_total{route="GET /signals"} 8
# HELP x402_settle_fail_total Total failed settlements
# TYPE x402_settle_fail_total counter
x402_settle_fail_total{route="GET /signals"} 1
# HELP x402_infra_errors_total Total facilitator/infrastructure errors (5xx)
# TYPE x402_infra_errors_total counter
x402_infra_errors_total{route="GET /signals"} 1
# HELP x402_rejections_total Total403 rejections from protected-request hooks
# TYPE x402_rejections_total counter
x402_rejections_total{route="GET /signals"} 1
# HELP x402_revenue_total Revenue collected per route and asset
# TYPE x402_revenue_total counter
x402_revenue_total{route="GET /signals",asset="USDC"} 160000
# HELP x402_settlement_latency_seconds Request latency in seconds (approximate settlement time)
# TYPE x402_settlement_latency_seconds histogram
x402_settlement_latency_seconds_bucket{route="GET /signals",le="0.1"} 5
x402_settlement_latency_seconds_bucket{route="GET /signals",le="0.5"} 7
x402_settlement_latency_seconds_bucket{route="GET /signals",le="1"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="2.5"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="5"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="10"} 8
x402_settlement_latency_seconds_bucket{route="GET /signals",le="+Inf"} 8
x402_settlement_latency_seconds_sum{route="GET /signals"} 3.42
x402_settlement_latency_seconds_count{route="GET /signals"} 8
```

No payer addresses or PII are included in metrics output — aggregates only.

## Payouts

Batch disbursement, non-custodial: the node builds an **unsigned** transaction, you sign it with your own wallet and broadcast it. Nirium never holds funds and never sees your keys.

```typescript
const run = await agent.createPayoutRun({
  recipients: [{ wallet: 'GABC...', amount: '250.00' }],
  acknowledgeTerms: true,       // required on every network — 403 without it
});

const signedXdr = await signWithYourWallet(run.xdr);
const settled = await agent.submitPayout(run.runId, signedXdr);
console.log(settled.txHash, settled.cid);   // on-chain hash + IPFS receipt
```

Licensed for **independent service payments only** — contractors, freelancers, B2B. Not for subordinate-employee salary. Read `getPayoutTerms()` before integrating; classifying recipients and meeting tax and labor obligations is the client's responsibility.

Mainnet is invite-only during early access and additionally requires `clientInfo`.

## Audit Trail

Anchor evidence to IPFS and get back a CID — an integrity seal, not notarization.

```typescript
const anchor = await agent.anchorAuditRecord({
  hash: 'sha-256:9f86d081...',   // hash of your own file or event
  tag: 'invoice-batch-jul',
});
console.log(anchor.cid);
```

Anchor a **hash** rather than the data itself: IPFS content cannot be deleted, so raw personal data would outlive any erasure request.

## Requirements

- Node.js >= 18
- TypeScript >= 5.0

## Links

- [Documentation](https://nirium.xyz/docs)
- [Developer Sandbox](https://nirium.xyz/sandbox)
- [API Reference](https://nirium.xyz/docs/api)
- [MCP Server Integration](https://nirium.xyz/docs/mcp)
- [GitHub](https://github.com/nirium-protocol/nirium-sdk)

## License

Apache 2.0 — Nirium Protocol
