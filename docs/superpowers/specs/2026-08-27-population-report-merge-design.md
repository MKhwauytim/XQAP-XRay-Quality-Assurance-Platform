# تقرير المجتمع — Merged Population Report (replaces Sample + Distribution reports)

**Date:** 2026-08-27
**Status:** design, awaiting owner review
**Scope:** Reports tab (`src/components/Sidebar/Tabs/Reports/TabView.tsx`) — retires the
`تقرير العينة` (Sample) and `تقرير التوزيع` (Distribution) cards/builders and replaces both with
one new card, **تقرير المجتمع** (Population Report), doc + deck + xlsx. Executive Report,
Management Report, and Power BI export are untouched.

---

## 1. Purpose

Both `sampleReport.ts` and `distributionReport.ts` were judged unusable in their current form —
wrong content, wrong visual design, not useful to the people who actually open them (management,
supervisors, audit/compliance). Rather than patch either independently, the owner asked to merge
them into a single report that tells one story end to end: **what population we received, how it
became a sample, and who we gave it to** — dropping day-to-day workflow-status tracking
(pending/completed/replaced), which belongs to a different, already-existing surface, not this
report.

The new report also adopts the deck3 visual language (`src/data/reporting/executive/deck3/`) —
cover, section dividers with ghost numerals, tinted land/sea panels, kpiBand, dataTable — for both
its deck and, newly, its document edition. This is a deliberate request to make the report family
look like one system rather than the ad hoc chrome `sampleReport.ts`/`distributionReport.ts`
currently borrow from the older `executive/document` and `executive/deck` (v1/v2) infrastructure.

## 2. Decisions

| # | Decision | Rejected alternative and why |
|---|---|---|
| D1 | **One report, one card**, replacing both Sample and Distribution cards | Keeping two cards with shared content was considered and dropped — the owner wants a single narrative, not two reports that overlap |
| D2 | Three content sections: **(1) المجتمع** (population received/processed), **(2) العينة** (sample composition by stage, then port land/sea), **(3) التوزيع** (per-employee assignment + results) | Two parallel top-level sections (one for BI, one for Risk) were considered; rejected because Risk and BI aren't independent stories — they reconcile into one population, so splitting them across sections forces the reader to hold two before/after threads instead of one |
| D3 | Section 1's receipt tables are **Risk \| BI side by side** (two tables, one section — a two-column layout, the same shape as deck3's land/sea panels), not two full top-level sections | Owner's own framing: "2 tables 2 sides" |
| D4 | Workflow status (`pending`/`completed`/`replacement-requested`/`replaced`) is **dropped entirely** from this report | Owner: "pending complete replaced thats in another report" — this report is a point-in-time record of composition and outcome, not a live operational tracker |
| D5 | Section 2 and Section 3 both classify every row as **سليمة / اشتباه** (image-grain: either level flagged → اشتباه) rather than the reviewer-verified 4-way accuracy split (`correctClean`/`missedSuspicion`/etc.) that the Executive report uses | Owner asked specifically for سليمة/اشتباه/total counts, not accuracy-against-review. The 4-way split answers "was the screening right," which is the Executive report's job; this report answers "what did we find," which is a plain image-result tally — same grain `collectPortStats` already uses for population-level clean/suspicious counts (see §4.4) |
| D6 | Section 2's port breakdown is a **land/sea two-column layout**, matching deck3's existing `توزيع على المنافذ` slide almost exactly | Confirmed directly: "port type is either sea or land" |
| D7 | **CertScan gets its own slide**, in Section 3, last — "how many CertScan samples was assigned and to who" | Considered folding CertScan into every port/stage table as a sub-split; rejected as owner explicitly placed it as a standalone Section 3 closer, not a cross-cutting dimension |
| D8 | Deck **and** Document both move to the deck3 visual language | Deck-only reskin (leaving the doc on the old chrome) was offered and declined — owner wants both formats matching |
| D9 | **New module**, not an evolution of `sampleReport.ts`/`distributionReport.ts` | Patching either file in place was considered; rejected because the content, data sources, and visual system are all changing simultaneously — a clean new module is easier to review and to golden-snapshot from scratch than a file that used to mean something else |
| D10 | Excel export **kept**, restructured to mirror the three sections | Dropping xlsx was offered; owner: "Yes, keep xlsx too" |
| D11 | **Added 2026-08-27, after implementation began (post-Task 7):** the report card gets a 3-way export-scope switch — **population only** (Section 1), **sample only** (Sections 2+3 together), **both** (all three sections, default) — applying to whichever format (doc/deck/xlsx) is exported | See §9 for the full addendum. Three independent toggles (population/sample/both all separately on-able) was considered and rejected — owner specified three mutually-exclusive switches, i.e. a segmented control, not independent checkboxes |

