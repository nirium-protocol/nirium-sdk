import 'dotenv/config';

import express, { type Express } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { x402Serve } from 'nirium';
// See vendor/routedock/PROVENANCE.md.
import { signManifest } from '../vendor/routedock/src/manifest/sign.ts';

import { buildSignalsManifest, type RouteDockNetwork } from './manifest.ts';

const DEFAULT_PORT = 3403;
const DEFAULT_PRICE_USDC = '0.02';
const DEFAULT_X402_NETWORK = 'stellar:testnet';

export interface CreateAppConfig {
    /** Stellar secret key (S...) — x402Serve()'s payTo account AND the manifest signer. */
    payeeSecret: string;
    x402Network?: 'stellar:testnet' | 'stellar:pubnet';
    priceUsdc?: string;
    /** Required by x402Serve() on both networks unless facilitatorUrl is overridden. */
    facilitatorApiKey?: string;
}

/**
 * Build the Express app: x402Serve() protecting the real signals route,
 * unmodified, plus the signed RouteDock manifest served alongside it.
 * Exported (rather than only run as a script) so tests can exercise the
 * exact same wiring without a live facilitator key or network access.
 */
export function createApp(config: CreateAppConfig): Express {
    const x402Network = config.x402Network ?? DEFAULT_X402_NETWORK;
    const routeDockNetwork: RouteDockNetwork = x402Network === 'stellar:pubnet' ? 'mainnet' : 'testnet';
    const priceUsdc = config.priceUsdc ?? DEFAULT_PRICE_USDC;
    const payee = Keypair.fromSecret(config.payeeSecret).publicKey();

    const app = express();

    app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'nirium-routedock-manifest-example' });
    });

    // --- The actual charge: x402Serve(), completely unmodified. ------------
    // This is the same three-line call documented in packages/sdk/src/index.ts.
    // The manifest below only *describes* this route; it never touches
    // payment verification or settlement.
    app.use(
        '/api/v1/premium',
        x402Serve({
            payTo: payee,
            routes: { 'GET /signals': priceUsdc },
            network: x402Network,
            ...(config.facilitatorApiKey ? { facilitatorApiKey: config.facilitatorApiKey } : {}),
        }),
    );

    app.get('/api/v1/premium/signals', (_req, res) => {
        // Same response shape as the live endpoint's documented example payload.
        res.json({
            ok: true,
            count: 1,
            signals: [
                {
                    pair: 'XLM/USDC',
                    signal_type: 'path_arbitrage_opportunity',
                    confidence: 0.85,
                    executionPath: null,
                    estimatedProfit: '0.420%',
                },
            ],
        });
    });

    // --- RouteDock discovery layer -------------------------------------------
    // Signed once at startup. `signManifest` is RouteDock's own canonicalization
    // (sorted-key JSON, SHA-256, Ed25519) — nothing here reimplements it.
    const manifest = buildSignalsManifest({
        network: routeDockNetwork,
        payee,
        priceUsdc,
    });
    const signedManifest = signManifest(manifest, config.payeeSecret);

    app.get('/.well-known/routedock.json', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.json(signedManifest);
    });

    return app;
}

// Only auto-start when this file is run directly (`tsx src/server.ts`), not
// when imported by tests.
const isMain = process.argv[1] !== undefined
    && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (isMain) {
    runServer();
}

function runServer(): void {
    const port = Number(process.env.PORT ?? DEFAULT_PORT);
    const payeeSecret = process.env.NIRIUM_ROUTEDOCK_PAYEE_SECRET;
    if (!payeeSecret) {
        throw new Error(
            'NIRIUM_ROUTEDOCK_PAYEE_SECRET is required — it is both the x402Serve() payTo '
            + 'account and the key that signs the RouteDock manifest. See .env.example.',
        );
    }

    const app = createApp({
        payeeSecret,
        x402Network: (process.env.NIRIUM_X402_NETWORK as 'stellar:testnet' | 'stellar:pubnet') ?? DEFAULT_X402_NETWORK,
        priceUsdc: process.env.NIRIUM_X402_PRICE_USDC ?? DEFAULT_PRICE_USDC,
        facilitatorApiKey: process.env.FACILITATOR_API_KEY,
    });

    const payee = Keypair.fromSecret(payeeSecret).publicKey();
    app.listen(port, () => {
        console.log(`RouteDock manifest example listening on http://localhost:${port}`);
        console.log(`  Manifest:       http://localhost:${port}/.well-known/routedock.json`);
        console.log(`  Paid endpoint:  http://localhost:${port}/api/v1/premium/signals`);
        console.log(`  Payee:          ${payee}`);
    });
}
