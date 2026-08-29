import { x402Serve } from "nirium";

export type X402SellerConfig = {
  payTo?: string;
  network?: string;
  priceUsdc?: string;
  resource?: string;
  description?: string;
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
};

export type PaidRouteHandler = (
  request: Request,
  paymentHeader?: string,
) => Promise<Response>;

/**
 * Wraps a Next.js App Router Route Handler with real x402 payment protection
 * via Nirium SDK's `x402Serve()` middleware.
 */
export function withNiriumX402(
  config: X402SellerConfig,
  handler: PaidRouteHandler,
) {
  return async function GET(req: Request): Promise<Response> {
    const payTo =
      config.payTo ||
      process.env.NIRIUM_X402_PAY_TO ||
      process.env.PAY_TO ||
      process.env.NEXT_PUBLIC_PAY_TO ||
      "";
    const network = (config.network ||
      process.env.NIRIUM_X402_NETWORK ||
      process.env.NETWORK ||
      "stellar:testnet") as "stellar:testnet" | "stellar:pubnet";
    let priceUsdc =
      config.priceUsdc || process.env.NIRIUM_X402_PRICE_USDC || "$0.02";
    if (!priceUsdc.startsWith("$")) {
      priceUsdc = `$${priceUsdc}`;
    }
    const description =
      config.description || "Nirium premium market signals";
    const resource = config.resource || new URL(req.url).pathname;

    // Fail loudly on misconfiguration: PAY_TO must be a valid Stellar G-address
    if (!payTo || !/^G[A-Z2-7]{55}$/.test(payTo)) {
      return Response.json(
        {
          error:
            "Server misconfiguration: PAY_TO must be a valid Stellar public key (G...)",
        },
        { status: 500 },
      );
    }

    const facilitatorUrl =
      config.facilitatorUrl ||
      process.env.NIRIUM_X402_FACILITATOR_URL ||
      process.env.FACILITATOR_URL ||
      process.env.X402_FACILITATOR_URL;
    const facilitatorApiKey =
      config.facilitatorApiKey ||
      process.env.NIRIUM_X402_FACILITATOR_API_KEY ||
      process.env.FACILITATOR_API_KEY;

    // Standard x402 v2 protocol header (PAYMENT-SIGNATURE / payment-signature)
    // with backwards compatibility for legacy x-payment header
    const paymentHeader =
      req.headers.get("payment-signature") ||
      req.headers.get("PAYMENT-SIGNATURE") ||
      req.headers.get("x-payment-signature") ||
      req.headers.get("x-payment") ||
      req.headers.get("X-PAYMENT");

    let serveMiddleware: any;
    try {
      serveMiddleware = x402Serve({
        payTo,
        network,
        routes: {
          [resource]: {
            price: priceUsdc,
            description,
          },
        },
        ...(facilitatorUrl ? { facilitatorUrl } : {}),
        ...(facilitatorApiKey ? { facilitatorApiKey } : {}),
      });
    } catch (err: any) {
      return Response.json(
        {
          error: `Server misconfiguration: ${err.message}`,
        },
        { status: 500 },
      );
    }

    return new Promise<Response>((resolve) => {
      let status = 200;
      const resHeaders: Record<string, string> = {};
      let responseBody: any = null;

      const mockRes: any = {
        headersSent: false,
        status(code: number) {
          status = code;
          return this;
        },
        setHeader(name: string, value: string) {
          resHeaders[name.toLowerCase()] = String(value);
          return this;
        },
        set(name: string, value: string) {
          return this.setHeader(name, value);
        },
        json(body: any) {
          responseBody = JSON.stringify(body);
          if (!resHeaders["content-type"]) {
            resHeaders["content-type"] = "application/json";
          }
          this.end();
          return this;
        },
        send(body: any) {
          responseBody = typeof body === "string" ? body : JSON.stringify(body);
          this.end();
          return this;
        },
        end() {
          this.headersSent = true;
          resolve(
            new Response(responseBody, {
              status,
              headers: resHeaders,
            }),
          );
        },
      };

      const mockReq: any = {
        method: req.method,
        url: req.url,
        path: resource,
        headers: Object.fromEntries(req.headers.entries()),
      };

      if (paymentHeader) {
        mockReq.headers["payment-signature"] = paymentHeader;
        mockReq.headers["PAYMENT-SIGNATURE"] = paymentHeader;
      }

      serveMiddleware(mockReq, mockRes, async (err?: any) => {
        if (err) {
          resolve(
            Response.json(
              { error: "Payment verification failed", detail: err.message },
              { status: 400 },
            ),
          );
          return;
        }
        try {
          const res = await handler(req, paymentHeader || undefined);
          resolve(res);
        } catch (handlerErr: any) {
          resolve(
            Response.json(
              { error: "Internal Server Error", detail: handlerErr.message },
              { status: 500 },
            ),
          );
        }
      }).catch((serveErr: any) => {
        resolve(
          Response.json(
            { error: "x402 protection error", detail: serveErr.message },
            { status: 503 },
          ),
        );
      });
    });
  };
}

export const withX402Protection = withNiriumX402;
export { x402Serve };
