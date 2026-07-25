# Telegram AI Bot with x402 Micropayments

This example shows a simple Telegram bot that requires users to pay $0.02 USDC via Nirium x402 before answering complex queries.

## Features

- Integrates the `nirium` Python SDK.
- Verifies payment on Stellar testnet before responding.
- Uses Telegram Bot API to interact with users.
- Includes setup instructions.

## Setup

1. Create a Telegram bot and get the bot token from [BotFather](https://t.me/BotFather).
2. Obtain a funded Stellar testnet secret key for x402 payments.
3. Clone this repo and navigate to this example:

```bash
cd examples/telegram-x402-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

4. Create a `.env` file with:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
STELLAR_SECRET_KEY=your_stellar_testnet_secret_key_here
NIRIUM_API_URL=https://nirium-agent.fly.dev
```

5. Run the bot:

```bash
python bot.py
```

## Usage

- Send any message to the bot.
- The bot will request payment if none is provided.
- After payment, the bot will answer with a canned AI response.

## Notes

- This is a minimal example for demonstration.
- Keep your secret keys secure.
- Use testnet keys only for testing.

## License

MIT License
