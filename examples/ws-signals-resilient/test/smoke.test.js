import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { ResilientSignalClient } from 'nirium';

test('Smoke test: ResilientSignalClient instantiates and handles stream lifecycle', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address();
  const url = `ws://localhost:${address.port}/ws/signals`;

  let receivedSignalCount = 0;

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        id: 'smoke-sig-1',
        signal_type: 'smoke_test',
        pair: 'XLM-USDC',
        data: { ok: true },
      })
    );
  });

  const client = new ResilientSignalClient({
    url,
    initialBackoffMs: 10,
    maxReconnectAttempts: 2,
  });

  client.onSignal((signal) => {
    if (signal.id === 'smoke-sig-1') {
      receivedSignalCount++;
    }
  });

  client.connect();

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (receivedSignalCount > 0) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  assert.equal(receivedSignalCount, 1);

  client.close();
  for (const c of wss.clients) {
    c.terminate();
  }
  wss.close();
});
