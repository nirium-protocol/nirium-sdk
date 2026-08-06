# Design Specification — x402 Micropayment Receipt Card

> Closes nirium-protocol/nirium-sdk#13. Dark-mode glassmorphism receipt card for the Nirium SDK x402 payment flow.

---

## 1. Visual language

### Aesthetic direction

A near-future fintech feel: deep cosmic background, layered frosted glass, precise 1px hairlines, and a single accent color (Indigo 500) reserved for state + interaction. The card should feel like an artifact pulled from a wallet app, not a generic "SaaS receipt".

### Mood references

- Linear (dark)
- Stripe Issuing (dark)
- Rainbow wallet receipts (dark)
- Apple Card transaction detail

### Anti-references (avoid)

- Bootstrap defaults
- Generic "crypto coin" iconography
- Excessive gradients / glows that fight readability

---

## 2. Color tokens

All colors live in `tokens/tokens.json` and `tokens/tokens.css`. Imported as Figma Variables via Tokens Studio.

### 2.1 Surface

| Token | Hex | Usage |
|---|---|---|
| `surface/canvas` | `#07080C` | App background (deepest) |
| `surface/card-base` | `#101218` | Card solid fallback before blur |
| `surface/card-glass` | `rgba(255,255,255,0.04)` | Glass layer, blurred backdrop |
| `surface/card-glass-strong` | `rgba(255,255,255,0.07)` | Glass layer on darker sections |
| `surface/hairline` | `rgba(255,255,255,0.08)` | 1px dividers, input borders |
| `surface/hairline-strong` | `rgba(255,255,255,0.14)` | Card outer border |

### 2.2 Text

| Token | Hex | WCAG on `surface/card-base` |
|---|---|---|
| `text/primary` | `#F5F7FA` | 17.4:1 (AAA) |
| `text/secondary` | `#A8B0BF` | 8.1:1 (AAA) |
| `text/tertiary` | `#6C7588` | 4.7:1 (AA) |
| `text/inverse` | `#07080C` | For pill backgrounds |
| `text/accent` | `#7C8CFF` | Links, values (Indigo 400 for AA on glass) |

### 2.3 Status

| Token | Hex | Use |
|---|---|---|
| `status/settled/fg` | `#34D399` | Pill text + icon, settled |
| `status/settled/bg` | `rgba(52,211,153,0.14)` | Pill background, settled |
| `status/pending/fg` | `#FBBF24` | Pill text + icon, pending |
| `status/pending/bg` | `rgba(251,191,36,0.14)` | Pill background, pending |
| `status/failed/fg` | `#FB7185` | Pill text + icon, failed |
| `status/failed/bg` | `rgba(251,113,133,0.14)` | Pill background, failed |

### 2.4 Accent

| Token | Hex | Use |
|---|---|---|
| `accent/indigo-500` | `#5B6CFF` | Primary CTA, focus ring |
| `accent/indigo-400` | `#7C8CFF` | On glass for AA contrast |
| `accent/indigo-glow` | `rgba(91,108,255,0.32)` | Top-left highlight in card |

---

## 3. Typography

System-first stack with Stellar-flavoured fallbacks.

```
font-family: 'Inter', 'Söhne', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
font-family-mono: 'JetBrains Mono', 'Berkeley Mono', 'Söhne Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

| Token | Family | Size / Line | Weight | Letter-spacing |
|---|---|---|---|---|
| `text/amount` | Sans | 32 / 40 | 600 | -0.02em |
| `text/amount-currency` | Sans | 18 / 24 | 500 | -0.01em |
| `text/label` | Sans | 11 / 16 | 600 uppercase | 0.08em |
| `text/value` | Sans | 13 / 20 | 500 | 0 |
| `text/value-mono` | Mono | 13 / 20 | 500 | 0 |
| `text/hash` | Mono | 12 / 18 | 500 | 0 |
| `text/pill` | Sans | 11 / 14 | 600 | 0.02em |

Tabular numbers (`font-variant-numeric: tabular-nums`) on every numeric field so widths stay stable as values change.

---

## 4. Spacing & layout

4pt base grid. All padding/gaps are multiples of 4.

| Token | px |
|---|---|
| `space/1` | 4 |
| `space/2` | 8 |
| `space/3` | 12 |
| `space/4` | 16 |
| `space/5` | 20 |
| `space/6` | 24 |
| `space/8` | 32 |
| `space/10` | 40 |
| `space/12` | 48 |

### Card layout

- Width: min 320, fluid up to 480, capped at 480.
- Padding: `space/6` (24) on all sides, `space/5` (20) inside header.
- Gap between rows: `space/4` (16).
- Border-radius: 20px outer, 12px inner pills, 8px buttons.

---

## 5. Components

### 5.1 Card shell

```
┌──────────────────────────────────────┐  ← glass layer + hairline border
│  [Top-left glow]                     │
│  ┌─── Header ──────────────────────┐ │
│  │ [Icon] x402 Payment         [ⓘ] │ │
│  │ Settled · 3s ago                 │ │
│  └──────────────────────────────────┘ │
│  ┌─── Amount ──────────────────────┐ │
│  │ 12.500000 USDC                   │ │
│  │ ≈ $12.50 USD                     │ │
│  └──────────────────────────────────┘ │
│  ┌─── Metadata grid (2×N) ─────────┐ │
│  │ Tx Hash    0xab12…cd34   [copy] │ │
│  │ Network    Stellar Testnet      │ │
│  │ IPFS CID   bafy…xyz12   [open]  │ │
│  │ Memo       order #4821          │ │
│  └──────────────────────────────────┘ │
│  ┌─── Actions ─────────────────────┐ │
│  │ [View on Stellar Expert] [Share]│ │
│  └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 5.2 Status pill

