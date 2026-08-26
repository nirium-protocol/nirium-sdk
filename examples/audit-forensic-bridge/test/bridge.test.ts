import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Keypair } from '@stellar/stellar-sdk';
import { computeRecordSha256, signAuditRecord, verifyAuditAttestation, buildDomainMessage } from '../src/attestation.js';

describe('Audit Forensic Bridge - Cryptographic Verification', () => {
  test('recomputes raw sha256 without reordering keys', () => {
    const payload = { z_last: 100, a_first: 'test', m_middle: true };
    const sha = computeRecordSha256(payload);

    const reordered = { a_first: 'test', m_middle: true, z_last: 100 };
    const reorderedSha = computeRecordSha256(reordered);

    assert.notStrictEqual(sha, reorderedSha);
  });

  test('signs and independently verifies valid attestation', () => {
    const keypair = Keypair.random();
    const event = { eventId: 'evt_12345', amount: 500, token: 'USDC' };

    const { signature, publicKey } = signAuditRecord(event, keypair.secret());
    const isValid = verifyAuditAttestation(event, publicKey, signature);

    assert.strictEqual(isValid, true);
  });

  test('detects tampered record during verification', () => {
    const keypair = Keypair.random();
    const event = { eventId: 'evt_original', amount: 100 };
    const { signature, publicKey } = signAuditRecord(event, keypair.secret());

    const tamperedEvent = { eventId: 'evt_original', amount: 999999 };
    const isValid = verifyAuditAttestation(tamperedEvent, publicKey, signature);

    assert.strictEqual(isValid, false);
  });

  test('enforces domain separation prefix in message', () => {
    const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const message = buildDomainMessage(sha);
    assert.strictEqual(message.toString('utf8'), 'nirium-audit-v1:' + sha);
  });
});