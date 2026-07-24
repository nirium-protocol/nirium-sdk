import React, { useEffect, useState } from 'react';

export interface AuditInfo {
  appId: string;
  cid?: string;          // IPFS CID of the anchored receipt
  txHash?: string;       // Stellar transaction hash
  anchoredAt?: string;   // ISO timestamp
  status?: string;
}

export interface AuditTrailViewerProps {
  appId: string;
  /** Override the info endpoint. Defaults to /api/audit/info?app_id=. */
  endpoint?: string;
  /** Stellar Expert base URL for tx links. */
  stellarExpertBase?: string;
  /** IPFS gateway base URL. */
  ipfsGateway?: string;
}

function defaultEndpoint(appId: string, base?: string) {
  return `${base || '/api/audit/info'}?app_id=${encodeURIComponent(appId)}`;
}

export function AuditTrailViewer({
  appId,
  endpoint,
  stellarExpertBase = 'https://stellar.expert/explorer/testnet/tx',
  ipfsGateway = 'https://ipfs.io/ipfs',
}: AuditTrailViewerProps) {
  const [info, setInfo] = useState<AuditInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(defaultEndpoint(appId, endpoint))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: AuditInfo) => {
        if (!cancelled) {
          setInfo(data);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, endpoint]);

  if (loading) {
    return <div className="nirium-audit nirium-audit--loading">Loading audit trail…</div>;
  }
  if (error) {
    return <div className="nirium-audit nirium-audit--error">Audit trail unavailable: {error}</div>;
  }
  if (!info) {
    return <div className="nirium-audit nirium-audit--empty">No audit records.</div>;
  }

  return (
    <div className="nirium-audit" data-app-id={appId}>
      <h4 className="nirium-audit__title">Audit Trail</h4>
      <dl className="nirium-audit__list">
        <div className="nirium-audit__row">
          <dt>App</dt>
          <dd>{info.appId}</dd>
        </div>
        {info.cid && (
          <div className="nirium-audit__row">
            <dt>IPFS CID</dt>
            <dd>
              <a href={`${ipfsGateway}/${info.cid}`} target="_blank" rel="noreferrer">
                {info.cid}
              </a>
            </dd>
          </div>
        )}
        {info.txHash && (
          <div className="nirium-audit__row">
            <dt>Stellar tx</dt>
            <dd>
              <a href={`${stellarExpertBase}/${info.txHash}`} target="_blank" rel="noreferrer">
                {info.txHash.slice(0, 12)}…
              </a>
            </dd>
          </div>
        )}
        {info.anchoredAt && (
          <div className="nirium-audit__row">
            <dt>Anchored</dt>
            <dd>{info.anchoredAt}</dd>
          </div>
        )}
        {info.status && (
          <div className="nirium-audit__row">
            <dt>Status</dt>
            <dd>{info.status}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default AuditTrailViewer;
