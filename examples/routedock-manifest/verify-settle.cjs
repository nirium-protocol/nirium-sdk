// Verify the 0.02 USDC settlement on-chain (payer → payee GC4Q5TWW…)
const sdk = require('@stellar/stellar-sdk')
const fs = require('fs')
const secret = JSON.parse(fs.readFileSync('/home/loki/allocation-agent/state/grantfox-testnet-payer.json', 'utf8')).k
const kp = sdk.Keypair.fromSecret(secret)
const PAYEE = 'GC4Q5TWWXI7IHN6DYCBEKCOWJWCKY4JE2NLKLU5SE3YL44IUUFPKUOPC'
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

async function main() {
  const server = new sdk.Horizon.Server('https://horizon-testnet.stellar.org')
  const acct = await server.loadAccount(kp.publicKey())
  for (const b of acct.balances) console.log('[bal]', b.asset_code || 'XLM', b.balance)
  const page = await server.payments().forAccount(kp.publicKey()).order('desc').limit(8).call()
  for (const r of page.records) {
    const from = r.from && r.from.startsWith('G') ? r.from.slice(0, 8) : r.from?.slice(0, 12)
    const to = r.to && r.to.startsWith('G') ? r.to.slice(0, 8) : r.to?.slice(0, 12)
    console.log(`[pay] ${r.type} ${r.asset_type === 'native' ? 'XLM' : r.asset_code} ${r.amount} ${from}→${to} tx=${r.transaction_hash.slice(0, 20)}…`)
    if (r.to === PAYEE) {
      console.log('^^^ SETTLEMENT TO PAYEE FOUND, full tx:', r.transaction_hash)
    }
  }
}
main().catch(e => console.error('[verify] FAIL:', e.message))
