# Resilient WebSocket Signals Client Example (`examples/ws-signals-resilient`)

A production-ready example demonstrating the `ResilientSignalClient` from the [`nirium`](https://www.npmjs.com/package/nirium) SDK.

It provides zero-downtime, auto-reconnecting WebSocket signal streaming with exponential backoff + jitter, token refresh hooks, and deduplication of burst signals.

## Features

- **Exponential Backoff & Jitter**: Automatically reconnects when network connections drop or servers restart.
- **Heartbeat & Dead-Connection Detection**: Sends periodic ping frames and forces reconnection if pongs stop arriving.
- **Token Refresh Hook**: Calls `onTokenRefresh` prior to reconnecting so expired JWTs can be renewed automatically.
- **Burst Deduplication**: Suppresses duplicated signal events within a configurable deduplication window.
- **Typed Connection Lifecycle Events**: `onStatus`, `onSignal`, and `onError` callbacks.

## Quickstart

```bash
cd examples/ws-signals-resilient
npm install
npm start
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NIRIUM_WS_URL` | WebSocket signal feed endpoint | `wss://nirium-agent.fly.dev/ws/signals` |
| `NIRIUM_JWT_TOKEN` | Optional authentication JWT token | `""` |
| `NIRIUM_JWT_REFRESH_URL` | Endpoint to fetch fresh JWT on reconnect | `""` |

## Usage Example

```typescript
import { ResilientSignalClient, Signal } from 'nirium';

const client = new ResilientSignalClient({
  url: 'wss://nirium-agent.fly.dev/ws/signals',
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  maxReconnectAttempts: 10,
  onTokenRefresh: async () => {
    // Return fresh JWT token
    return 'eyJhbGciOi...';
  },
});

client.onStatus((info) => {
  console.log(`[Status] ${info.status} (attempt: ${info.attempt || 0})`);
});

client.onSignal((signal: Signal) => {
  console.log(`[Signal] ${signal.signal_type} for ${signal.pair}`);
});

client.connect();
```

## Running Tests

```bash
npm test
```
