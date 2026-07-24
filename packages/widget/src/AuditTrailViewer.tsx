import * as React from 'react'
import type { AuditReceipt, AuditTrailViewerProps } from './types'
import { fetchAuditInfo } from './fetchAuditInfo'
import {
  formatAnchoredAt,
  ipfsGatewayUrl,
  stellarExpertUrl,
  truncateCid,
  truncateHash,
} from './format'

type Status = 'idle' | 'loading' | 'success' | 'empty' | 'error'

/**
 * Standalone React widget that displays Nirium anchored audit-trail receipts.
 *
 * Embedded via:
 *
 *     import { AuditTrailViewer } from '@nirium-protocol/audit-trail-viewer'
 *     import 'nirium-widget/styles.css'   // optional utility classes
 *     <AuditTrailViewer appId="<your-app-id>" />
 *
 * The widget intentionally has **zero** runtime dependencies outside of
 * React + react-dom (declared as peerDependencies). Tailwind-friendly class
 * hooks (`className` on root) make host-app styling trivial.
 */
export function AuditTrailViewer(props: AuditTrailViewerProps): React.ReactElement {
  const {
    appId,
    fetcher,
    baseUrl,
    className,
    title = 'Anchored Audit Trail',
    emptyText = 'No receipts anchored yet for this app.',
    onReceiptClick,
    renderExternalLink,
  } = props

  const [status, setStatus] = React.useState<Status>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [receipts, setReceipts] = React.useState<AuditReceipt[]>([])

  React.useEffect(() => {
    if (!appId) {
      setStatus('error')
      setError('AuditTrailViewer: appId is required')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    fetchAuditInfo(appId, { fetcher, baseUrl, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setReceipts(res.receipts)
        setStatus(res.receipts.length === 0 ? 'empty' : 'success')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [appId, fetcher, baseUrl])

  return (
    <section
      data-testid="audit-trail-viewer"
      data-status={status}
      aria-busy={status === 'loading'}
      className={[
        'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm',
        'text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold leading-none">{title}</h2>
        <span
          className={
            'rounded-full px-2 py-0.5 text-xs font-medium ' +
            (status === 'success'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : status === 'loading'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : status === 'empty'
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  : status === 'error'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')
          }
        >
          {status === 'idle' && 'idle'}
          {status === 'loading' && 'loading…'}
          {status === 'success' && `${receipts.length} receipts`}
          {status === 'empty' && 'empty'}
          {status === 'error' && 'error'}
        </span>
      </header>

      {status === 'loading' && <SkeletonList />}
      {status === 'empty' && <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>}
      {status === 'error' && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          <strong className="font-semibold">Failed to load receipts:</strong> {error}
        </div>
      )}
      {status === 'success' && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {receipts.map((r) => (
            <ReceiptRow
              key={`${r.resourceId}:${r.stellarTxHash}:${r.ipfsCid}`}
              receipt={r}
              onClick={onReceiptClick}
              renderExternalLink={renderExternalLink}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ReceiptRow({
  receipt,
  onClick,
  renderExternalLink,
}: {
  receipt: AuditReceipt
  onClick?: (r: AuditReceipt) => void
  renderExternalLink?: (r: AuditReceipt) => React.ReactNode
}): React.ReactElement {
  const interactive = typeof onClick === 'function'
  return (
    <li
      className={
        'group flex flex-col gap-1 py-3 ' +
        (interactive ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : '')
      }
      onClick={interactive ? () => onClick!(receipt) : undefined}
      data-testid="audit-receipt-row"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
          resource: {receipt.resourceId}
        </span>
        <time
          dateTime={receipt.anchoredAt}
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          {formatAnchoredAt(receipt.anchoredAt)}
        </time>
      </div>

      <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <Row label="IPFS CID">
          <a
            href={receipt.ipfsUrl ?? ipfsGatewayUrl(receipt.ipfsCid)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
            title={receipt.ipfsCid}
            data-testid="audit-ipfs-link"
          >
            {truncateCid(receipt.ipfsCid)}
          </a>
        </Row>
        <Row label="Stellar tx">
          <a
            href={stellarExpertUrl('mainnet', receipt.stellarTxHash)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
            title={receipt.stellarTxHash}
            data-testid="audit-stellar-link"
          >
            {truncateHash(receipt.stellarTxHash)}
          </a>
        </Row>
      </div>

      {receipt.memo && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold">memo:</span> {receipt.memo}
        </p>
      )}

      {renderExternalLink && (
        <div className="pt-1">{renderExternalLink(receipt)}</div>
      )}
    </li>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="truncate">{children}</span>
    </div>
  )
}

function SkeletonList(): React.ReactElement {
  return (
    <ul className="animate-pulse space-y-3">
      {[0, 1, 2].map((i) => (
        <li key={i} className="h-12 rounded-md bg-slate-100 dark:bg-slate-800" />
      ))}
    </ul>
  )
}
