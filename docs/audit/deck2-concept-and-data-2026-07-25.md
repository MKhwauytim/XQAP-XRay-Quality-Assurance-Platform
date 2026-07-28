# deck2 — Concept & Data Survey

**Date:** 2026-07-25
**Scope:** Read-only research. No application code was changed to produce this report.
**Purpose:** Ground truth before the next design/engineering pass on the executive deck ("deck2",
`src/data/reporting/executive/deck2/`) — (1) what every current page actually shows and exactly
which data feeds it, and (2) what else already exists in the app, unused, as raw material for new
pages.

**Files read to produce this report:** `deck2/index.ts`, `deck2/slides.ts`, `deck2/slideKit.ts`,
`deck2/theme.ts` (skimmed for CSS/variant plumbing), `deck2/section3/index.ts` and all six page
modules under `deck2/section3/`, `model/reportModel.ts`, `executiveReportTypes.ts`,
`executiveReportData.ts` (referenced), `executiveKpiProfiles.ts` (referenced),
`model/aggregates.ts`, `model/reviewerKpis.ts`, `executiveEmployeeData.ts`, plus a broad pass over
`src/data/population`, `src/data/sampling`, `src/data/distribution`, `src/data/answers`,
`src/data/templates`, `src/data/approvals`, `src/data/referral`, `src/data/feedback`,
`src/data/backup`, `src/data/audit`, `src/data/notifications`, `src/data/reportDesigner`, and
`src/auth`. Every "unused" claim in Part 2 was verified with a `grep` across
`src/data/reporting/executive/deck2` (production code, `.test.ts` excluded) before being listed.

A terminology note up front, since the task and the code both use "dev-preview tool" loosely:
deck2 has its own standalone dev-only preview harness — `src/dev/deckPreview.ts` /
`deck-preview.html`, built against a synthetic fixture (`deckPreviewFixture.ts`) — whose entire
purpose is the **style-variant switcher** (`variantPreview: true`, `DECK_VARIANT_SCRIPT` in
`deck2/index.ts`, persisted via `src/dev/deckStyleChoicesPlugin.ts` to
`dev-workspace/6-templates/deck-style-choices.json`). That is the tool the brief means by
"currently-standalone dev-preview tool ... wire into the real app." It is a **different** thing
from `ReportDesigner` (`src/data/reportDesigner/`, the `reports/report-designer` sub-tab), which is
already wired into the app as a free-form drag-and-drop table/chart/KPI canvas builder — that one
is live, just architecturally unrelated to deck2.

---

## Part 1 — What deck2 currently shows, page by page

### How the deck is assembled

