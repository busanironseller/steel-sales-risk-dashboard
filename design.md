# AURORA — Design System

> Cloud Cost Optimizer for AWS. Desktop-first (PC) SaaS dashboard.
> Design language: **modern monochrome** — black, white, and grays only. No accent colors, no emojis, English-only UI copy.

---

## 1. Brand Identity

**Product name:** AURORA
**Tagline:** Cloud Cost Optimizer

**Logo:**
- Mark: a geometric mountain / "A" formed by two overlapping triangles with a thin outline stroke (2px), solid black on white surfaces, solid white on black surfaces.
- Wordmark: `AURORA` set in the display face, uppercase, letter-spacing `0.18em`, weight 600.
- Sub-label: `CLOUD COST OPTIMIZER` in 9–10px uppercase, letter-spacing `0.22em`, color `--ink-40`.
- Lockup: mark left, wordmark + sub-label stacked to the right. Minimum clear space = height of the mark on all sides.
- Never: gradients, drop shadows, color fills, emoji, or rotation.

**Voice:** plain, factual, verb-first. "Connect AWS", "View all opportunities", "Rightsize EC2 instances". No exclamation marks, no marketing filler, no emojis anywhere in the product UI.

---

## 2. Color Tokens (monochrome only)

The app has **two themes** (light / dark), toggled by the user. Structural rule: **the sidebar is always inverted relative to the main area.** Light theme = light main + dark sidebar (matches the reference). Dark theme = dark main + light sidebar. All component CSS must consume tokens only — never hard-coded hex — so the toggle is a pure token swap.

### Main-area tokens

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--surface` | `#FAFAFA` | `#0A0A0A` | App background |
| `--card` | `#FFFFFF` | `#141414` | Card / panel background |
| `--ink-100` | `#0A0A0A` | `#FAFAFA` | Primary text, donut ring, chart primary line |
| `--ink-70` | `#4A4A4A` | `#B8B8B8` | Secondary text |
| `--ink-40` | `#9A9A9A` | `#7A7A7A` | Tertiary text, captions, axis labels |
| `--ink-15` | `#E4E4E4` | `#2A2A2A` | Borders, dividers, table rules |
| `--ink-8` | `#F1F1F1` | `#1F1F1F` | Hover fills, badges, progress tracks |
| `--btn-primary-bg` | `#0A0A0A` | `#FAFAFA` | Primary button fill |
| `--btn-primary-fg` | `#FFFFFF` | `#0A0A0A` | Primary button text |

### Sidebar tokens (inverted)

| Token | Light theme | Dark theme | Usage |
|---|---|---|---|
| `--side-bg` | `#0A0A0A` | `#FAFAFA` | Sidebar background |
| `--side-fg` | `#FAFAFA` | `#0A0A0A` | Logo, active nav text/icon |
| `--side-fg-70` | `#B8B8B8` | `#4A4A4A` | Inactive nav text |
| `--side-fg-40` | `#7A7A7A` | `#9A9A9A` | Inactive icons, captions |
| `--side-border` | `#242424` | `#E4E4E4` | Right border, summary-card border |
| `--side-active` | `#1F1F1F` | `#EBEBEB` | Active nav item fill |
| `--side-hover` | `#171717` | `#F1F1F1` | Nav hover fill |
| `--side-track` / `--side-fill` | `#2E2E2E` / `#FAFAFA` | `#E4E4E4` / `#0A0A0A` | Progress bar track / fill |

**Rules**
- No hues. Semantic states are expressed with weight, position, and iconography — not color. If a state absolutely requires distinction (e.g., destructive confirm), use `--ink-100` filled button + explicit label text.
- Dark theme uses `#141414` cards on `#0A0A0A` surface (never pure-black-on-pure-black); text is `#FAFAFA`, not `#FFFFFF`, to reduce glare.
- Charts: current/actual series = solid `--ink-100`; projected/optimized series = dashed `--ink-40`; area fills = `--ink-100` at 4–6% opacity (light) / 8% (dark). Chart SVGs must use CSS classes bound to tokens, not inline hex.

---

## 3. Typography

| Role | Face | Weight | Size / Line |
|---|---|---|---|
| Display (logo, hero) | `Space Grotesk` | 600 | 20–48px |
| Headings (page & card titles) | `Inter` | 600 | 15–20px / 1.3 |
| Body | `Inter` | 400–500 | 13–14px / 1.5 |
| Data / numbers | `Inter` tabular-nums (or `IBM Plex Mono` for tables) | 600 | KPI: 26–30px |
| Caption / label | `Inter` | 500, uppercase | 10–11px, letter-spacing 0.06em |

