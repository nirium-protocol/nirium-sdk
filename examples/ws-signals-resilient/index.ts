import { ResilientSignalClient, Signal } from 'nirium';

const WS_URL = process.env.NIRIUM_WS_URL || 'wss://nirium-agent.fly.dev/ws/signals';
const JWT_TOKEN = process.env.NIRIUM_JWT_TOKEN || '';

console.log('⚡ Resilient Nirium Signals Client Example');
console.log(`Target WebSocket: ${WS_URL}`);
console.log('Connecting...\n');

const client = new ResilientSignalClient({
  url: WS_URL,
  token: JWT_TOKEN,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  maxReconnectAttempts: 10,
  onTokenRefresh: async () => {
    // Hook for fetching a fresh JWT before reconnecting
    if (process.env.NIRIUM_JWT_REFRESH_URL) {
      const res = await fetch(process.env.NIRIUM_JWT_REFRESH_URL);
      const data = await res.json() as { token: string };
      return data.token;
    }
    return JWT_TOKEN;
  },
});

client.onStatus((info) => {
  const timestamp = new Date().toISOString();
  switch (info.status) {
    case 'connecting':
      console.log(`[${timestamp}] 🟡 Connecting to WebSocket signal feed...`);
      break;
    case 'connected':
      console.log(`[${timestamp}] 🟢 Connected & listening for live market signals.`);
      break;
    case 'reconnecting':
      console.log(
        `[${timestamp}] 🔄 Disconnected. Reconnecting (attempt ${info.attempt}, retrying in ${info.delayMs}ms)...`
      );
      break;
    case 'disconnected':
      console.log(`[${timestamp}] 🔴 Connection lost. ${info.error?.message || ''}`);
      break;
  }
});

client.onSignal((signal: Signal) => {
  const timestamp = new Date().toISOString();
  console.log(`\n--------------------------------------------------`);
  console.log(`⚡ [SIGNAL] Received at ${timestamp}`);
  console.log(`   ID:       ${signal.id || 'N/A'}`);
  console.log(`   Type:     ${signal.signal_type}`);
  console.log(`   Pair:     ${signal.pair}`);
  console.log(`   Payload:  ${JSON.stringify(signal.data)}`);
  console.log(`--------------------------------------------------`);
});

client.onError((error) => {
  console.error(`[ERROR] WebSocket client error:`, error.message);
});

client.connect();

process.on('SIGINT', () => {
  console.log('\nShutting down signal client gracefully...');
  client.close();
  process.exit(0);
});
