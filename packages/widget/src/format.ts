/**
 * Pure formatting helpers used by the widget UI.
 * Kept dependency-free for portability into any React host.
 */

export function formatAnchoredAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // ISO-style date + short time, no locale surprises.
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  )
}

export function truncateCid(cid: string, edge = 6): string {
  if (!cid || cid.length <= edge * 2 + 3) return cid
  return `${cid.slice(0, edge)}…${cid.slice(-edge)}`
}

export function truncateHash(hash: string, edge = 6): string {
  return truncateCid(hash, edge)
}

export function ipfsGatewayUrl(cid: string, gateway?: string): string {
  const base = gateway ?? 'https://ipfs.io/ipfs/'
  return `${base.replace(/\/+$/, '/')}${cid}`
}

export function stellarExpertUrl(network: 'mainnet' | 'testnet', txHash: string): string {
  const sub = network === 'testnet' ? 'testnet.' : ''
  return `https://${sub}stellar.expert/explorer/public/tx/${txHash}`
}