`buildDeckV2Slides` (`deck2/slides.ts`) builds one flat array of slide HTML strings in this fixed
order (see the function's own page-numbering block, ~line 1538):

1. Cover
2. Table of contents (المحتويات)
3. *(dormant, currently hidden — see below)* مؤشرات الشهر
4. Glossary — 2 pages (مستويات المخاطر, then المصطلحات الرئيسية)
5. **Section 1 — مجتمع الفحص**: separator → risk-stages page → port-population page(s) →
   port-sample page(s) → stage×port population page → stage×port sample page
6. **Section 2 — نتائج فحص الجودة**: separator → image-quality page(s) → accuracy page(s)
7. **Section 3 — التحاليل المتقدمة** (`section3/index.ts`): separator → workload-vs-accuracy
   page(s) → level-accuracy page(s) → source-agreement page → port-agreement page(s) →
   marking-impact page → quality-impact page
8. Closing (data provenance)

Total page count is **not fixed** — every "page(s)" above paginates independently at runtime via
`planPortPages`/`BASE_ROWS_PER_PAGE` (7 rows/page baseline, a `compact` tier absorbs a 1–3-row
overflow onto one page, otherwise it spills to a continuation page). The number of land/sea ports,
and how many ports clear the relevant filter, decides the real page count every month.

Every slide builder returns `bodyVariants: readonly [string,string,string,string]` — four HTML
strings. In production (`variantPreview` false, the only mode real users ever see) only
`bodies[0]` renders (`renderVariants` in `slideKit.ts`); the other three only render in the
dev-preview harness. **Only one page in the whole deck has more than one distinct real layout
in that array today: `riskStagesSlide`** (`bodyVariants: [body, body2, body, body]` — slots 2 and
3 duplicate slot 0). Every other slide in the deck passes the *same* HTML string four times
(`[body, body, body, body]`), i.e. is still "1/4 built" in the brief's terms — the switcher
exists and works, but only one page has actually used it to ship an alternate design.

### Page-by-page catalog

#### 1. الغلاف (Cover) — `coverSlide`
- **Answers:** identity/orientation page — report title, study period, issue date, org hierarchy.
- **Fields:** `model.summary.periodId` (shown twice: hero lockup + meta row), `ORGANIZATION_PATH`
  (a branding constant, not model data), `generatedAt` (a `Date` param, not model data).
- **Variants:** 1/4 (`[coverBody, coverBody, coverBody, coverBody]`).
- **Complexity:** hero title + 4 meta chips (period/date/department/section) + org-logo block +
  two decorative SVG layers (`coverMeshSvg` seeded off `model.summary.periodId`, `coverBand`'s
  static diagonal pattern). No tables, no charts of real numbers beyond the 4 meta strings.

#### 2. المحتويات (TOC) — `tocSlide`
- **Answers:** what's in the report and why, with page ranges.
- **Fields:** `tocItems` built in `buildDeckV2Slides` from `model.population.total`,
  `model.sample.total`, `model.summary.overallAccuracy`, `sectionThree.length` (page-range math
  only), plus the static glossary-term count.
- **Variants:** 1/4.
- **Complexity:** a card grid (3–4 cards depending on whether section 3 has pages), each with an
  icon, one-line goal, a headline figure, and a computed page-range chip.

#### 3. مؤشرات الشهر (month-in-numbers) — `monthInNumbersSlide` — **currently hidden**
- `SHOW_MONTH_NUMBERS_SLIDE = false` in `slides.ts` (~line 1473): the function, its
  `summaryPortTable` helper, and its TOC entry all still exist in the codebase but are skipped at
  build time — "dormant, not dead," per the code's own comment.
- **Fields (when it renders):** `model.summary.overallAccuracy`, `model.population.suspicionRate`,
  `model.population.suspicious`, `model.sample.coverage`, `model.sample.total`,
  `model.population.total`, `model.sample.studied`, `model.sample.completionRate`, plus
  `collectPortStats(model)` (top-3 land/sea ports by volume, from `model.rows`).
- **Variants:** 1/4. Not currently in the live output, so not part of "what the deck shows" today.

#### 4–5. المعجم (Glossary) — `glossarySlideBuilders`, two pages
- **Page 1 — مستويات المخاطر:** one full-height card per risk level (`RISK_LEVELS`, a hardcoded
  Arabic definition/name/icon per level). **Verified: `glossarySlideBuilders` takes only
  `variantPreview` as a parameter — no `ReportModel` at all.** The one apparently-live figure per
  card, labeled "وزن العينة", reads `LEVEL_DRAW_WEIGHTS`, which is derived once at module load
  from `DEFAULT_SAMPLING_RULES` (`src/data/population/populationConfig.ts`) — a **static
  configuration constant**, not a per-month measurement. (The doc comment above `levelCard`
  describes the figure as "this month's live share... from `model.population.byStage`" — that is
  not what the code does; there is no `model` in scope to read from. Worth reconciling comment vs.
  implementation, or deciding which one is the intended behavior, before redesigning this page.)
- **Page 2 — المصطلحات الرئيسية:** two tone-coded term bands (`GLOSSARY_CATEGORIES`), fully
  static Arabic term/definition pairs.
- **Variants:** 1/4 each.
- **Complexity:** page 1 is a 4-column tile grid; page 2 is two 4-term card grids. Neither page
  carries any live number beyond the static sampling-rule weight noted above.

#### Section separators — `sectionSeparatorSlide` (×3: section1 gold, section2 cyan, section3 gold)
- **Answers:** nothing quantitative — a pure title card (section number, name, one-sentence
  definition) per the owner's 2026-07-25 request to strip the headline-stat/takeaway/chart that
  used to live here.
- **Fields:** none from `ReportModel` except `seedBase` (`model.summary.monthFolderName` for the
  section-3 separator, or the deck-level `seedBase` param elsewhere) — used only to seed the
  deterministic decorative pattern (`dividerPatternSvg`), not for content.
- **Variants:** 1/4 each.

#### 6. مجتمع الصور بناءً على المخاطر (risk-stages) — `riskStagesSlide` — **the one 2/4 page**
- **Answers:** how the month's population and sample split across the four risk levels.
- **Fields:** `model.population.byStage` (`StageProfile[]`: `stageLabel`, `population`,
  `sampleSize`, `coverage`), `model.population.total`, `model.sample.total`,
  `model.sample.coverage`, plus the same static `LEVEL_DRAW_WEIGHTS` used by the glossary.
- **Variants:** **2/4 real.** Variant 0: a stacked proportion bar (`stageProportionBar`) + a
  4-tile grid with a micro accuracy-style coverage arc (`microArc`) per tile + a totals band.
  Variant 1: horizontal compare-bars (`stageCompareBars`) + an exact-figures table
  (`levelFiguresTable`, one row per level + totals). Variants 2 and 3 duplicate variant 0.
- **Complexity:** the richest page in the deck design-wise — real chart-like elements (stacked
  bar, compare bars) plus a data table, in two genuinely different layouts.

#### 7+. مجتمع صور الفحص (port population) — `portPopulationSlideBuilders`
- **Answers:** per-port image counts and clean/suspicious split, land ports and sea ports side by
  side.
- **Fields:** `collectPortStats(model)`, tallied fresh from `model.rows[].portName`,
  `.portType`, `.imageResult`, `.selectedInSample`.
- **Variants:** 1/4. **Paginated** (one or more slides depending on port count).
- **Complexity:** two-column land/sea `.deck-table` cards with a magnitude bar in the "الصور"
  column, `الإجمالي` totals row.

#### Next. عيّنة الفحص المسحوبة (port sample) — `portSampleSlideBuilders`
- Same data source and shape as port-population, but every numeric cell stacks the drawn-sample
  figure over its population base ("N من M") plus a تغطية column. Same fields, same 1/4, same
  pagination.

#### Next. مجتمع صور الفحص حسب المستوى والمنفذ (stage×port population) — `stagePortPopulationSlide`
- **Answers:** top-5 ports by volume, per risk stage.
- **Fields:** `collectStagePortStats(model)` from `model.rows[].stage/.portName/.imageResult/
  .selectedInSample`, headers/totals pinned to `model.population.byStage` (`StageProfile`).
- **Variants:** 1/4. **Never paginated** — top-N is fixed at `STAGE_CARD_TOP_N = 5`, so row count
  doesn't grow with the port list.
- **Complexity:** one card per risk stage (4 cards), each a mini port table.

#### Next. عيّنة الفحص المسحوبة حسب المستوى والمنفذ (stage×port sample) — `stagePortSampleSlide`
- Same shape as above, sample-mode columns (مجتمع المرحلة / العيّنة المستهدفة / نسبة التغطية).
  Same fields, 1/4, never paginated.

#### Section 2, page A. نتائج جودة الصور في المنافذ (image quality) — `qualityPortSlideBuilders`
- **Answers:** per-port image-quality mix and marking-presence rate.
- **Fields:** `collectPortQualityStats(model)` from `model.rows` filtered to
  `answerStatus === "submitted"`, then `.imageAvailable`, `.hasMarking`, `.imageQuality`,
  `.portName`, `.portType`.
- **Variants:** 1/4. **Paginated.**
- **Complexity:** land/sea tables, 4 percentage columns (عالي/متوسط/منخفض/التحديد), threshold
  coloring on the التحديد column against `MARKING_TARGET`.

#### Section 2, page B. نتائج دقة نتائج المنافذ (port accuracy) — `accuracyPortSlideBuilders`
- **Answers:** per-port accuracy, suspicion-detection rate, clean-confirmation rate.
- **Fields:** `model.portAccuracy` (= `Aggregates["byPort"]`, `KeyedAccuracy[]`: `key`,
  `evaluable`, `correctClean`, `correctSuspicion`, `missedSuspicion`, `falseSuspicion`, `band`),
  joined to `model.rows` only to resolve land/sea per port name.
  Comment in the source is explicit that this is deliberately `model.portAccuracy`, **not**
  `model.population.byPort[].accuracy` — the latter (`PortProfile.accuracy`) hard-nulls below 30
  verified rows and would silently disagree with this page.
- **Variants:** 1/4. **Paginated.**
- **Complexity:** land/sea tables, 3 threshold-scored columns vs. `ACCURACY_TARGET`.

#### Section 3 separator, then 6 pages (`section3/index.ts`)

**3.1 الأداء حسب حجم الأعمال** — `workloadAccuracySlideBuilders`
- **Answers:** is a port's low accuracy associated with high volume? (explicitly
  association-not-causation, permanent caveat on every variant.)
