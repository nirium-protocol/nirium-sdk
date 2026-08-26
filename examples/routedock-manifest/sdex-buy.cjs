// SDEX: buy ~1.6 testnet USDC with 8 XLM (pathPaymentStrictSend, direct book)
const sdk = require('@stellar/stellar-sdk')
const fs = require('fs')

const secret = JSON.parse(fs.readFileSync('/home/loki/allocation-agent/state/grantfox-testnet-payer.json', 'utf8')).k
const kp = sdk.Keypair.fromSecret(secret)
const USDC = new sdk.Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')

async function main() {
  const server = new sdk.Horizon.Server('https://horizon-testnet.stellar.org')
  const acct = await server.loadAccount(kp.publicKey())
  const fee = await server.fetchBaseFee()
  const tx = new sdk.TransactionBuilder(acct, { fee: String(fee * 2), networkPassphrase: sdk.Networks.TESTNET })
    .addOperation(sdk.Operation.pathPaymentStrictSend({
      sendAsset: sdk.Asset.native(),
      sendAmount: '8',            // 8 XLM
      destination: kp.publicKey(),
      destAsset: USDC,
      destMin: '1.5',             // best ask 3.663 → expect ~2.18 USDC; tolerate 1.5
      path: [],                   // direct XLM/USDC book
    }))
    .setTimeout(180)
    .build()
  tx.sign(kp)
  const resp = await server.submitTransaction(tx)
  console.log('[sdex] tx:', resp.hash, 'ledger:', resp.ledger)
  const acct2 = await server.loadAccount(kp.publicKey())
  for (const b of acct2.balances) console.log('[sdex] bal:', b.asset_code || 'XLM', b.balance)
}
main().catch(e => { console.error('[sdex] FAIL:', e.response?.data?.extras?.result_codes || e.message); process.exit(1) })
