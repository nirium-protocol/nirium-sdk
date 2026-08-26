/**
 * Serves GET /.well-known/routedock.json (and a proxied paid route for the
 * live e2e demo). The manifest is loaded from dist/routedock.json produced
 * by `npm run sign` — this server never holds signing keys.
 *
 * NOTE: the manifest is a DISCOVERY DOCUMENT ONLY. The actual charging stays
 * with Nirium's x402Serve() on nirium-agent.fly.dev, unmodified. This example
 * does not re-implement any payment logic.
 *
 * Env:
 *   PORT          — default 8787
 *   MANIFEST_PATH — default ./dist/routedock.json
 *   UPSTREAM      — default https://nirium-agent.fly.dev (proxy passthrough
 *                   for the e2e demo; forwards 402/payment headers untouched)
 */
import express from 'express'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const MANIFEST_PATH = process.env.MANIFEST_PATH ?? resolve(process.cwd(), 'routedock.json')
const UPSTREAM = process.env.UPSTREAM ?? 'https://nirium-agent.fly.dev'

const app = express()

app.get('/.well-known/routedock.json', (_req, res) => {
  res.type('application/json').send(readFileSync(MANIFEST_PATH, 'utf8'))
})

// Demo passthrough: lets a RouteDock client pay the LIVE Nirium endpoint
// through this origin (exercise for the e2e run; not part of the manifest
// contract itself). Headers including X-Payment-* are forwarded verbatim.
app.all('/api/v1/premium/*', async (req, res) => {
  const upstream = new URL(req.originalUrl, UPSTREAM)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) {
      headers.set(k, v)
    }
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  const bodyBuf = hasBody ? Buffer.from(await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })) : undefined
  const resp = await fetch(upstream, {
    method: req.method,
    headers,
    body: bodyBuf,
  })
  res.status(resp.status)
  resp.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k.toLowerCase())) {
      res.setHeader(k, v)
    }
  })
  // Dialect bridge: upstream serves x402 v2 challenges as `payment-required`
  // (with a literal "..." elision inserted mid-base64 by the upstream stack),
  // while RouteDockClient reads `X-Payment-Requirements` and requires strict
  // base64. Alias + strip so RouteDock clients can pay this endpoint as-is.
  const pr = resp.headers.get('payment-required')
  if (pr && !resp.headers.get('x-payment-requirements')) {
    res.setHeader('X-Payment-Requirements', pr.replace(/\.\.\./g, ''))
  }
  res.send(Buffer.from(await resp.arrayBuffer()))
})

app.listen(PORT, () => {
  console.log(`[routedock-manifest] manifest at http://localhost:${PORT}/.well-known/routedock.json`)
  console.log(`[routedock-manifest] proxying /api/v1/premium/* → ${UPSTREAM}`)
})
