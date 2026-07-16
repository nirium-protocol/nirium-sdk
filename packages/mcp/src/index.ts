#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Nirium Protocol Contributors

// ═══════════════════════════════════════════════════════════════
// Nirium MCP Server v0.4.0 — x402 + MPP tool suite
// ═══════════════════════════════════════════════════════════════
//
// Exposes Nirium Protocol capabilities to any MCP-compatible AI:
//   Claude, GPT, Codex, Cursor, VS Code Copilot, etc.
//
// Three tiers of tools:
//   FREE  — market data, loop status (standard HTTP to agent API)
//   PAID (x402) — premium signals via the OpenZeppelin Channels facilitator
//   PAID (MPP)  — same signals via direct Soroban SAC transfer,
//                 no external facilitator required
//
// Usage (stdio transport, from source):
//   STELLAR_SECRET_KEY=S... AGENT_API_URL=http://localhost:3001 npx tsx src/index.ts
//
// Claude Desktop config (published package):
//   {
//     "mcpServers": {
//       "nirium": {
//         "command": "npx",
//         "args": ["-y", "nirium-mcp"],
//         "env": {
//           "STELLAR_SECRET_KEY": "S...",
//           "AGENT_API_URL": "https://nirium-agent.fly.dev"
//         }
//       }
//     }
//   }
//
// ═══════════════════════════════════════════════════════════════

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactStellarScheme } from '@x402/stellar';
import { createEd25519Signer, STELLAR_TESTNET_CAIP2, DEFAULT_TESTNET_RPC_URL } from '@x402/stellar';
import { Mppx as MppxClient } from 'mppx/client';
import { stellar as mppStellar } from '@stellar/mpp/charge/client';

// ─── Configuration ────────────────────────────────────────────

const API_URL        = process.env.AGENT_API_URL       || 'http://127.0.0.1:3001';
const STELLAR_KEY    = process.env.STELLAR_SECRET_KEY  || '';
const NIRIUM_API_KEY = process.env.NIRIUM_API_KEY      || '';
const STELLAR_NET    = (process.env.STELLAR_NETWORK === 'mainnet'
    ? 'stellar:pubnet'
    : STELLAR_TESTNET_CAIP2) as 'stellar:testnet' | 'stellar:pubnet';
const RPC_URL        = process.env.SOROBAN_RPC_URL     || DEFAULT_TESTNET_RPC_URL;

// Derive public key from secret key if available, or use explicit env var
const STELLAR_PUBLIC_KEY = (() => {
    if (process.env.STELLAR_PUBLIC_KEY) return process.env.STELLAR_PUBLIC_KEY;
    if (STELLAR_KEY) {
        try { return createEd25519Signer(STELLAR_KEY, STELLAR_TESTNET_CAIP2).address; } catch { return ''; }
    }
    return '';
})();

// Auth headers for authenticated endpoints
const authHeaders = (): Record<string, string> =>
    NIRIUM_API_KEY ? { 'x-api-key': NIRIUM_API_KEY } : {};

// Auth + legal consent headers (required by loop/start and execute endpoints)
const consentHeaders = (): Record<string, string> => ({
    ...authHeaders(),
    ...(STELLAR_PUBLIC_KEY ? { 'x-stellar-account': STELLAR_PUBLIC_KEY } : {}),
});

// ─── x402 Payment Client ──────────────────────────────────────
//
// Set up once; reused for all x402 premium tool calls.
// Requires STELLAR_SECRET_KEY env var with funded testnet wallet.
//

let paidFetch: typeof fetch = fetch;

if (STELLAR_KEY) {
    const signer = createEd25519Signer(STELLAR_KEY, STELLAR_NET);
    const client = new x402Client()
        .register(STELLAR_NET, new ExactStellarScheme(signer, { url: RPC_URL }));
    paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
    console.error(`[Nirium MCP] x402 wallet: ${signer.address} | network: ${STELLAR_NET}`);
} else {
    console.error('[Nirium MCP] No STELLAR_SECRET_KEY — premium (paid) tools will return 402 errors');
}

// ─── MPP Payment Client ───────────────────────────────────────
//
// MPP Charge mode: per-request Soroban SAC transfer.
// No external facilitator — server verifies directly.
// Same STELLAR_SECRET_KEY funds both x402 and MPP payments.
//

