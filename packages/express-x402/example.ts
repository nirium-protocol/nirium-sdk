import express from 'express';
import { nirium } from './src';

const app = express();
const PORT = process.env.PORT || 3402;

// Any route wrapped in x402Serve requires a valid x402 payment header.
app.get('/skills/whale-tracker', nirium.x402Serve({
  price: '0.02',
  payTo: process.env.PAY_TO || 'GABC123DEF456TESTSTELLARADDRESSNO_REAL_FUNDS_9XQ2',
  network: 'stellar:testnet',
  resource: 'skills/whale-tracker',
}), (_req, res) => {
  res.json({ ok: true, data: { whale: 'detected', ts: Date.now() } });
});

app.listen(PORT, () => {
  console.log(`x402-protected API listening on :${PORT} — send X-PAYMENT header to access.`);
});

export default app;
