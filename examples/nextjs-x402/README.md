# Next.js x402 Route Handler example

This example shows a paid App Router Route Handler for Nirium premium signals.
The route returns an x402 `402 Payment Required` challenge when the caller has
not supplied a valid `PAYMENT-SIGNATURE` header, and verifies/settles the payment
via Nirium SDK's `x402Serve()` middleware before serving Nirium signal data.

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
NIRIUM_X402_PAY_TO=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX
NIRIUM_X402_FACILITATOR_API_KEY=oz_test_key
```

- `NIRIUM_X402_PAY_TO` should be the Stellar address (public key starting with `G...`) that receives USDC payments.
- `NIRIUM_X402_FACILITATOR_API_KEY` (or `FACILITATOR_API_KEY`) / `NIRIUM_X402_FACILITATOR_URL`: OpenZeppelin Channels facilitator key or custom facilitator URL to verify and settle payment proofs.

## Run locally

```bash
npm run dev
```

Request the paid endpoint without payment:

```bash
curl -i http://localhost:3000/api/premium/signals
```

Expected result: HTTP `402 Payment Required` with x402 payment requirements.

After your client signs and submits the x402 payment, retry with the payment signature:

```bash
curl -i http://localhost:3000/api/premium/signals \
  -H 'PAYMENT-SIGNATURE: <signed-payment-proof>'
```

Expected result: JSON containing recent Nirium signals.

## Route files

- `app/api/premium/signals/route.ts` defines the paid Route Handler.
- `app/lib/nirium-x402-seller.ts` contains the seller-side wrapper backed by `x402Serve()` that enforces cryptographic verification and settlement before passing requests to the handler.

## Validation & Testing

```bash
npm run typecheck
npm test
npm run build
```
