import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeAuditReceipts } from './normalize';
import type { AuditReceipt, AuditTrailViewerProps } from './types';

const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function externalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function shorten(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function ReceiptCard({
  receipt,
  ipfsGateway,
  stellarNetwork,
}: {
  receipt: AuditReceipt;
  ipfsGateway: string;
  stellarNetwork: AuditTrailViewerProps['stellarNetwork'];
}) {
  const ipfsUrl = receipt.cid
    ? `${trimTrailingSlash(ipfsGateway)}/${encodeURIComponent(receipt.cid)}`
    : undefined;
  const stellarUrl = externalUrl(receipt.stellarExpertUrl) ?? (receipt.transactionHash
    ? `https://stellar.expert/explorer/${stellarNetwork}/tx/${encodeURIComponent(receipt.transactionHash)}`
    : undefined);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Receipt</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{receipt.id}</p>
        </div>
        {receipt.status ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300">
            {receipt.status}
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {receipt.cid ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">IPFS CID</dt>
            <dd className="mt-1">
              <a
                className="font-mono text-sm text-indigo-600 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                href={ipfsUrl}
                target="_blank"
                rel="noreferrer"
                title={receipt.cid}
              >
                {shorten(receipt.cid)}
              </a>
            </dd>
          </div>
        ) : null}

        {stellarUrl ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Stellar transaction</dt>
            <dd className="mt-1">
              <a
                className="font-mono text-sm text-indigo-600 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                href={stellarUrl}
                target="_blank"
                rel="noreferrer"
                title={receipt.transactionHash ?? 'View on Stellar Expert'}
              >
                {receipt.transactionHash ? shorten(receipt.transactionHash) : 'View on Stellar Expert'}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      {receipt.timestamp ? (
        <time className="mt-4 block text-xs text-slate-500 dark:text-slate-400" dateTime={receipt.timestamp}>
          {formatTimestamp(receipt.timestamp)}
        </time>
      ) : null}
    </li>
  );
}

export function AuditTrailViewer({
  app_id,
  apiBaseUrl = '',
  ipfsGateway = DEFAULT_IPFS_GATEWAY,
  stellarNetwork = 'public',
  fetcher = globalThis.fetch,
  className,
  loadingFallback,
  emptyFallback,
  errorFallback: ErrorFallback,
  onLoad,
}: AuditTrailViewerProps) {
  const [receipts, setReceipts] = useState<AuditReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const requestUrl = useMemo(() => {
    const base = trimTrailingSlash(apiBaseUrl);
    return `${base}/api/audit/info?app_id=${encodeURIComponent(app_id)}`;
  }, [apiBaseUrl, app_id]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReceipts() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetcher(requestUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Unable to load audit receipts (${response.status})`);
        }

        const normalized = normalizeAuditReceipts(await response.json());
        if (!controller.signal.aborted) {
          setReceipts(normalized);
          onLoadRef.current?.(normalized);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setReceipts([]);
          setError(caught instanceof Error ? caught : new Error('Unable to load audit receipts'));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadReceipts();
    return () => controller.abort();
  }, [fetcher, requestUrl]);

  return (
    <section
      className={joinClassNames('rounded-2xl bg-slate-50 p-5 text-slate-900 dark:bg-slate-950 dark:text-slate-100', className)}
      aria-busy={loading}
      aria-live="polite"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Audit trail</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Anchored receipts for <span className="font-mono">{app_id}</span>
        </p>
      </div>

      {loading ? (loadingFallback ?? <p className="text-sm text-slate-500">Loading audit receipts…</p>) : null}
      {!loading && error ? (
        ErrorFallback ? <ErrorFallback error={error} /> : (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300" role="alert">
            {error.message}
          </div>
        )
      ) : null}
      {!loading && !error && receipts.length === 0 ? (
        emptyFallback ?? <p className="text-sm text-slate-500">No anchored receipts found.</p>
      ) : null}
      {!loading && !error && receipts.length > 0 ? (
        <ul className="grid gap-3" aria-label="Audit receipts">
          {receipts.map((receipt, index) => (
            <ReceiptCard
              key={`${receipt.id}-${index}`}
              receipt={receipt}
              ipfsGateway={ipfsGateway}
              stellarNetwork={stellarNetwork}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
