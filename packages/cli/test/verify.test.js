import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuditDocument } from '../src/verify.ts';

// Known-good audit document fixture (retrieved live from Pinata IPFS gateway for CID QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U)
const VALID_FIXTURE = {
  version: '1.1.0',
  node: 'audit-external',
  content_sha256: 'ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9',
  agent: {
    id: 'arcusx-dispute-resolver',
    key: 'GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ',
    alg: 'ed25519',
    statement: 'nirium-audit-v1:ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9',
    signature: 'kQu3tK3ZsDR0HMo1EFB13qa/bLiJa4AuX1yJSZq9/2MEgGVGJImFrtXH2SItfBWHW3bWTbB8qFeBUf/QkSkGAw==',
  },
  record: {
    schema: 'arcusx.dispute.resolution.v1',
    dispute: 'dispute-118',
    outcome: 'released_to_worker',
    case_file_sha256: '1794c699bce4e06d33857cc34f2974ac2bfff500bdc41b002b219a154b698ac0',
    note: 'Hashes only — no personal data anchored.',
  },
  network: 'mainnet',
  tag: 'arcusx-dispute',
  anchoredAt: '2026-07-30T22:26:02.857Z',
};

test('offline verify: valid fixture passes both hash and ed25519 signature checks', () => {
  const result = verifyAuditDocument(VALID_FIXTURE, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, true);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'valid');
  assert.equal(result.signerKey, 'GD5AFNPTKVZPNWZWKLOULOE7BN4E7ZC73WV5YMBCULYQXWFCGDESUNOZ');
  assert.equal(result.computedHash, 'ab44f8883af819f7496f2cef29eaea0651f6d97af78aa8088fd8ef4dc4b753c9');
});

test('offline verify: tampered content fixture fails hash match', () => {
  const tamperedFixture = JSON.parse(JSON.stringify(VALID_FIXTURE));
  // Alter outcome in embedded record
  tamperedFixture.record.outcome = 'refunded_to_client_tampered';

  const result = verifyAuditDocument(tamperedFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, false);
  assert.equal(result.hashMatch, false);
  assert.notEqual(result.computedHash, tamperedFixture.content_sha256);
});

test('offline verify: forged signature fixture fails signature verification', () => {
  const forgedFixture = JSON.parse(JSON.stringify(VALID_FIXTURE));
  // Alter one byte in signature
  forgedFixture.agent.signature = 'INVALID' + forgedFixture.agent.signature.slice(7);

  const result = verifyAuditDocument(forgedFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, false);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'invalid');
});

test('offline verify: handles audit document without agent signature block', () => {
  const noAgentFixture = JSON.parse(JSON.stringify(VALID_FIXTURE));
  delete noAgentFixture.agent;

  const result = verifyAuditDocument(noAgentFixture, 'QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U');

  assert.equal(result.ok, true);
  assert.equal(result.hashMatch, true);
  assert.equal(result.signatureStatus, 'absent');
});

// Regression: statement-substitution bypass (the attack fixed in this commit).
// Scenario: attacker takes a legitimately-signed document, swaps the record
// for malicious content, updates content_sha256 to the new correct hash so
// hashMatch still passes, but leaves agent.statement pointing at the OLD hash.
// Before the fix, the verifier would verify the signature against the old
// (document-declared) statement and incorrectly report VALID.
import crypto from 'node:crypto';

test('offline verify: rejects statement-substitution attack (record swapped, old statement reused)', () => {
  const attacked = JSON.parse(JSON.stringify(VALID_FIXTURE));

  // Swap record with entirely different content
  attacked.record = {
    schema: 'arcusx.dispute.resolution.v1',
    dispute: 'dispute-999',
    outcome: 'MALICIOUS_CONTENT',
    note: 'This record was NOT attested by the agent.',
  };

  // Update content_sha256 to the genuine hash of the new record,
  // so the hash-match check passes on its own.
  const newHash = crypto.createHash('sha256')
    .update(JSON.stringify(attacked.record))
    .digest('hex');
  attacked.content_sha256 = newHash;

  // Leave agent.statement pointing at the ORIGINAL hash —
  // the signature is valid for THAT statement, not for the new hash.
  // (agent.statement is still nirium-audit-v1:<originalHash>)

  const result = verifyAuditDocument(attacked, 'QmFAKE');

  // Hash matches because we updated content_sha256 honestly
  assert.equal(result.hashMatch, true);
  // But signature must be INVALID — the verifier now reconstructs
  // `nirium-audit-v1:<newHash>` instead of trusting the old statement
  assert.equal(result.signatureStatus, 'invalid');
  // Overall: must fail
  assert.equal(result.ok, false);
  // Verify that declaredStatement differs from the recomputed statement
  assert.notEqual(result.declaredStatement, result.statement);
});
