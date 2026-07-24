# @nirium/express-x402

Express.js middleware for monetizing API endpoints via Nirium x402 micropayments on Stellar Mainnet / Testnet.

## Install

```bash
npm install @nirium/express-x402
```

Requires Node.js ≥ 18 (uses `fetch`).

## Use

```typescript
import express from 'express';
import { nirium } from '@nirium/express-x402';

const app = express();

app.get('/premium',
  nirium.x402Serve({
    price: '0.02',
    payTo: 'GXXXX_STELLAR_ADDRESS',
  }),
  (req, res) => {
    res.json({ ok: true, paid: req.x402Validation });
  }
);

app.listen(3000);
```

## Behavior

- Inspects the `X-402-Signature` request header on every gated request.
- When the header is missing or shorter than 16 chars, returns
  HTTP 402 Payment Required immediately.
- Otherwise validates the signature against the configured nirium
  settlement endpoint (`https://settlement.nirium.io/v1/verify` by
  default) with an 8-second timeout.
- On settlement failure (network error, timeout, non-200 response)
  the middleware responds with HTTP 402 + a bounded reason string.
- On success, the validated result is exposed at `req.x402Validation`
  for downstream handlers.

The 402 response carries:

- `X-402-Price`, `X-402-Currency`, `X-402-Network`, `X-402-PayTo`,
  `X-402-Reason` headers
- A `WWW-Authenticate: X402 realm="nirium", price="...", currency="..."` header
- A JSON body with `error`, `price`, `currency`, `network`, `pay_to`,
  `reason`

## Tests

```bash
npm install
npm test
```

## Bounded

This middleware validates; it never opens bank rails, never mutates
external state, never issues credits on behalf of the caller.

## License

Apache-2.0 — see the repository `LICENSE` file.