# Next.js x402 Route Handler example

This example shows a paid App Router Route Handler for Nirium premium signals.
The route returns an x402 `402 Payment Required` challenge when the caller has
not supplied an `X-PAYMENT` header, then serves Nirium signal data after the
payment header is present.

## Setup

```bash
cd examples/nextjs-x402
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
NIRIUM_API_KEY=sk_inst_your_key_here
NIRIUM_BASE_URL=https://nirium-agent.fly.dev
NIRIUM_X402_NETWORK=stellar:testnet
NIRIUM_X402_PRICE_USDC=0.02
NIRIUM_X402_PAY_TO=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

`NIRIUM_X402_PAY_TO` should be the Stellar testnet address that receives USDC
payments.

## Run locally

```bash
npm run dev
```

Request the paid endpoint without payment:

```bash
curl -i http://localhost:3000/api/premium/signals
```

Expected result: HTTP `402` with x402 payment requirements.

After your client signs and submits the x402 payment, retry with the payment
proof:

```bash
curl -i http://localhost:3000/api/premium/signals \
  -H 'X-PAYMENT: <signed-payment-proof>'
```

Expected result: JSON containing recent Nirium signals.

## Route files

- `app/api/premium/signals/route.ts` defines the paid Route Handler.
- `app/lib/nirium-x402-seller.ts` contains the small seller-side wrapper used by
  the example.

## Stellar testnet notes

Use Stellar testnet credentials only. Fund the payer account on testnet before
calling the route with a real x402 client. For production, connect the wrapper
to your x402 facilitator or settlement verification service before trusting the
`X-PAYMENT` header.

## Validation

```bash
npm run typecheck
npm run build
```
