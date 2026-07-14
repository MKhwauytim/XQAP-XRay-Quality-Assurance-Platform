# deck2: القسم 3 — الدراسات المتقدمة (Advanced Studies) — Design

**Status:** design approved by user in conversation; not yet implemented.
**Scope:** a new third section in the executive deck v2 (`src/data/reporting/executive/deck2/`),
following the same section-separator + content-pages pattern already used by
القسم 1 (مجتمع الفحص) and القسم 2 (نتائج فحص الجودة) in `buildDeckV2Slides` (`index.ts`).

## 1. Goal

Add four new analytical pages, in this order:

1. **موقع الاشتباه** — frequency ranking of where in the vehicle/cargo a confirmed اشتباه was found.
2. **دقة المستوى الأول مقابل الثاني حسب المنفذ** — per-port comparison of level-1 vs level-2 accuracy.
3. **الدقة حسب جودة الصورة** — overall accuracy broken down by image-quality tier (عالي/متوسط/منخفض).
4. **الدقة حسب حجم المنفذ** — overall accuracy broken down by port-volume tier (top/middle/bottom
   third of ports by case count).

Reference: no visual mockup was supplied for this section (unlike the stage×port grid work) —
layout choices below reuse existing deck2 components verbatim wherever the shape matches, to
keep this section visually consistent with sections 1–2 rather than introducing a new visual
language.

## 2. Data mapping

### 2.1 New field: `suspicionLocation` on `ExecutiveReportRow`

موقع الاشتباه is not currently exposed as a fixed field — it exists only as a template-defined
combobox field (`fSuspicionLocation`, default template,
`src/components/Sidebar/Tabs/TemplateBuilder/index.tsx` ~line 137–143) with these predefined
options: الكبينة، الحمولة، العجلات، الإطارات، الباب الخلفي، السقف، الأرضية، الخزان، الجانب
الأيمن، الجانب الأيسر. It's only shown/answered when the field-level result is اشتباه.

Adding it as a first-class row field follows the **exact existing pattern** used for
`imageQuality`, `hasMarking`, `suspicionLevel`, etc. — all of which are configurable-label,
template-answer-extracted fields, not hardcoded to one template's field IDs:

**`src/data/reporting/executiveReportTypes.ts`:**
- Add `suspicionLocationLabel: string` to `ExecutiveReportFieldMappings` (~line 147–157).
- Add `suspicionLocationLabel: "موقع الاشتباه"` to `DEFAULT_EXEC_FIELD_MAPPINGS` (~line 188–198).
- Add `suspicionLocation: string | null` to `ExecutiveReportRow` (~line 30–65, alongside
  `suspicionLevel`/`suspectedTypes`).

**`src/data/reporting/executiveReportData.ts`, `buildExecutiveReportRows` (~line 122–160):**
Add one line alongside the existing extraction calls:
```ts
const suspicionLocation = asText(answerValue(answers, fieldIdsByLabel, fieldMap.suspicionLocationLabel));
```
and include it in the returned row object. `asText` already exists (line 48) and does exactly
what's needed (null for empty/missing, trimmed string otherwise) — no new helper required.

This is a small, contained addition to an existing, well-established extraction pattern — not
new plumbing.

### 2.2 Page 1 — موقع الاشتباه: data source

Group `model.rows` where `imageResult === "اشتباه"` by `suspicionLocation` (rows with `null`
location — i.e. اشتباه cases where the field wasn't answered — are counted in a "غير محدد"
bucket, same convention `collectStagePortStats`/`collectPortStats` already use for missing
`portName`/`stage`). Compute count and percentage of total اشتباه cases per location, exactly
the shape `ReasonCount` already has (`{ reason: string; count: number; percentage: number }`,
`executiveReportTypes.ts` ~line 95–99) — reusing that type directly rather than defining a new
one, and following the same sort order `countReasons()` already uses (count descending, then
alphabetical Arabic tie-break — `executiveReportData.ts` ~line 71–84). This is the same shape
and computation style already used for `missingImageReasons`/`lowQualityReasons`.

