# Nirium SDK

Open-source developer toolkit for **Nirium** — autonomous treasury and agentic payments on Stellar/Soroban.

This repository contains the TypeScript and Python SDKs, the CLI, examples, and quickstarts that let any developer:

- **Charge AI agents for your API** in minutes via `x402` / `MPP` (machine-to-machine payments).
- **Automate on-chain treasury** — Nirium agents rebalance USDC ↔ CETES (tokenized Mexican T-bills via Etherfuse) 24/7.
- **Anchor immutable audit trails** for every action (HMAC + IPFS).

Software-only: regulated partners execute settlement. Nirium never custodies client funds.

## Packages

| Package | Install | Description |
|---|---|---|
| TypeScript SDK | `npm install nirium` | Client for the Nirium API, x402/MPP payments, signals, webhooks. |
| Python SDK | `pip install nirium` | Async client with the same surface. |
| CLI | `@nirium/cli` *(publishing soon)* | Scaffold and interact with Nirium from the terminal. |

## Quickstart (TypeScript)

```bash
npm install nirium
```

```ts
import { NiriumAgent } from 'nirium';

const agent = new NiriumAgent({ baseUrl: 'https://nirium-agent.fly.dev' });
const market = await agent.getMarket();
console.log(market);
```

See [`docs/`](./docs) for full quickstarts, including **"Charge AI agents in 5 minutes"** (x402).

## Network

Live on Stellar Testnet (Soroban). Contracts:

- NiriumVault: `CBTWMZCG3P72EHFAQ4ZLSEBIOFYJC244H5J6DHZIJ56FHFWJ2CFAWSZU`
- NiriumProtocol: `CC2TU5BDTKTPRRRQPEF77I54XYHFQ25XGIRO2TCWKSR7NRJDFR5L5NR5`

## Contributing

We welcome contributions — examples, framework adapters, language bindings, docs, and tests. Check the [open issues](../../issues) (look for `good first issue`). This project participates in the GrantFox campaign backed by the Stellar Development Foundation.

## License

MIT — see [LICENSE](./LICENSE).
