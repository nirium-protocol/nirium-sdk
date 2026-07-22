import { Bot } from "grammy";
import { Agent } from "nirium";
import { PaymentGate } from "./payment.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const bot = new Bot(required("TELEGRAM_BOT_TOKEN"));
const agent = new Agent({
  apiKey: process.env.NIRIUM_API_KEY ?? "",
  baseUrl: process.env.NIRIUM_API_URL ?? "https://nirium-agent.fly.dev",
});
const gate = new PaymentGate({
  facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://facilitator.x402.org",
  payTo: required("X402_PAY_TO"),
  price: process.env.X402_PRICE ?? "0.02",
  network: process.env.X402_NETWORK === "stellar:pubnet" ? "stellar:pubnet" : "stellar:testnet",
});

bot.command("start", (ctx) => ctx.reply("Use /ask <question>. Paid questions cost 0.02 USDC via Stellar x402."));

bot.command("ask", (ctx) => {
  const question = ctx.match.trim();
  if (!question) return ctx.reply("Usage: /ask <question>");
  return ctx.reply([
    "402 Payment Required",
    JSON.stringify(gate.challenge()),
    `After signing, send: /paid <signature> ${question}`,
  ].join("\n"));
});

bot.command("paid", async (ctx) => {
  const [signature, ...questionParts] = ctx.match.trim().split(/\s+/);
  const question = questionParts.join(" ");
  if (!signature || !question) return ctx.reply("Usage: /paid <signature> <question>");

  const payment = await gate.verifyAndSettle(signature);
  if (!payment.settled) return ctx.reply("402 Payment Required: signature invalid or settlement failed.");

  const market = await agent.getMarket();
  return ctx.reply([
    `Question: ${question}`,
    `Nirium market snapshot: ${JSON.stringify(market)}`,
    payment.transaction ? `Settlement: ${payment.transaction}` : "Settlement confirmed",
  ].join("\n"));
});

bot.catch(({ error }) => console.error("Telegram bot error", error));
bot.start();
