# nirium-cli

Scaffold Stellar agent projects — including one that charges for itself.

```bash
npm install -g nirium-cli
```

## Charge for your API in five minutes

```bash
nirium create x402 --name my-paid-api
cd my-paid-api && npm install
```

Fill two values in the generated `.env`:

| Variable | Where it comes from |
|---|---|
| `STELLAR_PAY_TO` | the Stellar account that receives payments (`G...`) |
| `X402_FACILITATOR_API_KEY` | free at [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) |

The API key is not optional. The facilitator rejects unauthenticated servers
on testnet as well as mainnet, so without it your routes never get as far as
offering a 402.

```bash
npm run dev
```

Everything under `/premium` now bills before it answers. A caller without
payment gets a 402 carrying the terms; one that pays gets the data, and the
transfer settles on Stellar before your handler returns. No subscription, no
card, no invoice, no human in the middle.

The generated server is about ten lines, because `x402Serve()` from the
[`nirium`](https://www.npmjs.com/package/nirium) SDK carries the facilitator
client, the scheme registration and the route shape.

## Listen to protocol signals

```bash
nirium create bot --name my-agent          # TypeScript
nirium create bot --name my-agent -t py    # Python
```

Scaffolds a project that connects to a Nirium agent and prints incoming
signals. Defaults to `https://nirium-agent.fly.dev` (testnet); set
`NIRIUM_API_URL` and `NIRIUM_API_KEY` in `.env` to point somewhere else.

## Check an agent

```bash
nirium status
```

## Verify IPFS Audit CID (`nirium verify`)

Independently verify an audit document CID anchored on IPFS without trusting any Nirium backend servers or external verification API.

The verifier recomputes the SHA-256 hash of the embedded record and independently verifies the Ed25519 signature over `nirium-audit-v1:<content_sha256>` using the signer's Stellar public key (`G...`).

```bash
nirium verify <cid> [--gateway https://gateway.pinata.cloud] [--json]
```

### Example Verification Output

```text
🔍 Nirium Audit Verifier
CID:            QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U
--------------------------------------------------
✔ HASH:        MATCH (ab44f8883af819f7...)
✔ SIGNATURE:   VALID (Signed by GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ)
   Statement:  nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9
   Agent ID:   arcusx-dispute-resolver
--------------------------------------------------
✅ VERIFICATION PASSED
```

## Options

| Option | Values | Default |
|---|---|---|
| `-n, --name <name>` | project directory name | `nirium-bot-v1` |
| `-t, --template <template>` | `ts` or `py` — `bot` only | `ts` |

## Links

- [nirium.xyz](https://nirium.xyz)
- [TypeScript SDK](https://www.npmjs.com/package/nirium) · [Python SDK](https://pypi.org/project/nirium/)
- [SDK and examples on GitHub](https://github.com/nirium-protocol/nirium-sdk)

## License

Apache 2.0 — Nirium Protocol
