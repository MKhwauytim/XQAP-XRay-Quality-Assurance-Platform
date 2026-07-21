# Executive deck (deck2) — 4 design sets + switcher infrastructure

**Status:** approved by owner (design-language directions + scope), 2026-07-20
**Scope:** `src/data/reporting/executive/deck2/` — the v2 executive deck only. Does not touch `deck/` (v1, reference edition) or the Document/Workbook editions.

## Context

Every deck2 slide already renders through a 4-slot variant mechanism
(`bodyVariants: readonly [string, string, string, string]`, `renderVariants()`
in `slides.ts`) with a per-slide prev/next switcher (`v2-variant-switcher`).
Today all 4 slots hold an identical copy of the same body — the mechanism is
real, wired, and tested, but no slide has ever had more than one actual
design. Production (`variantPreview=false`) always renders slot `[0]`.

The owner wants this turned into a real, user-facing feature in the
generated report's own toolbar (the same place the light/dark toggle and
"طباعة / PDF" button already live): pick one of 4 coherent design sets for
the whole report, or override individual slides, while viewing the report.

This is three sub-projects. This spec covers the first two — the design
language (what "set 2" means, consistently) and the switcher infrastructure
(how picking it works). The third — actually building out 4 real variants
for the remaining ~11 slide types — is intentionally out of scope here; it's
incremental follow-up work, prioritized by the owner, each slide-type its
own small design pass.

## The 4 design sets

Each set is a **complete alternate visual philosophy**, not a palette swap.
A slide rendered in set 2 may use an entirely different DOM shape than the
same slide in set 1 (e.g., a table instead of a card grid) — that's the
point of the 4-panel variant-stack mechanism already in place.

### 1 — تنفيذي (Executive Cards) — *current default*

Dashboard feel: skim it in 10 seconds and get the shape of the month.

- **Cards over tables.** Rounded gradient-tinted cards (`.v2-num-tile`,
  `.v2-risk-tile`, `.v2-term-card` family), tone-coded left borders/badges,
  the shared hex-texture background.
- **Color carries meaning per-tone** (gold/blue/green/coral map to
  stage/category), used on badges, accents, and one hero number — never
  flooding a whole card.
- **One dominant number per card**, secondary stats smaller underneath.
- Charts: micro-gauges (`microArc`) and proportion bars, decorative-first.
- Typography: bold, large hero figures (up to `--fs-num-hero: 5rem`),
  generous card padding.

### 2 — امتثال (Compliance Table) — *reference: تقارير الالتزام للمنافذ.pptx*

Audit feel: verify the numbers, don't just get an impression.

- **Tables over cards**, everywhere a set-1 slide would use a stat tile grid.
  Every ranked list (top ports, risk stages, quality, accuracy) becomes a
  `deck-table` row set — reuses the exact `barCell`/`threshCell` machinery
  already built for the port/quality/accuracy pages, extended to slides that
  currently use tiles (risk stages, month-in-numbers-equivalent).
- **Three-tier threshold color** (green ≥ target, amber near, coral/red
  below) with an explicit written legend row under every scored table —
  the one gap the earlier audit found in set 1's quality/accuracy tables.
  This is where that legend finally ships (in set 2 only — set 1 stays as
  the previous audit left it, to avoid the `TABLE_BUDGET_PX` risk found
  then, unless a set-2 table budget is measured fresh for it).
- **Minimal card chrome.** Flat panels, thin borders, no gradients, no hex
  texture — visual weight comes from the grid lines and color tiers, not
  card decoration.
- Typography: smaller, denser, more rows visible per screen.

### 3 — تحريري (Minimal Editorial)

Calm feel: a short, quiet read; prints cleanly in black & white.

- **Whitespace over borders.** Thin single-pixel rules or nothing at all
  divide sections — no bordered/shadowed cards.
- **Near-monochrome.** Ink (white/navy per theme) for all body content; ONE
  accent color per slide (usually gold) reserved for the single most
  important number or a thin rule. No per-tone rainbow.
- **One number, very large; everything else recedes.** Secondary stats in
  small caps/muted text below, not boxed.
- Charts: sparse — a single thin line/bar where a chart is unavoidable, no
  decorative gauges.
- Typography-led: this set leans on type scale and spacing to create
  hierarchy, not color or containers.

### 4 — تصويري (Chart-Forward)

Visual-skim feel: get the shape of the data at a glance, precise numbers
secondary.

- **Every slide leads with a chart** (donut, bar, gauge, or the existing
  `funnel`/`rankedBar` primitives from `ui/charts.ts`) sized to dominate the
  slide; numbers annotate the chart rather than standing alone in tiles.
- **Color encodes category/series** (reuses `seriesColor`/`SERIES_ROLES`
  from `ui/tokens.ts` deliberately — the one set where a multi-hue palette
  per data series is the right call, not a top-N ranked list issue).