- KPI numbers always use `font-variant-numeric: tabular-nums`.
- Currency: `$218,730` — thousands separators, no decimals above $1,000; `/mo` suffix in `--ink-40` at 60% of the number size.
- All UI copy in English. Sentence case for body/buttons, uppercase only for micro-labels.

---

## 4. Layout

Desktop-first, minimum design width **1280px**, optimized for 1440px.

```
┌──────────┬──────────────────────────────────────────────┐
│ Sidebar  │ Top bar: page title · date range · [Connect AWS] │
│ 232px    ├──────────────────────────────────────────────┤
│          │ KPI row: 4 stat cards (equal width)          │
│ Logo     ├──────────────────────────────────────────────┤
│ Nav      │ Cost Trend (8 cols)   │ Cost Breakdown (4)   │
│          ├──────────────────────────────────────────────┤
│ Summary  │ Top Savings Opportunities (table, 12 cols)   │
│ card     │                                              │
└──────────┴──────────────────────────────────────────────┘
```

- Grid: 12 columns, 24px gutters, 32px page padding.
- Sidebar: fixed 232px, `--side-bg` background (always inverted vs. main area), 1px right border `--side-border`.
- Card: `--card` bg, 1px border `--ink-15`, radius **12px**, padding 20–24px. No drop shadows (or at most `0 1px 2px rgba(0,0,0,0.04)`).
- Vertical rhythm: 24px between card rows.

---

## 5. Components

### Sidebar navigation (inverted panel)
- Uses `--side-*` tokens exclusively. Logo mark/wordmark render in `--side-fg`.
- Item: icon (16px, 1.5px stroke) + label, 13px, height 38px, radius 8px.
- Active: `--side-active` fill, text/icon `--side-fg`, weight 600. Inactive: `--side-fg-40` icon, `--side-fg-70` text. Hover: `--side-hover`.
- Bottom: "Total Potential Savings" summary card — 1px `--side-border` border, caption label, large number `$52,430 /mo`, sub-caption "24% of current spend", thin progress bar (`--side-fill` on `--side-track`, 4px).

### Theme toggle
- Placement: top bar, left of the date-range picker. Icon-only secondary button (36×36px): moon icon in light theme, sun icon in dark theme. Outline icons, 1.5px stroke — never emoji.
- Behavior: toggles `data-theme="dark"` on `<html>`; everything restyles via token swap (no per-component overrides). Persist choice in `localStorage`, default to `prefers-color-scheme` on first visit.
- Transition: background/color 200ms ease; disabled under `prefers-reduced-motion`.
- Accessibility: `aria-label="Toggle dark mode"`, visible focus ring in both themes.

### Stat card (KPI)
- Caption label → number (28px, 600) → delta line (`↑ 8.4% vs Apr 1 – Apr 30`, 11px, `--ink-40`) → 40px sparkline (`--ink-100`, 1.5px).
- Deltas use `↑ ↓` arrows only — never red/green.

### Buttons
- Primary: `--ink-100` fill, white text, radius 8px, height 36px, 13px/600. Hover: `#2A2A2A`.
- Secondary: white fill, 1px `--ink-15` border, `--ink-100` text. Hover: `--ink-8`.
- Ghost/link: `--ink-70` text + `→` arrow, hover `--ink-100`.

### Charts
- Line: 1.5–2px stroke, no dots except hover; dashed comparison line for "Optimized Cost".
- Donut: 14px ring `--ink-100` on `--ink-8` track, centered total + caption.
- Axis/grid: labels 10px `--ink-40`; horizontal gridlines only, 1px `--ink-8`.
- Legend: 16px line swatch + 11px label.

### Table (Savings Opportunities)
- Header row: 10px uppercase `--ink-40`, bottom border `--ink-15`.
- Rows: 44px height, 13px, divider `--ink-8`; hover `--ink-8` fill.
- Effort badge: `--ink-8` pill, 11px ("Low / Medium / High").
- Confidence: 64px inline bar, filled `--ink-100` segment on `--ink-8`.
- Row action: small secondary button "View".
- Footer: ghost link "View all opportunities →".

### Misc
- Icons: single set, outline style, 1.5px stroke (Lucide-compatible). Never emojis.
- Date range picker: secondary-button style with calendar icon + chevron.
- Focus states: 2px `--ink-100` outline, offset 2px. Respect `prefers-reduced-motion`.

---

## 6. Motion

- Durations 150–200ms, `ease-out`. Hover fills, chart draw-in on load (once), number count-up ≤ 600ms.
- No parallax, no bouncing, no looping animation.

## 7. Do / Don't

**Do:** monochrome everything · tabular numbers · generous whitespace · 1px borders over shadows · English-only copy.
**Don't:** emojis or decorative icons · colored status chips · gradients · rounded-pill primary buttons · more than two font families visible per view.