let mppFetch: typeof fetch = fetch;

if (STELLAR_KEY) {
    const mppx = MppxClient.create({
        methods: [
            mppStellar.charge({
                secretKey: STELLAR_KEY,
                rpcUrl: RPC_URL,
            }),
        ],
    });
    mppFetch = mppx.fetch as typeof fetch;
    console.error(`[Nirium MCP] MPP Charge enabled | network: ${STELLAR_NET}`);
} else {
    console.error('[Nirium MCP] No STELLAR_SECRET_KEY — MPP tools will return 402 errors');
}

// ─── Server ───────────────────────────────────────────────────

const server = new McpServer(
    { name: 'nirium-mcp-server', version: '0.4.0' },
    { capabilities: { tools: {} } },
);

// ─── FREE TOOLS ───────────────────────────────────────────────

server.tool(
    'get_market_state',
    'Fetch real-time market data: XLM/USDC price (CoinGecko), SDEX spread, base fee, Blend APY. Free — no API key required.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/tickers`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'get_loop_status',
    'Check the autonomous scanning loop: running/stopped, scan count, uptime, last AI decision. Free.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/loop/status`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'start_loop',
    'Start the autonomous market scanning loop. Requires NIRIUM_API_KEY env var.',
    {
        minProfitPercentage: z.number().optional().describe('Minimum profit % to trigger (default: 0.3)'),
        maxBaseFee: z.number().optional().describe('Max Stellar base fee in stroops (default: 500)'),
    },
    async (args) => {
        const res = await fetch(`${API_URL}/api/loop/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...consentHeaders() },
            body: JSON.stringify({ config: args }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'stop_loop',
    'Stop the autonomous scanning loop. Requires NIRIUM_API_KEY env var.',
    {},
    async () => {
        const res = await fetch(`${API_URL}/api/loop/stop`, {
            method: 'POST',
            headers: authHeaders(),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

server.tool(
    'execute_demo',
    'Dry-run a strategy via Soroban simulation — no real transaction. Free.',
    {
        strategy: z.string().describe('Strategy name: flash-loan-arb, path-arbitrage, cross-dex, blend-yield, soroswap-swap'),
        asset: z.string().describe('Trading pair, e.g. XLM-USDC'),
    },
    async (args) => {
        const res = await fetch(`${API_URL}/api/execute-demo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
);

// ─── PAID TOOLS (x402) ────────────────────────────────────────
//
// Each call automatically:
//   1. Hits the endpoint → receives HTTP 402 + payment requirements
//   2. Signs a Soroban auth entry for the USDC amount
//   3. Submits X-PAYMENT header → receives 200 + data
//
// Cost: $0.02 USDC per signals call, $0.05 per market call, $0.25 per execution.
// Requires STELLAR_SECRET_KEY env var with funded testnet wallet.
//

server.tool(
    'get_premium_signals',
    'PAID ($0.02 USDC via x402) — Premium arbitrage signals with execution paths, confidence scores, profit estimates, and valid-until ledger windows. Requires funded Stellar wallet.',
    {
        count: z.number().optional().describe('Number of signals to fetch (default: 20, max: 100)'),
    },
    async (args) => {
        const count = args.count || 20;
        try {
            const res = await paidFetch(`${API_URL}/api/v1/premium/signals?count=${count}`);
            if (!res.ok) {
                return { content: [{ type: 'text', text: `Error ${res.status}: ${await res.text()}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: 'text', text: `x402 payment failed: ${err.message}` }], isError: true };
        }
    },
);

server.tool(
    'get_premium_market',
    'PAID ($0.05 USDC via x402) — Enriched market state: arbitrage windows, yield ranking, fee pressure alerts, and execution recommendation. Requires funded Stellar wallet.',
    {},
    async () => {
        try {
            const res = await paidFetch(`${API_URL}/api/v1/premium/market`);
            if (!res.ok) {
                return { content: [{ type: 'text', text: `Error ${res.status}: ${await res.text()}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: 'text', text: `x402 payment failed: ${err.message}` }], isError: true };
        }
    },
);

server.tool(
    'execute_paid_strategy',
    'PAID ($0.25 USDC via x402) — Execute a DeFi strategy on Stellar via Soroban. No Nirium account required — pay per execution. Requires funded Stellar wallet.',
    {
        strategy: z.string().describe('Strategy: flash-loan-arb | path-arbitrage | cross-dex | blend-yield | soroswap-swap'),
        asset: z.string().describe('Trading pair, e.g. XLM-USDC'),
        params: z.record(z.unknown()).optional().describe('Strategy-specific parameters'),
    },
    async (args) => {
        try {
            const res = await paidFetch(`${API_URL}/api/v1/premium/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args),
            });
            if (!res.ok) {
                return { content: [{ type: 'text', text: `Error ${res.status}: ${await res.text()}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: 'text', text: `x402 payment failed: ${err.message}` }], isError: true };
        }
    },
);

server.tool(
    'get_wallet_info',
    'Show the x402 + MPP wallet address and payment configuration for this MCP session. Free.',
    {},
    async () => {
        if (!STELLAR_KEY) {
            return { content: [{ type: 'text', text: 'No STELLAR_SECRET_KEY configured. Set it to enable paid tools.' }] };
        }
        const signer = createEd25519Signer(STELLAR_KEY, STELLAR_NET);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    address: signer.address,
                    network: STELLAR_NET,
                    rpcUrl: RPC_URL,
                    agentApiUrl: API_URL,
                    niriumApiKeySet: !!NIRIUM_API_KEY,
                    x402Enabled: true,
                    mppEnabled: true,
                    freeTools: ['get_market_state', 'get_loop_status', 'execute_demo'],
                    authenticatedTools: ['start_loop', 'stop_loop'],
                    paidToolsX402: ['get_premium_signals', 'get_premium_market', 'execute_paid_strategy'],
                    paidToolsMpp: ['get_mpp_signals', 'get_mpp_market'],
                }, null, 2),
            }],
        };
    },
);

