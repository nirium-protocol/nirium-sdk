/**
 * CI test (fully mocked network — no Stellar account, no on-chain activity):
 *   1. Schema: the served manifest validates against RouteDock's REAL JSON
 *      Schema (via the SDK's own ajv-compiled validator, not eyeballing).
 *   2. Signature: verifyManifestSignature() accepts it, and rejects both a
 *      tampered payee and a mutated field — proving the signature binds the
 *      document.
 *   3. Client path: RouteDockClient fetches the manifest, verifies it,
 *      selects x402 mode FROM THE MANIFEST, runs trustline preflight, and
 *      fires the initial payment request — zero Nirium-specific code. The
 *      settle step is stopped at the HTTP boundary (404) so CI never signs
 *      anything; the full live settle runs on real testnet via
 *      `npm run test:live` (tx hash goes in the PR).
 *
 * Run: npm test   (in examples/routedock-manifest)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Keypair } from '@stellar/stellar-sdk'
import { signManifest, verifyManifestSignature } from '@routedock/routedock'
import { manifestForPayee } from '../src/manifest.js'

function makeSigned() {
  const kp = Keypair.random()
  const signed = signManifest(manifestForPayee(kp.publicKey()), kp.secret())
  return { signed, kp }
}

test('manifest validates against RouteDock real JSON Schema', async () => {
  const { signed } = makeSigned()
  // fetchManifest() runs ajv against the packaged schema and throws
  // RouteDockManifestError on any violation — using it as the validator.
  const { fetchManifest } = await import('@routedock/routedock/client')
  const srv = createServer((req, res) => {
    if (req.url === '/.well-known/routedock.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(signed))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => srv.listen(0, r))
  const port = (srv.address() as { port: number }).port
  try {
    const m = await fetchManifest(`http://127.0.0.1:${port}`)
    assert.equal(m.payee, signed.payee)
    assert.equal(m.pricing.x402?.facilitator, 'https://channels.openzeppelin.com/x402/testnet')
  } finally {
    srv.close()
  }
})

test('signature verifies; tampered payee and mutated field are rejected', () => {
  const { signed, kp } = makeSigned()
  // Self-consistent verification passes
  verifyManifestSignature(signed)
  // Anchored verification passes
  verifyManifestSignature(signed, kp.publicKey())
  // Payee substitution (the attack the trust model warns about) is rejected
  const tampered = { ...signed, payee: Keypair.random().publicKey() }
  assert.throws(() => verifyManifestSignature(tampered, kp.publicKey()), /does not match expected payee/)
  // A flipped description byte breaks the signature
  const mutated = { ...signed, description: signed.description + 'x' }
  assert.throws(() => verifyManifestSignature(mutated), /verification failed/)
})

test('RouteDockClient resolves the manifest and initiates an x402 payment with zero Nirium-specific code', async () => {
  const { signed } = makeSigned()
  const payer = Keypair.random()
  const seen: { url: string; modeHeader: string | undefined }[] = []

  const srv = createServer((req, res) => {
    if (req.url === '/.well-known/routedock.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(signed))
      return
    }
    if (req.url === '/paid') {
      // Record the initial payment request, then stop with a status the SDK
      // surfaces as a clean error — no signing, no chain, deterministic CI.
      seen.push({ url: req.url!, modeHeader: req.headers['x-preferred-mode'] as string | undefined })
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => srv.listen(0, r))
  const port = (srv.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`

  // Mock Horizon with a complete account incl. USDC trustline so the SDK's
  // preflight parses cleanly and passes.
  const realFetch = globalThis.fetch
  const horizonCalls: string[] = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof URL ? input.href : input)
    if (url.includes('horizon-testnet.stellar.org')) {
      horizonCalls.push(url)
      const account = {
        _links: { self: { href: url } },
        id: payer.publicKey(),
        account_id: payer.publicKey(),
        sequence: '1234567890',
        subentry_count: 0,
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: [],
        balances: [
          { balance: '1000.0000000', asset_type: 'native', buying_liabilities: '0', selling_liabilities: '0' },
          { balance: '50.0000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
        ],
        signers: [{ key: payer.publicKey(), weight: 1, type: 'ed25519_public_key' }],
        data: {},
        num_sponsoring: 0,
        num_sponsored: 0,
        paging_token: '1',
      }
      return new Response(JSON.stringify(account), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  }) as typeof fetch

  try {
    const { RouteDockClient } = await import('@routedock/routedock/client')
    const client = new RouteDockClient({
      wallet: payer.secret(),
      network: 'testnet',
      expectedPayee: signed.payee,
    })
    await assert.rejects(client.pay(`${base}/paid`))
    // Discovery contract: the client fetched the manifest (not hardcoded
    // Nirium config), verified the signature, picked x402 from it, ran the
    // trustline preflight, and fired the initial payment request.
    assert.equal(seen.length, 1, 'exactly one initial payment request')
    assert.equal(seen[0]?.modeHeader, 'x402', 'mode selected from manifest')
  } finally {
    globalThis.fetch = realFetch
    srv.close()
  }
})