- **Fields:** workload tally over `model.rows[].portName/.portType`, joined to
  `model.portAccuracy` (`Aggregates["byPort"]`) for evaluable/correct/correctSuspicion/
  missedSuspicion.
- **Variants:** 1/4. Paginated land/sea.
- **Complexity:** two tables (workload magnitude bar + threshold accuracy + missed-suspicion bar +
  evaluable count), plus a permanent caveat line. (Previously a bubble scatter; owner replaced it
  2026-07-25 — "this graph make no sense.")

**3.2 دقة إجابات المستوى الأول والثاني** — `levelAccuracySlideBuilders`
- **Answers:** per port, how well did the L1 vs. L2 inspection decision match the reviewer, and
  what's the gap between them?
- **Fields:** `model.factTable` (`DecisionRecord[]`: `portName`, `portType`, `decisionLevel`,
  `outcomeClass`), folded per (port, level).
- **Variants:** 1/4. Paginated land/sea (in lockstep with the workload page's plan).
- **Complexity:** 5-column tables (L1 accuracy / L2 accuracy / signed الفارق / العيّنة), per
  land/sea.

**3.3 توافق النتائج بين المستويات والمصادر** — `sourceAgreementSlide`
- **Answers:** month-wide agreement between all 6 result sources (L1, L2, manual inspection,
  opposite inspection, "live means," and the study reviewer), and each source vs. the reviewer
  specifically.
- **Fields:** `model.resultComparison.crossTeamMatrix` (`Aggregates["crossTeamMatrix"]`, the
  C(6,2)=15-pair matrix) and `model.resultComparison.reviewerAgreement`
  (`Aggregates["reviewerAgreement"]`).
- **Variants:** 1/4. **Not paginated** — one fixed page.
- **Complexity:** the single richest visualization in the deck outside `riskStagesSlide`'s
  variant 1: a 6×6 lower-triangle percent heatmap (`percentHeatmap` from `ui/analyticsCharts.ts`)
  with an accompanying "ن" (comparable-count) grid, plus a 5-column reviewer-agreement table with
  two count-bar columns for disagreement direction. Carries two mandatory scope/axis footnotes.

**3.4 توافق المستويات حسب المنفذ** — `portAgreementSlideBuilders`
- **Answers:** per port, how often do L1 and L2 agree with each other (whole-population base),
  and how does each level individually match the reviewer (sampled-only base)?
- **Fields:** `model.resultComparison.images` (`ImageResultComparison[]`, `.results.levelOne/
  .levelTwo/.review`), joined to `model.rows` for port type only.
- **Variants:** 1/4. Paginated land/sea.
- **Complexity:** 6-column tables (اتفاق المستويين / المجتمع count / L1-vs-reviewer /
  L2-vs-reviewer / العيّنة count), plus a mandatory two-denominators scope note.

**3.5 أثر وجود التحديد على الدقة** — `markingImpactSlide`
- **Answers:** do images with a drawn marking (تحديد) get more accurate decisions than images
  without one?
- **Fields:** `model.rows`, filtered to `verificationCategory !== null`, split by
  `hasMarking === true/false`, using `.imageResultAccurate` and `.verificationCategory`.
  Explicitly **image-grain, not decision-grain** (folding `model.factTable` here would double-
  count, per the module's own doc comment).
- **Variants:** 1/4. Single page (no pagination — two fixed arms).
- **Complexity:** two large comparison tiles (accuracy + micro arc) with a signed-الفارق chip
  between them, plus a 100%-stacked outcome-composition bar per arm and a shared legend. Carries
  a mandatory "not causal" caveat.

**3.6 أثر جودة الصورة على الدقة** — `qualityImpactSlide`
- **Answers:** does accuracy track with image quality (عالي/متوسط/منخفض)?
- **Fields:** `model.rows` (image grain, same reasoning as 3.5) for the three quality strata, plus
  `model.kpis.lowQualityReasons` (`ReasonCount[]`, top-3 reasons table) and
  `model.imageQuality.acceptableQualityRate` / `.lowQualityCount` / `.mediumQualityCount` for the
  totals band (explicitly a *different* denominator from the strata, spelled out in the card
  subtitle).
- **Variants:** 1/4. Single page.
- **Complexity:** 3-tile row (one per quality level, each with a micro arc) + a two-panel mid
  section (accuracy-trend bar-steps + top-3 reasons table) + totals band + causal-caveat line.

#### Closing — `closingSlide`
- **Answers:** data provenance / source-file revision tracking / classification banner.
- **Fields:** `sourceRevisions` (`SourceRevisions`, from `input.sourceRevisions`),
  `model.dataSources` (`riskRowCount`, `biProvided`, `biMatchedCount`), `model.summary.periodId`.
- **Variants:** 1/4.
- **Complexity:** a provenance list (per source file: revision number) + a 2-card
  risk-file/BI-file attribution block + an org/classification sidebar.

### Summary table

| # | Page | Model fields | Variants | Paginates |
|---|------|--------------|----------|-----------|
| 1 | الغلاف | `summary.periodId` | 1/4 | no |
| 2 | المحتويات | `population.total`, `sample.total`, `summary.overallAccuracy` | 1/4 | no |
| — | مؤشرات الشهر *(hidden)* | multiple `summary`/`population`/`sample` fields + `collectPortStats` | 1/4 | no |
| 3–4 | المعجم ×2 | **none** (static constants only) | 1/4 each | no |
| — | فاصل ×3 | none (decoration only) | 1/4 each | no |
| 5 | مجتمع الصور بناءً على المخاطر | `population.byStage`, `population.total`, `sample.total/coverage` | **2/4** | no |
| 6 | مجتمع صور الفحص (population) | `rows` via `collectPortStats` | 1/4 | yes |
| 7 | عيّنة الفحص (sample) | `rows` via `collectPortStats` | 1/4 | yes |
| 8 | مجتمع صور الفحص حسب المستوى والمنفذ | `rows` + `population.byStage` | 1/4 | no (top-5 fixed) |
| 9 | عيّنة الفحص حسب المستوى والمنفذ | `rows` + `population.byStage` | 1/4 | no (top-5 fixed) |
| 10 | نتائج جودة الصور | `rows` via `collectPortQualityStats` | 1/4 | yes |
| 11 | دقة نتائج المنافذ | `portAccuracy` + `rows` | 1/4 | yes |
| 12 | الأداء حسب حجم الأعمال | `rows` + `portAccuracy` | 1/4 | yes |
| 13 | دقة إجابات المستوى الأول والثاني | `factTable` | 1/4 | yes |
| 14 | توافق النتائج بين المستويات والمصادر | `resultComparison.crossTeamMatrix/.reviewerAgreement` | 1/4 | no |
| 15 | توافق المستويات حسب المنفذ | `resultComparison.images` + `rows` | 1/4 | yes |
| 16 | أثر وجود التحديد على الدقة | `rows` | 1/4 | no |
| 17 | أثر جودة الصورة على الدقة | `rows` + `kpis.lowQualityReasons` + `imageQuality.*` | 1/4 | no |
| 18 | خاتمة (closing) | `dataSources`, `sourceRevisions`, `summary.periodId` | 1/4 | no |

**Observation:** the deck's data footprint is overwhelmingly `model.rows` (raw
`ExecutiveReportRow[]`, re-tallied fresh in nearly every builder) plus three pre-aggregated model
slices: `model.portAccuracy`, `model.factTable`, and `model.resultComparison.*`. Every other branch
of `ReportModel` — see Part 2 — is untouched.

---

## Part 2 — Data that exists but deck2 does not use

Every item below was confirmed unused by grepping `src/data/reporting/executive/deck2` (excluding
`.test.ts` files) for the field/type name before listing it.

### A. `ReportModel` branches deck2 never reads

All of these are built once per report generation (`buildReportModel`,
`src/data/reporting/executive/model/reportModel.ts`) and are already sitting on the object every
deck2 builder receives — no new plumbing needed, just a new page reading them.

| Field | Type | Shape | What it is |
|---|---|---|---|
| `model.employeeOverview` | `{ inspectorIdentityMapped, evaluatedCount, totalDecisions, evaluableDecisions, reviewerProfiles: EmployeeProfile[], priorityReviewers: EmployeeProfile[], reviewerDisplayNames }` | per-reviewer, per-month | Reviewer workload/quality profiles — see `EmployeeProfile` below. **Zero references in deck2.** |
| `model.employeeByPort` | `Aggregates["employeeByPortAndLevel"]` = `EmployeeByPortLevel[]` | per (inspectorId × L1/L2 × port), per-month | Full accuracy metrics (`AccuracyMetrics`: evaluable, correctClean/Suspicion, missedSuspicion, falseSuspicion, `accuracy`, `detectionRate`, `missedSuspicionRate`, `suspicionDecisionAccuracy`, `falseSuspicionRate`, `band`) for **each inspector, at each port, on each inspection level**. This is inspector-level accountability drill-down. **Zero references.** |
| `model.errorAnalysis` | `{ byPort: Aggregates["errorTypeByPort"], totals: {...} }` | per-port + month-wide | Raw correctClean/correctSuspicion/missedSuspicion/falseSuspicion counts (no rates) per port, and the same four counts totaled for the whole month. **Zero references** — deck2's own port-accuracy pages recompute similar totals from `model.rows`/`model.factTable` directly instead. |
| `model.distribution` | `{ assigned, completed, pending, replaced }` | month-wide | Whole-month distribution-event summary (from `DistributionCurrentData`). **Zero references** — nothing in the deck reports assignment/completion/replacement volume as a distribution-workflow metric (`model.sample.studied`/`completionRate` covers *study* progress, not *distribution* state). |
| `model.reviewerKpis` | `ReviewerKpiModel` (`model/reviewerKpis.ts`) | per-reviewer + per-port, per-month | The richest single unused branch — see section B below. **Zero references** (it IS used by the app's live KPI tab, `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx`, just not by deck2). |
| `model.dataQuality` | `{ biAvailable, inspectorIdentityMapped, totalDecisionRecords, evaluableDecisionRecords, overallBand }` | month-wide | A ready-made "how much can we trust this month's numbers" summary, already sufficiency-banded. **Zero references** — nowhere in the deck states the overall data-sufficiency band as its own figure, even though nearly every table cell is individually gated by the same banding logic (`isRankable(band(n))`). |
| `model.actions` | `string[]` | month-wide | Narrative recommended-actions text (`generateNarrativeFindings`). **Zero references.** |
| `model.exclusions.note` | `string` | month-wide | One sentence pointing at `processing.summary.json` for excluded-row detail. **Zero references.** |
| `model.population.byPort` | `PortProfile[]` (`portName, population, clean, suspicious, suspicionRate, sampleSize, coverage, studied, completionRate, accuracy, suspiciousDetectionRate, missedSuspicionRate, levelOneAccuracy, levelTwoAccuracy, status`) | per-port, per-month | Deck2's own comments explicitly say NOT to use this for accuracy (it hard-nulls below 30 rows) — but the deck also never uses its **other** fields: `suspicionRate`, `completionRate`, `levelOneAccuracy`/`levelTwoAccuracy` per port, or the pre-computed `status` classification (`excellent/stable/monitor/priority/insufficient`). Every port page in the deck recomputes its own numbers from `model.rows` instead. |

### B. `model.reviewerKpis` in detail — the single most promising unused branch

`src/data/reporting/executive/model/reviewerKpis.ts` builds real **SPC p-charts**, not just rates:

- `ReviewerKpiModel.rows: ReviewerKpiRow[]` — per reviewer: `assigned`, `completed`,
  `completionRate`, `quota`, `throughputVsQuota`, `turnaroundMedianHours`, `turnaroundP90Hours`
  (assignedAt→submittedAt, R-7/`PERCENTILE.INC`-style), `reviewedWithVerdict`,
  `suspiciousOrReferral`, `suspicionOrReferralRate`, `referralCount`, `referralRate`.
- `ReviewerKpiModel.reviewerPChart` / `.portPChart`: proper proportion control charts
  (`PChart`/`PChartGroup`) — pooled center line, per-group 3σ UCL/LCL, `outOfControl` flag,
  `lowN` flag (n < `P_CHART_MIN_N` = 5) so thin subgroups are never signaled as anomalies.

This is currently rendered only in the live app's KPI tab (`ReviewerKpiPanel.tsx`), never in
deck2. It is per-reviewer (turnaround, throughput vs. quota, referral behavior) and per-port
(suspicion-or-referral rate control chart) — both axes deck2 currently has zero pages for.

### C. `executiveEmployeeData.ts` — `EmployeeProfile`, feeding `model.employeeOverview`

Also fully unused. Per reviewer (username), cumulative for the month:
`studied`, `workload`, `overallAccuracy`, `suspiciousDetectionRate`, `missedSuspicionRate`,
`excessSuspicionRate`, `levelOneAccuracy`, `levelTwoAccuracy`, `byPort: Map<port, {studied,
accuracy}>`, `byDecision: {onSuspicious, onClean}`, `byImageQuality: Record<level, {studied,
accuracy}>`, `byMarking: {marked, unmarked}`, `stabilityIndex` (stdev of the reviewer's own
per-port accuracy — a consistency signal), `reliable` (studied ≥ `minimumReliableSampleSize`),
`riskScore` (a weighted composite of low accuracy + high missed-suspicion + instability), and
`recommendedAction` (a pre-written Arabic recommendation string keyed off those same conditions).
`buildPriorityList` already ranks and filters this to "reliable reviewers, worst risk score
first" — a ready-made "who needs attention this month" list.

### D. `model/aggregates.ts` — computed but not even attached to `ReportModel`

Two fields on the internal `Aggregates` type are computed by `buildAggregates` and **never copied
onto `ReportModel` at all** (confirmed: they exist only in `model/aggregates.ts` and its own test,
nowhere else in `src/`):

- `Aggregates.byStage: KeyedAccuracy[]` — accuracy (not population count) **per risk stage**,
  same `AccuracyMetrics` shape as `byPort`. Note this is a different thing from
  `model.population.byStage` (`StageProfile[]`, population/sample counts only, which
  `riskStagesSlide` already uses) — this is the accuracy rate per risk level, which the deck
  currently has **no page for at all** despite showing population/sample/coverage per stage on
  two separate pages.
- `Aggregates.byMovement: KeyedAccuracy[]` — accuracy folded by `ExecutiveReportRow.movementType`
  (import/export or similar movement direction — confirmed the field exists on
  `ExecutiveReportRow`, confirmed `movementType` appears nowhere in deck2 production code, only in
  test fixtures). This is an entire axis of the data (movement direction) the deck never slices
  by, anywhere.

This is effectively free: the math is already written, tested, and running every time a report is
built — it's discarded at the `ReportModel` construction boundary rather than reused.

### E. Distribution-workflow data (`src/data/distribution/`)

`distributionTypes.ts`'s `DistributionEvent` carries a full timestamped event log per case:
`eventType` (`assigned | completed | replacement-requested | replaced | reassigned |
reopen-requested | reopened`), `eventAt`, `eventBy`, `notes`, `dailyQuota` and
`daysRemainingAtAssignment` snapshots frozen at assignment time. `DistributionCurrentData` derives
`totalAssigned/totalCompleted/totalReplaced/totalPending` plus per-employee `EmployeeQuota`
records. None of this reaches deck2 beyond the four bare totals folded into the unused
`model.distribution` (item A above) — the event-level detail (replacement reasons, reassignment
chains, reopen requests, per-employee daily quota vs. days-remaining) has no report page anywhere
in the executive editions. Per-employee, per-event, timestamped.

### F. Referral / replacement / reopen requests (`src/data/referral/`, `src/data/approvals/`)

`ReferralRequest` / `ReplacementRequest` / `ReopenRequest` (`src/data/referral/referralTypes.ts`)
each carry: `reason` (free text), `status` (`pending/approved/denied`), `requestedAt`,
`requestedBy`, `reviewedBy`, `reviewedAt`, `reviewNotes`, and a full `history: DecisionEvent[]`
append-only audit trail (`src/data/approvals/approvalTypes.ts`, tamper-evident via a djb2 hash
chain, `previousDecisionHash`). This is per-request, per-month data with real timestamps on both
ends (request → decision), so approval/denial rate and turnaround time are both directly
computable and currently reported nowhere. (`model.reviewerKpis.rows[].referralCount/
referralRate` only counts *raw request volume* per reviewer — it does not touch approval outcome,
reason text, or turnaround.)

### G. Workspace governance audit trail (`src/data/audit/actionLog.ts`)

`WorkspaceActionEntry` (append-only, `5-system/audit/actions.log.json`, with per-year archival):
`action` (one of `user-deleted | user-created | permission-changed | feature-permission-changed |
sample-drawn | distribution-bulk-assigned | referral-approved | referral-denied |
replacement-approved | replacement-denied | reopen-approved | reopen-denied | answer-reopened |
month-closed | month-reopened | backup-restored`), `at`, `actor`, `actorRole`, `monthFolderName`,
`target`, `details`. This is exactly the kind of "activity/audit trail" data the brief asked to
check for — a ready-made governance timeline (who closed the month, who restored a backup, who
drew the sample, when) that no report edition currently surfaces at all.

### H. Notifications (`src/data/notifications/notificationTypes.ts`)

`AppNotification` with `postedBy/postedAt` and an `acceptances: NotificationAcceptance[]` list
(`username`, `acceptedAt`). Gives a real acknowledgement-rate/turnaround signal per broadcast
(e.g., "how long did it take staff to accept this month's policy notice"). Minor compared to the
items above, but genuinely unused and genuinely has numbers behind it.

### I. Feedback (`src/data/feedback/feedbackStorage.ts`)

`FeedbackMessage` (`category: suggestion|issue|inquiry`, `status: open|resolved`, `replies[]` with
timestamps). Volume-by-category and open/resolved rate would be a one-off "how is the tool being
used" page, but it's about the app itself, not radiology QA outcomes — lowest-priority item on
this list.

### J. Templates (`src/data/templates/`)

`TemplateSchema`/`TemplateIndex` plus `templateSelectionStorage.ts` (which template version was
active for a given month). Not really a numeric reporting source — more useful as a provenance
line ("form version X was in effect this month") than a page of its own; noted for completeness
since the brief asked for a broad sweep.

### K. Sampling / apportionment internals (`src/data/sampling/`)

`apportionment.ts` (Hamilton's method, per-port seat allocation with remainder-tie handling) and
`rng.ts` (seeded Mulberry32 + Fisher-Yates draw) produce intermediate figures — e.g., each port's
Hamilton-apportioned quota *before* the draw, and the CertScan/NonCertScan sub-split — that
`riskStagesSlide`/`portSampleSlideBuilders` never show. The deck reports the *result* of the draw
(sample counts) but never the *allocation logic* (how many seats a port was entitled to vs. how
many it got via spillover). This would be a methodology-transparency page, not a results page.

---

## Part 3 — Synthesis (punch list, not a design doc)

**Existing pages best positioned for a genuinely different alternate layout** (their data already
supports more than one honest visual encoding, unlike a page whose entire content is a single
gated rate):

- **دقة نتائج المنافذ / نتائج جودة الصور (section 2, both port pages)** — currently plain
  land/sea tables; the same `portAccuracy`/`portQuality` rows could support a ranked
  bar-chart-style variant (à la `riskStagesSlide`'s variant 1) without new data.
- **الأداء حسب حجم الأعمال (workload-vs-accuracy)** — the owner already rejected a scatter once
  for being unreadable; a *ranked* dual-axis or slope-style variant (still a table underneath) is
  worth a second attempt now that the join logic is stable.
- **توافق النتائج بين المستويات والمصادر (source-agreement heatmap)** — already the deck's most
  visually distinct page; a second variant (e.g., a directed disagreement view: who over-flags vs.
  under-flags relative to the reviewer) would reuse `crossTeamMatrix`/`reviewerAgreement` as-is.
- **أثر وجود التحديد / أثر جودة الصورة (the two impact pages)** — structurally identical
  two/three-arm comparisons; a shared alternate "slope chart" variant across both would be cheap
  to build once and apply twice.
- **مجتمع صور الفحص حسب المستوى والمنفذ (stage×port grids, both population and sample)** — top-5
  card-per-stage today; a single combined matrix/heatmap view (stage × port) is a natural second
  encoding of the same `collectStagePortStats` output.

**Unused data sources most promising for entirely new pages**, roughly in order of how directly
report-ready they already are:

1. **`model.reviewerKpis`** — p-charts are already built; a "reviewer performance" page (control
   chart + turnaround/throughput table) needs no new math, only rendering.
2. **`model.employeeByPort` (`EmployeeByPortLevel[]`)** — inspector × port × level accuracy drill-
   down; pairs naturally with the existing port-accuracy pages as a "who" layer under the "where."
3. **`EmployeeProfile`/`model.employeeOverview`** (riskScore, recommendedAction, stabilityIndex,
   priority list) — a ready-made "reviewers needing attention" page, text and numbers both
   pre-computed.
4. **`Aggregates.byStage` / `Aggregates.byMovement`** — accuracy per risk stage and per movement
   type; free (already computed, just not attached to `ReportModel`) and fills an obvious gap
   next to the existing population-only stage pages.
5. **Distribution event log + referral/replacement/reopen requests** — a "process health" page:
   replacement/reopen rates, reasons, and approval turnaround, none of which the deck currently
   reports at all.
6. **Workspace audit trail (`src/data/audit/actionLog.ts`)** — a governance/activity timeline page
   (month close, backup restores, sample draws) — orthogonal to everything else in the deck, which
   is entirely inspection-outcome-focused today.

Lower priority but noted: notifications acceptance rate, feedback volume/category, template
version provenance, and the pre-draw apportionment/allocation figures from `src/data/sampling/`.
