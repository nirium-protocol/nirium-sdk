/**
 * LIVE testnet e2e (not CI): pay the real Nirium endpoint through a local
 * manifest server + proxy, proving RouteDockClient can pay it with zero
 * Nirium-specific code. Requires PAYER_SECRET (funded testnet account with
 * USDC trustline). Prints the settlement tx hash for the PR.
 */
import { Keypair } from '@stellar/stellar-sdk'
import { RouteDockClient } from '@routedock/sdk/client'

const secret = process.env.PAYER_SECRET
if (!secret) {
  console.error('Set PAYER_SECRET (funded Stellar testnet key with USDC trustline)')
  process.exit(1)
}
const base = process.env.MANIFEST_BASE ?? 'http://127.0.0.1:8787'
const payer = Keypair.fromSecret(secret)

console.log('[live] payer:', payer.publicKey())
const client = new RouteDockClient({
  wallet: secret,
  network: 'testnet',
  spendCap: { daily: '0.10', asset: 'USDC' }, // hard cap for the demo run
})

const result = await client.pay(`${base}/api/v1/premium/signals`)
console.log('[live] mode   :', result.mode)
console.log('[live] amount :', result.amount)
console.log('[live] txHash :', result.txHash)
console.log('[live] data   :', JSON.stringify(result.data).slice(0, 300))
if (!result.txHash) {
  console.error('[live] WARNING: no txHash returned — check facilitator settlement')
  process.exit(2)
}
