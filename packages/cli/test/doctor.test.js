import test from 'node:test';
import assert from 'node:assert/strict';
import { runDoctorDiagnostics } from '../src/doctor.ts';

// Mock fetch helper
function createMockFetch(responses) {
  return async function mockFetch(url, options) {
    const urlStr = String(url);
    if (responses[urlStr]) {
      const res = responses[urlStr];
      return {
        ok: res.ok !== false,
        status: res.status || (res.ok !== false ? 200 : 400),
        json: async () => res.json || {},
      };
    }
    // Default fallback for Soroban RPC
    if (urlStr.includes('soroban') || urlStr.includes('stellar')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', result: { status: 'healthy' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  };
}

test('nirium doctor: detects missing payTo address', async () => {
  const origEnv = process.env.STELLAR_PAY_TO;
  delete process.env.STELLAR_PAY_TO;
  delete process.env.PAY_TO;

  const mockFetch = createMockFetch({});
  const report = await runDoctorDiagnostics({ network: 'testnet', fetchFn: mockFetch });

  assert.equal(report.ok, false);
  const payToCheck = report.checks.find((c) => c.name === 'payTo');
  assert.ok(payToCheck);
  assert.equal(payToCheck.status, 'fail');
  assert.ok(payToCheck.message.includes('missing'));

  if (origEnv) process.env.STELLAR_PAY_TO = origEnv;
});

test('nirium doctor: detects secret key used as payTo address', async () => {
  process.env.STELLAR_PAY_TO = 'SDJ45V6O6G3BWT23ND4T3Y6F276TFLKW455G442X7F3X5O73P2345678';
  process.env.X402_FACILITATOR_API_KEY = 'test_key';

  const mockFetch = createMockFetch({});
  const report = await runDoctorDiagnostics({ network: 'testnet', fetchFn: mockFetch });

  assert.equal(report.ok, false);
  const payToCheck = report.checks.find((c) => c.name === 'payTo');
  assert.ok(payToCheck);
  assert.equal(payToCheck.status, 'fail');
  assert.ok(payToCheck.message.includes('secret key'));
});

test('nirium doctor: detects missing facilitator API key on default OpenZeppelin URL', async () => {
  process.env.STELLAR_PAY_TO = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX';
  delete process.env.X402_FACILITATOR_API_KEY;
  delete process.env.STELLAR_FACILITATOR_API_KEY;
  delete process.env.FACILITATOR_API_KEY;
  delete process.env.FACILITATOR_URL;

  const mockFetch = createMockFetch({});
  const report = await runDoctorDiagnostics({ network: 'testnet', fetchFn: mockFetch });

  assert.equal(report.ok, false);
  const facCheck = report.checks.find((c) => c.name === 'facilitator');
  assert.ok(facCheck);
  assert.equal(facCheck.status, 'fail');
  assert.ok(facCheck.message.includes('facilitatorApiKey is missing'));
});

test('nirium doctor: detects 401 rejected API key from facilitator', async () => {
  process.env.STELLAR_PAY_TO = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX';
  process.env.X402_FACILITATOR_API_KEY = 'invalid_key';

  const mockFetch = createMockFetch({
    'https://channels.openzeppelin.com/x402/testnet/supported': { ok: false, status: 401 },
  });
  const report = await runDoctorDiagnostics({ network: 'testnet', fetchFn: mockFetch });

  assert.equal(report.ok, false);
  const facCheck = report.checks.find((c) => c.name === 'facilitator');
  assert.ok(facCheck);
  assert.equal(facCheck.status, 'fail');
  assert.ok(facCheck.message.includes('rejected API key'));
});

test('nirium doctor: all checks pass with known-good testnet config', async () => {
  process.env.STELLAR_PAY_TO = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX';
  process.env.X402_FACILITATOR_API_KEY = 'valid_testnet_key';

  const mockFetch = createMockFetch({
    'https://channels.openzeppelin.com/x402/testnet/supported': { ok: true, status: 200 },
    'https://soroban-testnet.stellar.org': { ok: true, status: 200 },
  });
  const report = await runDoctorDiagnostics({ network: 'testnet', fetchFn: mockFetch });

  assert.equal(report.ok, true);
  assert.equal(report.network, 'stellar:testnet');
  assert.ok(report.checks.every((c) => c.status === 'pass'));
});
