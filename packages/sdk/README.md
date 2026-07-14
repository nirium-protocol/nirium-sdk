# nirium

Official TypeScript SDK for the **Nirium Protocol** — autonomous AI treasury infrastructure on Stellar/Soroban.

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
