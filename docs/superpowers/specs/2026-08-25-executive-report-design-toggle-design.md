# Executive report design toggle (deck3) — design spec

**Date:** 2026-08-25
**Status:** approved, pending implementation plan

## Problem

The owner supplied a high-fidelity design handoff (`design_handoff_xray_qa_deck/`,
originally outside the repo; checked into this repo at
`docs/design/design_handoff_xray_qa_deck/` so it travels with the spec/plan)
for a 21-slide Arabic executive deck with its own color palette, typography,
chart-construction pattern, and slide layouts. They want the ability to toggle
between the CURRENT executive deck (`deck2`, unchanged) and a NEW edition that
reproduces the handoff's exact visual design, wired to real report data, from
the Reports tab.

Explicit requirements gathered during brainstorming:
- `deck2` must stay exactly as it is today — no visual or behavioral change.
- The new edition must use REAL data (not the handoff's placeholder figures),
  sourced from computations that already exist in `deck2/section3/*` and
  `model/aggregates.ts`.
- The new edition's slide-building code should be reusable enough that
  additional deck2-only sections (`workloadAccuracy`, `dailyTrend`, `section4`
  accountability/coverage) can be added to this same visual skin later,
  without a redesign — but those extra sections are explicitly OUT of scope
  for this round; only the handoff's 21 slides ship now.
- The toggle's chosen edition (old/new) persists in the workspace (not just
  in-memory/localStorage) so it survives closing and reopening the Reports tab.

## Non-goals

- No changes to `deck2`'s code, tests, or output.
- No new fonts or logo assets — the handoff's Somar Sans weights and ZATCA
  logo are already embedded in this repo (`src/branding/somarFonts.ts`,
  `src/branding/zatca-logo.svg`) and will be reused as-is.
- No implementation of the deck2-only sections (workloadAccuracy, dailyTrend,
  section4) in the new skin this round — only the extensibility scaffold for
  them.
- No change to `DeckDesignCustomizer.tsx`'s per-slide variant-switcher system
  — that customizer is deck2-specific and is untouched. The new edition does
  not get a variant-switcher in this round.

## Architecture

New sibling module to `deck2/`, same shape:

```
src/data/reporting/executive/deck3/
  theme.ts       # handoff's exact tokens (colors, type scale, spacing, slide
                 # chrome: 1920x1080 canvas, footer "name / NN / 21")
  chartKit.ts    # reusable pure-CSS bar-chart primitives (see below)
  slideKit.ts    # reusable slide-template functions (see below)
  slides.ts      # the concrete 21 handoff slides, built from slideKit calls
  index.ts       # buildExecutiveDeckV3(input, names) / openExecutiveDeckV3(...)
  deck3.test.ts  # slide-count/order/figure assertions
```

### `theme.ts`

Encodes the handoff's design tokens verbatim (from its README "Design
Tokens" section):
- Colors: page bg `#f9f8f5`, panel/plot tint `#f2f0ea`, land panel `#f4efe4`,
  sea panel `#eaeff5`, callout tint `#eef1f5`, positive/negative cell tints,
  primary navy `#10304f`, cover navy `#0f2b46`, body text `#22303e`, muted
  text `#5d6b7a`, hairline `#e3e0d8`, gold `#b48a3c` (dark `#8a6526`, light
  `#c9a45e`/`#d9b877`), blue `#3f6fa8` (dark `#2c5580`), green `#2e7d4f`, red
  `#b8543f`, neutral bar `#d9d5ca`.
- Typography: Somar Sans via the existing `SOMAR_SANS_WOFF` export
  (`src/branding/somarFonts.ts`) — same 4 weights (300/400/500/700) the
  handoff calls for. Type scale per the README (cover H1 110px, divider H1
  82px, slide H2 56px, etc.), minimum 24px per the handoff's own rule.
- Slide chrome: 1920×1080 canvas, `dir="rtl"`, content padding `84px 100px
  56px` / cover padding `96px 120px 84px`, footer row with page indicator.
  Viewer/print/keyboard-nav mechanics reuse the same open-in-new-window +
  print pattern `deck2/index.ts` and `deck2/viewer.ts` already use — no new
  viewer infrastructure.

### `chartKit.ts`

The handoff's chart construction is called out as "critical" in its README
and must be preserved exactly (this is what makes the charts look like the
handoff, not deck2):
- Plot box: `position:relative`, tinted background, 2px `#10304f` bottom
  border as the baseline.
- Bars: absolutely positioned flex row (`position:absolute;inset:0`) whose
  cells stretch to full height so percentage-height bars resolve correctly.
- Value labels inside the bar top, `z-index` above the dashed reference
  lines.
