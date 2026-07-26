import asyncio
import json
import logging
import os
from typing import Optional

from dotenv import load_dotenv
from nirium import Agent
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
NIRIUM_API_KEY = os.getenv("NIRIUM_API_KEY")
NIRIUM_BASE_URL = os.getenv("NIRIUM_BASE_URL", "https://nirium-agent.fly.dev")
X402_SECRET_KEY = os.getenv("X402_SECRET_KEY")
X402_NETWORK = os.getenv("X402_NETWORK", "stellar:testnet")
X402_PRICE_USDC = os.getenv("X402_PRICE_USDC", "0.02")
X402_PAY_TO = os.getenv("X402_PAY_TO")

if not TELEGRAM_BOT_TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN is not set in environment")
    exit(1)

if not NIRIUM_API_KEY:
    logger.error("NIRIUM_API_KEY is not set in environment")
    exit(1)

if not X402_SECRET_KEY:
    logger.error("X402_SECRET_KEY is not set in environment")
    exit(1)

if not X402_PAY_TO:
    logger.error("X402_PAY_TO is not set in environment")
    exit(1)

agent = Agent(api_key=NIRIUM_API_KEY, api_url=NIRIUM_BASE_URL)
agent.init_x402(secret_key=X402_SECRET_KEY, network=X402_NETWORK)

# Cache to track users who have paid: user_id -> bool
paid_users = set()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Welcome! Send me a message and I will answer after you pay $0.02 USDC via x402 micropayments."
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if user_id in paid_users:
        # User has paid, respond with AI answer
        await update.message.reply_text("Here is your AI answer: The quick brown fox jumps over the lazy dog.")
        return

    # User has not paid, check payment by attempting to fetch a protected resource
    try:
        # Use a dummy protected resource that requires payment
        url = f"{NIRIUM_BASE_URL}/api/v1/premium/signals"

        # Use x402_fetch to handle payment negotiation
        response = await agent.x402_fetch(url)

        if response:
            # Payment succeeded, mark user as paid
            paid_users.add(user_id)
            await update.message.reply_text("Payment received! Here is your AI answer: The quick brown fox jumps over the lazy dog.")
        else:
            await update.message.reply_text("Payment required. Please pay $0.02 USDC to proceed.")
    except Exception as e:
        logger.error(f"Error during payment verification: {e}")
        await update.message.reply_text("An error occurred while verifying payment. Please try again later.")

async def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Starting Telegram bot...")
    await app.run_polling()

if __name__ == "__main__":
    asyncio.run(main())
