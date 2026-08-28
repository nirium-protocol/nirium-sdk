import "dotenv/config";

import express, { type Express } from "express";
import { x402Serve } from "nirium";
import { pathToFileURL } from "node:url";

import { revealLoot } from "./lootTable.js";

export interface ServerConfig {
  /** Stellar public key (G...) that receives payment. Public — never a secret. */
  payTo: string;
  /** Facilitator API key. Server-side only; never sent to the client, never logged. */
  facilitatorApiKey: string;
  network?: "stellar:testnet" | "stellar:pubnet";
  facilitatorUrl?: string;
  price?: string;
}

export const PAID_ROUTE = "/api/v1/actions/reveal-loot";

/**
 * Builds the Express app. Kept as a factory (rather than a module that
 * listens on import) so tests can construct it against a mocked
 * facilitator without binding a real port or touching the network.
 */
export function createApp(config: ServerConfig): Express {
  const network = config.network ?? "stellar:testnet";
  const price = config.price ?? "$0.02";

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "unity-game-x402-gate" });
  });

  // Everything under this middleware requires a valid x402 payment. On the
  // first request without one, x402Serve responds 402 with the payment
  // requirements (price, network, payTo, asset) instead of calling next().
  app.use(
    x402Serve({
      payTo: config.payTo,
      network,
      facilitatorApiKey: config.facilitatorApiKey,
      appName: "Unity Game x402 Gate Example",
      routes: {
        [`POST ${PAID_ROUTE}`]: {
          price,
          description: "Reveal one loot item for the current run",
        },
      },
      ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
    }),
  );

  // Reached only after x402Serve has verified and settled payment for this
  // request. The seller's secret key is never involved here — settlement is
  // wallet-to-wallet through the facilitator, this route just serves data.
  app.post(PAID_ROUTE, (req, res) => {
    const payerAddress =
      typeof req.body?.payerAddress === "string" ? req.body.payerAddress : req.ip ?? "anonymous";
    const runNonce = typeof req.body?.runNonce === "string" ? req.body.runNonce : "default";

    const loot = revealLoot(`${payerAddress}:${runNonce}`);

    res.json({
      ok: true,
      route: PAID_ROUTE,
      network,
      price,
      loot,
    });
  });

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3402);
  const payTo = process.env.X402_SELLER_ADDRESS;
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY;
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  const network = (process.env.X402_NETWORK as ServerConfig["network"]) ?? "stellar:testnet";
  const price = process.env.X402_PRICE ?? "$0.02";

  if (!payTo) {
    console.error("Missing X402_SELLER_ADDRESS (Stellar G... address to receive payment).");
    process.exit(1);
  }
  if (!facilitatorApiKey) {
    console.error("Missing FACILITATOR_API_KEY. Get a free testnet key at https://channels.openzeppelin.com/testnet/gen");
    process.exit(1);
  }

  const app = createApp({
    payTo,
    facilitatorApiKey,
    network,
    price,
    ...(facilitatorUrl ? { facilitatorUrl } : {}),
  });

  app.listen(port, () => {
    console.log(`Unity game x402 gate example listening on http://localhost:${port}`);
    console.log(`Paid route: POST http://localhost:${port}${PAID_ROUTE}`);
    console.log(`Network: ${network}  Price: ${price}  Pay to: ${payTo}`);
  });
}

// Only auto-start when run directly (`npm run dev`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
