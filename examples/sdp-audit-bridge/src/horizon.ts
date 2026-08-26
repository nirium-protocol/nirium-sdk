import {
  Networks,
  StrKey,
  encodeMuxedAccount,
  encodeMuxedAccountToAddress,
} from '@stellar/stellar-sdk';
import { fetchJson } from './http.js';
import {
  type AuditAsset,
  type AuditSelection,
  type BatchDescriptor,
  type SourceWindowSelection,
  type VerifiedPayment,
  MAX_BATCH_TX_HASHES,
  normalizeDescriptor,
  normalizeTimestamp,
  normalizeTxHash,
  parseStroops,
} from './record.js';

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const HORIZON_PAGE_LIMIT = 200;
const HORIZON_RESPONSE_LIMIT = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;

type JsonObject = Record<string, unknown>;

export interface HorizonReaderOptions {
  horizonUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  concurrency?: number;
  maxPages?: number;
  sleepFn?: (milliseconds: number) => Promise<void>;
}

export interface ResolvedBatch {
  selection: AuditSelection;
  txHashes: string[];
  payments: VerifiedPayment[];
}

function asObject(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} is not a JSON object`);
  }
  return value as JsonObject;
}

function requiredString(object: JsonObject, key: string, name: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name}.${key} must be a non-empty string`);
  }
  return value;
}

function parseAsset(
  object: JsonObject,
  name: string,
): AuditAsset {
  const type = requiredString(object, 'asset_type', name);
  if (type === 'native') {
    return { type: 'native' };
  }
  if (type !== 'credit_alphanum4' && type !== 'credit_alphanum12') {
    throw new Error(`${name}.asset_type ${type} is not supported`);
  }
  const code = requiredString(object, 'asset_code', name);
  const issuer = requiredString(object, 'asset_issuer', name);
  const maxCodeLength = type === 'credit_alphanum4' ? 4 : 12;
  if (!/^[A-Za-z0-9]+$/.test(code) || code.length > maxCodeLength) {
    throw new Error(`${name}.asset_code is invalid`);
  }
  if (!/^G[A-Z2-7]{55}$/.test(issuer)) {
    throw new Error(`${name}.asset_issuer is invalid`);
  }
  return { type, code, issuer };
}

function paymentDestination(values: JsonObject, valueName: string): string {
  const to = requiredString(values, 'to', valueName);
  const muxedId = (value: unknown, fieldName: string): string => {
    if (
      typeof value !== 'string'
      || !/^(0|[1-9]\d*)$/.test(value)
      || BigInt(value) > 18_446_744_073_709_551_615n
    ) {
      throw new Error(`${fieldName} must be a uint64 string`);
    }
    return value;
  };
  const encodeDestination = (id: string): string => {
    try {
      return encodeMuxedAccountToAddress(encodeMuxedAccount(to, id), true);
    } catch {
      throw new Error(`${valueName} has an invalid muxed destination`);
    }
  };

  if (values.to_muxed !== undefined) {
    if (
      typeof values.to_muxed !== 'string'
      || !StrKey.isValidMed25519PublicKey(values.to_muxed)
    ) {
      throw new Error(`${valueName}.to_muxed is not a valid Stellar muxed account`);
    }
    const expected = encodeDestination(
      muxedId(values.to_muxed_id, `${valueName}.to_muxed_id`),
    );
    if (values.to_muxed !== expected) {
      throw new Error(`${valueName} has contradictory muxed destination fields`);
    }
    return expected;
  }

  if (values.destination_muxed_id === undefined) {
    return to;
  }
  // Horizon exposes a SAC transfer's underlying G address and muxed ID as
  // separate fields. Encode the canonical M address so classic and SAC
  // representations of the same recipient are counted once.
  return encodeDestination(
    muxedId(values.destination_muxed_id, `${valueName}.destination_muxed_id`),
  );
}

