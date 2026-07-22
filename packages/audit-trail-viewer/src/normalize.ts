import type { AuditReceipt } from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(record: UnknownRecord, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, key) => {
      return isRecord(current) ? current[key] : undefined;
    }, record);

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function receiptArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const directKeys = ['receipts', 'items', 'results', 'anchors', 'audit_trail'];
  for (const key of directKeys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }

  if (isRecord(payload.data)) {
    for (const key of directKeys) {
      if (Array.isArray(payload.data[key])) return payload.data[key] as unknown[];
    }
  }

  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export function normalizeAuditReceipts(payload: unknown): AuditReceipt[] {
  return receiptArray(payload).filter(isRecord).map((receipt, index) => {
    const cid = stringAt(receipt, 'cid', 'ipfs_cid', 'ipfsCid', 'ipfs.cid', 'anchor.cid');
    const transactionHash = stringAt(
      receipt,
      'transaction_hash',
      'transactionHash',
      'tx_hash',
      'txHash',
      'stellar_tx_hash',
      'stellarTxHash',
      'stellar.hash',
    );

    return {
      id: stringAt(receipt, 'id', 'receipt_id', 'receiptId') ?? cid ?? transactionHash ?? `receipt-${index + 1}`,
      appId: stringAt(receipt, 'app_id', 'appId'),
      cid,
      transactionHash,
      stellarExpertUrl: stringAt(receipt, 'stellar_expert_url', 'stellarExpertUrl', 'links.stellar_expert'),
      timestamp: stringAt(receipt, 'anchored_at', 'anchoredAt', 'created_at', 'createdAt', 'timestamp'),
      status: stringAt(receipt, 'status', 'anchor_status', 'anchorStatus'),
      raw: receipt,
    };
  });
}
