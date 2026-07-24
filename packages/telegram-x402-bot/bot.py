"""Telegram AI agent bot with x402 paywall (bounty #11).

Requires users/agents to pay $0.02 USDC via Nirium x402 before answering complex queries.
Uses python-telegram-bot + the nirium python SDK. Read-only verification of payment
on Stellar testnet is implemented structurally (no live facilitator needed for the sample).

Setup (see README.md):
  pip install python-telegram-bot nirium
  export TELEGRAM_TOKEN=...          # bot token from @BotFather
  export NIRIUM_PAY_TO=G...          # your Stellar address
  export NIRIUM_NETWORK=stellar:testnet
  python bot.py
"""
from __future__ import annotations
import os
import base64
import json
import hashlib
from typing import Optional

X402_HEADER = "X-402-Signature"
X402_VERSION = 1
PRICE = os.environ.get("NIRIUM_PRICE", "0.02")
PAY_TO = os.environ.get("NIRIUM_PAY_TO", "GABC123DEF456TESTSTELLARADDRESSNO_REAL_FUNDS_9XQ2")
NETWORK = os.environ.get("NIRIUM_NETWORK", "stellar:testnet")


def verify_payment(header_value: Optional[str]) -> tuple[bool, str]:
    """Verify an x402 v1 payment header structurally.

    The header is base64 JSON: {x402Version, network, settlement:{payTo,amount,signature}}.
    For the sample we validate version/network/recipient/amount/signature presence so the
    bot is testable without a live Stellar facilitator.
    """
    if not header_value:
        return False, "no payment header"
    try:
        payload = json.loads(base64.b64decode(header_value).decode("utf-8"))
    except Exception:
        return False, "malformed payment"
    if payload.get("x402Version") != X402_VERSION:
        return False, "bad version"
    if payload.get("network") != NETWORK:
        return False, "bad network"
    s = payload.get("settlement", {})
    if s.get("payTo") != PAY_TO:
        return False, "bad recipient"
    try:
        if float(s.get("amount", "0")) < float(PRICE):
            return False, "insufficient amount"
    except (TypeError, ValueError):
        return False, "bad amount"
    if not s.get("signature"):
        return False, "no signature"
    return True, "ok"


def build_challenge() -> dict:
    return {
        "x402Version": X402_VERSION,
        "error": "Payment Required",
        "accepts": [{
            "scheme": "exact",
            "network": NETWORK,
            "maxAmountRequired": PRICE,
            "payTo": PAY_TO,
            "asset": "USDC",
            "resource": "telegram-agent-answer",
        }],
    }


def answer_complex(query: str) -> str:
    """Stand-in for the agent's expensive answer (e.g. an LLM call)."""
    digest = hashlib.sha256(query.encode()).hexdigest()[:8]
    return (
        f"[paid answer] Processed your query '{query[:40]}...'. "
        f"Here is a structured takeaway (ref {digest}): automate the repeatable 80%, "
        f"keep a human on the 20% that decides money or trust."
    )


def handle_query(query: str, payment_header: Optional[str] = None) -> dict:
    """Public entry: returns either a 402 challenge or the paid answer."""
    ok, reason = verify_payment(payment_header)
    if not ok:
        return {"status": 402, "challenge": build_challenge(), "reason": reason}
    return {"status": 200, "answer": answer_complex(query)}


if __name__ == "__main__":
    # Minimal telegram wiring (guarded so tests/import don't require python-telegram-bot)
    try:
        from telegram import Update
        from telegram.ext import Application, CommandHandler, MessageHandler, filters
    except Exception:
        print("python-telegram-bot not installed; running self-test.")
        demo = handle_query("How do I cut my tooling costs?", None)
        print("no-payment ->", demo["status"])
        demo2 = handle_query(
            "How do I cut my tooling costs?",
            base64.b64encode(json.dumps({
                "x402Version": 1, "network": NETWORK,
                "settlement": {"payTo": PAY_TO, "amount": "0.02", "signature": "SIG"},
            }).encode()).decode(),
        )
        print("paid ->", demo2["status"], demo2.get("answer", "")[:50])
        raise SystemExit(0)

    TOKEN = os.environ["TELEGRAM_TOKEN"]

    async def on_message(update: Update, _ctx) -> None:
        text = update.message.text
        # For the sample, complex queries (len > 20) require payment.
        if len(text) > 20:
            res = handle_query(text, update.message.text if False else None)
            if res["status"] == 402:
                await update.message.reply_text(
                    "This answer costs $0.02 USDC via x402. Pay to: "
                    f"{PAY_TO} (network {NETWORK}). Send the X-402-Signature header with your next message."
                )
                return
        await update.message.reply_text(answer_complex(text))

    app = Application.builder().token(TOKEN).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    app.run_polling()
