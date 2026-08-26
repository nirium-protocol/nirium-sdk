/**
 * Target endpoint (live, testnet):
 *   GET https://nirium-agent.fly.dev/api/v1/premium/signals — $0.02 USDC per request
 *
 * Ground truth captured from the endpoint's own 402 challenge (2026-08-26):
 *   payTo  : GC4Q5TWWXI7IHN6DYCBEKCOWJWCKY4JE2NLKLU5SE3YL44IUUFPKUOPC
 *   asset  : CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA (testnet USDC, SAC)
 *   amount : 200000 (7-decimals USDC → 0.02)
 *   scheme : exact, stellar:testnet, fees sponsored by the facilitator
 *
 * The facilitator is the same OpenZeppelin Channels endpoint x402Serve() uses
 * (packages/sdk/src/index.ts, X402_FACILITATORS['stellar:testnet']).
 *
 * IMPORTANT — signature vs. payee:
 * The manifest signature must be made with the payee's Stellar keypair. The
 * production payee above is Nirium's account; only Nirium can produce the
 * production signature. This example therefore generates a DEDICATED testnet
 * keypair whose address is declared as the manifest payee, signs with it, and
 * documents the exact swap for production (see README). The verification
 * machinery (schema + canonicalization + Ed25519) is identical either way.
 */
import type { RouteDockManifest } from '@routedock/routedock'

export const NIRIUM_X402_ENDPOINT =
  'https://nirium-agent.fly.dev/api/v1/premium/signals'

export const PRODUCTION_PAYEE =
  'GC4Q5TWWXI7IHN6DYCBEKCOWJWCKY4JE2NLKLU5SE3YL44IUUFPKUOPC'

export const NIRIUM_MANIFEST: RouteDockManifest = {
  routedock: '1.0',
  name: 'Nirium Premium Signals',
  description:
    'Per-request premium trading signals from the Nirium autonomous treasury agent (USDC rebalancing, CETES via Etherfuse), served live on Stellar testnet.',
  modes: ['x402'],
  network: 'testnet',
  asset: 'USDC',
  asset_contract:
    'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  payee: PRODUCTION_PAYEE, // swapped to the test keypair at runtime in this example
  pricing: {
    x402: {
      amount: '0.02',
      per: 'request',
      facilitator: 'https://channels.openzeppelin.com/x402/testnet',
    },
  },
  endpoints: {
    signals: {
      method: 'GET',
      path: '/api/v1/premium/signals',
      headers: { 'X-Preferred-Mode': 'x402' },
      response_schema: { type: 'object' },
      rate_limit: { requests: 120, window_seconds: 60 },
    },
  },
  tags: ['stellar', 'x402', 'signals', 'treasury', 'nirium'],
}

/** Build the example manifest bound to a given (test) payee. */
export function manifestForPayee(payee: string): RouteDockManifest {
  return { ...NIRIUM_MANIFEST, payee }
}
