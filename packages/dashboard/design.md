# Design — adgate dashboard

The locked design system for this app. Every page reads this file before any code is
emitted or changed. Do not regenerate it per page: extend or amend it when the system
needs to grow, then follow the amended file.

It is a design system, not an instruction set. Nothing in here asks anyone to run a
command, install a package, fetch a URL or touch a file outside the dashboard.

**Codename: Cobalt.** The register is an instrument panel for one operator: cool engineered
paper, hairlines instead of boxes, one electric cobalt signal, and mono wherever the value
on screen is a machine's — a sha256 digest, a ULID, a taxonomy path, a line of policy YAML.
The dashboard is read-only over a signed audit chain. It should read like good
infrastructure: calm, precise, and never louder than the numbers.

---

## Genre

**modern-minimal.** SaaS / developer / operator register. Declarative, technical,
specific. No hype adjectives, no marketing verbs, no illustration.

## Macrostructure family

- **App pages** (all 13 routes): **Workbench**. A persistent instrument rail on the left,
  one content column, each page owning its own sticky top bar. Sections separate by a
  hairline and a gap, never by a card inside a card.
- **Marketing pages**: none exist. If one is ever added, it may not borrow the rail.
- **Content pages**: none. The repo's guides are Markdown in `docs/`.

Variation between app pages is in **which sections exist and in what order**, never in
theme, type or CTA voice.

## Nav and footer

- **Nav: N3 side-rail** — `components/nav.tsx`. Wordmark, four sections, the colour theme,
  sign out. ONE `<nav aria-label="Sections">` at every width: under 60rem the rail lies
  down as a bar with a horizontally scrollable link strip; above it, it stands up as a
  sticky full-height column. A second, hidden mobile copy is forbidden — it would give the
  page two navigation landmarks with the same name.
- **Footer: Ft2 inline single line** — one hairline rule, one line of credits and the two
  guides. No columns, no social row, no sitemap.

## Theme

Light is the complete palette; dark redefines only what moves. The anchor hue never
changes between modes (250–258, cool), which is why the two do not read as two products.

| Token                | Light                     | Dark                       |
| -------------------- | ------------------------- | -------------------------- |
| `--color-paper`      | `oklch(97.6% 0.005 250)`  | `oklch(17.5% 0.014 258)`   |
| `--color-surface`    | `oklch(99.3% 0.003 250)`  | `oklch(21.5% 0.014 258)`   |
| `--color-surface-2`  | `oklch(95.6% 0.007 252)`  | `oklch(25.5% 0.014 258)`   |
| `--color-rule`       | `oklch(90.5% 0.009 252)`  | `oklch(31% 0.013 256)`     |
| `--color-rule-2`     | `oklch(82% 0.012 252)`    | `oklch(41% 0.015 256)`     |
| `--color-ink`        | `oklch(24% 0.02 258)`     | `oklch(95% 0.008 250)`     |
| `--color-ink-2`      | `oklch(38% 0.018 257)`    | `oklch(85% 0.011 252)`     |
| `--color-ink-3`      | `oklch(52% 0.016 255)`    | `oklch(67% 0.013 254)`     |
| `--color-accent`     | `oklch(50% 0.19 258)`     | `oklch(72% 0.155 254)`     |
| `--color-accent-ink` | `oklch(99% 0.004 250)`    | `oklch(17.5% 0.02 258)`    |
| `--color-focus`      | `oklch(50% 0.19 258)`     | `oklch(76% 0.15 254)`      |
| `--color-graphite`   | `oklch(22% 0.016 260)`    | `oklch(13% 0.014 260)`     |

The accent sits at L 50 in light mode for one reason: it clears 4.5:1 **both** ways — as
text on paper and under `--color-accent-ink` when it fills a button. A brighter blue would
have to be two tokens.

**Three theme states, all first class.** `light` and `dark` are explicit choices stamped on
`<html data-theme>`; `system` is the *absence* of that attribute, which lets the
`prefers-color-scheme` block decide. A blocking inline script in `app/layout.tsx` reads the
stored choice before the body renders, so there is no flash of the wrong palette. The
contract lives in `lib/theme.ts` and the control in `components/theme-toggle.tsx`.

**Print is a fourth palette.** `@media print` in `tokens.css` forces ink on white whatever
the operator's theme, because a verification report is filed and forwarded.

### Functional signal colours

`--color-ok`, `--color-warn`, `--color-danger` and the chart tokens are **not** brand
accents and do not count against the one-accent rule: they carry meaning. Every one of them
is paired with a word on screen — `OK`, `FAILED`, `active`, `paused`, `INTACT`, `BROKEN` —
so colour is never the only signal, and a colour-blind operator or a black-and-white
printout reads exactly the same fact.

