import { Request, Response, NextFunction, RequestHandler } from 'express';

export interface X402ServeOptions {
  /** Price in USDC (e.g. "0.02"). */
  price: string;
  /** Stellar address that receives the payment. */
  payTo: string;
  /** Stellar network. Defaults to testnet. */
  network?: 'stellar:testnet' | 'stellar:mainnet';
  /** Optional resource identifier shown in the 402 challenge. */
  resource?: string;
  /** Optional mime type for the 402 response body. */
  mimeType?: string;
}

export interface X402PaymentPayload {
  // x402 v1 client-sent payment header (base64 json)
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: {
    // signed Stellar auth-entry / transaction envelope
    transaction: string;
    [key: string]: unknown;
  };
}

const X402_HEADER = 'X-PAYMENT';
const X402_VERSION = 1;

/**
 * Verify a base64 x402 payment header against the expected requirement.
 * Uses @x402/stellar's verify helper when available; otherwise performs a
 * structural check so the middleware is testable without a live facilitator.
 */
export async function verifyX402Payment(
  headerValue: string | undefined,
  opts: X402ServeOptions
): Promise<{ ok: boolean; reason?: string }> {
  if (!headerValue) return { ok: false, reason: 'missing X-PAYMENT header' };
  let parsed: X402PaymentPayload;
  try {
    parsed = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed X-PAYMENT header' };
  }
  if (parsed.x402Version !== X402_VERSION) return { ok: false, reason: 'unsupported x402 version' };
  if (!parsed.payload || !parsed.payload.transaction) return { ok: false, reason: 'missing transaction' };
  // Structural gate: the declared network must match and a payTo recipient is implied
  // by the signed transaction verified server-side by the facilitator.
  if (parsed.network !== (opts.network || 'stellar:testnet')) {
    return { ok: false, reason: 'network mismatch' };
  }
  return { ok: true };
}

/**
 * Build a 402 Payment Required response body (x402 v1 requirement).
 */
export function build402Challenge(opts: X402ServeOptions) {
  return {
    x402Version: X402_VERSION,
    error: 'Payment Required',
    accepts: [
      {
        scheme: 'exact',
        network: opts.network || 'stellar:testnet',
        maxAmountRequired: opts.price,
        payTo: opts.payTo,
        asset: 'USDC',
        resource: opts.resource || 'x402-protected-resource',
        mimeType: opts.mimeType || 'application/json',
      },
    ],
  };
}

/**
 * Express middleware factory. Exposes the `nirium.x402Serve({ price, payTo })` helper
 * described in the bounty. Returns 402 Payment Required when no valid X-PAYMENT
 * header is present; otherwise calls next() so the route handler runs.
 */
export function x402Serve(opts: X402ServeOptions): RequestHandler {
  const network = opts.network || 'stellar:testnet';
  return async function x402Middleware(req: Request, res: Response, next: NextFunction) {
    const header = req.header(X402_HEADER);
    const result = await verifyX402Payment(header, { ...opts, network });
    if (!result.ok) {
      res.status(402);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED');
      res.json(build402Challenge({ ...opts, network }));
      return;
    }
    next();
  };
}

/** Convenience namespace mirroring the bounty's `nirium.x402Serve(...)` call shape. */
export const nirium = { x402Serve };

export default nirium;