// ─── PAID TOOLS (MPP) ─────────────────────────────────────────
//
// MPP Charge mode: no external facilitator.
// The client signs a Soroban SAC transfer and sends it inline.
// Server verifies the on-chain transfer and returns 200.
//
// Advantage over x402: no Coinbase facilitator dependency.
// Both x402 and MPP tools are available — client chooses.
//

server.tool(
    'get_mpp_signals',
    'PAID ($0.01 USDC via MPP Charge) — Premium arbitrage signals settled via direct Soroban SAC transfer. No external facilitator. Same signal data as get_premium_signals. Requires funded Stellar wallet.',
    {
        count: z.number().optional().describe('Number of signals to fetch (default: 20, max: 100)'),
    },
    async (args) => {
        const count = args.count || 20;
        try {
            const res = await mppFetch(`${API_URL}/api/v1/mpp/signals?count=${count}`);
            if (!res.ok) {
                return { content: [{ type: 'text', text: `Error ${res.status}: ${await res.text()}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: 'text', text: `MPP payment failed: ${err.message}` }], isError: true };
        }
    },
);

server.tool(
    'get_mpp_market',
    'PAID ($0.01 USDC via MPP Charge) — Enriched market state settled via direct Soroban SAC transfer. No external facilitator. Includes arbitrage windows, yield ranking, and fee alerts. Requires funded Stellar wallet.',
    {},
    async () => {
        try {
            const res = await mppFetch(`${API_URL}/api/v1/mpp/market`);
            if (!res.ok) {
                return { content: [{ type: 'text', text: `Error ${res.status}: ${await res.text()}` }], isError: true };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
            return { content: [{ type: 'text', text: `MPP payment failed: ${err.message}` }], isError: true };
        }
    },
);

// ─── Start ────────────────────────────────────────────────────

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Nirium MCP] v0.4.0 running on stdio');
    console.error(`[Nirium MCP] Agent API: ${API_URL}`);
    console.error(`[Nirium MCP] NIRIUM_API_KEY set: ${!!NIRIUM_API_KEY}`);
    console.error(`[Nirium MCP] x402 enabled: ${!!STELLAR_KEY}`);
    console.error(`[Nirium MCP] MPP Charge enabled: ${!!STELLAR_KEY}`);
}

main().catch((err) => {
    console.error('[Nirium MCP] Fatal error:', err);
    process.exit(1);
});
