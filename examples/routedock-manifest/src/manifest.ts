import { USDC_PUBNET_ADDRESS, USDC_TESTNET_ADDRESS } from '@x402/stellar';
// See vendor/routedock/PROVENANCE.md for why this is vendored rather than
// imported from the (currently older) published @routedock/routedock.
import type { RouteDockManifest } from '../vendor/routedock/src/types.ts';

export type RouteDockNetwork = 'testnet' | 'mainnet';

export interface NiriumRouteDockConfig {
    /** Stellar network this manifest is served for. Mirrors x402Serve()'s `network`. */
    network: RouteDockNetwork;
    /** Stellar G... address that receives x402 payments — x402Serve()'s `payTo`. */
    payee: string;
    /** Per-request price in USDC, decimal string. Must match the x402Serve() route price exactly. */
    priceUsdc: string;
}

/**
 * Nirium's `x402Serve()` always resolves to OpenZeppelin Channels when no
 * `facilitatorUrl` override is given — see `X402_FACILITATORS` in
 * `packages/sdk/src/index.ts`. Reused here verbatim so the manifest never
 * drifts from what the endpoint actually settles through.
 */
export const NIRIUM_X402_FACILITATOR: Record<RouteDockNetwork, string> = {
    testnet: 'https://channels.openzeppelin.com/x402/testnet',
    mainnet: 'https://channels.openzeppelin.com/x402',
};

/**
 * Stellar Asset Contract (SAC) address for USDC. Sourced from `@x402/stellar`'s
 * own exported constants (`USDC_TESTNET_ADDRESS` / `USDC_PUBNET_ADDRESS`) — the
 * same library `x402Serve()` loads at runtime — rather than a second hardcoded
 * copy that could drift out of sync.
 */
const USDC_SAC: Record<RouteDockNetwork, string> = {
    testnet: USDC_TESTNET_ADDRESS,
    mainnet: USDC_PUBNET_ADDRESS,
};

/** The resource this manifest describes. Confirmed live at `nirium-agent.fly.dev`. */
export const SIGNALS_RESOURCE_PATH = '/api/v1/premium/signals';

/**
 * Build the *unsigned* RouteDock discovery manifest for Nirium's
 * `GET /api/v1/premium/signals` x402 endpoint.
 *
 * This only describes an endpoint that `x402Serve()` already protects — it
 * does not implement payment verification itself and changes nothing about
 * how that endpoint charges. Sign the result with `signManifest()` from
 * `@routedock/routedock` before serving it at `/.well-known/routedock.json`.
 */
export function buildSignalsManifest(config: NiriumRouteDockConfig): RouteDockManifest {
    return {
        routedock: '1.0',
        name: 'Nirium Premium Signals',
        description:
            'Real-time cross-DEX arbitrage signals for Stellar/Soroban DEXes, priced per request and settled over x402.',
        modes: ['x402'],
        network: config.network,
        asset: 'USDC',
        asset_contract: USDC_SAC[config.network],
        payee: config.payee,
        pricing: {
            x402: {
                amount: config.priceUsdc,
                per: 'request',
                facilitator: NIRIUM_X402_FACILITATOR[config.network],
            },
        },
        endpoints: {
            signals: {
                method: 'GET',
                path: SIGNALS_RESOURCE_PATH,
            },
        },
        tags: ['market-data', 'arbitrage', 'stellar', 'soroban', 'defi'],
    };
}
