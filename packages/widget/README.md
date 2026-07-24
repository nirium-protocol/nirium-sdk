# `@nirium-protocol/audit-trail-viewer`

Standalone, **zero-runtime-dependency** React widget that surfaces Nirium
anchored audit-trail receipts inside any third-party Web3 dashboard.

Built against the bounty described in [nirium-sdk#12](https://github.com/nirium-protocol/nirium-sdk/issues/12):
> *Standalone React AuditTrail Viewer Widget — Bounty ($50 USDC).*

## What it does

- Accepts an `appId` and fetches anchored receipts via `GET /api/audit/info`.
- Displays each receipt's **IPFS CID** and **Stellar tx hash** with working
  external links (defaulting to `https://ipfs.io/ipfs/<cid>` and
  `stellar.expert/explorer/public/tx/<hash>` — overridable).
- Ships Tailwind-friendly class hooks so host apps can restyle freely.
- Includes a full NPM build setup (`tsup` dual ESM/CJS + TypeScript types).
- Exposes a dependency-free `fetchAuditInfo()` helper for non-React hosts.
- Tested with `vitest` + `@testing-library/react` (success / loading / error /
  empty + click interactions).

## Install

```bash
npm install @nirium-protocol/audit-trail-viewer
```

## Usage

```tsx
import { AuditTrailViewer } from '@nirium-protocol/audit-trail-viewer'

export function Dashboard() {
  return (
    <AuditTrailViewer
      appId="<your-nirium-app-id>"
      title="Anchored Audit Trail"
      // Optional: override default Stellar Expert link with custom CTA
      renderExternalLink={(r) => (
        <a href={`https://my-explorer.local/tx/${r.stellarTxHash}`}>
          Verify on My Explorer
        </a>
      )}
    />
  )
}
```

### Non-React usage

```ts
import { fetchAuditInfo } from '@nirium-protocol/audit-trail-viewer'

const info = await fetchAuditInfo('demo', {
  baseUrl: 'https://my-nirium-proxy.test',
})
console.log(info.receipts)
```

## Build & test

```bash
npm install
npm run build   # tsup → dist/{index.mjs,index.cjs,index.d.ts}
npm test        # vitest run
npm run typecheck
```

## License

MIT.