### 2.3 Page 2 — دقة المستوى الأول مقابل الثاني حسب المنفذ: data source

**No new aggregation needed.** `model.population.byPort` (`PortProfile[]`) already has
`levelOneAccuracy: number | null` and `levelTwoAccuracy: number | null` per port
(`executiveReportTypes.ts` line 80–81), computed with the existing reliability gate
(`isReliable = portStudied >= config.minimumReliableSampleSize`, `executiveReportData.ts`
line 320, 337–338 — null when a port's studied count is below the configured
`minimumReliableSampleSize`, default 30). `byPort` is already sorted by population descending
(`executiveReportData.ts` line 373).

**Design simplification:** unlike the existing land/sea-split quality/accuracy port pages
(`qualityPortSlideBuilders`/`accuracyPortSlideBuilders`), this page uses **one unified table**
(not split by land/sea) — land/sea isn't the axis of interest for an L1-vs-L2 comparison, and
splitting would double the page count for no analytical benefit. Top-N ports by population
(same pagination technique as the existing `qualityTable`/`accuracyTable` — `BASE_ROWS_PER_PAGE`
budget, continuation pages if the port list overflows), plus an overall totals row using the
already-computed global `model.kpis.levelOneAccuracy`/`levelTwoAccuracy` (not a fresh sum —
same "pin to the authoritative KPI, don't recompute" principle established for the stage×port
grid work after its Task 1 review finding).

### 2.4 Page 3 — الدقة حسب جودة الصورة: data source (new aggregation)