- Cards, where they exist at all, are just a chart + a one-line caption.
- Typography: smallest role of the 4 sets — the chart is the headline, text
  is a caption.

## What must stay constant across all 4 sets

Non-negotiable regardless of design set — these are report-correctness and
platform constraints, not style choices:

- **Every number renders from the same `ReportModel`.** No set invents its
  own aggregation; they only change *how* an existing figure is displayed.
- **RTL layout, Arabic labels, existing label-key conventions.**
- **Both light/dark theme** (`body.theme-light`) — a design set that only
  works in one theme isn't done.
- **Print output** (`@media print`) — must not clip, and must respect the
  per-slide print-include toggle already in place.
- **The `.slide{overflow:hidden}` / fixed-aspect-ratio page contract** — any
  new table/card geometry gets measured live in the browser before shipping
  (per the project's own established practice, and the overflow incident
  from earlier this session).

## Switcher infrastructure

### Data model

Two pieces of client-side state, held in memory only (see "Persistence"
below — explicitly NOT saved across reloads, matching the existing
light/dark toggle's behavior in this same toolbar):

- `globalIndex: number` (0–3) — the report-wide default design set.
  Defaults to `0` (تنفيذي, today's only fully-built set).
- `overrides: Record<slideId, number>` — per-slide exceptions. Empty by
  default.

Effective variant index for a given slide = `overrides[slideId] ?? globalIndex`,
**clamped to that slide's actual panel count** (see fallback below).

### Toolbar UI

A new control in `.deck-toolbar-actions` (`index.ts`,
`buildDeckV2Html`), placed beside the existing theme toggle and print
button:

```
[ ١  ٢  ٣  ٤ ]   ← segmented control, active index highlighted
```

Clicking a segment sets `globalIndex` and re-applies every slide's active
panel to `overrides[slideId] ?? newGlobalIndex` (an override, once set, is
NOT cleared by a global change — it's a deliberate exception, not a
temporary state. To remove an override, the user steps that slide's own
arrows until it matches the global choice again).

Per-slide arrows (`v2-variant-switcher`, already built) become visible in
PRODUCTION output too, not just `variantPreview`. Stepping a slide's arrows
writes to `overrides[slideId]`.

### Fallback for partially-built slides

Sub-project 3 rolls out incrementally — most slides will have 1 real body
and 3 duplicate placeholders for a while. The switcher must not offer a
choice that does nothing:

- `renderVariants()` already receives 4 bodies; change its contract so
  **a slide reports its real distinct-variant count** (dedupe identical
  strings, or — simpler and more explicit — require each slide builder to
  pass how many of its 4 slots are real, defaulting to 1).
- The per-slide switcher only renders (prev/next arrows visible) when that
  slide has ≥ 2 real variants. Slides with 1 real variant show no switcher
  at all (today's behavior for every slide, until sub-project 3 touches it).
- The global segmented control always shows all 4 segments (it's a
  report-wide preference), but selecting an index a given slide doesn't
  have simply leaves that slide on its own highest available index — no
  broken/blank panels, ever.

### Persistence

None. Matches the existing theme toggle in the same toolbar: resets to
defaults (`globalIndex = 0`, no overrides) every time the report is
reopened. If the owner later wants this remembered across reopens, that's
an explicit follow-up (`localStorage`, scoped per the exported file) — not
built here, to avoid scope creep into a persistence layer the sibling
control doesn't have either.

### File-size note

Every slide with N real variants ships N× that slide's markup (all panels
render into the DOM; only one is visible via CSS, same mechanism the dev
preview already uses). This is a real, growing cost as sub-project 3 fills
in more sets — worth watching against this report's own size budget as sets
2–4 get built out, though it's a separate self-contained file from the main
app bundle, not subject to `check:bundle-size`.

## Sub-project 3 — rollout order (future work, not built here)

Recommended order, roughly cheapest/highest-value first:

1. **مؤشرات الشهر** (currently hidden — good place to prototype set 2's
   table-first philosophy against, since it's not live yet)
2. Risk stages (tile grid → set 2 table equivalent)
3. Port population/sample pages (already table-based in set 1 — set 2 mostly
   inherits directly; sets 3/4 are the real design work here)
4. Quality/accuracy pages (add set 2's legend row here, per the note above)
5. Section separators, cover, TOC, glossary, closing (lower priority — less
   data-dense, less benefit from switching)

## Non-goals

- Not building a 5th "custom" set or a per-tile granularity switcher (only
  per-slide + global).
- Not persisting the choice across report reopens (see Persistence).
- Not touching the v1 deck (`deck/`) or Document/Workbook editions.
- Not retrofitting the earlier-audited quality/accuracy legend into set 1 —
  that stays as the prior session left it; the legend ships in set 2.
