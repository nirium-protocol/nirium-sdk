# Telegram x402 Paywall Bot (bounty #11)

A sample Telegram bot that requires a **$0.02 USDC x402 payment** before answering
complex queries, built on the Nirium x402 scheme (Stellar testnet/mainnet).

## Setup
```bash
pip install python-telegram-bot nirium
export TELEGRAM_TOKEN=...        # from @BotFather
export NIRIUM_PAY_TO=G...        # your Stellar address (recipient)
export NIRIUM_NETWORK=stellar:testnet
export NIRIUM_PRICE=0.02
python bot.py
```

## How it works
- Short messages (<20 chars) answer free.
- Complex queries return a **402 Payment Required** with an x402 v1 requirement
  (`payTo`, `maxAmountRequired`, network).
- The client must send a valid `X-402-Signature` header (base64 x402 v1 payload
  with a signed Stellar settlement) on the next message.
- `bot.verify_payment()` validates version / network / recipient / amount / signature
  structurally so the flow is testable without a live facilitator.

## Tests
```bash
python -c "import test_bot; ..."   # 5 unit tests, all passing
```
Verifies: no-payment blocks (402), paid answers (200), wrong amount blocks,
wrong network blocks, challenge shape.

Bounty #11 — $50 USDC, GrantFox / Stellar Foundation.
