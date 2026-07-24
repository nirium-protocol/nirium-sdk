import type { ComponentType, ReactNode } from 'react';

export type StellarNetwork = 'public' | 'testnet' | 'futurenet';

export interface AuditReceipt {
  id: string;
  appId?: string;
  cid?: string;
  transactionHash?: string;
  stellarExpertUrl?: string;
  timestamp?: string;
  status?: string;
  raw: Record<string, unknown>;
}

export interface AuditTrailViewerProps {
  /** Application identifier passed to GET /api/audit/info as app_id. */
  app_id: string;
  /** Optional origin for the audit API. Defaults to the current origin. */
  apiBaseUrl?: string;
  /** IPFS gateway used to turn CIDs into links. */
  ipfsGateway?: string;
  /** Stellar Expert network used when only a transaction hash is returned. */
  stellarNetwork?: StellarNetwork;
  /** Optional fetch implementation for non-browser runtimes or custom auth. */
  fetcher?: typeof fetch;
  /** Additional classes for the widget root. */
  className?: string;
  /** Replaces the built-in loading state. */
  loadingFallback?: ReactNode;
  /** Replaces the built-in empty state. */
  emptyFallback?: ReactNode;
  /** Replaces the built-in error state. */
  errorFallback?: ComponentType<{ error: Error }>;
  /** Receives the normalized receipts after each successful request. */
  onLoad?: (receipts: AuditReceipt[]) => void;
}
