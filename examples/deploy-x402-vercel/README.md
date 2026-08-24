# x402-Protected API Template (Deploy to Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnirium-protocol%2Fnirium-sdk%2Ftree%2Fmain%2Fexamples%2Fdeploy-x402-vercel&env=PAY_TO,NETWORK&envDescription=Stellar%20public%20key%20(G...)%20to%20receive%20payments%20and%20network&envLink=https%3A%2F%2Fnirium.xyz%2Fdocs)

A minimal, zero-config template for deploying pay-per-request APIs protected by the **x402 protocol** and **Nirium SDK** on Vercel.

---

## What Just Happened?

1. **One-Click Deployment**: Clicking the button above deploys a live Next.js API server directly to your Vercel account.
2. **Environment Configuration**: Prompts only for your Stellar wallet address (`PAY_TO`) and Stellar network (`NETWORK`).
3. **Automated Monetization**: The `/api/ascii` endpoint immediately enforces $0.01 USDC x402 micropayments per request without database or complex middleware setups.

---

## Demo Route

- **`GET /api/ascii`**: A fun ASCII art generator (Cat, Owl, Robot, Rocket) behind x402 payment protection.
- **Rules out financial data**: This template is designed purely for utility/demo services and contains no investment, trading, or market signal logic.

---

## Testing Your Live Deployment

### 1. Request without payment (402 Payment Required)

```bash
curl -i https://<your-vercel-domain>.vercel.app/api/ascii
```

**Response:**
```http
HTTP/2 402
x-accept-payment: x402
content-type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "USDC",
      "payTo": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX",
      "maxAmountRequired": "$0.01",
      "resource": "/api/ascii",
      "description": "Paid ASCII Art Generator Endpoint"
    }
  ],
  "error": "Payment required via x402 protocol"
}
```

### 2. Request with x402 payment header (200 OK)

Using Nirium CLI or TypeScript SDK to attach payment:

```bash
curl -i -H "x-payment: <valid_payment_token>" https://<your-vercel-domain>.vercel.app/api/ascii?style=cat
```

**Response:**
```http
HTTP/2 200 OK
content-type: application/json

{
  "ok": true,
  "service": "x402 ASCII Art Generator",
  "style": "cat",
  "art": "\n /\\_/\\ \n( o.o )\n > ^ < \n",
  "timestamp": "2026-08-23T18:00:00.000Z"
}
```

---

## Running Locally

```bash
npm install
npm run test    # Run smoke tests
npm run dev     # Start Next.js local server on http://localhost:3000
```