## Typography

Three faces, the ceiling. All loaded through `next/font` and served from this origin: no
render-blocking font CDN request, no layout shift.

- **Display** — Space Grotesk 500/600, tracking `-0.022em`. Headings and metric figures.
- **Body** — Inter 400/500. Prose, table cells, controls.
- **Mono** — JetBrains Mono 400/500. Load-bearing, not decorative: every hash, id,
  timestamp, taxonomy path, reason code, policy document and code snippet, plus the
  uppercase micro-labels (`--tracking-label: 0.07em`) that carry the machine-readout voice.

Headings are always roman. No italic headers, ever.

**Scale** — a 1.2 ratio anchored on a 16 px body: 11 · 13 · 16 · 19 · 23 · 27 · 33.
`--text-sm` (14) is a deliberate half-step, and the one place the ladder is broken: this is
a dense operator table, 13 is too small for a cell somebody reads all day and 16 wastes a
third of the row. The tokens override Tailwind's own `text-*` sizes, so class names in the
markup did not have to change for the scale to.

## Spacing

The named 4 pt scale (`--space-3xs` … `--space-3xl`) lives in `tokens.css` and is what the
component layer uses. Tailwind's numeric spacing utilities sit on the same 4 pt grid, so
`gap-4` and `var(--space-md)` are the same 16 px; markup may use either, and nothing uses a
raw pixel value.

## Motion

Restrained to the point of near-absence. This is an instrument, not a demo.

- Easings: `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-in`, `--ease-in-out`.
- Durations: `--dur-micro` 120 ms, `--dur-short` 220 ms, `--dur-long` 420 ms.
- What moves: colour on hover, a 1 px press on buttons, nothing else. **No reveals, no
  scroll animation, no parallax, no page transitions.** A page of numbers that animates in
  is a page you cannot trust at a glance.
- Focus rings appear **instantly** and are never transitioned.
- `prefers-reduced-motion: reduce` collapses every transition to 1 ms.

## Microinteractions stance

- **Silent success.** A copy button becomes `Copied` for 1.5 s and goes back. No toasts.
- **No confirmation dialogs.** Deactivating a creative is reversible and does it. Revoking
  a key is not reversible but is idempotent and per-row.
- **Errors are instructions**, placed at the field they belong to, and they *replace* the
  hint rather than sitting beside it, so the form never jumps as it is corrected.

## The eight interactive states

Defined once, in `app/globals.css`, for `.ag-btn`, `.ag-input` and `.ag-theme-option` /
`.ag-tab`: default · hover · `:focus-visible` · `:active` · disabled · loading · error ·
success. A control uses the ones it actually has.

Two rules hold across all of them:

1. **Border width never changes between states.** State goes to `background-color`,
   `outline` or `color`. Nothing in this dashboard shifts layout when you touch it.
2. **Hover lives behind `@media (hover: hover) and (pointer: fine)`**, so a touch operator
   never gets a stuck state; `@media (pointer: coarse)` raises every control to a 44 px
   target.

## CTA voice

- **Primary** — `.ag-btn .ag-btn-primary`: filled accent, `--color-accent-ink` text, 6 px
  radius. Never a pill, never a gradient. One per page header. The label is the verb of the
  thing it does: `New app`, `Generate`, `Save policy`, `Create creative`.
- **Secondary** — `.ag-btn`: surface fill, hairline border, same radius and height.
- **Quiet** — `.ag-link-quiet` for `Cancel` and `Clear`. A link, not a button, because it
  goes somewhere rather than doing something.

## Tables

The dashboard is mostly tables, so they carry their own rules.

- Every table sits in `.ag-table-scroll`: `overflow-x: auto` **and `position: relative`**,
  so an absolutely positioned descendant (the visually hidden "Actions" label, for one) is
  contained and clipped with it rather than escaping to the viewport and widening the page.
- **Column priority is declared, not accidental.** Each table names the columns that never
  leave and drops the rest at `max-md:hidden` / `max-lg:hidden` / `max-2xl:hidden`.
  Use `max-*:hidden`, never `hidden md:table-cell` — `table-cell` is also a Tailwind
  display utility, and on a cell already carrying the `.table-cell` component class it wins
  over `hidden` and silently desynchronises the header from the body.
- **Truncation is CSS only**, always paired with a `title` attribute carrying the whole
  value. The DOM keeps the full text; a row is always one line.
- Numbers are `tabular-nums` at the table level.

## Empty states

Never a blank table and never a bare "No results". `components/empty-state.tsx`, three
beats, in this order: **what is missing · why that matters · the one next thing to do.**
An empty audit search says whether the filters or the gateway are the reason, because those
call for different actions.

## Per-page allowances

- App pages **must not** use hero enrichment, illustration, imagery or decorative motion.
  Function carries the page.