function parseCommonPayment(
  operation: JsonObject,
  values: JsonObject,
  valueName: string,
  operationId = requiredString(operation, 'id', 'operation'),
): VerifiedPayment {
  const txHash = normalizeTxHash(requiredString(operation, 'transaction_hash', 'operation'));
  const from = requiredString(values, 'from', valueName);
  const to = paymentDestination(values, valueName);
  const amount = requiredString(values, 'amount', valueName);
  const amountStroops = parseStroops(amount);
  if (amountStroops <= 0n) {
    throw new Error(`${valueName}.amount must be positive`);
  }
  return {
    txHash,
    operationId,
    from,
    to,
    amountStroops,
    asset: parseAsset(values, valueName),
    createdAt: normalizeTimestamp(
      requiredString(operation, 'created_at', 'operation'),
      'operation.created_at',
    ),
  };
}

export function normalizePaymentOperation(value: unknown): VerifiedPayment[] {
  const operation = asObject(value, 'operation');
  if (operation.transaction_successful !== true) {
    throw new Error(`Operation ${String(operation.id)} is not part of a successful transaction`);
  }
  const type = requiredString(operation, 'type', 'operation');

  if (type === 'payment') {
    return [parseCommonPayment(operation, operation, 'operation')];
  }

  if (type === 'invoke_host_function') {
    const rawChanges = operation.asset_balance_changes;
    if (rawChanges === undefined || (Array.isArray(rawChanges) && rawChanges.length === 0)) {
      return [];
    }
    if (!Array.isArray(rawChanges)) {
      throw new Error(`Operation ${String(operation.id)} has malformed asset_balance_changes`);
    }
    const operationId = requiredString(operation, 'id', 'operation');
    return rawChanges.flatMap((rawChange, index) => {
      const valueName = `operation.asset_balance_changes[${index}]`;
      const change = asObject(rawChange, valueName);
      if (change.type !== 'transfer') {
        return [];
      }
      return [parseCommonPayment(
        operation,
        change,
        valueName,
        `${operationId}:balance-change:${index}`,
      )];
    });
  }

  if (type === 'path_payment_strict_receive' || type === 'path_payment_strict_send') {
    throw new Error(`Operation ${String(operation.id)} uses unsupported payment type ${type}`);
  }

  return [];
}

function parsePage(value: unknown): { records: unknown[]; nextUrl: string } {
  const page = asObject(value, 'Horizon page');
  const embedded = asObject(page._embedded, 'Horizon page._embedded');
  if (!Array.isArray(embedded.records)) {
    throw new Error('Horizon page._embedded.records must be an array');
  }
  const links = asObject(page._links, 'Horizon page._links');
  const next = asObject(links.next, 'Horizon page._links.next');
  return {
    records: embedded.records,
    nextUrl: requiredString(next, 'href', 'Horizon page._links.next'),
  };
}

function isSourceWindow(selection: AuditSelection): selection is SourceWindowSelection {
  return selection.type === 'source_time_window';
}

function paymentIsSelected(
  payment: VerifiedPayment,
  selection: AuditSelection,
): boolean {
  if (!isSourceWindow(selection)) {
    return true;
  }
  const createdAt = Date.parse(payment.createdAt);
  return payment.from === selection.sourceAccount
    && createdAt >= Date.parse(selection.from)
    && createdAt < Date.parse(selection.to);
}

