/**
 * Real Stellar-testnet proof: starts the example server (real x402Serve(),
 * real signed RouteDock manifest), then pays it with a real RouteDockClient
 * against real Stellar testnet infrastructure — no mocks, no simulation.
 *
 * Required env (see .env.example):
 *   NIRIUM_ROUTEDOCK_PAYEE_SECRET  — demo payee's testnet secret (S...)
 *   FACILITATOR_API_KEY            — free key from channels.openzeppelin.com/testnet/gen
 *   BUYER_SECRET                   — a second, funded testnet secret (S...) with a USDC trustline
 *
 * Run: npm run testnet-proof
 */
import 'dotenv/config';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Keypair } from '@stellar/stellar-sdk';
// See vendor/routedock/PROVENANCE.md.
import { RouteDockClient } from '../vendor/routedock/src/client/RouteDockClient.ts';
import { verifyManifestSignature } from '../vendor/routedock/src/manifest/sign.ts';
import routedockSchema from '../vendor/routedock/src/schemas/routedock.schema.json' with { type: 'json' };

import { createApp } from '../src/server.ts';
import type { RouteDockManifest } from '../vendor/routedock/src/types.ts';

// Typed as Record<string, unknown> (mirroring RouteDock's own schema.ts)
// rather than left as the imported JSON's literal type — ajv.compile()
// otherwise infers its generic from that literal shape instead of leaving
// the validated data type as unknown.
const schema: Record<string, unknown> = routedockSchema;

async function main() {
    const payeeSecret = requireEnv('NIRIUM_ROUTEDOCK_PAYEE_SECRET');
    const facilitatorApiKey = requireEnv('FACILITATOR_API_KEY');
    const buyerSecret = requireEnv('BUYER_SECRET');

    const payee = Keypair.fromSecret(payeeSecret);
    const buyer = Keypair.fromSecret(buyerSecret);

    const app = createApp({
        payeeSecret,
        x402Network: 'stellar:testnet',
        priceUsdc: process.env.NIRIUM_X402_PRICE_USDC ?? '0.02',
        facilitatorApiKey,
    });

    const port = Number(process.env.PORT ?? 3403);
    const server = app.listen(port);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Demo server up at ${baseUrl}`);
    console.log(`  payee (manifest signer / x402Serve payTo): ${payee.publicKey()}`);
    console.log(`  buyer (paying account):                    ${buyer.publicKey()}`);

    try {
        // 1. Fetch + validate the manifest exactly as a real RouteDock consumer would.
        const manifestRes = await fetch(`${baseUrl}/.well-known/routedock.json`);
        const rawManifest: unknown = await manifestRes.json();

        const ajv = new Ajv();
        addFormats(ajv);
        const validate = ajv.compile(schema);
        if (!validate(rawManifest)) {
            throw new Error(`Manifest failed schema validation: ${ajv.errorsText(validate.errors ?? [])}`);
        }
        console.log('✓ Manifest validates against RouteDock\'s real JSON Schema');
        // Schema-valid per the check above; RouteDockManifest describes that shape.
        const manifest = rawManifest as RouteDockManifest & { signature: string };

        verifyManifestSignature(manifest, payee.publicKey());
        console.log('✓ Signature verifies against the declared payee via verifyManifestSignature()');

        // 2. Real end-to-end payment: RouteDockClient discovers the manifest,
        //    selects x402, builds + signs the Soroban payment, and settles it
        //    through the real OpenZeppelin Channels testnet facilitator.
        const client = new RouteDockClient({
            wallet: buyer,
            network: 'testnet',
            expectedPayee: payee.publicKey(),
        });

        const result = await client.pay(`${baseUrl}/api/v1/premium/signals`);
        console.log('✓ RouteDockClient.pay() settled');
        console.log(JSON.stringify(result, null, 2));

        if (result.txHash) {
            console.log(`\nTestnet transaction: https://stellar.expert/explorer/testnet/tx/${result.txHash}`);
        } else {
            console.log('\nNo txHash was returned in X-Payment-Response — check facilitator logs.');
        }
    } finally {
        server.close();
    }
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var ${name}. See .env.example.`);
    }
    return value;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
