# deck2 — Three Cohesive Variant Design Systems — Design Spec

**Date:** 2026-07-25
**Status:** Approved (owner-authorized autonomous execution; design content produced by Opus acting
as design advisor per owner's explicit instruction — "ask always opus 5... opus 5 is your advisor
for plans ideas and brainstorming and for revision and giving pointers and seeing visuals and
rating it")
**Owner:** Reporting (`src/data/reporting/executive/deck2/`)

> This spec formalizes Opus's full design-systems proposal. The complete proposal (identity,
> visual grammar, per-shape mapping, and page→slot assignment table for all ~18 pages) is
> reproduced in this session's transcript and should be treated as the authoritative source the
> implementation plan quotes from; this spec captures the decisions and architecture, the plan
> captures the exact code.

## 1. Correction to the owner's original ask

The owner's instruction ("build all 1/4... every set 2/4 is similar for all pages as a set... same
for 3/4... mix and match and still consistent") supersedes the earlier "one designer agent per
page, independent creative direction" approach from the prior turn. Each variant SLOT (1, 2, 3) is
now **one cohesive design system** applied consistently across every page, not an independently
designed alternate per page. `riskStagesSlide`'s already-shipped variant 1 (compare-bars + table)
is reconsidered below (§4) as a partial, ad-hoc precedent for slot 1 — kept in production
unchanged, but not extended verbatim as slot 1's system-wide language.

## 2. The three systems (full detail: Opus's proposal, this session)

- **Slot 1 — السجل (Ledger).** Verifiability. Tables and figure-strips only — no charts, no
  arcs, no donuts, no tiles. Magnitude is `barCell`'s zero-height background tint, never a new
  element. Color is strictly functional (threshold state + risk-level identity).
- **Slot 2 — الإحاطة (Briefing).** Recall. Every page leads with one large lede figure (a
  mechanically-templated Arabic sentence over real fields — never freeform prose), a ≤3-figure
  support strip, and at most one ranked-bar chart (≤6 categories). Tables are demoted to ranked
  bars (`.v2-bf-rank`).
  One page tone per page (assigned in the plan's page table, not left to per-page judgment).
- **Slot 3 — الشبكة (Grid).** Comparison. Every page becomes one matrix of `.v2-gd-cell`s,
  each column normalized to its OWN domain (printed in the column header — never a shared scale
  across unlike units), ink always `var(--navy)` (theme-invariant, since fills are opaque).

Slot 0 (today's design) is never touched. Full per-shape mapping (8 content-shape categories ×
3 systems) and the page→slot assignment table (with fixed Briefing page tones) are in the plan.

## 3. Blocking prerequisite — variant-choice key resolution (must land first)

`resolveVariantIndex` (`slideKit.ts`) currently looks up the EXACT slide id in the saved choices
map, falling back to variant 0 for anything not found. But 4 different paginated builders use 3
different id-suffix conventions:
- Always-suffixed: `slide-port-population-${page+1}`, `slide-port-sample-${page+1}`,
  `slide-quality-ports-${page+1}`, `slide-quality-accuracy-${page+1}` (suffix from page 1 onward).
- Conditionally-suffixed (bare on page 0, suffixed from page 1): `slide-s3-level-accuracy[-N]`,
  `slide-s3-port-agreement[-N]`, `slide-s3-workload[-N]`.

A deck saved as "all slot 2" would silently patchwork back to slot 0 the first month a port list
crosses a pagination boundary (page count changes → id changes/appears → no saved choice for the
new id). This is exactly the "random report" failure mode the owner asked to eliminate.

**Fix:** `resolveVariantIndex` resolves in order: exact id → **family key** (id with a trailing
`-\d+` stripped) → deck-wide default key `"*"` → 0. The admin UI (already built,
`DeckDesignCustomizer.tsx`) needs no change — it already writes whatever slide id
`DECK_VARIANT_SCRIPT`'s `persist()` reports; that script needs to report the FAMILY key (not the
per-page id) for the always/conditionally-suffixed builders, and the customizer's own choices
object should additionally let the admin set the `"*"` deck-wide default. Minimal version for this
pass: make `resolveVariantIndex` do the 3-tier lookup described above (this alone fixes the
pagination-drift bug even if the UI only ever writes per-page-family keys, since a family key
written once covers every page count); a `"*"` deck-wide default control in the customizer UI is a
nice-to-have, not required to close the bug, and can be deferred.

## 4. Reuse verdicts (binding on the plan)

- `.deck-table` / `portTableCard` / `fillerRow` / `DECK_TABLE_FILL_SCRIPT`: **unchanged**, formalized
  as Ledger's spine.
