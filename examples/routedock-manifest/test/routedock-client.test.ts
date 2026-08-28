import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { Keypair } from '@stellar/stellar-sdk';
// See vendor/routedock/PROVENANCE.md.
import { RouteDockClient } from '../vendor/routedock/src/client/RouteDockClient.ts';

import { createApp } from '../src/server.ts';

/**
 * CI-safe network boundary for this test file.
 *
 * `RouteDockClient.pay()`'s x402 path builds a Soroban `invoke_contract`
 * transaction via `@x402/stellar`'s `ExactStellarScheme`, which simulates
 * against a live Soroban RPC endpoint before signing — there is no seam to
 * mock that without reimplementing Soroban RPC's simulation contract, and
 * Nirium's own `x402serve-smoke.test.ts` draws the same line (jest.mock'ing
 * the chain-signing modules rather than exercising them).
 *
 * So this test exercises everything up to and including on-chain signing
 * against a real local HTTP server (loopback only, no external network):
 * manifest discovery, ajv schema validation, Ed25519 signature verification,
 * and RouteDock's mode/pricing resolution (`estimateCost`) — the exact same
 * code path `pay()` runs before it ever touches the chain. `pay()` itself,
 * with a real settlement tx hash, is proven against Stellar testnet in
 * `scripts/testnet-proof.ts` (output attached to the PR), matching this
 * issue's own "mocked network for CI; real testnet run for the PR" split.
 */

async function startDemoServer() {
    const payee = Keypair.random();
    const app = createApp({
        payeeSecret: payee.secret(),
        x402Network: 'stellar:testnet',
        priceUsdc: '0.02',
        // x402Serve() requires a facilitatorApiKey synchronously at mount time
        // (before any request), even though the facilitator itself is only
        // actually contacted lazily on the first request to the protected
        // route — see packages/sdk/src/index.ts. This test never sends a
        // request to /api/v1/premium/signals (only to the manifest route and
        // via estimateCost(), neither of which touches x402Serve()'s
        // middleware), so that lazy preflight never fires and this value is
        // never validated against a real facilitator.
        facilitatorApiKey: 'test-key-unused',
    });

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    return { server, payee, baseUrl: `http://127.0.0.1:${port}` };
}

test('RouteDockClient resolves Nirium\'s manifest and selects x402 for the real resource', async () => {
    const { server, payee, baseUrl } = await startDemoServer();
    try {
        const buyer = Keypair.random();
        const client = new RouteDockClient({
            wallet: buyer,
            network: 'testnet',
            expectedPayee: payee.publicKey(),
        });

        const estimate = await client.estimateCost(`${baseUrl}/api/v1/premium/signals`);

        assert.equal(estimate.mode, 'x402');
        assert.equal(estimate.amount, '0.02');
        assert.equal(estimate.asset, 'USDC');
        assert.equal(estimate.manifest.payee, payee.publicKey());
        assert.equal(estimate.manifest.endpoints.signals?.path, '/api/v1/premium/signals');
    } finally {
        server.close();
    }
});

test('RouteDockClient refuses a manifest whose payee does not match the trust anchor', async () => {
    const { server, baseUrl } = await startDemoServer();
    try {
        const buyer = Keypair.random();
        const impostor = Keypair.random();
        const client = new RouteDockClient({
            wallet: buyer,
            network: 'testnet',
            expectedPayee: impostor.publicKey(),
        });

        await assert.rejects(() => client.estimateCost(`${baseUrl}/api/v1/premium/signals`));
    } finally {
        server.close();
    }
});

test('manifest served over HTTP round-trips through ajv + verifyManifestSignature exactly as fetchManifest enforces internally', async () => {
    const { server, payee, baseUrl } = await startDemoServer();
    try {
        const res = await fetch(`${baseUrl}/.well-known/routedock.json`);
        assert.equal(res.status, 200);
        const manifest = await res.json();
        assert.equal(manifest.payee, payee.publicKey());
        assert.equal(manifest.signature_version, '2');
        assert.ok(typeof manifest.signature === 'string' && manifest.signature.length > 0);
    } finally {
        server.close();
    }
});
