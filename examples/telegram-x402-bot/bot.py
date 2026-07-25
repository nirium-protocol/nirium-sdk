import os
import asyncio
import logging
from dotenv import load_dotenv
from nirium import Agent
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
STELLAR_SECRET_KEY = os.getenv("STELLAR_SECRET_KEY")
NIRIUM_API_URL = os.getenv("NIRIUM_API_URL", "https://nirium-agent.fly.dev")

if not TELEGRAM_BOT_TOKEN or not STELLAR_SECRET_KEY:
    raise RuntimeError("Please set TELEGRAM_BOT_TOKEN and STELLAR_SECRET_KEY in .env")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

agent = Agent(api_url=NIRIUM_API_URL)
agent.init_x402(secret_key=STELLAR_SECRET_KEY, network="stellar:testnet")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hello! Send me a message and I will answer after you pay $0.02 USDC via x402."
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_message = update.message.text
    chat_id = update.message.chat_id

    # For demonstration, we use a fixed premium URL for paid response
    premium_url = f"{NIRIUM_API_URL}/api/v1/premium/signals"

    try:
        # Attempt to fetch paid response
        response = await agent.x402_fetch(premium_url)
        if response.get("ok"):
            signals = response.get("signals", [])
            reply = f"Paid response received. Latest signals count: {len(signals)}"
        else:
            reply = "Payment required. Please pay $0.02 USDC to proceed."
    except Exception as e:
        logger.error(f"Error fetching paid response: {e}")
        reply = "Sorry, an error occurred while processing your request."

    await update.message.reply_text(reply)

def main():
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Starting Telegram bot...")
    app.run_polling()

if __name__ == "__main__":
    main()
