# @nirium/audit-trail-viewer

Reusable React widget for displaying IPFS- and Stellar-anchored Nirium audit receipts. The published package has no bundled runtime dependencies; React is a peer dependency.

## Install

```bash
npm install @nirium/audit-trail-viewer
```

## Use

```tsx
import { AuditTrailViewer } from '@nirium/audit-trail-viewer';
import '@nirium/audit-trail-viewer/styles.css';

export function AuditPanel() {
  return (
    <AuditTrailViewer
      app_id="my-app"
      apiBaseUrl="https://api.example.com"
      stellarNetwork="public"
    />
  );
}
```

The widget requests `GET /api/audit/info?app_id=<value>`. `apiBaseUrl` defaults to the current origin. Use the optional `fetcher` prop when the API needs custom headers or a non-browser fetch implementation.

The shipped stylesheet contains the Tailwind utilities used by the component, so applications do not need to add this package to their Tailwind content configuration. It omits Tailwind's preflight reset to avoid changing host application styles.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `app_id` | `string` | required | Application identifier sent to the audit endpoint. |
| `apiBaseUrl` | `string` | `''` | Optional API origin. |
| `ipfsGateway` | `string` | `https://ipfs.io/ipfs/` | Gateway used for CID links. |
| `stellarNetwork` | `public \| testnet \| futurenet` | `public` | Stellar Expert network. |
| `fetcher` | `typeof fetch` | `globalThis.fetch` | Custom request implementation. |
| `className` | `string` | — | Additional root classes. |
| `loadingFallback` | `ReactNode` | built in | Custom loading content. |
| `emptyFallback` | `ReactNode` | built in | Custom empty content. |
| `errorFallback` | `ComponentType<{ error: Error }>` | built in | Custom error component. |
| `onLoad` | `(receipts) => void` | — | Called after a successful request. |

## Development

```bash
npm install
npm run check
```
