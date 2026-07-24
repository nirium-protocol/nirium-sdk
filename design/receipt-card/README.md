# x402 Micropayment Receipt Card — Design Package

> GrantFox UX Bounty deliverable for [nirium-protocol/nirium-sdk#13](https://github.com/nirium-protocol/nirium-sdk/issues/13).

A complete, designer-ready package that any Figma user can import as a reference, plus a runnable HTML/CSS prototype and exportable SVG mockups.

## Contents

| Path | What it is |
|---|---|
| `SPEC.md` | Full design specification — typography, color tokens, spacing, components, motion, accessibility |
| `components/` | Figma-ready component breakdown (JSON + human-readable) for direct import into Figma |
| `mockups/` | SVG mockups — Settled state, Pending state, Failed state, Mobile compact, Desktop expanded |
| `prototype/` | Runnable HTML/CSS/JS interactive prototype with live state toggle |
| `tokens/` | Design tokens (JSON + CSS custom properties) for Figma Variables / Tailwind / CSS |

## Live prototype

Open `prototype/index.html` in a browser, or serve the folder:

```bash
cd prototype && python3 -m http.server 8000
# then visit http://localhost:8000
```

The prototype shows the receipt card in all three states (Settled / Pending / Failed) with a click-to-toggle demo, real Stellar Expert links, and copyable transaction hashes.

## Figma handoff

`components/figma-component-map.json` is structured for one-click import via [Figma's REST API](https://www.figma.com/developers/api) or paste into a Figma file via the [Tokens Studio](https://tokens.studio) plugin. The tokens file (`tokens/tokens.json`) is also Tokens-Studio-compatible out of the box.

If a Figma desktop license is available, the recommended import flow:

1. Open Figma → New design file → Plugins → Tokens Studio → Sync → `tokens/tokens.json`
2. All color, typography, spacing, radius, and shadow variables populate.
3. Drop the SVG mockups from `mockups/` onto the canvas — they import as editable vectors.
4. Use `components/figma-component-map.json` as the component tree reference.

## Design rationale

- **Dark mode + glassmorphism** — matches the Nirium SDK dark surface (see `nirium-sdk/packages/sdk` reference screenshots in the issue thread). Glassmorphism with a subtle indigo accent layer reads as "crypto-native / premium" without looking generic.
- **Settled vs Pending vs Failed** — color-coded status pill (emerald / amber / rose) on a frosted background. State change is animated (220ms) for clear feedback.
- **Stellar Expert link** — opens the live ledger transaction in a new tab. IPFS CID renders as a clickable link to `ipfs.io/ipfs/<cid>` (gateway).
- **Truncation policy** — hashes and CIDs use `text-overflow: ellipsis` with a one-click copy button, full value in `title` for hover.
- **Accessibility** — WCAG AA contrast on every text element against the darkest card surface. `prefers-reduced-motion` disables the state-change animation. Full keyboard navigation, visible focus rings, `aria-live="polite"` on status changes.
- **Mobile-first** — single-column on `<480px`, two-column metadata grid at desktop widths, all tap targets ≥ 44px.

## Acceptance criteria (mapped to issue #13)

| Issue requirement | Where delivered |
|---|---|
| Sleek modern dark mode + glassmorphism | `prototype/index.html`, `mockups/settled.svg`, `SPEC.md` § Visual language |
| Amount (USDC), Tx Hash, Stellar Expert link, IPFS CID, Status (Settled/Pending) | `prototype/index.html` § Card layout, `mockups/*.svg` |
| Exportable Figma components & design specs | `components/figma-component-map.json`, `tokens/tokens.json`, `SPEC.md` |

## Reward eligibility

Issue is labeled `GrantFox OSS`, `Official Campaign | FWC26`, `Maybe Rewarded`, body names "Funded via Stellar Foundation / GrantFox Campaign (Organization ID: b6550049-a239-4dc1-b95e-2fb28ded7ea6)". Reservation comment left by `@jdjioe5-cpu` on 2026-07-23T07:42:25Z (`#issuecomment-5055782193`). No formal assignee conflict on the issue at PR time. A compatible public USDC receive address is provided in the PR body for the maintainer to wire.
