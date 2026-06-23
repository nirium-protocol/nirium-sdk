import 'dotenv/config'

import express from 'express'
import { HTTPFacilitatorClient } from '@x402/core/http'
import type { RoutesConfig } from '@x402/core/http'
import type { Network } from '@x402/core/types'
import { paymentMiddlewareFromConfig } from '@x402/express'
import { ExactStellarScheme } from '@x402/stellar/exact/server'

const DEFAULT_PORT = 3402
const DEFAULT_PRICE = '0.02'
const DEFAULT_NETWORK = 'stellar:testnet'
const DEFAULT_SELLER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

const port = Number(process.env.PORT ?? DEFAULT_PORT)
const price = process.env.X402_PRICE ?? DEFAULT_PRICE
const network = (process.env.X402_NETWORK ?? DEFAULT_NETWORK) as Network
const sellerAddress = process.env.X402_SELLER_ADDRESS ?? DEFAULT_SELLER_ADDRESS
const facilitatorUrl = process.env.X402_FACILITATOR_URL

const paidRoute = '/paid/market-summary'

const routes: RoutesConfig = {
  [paidRoute]: {
    accepts: {
      scheme: 'exact',
      network,
      payTo: sellerAddress,
      price,
    },
    description: 'Nirium x402-protected market summary example',
    mimeType: 'application/json',
    serviceName: 'Nirium Express x402 example',
  },
}

const facilitator = new HTTPFacilitatorClient(
  facilitatorUrl ? { url: facilitatorUrl } : undefined
)

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nirium-express-x402-example' })
})

app.use(
  paymentMiddlewareFromConfig(
    routes,
    facilitator,
    [{ network, server: new ExactStellarScheme() }],
    { appName: 'Nirium Express x402 example', testnet: network === 'stellar:testnet' },
    undefined,
    false
  )
)

app.get(paidRoute, (_req, res) => {
  res.json({
    ok: true,
    route: paidRoute,
    network,
    message: 'Payment accepted. This is the protected Nirium market summary response.',
    summary: {
      asset: 'USDC',
      rails: ['x402', 'Stellar testnet'],
      price,
    },
  })
})

app.listen(port, () => {
  console.log(`Nirium x402 Express example listening on http://localhost:${port}`)
  console.log(`Paid route: http://localhost:${port}${paidRoute}`)
})

