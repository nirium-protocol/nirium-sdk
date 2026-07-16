# nirium-mcp

Model Context Protocol server for [Nirium](https://nirium.xyz) — exposes market data, autonomous treasury loop control, and x402/MPP paid signals to any MCP-compatible AI: Claude, GPT, Cursor, VS Code Copilot, and others.

Software-only. This server never holds funds — paid tools sign per-request payments from a Stellar wallet you control via `STELLAR_SECRET_KEY`.

## Install

No install needed — run directly with `npx`, or add to your MCP client config.

## Claude Desktop config

```json
{
  "mcpServers": {
    "nirium": {
      "command": "npx",
      "args": ["-y", "nirium-mcp"],
      "env": {
        "AGENT_API_URL": "https://nirium-agent.fly.dev",
        "STELLAR_SECRET_KEY": "S...",
        "NIRIUM_API_KEY": "sk_free_..."
      }
    }
  }
}
```

`STELLAR_SECRET_KEY` and `NIRIUM_API_KEY` are optional — omit them and the free tools still work; paid (x402/MPP) and authenticated tools will tell you what's missing instead of failing silently.

## Tools

**Free — no key required**
- `get_market_state` — XLM/USDC price, SDEX spread, base fee, Blend rate
- `get_loop_status` — autonomous loop status, scan count, last AI decision
- `execute_demo` — dry-run a strategy via real Soroban simulation, no funds moved
- `get_wallet_info` — show the configured x402/MPP wallet and enabled tools

**Authenticated — requires `NIRIUM_API_KEY`**
- `start_loop` — start the autonomous scanning loop
- `stop_loop` — stop it

**Paid via x402 — requires a funded `STELLAR_SECRET_KEY`**
- `get_premium_signals` — $0.02 USDC — arbitrage signals with execution paths and confidence scores
- `get_premium_market` — $0.05 USDC — enriched market state
- `execute_paid_strategy` — $0.25 USDC — execute a strategy on-chain, no account required

**Paid via MPP — requires a funded `STELLAR_SECRET_KEY`**
- `get_mpp_signals` — $0.01 USDC — same signal data as `get_premium_signals`, settled via direct Soroban SAC transfer, no external facilitator
- `get_mpp_market` — $0.01 USDC — same as `get_premium_market`, MPP-settled

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_API_URL` | No (defaults to `http://127.0.0.1:3001`) | Nirium agent API base URL |
| `STELLAR_SECRET_KEY` | For paid tools | Funds x402 and MPP payments |
| `NIRIUM_API_KEY` | For `start_loop`/`stop_loop` | Agent API key from [nirium.xyz/keys](https://nirium.xyz/keys) |
| `STELLAR_NETWORK` | No (defaults to `testnet`) | `testnet` or `mainnet` |
| `SOROBAN_RPC_URL` | No | Override the default Soroban RPC endpoint |

## Run from source

```bash
git clone https://github.com/nirium-protocol/nirium-sdk
cd nirium-sdk/packages/mcp
npm install
STELLAR_SECRET_KEY=S... AGENT_API_URL=http://localhost:3001 npx tsx src/index.ts
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
