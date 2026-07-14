# nirium

Official Python SDK for the **Nirium Protocol** — autonomous AI treasury infrastructure on Stellar/Soroban.

Nirium agents rebalance USDC ↔ CETES (tokenized Mexican T-bills via Etherfuse) 24/7 without human intervention. Built for developers who want to integrate autonomous treasury management, agentic payments (x402 + MPP), and real-time market signals into their applications.

## Install

```bash
pip install nirium
```

## Quick Start

```python
import asyncio
from nirium import Agent

agent = Agent(
    api_url="https://nirium-agent.fly.dev",
    api_key="sk_inst_your_key_here",
)

async def main():
    # Health check
    alive = await agent.ping()
    print(f"Agent alive: {alive}")

    # Real market data from Stellar Horizon
    market = await agent.get_market()
    print(f"XLM Price: ${market['xlmPrice']:.4f}")

    # Execute a treasury rebalance strategy
    result = await agent.execute("blend-yield", "USDC", {"amount": 5000})
    print(f"Success: {result['success']} | TX: {result.get('txHash')}")

asyncio.run(main())
```

## Real-Time Signals (WebSocket)

```python
agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...", token="eyJhbG...")

@agent.on("signal")
async def on_signal(data):
    print(f"Signal: {data['signal_type']} — {data['data']['details']}")

asyncio.run(agent.subscribe())
```

## Authentication

```python
# API Key for REST endpoints
agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...")

# With JWT token for WebSocket
agent = Agent(api_url="https://nirium-agent.fly.dev", api_key="sk_inst_...", token="eyJhbG...")
```

## Payment Protocols

### x402 — Pay-Per-Request
```python
agent.init_x402(
    secret_key="S...",          # Stellar secret key
    network="stellar:testnet"
)

response = await agent.x402_fetch("https://nirium-agent.fly.dev/api/v1/premium/signals")
```

### MPP — Session-Based Budget Delegation
```python
agent.init_mpp(
    secret_key="S...",
    network="stellar:testnet",
)

response = await agent.mpp_fetch("https://nirium-agent.fly.dev/api/v1/mpp/signals")
```

### Endpoint Access Model

| Access | Endpoints |
|---|---|
| **Public** (no key) | `health`, `loop/status`, `execute-demo`, `signals/recent`, `skills` list |
| **Protected** (API key) | `execute`, `market`, `loop/start\|stop\|scan`, `subscriptions`, `skills/install`, `webhooks` |
| **WebSocket** (JWT) | `/ws/signals` — real-time signal stream |
| **x402 Premium** | `/api/v1/premium/signals` ($0.02 USDC), `/api/v1/premium/market` ($0.05 USDC) |
| **MPP** | `/api/v1/mpp/signals`, `/api/v1/mpp/market` |

## API Coverage

| Category | Methods |
|---|---|
| Health | `ping()`, `health()`, `system_health()` |
| Execution | `execute()`, `execute_demo()` |
| Market | `get_tickers()`, `get_market()`, `get_stats()`, `get_loop_status()`, `start_loop()`, `stop_loop()`, `trigger_scan()` |
| Signals | `create_subscription()`, `get_subscriptions()`, `delete_subscription()`, `get_subscription_stats()`, `get_recent_signals()` |
| Skills | `get_skills()`, `install_skill()`, `uninstall_skill()`, `get_skill_marketplace()`, `execute_skill_action()` |
| Strategies | `get_strategies()` |
| Webhooks | `register_webhook()`, `get_webhooks()`, `delete_webhook()`, `test_webhook()` |
| Auth | `get_auth_token()`, `create_auth_key()`, `get_auth_keys()`, `revoke_auth_key()` |
| Revenue | `get_revenue()`, `get_info()` |
| Admin | `configure_llm()` |
| WebSocket | `subscribe()`, `on()` decorator |
| x402 Payments | `init_x402()`, `x402_fetch()` |
| MPP Payments | `init_mpp()`, `mpp_fetch()` |

## Requirements

- Python >= 3.10
- aiohttp >= 3.9.0
- websockets >= 13.0

## Links

- [Documentation](https://nirium.xyz/docs)
- [Developer Sandbox](https://nirium.xyz/sandbox)
- [API Reference](https://nirium.xyz/docs/api)
- [MCP Server Integration](https://nirium.xyz/docs/mcp)
- [GitHub](https://github.com/nirium-protocol/nirium-sdk)

## License

Apache 2.0 — Nirium Protocol
