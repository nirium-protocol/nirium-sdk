# routedock-manifest — advertise a live Nirium x402 endpoint to RouteDock clients

Serves a signed `/.well-known/routedock.json` discovery manifest for one real
Nirium x402 endpoint, so a developer using
[RouteDock](https://github.com/winsznx/routedock) can pay it with a single
`client.pay(url)` — zero Nirium-specific code.

## Target endpoint

`GET https://nirium-agent.fly.dev/api/v1/premium/signals` — premium trading
signals, $0.02 USDC per request, Stellar **testnet**, charged by Nirium's
`x402Serve()` (unmodified — see *Scope* below).

| Field | Value | Source |
|---|---|---|
| `payee` (production) | `GC4Q5TWWXI7IHN6DYCBEKCOWJWCKY4JE2NLKLU5SE3YL44IUUFPKUOPC` | endpoint's live 402 challenge |
| `asset_contract` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (USDC SAC, testnet) | endpoint's live 402 challenge |
| `pricing.x402` | `0.02` per request | endpoint's live 402 challenge (`amount: "200000"`, 7 decimals) |
| `facilitator` | `https://channels.openzeppelin.com/x402/testnet` | `X402_FACILITATORS['stellar:testnet']` in `packages/sdk/src/index.ts` |

## Quick start

```bash
cd examples/routedock-manifest
npm install
npm run sign     # generates a test keypair, writes dist/routedock.json
npm start        # serves /.well-known/routedock.json on :8787
```

Production signing (Nirium maintainer only — see *Signature & payee*):

```bash
npx tsx src/sign.ts "S…"   # secret of the production payee above
```

## What the signature proves — and what it doesn't

RouteDock signs the manifest with the **payee's** keypair. The production
payee is Nirium's own account, so only Nirium can produce the production
signature. This example therefore:

1. generates a **dedicated testnet keypair**, declares it as `payee`, and
   signs with it — exercising the exact schema, canonicalization, and Ed25519
   machinery RouteDock clients verify;
2. documents the production swap: replace `payee` with the production address
   above and sign with its secret (`npm run sign` accepts the secret as an
   argument). No other field changes.

`verifyManifestSignature(manifest)` proves the signer controlled the declared
payee key. It does **not** prove the manifest was served by that entity —
callers with an out-of-band anchor (e.g. Nirium's registered account) must
pass `expectedPayee`, exactly as RouteDock's `sign.ts` trust-model comment
specifies. The test suite demonstrates both the pass and the
payee-substitution rejection.

## Discovery document only — charging stays with `x402Serve()`

The manifest advertises *how to pay*; it never charges anything. The live
endpoint keeps using `x402Serve()` untouched: the RouteDock client reads the
manifest for mode/pricing/facilitator discovery, then follows the endpoint's
own live 402 challenge (`X-Payment-Requirements`) for the actual payment.
No Nirium payment logic is re-implemented here.

## Tests

- `npm test` — schema validation (via the SDK's own ajv-compiled validator
  against the packaged real schema), signature verification + tamper
  rejection, and `RouteDockClient.pay()` against a mock 402/settlement flow
  (mocked network — no Stellar account needed).
- `npm run test:live` — real testnet run: pays the LIVE Nirium endpoint
  through this manifest. Requires `PAYER_SECRET` (funded testnet account with
  a USDC trustline). The resulting tx hash goes in the PR.

## Layout

```
src/manifest.ts   manifest definition (single source of truth)
src/sign.ts       signing CLI (RouteDock's own signManifest)
src/server.ts     serves /.well-known/routedock.json (+ demo proxy)
test/manifest.test.mts   schema + signature + client-path tests
dist/routedock.json      produced by `npm run sign` (gitignored)
```
