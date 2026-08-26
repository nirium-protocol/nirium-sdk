import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAuditRecordSize,
  buildAuditRecord,
  formatStroops,
  MAX_BATCH_TX_HASHES,
  normalizeDescriptor,
  parseAuditRecord,
  parseStroops,
  type VerifiedPayment,
} from '../src/record.js';
import { ISSUER, RECIPIENT_A, RECIPIENT_B, SOURCE, TX_A, TX_B } from './helpers.js';

function payment(overrides: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return {
    txHash: TX_A,
    operationId: '1',
    from: SOURCE,
    to: RECIPIENT_A,
    amountStroops: 10_000_001n,
    asset: { type: 'native' },
    createdAt: '2026-08-26T12:00:00.000Z',
    ...overrides,
  };
}

test('amount conversion is exact at seven decimal places', () => {
  assert.equal(parseStroops('9007199254740993.1234567'), 90071992547409931234567n);
  assert.equal(formatStroops(90071992547409931234567n), '9007199254740993.1234567');
  assert.throws(() => parseStroops('1.00000001'), /Invalid Stellar amount/);
  assert.throws(() => parseStroops('1e3'), /Invalid Stellar amount/);
});

test('aggregate counts unique recipients without retaining their addresses', () => {
  const record = buildAuditRecord(
    [
      payment(),
      payment({ operationId: '2', amountStroops: 20_000_002n }),
      payment({ txHash: TX_B, operationId: '3', to: RECIPIENT_B, amountStroops: 3n }),
    ],
    { type: 'tx_hashes' },
    [TX_B, TX_A],
  );
  assert.equal(record.recipientCount, 2);
  assert.equal(record.totalAmount, '3.0000006');
  assert.deepEqual(record.txHashes, [TX_A, TX_B]);
  assert.equal(JSON.stringify(record).includes(RECIPIENT_A), false);
  assert.equal(JSON.stringify(record).includes(RECIPIENT_B), false);
});

test('aggregate rejects extra selection fields instead of anchoring caller metadata', () => {
  assert.throws(
    () => buildAuditRecord(
      [payment()],
      { type: 'tx_hashes', recipients: [RECIPIENT_A] } as never,
      [TX_A],
    ),
    /record.selection contains unsupported field.*recipients/,
  );
});

test('aggregate rejects extra asset fields and invalid issuer checksums', () => {
  assert.throws(
    () => buildAuditRecord(
      [payment({ asset: { type: 'native', recipient: RECIPIENT_A } as never })],
      { type: 'tx_hashes' },
      [TX_A],
    ),
    /record.asset contains unsupported field.*recipient/,
  );
  assert.throws(
    () => buildAuditRecord(
      [payment({
        asset: {
          type: 'credit_alphanum4',
          code: 'USDC',
          issuer: `G${'A'.repeat(55)}`,
        },
      })],
      { type: 'tx_hashes' },
      [TX_A],
    ),
    /record.asset.issuer is invalid/,
  );
});

test('mixed assets fail closed', () => {
  assert.throws(
    () => buildAuditRecord(
      [
        payment(),
        payment({
          txHash: TX_B,
          operationId: '2',
          asset: { type: 'credit_alphanum4', code: 'USDC', issuer: ISSUER },
        }),
      ],
      { type: 'tx_hashes' },
      [TX_A, TX_B],
    ),
    /cannot aggregate multiple Stellar assets/,
  );
});

test('duplicate operation evidence cannot inflate recipients or totals', () => {
  const duplicated = payment();
  assert.throws(
    () => buildAuditRecord(
      [duplicated, { ...duplicated }],
      { type: 'tx_hashes' },
      [TX_A],
    ),
    /duplicate payment operation evidence/,
  );
});

test('descriptor validation rejects duplicates and canonicalizes a source window', () => {
  assert.throws(
    () => normalizeDescriptor({ txHashes: [TX_A, TX_A.toUpperCase()] }),
    /Duplicate transaction hashes/,
  );
  const normalized = normalizeDescriptor({
    sourceAccount: SOURCE,
    from: '2026-08-26T07:00:00-05:00',
    to: '2026-08-26T13:00:00Z',
  });
  assert.deepEqual(normalized.selection, {
    type: 'source_time_window',
    sourceAccount: SOURCE,
    from: '2026-08-26T12:00:00.000Z',
    to: '2026-08-26T13:00:00.000Z',
  });
});

test('timestamp validation rejects impossible dates and timezone-free input', () => {
  assert.throws(
    () => normalizeDescriptor({
      sourceAccount: SOURCE,
      from: '2026-02-30T12:00:00Z',
      to: '2026-03-03T12:00:00Z',
    }),
    /valid RFC 3339 timestamp/,
  );
  assert.throws(
    () => normalizeDescriptor({
      sourceAccount: SOURCE,
      from: '2026-08-26T12:00:00',
      to: '2026-08-26T13:00:00Z',
    }),
    /RFC 3339 timestamp with a timezone/,
  );
});

test('descriptor rejects a transaction list that cannot fit in one audit record', () => {
  const hashes = Array.from({ length: MAX_BATCH_TX_HASHES + 1 }, (_, index) => {
    return (index + 1).toString(16).padStart(64, '0');
  });
  assert.throws(
    () => normalizeDescriptor({ txHashes: hashes }),
    /At most 119 transaction hashes/,
  );
});

test('descriptor rejects ambiguous, extra and non-string runtime input', () => {
  assert.throws(
    () => normalizeDescriptor({
      txHashes: [TX_A],
      sourceAccount: SOURCE,
      from: '2026-08-26T12:00:00Z',
      to: '2026-08-26T13:00:00Z',
    } as never),
    /transaction hashes or a source window, not both/,
  );
  assert.throws(
    () => normalizeDescriptor({ txHashes: [TX_A], recipients: [RECIPIENT_A] } as never),
    /unsupported field.*recipients/,
  );
  assert.throws(
    () => normalizeDescriptor({ sourceAccount: SOURCE, from: null, to: '2026-08-26T13:00:00Z' } as never),
    /from must be an ISO-8601 timestamp string/,
  );
});

test('strict record parser rejects extra fields, unsorted hashes and noncanonical amounts', () => {
  const valid = buildAuditRecord(
    [payment(), payment({ txHash: TX_B, operationId: '2' })],
    { type: 'tx_hashes' },
    [TX_A, TX_B],
  );
  assert.deepEqual(parseAuditRecord(valid), valid);
  assert.throws(() => parseAuditRecord({ ...valid, recipients: [RECIPIENT_A] }), /unsupported field/);
  assert.throws(() => parseAuditRecord({ ...valid, txHashes: [TX_B, TX_A] }), /must be sorted/);
  assert.throws(() => parseAuditRecord({ ...valid, totalAmount: '2.0' }), /canonical/);
  assert.throws(
    () => parseAuditRecord({
      ...valid,
      asset: { type: 'credit_alphanum4', code: 'ABCDE', issuer: ISSUER },
    }),
    /asset.code is invalid/,
  );
});

test('record size preflight rejects a hash list above Nirium 8KB limit', () => {
  const hashes = Array.from({ length: 130 }, (_, index) => {
    return (index + 1).toString(16).padStart(64, '0');
  });
  const payments = hashes.map((txHash, index) => payment({
    txHash,
    operationId: String(index + 1),
  }));
  const record = buildAuditRecord(payments, { type: 'tx_hashes' }, hashes);
  assert.throws(() => assertAuditRecordSize(record), /at most 8192 bytes/);
});
