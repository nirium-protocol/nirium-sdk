import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';

export const AUDIT_SCHEMA = 'nirium.sdp-audit.v1' as const;
export const AUDIT_NETWORK = 'testnet' as const;
export const MAX_AUDIT_RECORD_BYTES = 8 * 1024;
// Even the smallest valid record with 120 SHA-256 transaction hashes exceeds
// Nirium's 8 KiB limit. Reject it before issuing needless Horizon requests.
export const MAX_BATCH_TX_HASHES = 119;

const STROOPS_PER_UNIT = 10_000_000n;
const TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const G_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface NativeAsset {
  type: 'native';
}

export interface CreditAsset {
  type: 'credit_alphanum4' | 'credit_alphanum12';
  code: string;
  issuer: string;
}

export type AuditAsset = NativeAsset | CreditAsset;

export interface TxHashDescriptor {
  txHashes: string[];
}

export interface SourceWindowDescriptor {
  sourceAccount: string;
  from: string;
  to: string;
}

export type BatchDescriptor = TxHashDescriptor | SourceWindowDescriptor;

export interface TxHashSelection {
  type: 'tx_hashes';
}

export interface SourceWindowSelection {
  type: 'source_time_window';
  sourceAccount: string;
  from: string;
  to: string;
}

export type AuditSelection = TxHashSelection | SourceWindowSelection;

export interface VerifiedPayment {
  txHash: string;
  operationId: string;
  from: string;
  to: string;
  amountStroops: bigint;
  asset: AuditAsset;
  createdAt: string;
}

export interface SdpAuditRecord {
  schema: typeof AUDIT_SCHEMA;
  network: typeof AUDIT_NETWORK;
  selection: AuditSelection;
  recipientCount: number;
  totalAmount: string;
  asset: AuditAsset;
  txHashes: string[];
}

export function normalizeTxHash(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Stellar transaction hashes must be strings');
  }
  const hash = value.trim();
  if (!TX_HASH_PATTERN.test(hash)) {
    throw new Error(`Invalid Stellar transaction hash: ${value}`);
  }
  return hash.toLowerCase();
}

export function normalizeSourceAccount(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('sourceAccount must be a string');
  }
  const account = value.trim();
  if (!G_ADDRESS_PATTERN.test(account) || !StrKey.isValidEd25519PublicKey(account)) {
    throw new Error('sourceAccount must be a Stellar G... account');
  }
  return account;
}

export function normalizeTimestamp(value: string, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be an ISO-8601 timestamp string`);
  }
  const components = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!components) {
    throw new Error(`${fieldName} must be an RFC 3339 timestamp with a timezone`);
  }
  const year = Number(components[1]);
  const month = Number(components[2]);
  const day = Number(components[3]);
  const hour = Number(components[4]);
  const minute = Number(components[5]);
  const second = Number(components[6]);
  const timezone = components[7] ?? '';
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const timezoneHour = timezone === 'Z' ? 0 : Number(timezone.slice(1, 3));
  const timezoneMinute = timezone === 'Z' ? 0 : Number(timezone.slice(4, 6));
  if (
    month < 1
    || month > 12
    || day < 1
    || day > (daysPerMonth[month - 1] ?? 0)
    || hour > 23
    || minute > 59
    || second > 59
    || timezoneHour > 23
    || timezoneMinute > 59
  ) {
    throw new Error(`${fieldName} must be a valid RFC 3339 timestamp`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  }
  return timestamp.toISOString();
}

export function normalizeDescriptor(descriptor: BatchDescriptor): {
  descriptor: BatchDescriptor;
  selection: AuditSelection;
} {
  if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
    throw new Error('Batch descriptor must be a JSON object');
  }
  const rawDescriptor = descriptor as unknown as Record<string, unknown>;
  const hasTxHashes = Object.hasOwn(rawDescriptor, 'txHashes');
  const hasSourceWindow = ['sourceAccount', 'from', 'to'].some((key) => {
    return Object.hasOwn(rawDescriptor, key);
  });
  if (hasTxHashes && hasSourceWindow) {
    throw new Error('Batch descriptor must use transaction hashes or a source window, not both');
  }
  const allowedKeys = new Set(
    hasTxHashes ? ['txHashes'] : ['sourceAccount', 'from', 'to'],
  );
  const unexpectedKeys = Object.keys(rawDescriptor).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Batch descriptor contains unsupported field(s): ${unexpectedKeys.join(', ')}`);
  }

  if (hasTxHashes) {
    const rawTxHashes = rawDescriptor.txHashes;
    if (!Array.isArray(rawTxHashes)) {
      throw new Error('txHashes must be an array');
    }
    if (rawTxHashes.length === 0) {
      throw new Error('At least one transaction hash is required');
    }
    const txHashes = rawTxHashes.map((hash) => {
      if (typeof hash !== 'string') {
        throw new Error('Stellar transaction hashes must be strings');
      }
      return normalizeTxHash(hash);
    });
    if (txHashes.length > MAX_BATCH_TX_HASHES) {
      throw new Error(
        `At most ${MAX_BATCH_TX_HASHES} transaction hashes can fit in one audit record`,
      );
    }
    if (new Set(txHashes).size !== txHashes.length) {
      throw new Error('Duplicate transaction hashes are not allowed');
    }
    txHashes.sort();
    return {
      descriptor: { txHashes },
      selection: { type: 'tx_hashes' },
    };
  }

  const rawSourceAccount = rawDescriptor.sourceAccount;
  const rawFrom = rawDescriptor.from;
  const rawTo = rawDescriptor.to;
  if (typeof rawSourceAccount !== 'string') {
    throw new Error('sourceAccount must be a string');
  }
  if (typeof rawFrom !== 'string') {
    throw new Error('from must be an ISO-8601 timestamp string');
  }
  if (typeof rawTo !== 'string') {
    throw new Error('to must be an ISO-8601 timestamp string');
  }
  const sourceAccount = normalizeSourceAccount(rawSourceAccount);
  const from = normalizeTimestamp(rawFrom, 'from');
  const to = normalizeTimestamp(rawTo, 'to');
  if (Date.parse(from) >= Date.parse(to)) {
    throw new Error('from must be earlier than to; the interval is [from, to)');
  }
  return {
    descriptor: { sourceAccount, from, to },
    selection: { type: 'source_time_window', sourceAccount, from, to },
  };
}

