/**
 * Sign the manifest with RouteDock's own canonicalization (packages/sdk/src/manifest/sign.ts):
 * SHA-256 over JSON.stringify(manifest-without-signature, sorted-top-level-keys),
 * Ed25519-signed by the payee keypair, base64-encoded.
 *
 * Two signing modes:
 *  1. `sign.ts <secret>` — sign with an explicit secret (production path: Nirium's payee key)
 *  2. `sign.ts` (no args) — generate a dedicated testnet keypair, print it, sign with it.
 *     Only for tests/CI; the printed secret must never be committed.
 */
import { writeFileSync } from 'node:fs'
import { Keypair } from '@stellar/stellar-sdk'
import { signManifest } from '@routedock/routedock'
import { manifestForPayee, PRODUCTION_PAYEE } from './manifest.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const argSecret = process.argv[2]
let secret: string
if (argSecret) {
  secret = argSecret
} else {
  const kp = Keypair.random()
  secret = kp.secret()
  console.log('[sign] generated dedicated test keypair:')
  console.log('[sign]   public :', kp.publicKey())
  console.log('[sign]   secret : (kept in memory only; pass as arg for reproducibility)')
}

const payee = Keypair.fromSecret(secret).publicKey()
const unsigned = manifestForPayee(payee === PRODUCTION_PAYEE ? PRODUCTION_PAYEE : payee)
const signed = signManifest(unsigned, secret)

writeFileSync(resolve(here, '../../routedock.json'), JSON.stringify(signed, null, 2) + '\n')
console.log('[sign] payee      :', signed.payee)
console.log('[sign] signature  :', signed.signature!.slice(0, 24) + '…')
console.log('[sign] wrote routedock.json')
