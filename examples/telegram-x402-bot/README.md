# Telegram x402 paid-question bot

A minimal Telegram bot that gates Nirium agent answers behind a 0.02 USDC
Stellar x402 payment. It never answers the protected question until the
facilitator has both verified and settled the submitted signature.

## Setup

1. Create a Telegram bot with BotFather and copy `.env.example` to your local
   environment manager.
2. Set `TELEGRAM_BOT_TOKEN` and your Stellar settlement address in
   `X402_PAY_TO`. Never commit either value.
3. Install and run:

```bash
npm install
npm run build
npm start
```

## Usage

```text
/ask What is the current Nirium market snapshot?
```

The bot responds with a machine-readable x402 challenge. After a client signs
the payment, submit:

```text
/paid <x402-signature> What is the current Nirium market snapshot?
```

Invalid or unsettled signatures receive `402 Payment Required`. Successful
settlement unlocks the answer and includes the settlement transaction when the
facilitator returns one.

## Development

```bash
npm test
npm run typecheck
```

Tests mock the facilitator; they never spend funds or contact Stellar.
