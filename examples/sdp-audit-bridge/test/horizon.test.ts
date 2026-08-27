import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Networks,
  encodeMuxedAccount,
  encodeMuxedAccountToAddress,
} from '@stellar/stellar-sdk';
import { HorizonReader, normalizePaymentOperation } from '../src/horizon.js';
import {
  ISSUER,
  RECIPIENT_A,
  RECIPIENT_B,
  SOURCE,
  TX_A,
  horizonPage,
  jsonResponse,
  paymentOperation,
  rootResponse,
  singlePaymentHorizonFetch,
  transactionResponse,
  urlOf,
} from './helpers.js';

test('resolves a successful classic payment by transaction hash', async () => {
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn: singlePaymentHorizonFetch(TX_A),
    maxRetries: 0,
  });
  const resolved = await reader.resolveBatch({ txHashes: [TX_A] });
  assert.equal(resolved.payments.length, 1);
  assert.equal(resolved.payments[0]?.from, SOURCE);
  assert.equal(resolved.payments[0]?.to, RECIPIENT_A);
  assert.equal(resolved.payments[0]?.amountStroops, 10_000_000n);
});

test('rejects a Horizon endpoint connected to a non-Testnet network', async () => {
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn: async () => jsonResponse(rootResponse(Networks.PUBLIC)),
    maxRetries: 0,
  });
  await assert.rejects(
    () => reader.resolveBatch({ txHashes: [TX_A] }),
    /not connected to Stellar Testnet/,
  );
});

test('rejects a transaction that Horizon marks unsuccessful', async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A, false));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  await assert.rejects(
    () => reader.resolveBatch({ txHashes: [TX_A] }),
    /was not successful on-chain/,
  );
});

test('normalizes every SAC transfer balance change and ignores non-payment changes', () => {
  const operation = paymentOperation(TX_A, {
    type: 'invoke_host_function',
    source_account: RECIPIENT_B,
    asset_balance_changes: [{
      asset_type: 'native',
      type: 'transfer',
      from: SOURCE,
      to: 'CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO',
      amount: '2.5000000',
    }],
  });
  const payments = normalizePaymentOperation(operation);
  assert.equal(payments.length, 1);
  assert.equal(payments[0]?.amountStroops, 25_000_000n);
  assert.equal(payments[0]?.from, SOURCE);

  const multiTransfer = {
    ...operation,
    asset_balance_changes: [
      ...(operation.asset_balance_changes as unknown[]),
      {
        asset_type: 'native',
        type: 'transfer',
        from: SOURCE,
        to: RECIPIENT_A,
        amount: '1.0000000',
      },
      {
        asset_type: 'native',
        type: 'mint',
        to: RECIPIENT_A,
        amount: '9.0000000',
      },
    ],
  };
  const multiPayments = normalizePaymentOperation(multiTransfer);
  assert.equal(multiPayments.length, 2);
  assert.equal(multiPayments[1]?.operationId.endsWith(':balance-change:1'), true);
});

test('normalizes issued SAC fields and muxed destinations exactly as Horizon exposes them', () => {
  const muxedRecipient = encodeMuxedAccountToAddress(
    encodeMuxedAccount(RECIPIENT_A, '123'),
    true,
  );
  const operation = paymentOperation(TX_A, {
    type: 'invoke_host_function',
    source_account: RECIPIENT_B,
    asset_balance_changes: [{
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: ISSUER,
      type: 'transfer',
      from: SOURCE,
      to: RECIPIENT_A,
      amount: '2.5000000',
      destination_muxed_id: '123',
    }],
  });
  const payments = normalizePaymentOperation(operation);
  assert.deepEqual(payments[0]?.asset, {
    type: 'credit_alphanum4',
    code: 'USDC',
    issuer: ISSUER,
  });
  assert.equal(payments[0]?.to, muxedRecipient);

  const classicPayments = normalizePaymentOperation(paymentOperation(TX_A, {
    to: RECIPIENT_A,
    to_muxed: muxedRecipient,
    to_muxed_id: '123',
  }));
  assert.equal(classicPayments[0]?.to, muxedRecipient);
  assert.equal(classicPayments[0]?.to, payments[0]?.to);

  const contradictoryMuxedRecipient = encodeMuxedAccountToAddress(
    encodeMuxedAccount(RECIPIENT_B, '999'),
    true,
  );
  assert.throws(
    () => normalizePaymentOperation(paymentOperation(TX_A, {
      to: RECIPIENT_A,
      to_muxed: contradictoryMuxedRecipient,
      to_muxed_id: '123',
    })),
    /contradictory muxed destination fields/,
  );
});

test('rejects malformed SAC muxed destination IDs', () => {
  const operation = paymentOperation(TX_A, {
    type: 'invoke_host_function',
    asset_balance_changes: [{
      asset_type: 'native',
      type: 'transfer',
      from: SOURCE,
      to: RECIPIENT_A,
      amount: '1.0000000',
      destination_muxed_id: '18446744073709551616',
    }],
  });
  assert.throws(() => normalizePaymentOperation(operation), /must be a uint64 string/);
});

test('rejects pagination that leaves the configured Horizon origin', async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      return jsonResponse(horizonPage(
        [paymentOperation(TX_A)],
        'https://attacker.example/operations?cursor=stolen',
      ));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  await assert.rejects(
    () => reader.resolveBatch({ txHashes: [TX_A] }),
    /pagination attempted to leave the configured origin/,
  );
});