export function parseStroops(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid Stellar amount: ${value}`);
  }
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(7, '0');
  return whole * STROOPS_PER_UNIT + BigInt(fraction || '0');
}

export function formatStroops(stroops: bigint): string {
  if (stroops < 0n) {
    throw new Error('Stellar amounts cannot be negative');
  }
  const whole = stroops / STROOPS_PER_UNIT;
  const fraction = (stroops % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

export function assetKey(asset: AuditAsset): string {
  return asset.type === 'native'
    ? 'native'
    : `${asset.type}:${asset.code}:${asset.issuer}`;
}

export function buildAuditRecord(
  payments: readonly VerifiedPayment[],
  selection: AuditSelection,
  expectedTxHashes: readonly string[],
): SdpAuditRecord {
  if (payments.length === 0) {
    throw new Error('The batch contains no supported successful payment operations');
  }
  // Rebuild the selection from its allowlisted schema so runtime callers cannot
  // accidentally anchor extra fields (especially recipient metadata or PII).
  const normalizedSelection = parseSelection(selection);

  const txHashes = expectedTxHashes.map(normalizeTxHash).sort();
  if (new Set(txHashes).size !== txHashes.length) {
    throw new Error('Duplicate transaction hashes are not allowed');
  }

  const paymentsByTransaction = new Set(payments.map((payment) => payment.txHash));
  for (const hash of txHashes) {
    if (!paymentsByTransaction.has(hash)) {
      throw new Error(`Transaction ${hash} has no payment in the selected batch`);
    }
  }
  for (const payment of payments) {
    if (!txHashes.includes(payment.txHash)) {
      throw new Error(`Payment references unexpected transaction ${payment.txHash}`);
    }
    if (payment.amountStroops <= 0n) {
      throw new Error(`Payment ${payment.operationId} has a non-positive amount`);
    }
  }
  const operationKeys = payments.map((payment) => {
    return `${payment.txHash}:${payment.operationId}`;
  });
  if (new Set(operationKeys).size !== operationKeys.length) {
    throw new Error('The batch contains duplicate payment operation evidence');
  }

  const firstAsset = payments[0]?.asset;
  if (!firstAsset) {
    throw new Error('The batch contains no payments');
  }
  const normalizedAsset = parseAsset(firstAsset);
  const expectedAssetKey = assetKey(normalizedAsset);
  if (payments.some((payment) => assetKey(parseAsset(payment.asset)) !== expectedAssetKey)) {
    throw new Error('A single audit record cannot aggregate multiple Stellar assets');
  }

  const totalStroops = payments.reduce(
    (total, payment) => total + payment.amountStroops,
    0n,
  );
  const recipientCount = new Set(payments.map((payment) => payment.to)).size;

  return {
    schema: AUDIT_SCHEMA,
    network: AUDIT_NETWORK,
    selection: normalizedSelection,
    recipientCount,
    totalAmount: formatStroops(totalStroops),
    asset: normalizedAsset,
    txHashes,
  };
}

export function serializeAuditRecord(record: SdpAuditRecord): string {
  return JSON.stringify(record);
}

export function auditRecordByteLength(record: SdpAuditRecord): number {
  return Buffer.byteLength(serializeAuditRecord(record), 'utf8');
}

export function assertAuditRecordSize(record: SdpAuditRecord): void {
  const byteLength = auditRecordByteLength(record);
  if (byteLength > MAX_AUDIT_RECORD_BYTES) {
    throw new Error(
      `Audit record is ${byteLength} bytes; Nirium accepts at most ${MAX_AUDIT_RECORD_BYTES} bytes. Narrow or split the batch manually.`,
    );
  }
}

export function hashAuditRecord(record: object): string {
  return createHash('sha256').update(JSON.stringify(record), 'utf8').digest('hex');
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  name: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${name} contains unsupported field(s): ${unexpected.join(', ')}`);
  }
}

