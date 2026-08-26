import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnchorArguments } from '../src/anchor.js';
import { parseVerifyArguments } from '../src/verify.js';
import { SOURCE, TX_A, TX_B } from './helpers.js';

test('anchor CLI accepts repeated transaction hashes', () => {
  assert.deepEqual(parseAnchorArguments(['--tx', TX_A, '--tx', TX_B]), {
    descriptor: { txHashes: [TX_A, TX_B] },
  });
});

test('anchor CLI rejects mixed or incomplete descriptors', () => {
  assert.throws(
    () => parseAnchorArguments([
      '--tx', TX_A,
      '--source', SOURCE,
      '--from', '2026-08-26T12:00:00Z',
      '--to', '2026-08-26T13:00:00Z',
    ]),
    /either --tx values or --source/,
  );
  assert.throws(
    () => parseAnchorArguments(['--source', SOURCE]),
    /complete --source\/--from\/--to/,
  );
});

test('verify CLI accepts one CID and rejects unknown arguments', () => {
  const cid = `Qm${'a'.repeat(44)}`;
  assert.deepEqual(
    parseVerifyArguments([cid, '--gateway', 'https://gateway.example']),
    { cid, gatewayUrl: 'https://gateway.example' },
  );
  assert.throws(() => parseVerifyArguments([cid, '--json']), /Unknown argument/);
});
