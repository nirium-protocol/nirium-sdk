# Telegram AI Bot with x402 Micropayments

This example demonstrates a Telegram bot that requires users to pay $0.02 USDC via Nirium x402 before answering complex queries.

## Features

- Integrates the Nirium Python SDK.
- Verifies payment on Stellar testnet using x402 protocol.
- Responds to user messages only after successful payment.
- Simple AI response simulation (echo or fixed response).
- Setup guide included.

## Setup

1. Create a Telegram bot and get the bot token from BotFather.
2. Obtain a funded Stellar testnet secret key for x402 payments.
3. Clone this repository and navigate to this example:

```bash
cd examples/telegram-x402-bot
```

4. Create a `.env` file with the following content:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
STELLAR_SECRET_KEY=your_stellar_testnet_secret_key_here
NIRIUM_API_URL=https://nirium-agent.fly.dev
NIRIUM_X402_PRICE_USDC=0.02
NIRIUM_X402_NETWORK=stellar:testnet
NIRIUM_X402_PAY_TO=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Replace the placeholders with your actual credentials.

5. Install dependencies:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

6. Run the bot:

```bash
python bot.py
```

## Usage

- Start a chat with your bot on Telegram.
- Send any message.
- The bot will respond with a payment request if no valid payment is detected.
- After payment, the bot will answer your queries.

## Notes

- This example uses the Nirium Python SDK's x402 client to handle payment negotiation.
- The bot stores paid user IDs in memory for the session; for production, use persistent storage.
- The AI response is a placeholder; replace with your AI logic.

## License

MIT License
