# deck2 Design Systems — Shared Infrastructure + Exemplar Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared building blocks all three design systems (Ledger/Briefing/Grid) need, then prove the systems out on one exemplar page (`slide-port-population-1`, in all 3 systems at once) before fanning out to the remaining ~16 pages.

**Architecture:** Per `docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md` and the full Opus design-advisor proposal it summarizes (quoted extensively below — this plan's Task 2 reproduces the exact grammar rules per system so an implementer doesn't need to reconstruct them from the spec's summary alone). Three new/generalized shared primitives in `slideKit.ts`/`ui/analyticsCharts.ts`, three new CSS blocks in `theme.ts` (~120-180 lines each), and one page (`portPopulationSlideBuilders` in `slides.ts`) rebuilt in all three systems, replacing that page's `bodyVariants[1,2,3]` (currently duplicates of `[0]`).

**Tech Stack:** TypeScript, Vitest, plain template-string HTML/CSS.

## Global Constraints (binding on every task in this plan and every later fan-out task)

Reproduced verbatim from the design spec — treat as non-negotiable:

- **Deck is landscape** (297mm × 167mm / 16:9), not portrait. `.slide-body` = 459px, `.v2-port-col` card head = 71px, table budget = 388px, row ≈ 41px → `BASE_ROWS_PER_PAGE = 7`, `COMPRESS_OVERFLOW_MAX = 3`. **Page count and row-slice are fixed upstream of `bodyVariants`** — no system may change which rows a page shows or the deck's total page count. `planPortPages` already ran before your variant exists; you get the same slice as slot 0.
- **No layout-height-adding in-cell visuals.** Magnitude tint inside any table/matrix cell must be a CSS `background` sized by a `--w`/`--x` custom property (the existing `barCell`/`v2-bar-cell` pattern), never a new child element. This is what keeps the fragile totals-row pinning (`fillerRow`/`DECK_TABLE_FILL_SCRIPT`) valid.
- **No invented data.** Every number traces to a named `ReportModel` field. Any generated Arabic sentence uses one of the fixed templates in Task 2's Briefing section — never freeform prose.
- **Mandatory prose carries verbatim into all 4 variants** — not applicable to `slide-port-population-1` (it has no causal caveat), but every later fan-out task on a page that HAS one (marking-impact, quality-impact, workload, port-agreement) must keep it in all 3 new systems too.
- **Both themes, every new selector.** No hex literals (`npm run check:hex-literals` is a CI gate) — use `var(--token)` or `rgba()` of existing token channels.
- **Builders stay pure** — no `Date`/`Math.random`/I/O. Same input ⇒ byte-identical output.
- **Slot 0 stays byte-identical in production, forever.** Every task in this plan re-runs `deck2.test.ts`'s existing production-path assertions.
- **The slide shell (eyebrow/headline/subhead/rail/foot) is not restyled.** A variant owns `.slide-body` only.
- Per `CLAUDE.md`: same-day edit-log entry (new top section, no existing entry touched) + version bump, with real, reconciling `git diff --stat`/`count-lines` numbers — this has been a **repeated** source of review findings on prior branches this session; get it right the first time on every task.
- Visual verification uses `deck-preview.html` (the dev-only synthetic-fixture tool, `npm run dev` then navigate to `/deck-preview.html`) — NOT a real mounted workspace (needs a native OS picker no automation here can drive). Screenshot every new variant in both dark and light theme.

---

### Task 1: Extract `ledgerTableCard`, export `microArc`, add `metricMatrix`

**Files:**
- Modify: `src/data/reporting/executive/deck2/slideKit.ts` (new `ledgerTableCard`; re-export `microArc`)
- Modify: `src/data/reporting/executive/deck2/slides.ts` (`microArc` becomes exported; `levelFiguresTable` reimplemented on top of `ledgerTableCard`)
- Modify: `src/data/reporting/executive/deck2/ui/analyticsCharts.ts` (or wherever `percentHeatmap` lives — confirm the real path first) (new `metricMatrix`)
- Modify: `src/data/reporting/executive/deck2/theme.ts` (rename-alias `.v2-level-table-card` → keep as alias of new `.v2-lg-table-card`, per spec §4 — do not churn the already-shipped page's CSS)
- Create/modify test files for each new/changed export

**Interfaces:**
- Produces: `ledgerTableCard(opts: { title?: string; theadCells: string; bodyRowsHtml: string; totalsRowHtml: string; span: number; rowCount: number }): string` in `slideKit.ts` (shape closely mirrors the existing `portTableCard` — read that function first and reuse its `fillerRow`/span/rowCount conventions exactly, since Ledger's whole spine is "the existing table machinery, generalized," not a new mechanism).
- Produces: `microArc(pct: number): string`, now exported from wherever it's actually defined (currently `slides.ts`, private) — re-export via `slideKit.ts` if that's this codebase's existing convention for cross-file sharing (check how other shared helpers are exported/re-exported in this file first).
- Produces: `metricMatrix(data: { rowLabels: string[]; columns: Array<{ label: string; domain: [number, number]; ramp: "sequential-gold" | "diverging-green-coral"; values: (number | null)[] }> }, opts?: { emptyNote?: string }): string` — read `percentHeatmap`'s actual current signature and implementation first (it's the direct ancestor/sibling this generalizes from) and mirror its ink/`srTable`/`emptyState` conventions; each column normalizes independently to its OWN `domain` (never a shared scale), the domain is printed in the column header, ink is always `var(--navy)` (theme-invariant since fills are opaque, matching `percentHeatmap`'s own documented reasoning).

- [ ] **Step 1: Read the real current code for every piece you're generalizing**

Before writing anything: read `portTableCard` (slideKit.ts), `fillerRow` (slideKit.ts), `levelFiguresTable` + `microArc` (slides.ts), `percentHeatmap` + `srTable` + `emptyState` (wherever `ui/analyticsCharts.ts` or the actual file is — grep for `percentHeatmap` to find it) in full. Do not guess at their shapes from this plan's prose — read the real, current source, since exact signatures matter for byte-identity in the next step.

- [ ] **Step 2: Write a byte-identity characterization test FIRST, before changing anything**

Add a test (in `deck2.test.ts` or a new file, your call, following existing convention) that captures `riskStagesSlide`'s current variant-1 (`slide-risk-stages`, `data-variant-index="1"`) output verbatim against the existing synthetic fixture already used elsewhere in `deck2.test.ts`. This is your regression tripwire for Step 3 — run it, confirm it passes against the UNCHANGED code, before touching `levelFiguresTable`.

- [ ] **Step 3: Extract `ledgerTableCard`, reimplement `levelFiguresTable` on top of it**

Generalize `portTableCard`'s shape (header/body/totals-row/filler-row/span) into `ledgerTableCard` in `slideKit.ts`. Reimplement `levelFiguresTable` (in `slides.ts`) to call it instead of building its own `<table>` markup. Run Step 2's characterization test — it MUST still pass byte-for-byte. If it doesn't, your generalization changed real output; fix it until it does, don't relax the test.

Keep `.v2-level-table-card` in `theme.ts` as a CSS alias of whatever the new class name is (e.g. `.v2-level-table-card, .v2-lg-table-card { ... }` combined selector, or a `.v2-level-table-card` rule that's identical to `.v2-lg-table-card`'s — pick whichever is less repetitive, but the already-shipped page's rendered class names/CSS must not change).

- [ ] **Step 4: Export `microArc`**

Move or re-export `microArc` so it's callable from outside `slides.ts` (Briefing's lede gauge in Task 3 needs it). Follow this file's existing pattern for sharing a helper across `slides.ts`/`slideKit.ts`/`section3/*` (check how e.g. `STAGE_TONES`, `badgeIcon`, `fmtPct` are shared — same import/export convention).

- [ ] **Step 5: Add `metricMatrix` to the analytics-charts module**

Add the new function alongside `percentHeatmap`, matching its ink-safety and empty-state conventions exactly (opaque cell fills need theme-invariant ink; a column with no data renders its empty-state treatment, not a crash). Add a focused unit test (2-3 cases: normal data, a null cell, an empty column) — this is genuinely new code, not an extraction, so it needs its own from-scratch test coverage, not just a characterization test.

- [ ] **Step 6: Run the full suite, typecheck, lint, hex-literal check**

`npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run check:hex-literals` — all clean. `slide-risk-stages` variant 1 output must be byte-identical to before this task (Step 2's test is your proof).

- [ ] **Step 7: Edit log + version bump + commit**

---

### Task 2: Exemplar page — `slide-port-population-1` in all 3 systems

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (`portPopulationSlideBuilders`'s `bodyVariants`)
- Modify: `src/data/reporting/executive/deck2/theme.ts` (3 new shared CSS blocks: `.v2-sys-ledger`, `.v2-sys-brief`, `.v2-sys-grid` — these are DECK-WIDE blocks other pages will reuse, not page-specific; budget ~120-180 lines each including light-theme overrides)
- Modify: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: Task 1's `ledgerTableCard`, `microArc`, `metricMatrix`; the existing `collectPortStats`/`PortPopRow` data already feeding this page's slot 0; `barCell`/`threshCell`/`rateOf`/`maxOf` (unchanged shared numeric vocabulary per the design spec).
- Produces: `bodyVariants: [today's-slot-0-body, ledgerBody, briefingBody, gridBody]` for this one page only.

The exact per-system grammar to follow for this specific page (from the full design proposal):

**Ledger (slot 1):** "Today's slot-0 tables + ordinal badge + tabular numerals. This is the shape ledger changes least — correct, because slot 0 already leans this way." Concretely: reuse the existing land/sea `portTableCard`-style layout, but via the new `ledgerTableCard`, add a small ordinal badge (`.v2-lg-idx`) **inside** the first cell before the port name (not a new column — no column budget to spare on a half-width card), `font-variant-numeric: tabular-nums` on every numeric cell, outermost wrapper class `v2-sys-ledger v2-lg-port-population`.

**Briefing (slot 2):** "Lede = the leading port of this page's own slice (keeps it true per page), plus 2 support figures. Then rank rows for the whole slice." Concretely: `.v2-bf-lede` = a 3.2rem/900 display numeral (the leading port's image count from THIS page's own slice, never the whole month — C2/pagination-fixed-upstream applies), a one-line label using the fixed template `أعلى {noun}: {name} — {N} {unit}` (e.g. `أعلى منفذ: {portName} — {N} صورة`), a basis chip naming the denominator (this page's slice total). Below: a ≤3-figure `.v2-totals-band`-shaped support strip. Below that: `.v2-bf-rank` rows (ranked horizontal bars, one per port in this page's slice, magnitude-tinted, value at the bar's inline-end, rank numeral, port name, one secondary figure) — row height 44px base / 36px compact tier (see the design proposal's exact budget arithmetic: lede 90 + support 54 + 7×44 = 452 ≤ 459 at base tier; at compact tier the support strip is DROPPED, 90 + 10×36 = 450 ≤ 459 — implement this exact conditional, don't just always show the support strip). Page tone: **gold** (per the design proposal's fixed page-tone table for this shape). Outermost wrapper class `v2-sys-brief v2-bf-port-population`.

**Grid (slot 3):** "Ports (rows) × metrics (columns). Population: الصور / سليمة / اشتباه / نسبة الاشتباه." Concretely: use `metricMatrix` with row labels = port names (this page's slice), 4 columns (الصور — volume, sequential-gold ramp; سليمة — count, sequential-gold; اشتباه — count, sequential-gold; نسبة الاشتباه % — rate, could reasonably use sequential-gold too since there's no fixed target threshold for this specific metric on this page, unlike accuracy-vs-90%; use your judgment and document the choice). Land and sea as two separate matrices side by side (mirrors the existing land/sea split), or one combined matrix with a land/sea row-group divider — your call, but state which you chose and why in your report. Outermost wrapper class `v2-sys-grid v2-gd-port-population`.

- [ ] **Step 1: Write the failing tests**

Add tests to `deck2.test.ts` asserting: (a) slot 0 (today's design) is byte-identical to before this task — regression guard; (b) preview mode, panel 1 contains `v2-sys-ledger` markup and NOT `v2-sys-brief`/`v2-sys-grid`; (c) panel 2 contains `v2-sys-brief` and the lede figure text; (d) panel 3 contains `v2-sys-grid` and a `metricMatrix`-produced table/grid element. Use the existing test file's conventions for isolating one panel's HTML (see the pattern already used for `slide-risk-stages`'s variant tests — locate panels via `data-variant-index="N"` slicing).

- [ ] **Step 2: Run tests, verify they fail** (slot 0 test should pass trivially since nothing's changed yet; the panel-content tests should fail since bodyVariants[1,2,3] are still slot-0 duplicates)

- [ ] **Step 3: Implement all three systems' bodies for this page**, wiring `bodyVariants: [body, ledgerBody, briefingBody, gridBody]`.

- [ ] **Step 4: Write the 3 shared CSS blocks in `theme.ts`** (`.v2-sys-ledger`/`.v2-sys-brief`/`.v2-sys-grid` base rules + this page's page-local classes `.v2-lg-port-population`/`.v2-bf-port-population`/`.v2-gd-port-population`, both themes). Keep the shared-system rules genuinely reusable (a future page should be able to reuse `.v2-sys-brief .v2-bf-lede` etc. without redefining it) — that's the point of extracting them now rather than per-page later.

- [ ] **Step 5: Run tests, verify they pass. Run full suite, typecheck, lint, hex-literal check, bundle-size check.**

- [ ] **Step 6: Visual verification via `deck-preview.html`**

Start the dev server, navigate to `/deck-preview.html`, cycle `slide-port-population-1` (or whatever page the synthetic fixture actually numbers it as — check) through all 4 variants, screenshot each, in both dark and light theme, at whatever pagination tier the fixture produces. Look specifically for: clipped rows, a missing/misaligned totals row, RTL number reversal, unreadable contrast in either theme, and anything that would fail a "10/10, easy to read" bar. If you find an issue, fix it and re-screenshot before reporting done.

- [ ] **Step 7: Edit log + version bump + commit**

- [ ] **Step 8: Write a design-review request**

Append a section to your task report summarizing (with the exact screenshot file paths) what each of the 3 new variants looks like, so the controller can relay this to Opus (the project's design advisor) for a rating before the remaining ~16 pages are fanned out to this same pattern.