- Reference lines: `position:absolute` dashed lines computed on the same
  `(value-min)/(max-min)*100` scale as the bars.
- Category labels as a sibling row below the plot, not inside it.

Exposed as `barChart(spec)` (single series per category, e.g. per-port
accuracy) and `groupedBarChart(spec)` (paired series per category, e.g.
level 1 vs level 2 accuracy per port) so every chart slide calls one of two
functions instead of hand-rolling markup.

### `slideKit.ts`

Generic, data-driven template functions — this is the extensibility
mechanism the owner asked for. Each function takes typed data and returns
slide HTML in the handoff's visual language:
- `coverSlide(meta)` / `closingSlide(meta)` — dark cover/closing per slide
  1/21.
- `contentsSlide(rows)` — the agenda grid (slide 2).
- `glossaryCard(terms)` / `levelDefinitionCard(levels)` — definition-card
  grids (slides 3–4).
- `kpiGrid(cells)` — the 2×3 KPI cell grid (slide 5).
- `sectionDivider(meta)` — dark divider slides (6, 9, 14).
- `twoPanelTable(land, sea)` — the land/sea tinted-panel table pattern used
  by population (slide 7), port distribution (slide 8), and per-port
  accuracy (slide 11).
- `matrixSlide(cells)` — the 2×2 confusion-matrix layout (slide 15).
- `comparisonPanels(panels)` — the two-tinted-panel metric-row layout used
  by slides 10 and 16.
- `impactSplitSlide(left, right)` — the symmetric two-column callout layout
  (slide 20).

A future `workloadAccuracy`/`dailyTrend`/section4 slide in this skin becomes
a new `slides.ts` entry that calls one of these (or a small new one) with
real data — not a new theme/chart pass. This is documented as a comment at
the top of `slideKit.ts` so the intent isn't lost.

### `slides.ts`

The 21 slides in the handoff's fixed order, each built from `slideKit` +
`chartKit` calls, fed by data already computed for `deck2`:

| Handoff slide | Data source (existing) |
|---|---|
| 1 Cover, 2 Contents | static + month/report meta |
| 3 Glossary — terms, 4 Glossary — risk levels | static text (handoff's locked wording) + live per-level population/sample share from `model/aggregates.ts` |
| 5 مؤشرات الشهر (KPIs) | `model/aggregates.ts` |
| 6 Section 1 divider | static |
| 7 مجتمع الفحص (population/sample per level) | `model/aggregates.ts` |
| 8 توزيع المنافذ (port distribution) | `model/aggregates.ts` / port breakdown already used by deck2's stage×port slides |
| 9 Section 2 divider | static |
| 10 دقة الرصد العامة | `deck2/section3/levelAccuracy.ts` |
| 11 الدقة حسب المنفذ | `deck2/section3/portAgreement.ts` |
| 12 رسم الدقة حسب المنفذ | `deck2/section3/portAgreement.ts` via `chartKit.barChart` |
| 13 رسم الدقة حسب المستوى | `deck2/section3/levelAccuracy.ts` via `chartKit.groupedBarChart` |
| 14 Section 3 divider | static |
| 15 مصفوفة نتائج الوسائل الآلية | `deck2/section3/outcomeMatrix.ts` |
| 16 دقة إجابات المستوى الأول والثاني | `deck2/section3/levelAccuracy.ts` |
| 17/18 دقة المستويين في المنافذ البرية/البحرية | `deck2/section3/levelAccuracy.ts` + `portAgreement.ts` via `chartKit.groupedBarChart` |
| 19 توافق النتائج (security teams + risk engine) | `deck2/section3/sourceAgreement.ts` + `riskEngineAgreement.ts` |
| 20 أثر التحديد وجودة الصورة | `deck2/section3/markingImpact.ts` + `qualityImpact.ts` |
| 21 Closing | static |

Locked terminology from the handoff README (نتائج الوسائل الآلية, صورة/صور,
نتيجة/نتائج, نسبة تحديد موقع الاشتباه, دقة السليمة/الاشتباه/العامة, security
team names, percentage-with-both-values diff phrasing) is used verbatim in
static strings/labels — matches the existing app convention of Arabic
strings living as label keys where they're reusable, hardcoded where they're
one-off slide copy tied to this exact layout.

### `index.ts`

`buildExecutiveDeckV3(input: ExecutiveReportInput, names): Promise<string>` —
same signature shape as `buildExecutiveDeckV2`, async/main-thread-chunked
the same way (reuses `yieldToMain()`), and `openExecutiveDeckV3(...)` opens
the built HTML the same way `openExecutiveDeckV2` does. Both dynamically
imported at the call site (`TabView.tsx`), so the new module never loads —
and never adds to the initial bundle path — unless the toggle is on.

## Toggle + persistence

New shared file `src/data/reporting/executive/deckEditionPreference.ts`:

```ts
export type ExecutiveDeckEdition = "v2" | "v3";
export type DeckEditionPreference = {
  edition: ExecutiveDeckEdition;
  updatedAt: string;
  updatedBy: string;
  revision?: number;
  _writeToken?: string;
};
export async function loadDeckEditionPreference(directoryHandle): Promise<DeckEditionPreference | null>;
export async function saveDeckEditionPreference(directoryHandle, edition, updatedBy): Promise<{ok:true}|{ok:false,error:string}>;
```

Implementation mirrors `deck2/styleChoices.ts` exactly: `getTemplatesRoot`
for the directory, `safeReadJson`/`safeWriteJson` for the file
(`executive-deck-edition.json`), `withResourceLock` + `casLoop` for the
write (same shared-multi-admin-file contract, since this is a workspace-wide
setting like style choices, not per-user). Missing file / read failure
defaults to `"v2"` — deck2 stays the default with no workspace file present.

### UI wiring (`TabView.tsx`)

- On mount (alongside the component's existing workspace-scoped loads),
  `loadDeckEditionPreference` is read once into local state
  (`deckEdition: "v2" | "v3"`).
- A labeled toggle "التصميم الجديد" renders next to the existing executive
  deck export control. Flipping it: (1) updates local state immediately so
  the very next export/preview uses the new edition, (2) calls
  `saveDeckEditionPreference` in the background (gated by the same
  `canMutate("export-reports")` capability check the customizer's Save
  button already uses) so it persists without a separate save step — a
  single boolean doesn't warrant the customizer's batch-save UX.
- `generate("executive-deck")` (~TabView.tsx:638) and the `handleExport("deck")`
  path (~TabView.tsx:503) both branch on `deckEdition`: `"v3"` dynamically
  imports `deck3/index.ts` and calls `openExecutiveDeckV3(execInput, names)`;
  anything else keeps today's `openExecutiveDeckV2(execInput, names,
  saved?.choices)` call unchanged. `deck3` has no style-choices file to load
  (no variant switcher in this round), so that branch skips
  `loadDeckStyleChoices` entirely.

## Error handling

- Preference load failure (corrupt file, missing workspace) → default to
  `"v2"`, same silent-fallback contract `loadDeckStyleChoices` already has
  (returns `null`, caller treats as "no override").
  Preference save failure → toast error via the existing `showToast("error",
  ...)` pattern, edition stays flipped locally for this session's exports
  even if the persisted write failed (matches how style-choices save errors
  are surfaced without discarding in-memory state).
- `deck3` build failure → caught the same way `handleExport`/`generate`
  already wrap every report builder call (`catch { showToast("error", "حدث
  خطأ أثناء توليد التقرير."); }`) — no new error path needed.

## Testing

- `deck3.test.ts` — builds a deck from a synthetic `ExecutiveReportInput`
  (same fixture style as `deck2.test.ts`), asserts: 21 slides present in the
  handoff's order, each slide's key figures match the input's computed
  aggregates (not hardcoded/placeholder numbers), locked terminology strings
  appear verbatim, footer page indicators are correct and sequential.
- `deckEditionPreference.test.ts` — CAS round-trip (save → load → matches),
  default-to-"v2" on missing/corrupt file, concurrent-write conflict retry
  (mirrors `styleChoices.ts`'s existing test coverage if present, otherwise
  a minimal version of it).
- `chartKit`/`slideKit` get lightweight unit tests only where they contain
  actual logic (percentage-scale math for reference lines, column-count
  layout for variable-length term lists) — pure layout markup doesn't need
  its own test beyond the `deck3.test.ts` integration coverage.
- `TabView.tsx` toggle: extend its existing test file with a case that
  flips the toggle and asserts the `v3` build path is invoked instead of
  `v2` (mock the dynamic imports the way existing export-path tests already
  do).

## Tier / gates

Tier 3 (new module + architecture): full gate sweep before release —
`lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`,
`check:release`, `check:vendor`, `build`, `check:bundle-size`. Bundle-size
check matters here specifically because this adds a new deck module, even
though it's dynamically imported.

## Open items carried forward (not blocking this spec)

- Extending this skin to `workloadAccuracy`/`dailyTrend`/`section4` is
  future work, tracked here as an explicit non-goal, enabled by `slideKit`'s
  generic shape but not implemented now.
- No variant-switcher / customizer support for `deck3` in this round.
