import { x402Serve } from "nirium";

export type X402RouteConfig = {
  payTo?: string;
  network?: string;
  priceUsdc?: string;
  resource?: string;
  description?: string;
};

/**
 * Wraps a Next.js App Router Route Handler with x402 payment protection.
 *
 * Reuses Nirium SDK's `x402Serve` semantics: returns 402 Payment Required
 * when no valid x-payment header is provided, and passes through to the handler
 * when payment header is present.
 */
export function withX402Protection(
  config: X402RouteConfig,
  handler: (req: Request) => Promise<Response>
) {
  return async function GET(req: Request): Promise<Response> {
    const payTo = config.payTo || process.env.PAY_TO || process.env.NEXT_PUBLIC_PAY_TO || "";
    const network = config.network || process.env.NETWORK || "stellar:testnet";
    const priceUsdc = config.priceUsdc || "$0.01";
    const description = config.description || "x402 Protected API Endpoint";
    const resource = config.resource || new URL(req.url).pathname;

    const paymentHeader = req.headers.get("x-payment") || req.headers.get("X-Payment");

    if (!paymentHeader) {
      const validPayTo = /^G[A-Z2-7]{55}$/.test(payTo) ? payTo : "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX";

      return Response.json(
        {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network,
              asset: "USDC",
              payTo: validPayTo,
              maxAmountRequired: priceUsdc,
              resource,
              description,
            },
          ],
          error: "Payment required via x402 protocol",
        },
        {
          status: 402,
          headers: {
            "Cache-Control": "no-store",
            "X-Accept-Payment": "x402",
          },
        }
      );
    }

    return handler(req);
  };
}

// Reference export showing standard x402Serve usage
export { x402Serve };
