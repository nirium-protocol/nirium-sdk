import os
import asyncio
import logging
from dotenv import load_dotenv
from telegram import Update, ForceReply
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from nirium import Agent

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
STELLAR_SECRET_KEY = os.getenv("STELLAR_SECRET_KEY")
NIRIUM_API_URL = os.getenv("NIRIUM_API_URL", "https://nirium-agent.fly.dev")
X402_PRICE_USDC = os.getenv("NIRIUM_X402_PRICE_USDC", "0.02")
X402_NETWORK = os.getenv("NIRIUM_X402_NETWORK", "stellar:testnet")
X402_PAY_TO = os.getenv("NIRIUM_X402_PAY_TO")

if not TELEGRAM_BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN is not set in environment variables")
if not STELLAR_SECRET_KEY:
    raise ValueError("STELLAR_SECRET_KEY is not set in environment variables")
if not X402_PAY_TO:
    raise ValueError("NIRIUM_X402_PAY_TO is not set in environment variables")

agent = Agent(api_url=NIRIUM_API_URL)
agent.init_x402(secret_key=STELLAR_SECRET_KEY, network=X402_NETWORK)

# In-memory store of users who have paid
paid_users = set()

async def check_payment(user_id: int) -> bool:
    """
    Check if the user has paid.
    For demo, we consider user paid if in paid_users set.
    """
    return user_id in paid_users

async def request_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Send a payment request message with x402 payment requirements.
    """
    payment_info = {
        "x402Version": 1,
        "accepts": [
            {
                "scheme": "exact",
                "network": X402_NETWORK,
                "asset": "USDC",
                "payTo": X402_PAY_TO,
                "maxAmountRequired": X402_PRICE_USDC,
                "resource": "/telegram-bot",
                "description": "Telegram AI bot access fee",
            }
        ],
        "error": "Payment required",
    }
    await update.message.reply_text(
        "⚠️ Payment required: Please pay $0.02 USDC via Stellar to access the bot.\n"
        "Send the payment proof in the chat as a JSON string with the 'X-PAYMENT' header content."
    )
    await update.message.reply_text(f"Payment requirements:\n{payment_info}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text

    if not await check_payment(user_id):
        # Check if user sent payment proof
        try:
            payment_proof = text.strip()
            if payment_proof.startswith("{") and payment_proof.endswith("}"):
                # Try to verify payment by calling x402_fetch with payment header
                url = f"{NIRIUM_API_URL}/telegram-bot"
                response = await agent.x402_fetch(url, method="GET")
                # If no exception, payment accepted
                paid_users.add(user_id)
                await update.message.reply_text("✅ Payment verified! You can now use the bot.")
                return
        except Exception as e:
            logger.warning(f"Payment verification failed: {e}")
            await update.message.reply_text("❌ Payment verification failed. Please try again.")

        # If no valid payment proof, request payment
        await request_payment(update, context)
        return

    # User has paid, respond to message (simulate AI response)
    response_text = f"🤖 Echo: {text}"
    await update.message.reply_text(response_text)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await update.message.reply_text(
        f"Hi {user.first_name}! Welcome to the Telegram AI bot with x402 micropayments.\n"
        "Send me a message to get started."
    )

def main():
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    application.run_polling()

if __name__ == "__main__":
    main()
