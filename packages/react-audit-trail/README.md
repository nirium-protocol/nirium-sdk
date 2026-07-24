# @nirium/react-audit-trail (bounty #12)

Zero-dependency **React widget** that fetches and displays anchored audit-trail
receipts for any Nirium app — embeddable into any third-party Web3 dashboard.

## Usage
```tsx
import { AuditTrailViewer } from '@nirium/react-audit-trail';

export function Dashboard() {
  return <AuditTrailViewer appId="app_123" />;
}
```

## Props
| Prop | Type | Default | Description |
|---|---|---|---|
| `appId` | `string` | — | App identifier to fetch receipts for. |
| `endpoint` | `string?` | `/api/audit/info` | Info endpoint (query `?app_id=`). |
| `stellarExpertBase` | `string?` | testnet explorer | Base URL for Stellar tx links. |
| `ipfsGateway` | `string?` | `https://ipfs.io/ipfs` | Gateway for CID links. |

## Behavior
- Accepts `app_id`, fetches `GET /api/audit/info?app_id=...`.
- Displays **IPFS CIDs** and **Stellar Expert links** cleanly.
- Styled with plain CSS classes (`nirium-audit*`) — drop in Tailwind or your own.

## Build
```bash
npm i && npm run build   # tsc -> dist/
npm test                 # jest 2/2
```
Bounty #12 — $50 USDC, GrantFox / Stellar Foundation.
