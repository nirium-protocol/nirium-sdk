import { NextResponse } from "next/server";

export type X402SellerConfig = {
  network: string;
  priceUsdc: string;
  payTo: string;
  resource: string;
  description: string;
};

export type PaidRouteHandler = (
  request: Request,
  paymentHeader: string,
) => Promise<Response>;

export function withNiriumX402(
  config: X402SellerConfig,
  handler: PaidRouteHandler,
) {
  return async function paidRoute(request: Request): Promise<Response> {
    const paymentHeader = request.headers.get("x-payment");

    if (!paymentHeader) {
      return NextResponse.json(
        {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: config.network,
              asset: "USDC",
              payTo: config.payTo,
              maxAmountRequired: config.priceUsdc,
              resource: config.resource,
              description: config.description,
            },
          ],
          error: "Payment required",
        },
        {
          status: 402,
          headers: {
            "Cache-Control": "no-store",
            "X-Accept-Payment": "x402",
          },
        },
      );
    }

    return handler(request, paymentHeader);
  };
}
