import { Agent } from "nirium";

import { withNiriumX402 } from "../../../lib/nirium-x402-seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agent = new Agent({
  apiKey: process.env.NIRIUM_API_KEY ?? "",
  baseUrl: process.env.NIRIUM_BASE_URL ?? "https://nirium-agent.fly.dev",
});

export const GET = withNiriumX402(
  {
    network: process.env.NIRIUM_X402_NETWORK ?? "stellar:testnet",
    priceUsdc: process.env.NIRIUM_X402_PRICE_USDC ?? "0.02",
    payTo: process.env.NIRIUM_X402_PAY_TO ?? "",
    resource: "/api/premium/signals",
    description: "Nirium premium market signals",
  },
  async () => {
    const { signals } = await agent.getRecentSignals(5);

    return Response.json({
      ok: true,
      count: signals.length,
      signals,
    });
  },
);