- `levelFiguresTable` / `.v2-level-table-card`: **generalize**. Extract `ledgerTableCard({ title,
  columns, rows, totals })` into `slideKit.ts`; reimplement `levelFiguresTable` on top of it with a
  byte-identity test against the current shipped output *first*, before any other page uses it.
  Keep `.v2-level-table-card` as an alias of the new `.v2-lg-table-card` so `slide-risk-stages`'s
  shipped CSS doesn't churn.
- `stageCompareBars` / `.v2-cbar*`: **do NOT extend to Ledger.** Repoint the CSS skeleton
  (`.v2-cbar-row` = labeled bar + value) to become Briefing's `.v2-bf-rank` (add rank numeral +
  secondary figure). `slide-risk-stages` slot 1 keeps rendering exactly as shipped — no production
  change to that page from this decision.
- `microArc`: export from `slides.ts` to `slideKit.ts` for Briefing's lede gauge.
- `percentHeatmap`: **do not stretch to mixed units.** Add a sibling `metricMatrix()` in
  `ui/analyticsCharts.ts` (per-column `{ label, domain, ramp }`) for Grid's port/stage matrices.
  Source-agreement's own Grid variant keeps using `percentHeatmap` near-as-is (single genuine 0-100
  scale — it was already right for this family).
- `.v2-totals-band`/`.v2-totals-item`: one markup component, restyled per system (reference example
  of shared-component-three-dressings).

## 5. Hard constraints (binding on every page, every system)

Reproduced from Opus's proposal §1 — implementers must re-verify these against the real
measured values, not re-derive:
- Deck is landscape (`297mm 167mm`), not portrait — the v1 report's A4 portrait `@page` is a
  different, firewalled edition.
- `.slide-body` = 459px, `.v2-port-col` card head = 71px, table budget = 388px, row ≈ 41px →
  `BASE_ROWS_PER_PAGE = 7`, `COMPRESS_OVERFLOW_MAX = 3`. Page count and row-slice are fixed
  upstream of `bodyVariants` (`planPortPages` runs before variants exist) — no system may change
  which rows a page shows or the deck's total page count.
- No layout-height-adding in-cell visuals (`barCell`'s zero-height background-tint pattern is
  mandatory wherever magnitude appears in a table cell).
- No invented data — every figure traces to a named `ReportModel` field; every generated sentence
  uses one of the fixed templates (§5.1 of Opus's proposal, quoted in the plan).
- Mandatory prose (causal caveats, scope notes, source-agreement footnotes) carries verbatim into
  all 4 variants.
- Both themes (dark default + `body.theme-light`) for every new selector; no hex literals
  (`npm run check:hex-literals` is a CI gate) — use `var(--token)` or `rgba()` of existing channels.
- Builders stay pure (no `Date`/`Math.random`/I/O) — same input ⇒ byte-identical output.
- Slot 0 stays byte-identical in production for every page, always (`deck2.test.ts` enforces this).
- The slide shell (eyebrow/headline/subhead/rail/foot) is not restyled by variants, except the one
  sanctioned `:has()` exception (color/font-weight/opacity/border only, both the production AND
  preview-mode selector forms) — see plan for exact selector pattern.

## 6. Sequencing

1. Fix the variant-key resolution bug (§3). Blocking — nothing else should ship before this.
2. Extract shared building blocks (§4) with byte-identity characterization tests on the pages that
   already use their un-generalized ancestors.
3. Land the 3 shared CSS blocks (`theme.ts`, ~120-180 lines each) plus ONE exemplar page in all 3
   systems: `slide-port-population-1` (most-repeated shape, paginated, exercises the compact tier).
4. **Opus review of the exemplar** (screenshots + code) before fanning out — replaces "owner
   sign-off" per the owner's explicit instruction to consult Opus instead of asking them.
5. Fan out: one agent per remaining page, building all 3 slots for that page in one pass (so a
   page's three variants are designed against each other, not sequentially), via a Workflow.

## 7. Testing / verification

- `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run check:hex-literals`,
  `npm run check:bundle-size` (re-run after each system's shared CSS block lands, not just at the
  end) all clean throughout.
- Byte-identity tests for slot 0 on every touched page (regression guard already established
  convention in `deck2.test.ts`).
- Visual verification via `deck-preview.html` (the dev-only synthetic-fixture tool — NOT a real
  mounted workspace, which needs a native OS picker this environment cannot drive) — screenshot
  each new variant in both themes, at base and compact pagination tiers, checking for clipped rows,
  lost totals rows, and general "10/10, easy to read" bar the owner set. This is the correct tool
  for this job (no auth/workspace mounting required) — the earlier admin-customizer feature's
  verification difficulty was from trying to mount a real workspace; this doesn't have that
  problem.
