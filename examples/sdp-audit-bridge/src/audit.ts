import { Keypair } from '@stellar/stellar-sdk';
import { Agent, type AgentAttestationInput } from 'nirium';
import { HorizonReader, type HorizonReaderOptions } from './horizon.js';
import { fetchJson } from './http.js';
import {
  type BatchDescriptor,
  type SdpAuditRecord,
  assertAuditRecordSize,
  buildAuditRecord,
  hashAuditRecord,
  parseAuditRecord,
} from './record.js';

const DEFAULT_NIRIUM_URL = 'https://nirium-agent.fly.dev';
const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud';
const AUDIT_DOCUMENT_LIMIT = 64 * 1024;
const CID_PATTERN = /^[A-Za-z0-9]{20,128}$/;

type JsonObject = Record<string, unknown>;

export interface CreateAuditRecordOptions extends HorizonReaderOptions {
  descriptor: BatchDescriptor;
}

export interface CreatedAuditRecord {
  record: SdpAuditRecord;
  contentSha256: string;
  paymentOperationCount: number;
}

export interface AnchorBatchOptions extends CreateAuditRecordOptions {
  niriumApiUrl?: string;
  niriumApiKey?: string;
  agentSecretKey?: string;
  agentId?: string;
}

export interface AnchoredBatch extends CreatedAuditRecord {
  cid: string;
  gatewayUrl?: string;
  anchoredAt: string;
  attestedBy?: string;
}

export interface VerifyCidOptions extends HorizonReaderOptions {
  cid: string;
  gatewayUrl?: string;
}

export interface VerifiedCid {
  cid: string;
  contentSha256: string;
  signatureStatus: 'valid' | 'absent';
  signerKey?: string;
  record: SdpAuditRecord;
  checkedTxHashes: string[];
  paymentOperationCount: number;
}

interface AuditDocumentAgent {
  key: string;
  signature: string;
  id?: string;
  statement?: string;
}

interface AuditDocument {
  contentSha256: string;
  record: JsonObject;
  agent?: AuditDocumentAgent;
}

interface ParsedAnchorResponse {
  cid: string;
  contentSha256: string;
  anchoredAt: string;
  gatewayUrl?: string;
  attestedBy?: string;
}

function asObject(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as JsonObject;
}

export function parseNiriumAnchorResponse(value: unknown): ParsedAnchorResponse {
  const response = asObject(value, 'Nirium anchor response');
  const contentSha256 = typeof response.contentSha256 === 'string'
    ? response.contentSha256
    : response.content_sha256;
  if (typeof response.cid !== 'string' || !CID_PATTERN.test(response.cid)) {
    throw new Error('Nirium anchor response has an invalid CID');
  }
  if (typeof contentSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(contentSha256)) {
    throw new Error('Nirium anchor response has an invalid content hash');
  }
  if (typeof response.anchoredAt !== 'string') {
    throw new Error('Nirium anchor response is missing anchoredAt');
  }
  return {
    cid: response.cid,
    contentSha256: contentSha256.toLowerCase(),
    anchoredAt: response.anchoredAt,
    ...(typeof response.gatewayUrl === 'string' ? { gatewayUrl: response.gatewayUrl } : {}),
    ...(typeof response.attestedBy === 'string' ? { attestedBy: response.attestedBy } : {}),
  };
}

function parseAuditDocument(value: unknown): AuditDocument {
  const document = asObject(value, 'IPFS audit document');
  const contentSha256 = document.content_sha256;
  if (typeof contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new Error('IPFS audit document has an invalid content_sha256');
  }
  const record = asObject(document.record, 'IPFS audit document.record');

  if (document.agent === undefined) {
    return { contentSha256, record };
  }
  const rawAgent = asObject(document.agent, 'IPFS audit document.agent');
  if (typeof rawAgent.key !== 'string' || typeof rawAgent.signature !== 'string') {
    throw new Error('IPFS audit document has an incomplete agent attestation');
  }
  const agent: AuditDocumentAgent = {
    key: rawAgent.key,
    signature: rawAgent.signature,
    ...(typeof rawAgent.id === 'string' ? { id: rawAgent.id } : {}),
    ...(typeof rawAgent.statement === 'string' ? { statement: rawAgent.statement } : {}),
  };
  return { contentSha256, record, agent };
}

function decodeSignature(value: string): Buffer {
  if (/^[0-9a-fA-F]{128}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) {
    throw new Error('Agent signature must be a 64-byte hex or base64 Ed25519 signature');
  }
  const signature = Buffer.from(value, 'base64');
  if (signature.byteLength !== 64) {
    throw new Error('Agent signature must contain exactly 64 bytes');
  }
  return signature;
}

function buildAgentAttestation(
  contentSha256: string,
  secretKey: string,
  agentId?: string,
): AgentAttestationInput {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secretKey);
  } catch {
    throw new Error('AUDIT_AGENT_SECRET_KEY is not a valid Stellar Ed25519 secret key');
  }
  const statement = `nirium-audit-v1:${contentSha256}`;
  return {
    key: keypair.publicKey(),
    signature: keypair.sign(Buffer.from(statement, 'utf8')).toString('base64'),
    ...(agentId ? { id: agentId } : {}),
  };
}

