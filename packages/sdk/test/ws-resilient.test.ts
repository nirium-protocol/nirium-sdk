import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { ResilientSignalClient } from '../src/resilient-ws.ts';

function closeWss(wss: WebSocketServer): void {
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();
}

test('ResilientSignalClient: connects, receives signal, and deduplicates bursts', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address() as any;
  const url = `ws://localhost:${address.port}/ws/signals`;

  let serverWs: WebSocket | null = null;
  wss.on('connection', (ws) => {
    serverWs = ws;
  });

  const client = new ResilientSignalClient({
    url,
    initialBackoffMs: 10,
    maxReconnectAttempts: 3,
  });

  const receivedSignals: any[] = [];
  client.onSignal((signal) => {
    receivedSignals.push(signal);
  });

  client.connect();

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (client.getStatus() === 'connected' && serverWs) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  const testSignal = {
    id: 'sig-1001',
    type: 'signal',
    signal_type: 'path_arbitrage_opportunity',
    pair: 'XLM-USDC',
    data: { confidence: 0.92 },
  };

  serverWs!.send(JSON.stringify(testSignal));
  serverWs!.send(JSON.stringify(testSignal));
  serverWs!.send(JSON.stringify(testSignal));

  await new Promise((r) => setTimeout(r, 50));

  assert.equal(receivedSignals.length, 1);
  assert.equal(receivedSignals[0].id, 'sig-1001');

  client.close();
  closeWss(wss);
});

test('ResilientSignalClient: survives forced disconnect and reconnects automatically', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address() as any;
  const port = address.port;
  const url = `ws://localhost:${port}/ws/signals`;

  let connectCount = 0;
  let activeServerWs: WebSocket | null = null;

  wss.on('connection', (ws) => {
    connectCount++;
    activeServerWs = ws;
  });

  const statusEvents: string[] = [];
  let tokenRefreshCount = 0;

  const client = new ResilientSignalClient({
    url,
    initialBackoffMs: 10,
    maxReconnectAttempts: 5,
    onTokenRefresh: async () => {
      tokenRefreshCount++;
      return `jwt_token_${tokenRefreshCount}`;
    },
  });

  client.onStatus((info) => {
    statusEvents.push(info.status);
  });

  client.connect();

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (client.getStatus() === 'connected' && activeServerWs) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  assert.equal(connectCount, 1);
  assert.equal(statusEvents.includes('connected'), true);

  // Force disconnect by terminating server socket
  activeServerWs!.terminate();

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (connectCount >= 2 && client.getStatus() === 'connected') {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  assert.ok(connectCount >= 2, 'Client should have reconnected after forced disconnect');
  assert.ok(tokenRefreshCount >= 2, 'Token refresh hook should have run before reconnecting');

  client.close();
  closeWss(wss);
});
