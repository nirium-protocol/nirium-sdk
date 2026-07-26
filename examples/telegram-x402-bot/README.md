# Telegram AI Bot with x402 Micropayments

This example shows a simple Telegram bot implemented in Python that requires users to pay $0.02 USDC via Nirium x402 before answering complex queries.

## Features

- Integrates the `nirium` Python SDK.
- Verifies payment on Stellar testnet before responding.
- Uses Telegram Bot API to interact with users.
- Includes setup instructions.

## Setup

1. Create a Telegram bot and get the bot token from [BotFather](https://t.me/BotFather).
2. Fund a Stellar testnet account to be used as the x402 seller.
3. Clone this example and install dependencies:

```bash
cd examples/telegram-x402-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

4. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
NIRIUM_API_KEY=sk_inst_your_key_here
NIRIUM_BASE_URL=https://nirium-agent.fly.dev
X402_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
X402_NETWORK=stellar:testnet
X402_PRICE_USDC=0.02
X402_PAY_TO=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- `X402_SECRET_KEY` is the Stellar secret key of the payer account.
- `X402_PAY_TO` is the Stellar public key receiving payments.

## Run

```bash
python bot.py
```

## Usage

Send any message to the bot. If payment is not detected, the bot will reply with a payment request. After payment, the bot will respond with a canned AI answer.

## Notes

- This example uses polling for simplicity.
- For production, consider using webhooks and secure storage of secrets.
