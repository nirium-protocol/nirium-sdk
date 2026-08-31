# nirium-mcp

Model Context Protocol server for [Nirium](https://nirium.xyz) — exposes market data, autonomous treasury loop control, and x402/MPP paid endpoints to any MCP-compatible AI: Claude, GPT, Cursor, VS Code Copilot, and others.

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
- `get_market_state` — XLM/USDC price, SDEX spread, base fee, Blend rate, CETES rate
- `get_loop_status` — autonomous loop status, scan count, last AI decision
- `execute_demo` — dry-run a strategy via real Soroban simulation, no funds moved
- `get_wallet_info` — show the configured x402/MPP wallet and enabled tools
- `get_nodes` — list the execution nodes with live status, custody model and network
- `anchor_audit_record` — anchor a hash (or a small JSON record) to IPFS, get back a CID
- `get_reporting_summary` — settled payouts, x402/MPP receipts and anchors for a period

**Authenticated — requires `NIRIUM_API_KEY`**
- `start_loop` — start the autonomous scanning loop
- `stop_loop` — stop it

**Paid via x402 — requires a funded `STELLAR_SECRET_KEY`**
- `get_premium_signals` — $0.02 USDC — **testnet only**; signals come from the autonomous loop, which runs on testnet. They reference testnet tokens, which have no monetary value, and are not a recommendation to buy, sell or hold anything. The mainnet box returns 501 without charging.
- `get_premium_market` — $0.05 USDC — market state with reference rates attributed to their source, fee pressure and network conditions. Factual data, no advice.
- `execute_paid_strategy` — $0.25 USDC — **testnet only**; execution needs a signing key and the mainnet box holds none by design, so it returns 501 without charging.

**Paid via MPP — requires a funded `STELLAR_SECRET_KEY`**
- `get_mpp_signals` — $0.02 USDC — same data and same testnet-only limit as `get_premium_signals`, settled via direct Soroban SAC transfer with no external facilitator
- `get_mpp_market` — $0.05 USDC — same as `get_premium_market`, MPP-settled

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_API_URL` | No (defaults to `http://127.0.0.1:3001`) | Nirium agent API base URL |
| `STELLAR_SECRET_KEY` | For paid tools | Funds x402 and MPP payments |
| `NIRIUM_API_KEY` | For `start_loop`/`stop_loop` | Agent API key from [nirium.xyz/keys](https://nirium.xyz/keys) |
| `STELLAR_NETWORK` | No (defaults to `testnet`) | `testnet` or `mainnet` |
| `SOROBAN_RPC_URL` | **Yes on mainnet** | Soroban RPC endpoint. Testnet falls back to the public one; mainnet has no open public RPC, so paid tools stay disabled until you set this. [Providers](https://developers.stellar.org/docs/data/apis/rpc/providers) |

### A note on anchoring

`anchor_audit_record` is an integrity seal — it proves a piece of data existed unchanged at a point in time. It is not notarization and carries no legal presumption of authenticity.

Anchor a **hash** of your data rather than the data itself. IPFS content cannot be deleted, so raw personal data would outlive any erasure request.

## Run from source

```bash
git clone https://github.com/nirium-protocol/nirium-sdk
cd nirium-sdk/packages/mcp
npm install
STELLAR_SECRET_KEY=S... AGENT_API_URL=http://localhost:3001 npx tsx src/index.ts
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
