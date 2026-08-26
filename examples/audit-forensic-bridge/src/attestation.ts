import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

export const DOMAIN_PREFIX = 'nirium-audit-v1:';

export function computeRecordSha256(record: Record<string, unknown>): string {
  const raw = JSON.stringify(record);
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function buildDomainMessage(contentSha256: string): Buffer {
  return Buffer.from(DOMAIN_PREFIX + contentSha256, 'utf8');
}

export function signAuditRecord(record: Record<string, unknown>, secretKey: string): {
  contentSha256: string;
  signature: string;
  publicKey: string;
} {
  const keypair = Keypair.fromSecret(secretKey);
  const contentSha256 = computeRecordSha256(record);
  const message = buildDomainMessage(contentSha256);
  const signature = keypair.sign(message).toString('base64');
  return {
    contentSha256,
    signature,
    publicKey: keypair.publicKey(),
  };
}

export function verifyAuditAttestation(
  record: Record<string, unknown>,
  publicKey: string,
  signatureBase64: string
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    const recomputedSha = computeRecordSha256(record);
    const message = buildDomainMessage(recomputedSha);
    const sigBuffer = Buffer.from(signatureBase64, 'base64');
    return keypair.verify(message, sigBuffer);
  } catch {
    return false;
  }
}