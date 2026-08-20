# Executive Report — Content Map and Rework Brief

> **⚠ Stale as of 2026-08-19 (pre-rework).** §2's page numbers and القسم 3's
> "Six analysis pages" count below describe the deck as it stood on 2026-08-19,
> BEFORE the same-day v104.0 rework (three new القسم 3 pages added —
> `dailyTrend.ts`/`outcomeMatrix.ts`/`riskEngineAgreement.ts` — and
> `workloadAccuracy.ts` reworked into a dormant correlation view, disabled by
> `SHOW_WORKLOAD_ACCURACY_SLIDE = false`). As merged, القسم 3 renders **8**
> content pages, not six, الأداء حسب حجم الأعمال does **not** render at all
> (dormant, not page 15), and every page number from القسم 3 onward below has
> shifted. Treat §1 and §3 as current; treat §2's page numbers as historical
> until this doc is regenerated against the current page list.

Written 2026-08-19 against the code as it stands (deck2 is the live edition).
Three parts:

1. **[App content chain](#1-app-content-chain-raw-data--answers)** — every artifact from the
   raw Excel upload to a submitted answer, and which file holds it.
2. **[Executive report, page by page](#2-executive-report--page-by-page)** — the 24-page
   presentation as it renders today, page by page, with the model fields each page reads.
3. **[PowerPoint scope](#3-powerpoint-scope)** — what belongs in the deck, what belongs in the
   sibling editions, and the open decisions for the rework.

A regenerable standalone copy of the report is produced by `npm run report:static` — see
[§4](#4-static-preview).

---

## 1. App content chain: raw data → answers

Every stage below is a real artifact on disk (or an in-memory model), not a conceptual phase.
Paths are relative to the workspace root the user picks; roots are resolved through
`src/data/workspace/workspacePaths.ts`.

| # | Stage | Produced by | Stored as | Content |
|---|-------|-------------|-----------|---------|
| 1 | **Risk upload** (required base) | `Tabs/Population/riskData/` — SheetJS in `workbookWorker.ts` | in-memory `NormalizedRiskRow[]`, persisted as `1-raw/risk.raw.json` | 29 normalized fields per row: `xrayImageId`, `portCode`/`portName`/`portType`, `movementNumber`/`movementDate`/`movementHijriDate`, `declarationNumber`/`transitDeclarationNumber`/`declarationDate`/`declarationHijriDate`, `manifestNumber`/`manifestType`/`manifestDate`, `plateOrContainerNumber`, `finalDestination`, `entryDate`/`exitDate`, `chassisNumber`, `reportNumber`+`hasReport`, `xrayLevelOneResult`, `xrayLevelTwoResult`, `inspectorResult`, `oppositeInspectorResult`, `liveMeansResult`, `xrayEntryDate`, `targetedByRiskEngine`, `riskMessage`, `stage`, plus `movementType` (from sheet name) and `sourceSheetName`/`sourceRowNumber`/`rawRow` provenance |
| 2 | **BI upload** (optional support) | `Tabs/Population/biData/` | `1-raw/bi.raw.json` (only when provided) | 33 normalized fields: identity (`xrayImageId`, `xrayEntryDate`), port, movement, declaration (incl. `preliminaryDeclarationNumber`, `inboundOutboundType`, `declarationType`, `declarationStatus`), `governance`, and the identity/result pairs the risk file lacks — `levelOneEmployee`/`levelTwoEmployee`, `levelOneResultCode`/`levelOneResult`, `levelTwoResultCode`/`levelTwoResult`, `manualInspectionResult(Code)`, `oppositeInspection{Employee,ResultCode,Result}`, `liveMeans{Employee,ResultCode,Result}`, `notes` |
| 3 | **CertScan reference** (optional paste) | `Tabs/Population/processing/` | folded into the processed row | `CertScanEntry { portName, originalSystemSerialNumber, snippets[] }`; matching stamps `certScanStatus` = `Certscan` / `NonCertscan` plus `certScanSnippet` / `originalCertScanSnippet` |
| 4 | **Processing** (Phase 2) | `populationProcessor.ts` | `2-processed/population.final.json` (envelope-wrapped) | `PreparedPopulationRow[]` — the risk row, plus BI-filled fields (`biEnrichmentStatus`, `biMatched`, `biFilledFields`), plus `levelOneEmployee`/`levelTwoEmployee`, plus `otherResults.{manual,opposite,liveMeans}` (each `{result, code, employeeId}`), plus `notes`, plus the CertScan trio. `rawRow` is stripped before write |
| 5 | **Processing summary** | same | `2-processed/processing.summary.json` | `ProcessingSummary`: `riskOriginalRows`, `validRiskIdRows`, `invalidRiskIdRows`, `duplicateRiskIdRows`, `rowsAfterDeduplication`, `removedInvalidResultRows`, `finalPreparedPopulationRows`, `certScanRows`/`nonCertScanRows`/percentages/`certScanProvided`, `biProvided`/`biMatchedRows`/`biUnmatchedRows`/`biMatchPercentage`/`totalBiFilledFields`, `biFieldFillSummary[]`; plus the removed-row lists (`removedRows`, `duplicateRows`, `invalidResultRows`) |
| 6 | **Month manifest** | `src/data/population/` | `{month}/month.manifest.json` | which raw files exist, row counts, timestamps — the month folder's index |
| 7 | **Sample draw** (Phase 3) | `sampleAlgorithm.ts` (Hamilton apportionment → CertScan/NonCertScan split → Fisher-Yates → spillover) | `2-samples/{month}/1-main/sample.master.json` | `SampleMasterData`: `rngSeed`, `samplingAlgorithmVersion`, `totalRequested`/`totalActual`, cert/non-cert requested+actual, `portAllocations[]` (population size, cert counts, quota, actual drawn per port), `stageAllocations[]` (per risk level), `drawnAt`/`drawnBy`, and `rows[]` — the drawn `PreparedPopulationRow`s |
| 8 | **Distribution events** (Phase 4) | `src/data/distribution/` | `2-samples/{month}/1-main/distribution.events/{eventId}.json` — **immutable, append-only** | `DistributionEvent`: `eventId`, `eventType` (`assigned` \| `completed` \| `replacement-requested` \| `replaced` \| `reassigned` \| `reopen-requested` \| `reopened`), `xrayImageId`, `assignedTo`, `replacedById`/`reassignedTo`, `eventAt`, `eventBy`, `notes`, `dailyQuota`, `daysRemainingAtAssignment`, `sourceRequestId` |
| 9 | **Distribution projections** | `distributionDerivation.ts` fold | `distribution.log.json` (compat projection), `distribution.current.json` (rebuildable cache) | `DistributionCurrentData`: totals (`totalAssigned`/`Completed`/`Replaced`/`Pending`), `entries[]` of `DistributionEntry { xrayImageId, assignedTo, status, replacedById, lastEventAt, row }` where `row` is the 17-field `EmployeeMirrorRowStub`, plus per-employee `quotas` |
| 10 | **Per-employee sample mirrors** | same fold | `main.samples.json`, `{username}.samples.json` | the same stub rows, sliced per assignee, so an employee view renders without reading the population file |
| 11 | **Inspection template** | `src/data/templates/` | `6-templates/{templateId}.json` + `templates.index.json` | `TemplateSchema { templateId, templateName, version, fields[] }`; the executive report matches fields **by label** through `ExecutiveReportFieldMappings` (هل يوجد صورة, سبب عدم وجود الصورة, هل يوجد تحديد, مستوى جودة الصورة, اسباب انخفاض جودة الصورة, صحة النتيجة, تقييم الاشتباه, الاصناف المشبوهة, الية التهريب المحتملة) |
| 12 | **Answers** | `src/data/answers/` | per-employee per-month answer file | `EmployeeAnswerFile { username, monthFolderName, items[], referralRequests[], replacementRequests[], reopenRequests[] }`; each `ItemAnswer { xrayImageId, templateId, templateVersion, answers: FieldAnswer[], lastSavedAt, submittedAt, answeredBy, status: draft\|submitted, history[], valueHistory[], qualityNote }` |
| 13 | **Referrals / replacements / approvals** | `src/data/referral/`, `src/data/approvals/` | per-month request + approval records | request `reason` (the only place a replacement reason survives — the distribution fold drops `DistributionEvent.notes`), approver, decision |
| 14 | **Executive report row** | `executiveReportData.ts` | in memory only | `ExecutiveReportRow` — the join of 4+7+9+12: population identity/port/stage, `levelOneResult`/`levelTwoResult`/`imageResult`, `selectedInSample`, `assignedTo`/`distributionStatus`, and the answer-derived `expertResult`, `imageAvailable`, `noImageReason`, `hasMarking`, `imageQuality`, `lowQualityReason`, `suspicionLevel`, `suspectedTypes`, `smuggleMethod`, `answerStatus`, `assignedAt`/`submittedAt`, plus the derived `imageResultAccurate` / `levelOneAccurate` / `levelTwoAccurate` / `verificationCategory` and the `otherResults` panel |
| 15 | **Decision fact table** | `model/decisionFactTable.ts` | in memory | one `DecisionRecord` **per decision level per image** (so up to 2× the image count): `inspectorId`, `decisionLevel`, `outcomeClass` (`correct-clean` \| `correct-suspicion` \| `missed-suspicion` \| `false-suspicion`), `decisionEvaluable`, `dataSufficiencyGroup` |
| 16 | **Report model** | `model/reportModel.ts` | in memory, built **once** per generation | `ReportModel` — summary, population, sample, distribution, `distributionCoverage` (reuses `computeDistributionModel` verbatim), `accountabilityProgress` (reuses `computeManagementModel` verbatim), `portAccuracy`, `portAccuracyByLevel`, `imageQuality`, `employeeOverview`, `employeeByPort`, `errorAnalysis`, `dataQuality`, `resultComparison`, `reviewerKpis`, `dataSources`, `factTable`, `rows`, `kpis` |
| 17 | **Renderers** | `reporting/executive/` | HTML / XLSX files the user saves | `deck2/` (the live 24-page presentation), `deck/` (v1, reference only), `document/` (A4, 6 parts), `workbook/` (14-sheet XLSX), `viewer/`. Renderers **display; they never recompute** |

### Grain warning

Three different denominators exist and are deliberately never given the same field name:

- **image grain** — one tally per image (`accuracyByImage`, `suspiciousDetectionRateByImage`, `missedSuspicionRateByImage`)
- **decision grain** — one tally per level per image (`portAccuracy`, `detectionRate`, `PortProfile.status`)
- **decision-by-level grain** — keyed on (port, level) (`portAccuracyByLevel`)

Mixing them is how the report previously called a port "excellent" on one page and "below
target" on another in the same run.

---

## 2. Executive report — page by page

Live edition: `src/data/reporting/executive/deck2/`. One `<section class="slide">` per page, each
a fixed **630 px** box with `overflow:hidden` — nothing paginates itself, so a page that grows
past the box clips silently. Page count is data-dependent (port tables paginate); the synthetic
demo month renders **24** pages.

Chrome present on every content page: a printed vertical side rail (`sideRail`, tabs for
المعجم / مجتمع الفحص / نتائج فحص الجودة / التحاليل المتقدمة — section 4 is deliberately absent),
a footer page number, an on-screen-only left nav with a progress bar, a light/dark toggle, a
fullscreen presenter mode (arrow keys / click to advance), and a print → PDF button.

### Front matter

| # | Page | Content | Model fields |
|---|------|---------|--------------|
| 1 | **الغلاف** (cover) | Title `تقرير ضمان جودة فحص الأشعة`, study period, classification `داخلي — للاستخدام التنفيذي`, issue date, issuing department/section. Generative-art background seeded from the month name | `summary.monthFolderName` |
| 2 | **المحتويات** (TOC) | One numbered row per section: title, one-line goal, page range, and a headline figure (glossary → term count, §1 → sample size, §2 → overall accuracy, §3/§4 → page count). Rows for empty sections are omitted rather than pointing at pages that don't exist | derived page ranges + `sample.total`, `summary.overallAccuracy` |
| 3 | **المعجم — مستويات المخاطر** | The four المستوى levels: definition, sample weight (100% / 40% / …), and what each measures. **Categorical, not a severity ranking** — the copy must never imply an ordering | static + `DEPARTMENT_GLOSSARY` terminology |
| 4 | **المعجم — المصطلحات الرئيسية** | Grouped term cards: مجتمع الفحص, العيّنة, التغطية, and the quality/accuracy vocabulary | static |

### القسم 1 — مجتمع الفحص (pages 5–10 in the demo)

| # | Page | Content | Model fields |
|---|------|---------|--------------|
| 5 | Section separator | Section number, title, and a `تعريف` blurb | — |
| 6 | **مجتمع الصور بناءً على المخاطر** | Population split across the four risk levels (donut + per-level cards): count, share of population, sample weight, drawn sample, coverage % | `population.byStage`, `kpis.stageProfiles` |
| 7… | **مجتمع صور الفحص** (paginates) | Two cards — المنافذ البرية and المنافذ البحرية — each a table of port × (صور / سليمة / اشتباه) with a pinned totals row. Carries the classification methodology note: an image is اشتباه if **either** L1 or L2 said اشتباه | `population.byPort` |
| 8… | **عيّنة الفحص** (paginates) | The same page in sample numbers: العيّنة / سليمة / اشتباه each rendered as `n من N` against its population base, plus coverage % per port | `population.byPort` (`sampleSize`, `coverage`) |
| 9 | **مجتمع صور الفحص حسب المستوى والمنفذ** | Four cards, one per risk level, each listing the **top 5 ports by volume** (سليمة / اشتباه / إجمالي) with an all-ports total row | `collectStagePortStats(model)` |
| 10 | **عيّنة الفحص المسحوبة حسب المستوى والمنفذ** | Same four cards in sample numbers: stage population, target sample, coverage % | same |

### القسم 2 — نتائج فحص الجودة (11–13)

| # | Page | Content | Model fields |
|---|------|---------|--------------|
| 11 | Section separator | — | — |
| 12… | **نتائج جودة الصور** (paginates) | Per port: image-quality distribution (عالي / متوسط / منخفض) and marking presence % | `imageQuality`, `kpis` quality counts |
| 13… | **دقة نتائج المنافذ** (paginates) | Per port: الدقة العامة, دقة الاشتباه (detection), دقة السليمة (clean confirmation) | `portAccuracy` (decision grain) |

### القسم 3 — التحاليل المتقدمة (14–20, pre-rework — see the banner at the top of this doc)

Six analysis pages, each in its own module with its own CSS, **as of 2026-08-19
before the same-day v104.0 rework**. As merged, this section renders 8 content
pages (`dailyTrend`, `outcomeMatrix`, `levelAccuracy`, `sourceAgreement`,
`riskEngineAgreement`, `portAgreement`, `markingImpact`, `qualityImpact`) —
الأداء حسب حجم الأعمال below is dormant (`SHOW_WORKLOAD_ACCURACY_SLIDE =
false` in `workloadAccuracy.ts`), not rendered as page 15 or anywhere else,
and every page number below (15 onward, including all of القسم 4 and the
closing page) is stale.

| # | Page | Question it answers | Model fields |
|---|------|--------------------|--------------|
| 14 | Section separator | — | — |
| 15… | **الأداء حسب حجم الأعمال** | Does accuracy fall as a port's volume rises? Port × (volume, accuracy, missed-suspicion, sample size) | `population.byPort` + `portAccuracy` |
| 16… | **دقة إجابات المستوى الأول والثاني** | Each level's decision vs the reviewer's verdict, per port, with the L1−L2 gap in percentage points | `portAccuracyByLevel` |
| 17 | **توافق النتائج بين المستويات والمصادر** | L1↔L2 agreement rate, then each level against التفتيش اليدوي / المعاكس / الوسائل الحية, and each source against the reviewer | `resultComparison.reviewerAgreement`, `crossTeamMatrix` |
| 18… | **توافق المستويات حسب المنفذ** | The same agreement question resolved per port, sorted by agreement | `resultComparison` + `portAccuracyByLevel` |
| 19 | **أثر وجود التحديد على الدقة** | Two-arm comparison: accuracy and detection with marking vs without, plus the gap in percentage points | `rows` (`hasMarking`) + fact table |
| 20 | **أثر جودة الصورة على الدقة** | Three-arm comparison across عالي / متوسط / منخفض: decision accuracy, missed suspicion, and an explicit **data-sufficiency band** per arm | `rows` (`imageQuality`) + `dataSufficiencyThresholds` |

### القسم 4 — التغطية والمساءلة التشغيلية (21–23)

| # | Page | Content | Model fields |
|---|------|---------|--------------|
| 21 | Section separator | — | — |
| 22 | **التغطية التشغيلية** | Assigned / completed / completion-rate buckets **by risk level** and **by port**, each row naming its top contributing employee plus `+N آخرون`. Ports beyond the top 8 fold into one honest `الباقي (K منفذ)` row that sums their totals | `distributionCoverage` (verbatim from `computeDistributionModel`, R2) |
| 23 | **المساءلة التشغيلية** | Three headline tiles (إجمالي المستبدلة, إعادة التعيين, موظف مُعيَّن), a per-employee progress table (assigned / completed / rate + total), and a replacement-reasons table | `accountabilityProgress` (verbatim from `computeManagementModel`, R3) |

### Closing

| # | Page | Content |
|---|------|---------|
| 24 | **مصدر البيانات والاعتماد** | Which sources fed the month (risk = required base with its row count; BI = supporting source with its matched count), plus the per-file `JsonEnvelope.metadata.revision` traceability footer |

### What the deck deliberately does **not** contain

- **Per-employee / per-reviewer performance.** `reviewerKpis` and `EmployeeProfile` are fully
  computed and report-ready, but the deck's scope is population-level Level 1 & 2 outcomes.
  Section 4 shows *operational* progress (who was assigned what, who finished), never accuracy
  by named reviewer.
- **Row-level listings.** The document edition's R5 page lists every fact-table row; a 630 px
  slide cannot, so section 4 gives named, ranked summaries bounded by employee/port count
  instead. Anyone needing the full listing opens the document or the XLSX.

### Two issues worth fixing in the rework

1. **Raw stage aliases leak onto page 22.** `التغطية التشغيلية` groups by `e.row.stage`, which
   holds the raw Excel alias, so the by-level table reads `FIRST_STAGE` / `SECOND_STAG` /
   `THIRD_STAGE` / `FORTH_STAG` instead of `المستوى الأول…الرابع`. Every other page in the deck
   shows the canonical Arabic label. Same class of defect as the Population-tab stage-label bug
   fixed on 2026-08-12.
2. **Section 4 is missing from the printed side rail.** `sideRail` lists four tabs and stops at
   section 3, so pages 21–23 print a rail with no active tab. That was a deliberate
   blast-radius decision when section 4 shipped, but a rework is the moment to revisit it.

### Sibling editions (same `ReportModel`, so the numbers cannot disagree)

| Edition | Path | Shape |
|---------|------|-------|
| **deck2** | `executive/deck2/` | the live 24-page presentation described above |
| deck (v1) | `executive/deck/` | legacy reference only, not wired to any button |
| document | `executive/document/` | A4 portrait, 6 parts: النطاق والمنهجية · جودة الفحص · التطابق · المساءلة · المخاطر والإجراءات · التغطية والمساءلة التشغيلية (+ per-employee row listings) |
| workbook | `executive/workbook/` | 14 sheets: KPI, ports, stages, image quality, result quality, rows, raw-risk, raw-BI, exclusions, fact table, result comparison, employee-by-port, error analysis, cross-team |
| viewer | `executive/viewer.ts` | in-app viewer shell |

---

## 3. PowerPoint scope

### In scope

- **Audience:** management, one monthly sitting, read on screen or printed to PDF. Every page
  must survive being read at a distance and being printed in black and white.
- **Unit of analysis:** the population and the drawn sample. The question the deck answers is
  *"were Level 1 and Level 2 X-ray decisions accurate this month, and where?"*
- **Cuts allowed:** by risk level (the four categorical المستوى), by port, by land/sea, by
  image-quality attribute (availability, marking, quality band), by decision level (L1 vs L2),
  and by result source (L1/L2 vs manual / opposite / K9 vs the reviewer).
- **Operational reporting:** coverage and progress only — assigned, completed, completion rate,
  replacement counts with reasons, reassignment count. Aggregated by level, port, and employee.
- **Data honesty is part of the scope:** every derived figure carries its denominator, a `—` is
  rendered instead of a fake `0%` when a source did not act, folded rows are stated (`الباقي
  (K منفذ)`, `+N آخرون`), and thin arms carry an explicit data-sufficiency band.

### Out of scope

- **Reviewer/inspector accuracy by name.** Computed (`reviewerKpis`, `employeeByPort`,
  `EmployeeProfile`) and deliberately not presented here. Any request to add it is a scope
  change, not a layout change.
- **Row-level enumeration** — belongs to the document edition and the XLSX.
- **Severity language for the four المستوى levels.** They are a categorical classification of
  case scenarios. Never "highest risk level", never a ranked ladder.
- **Cross-month trend.** The model is built from one month's input; there is no multi-month
  series to draw from without a new data path.
- **Anything requiring a backend** — no live refresh, no server-side aggregation, no auth.

### Hard constraints the rework must hold

| Constraint | Why |
|---|---|
| Fixed 630 px slide, `overflow:hidden` | anything that grows past it clips silently — pagination must be explicit in the builder, not hoped for from CSS |
| Self-contained single HTML file | fonts are inlined base64, no network at open time; the deck must open from a USB stick offline |
| Arabic, RTL, print-clean | `@media print` hides the on-screen nav; the side rail is part of the slide and prints |
| One `ReportModel`, built once | renderers display, never recompute. A page that folds its own version of distribution/management data reintroduces the exact disagreement bug this architecture exists to prevent |
| Deterministic output | snapshot before changing a builder, then diff — never snapshot after |
| Section = one folder, one assembly file | `section3/index.ts` and `section4/index.ts` are the only assembly points; adding a page is one import + one array entry, and each page owns its own CSS |

### Open decisions for the rework

1. Is section 4 (operational coverage/accountability) staying in the executive deck, or moving
   back to the management report? It is currently the only section not in the printed rail.
2. `مؤشرات الشهر` (the month-in-numbers page) exists in code but is switched off behind
   `SHOW_MONTH_NUMBERS_SLIDE`. Revive, redesign, or delete.
3. Is the deck1 (`executive/deck/`) reference edition still worth carrying? Nothing calls it.
4. Section 3's six analyses are all port-tables of the same shape. A rework is the moment to
   decide which of them deserve a chart instead.

---

## 4. Static preview

```bash
npm run report:static
```

Writes `dist-preview/executive-report.html` — a standalone, self-contained copy of the live deck
rendered from the deterministic synthetic month in `src/dev/deckPreviewFixture.ts` (population,
sample, answers, **and** a distribution + event history so section 4 renders with real content
rather than its empty state). Open the file directly, or serve it:

```bash
npx vite --config vite.static-preview.config.ts
```

Implementation: `scripts/export-exec-report-static.mjs` runs the real TypeScript source through
Vite's SSR module loader (`createServer({ middlewareMode }) + ssrLoadModule`) — no dev server
port, no app build, same transforms as `npm run dev`. Pass `--variant-preview` to embed the
style-variant arrows, or a path argument to write somewhere else.

The interactive alternative, unchanged: `npm run dev` → `http://localhost:5173/deck-preview.html`
renders v2 and v1 side by side with hot reload.

### Known worktree caveat

Running the suite from a git worktree whose `node_modules` resolves outside the worktree root
fails 8 files / 21 tests with
`Denied ID .../@fontsource/ibm-plex-sans-arabic/...woff2?inline` — Vite's `server.fs.allow`
refusing the inlined font asset `src/branding/fonts.ts` imports. Every report module that
imports it fails to collect, and `Tabs/Reports/index.test.tsx` fails to render because its lazy
report-builder import hits the same denial. Reproduces identically at HEAD; unrelated to any
report code. `npm run report:static` is unaffected — it passes an explicit `root`.