function verifyAgentAttestation(
  agent: AuditDocumentAgent | undefined,
  contentSha256: string,
): { status: 'valid' | 'absent'; signerKey?: string } {
  if (!agent) {
    return { status: 'absent' };
  }
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(agent.key);
  } catch {
    throw new Error('Audit document agent key is not a valid Stellar Ed25519 public key');
  }
  const statement = `nirium-audit-v1:${contentSha256}`;
  const signature = decodeSignature(agent.signature);
  if (!keypair.verify(Buffer.from(statement, 'utf8'), signature)) {
    throw new Error('Agent signature is invalid for the recomputed audit statement');
  }
  return { status: 'valid', signerKey: agent.key };
}

function horizonOptions(options: HorizonReaderOptions): HorizonReaderOptions {
  return {
    ...(options.horizonUrl ? { horizonUrl: options.horizonUrl } : {}),
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    ...(options.sleepFn ? { sleepFn: options.sleepFn } : {}),
  };
}

export async function createAuditRecord(
  options: CreateAuditRecordOptions,
): Promise<CreatedAuditRecord> {
  const horizon = new HorizonReader(horizonOptions(options));
  const resolved = await horizon.resolveBatch(options.descriptor);
  const record = buildAuditRecord(
    resolved.payments,
    resolved.selection,
    resolved.txHashes,
  );
  assertAuditRecordSize(record);
  return {
    record,
    contentSha256: hashAuditRecord(record),
    paymentOperationCount: resolved.payments.length,
  };
}

export async function anchorDisbursementBatch(
  options: AnchorBatchOptions,
): Promise<AnchoredBatch> {
  const created = await createAuditRecord(options);
  const trimmedSecret = options.agentSecretKey?.trim();
  const agentAttestation = trimmedSecret
    ? buildAgentAttestation(created.contentSha256, trimmedSecret, options.agentId)
    : undefined;
  const agent = new Agent({
    apiKey: options.niriumApiKey ?? '',
    baseUrl: options.niriumApiUrl ?? DEFAULT_NIRIUM_URL,
  });
  const anchorOptions = {
    record: created.record as unknown as Record<string, unknown>,
    ...(agentAttestation ? { agent: agentAttestation } : {}),
  };
  const anchored = parseNiriumAnchorResponse(await agent.anchorAuditRecord(anchorOptions));
  if (anchored.contentSha256 !== created.contentSha256) {
    throw new Error(
      `Nirium returned content hash ${anchored.contentSha256}, expected ${created.contentSha256}`,
    );
  }
  return {
    ...created,
    cid: anchored.cid,
    anchoredAt: anchored.anchoredAt,
    ...(anchored.gatewayUrl ? { gatewayUrl: anchored.gatewayUrl } : {}),
    ...(anchored.attestedBy ? { attestedBy: anchored.attestedBy } : {}),
  };
}

export async function fetchAuditDocument(
  cid: string,
  gatewayUrl = DEFAULT_IPFS_GATEWAY,
  options: Pick<HorizonReaderOptions, 'fetchFn' | 'timeoutMs' | 'maxRetries' | 'sleepFn'> = {},
): Promise<AuditDocument> {
  if (!CID_PATTERN.test(cid)) {
    throw new Error('CID must be an alphanumeric IPFS content identifier');
  }
  const gateway = new URL(gatewayUrl);
  if (gateway.protocol !== 'https:' && gateway.protocol !== 'http:') {
    throw new Error('IPFS gateway URL must use http or https');
  }
  const url = new URL(
    `ipfs/${encodeURIComponent(cid)}`,
    `${gateway.toString().replace(/\/$/, '')}/`,
  );
  const rawDocument = await fetchJson(url, {
    maxBytes: AUDIT_DOCUMENT_LIMIT,
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.sleepFn ? { sleepFn: options.sleepFn } : {}),
  });
  return parseAuditDocument(rawDocument);
}

export async function verifyAuditCid(options: VerifyCidOptions): Promise<VerifiedCid> {
  const document = await fetchAuditDocument(
    options.cid,
    options.gatewayUrl,
    horizonOptions(options),
  );
  const computedHash = hashAuditRecord(document.record);
  if (computedHash !== document.contentSha256) {
    throw new Error(
      `Audit content hash mismatch: declared ${document.contentSha256}, computed ${computedHash}`,
    );
  }

  const attestation = verifyAgentAttestation(document.agent, computedHash);
  const record = parseAuditRecord(document.record);
  assertAuditRecordSize(record);

  const horizon = new HorizonReader(horizonOptions(options));
  const resolved = await horizon.resolveCitedTransactions(record.txHashes, record.selection);
  const rebuilt = buildAuditRecord(
    resolved.payments,
    resolved.selection,
    resolved.txHashes,
  );
  if (JSON.stringify(rebuilt) !== JSON.stringify(record)) {
    throw new Error('On-chain Horizon data does not match the anchored aggregate record');
  }

  return {
    cid: options.cid,
    contentSha256: computedHash,
    signatureStatus: attestation.status,
    ...(attestation.signerKey ? { signerKey: attestation.signerKey } : {}),
    record,
    checkedTxHashes: [...record.txHashes],
    paymentOperationCount: resolved.payments.length,
  };
}
