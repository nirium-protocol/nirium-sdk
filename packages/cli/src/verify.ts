import crypto from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';

export interface AuditDocument {
  version?: string;
  node?: string;
  content_sha256?: string;
  record?: Record<string, unknown>;
  agent?: {
    id?: string;
    key: string;
    alg?: string;
    statement?: string;
    signature: string;
  };
  network?: string;
  tag?: string;
  anchoredAt?: string;
}

export interface VerifyResult {
  ok: boolean;
  cid?: string;
  hashMatch: boolean;
  expectedHash: string;
  computedHash: string;
  signatureStatus: 'valid' | 'invalid' | 'absent';
  signerKey?: string;
  statement?: string;
  agentId?: string;
  error?: string;
}

export function decodeStellarPublicKey(gAddress: string): Buffer {
  if (!/^G[A-Z2-7]{55}$/.test(gAddress)) {
    throw new Error(`Invalid Stellar public key format: ${gAddress}`);
  }
  const rawBytes = StrKey.decodeEd25519PublicKey(gAddress);
  return Buffer.from(rawBytes);
}

export function verifyEd25519Signature(pubKeyGAddress: string, statement: string, base64Signature: string): boolean {
  try {
    const rawPubKey = decodeStellarPublicKey(pubKeyGAddress);
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([spkiHeader, rawPubKey]),
      format: 'der',
      type: 'spki',
    });

    const signatureBuf = Buffer.from(base64Signature, 'base64');
    return crypto.verify(null, Buffer.from(statement), keyObject, signatureBuf);
  } catch {
    return false;
  }
}

export function verifyAuditDocument(doc: AuditDocument, cid?: string): VerifyResult {
  if (!doc || typeof doc !== 'object') {
    return {
      ok: false,
      cid,
      hashMatch: false,
      expectedHash: '',
      computedHash: '',
      signatureStatus: 'absent',
      error: 'Invalid audit document format',
    };
  }

  const expectedHash = doc.content_sha256 || '';
  const recordStr = doc.record ? JSON.stringify(doc.record) : '';
  const computedHash = crypto.createHash('sha256').update(recordStr).digest('hex');

  const hashMatch = expectedHash.length > 0 && expectedHash === computedHash;

  let signatureStatus: 'valid' | 'invalid' | 'absent' = 'absent';
  let signerKey: string | undefined;
  let statement: string | undefined;
  let agentId: string | undefined;

  if (doc.agent && doc.agent.key && doc.agent.signature) {
    signerKey = doc.agent.key;
    agentId = doc.agent.id;
    statement = doc.agent.statement || `nirium-audit-v1:${computedHash}`;

    const isValidSig = verifyEd25519Signature(signerKey, statement, doc.agent.signature);
    signatureStatus = isValidSig ? 'valid' : 'invalid';
  }

  const ok = hashMatch && signatureStatus !== 'invalid';

  return {
    ok,
    cid,
    hashMatch,
    expectedHash,
    computedHash,
    signatureStatus,
    signerKey,
    statement,
    agentId,
  };
}

export async function fetchAndVerifyCid(
  cid: string,
  gatewayUrl = 'https://gateway.pinata.cloud',
  fetchFn: typeof fetch = globalThis.fetch
): Promise<VerifyResult> {
  const url = `${gatewayUrl.replace(/\/$/, '')}/ipfs/${cid}`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      return {
        ok: false,
        cid,
        hashMatch: false,
        expectedHash: '',
        computedHash: '',
        signatureStatus: 'absent',
        error: `IPFS gateway returned HTTP ${res.status}`,
      };
    }
    const doc = (await res.json()) as AuditDocument;
    return verifyAuditDocument(doc, cid);
  } catch (err: any) {
    return {
      ok: false,
      cid,
      hashMatch: false,
      expectedHash: '',
      computedHash: '',
      signatureStatus: 'absent',
      error: `Failed to fetch CID from gateway: ${err?.message || String(err)}`,
    };
  }
}

export function formatVerifyOutput(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`🔍 Nirium Audit Verifier`);
  if (result.cid) lines.push(`CID:            ${result.cid}`);
  lines.push(`--------------------------------------------------`);
  lines.push(
    result.hashMatch
      ? `✔ HASH:        MATCH (${result.computedHash.slice(0, 16)}...)`
      : `❌ HASH:        MISMATCH (Expected: ${result.expectedHash}, Computed: ${result.computedHash})`
  );

  if (result.signatureStatus === 'valid') {
    lines.push(`✔ SIGNATURE:   VALID (Signed by ${result.signerKey})`);
    if (result.statement) lines.push(`   Statement:  ${result.statement}`);
    if (result.agentId) lines.push(`   Agent ID:   ${result.agentId}`);
  } else if (result.signatureStatus === 'invalid') {
    lines.push(`❌ SIGNATURE:   INVALID (Signature check failed for key ${result.signerKey})`);
  } else {
    lines.push(`ℹ SIGNATURE:   ABSENT (No agent attestation embedded)`);
  }

  lines.push(`--------------------------------------------------`);
  if (result.error) {
    lines.push(`❌ ERROR:       ${result.error}`);
  } else {
    lines.push(result.ok ? `✅ VERIFICATION PASSED` : `❌ VERIFICATION FAILED`);
  }
  return lines.join('\n');
}