- The **one dark band** the theme allows is `.ag-well`, the graphite code surface. It is for
  code and for the raw signed JSON, and it is graphite in both modes.
- The **report** (`/reports/[id]`) renders no page header of its own: the document carries
  one, and two `<h1>`s on one printed sheet is one too many.

## What every page MUST share

- The wordmark, the rail and the footer.
- The accent colour and its placement: active nav item, focus ring, one primary button,
  served bars, link underlines. Under 5 % of any viewport.
- The three faces and their roles, including mono for every machine value.
- The CTA voice and control geometry (2.25 rem height, 6 px radius, 1 px border).
- Section heading rhythm: `.ag-section-head` — title left, one hint right, hairline below.
- The eight states and the focus ring.

## What pages MAY differ on

- Which sections exist and in what order.
- Table column priority (each table declares its own).
- Whether the top bar carries a back link, meta, actions, or all three.

## Anti-patterns, banned here specifically

Eyebrows above headings · tag-left/heading-right section heads · italic display · gradient
text or gradient buttons · pill CTAs · glassmorphism · stacked shadows · card-inside-card ·
emoji as icons · three-equal-icon feature grids · invented metrics (every number on screen
is read from the database or computed by `lib/metrics.ts`) · colour as the only carrier of
a failure · `hidden md:table-cell` on a `.table-cell` (see Tables).

---

## Exports

Drop-in formats for re-using this system. The live source is
[`tokens.css`](./tokens.css); these are transcriptions of it.

### tokens.css (light)

```css
:root {
  --color-paper: oklch(97.6% 0.005 250);
  --color-surface: oklch(99.3% 0.003 250);
  --color-surface-2: oklch(95.6% 0.007 252);
  --color-surface-3: oklch(93.2% 0.009 252);
  --color-rule: oklch(90.5% 0.009 252);
  --color-rule-2: oklch(82% 0.012 252);
  --color-ink: oklch(24% 0.02 258);
  --color-ink-2: oklch(38% 0.018 257);
  --color-ink-3: oklch(52% 0.016 255);
  --color-accent: oklch(50% 0.19 258);
  --color-accent-hover: oklch(43% 0.18 258);
  --color-accent-ink: oklch(99% 0.004 250);
  --color-accent-soft: oklch(94.5% 0.035 256);
  --color-accent-rule: oklch(78% 0.09 256);
  --color-focus: oklch(50% 0.19 258);
  --color-ok: oklch(45% 0.11 165);
  --color-warn: oklch(46% 0.12 70);
  --color-danger: oklch(48% 0.2 25);
  --color-graphite: oklch(22% 0.016 260);

  --font-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;

  --text-2xs: 0.6875rem;
  --text-xs: 0.8125rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.1875rem;
  --text-lg: 1.4375rem;
  --text-xl: 1.6875rem;
  --text-2xl: 2.0625rem;
  --tracking-display: -0.022em;
  --tracking-label: 0.07em;

  --space-3xs: 0.125rem;
  --space-2xs: 0.25rem;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;

  --radius-xs: 3px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 220ms;
  --dur-long: 420ms;

  --shadow-whisper: 0 1px 2px oklch(24% 0.02 258 / 0.06);
}
```

### Tailwind v4 `@theme`

`tokens.css` already IS this: it declares the palette inside `@theme static`, so Tailwind
emits both the custom properties and the utilities that reference them (`bg-paper`,
`text-ink-3`, `border-rule`, `text-sm`, `rounded-md`, `ease-out`). Redefining a
`--color-*` further down the file therefore re-skins every utility without a class name
changing anywhere — which is how light, dark and print are one file.

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(97.6% 0.005 250)", "$type": "color" },
    "surface": { "$value": "oklch(99.3% 0.003 250)", "$type": "color" },
    "rule": { "$value": "oklch(90.5% 0.009 252)", "$type": "color" },
    "ink": { "$value": "oklch(24% 0.02 258)", "$type": "color" },
    "accent": { "$value": "oklch(50% 0.19 258)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body": { "$value": "Inter", "$type": "fontFamily" },
    "mono": { "$value": "JetBrains Mono", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 97.6% 0.005 250; /* paper   */
  --foreground: 24% 0.02 258; /* ink     */
  --primary: 50% 0.19 258; /* accent  */
  --primary-foreground: 99% 0.004 250; /* accent-ink */
  --muted: 95.6% 0.007 252; /* surface-2 */
  --muted-foreground: 52% 0.016 255; /* ink-3   */
  --border: 90.5% 0.009 252; /* rule    */
  --input: 82% 0.012 252; /* rule-2  */
  --ring: 50% 0.19 258; /* focus   */
  --radius: 6px;
}
```