test('rejects payment evidence that belongs to a different transaction', async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      return jsonResponse(horizonPage(
        [paymentOperation('b'.repeat(64))],
        `https://horizon.test/transactions/${TX_A}/payments?cursor=end`,
      ));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  await assert.rejects(
    () => reader.resolveBatch({ txHashes: [TX_A] }),
    /returned payment evidence for transaction b{64} while resolving a{64}/,
  );
});

test('source window uses operation-level from and exact [from, to) bounds', async () => {
  const inside = paymentOperation(TX_A, { created_at: '2026-08-26T12:30:00.000Z' });
  const atUpperBound = paymentOperation('c'.repeat(64), {
    created_at: '2026-08-26T13:00:00.000Z',
  });
  const incoming = paymentOperation('d'.repeat(64), {
    created_at: '2026-08-26T12:45:00.000Z',
    from: RECIPIENT_A,
    to: SOURCE,
  });
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/accounts/${SOURCE}/payments`) {
      const records = url.searchParams.has('cursor')
        ? [paymentOperation('e'.repeat(64), { created_at: '2026-08-26T11:59:59.000Z' })]
        : [atUpperBound, incoming, inside];
      const next = `https://horizon.test/accounts/${SOURCE}/payments?order=desc&limit=200&include_failed=false&cursor=older`;
      return jsonResponse(horizonPage(records, next));
    }
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      const records = url.searchParams.has('cursor') ? [] : [inside];
      const next = `https://horizon.test/transactions/${TX_A}/payments?order=asc&limit=200&include_failed=false&cursor=end`;
      return jsonResponse(horizonPage(records, next));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  const resolved = await reader.resolveBatch({
    sourceAccount: SOURCE,
    from: '2026-08-26T12:00:00Z',
    to: '2026-08-26T13:00:00Z',
  });
  assert.deepEqual(resolved.txHashes, [TX_A]);
  assert.equal(resolved.payments.length, 1);
});

test('source window discovers an SDP SAC transfer by balance-change source', async () => {
  const sacPayment = paymentOperation(TX_A, {
    type: 'invoke_host_function',
    source_account: RECIPIENT_B,
    created_at: '2026-08-26T12:30:00.000Z',
    asset_balance_changes: [{
      asset_type: 'native',
      type: 'transfer',
      from: SOURCE,
      to: 'CAKKHUGHP67UA4F42QOYPKNGRSBJEOE62MGDXA2UURTEYFOQGSMIRUFO',
      amount: '2.5000000',
    }],
  });
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/accounts/${SOURCE}/payments`) {
      return jsonResponse(horizonPage(
        [sacPayment],
        `https://horizon.test/accounts/${SOURCE}/payments?cursor=end`,
      ));
    }
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      return jsonResponse(horizonPage(
        [sacPayment],
        `https://horizon.test/transactions/${TX_A}/payments?cursor=end`,
      ));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  const resolved = await reader.resolveBatch({
    sourceAccount: SOURCE,
    from: '2026-08-26T12:00:00Z',
    to: '2026-08-26T13:00:00Z',
  });
  assert.deepEqual(resolved.txHashes, [TX_A]);
  assert.equal(resolved.payments.length, 1);
  assert.equal(resolved.payments[0]?.from, SOURCE);
  assert.equal(resolved.payments[0]?.amountStroops, 25_000_000n);
});

test('429 responses are retried without unbounded concurrency or delay', async () => {
  let calls = 0;
  const delays: number[] = [];
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: 'limited' }, 429, { 'retry-after': '0' });
      }
      return jsonResponse(rootResponse());
    },
    sleepFn: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  await reader.assertTestnet();
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
});

test('pagination and reader tuning are bounded and fail closed', async () => {
  assert.throws(
    () => new HorizonReader({ maxPages: 0 }),
    /maxPages must be an integer between 1 and 1000/,
  );
  assert.throws(
    () => new HorizonReader({ concurrency: 17 }),
    /concurrency must be an integer between 1 and 16/,
  );

  const fullPage = Array.from({ length: 200 }, (_, index) => {
    return paymentOperation(TX_A, { id: String(index + 1) });
  });
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      return jsonResponse(horizonPage(
        fullPage,
        `https://horizon.test/transactions/${TX_A}/payments?cursor=second`,
      ));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
    maxPages: 1,
  });
  await assert.rejects(
    () => reader.resolveBatch({ txHashes: [TX_A] }),
    /transaction pagination exceeded 1 pages/,
  );
});

test('invalid timeout is not silently replaced with the default', async () => {
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    timeoutMs: 0,
    fetchFn: async () => jsonResponse(rootResponse()),
  });
  await assert.rejects(
    () => reader.assertTestnet(),
    /timeoutMs must be an integer between 1 and 120000/,
  );
});

test('source discovery rejects out-of-order pages instead of silently omitting payments', async () => {
  const older = paymentOperation(TX_A, { created_at: '2026-08-26T11:59:59.000Z' });
  const newer = paymentOperation(TX_A, {
    id: 'newer',
    created_at: '2026-08-26T12:30:00.000Z',
  });
  const fetchFn: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/accounts/${SOURCE}/payments`) {
      return jsonResponse(horizonPage(
        [older, newer],
        `https://horizon.test/accounts/${SOURCE}/payments?cursor=end`,
      ));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const reader = new HorizonReader({
    horizonUrl: 'https://horizon.test',
    fetchFn,
    maxRetries: 0,
  });
  await assert.rejects(
    () => reader.resolveBatch({
      sourceAccount: SOURCE,
      from: '2026-08-26T12:00:00Z',
      to: '2026-08-26T13:00:00Z',
    }),
    /not in descending time order/,
  );
});