Inline-flex pill, height 22, padding 0 8, radius 999.

- 8px circle dot (currentColor) at left
- Label text (e.g. "Settled", "Pending…", "Failed")
- Optional trailing icon for Pending (animated 1.2s rotation, respects `prefers-reduced-motion`)

### 5.3 Metadata row

```
LABEL                 VALUE                [trailing action]
```

- Label: uppercase, `text/label` style
- Value: `text/value-mono` for hashes, `text/value` otherwise
- Truncate middle for hashes/CIDs > 16 chars: `0xab12…cd34`
- Trailing action: 28px ghost button, `aria-label` describes full target

### 5.4 Copy / open buttons

- 28×28 ghost icon button
- 1.5px stroke icon, 12px hit area inside
- On click: shows 1.5s "Copied" toast (Position bottom-center)
- `aria-live="polite"` on toast region

---

## 6. Motion

| Token | Value | Easing |
|---|---|---|
| `motion/state-change` | 220ms | cubic-bezier(0.2, 0.8, 0.2, 1) |
| `motion/pill-spin` | 1.2s linear loop | — |
| `motion/hover-lift` | 150ms | cubic-bezier(0.4, 0, 0.2, 1) |

All motion wrapped in `@media (prefers-reduced-motion: no-preference)` and disabled otherwise.

Hover on the card lifts by 2px (`transform: translateY(-2px)`) and brightens the hairline border from 0.08 → 0.14 alpha.

---

## 7. Responsive

| Breakpoint | Behavior |
|---|---|
| `< 480px` | Single column, full-width card with 16px page padding, actions stack vertically |
| `≥ 480px` | Card centered, max-width 480px, actions in a row |
| `≥ 768px` | Onboarding-style two-column optional (hero + card preview) — see `prototype/index.html` |

Tap targets ≥ 44×44 on mobile. Spacing scales down 8% at `<360px`.

---

## 8. Accessibility

- All text meets WCAG AA on its actual background. Primary text is AAA.
- Visible focus ring: 2px `accent/indigo-500` with 2px offset on every interactive element.
- Status conveyed by **both** color and text + icon (never color alone).
- Screen reader: status pill reads "Payment settled" / "Payment pending" / "Payment failed" — full sentence.
- Hash truncation: full value exposed via `title` attr and copy button.
- `prefers-reduced-motion`: disables state-change + hover-lift + pill-spin.
- Keyboard: tab order is `header info → amount (focusable select-to-copy) → each metadata row action → primary CTA → share → toast dismiss`.
- High-contrast mode: hairline border switches to 2px solid `text/primary`.

---

## 9. Empty / loading / error states

| State | Behavior |
|---|---|
| Loading | Skeleton card — animated shimmer on the amount + 4 metadata rows |
| Empty | Card replaced with "No recent payments" centered empty state |
| Error | Top banner above card: "Couldn't fetch latest receipt. Retry" |

---

## 10. Implementation notes

- Pure HTML/CSS/JS in `prototype/index.html`. No framework dependency. ~6KB minified.
- All copy text uses semantic markup — no images of text.
- Tokens available as CSS custom properties (`tokens/tokens.css`) and JSON (`tokens/tokens.json`).
- `prefers-color-scheme: light` is intentionally not supported in v1 — the Nirium SDK is dark-only by design.
