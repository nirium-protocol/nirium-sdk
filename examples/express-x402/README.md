# Express x402 example

This example starts a small Express API with one x402-protected route for Stellar testnet.

The route returns HTTP `402 Payment Required` until a client pays with x402. After a valid payment is supplied, the same route returns `200` with a JSON response.

## Files

- `src/server.ts` - Express app and x402 middleware setup.
- `.env.example` - local configuration template.
- `package.json` - example-only scripts and dependencies.

## Run

```bash
cd examples/express-x402
cp .env.example .env
npm install
npm run dev
```

The server starts on `http://localhost:3402` by default.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3402` | Local Express port. |
| `X402_PRICE` | `0.02` | Price for the protected request, in USDC. |
| `X402_NETWORK` | `stellar:testnet` | x402 network identifier. |
| `X402_SELLER_ADDRESS` | demo testnet address | Seller destination address for payments. Replace this with a funded Stellar testnet address you control before real testing. |
| `X402_FACILITATOR_URL` | package default | Optional facilitator override. |

No private key is required on the server side. The seller address is public configuration.

## Check the unpaid response

```bash
curl -i http://localhost:3402/paid/market-summary
```

Expected result before payment: HTTP `402 Payment Required` with x402 payment requirements.

## Paid client smoke test

Use an x402 client configured for Stellar testnet and retry the same route with payment. For example, a client can initialize the Nirium SDK x402 helper with a testnet secret key, then call the protected route:

```ts
import { Agent } from 'nirium'

const agent = new Agent({ apiKey: 'demo', baseUrl: 'http://localhost:3402' })
agent.initX402({
  secretKey: process.env.STELLAR_TESTNET_SECRET_KEY!,
  network: 'stellar:testnet',
})

const response = await agent.x402Fetch('http://localhost:3402/paid/market-summary')
console.log(response.status, await response.json())
```

Expected paid result: HTTP `200` and the protected JSON response.

Keep testnet secrets outside this repo and never commit `.env`.