Group `model.rows` where `answerStatus === "submitted"` by `imageQuality` (three groups: عالي،
متوسط، منخفض — rows with `imageQuality === null` are excluded, not bucketed, since "quality
unknown" isn't one of the three tiers being studied). Within each group, compute accuracy using
the **same reliability gate** as everywhere else in this codebase:
```ts
const evaluated = groupRows.filter(r => r.imageResultAccurate !== null);
const correct = evaluated.filter(r => r.imageResultAccurate === true).length;
const isReliable = evaluated.length >= config.minimumReliableSampleSize;
const accuracy = isReliable ? (correct / evaluated.length) * 100 : null;
```
This mirrors `executiveReportData.ts` line 320–323's `isReliable`/`accuracy` pattern exactly,
just grouped by quality instead of by port.

### 2.5 Page 4 — الدقة حسب حجم المنفذ: data source (new aggregation)

**Tiering (terciles by rank, not fixed population thresholds):** sort `model.population.byPort`
by `population` descending (already sorted this way), split into three equal-ish groups by
**rank position**, not by an absolute case-count cutoff — e.g. with 14 ports, ranks 1–5 are
"مرتفع الحجم", 6–9 "متوسط الحجم", 10–14 "منخفض الحجم" (`Math.ceil(portCount / 3)` per tier).
Rank-based tiering was chosen over fixed thresholds (e.g. "500+ cases = high volume") because
absolute cutoffs don't generalize as monthly case volume shifts — a tier should always mean
"top/middle/bottom third of this month's ports," not an arbitrary fixed number that might put
every port in the same bucket some months and none in it other months.

For each tier, pool the rows belonging to that tier's ports and compute accuracy with the same
reliability-gated pattern as §2.4 (evaluated count, correct count, `isReliable` against
`config.minimumReliableSampleSize`).

## 3. Page layout

All four pages are regular `v2Slide()` slides in section `section3`, following
`sectionSeparatorSlide(3, "section3", ...)` in `buildDeckV2Slides` (mirroring how sections 1–2
start). Two registries need a new entry each (both already have one line per existing section,
so this is a small, mechanical addition, not new structure):
- `NAV_SECTIONS` (`slides.ts` ~line 108–109): add `section3: "القسم 3 — الدراسات المتقدمة"`.
  This also extends `NavSectionKey` (a `keyof typeof NAV_SECTIONS` type alias, line 111), so no
  separate type edit is needed.
- `sideRail()`'s `tabs` array (`slides.ts` ~line 122–125, the printed side-rail tab list): add
  `{ key: "section3", label: "الدراسات المتقدمة" }` alongside the existing `section1`/`section2`
  entries — otherwise the printed side rail (which appears on every content slide) won't show a
  tab for the new section, even though the pages themselves would still render fine.

- **Page 1 (موقع الاشتباه):** a single ranked list card — each row: rank number (reusing the
  `.deck-agenda-num`-style numbered circle), location label, a proportional CSS bar (reusing the
  `.bar > i` linear-gradient bar pattern from `theme.ts`, or the deck2 equivalent if one exists;
  otherwise a small new bar-fill class following that same visual language), count, and
  percentage. No table — this is a single-column ranked list, not a grid.
- **Page 2 (دقة المستوى الأول/الثاني):** one `.deck-table`, columns المنفذ | دقة المستوى الأول |
  دقة المستوى الثاني, top-N + الإجمالي row (pinned to `model.kpis.levelOneAccuracy`/
  `.levelTwoAccuracy`, per §2.3). Null accuracy (insufficient sample) renders via the existing
  `.insuff` `"—"` pattern (`pctCell`-style, already used elsewhere in `deck2/slides.ts`).
- **Page 3 (جودة الصورة):** reuses `.kpi-band n3` verbatim — three `kpiTile`-equivalent cards
  (deck2's own tile markup, matching `riskStagesSlide`'s stat-card visual style), each showing
  the tier label, accuracy % (or "—" if not reliable), and evaluated-image count. Tone mapping:
  عالي=green, متوسط=gold, منخفض=coral (matching the same semantic colors already used for
  quality elsewhere in the deck, e.g. `v2-term-card` tones).
- **Page 4 (حجم المنفذ):** identical 3-tile layout to Page 3, tiers مرتفع/متوسط/منخفض الحجم
  instead of quality levels, same tone convention repurposed (مرتفع=green, متوسط=gold,
  منخفض=coral) for visual consistency between the two tier-based pages.

## 4. Non-goals / explicit decisions

- Page 1 shows an **overall** frequency ranking, not broken down per port (simpler scope,
  confirmed with the user).
- Page 2 shows **plain side-by-side accuracy**, no L2-correction/regression detail per port
  (that data — `levelTwoCorrectionRate`/`levelTwoRegressionRate` — is currently global-only on
  `ExecutiveKPIs`, not per-port; adding a per-port version was explicitly declined as
  out-of-scope for this pass).
- Page 3 shows **one combined accuracy figure per quality tier**, not split by L1/L2 (simpler
  scope, confirmed with the user).
- Page 4 uses **rank-based terciles**, not fixed volume thresholds (see §2.5's reasoning) — this
  is a design decision made without a specific reference mockup, flagged here for the user's
  spec review in case a different tiering scheme (e.g. fixed thresholds, or a 2-tier split) is
  preferred.
- No new chart library — everything reuses deck2's existing static HTML/CSS component
  vocabulary (`.deck-table`, `.kpi-band`, numbered-list/bar patterns), consistent with the rest
  of the deck's "no runtime scaling, no external chart lib" convention.

## 5. Testing

- Unit test for the `suspicionLocation` extraction: a row with a template-answered موقع
  الاشتباه field produces the expected string; a row with no answer (or result ≠ اشتباه)
  produces `null`.
- Unit test for each new aggregation (location ranking, quality-tier accuracy, volume-tier
  accuracy): known small fixtures with hand-computed expected counts/percentages/accuracy,
  including the reliability-gate edge case (evaluated count just below/at
  `minimumReliableSampleSize` → `null`/non-null accuracy).
- Visual check in `deck-preview.html` once implemented, same as the stage×port grid work.