## 3. Non-goals

- No change to Executive Report, Management Report, or Power BI/CSV export.
- No change to the in-page `PopulationProcessingReport.tsx` panel in the Population tab (Phase 2) —
  that stays as the live, in-progress-month drill-down; this spec is about the after-the-fact
  exportable report reached from the Reports tab.
- No revival of the orphaned `Tabs/Population/reporting/*` builder — it is dead code, unrelated to
  this effort, and out of scope (may be deleted separately; not this spec's concern).
- No new employee-identity accuracy tooling. Section 3's per-employee numbers are assignment/result
  counts (who got what, what it turned out to be), not an accuracy-against-review measure.

## 4. Data model

### 4.1 Inputs, per selected month

Read the same way Sample/Distribution reports read today — via `directoryHandle` + `selectedMonth`,
resolved through `workspacePaths.ts`:

| Source file | Loader | Used for |
|---|---|---|
| `1-raw/risk.raw.json` | existing raw-read path (`MonthRawData`, `rows: NormalizedRiskRow[]`) | Section 1 raw row count only (`rows.length`) — see §4.2 caveat |
| `1-raw/bi.raw.json` | same, `rows: NormalizedBiRow[]` | Section 1 raw row count only, when BI was provided |
| `2-processed/processing.summary.json` | `loadProcessingSummary` | Section 1's Risk before/after and BI before/after pipeline stats — **this is the primary Section 1 data source**, not the raw files |
| `2-processed/population.final.json` | `loadMonthPopulationFinal` | Section 2's stage/port composition (`PreparedPopulationRow[]`) |
| `month.manifest.json` | `loadMonthManifest` | month label, targets |
| `2-samples/{month}/1-main/sample.master.json` | `loadSampleMaster` | Section 2's actual drawn-sample counts (`SampleMasterData.rows: PreparedPopulationRow[]`, respecting `replacedRowIds`) |
| `2-samples/{month}/1-main/distribution.current.json` | `loadOrDeriveDistributionCurrentForRead` | Section 3 (`DistributionEntry[]`, `assignedTo` + `row: EmployeeMirrorRowStub`) |
| employee display names | `buildDisplayNameMap()` | Section 3 labels |
| source revisions (population/sample/distribution) | existing revision loaders | footer provenance note, same as today |

### 4.2 Constraint: no sheet-level receipt detail survives a save/reload

`RiskWorkbookResult`/`BiWorkbookResult`'s `sheetSummaries`, `unknownSheetNames`, and roll-up totals
(`totalOriginalRows`, `totalExcludedMissingXrayIdCount`, etc.) exist **only in memory during Phase 1
import** — `risk.raw.json`/`bi.raw.json` persist `rows` alone (`MonthRawData.rows: Array<Record<string,
unknown>>`, actually the full `NormalizedRiskRow[]`/`NormalizedBiRow[]` cast down). Reloading a saved
month reconstructs sheet summaries as empty arrays.

Consequence: Section 1's "Risk \| BI general, 2 tables 2 sides" **cannot** be a sheet-by-sheet receipt
table (which sheet had how many rows) for a month that's been saved and reopened — that data is gone.
It **can** show the `processingSummary`-derived before/after counts, which already exist and are
already computed today (this is functionally what Sample Report's current doc pages 2–3 show, just
under the old chrome). This spec treats Section 1 as built from `processingSummary` +
`risk.raw.json`/`bi.raw.json` row counts, not sheet detail. If sheet-level receipt detail is wanted
later, that requires persisting `sheetSummaries` at save time — a separate, larger change (touches
the Phase 1/2 write path, `MonthRawData`'s shape, and every existing reader of that file) and is
explicitly **not** in scope here.

### 4.3 Result classification (سليمة / اشتباه)

Image-grain, OR-combined across both levels — the same rule already inlined at
`src/data/reporting/executiveReportData.ts:129-132` and used by `collectPortStats`:

```ts
const imageResult: "سليمة" | "اشتباه" =
  row.xrayLevelOneResult === "اشتباه" || row.xrayLevelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
```

This is the **only** classification this report uses. It does not touch `classifyOutcome`'s 4-way
split (`correctClean`/`correctSuspicion`/`missedSuspicion`/`falseSuspicion`), which requires a
reviewer-submitted answer and answers a different question ("was screening right," not "what did we
find") — that stays exclusive to the Executive report.

Implementation note: this OR-rule is currently duplicated inline wherever it's needed (executive
report data, and now this report). Given it's a two-line pure function reused in at least two
non-adjacent modules, the plan should extract it once (e.g. `src/data/population/imageResult.ts`,
mirroring how `riskEngineVerdict.ts` already lives at the population layer for the same reason —
shared classification logic with no UI dependency) rather than copy it a third time. This is an
implementation-plan-level call, not a design fork; noted here so it isn't missed.

### 4.4 Land / sea

Same substring rule already used identically in three places (`deck2/slideKit.ts`,
`deck3/slides.ts`, `executiveReportData.ts`): `(row.portType ?? "").includes("بحري")` → sea,
everything else → land. No enum exists; this report follows the existing convention rather than
inventing a new one.

### 4.5 CertScan

`row.certScanStatus: "Certscan" | "NonCertscan"`, present on `PreparedPopulationRow` (and therefore
on both `population.final.json` and `sample.master.json` rows unchanged), and explicitly included in
`EMPLOYEE_MIRROR_STUB_FIELDS` so it's present on `DistributionEntry.row.certScanStatus` for
current-format entries. **Caveat**: distribution entries written before the stub-field allowlist
existed may carry a full legacy row instead of the trimmed stub — structurally compatible (a superset
still has the field), so reads are safe, but this is not guaranteed for very old months and should
degrade to "unknown" rather than crash if `certScanStatus` is ever absent.

### 4.6 Per-employee assignment

`DistributionCurrentData.entries[]` — `assignedTo` (username, mapped to display name via
`buildDisplayNameMap()`) + `row` (stage, portName, portType, xrayLevelOneResult, xrayLevelTwoResult,
certScanStatus). This is a direct, no-new-fold read: group `entries` by `assignedTo`, sub-group by
`row.stage` / `row.portName` / land-sea, count سليمة/اشتباه/total per bucket via §4.3. No existing
`ReportModel`/`ManagementModel` fold needs to be reused here — the shape needed is simpler than what
those models compute (no accuracy, no workflow status), and pulling in `ReportModel` would drag in
Executive-report-specific concerns (reviewer KPIs, decision fact tables) this report has no use for.

## 5. Content structure

Deck and document share the same section order and the same underlying model; they differ only in
how much detail fits on a slide vs. a page (deck: top-N / aggregated where a full table would
overflow; document: full detail, paginated).

**Cover** — deck3 `coverSlide`/equivalent doc cover: org block, title "تقرير المجتمع", period
(month), classification, report date. Document edition gets a new matching cover page (portrait
layout, same tokens/typography as the deck's, not the old executive-document cover style).

**Contents** — deck3 `contentsSlide`-equivalent index of the three sections.

**Section 1 — المجتمع (divider, then:)**
1. Receipt overview: Risk \| BI, two tables side by side (§4.2 — from `processingSummary` +
   raw row counts, not sheet detail)
2. Risk before → after (validation → dedup → invalid-result removal — `processingSummary.riskOriginalRows`
   → `validRiskIdRows`/`invalidRiskIdRows` → `duplicateRiskIdRows`/`rowsAfterDeduplication` →
   `removedInvalidResultRows`/`finalPreparedPopulationRows`)
3. BI before → after (`biMatchedRows`/`biUnmatchedRows`/`biMatchPercentage`, `biFieldFillSummary[]`
   per-field fill table)
4. Reconciled population by stage — سليمة/اشتباه/total per stage (the count the sample gets drawn
   from — reuses the existing stage-labeling convention, `getStageKey`/Arabic stage labels)
5. Reconciled population by port, land/sea two-column (deck3's existing two-panel pattern) —
   سليمة/اشتباه/total per port, per column, plus per-column and grand totals

**Section 2 — العينة (divider, then:)**
6. Sample by stage — سليمة/اشتباه/total per stage, plus a total row (same shape as Section 1 page 4,
   sample instead of population — the reader sees "here's the whole population" then "here's what we
   pulled from it," same axes, back to back)
7. Sample by port, land/sea two-column — سليمة/اشتباه/total per port, per column, plus per-column and
   grand totals (mirrors Section 1 page 5)

**Section 3 — التوزيع (divider, then:)**
8. Per-employee breakdown by stage — سليمة/اشتباه/total per employee × stage
9. Per-employee breakdown by port (land/sea) — سليمة/اشتباه/total per employee × port
10. CertScan — how many CertScan samples were assigned, and to whom (per-employee CertScan count)

**Closing** — deck3 `closingSlide`-equivalent.

Document edition: same 10 content pages (plus cover/contents/closing), each fully tabulated rather
than top-N; large per-employee tables paginate the way today's reports already do (`yieldToMain()`
chunking between pages, per CLAUDE.md's "deterministic by contract" pagination pattern).

## 6. Visual system

- **Deck**: built directly on `src/data/reporting/executive/deck3/slideKit.ts` /
  `chartKit.ts` / `theme.ts` — `coverSlide`, `closingSlide`, `contentsSlide`, `sectionDivider`,
  `tintedPanel` (land/sea, reused verbatim for Section 2 page 6), `kpiBand`, `dataTable`. No new
  deck primitives should be needed; this report's shapes (a table, a two-column panel split, a KPI
  band) are all things deck3 already has.
- **Document**: new A4 theme matching deck3's tokens (colors, typography, no rounded corners, gold
  eyebrow labels, dark section-divider treatment with ghost numeral) — this is genuinely new work,
  since deck3 currently has no document counterpart. Built once as a small, reusable "v3 document
  chrome" module (mirroring how `executive/document/shared` serves the old chrome today), not
  hand-rolled per page.
- **Excel**: no visual system to match (SheetJS output) — sheet-per-section, mirroring the doc's
  structure: 1 summary sheet, Section 1 sheets (receipt, risk before/after, BI before/after), Section
  2 sheets (by stage, by port), Section 3 sheets (by employee×stage, by employee×port, CertScan).

## 7. Migration / cleanup

- New module (name TBD at planning time, e.g. `populationReport.ts`) under `src/data/reporting/`.
- `Reports/TabView.tsx`: remove the `تقرير العينة` and `تقرير التوزيع` cards and their `generate()`
  branches; add one `تقرير المجتمع` card (doc/deck/xlsx toggle, same UX pattern as today's cards) plus
  its quick-action button.
- Retire `sampleReport.ts`, `distributionReport.ts`, and their test files/golden snapshots
  (`sampleReport.test.ts`, `sampleReport.openFailure.test.ts`,
  `__snapshots__/sampleReport.test.ts.snap`, `distributionReport.test.ts`,
  `distributionReport.openFailure.test.ts`, `__snapshots__/distributionReport.test.ts.snap`). Confirm
  nothing else imports them (Power BI export and Management report should be independent — verify at
  planning time) before deleting.
- `reportBuilders.xss.test.ts` currently sweeps sample/distribution builders for XSS coverage — update
  it to sweep the new module instead of (or in addition to, during transition) the old ones.
- New golden-snapshot tests for the new module, established once content is finalized and reviewed —
  per CLAUDE.md, snapshot *before* further changes, never after.

## 8. Open items for the implementation plan (not decisions for this spec)

- Exact new module file layout (single file like `sampleReport.ts` was, or split like the orphaned
  `Tabs/Population/reporting/*` was — recommend single file, following `sampleReport.ts`'s and
  `distributionReport.ts`'s precedent, given similar total content volume).
- Whether to extract the شared سليمة/اشتباه OR-classifier now (§4.3) or inline it once more and note
  the duplication for a later cleanup pass — recommend extracting, since this spec is already adding
  a second consumer.
- New document-chrome module's exact API surface (mirrors `executive/document/shared`'s today).
- Whether `reportBuilders.xss.test.ts` migrates in the same PR or a follow-up.

## 9. Addendum (2026-08-27, post-Task-7): export-scope switch

Added after implementation had already started (deck Sections 1–3 built per the original 13-task
plan, `docs/superpowers/plans/2026-08-27-population-report-merge-plan.md`). This addendum is the
source of truth for the requirement below; the plan file's Tasks 8–10 (document, xlsx, Reports-tab
wiring) predate it and do not yet reflect it.

**Requirement:** the تقرير المجتمع card gets a 3-way segmented switch — not three independent
toggles — with these options:

- **المجتمع فقط** (population only) → Section 1 alone
- **العينة فقط** (sample only) → Sections 2 **and** 3 together (confirmed directly: these two are
  "sample" as a pair — composition plus who it went to — not Section 2 alone)
- **الكل** (both / all) → Sections 1+2+3 — **default selection**

Exactly one option is selected at a time (a segmented control / radio group), matching how the
existing "التصميم الجديد" deck2/deck3 toggle already works elsewhere in this same Reports tab
(`Reports/TabView.tsx`) — reuse that UI pattern rather than inventing a new one.

**Applies uniformly** to whichever format is exported next (doc, deck, or xlsx) — the scope
selection is a property of the report request, not of one format. Cover, contents, and closing
pages/slides still always render regardless of scope; only the three content sections are
gated. The contents/TOC listing (deck3 `contentsSlide` pattern, §5) must reflect only the included
sections, not always list all three.

**Implementation guidance for whoever picks this up** (the in-flight implementer session, or a
follow-up pass once its PR is further along — this was intentionally not force-merged into the
concurrently-running Tasks 8–10 to avoid racing that session's commits):

- Thread a `scope: "population" | "sample" | "both"` parameter through the model-build and
  page/slide-assembly functions for all three formats (Tasks 8 document, 9 xlsx, and the already-
  built deck from Tasks 6–7, which will need a small follow-up to accept the same parameter).
- Data loading can stay unconditional (always load all sources per §4.1) rather than skipping
  fetches per scope — simpler, and the per-month data volumes here don't justify the added
  complexity of conditional loading. Only page/slide/sheet *inclusion* is scope-gated.
- Task 10 ("Public index + wire into Reports tab") is where the UI switch itself belongs — add it
  there, defaulting to `"both"`, passed through to whichever `generate()` branch the user triggers.
- Golden-snapshot tests (per CLAUDE.md's "deterministic by contract" rule) should cover at least
  one non-default scope (e.g. `"population"`) in addition to the default `"both"`, since scope-gated
  content is exactly the kind of conditional path a snapshot pinned only on the default would miss.
