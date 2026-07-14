# Deck2 Style Switcher — Design Spec

**Date:** 2026-07-05
**Status:** Approved design (pending user review of this document)
**Owner:** Reporting / dev preview (`src/data/reporting/executive/deck2/`, `src/dev/`)

> Scope note: this spec covers a **dev-only design-exploration tool**, not a change to the
> production executive deck. `deck2` is still not wired into the app (see
> [[executive-deck-v2-rework]] memory / `docs/superpowers/specs/2026-06-30-*`). Nothing here
> changes what gets exported from the real app today.

---

## 1. Problem statement

The user wants to compare alternative visual treatments for each of deck2's 10 slide
types (cover, TOC, glossary, 2 section separators, risk-level population, port
population, port sample, image-quality results, accuracy results) side by side, live, in
`deck-preview.html`, without touching the current production design or the deck's fixed
portrait/A4 page budget. Visual inspiration comes from a customs-ports HTML template
(`customs_land_sea_ports_100_slide_html_deck.html`, landscape 16:9, light-paper + dark
dashboard mix) — specifically its KPI-card, mini-chart, risk-heatmap, and compare-bar
patterns, adapted to deck2's dark-navy portrait design language.

Decisions taken during brainstorming:

| Question | Decision |
|---|---|
| Format (page size, aspect ratio, print budget) | **Unchanged.** No A4/resolution change, no new pagination logic. Variants must fit the same content budget as today's design. |
| What changes | Only **visual treatment** per slide, via new alternate variants. Today's design is always variant `0` and is never removed or altered. |
| Variant count | **4 total per slide type** (variant 0 = today, + 3 new alternates). |
| Switching UX | Arrow button at the edge of each slide, click cycles variants **instantly** (no reload, no re-render — all 4 variants pre-rendered, toggled via CSS). |
| Persistence | Saved to a **JSON file on disk** (not localStorage), shaped like the app's real `JsonEnvelope` (schemaVersion/revision/contentHash/writtenAt + data) at `dev-workspace/6-templates/deck-style-choices.json` — a new gitignored folder that mirrors the real `6-templates/` workspace convention, so the file is already positioned for a location swap (not a rewrite) whenever this becomes a production feature. |
| Role gating | **None for now.** `deck-preview.html` has no login/auth at all (it's a standalone Vite dev entry, not part of the authenticated app tree) — restricting to admin/manager only makes sense once deck2 is wired into the real Report Designer, which is future, out-of-scope work. |
| Light/dark toggle | **One shared CSS re-skin**, not separate light copies of every variant. Mirrors the old deck's existing `.page.light` pattern: components already read colors from CSS variables, so a `theme-light` class on the viewer swaps the palette on top of whichever variant is currently showing. |
| Deltas (up/down %) | **Omitted.** No month-over-month history exists in the data model yet; KPI-card variants show icon + big number + label only, never a fabricated trend arrow. |
| Business data | No invented numbers. All new variants render the **same real aggregates** the current variant renders (or a real subset/recombination of them), never placeholder data outside the fixture. |

---

## 2. Architecture

### 2.1 Preview-mode flag, not a new deck

`buildExecutiveDeckV2` gains an options parameter:

```ts
buildExecutiveDeckV2(input: ExecutiveReportInput, opts?: { variantPreview?: boolean }): string
```

- `variantPreview` **false/omitted** (default, and what any future production caller uses):
  every slide renders **only** variant `0` — today's design — with no switcher chrome at
  all. This is the "do not touch the current decks" guarantee.
- `variantPreview: true` (set only by `src/dev/deckPreview.ts`): every slide renders all 4
  variants into the DOM (one visible, three `display:none`), plus the arrow-switcher
  control and the variant index label (e.g. "2 / 4").

This keeps the production code path a single `if` away from today's behavior — no
parallel deck, no duplicated slide list.

### 2.2 Slide variant builders

Each of the 10 slide-building functions in `deck2/slides.ts` currently returns one HTML
string. They're refactored to return an array of exactly 4 HTML strings (`buildXxxVariants(model): [string, string, string, string]`), where index `0` is the **extracted, unmodified** current implementation (a pure move, not a rewrite) and indices `1–3` are the new alternates from the catalog in §3. A thin wrapper in `deck2/index.ts` decides, per slide, whether to emit variant `0` only (production) or all 4 wrapped in switcher chrome (preview).

Shared new components (KPI card, mini bar chart, donut, heatmap grid, compare-bars) are
extracted into `deck2/ui/variantComponents.ts` so they're written once and reused across
whichever slides need them — not copy-pasted per slide.

### 2.3 Switcher chrome (preview mode only)

Per slide, in preview mode: an arrow-button pair (‹ ›) positioned at the slide's inline-start
edge, plus a small "N / 4" indicator. A single small inline script (added alongside the
existing `DECK_NAV_SCRIPT`) handles: click → hide current variant div, show next
(wrapping), update the indicator, POST the new choice to the dev persistence endpoint.
On initial load, the same script reads the fetched choices JSON and shows the saved
variant per slide (defaulting to `0`).

### 2.4 Persistence — Vite dev middleware

A small Vite plugin, registered only in `vite.config.ts`'s dev server (`configureServer`),
exposes two routes:

- `GET /__deck-style-choices` → reads and returns
  `dev-workspace/6-templates/deck-style-choices.json` (or an empty envelope if absent).
- `POST /__deck-style-choices` → merges `{ slideId, variantIndex }` into the existing
  envelope's `data`, bumps `revision`, rewrites `writtenAt`, and writes the file (plain
  `fs.writeFileSync`, since this is a local dev tool, not the browser-side
  `safeWriteJson`/File System Access flow the real app uses for user workspaces).