function isPotentialOutboundOperation(value: unknown, sourceAccount: string): boolean {
  const operation = asObject(value, 'operation');
  if (operation.type === 'payment') {
    return operation.from === sourceAccount;
  }
  if (
    operation.type === 'path_payment_strict_receive'
    || operation.type === 'path_payment_strict_send'
  ) {
    return operation.source_account === sourceAccount || operation.from === sourceAccount;
  }
  if (operation.type !== 'invoke_host_function') {
    return false;
  }
  return Array.isArray(operation.asset_balance_changes)
    && operation.asset_balance_changes.some((change) => {
      return typeof change === 'object'
        && change !== null
        && !Array.isArray(change)
        && (change as JsonObject).from === sourceAccount;
    });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async (): Promise<void> => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const currentValue = values[currentIndex];
        if (currentValue === undefined) {
          throw new Error('Internal concurrency index error');
        }
        results[currentIndex] = await mapper(currentValue);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export class HorizonReader {
  readonly baseUrl: URL;
  private readonly options: HorizonReaderOptions;
  private readonly concurrency: number;
  private readonly maxPages: number;

  constructor(options: HorizonReaderOptions = {}) {
    this.baseUrl = new URL(options.horizonUrl ?? DEFAULT_HORIZON_URL);
    if (this.baseUrl.protocol !== 'https:' && this.baseUrl.protocol !== 'http:') {
      throw new Error('Horizon URL must use http or https');
    }
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/$/, '');
    this.options = options;
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16) {
      throw new Error('Horizon concurrency must be an integer between 1 and 16');
    }
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > 1_000) {
      throw new Error('Horizon maxPages must be an integer between 1 and 1000');
    }
  }

  private async getJson(url: URL, maxBytes = HORIZON_RESPONSE_LIMIT): Promise<unknown> {
    return fetchJson(url, {
      maxBytes,
      ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.maxRetries !== undefined
        ? { maxRetries: this.options.maxRetries }
        : {}),
      ...(this.options.sleepFn ? { sleepFn: this.options.sleepFn } : {}),
    });
  }

  private endpoint(path: string): URL {
    return new URL(path, `${this.baseUrl.toString().replace(/\/$/, '')}/`);
  }

  private assertPaginationUrl(url: URL): void {
    if (url.origin !== this.baseUrl.origin) {
      throw new Error('Horizon pagination attempted to leave the configured origin');
    }
  }

  async assertTestnet(): Promise<void> {
    const root = asObject(await this.getJson(this.baseUrl, 64 * 1024), 'Horizon root');
    if (root.network_passphrase !== Networks.TESTNET) {
      throw new Error('Configured Horizon server is not connected to Stellar Testnet');
    }
  }

  private async transactionPayments(txHash: string): Promise<unknown[]> {
    let url = this.endpoint(
      `transactions/${encodeURIComponent(txHash)}/payments?order=asc&limit=${HORIZON_PAGE_LIMIT}&include_failed=false`,
    );
    const records: unknown[] = [];
    const visited = new Set<string>();
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      if (pageCount > this.maxPages) {
        throw new Error(
          `Horizon transaction pagination exceeded ${this.maxPages} pages`,
        );
      }
      this.assertPaginationUrl(url);
      if (visited.has(url.toString())) {
        throw new Error('Horizon returned a pagination loop');
      }
      visited.add(url.toString());
      const page = parsePage(await this.getJson(url));
      const nextUrl = new URL(page.nextUrl);
      this.assertPaginationUrl(nextUrl);
      if (page.records.length > HORIZON_PAGE_LIMIT) {
        throw new Error(`Horizon page exceeds the requested ${HORIZON_PAGE_LIMIT}-record limit`);
      }
      records.push(...page.records);
      if (page.records.length < HORIZON_PAGE_LIMIT) {
        break;
      }
      url = nextUrl;
    }
    return records;
  }

  private async resolveTransaction(
    txHash: string,
    selection: AuditSelection,
  ): Promise<VerifiedPayment[]> {
    const transactionUrl = this.endpoint(`transactions/${encodeURIComponent(txHash)}`);
    const transaction = asObject(await this.getJson(transactionUrl, 512 * 1024), 'transaction');
    const returnedHash = normalizeTxHash(requiredString(transaction, 'hash', 'transaction'));
    if (returnedHash !== txHash) {
      throw new Error(`Horizon returned transaction ${returnedHash} for requested hash ${txHash}`);
    }
    if (transaction.successful !== true) {
      throw new Error(`Transaction ${txHash} was not successful on-chain`);
    }

    const paymentRecords = await this.transactionPayments(txHash);
    const payments = paymentRecords.flatMap((rawRecord, index) => {
      const paymentRecord = asObject(rawRecord, `transaction payment[${index}]`);
      const recordTxHash = normalizeTxHash(
        requiredString(paymentRecord, 'transaction_hash', `transaction payment[${index}]`),
      );
      if (recordTxHash !== txHash) {
        throw new Error(
          `Horizon returned payment evidence for transaction ${recordTxHash} while resolving ${txHash}`,
        );
      }
      return normalizePaymentOperation(paymentRecord);
    });
    const selectedPayments = payments.filter((payment) => paymentIsSelected(payment, selection));
    if (selectedPayments.length === 0) {
      throw new Error(`Transaction ${txHash} has no supported payment in the selected batch`);
    }
    return selectedPayments;
  }

  private async discoverSourceWindow(selection: SourceWindowSelection): Promise<string[]> {
    let url = this.endpoint(
      `accounts/${encodeURIComponent(selection.sourceAccount)}/payments?order=desc&limit=${HORIZON_PAGE_LIMIT}&include_failed=false`,
    );
    const txHashes = new Set<string>();
    const visited = new Set<string>();
    let pageCount = 0;
    const fromTime = Date.parse(selection.from);
    const toTime = Date.parse(selection.to);
    let previousCreatedAt = Number.POSITIVE_INFINITY;

    while (true) {
      pageCount += 1;
      if (pageCount > this.maxPages) {
        throw new Error(
          `Horizon source-window pagination exceeded ${this.maxPages} pages; narrow the time window`,
        );
      }
      this.assertPaginationUrl(url);
      if (visited.has(url.toString())) {
        throw new Error('Horizon returned a pagination loop');
      }
      visited.add(url.toString());
      const page = parsePage(await this.getJson(url));
      const nextUrl = new URL(page.nextUrl);
      this.assertPaginationUrl(nextUrl);
      if (page.records.length > HORIZON_PAGE_LIMIT) {
        throw new Error(`Horizon page exceeds the requested ${HORIZON_PAGE_LIMIT}-record limit`);
      }
      if (page.records.length === 0) {
        break;
      }

      let reachedBeforeWindow = false;
      for (const rawOperation of page.records) {
        const operation = asObject(rawOperation, 'operation');
        const createdAt = Date.parse(
          normalizeTimestamp(requiredString(operation, 'created_at', 'operation'), 'operation.created_at'),
        );
        if (createdAt > previousCreatedAt) {
          throw new Error('Horizon source-window payments are not in descending time order');
        }
        previousCreatedAt = createdAt;
        if (createdAt < fromTime) {
          reachedBeforeWindow = true;
          continue;
        }
        if (createdAt >= toTime || !isPotentialOutboundOperation(operation, selection.sourceAccount)) {
          continue;
        }
        const payments = normalizePaymentOperation(operation).filter((payment) => {
          return paymentIsSelected(payment, selection);
        });
        for (const payment of payments) {
          txHashes.add(payment.txHash);
          if (txHashes.size > MAX_BATCH_TX_HASHES) {
            throw new Error(
              `Source time window contains more than ${MAX_BATCH_TX_HASHES} transactions; narrow the time window`,
            );
          }
        }
      }
      if (reachedBeforeWindow) {
        break;
      }
      if (page.records.length < HORIZON_PAGE_LIMIT) {
        break;
      }
      url = nextUrl;
    }

    const sortedHashes = [...txHashes].sort();
    if (sortedHashes.length === 0) {
      throw new Error('No supported outgoing payments were found in the source time window');
    }
    return sortedHashes;
  }

  async resolveBatch(descriptor: BatchDescriptor): Promise<ResolvedBatch> {
    const normalized = normalizeDescriptor(descriptor);
    await this.assertTestnet();

    const txHashes = 'txHashes' in normalized.descriptor
      ? normalized.descriptor.txHashes
      : await this.discoverSourceWindow(normalized.selection as SourceWindowSelection);

    const paymentGroups = await mapWithConcurrency(
      txHashes,
      this.concurrency,
      async (txHash) => this.resolveTransaction(txHash, normalized.selection),
    );
    return {
      selection: normalized.selection,
      txHashes,
      payments: paymentGroups.flat(),
    };
  }

  async resolveCitedTransactions(
    citedTxHashes: readonly string[],
    selection: AuditSelection,
  ): Promise<ResolvedBatch> {
    const txHashes = citedTxHashes.map(normalizeTxHash);
    if (txHashes.length === 0 || new Set(txHashes).size !== txHashes.length) {
      throw new Error('Cited transaction hashes must be non-empty and unique');
    }
    if (txHashes.length > MAX_BATCH_TX_HASHES) {
      throw new Error(
        `At most ${MAX_BATCH_TX_HASHES} cited transaction hashes can fit in one audit record`,
      );
    }
    txHashes.sort();
    await this.assertTestnet();
    const paymentGroups = await mapWithConcurrency(
      txHashes,
      this.concurrency,
      async (txHash) => this.resolveTransaction(txHash, selection),
    );
    return {
      selection,
      txHashes,
      payments: paymentGroups.flat(),
    };
  }
}
