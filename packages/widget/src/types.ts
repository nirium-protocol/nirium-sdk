/**
 * Public prop / response types for the @nirium-protocol/audit-trail-viewer widget.
 *
 * Kept dependency-free so the bundle can be embedded into any third-party
 * React Web3 dashboard without pulling in the full nirium SDK.
 */

/** A single anchored receipt as returned by `GET /api/audit/info`. */
export interface AuditReceipt {
  /** IPFS CID (Content Identifier) for the anchored receipt body. */
  ipfsCid: string
  /** Optional IPFS gateway URL override; defaults to `https://ipfs.io/ipfs/<cid>`. */
  ipfsUrl?: string
  /** Stellar transaction hash anchoring the receipt. */
  stellarTxHash: string
  /** Optional human-readable memo for the receipt. */
  memo?: string
  /** ISO-8601 timestamp of when the receipt was anchored. */
  anchoredAt: string
  /** Stable identifier for the resource the receipt describes (route, doc, etc.). */
  resourceId: string
  /** Optional on-chain reference (e.g. Soroban contract event id). */
  onChainRef?: string
}

/** Response shape returned by `GET /api/audit/info`. */
export interface AuditInfoResponse {
  appId: string
  receipts: AuditReceipt[]
  /** Optional pagination cursor — token the caller passes to `fetchAuditInfo`. */
  nextCursor?: string
}

/** Props for the AuditTrailViewer React widget. */
export interface AuditTrailViewerProps {
  /** Nirium app id — required. */
  appId: string
  /** Optional explicit fetch override (defaults to global fetch). */
  fetcher?: typeof fetch
  /** API base URL — defaults to `https://nirium-agent.fly.dev`. */
  baseUrl?: string
  /** Tailwind class overrides for the outer container. */
  className?: string
  /** Title text shown in the widget header. */
  title?: string
  /** Empty-state copy when no receipts are returned. */
  emptyText?: string
  /** Optional callback when the user clicks a receipt row. */
  onReceiptClick?: (receipt: AuditReceipt) => void
  /** Optional CTA render slot (e.g. "Verify on Stellar Expert" link). */
  renderExternalLink?: (receipt: AuditReceipt) => React.ReactNode
}