`dev-workspace/` is added to `.gitignore` (local iteration state, not a deliverable).

### 2.5 Light/dark toggle

One button added to `deck-preview.html`'s existing `#bar` toolbar. Toggles a `theme-light`
class on the preview `<body>` (propagated into the iframe's root, since slides render
inside an `iframe.srcdoc`). New CSS (in `deck2/theme.ts`, alongside `DECK_V2_CSS`) mirrors
the old deck's `.page.light` overrides: background/ink/border/table colors swap via the
existing CSS custom properties, no new markup, applies uniformly to variant `0` and the
new variants alike.

---

## 3. Variant catalog (10 slide types × 3 new alternates)

Variant `0` is always today's design, verbatim. All variants for a slide type share that
slide's real data — no new business logic, no invented numbers.

| Slide | V1 | V2 | V3 |
|---|---|---|---|
| **Cover** | Cinematic hero: larger title block, meta-grid re-rendered as icon chips (population/sample/coverage/ports) instead of a grid of cards | KPI-card summary row (icon + big number + label, no delta) below the title block, reusing the cover's existing headline numbers | Split layout: org block + title on one side, a compact "quick facts" panel (compare-bars or small donut of land vs sea population) on the other |
| **TOC** | Icon-card grid (existing `toc-page` pattern from the old deck, adapted/polished for deck2) | Numbered vertical list with dotted leaders + small icon chip per section | Two-column list + a small composition donut (pages per section) |
| **Glossary** | Denser 2-column definition list (more terms visible per page) | Flowing icon-chip wrap layout instead of a strict 4×3 grid | Terms grouped under 2–3 category headers (e.g. population terms vs quality terms) |
| **Section separators (×2)** | Hero + bottom mini stat-strip summarizing the section ahead | Minimal center-only (icon + ghost number + title, no TOC band) | Diagonal color-block accent with a large section icon |
| **Risk-level population** | Risk heatmap matrix (impact/likelihood-style grid recolored to the 4 risk stages) + meaning sidebar | KPI-card row — restyles today's 4 tiles as KPI cards (population/sample/coverage per level) | Compare-bars showing relative share across the 4 levels + an exact-figures table |
| **Port population** | Compare-bars per port (land vs sea paired bars) | KPI strip (total ports / total population / top port) above the existing tinted tables | Composition donut (land vs sea split) above the existing tables |
| **Port sample** | Same pattern as port population, applied to sample figures | Same pattern as port population, applied to sample figures | Same pattern as port population, applied to sample figures |
| **Image quality results** | Mini horizontal bar-chart per metric (availability/marking/acceptable-quality) per port | Heatmap grid: ports (rows) × 3 quality metrics (columns), color-coded | KPI averages (overall availability/marking/acceptable % across all ports) + existing table |
| **Accuracy results** | Compare-bars: عامة / اشتباه / سليمة per port | Heatmap grid: ports × 3 accuracy categories | KPI totals (overall % across all ports) + existing table, respecting the existing data-sufficiency gate |

All variants must fit inside the same content budget the current variant uses for that
slide (same `TABLE_BUDGET_PX`-style math, same `BASE_ROWS_PER_PAGE`/pagination behavior
for the paginating pages). No variant introduces a new physical page count for a given
dataset.

---

## 4. Testing / verification

- Visual only — no new business logic, so no new unit tests are required beyond what
  existing sampling/aggregation tests already cover.
- Verification is manual, in the live preview: cycle every slide through all 4 variants
  with the existing synthetic fixture (14 ports, 4 risk stages, ~7.6% sample) and confirm
  no clipped totals rows, no overflow, no broken pagination, in both light and dark theme.
- Confirm production path: call `buildExecutiveDeckV2(input)` with no `opts` (or
  `variantPreview: false`) and confirm the output is byte-identical to pre-change output
  for variant-0-only rendering (i.e., the refactor that splits each slide function into a
  4-element array must not change variant 0's markup).

---

## 5. Out of scope (explicitly deferred)

- Wiring deck2 into the real app / Reports tab / Report Designer.
- Admin/manager role gating on who can change the chosen variant.
- Real workspace-folder persistence via `safeWriteJson` (the JSON file lives in a local
  dev mirror folder for now, shaped so that migration is a path change only).
- Month-over-month delta data for KPI cards.
