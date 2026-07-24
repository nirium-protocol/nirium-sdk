/**
 * Nirium Express.js x402 Micropayment Middleware
 *
 * Exposes a helper `nirium.x402Serve({ price, payTo })` that returns an
 * Express middleware. The middleware inspects the `X-402-Signature`
 * header on every request, validates it against the configured nirium
 * settlement URL, and returns HTTP 402 Payment Required when the
 * signature is missing or invalid.
 *
 * Acceptance for bounty #9:
 *   1. Exposes `nirium.x402Serve({ price: "0.02", payTo: "STELLAR_ADDRESS" })`.
 *   2. Returns HTTP 402 Payment Required when no valid signature is provided.
 *   3. Includes unit tests with Jest.
 */

export interface X402ServeOptions {
  price: string;
  payTo: string;
  currency?: string;
  network?: 'stellar-mainnet' | 'stellar-testnet';
  settlementUrl?: string;
  timeoutMs?: number;
  headerName?: string;
  realm?: string;
}

export interface X402ValidationResult {
  valid: boolean;
  signature?: string;
  payer?: string;
  settlementRef?: string;
  reason?: string;
}

const DEFAULT_SETTLEMENT_URL = 'https://settlement.nirium.io/v1/verify';
const DEFAULT_HEADER = 'x-402-signature';

function pickHeaderName(name: string | undefined): string {
  return (name || DEFAULT_HEADER).toLowerCase();
}

async function validateSignature(
  signature: string,
  options: Required<X402ServeOptions>,
): Promise<X402ValidationResult> {
  if (!signature || signature.length < 16) {
    return { valid: false, reason: 'signature_missing_or_too_short' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const resp = await fetch(options.settlementUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signature,
        price: options.price,
        pay_to: options.payTo,
        currency: options.currency,
        network: options.network,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.status !== 200) {
      return { valid: false, signature, reason: `settlement_http_${resp.status}` };
    }
    const data = await resp.json() as Record<string, unknown>;
    return {
      valid: Boolean(data.valid),
      signature,
      payer: typeof data.payer === 'string' ? data.payer : undefined,
      settlementRef: typeof data.settlement_ref === 'string' ? data.settlement_ref : undefined,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : 'unknown_error';
    if (msg.includes('abort')) {
      return { valid: false, signature, reason: 'settlement_timeout' };
    }
    return { valid: false, signature, reason: 'settlement_unreachable' };
  }
}

export function x402Serve(userOptions: X402ServeOptions) {
  const options: Required<X402ServeOptions> = {
    price: userOptions.price,
    payTo: userOptions.payTo,
    currency: userOptions.currency ?? 'USDC',
    network: userOptions.network ?? 'stellar-mainnet',
    settlementUrl: userOptions.settlementUrl ?? DEFAULT_SETTLEMENT_URL,
    timeoutMs: userOptions.timeoutMs ?? 8000,
    headerName: pickHeaderName(userOptions.headerName),
    realm: userOptions.realm ?? 'nirium',
  };

  return async function x402Middleware(
    req: any,
    res: any,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const rawHeader = req?.headers?.[options.headerName];
    const signature = typeof rawHeader === 'string' ? rawHeader.trim() : '';
    if (!signature) {
      respond402(res, options, 'missing_x402_signature');
      return;
    }
    let result: X402ValidationResult;
    try {
      result = await validateSignature(signature, options);
    } catch (err: unknown) {
      // Defensive: never crash the request loop on settlement failures.
      const msg = err instanceof Error ? err.message : 'unknown_error';
      respond402(res, options, `verify_threw:${msg.slice(0, 80)}`);
      return;
    }
    if (!result.valid) {
      respond402(res, options, result.reason || 'signature_invalid');
      return;
    }
    req.x402Validation = result;
    next();
  };
}

function respond402(res: any, options: Required<X402ServeOptions>, reason: string): void {
  res.statusCode = 402;
  res.setHeader('X-402-Price', options.price);
  res.setHeader('X-402-Currency', options.currency);
  res.setHeader('X-402-Network', options.network);
  res.setHeader('X-402-PayTo', options.payTo);
  res.setHeader('X-402-Reason', reason);
  res.setHeader(
    'WWW-Authenticate',
    `X402 realm="${options.realm}", price="${options.price}", currency="${options.currency}"`,
  );
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    error: 'payment_required',
    price: options.price,
    currency: options.currency,
    network: options.network,
    pay_to: options.payTo,
    reason,
  }));
}

// Convenience: namespace export mirroring the Python decorator.
export const nirium = {
  x402Serve,
  validateSignature,
};

export default nirium;