function parseAsset(value: unknown): AuditAsset {
  const asset = requireObject(value, 'record.asset');
  if (asset.type === 'native') {
    requireExactKeys(asset, ['type'], 'record.asset');
    return { type: 'native' };
  }
  if (asset.type !== 'credit_alphanum4' && asset.type !== 'credit_alphanum12') {
    throw new Error('record.asset.type is not supported');
  }
  requireExactKeys(asset, ['type', 'code', 'issuer'], 'record.asset');
  const maxCodeLength = asset.type === 'credit_alphanum4' ? 4 : 12;
  if (
    typeof asset.code !== 'string'
    || !/^[A-Za-z0-9]+$/.test(asset.code)
    || asset.code.length > maxCodeLength
  ) {
    throw new Error('record.asset.code is invalid');
  }
  if (
    typeof asset.issuer !== 'string'
    || !G_ADDRESS_PATTERN.test(asset.issuer)
    || !StrKey.isValidEd25519PublicKey(asset.issuer)
  ) {
    throw new Error('record.asset.issuer is invalid');
  }
  return { type: asset.type, code: asset.code, issuer: asset.issuer };
}

function parseSelection(value: unknown): AuditSelection {
  const selection = requireObject(value, 'record.selection');
  if (selection.type === 'tx_hashes') {
    requireExactKeys(selection, ['type'], 'record.selection');
    return { type: 'tx_hashes' };
  }
  if (selection.type !== 'source_time_window') {
    throw new Error('record.selection.type is not supported');
  }
  requireExactKeys(
    selection,
    ['type', 'sourceAccount', 'from', 'to'],
    'record.selection',
  );
  if (
    typeof selection.sourceAccount !== 'string'
    || typeof selection.from !== 'string'
    || typeof selection.to !== 'string'
  ) {
    throw new Error('record.selection source window is invalid');
  }
  const normalized = normalizeDescriptor({
    sourceAccount: selection.sourceAccount,
    from: selection.from,
    to: selection.to,
  });
  if (normalized.selection.type !== 'source_time_window') {
    throw new Error('record.selection source window is invalid');
  }
  if (
    normalized.selection.from !== selection.from
    || normalized.selection.to !== selection.to
  ) {
    throw new Error('record.selection timestamps must be canonical UTC ISO-8601 values');
  }
  return normalized.selection;
}

export function parseAuditRecord(value: unknown): SdpAuditRecord {
  const record = requireObject(value, 'record');
  requireExactKeys(
    record,
    ['schema', 'network', 'selection', 'recipientCount', 'totalAmount', 'asset', 'txHashes'],
    'record',
  );
  if (record.schema !== AUDIT_SCHEMA) {
    throw new Error(`Unsupported audit schema: ${String(record.schema)}`);
  }
  if (record.network !== AUDIT_NETWORK) {
    throw new Error('Only Stellar Testnet audit records are supported');
  }
  if (!Number.isSafeInteger(record.recipientCount) || Number(record.recipientCount) < 1) {
    throw new Error('record.recipientCount must be a positive safe integer');
  }
  if (typeof record.totalAmount !== 'string') {
    throw new Error('record.totalAmount must be a string');
  }
  const totalStroops = parseStroops(record.totalAmount);
  if (totalStroops <= 0n || formatStroops(totalStroops) !== record.totalAmount) {
    throw new Error('record.totalAmount must be a positive canonical 7-decimal amount');
  }
  if (!Array.isArray(record.txHashes) || record.txHashes.length === 0) {
    throw new Error('record.txHashes must be a non-empty array');
  }
  const txHashes = record.txHashes.map((hash) => {
    if (typeof hash !== 'string') {
      throw new Error('record.txHashes entries must be strings');
    }
    const normalized = normalizeTxHash(hash);
    if (normalized !== hash) {
      throw new Error('record.txHashes must use lowercase hexadecimal');
    }
    return normalized;
  });
  if (new Set(txHashes).size !== txHashes.length) {
    throw new Error('record.txHashes contains duplicates');
  }
  const sortedHashes = [...txHashes].sort();
  if (sortedHashes.some((hash, index) => hash !== txHashes[index])) {
    throw new Error('record.txHashes must be sorted');
  }

  return {
    schema: AUDIT_SCHEMA,
    network: AUDIT_NETWORK,
    selection: parseSelection(record.selection),
    recipientCount: Number(record.recipientCount),
    totalAmount: record.totalAmount,
    asset: parseAsset(record.asset),
    txHashes,
  };
}
