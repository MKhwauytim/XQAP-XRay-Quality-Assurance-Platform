# QA review 1 — Batches 1–2 (full scope: `batch-1-2.diff` + `batch-1-2-gap.diff`)

**Reviewer:** Fable (QA pass) · **Date:** 2026-07-12
**Scope:** `docs/audit/hardening-2026-07-08/batch-1-2.diff` (17 files, 8,224 lines, 80fc265b..a3f6a63b) **+** `docs/audit/hardening-2026-07-08/batch-1-2-gap.diff` (3 files, 577 lines — the two commits the first cut missed: 40de8e8b C6/WorkspaceGate, 8e1600f9 C1/demo-seed) vs `03-approved-plan.md` §1 (B4/B5/B6) and §2 (C1/C2/C3/C4/C6). Together the two diffs cover every commit in both batches.

## Verdict: APPROVED WITH ONE REWORK ITEM (C1)

Everything except C1 is clean and is reconfirmed below. **C1 (demo seed) has one concrete, plan-violating bug**: the seeded answers never populate the field the reporting pipeline uses as ground truth, so three of the four headline KPI cards (accuracy, detection rate, missed-suspicion rate) render as "—" in every demo report instead of the plan's required non-zero values. Everything else about C1 — real-writer usage, determinism, no-disk-write, passcode — is correct and well-built. See Rework Item 1 for the precise trace and fix.

---

## Batch 1 (B4/B5/B6) and Batch 2 C2/C3/C4/C6-App.tsx — reconfirmed from the first diff

*(Carried forward from the review of `batch-1-2.diff`; re-stated here so this file is the single complete verdict.)*

The B4/B6 CSS churn — the highest-regression-risk surface — was verified **mechanically, not by eyeball**: a token-resolution script paired every changed declaration/rule line in the five CSS files (1,245 pairs), resolved each `var(--…)` against `src/index.css` (including chained tokens), and compared normalized values. Result: **zero color drift** (every hex→token swap resolves byte-identical, including the 21 new extended-accent tokens), **zero spacing snap >2px** (346 snaps, all within B6's ≤2px allowance), and all 7 unpaired blocks are the documented B5 additions, the new C3 styles, and the token definitions — no silent deletions. All 52 surviving hex literals across the four swept files carry `/* no-token: one-off */`, match the guard baselines exactly (10/23/3/16), and `check:hex-literals` is wired into CI between lint and test. B5's mechanism is sound (`table-layout: auto` so the th/col `min-width` floor actually binds; `text-align: end` not `right`; numeric auto-detection is null-safe against the `string | null` accessor; the `td.dt-td.dt-td--numeric` specificity bump correctly beats `.dt-td:first-child`). C2's `managementReport.ts` routes **every** model/user interpolation (port keys, reviewer display names, `recommendedAction`, `exclusions.note`, `periodId`, all labels) through the executive `esc()` (`&<>"`); attribute positions only ever receive clamped numerics or literal-typed class fragments, and there are no single-quoted attributes — no XSS gap found; output is self-contained Arabic RTL HTML with `@media print` + `@page`, and the Reports card is enabled/gated on `busy || !selectedMonth`. C3's checklist renders only inside the `status === "ready"` branch (unsupported_browser/checking/prompting/error states untouched), gates on `session.role === "admin"` after all hooks (no hooks-order violation), auto-hides at ≥1 month, persists dismissal per workspace key, and its deep-link events (`app-navigate`, `pop-set-subtab`) match real listeners and valid sub-tab ids (`users`, `page-permissions`, `process`); the global `pop-set-subtab` broadcast mirrors what `Sidebar.tsx:58` already does, so no new cross-tab state pollution. C6 (`App.tsx` half) leaves `App.tsx` with 0 inline Arabic literals, and label defaults are string-identical to the removed literals (including the quoted `{fileName}` placeholder). Verified green locally: `typecheck`, `test:run` (66 files / 425 tests), `build` (2,646 kB / 970.65 kB gzip), `check:hex-literals`. B6's scaffold criterion is met by the pre-existing `--sp-1…--sp-14` scale in `index.css:130-133` (plan's `--space-*` naming was an "e.g."); consumption (532 added `var(--sp-*)` uses) is in-range. C4 is correctly out of scope (verify-only).

## Batch 2 C6 (WorkspaceGate.tsx half) — reviewed against `batch-1-2-gap.diff`, APPROVED

`WorkspaceGate.tsx` + 27 new `wsgate_*` keys in `labelsStore.ts`. Verified against the live file (which also carries later, out-of-scope E1 focus-trap changes — mentally subtracted; only the label-extraction diff was judged):

- **No missed literals.** `grep [؀-ۿ]` on the live file returns exactly two hits, both correctly out of C6's scope: `WorkspaceGate.tsx:73` (`sequence === "شف"`, the Arabic-keyboard-layout physical-key equivalent of the `"at"` shortcut — a functional comparison constant, not user-facing prose) and `WorkspaceGate.tsx:224` (an Arabic phrase inside a `//` comment, never rendered). Every rendered string — `wsgate_unsupported_*`, `wsgate_picker_*`, `wsgate_view_*`, `wsgate_missing_*`, `wsgate_wrong_address_*`, `wsgate_invalid_*`, `wsgate_error_title`, `wsgate_pick_another_btn` — is routed through either the `useLabels()`-bound `labels` object (render paths) or a direct `getLabels()` call (the one non-render call site, `submitViewPasscode` at line 95 — consistent with the same split pattern already used in `App.tsx`, not an inconsistency).
- **Hook ordering is safe.** `const labels = useLabels();` is called unconditionally, immediately after the component's other hooks and before any conditional return, in both `WorkspacePicker` (line 39, before the `unsupported_browser`/`checking`/`not_selected` branches) and `WorkspaceGate` (line 242, before the `checking`/`ready`/`missing_structure`/`invalid_structure`/default-error branches). No rules-of-hooks violation, no state loss across early returns.
- **Labels store is safe pre-workspace.** `getLabels()`/`useLabels()` (`src/data/labels/labelsStore.ts:284-307`, `useLabels.ts`) have zero dependency on workspace/directory/session state — `customLabels` is read from `localStorage` once at module load inside a `try/catch` that falls back to `{}`, and `getLabels()` is a pure synchronous object spread that can't throw once the module has loaded. Confirmed safe in every WorkspaceGate state, including `unsupported_browser` (the very first screen an unsupported browser sees, before any workspace exists).

No rework items for this half of C6.

## Batch 2 C1 (demo seed) — reviewed against `batch-1-2-gap.diff`

**Architecture is excellent and fully satisfies the plan's hard constraint and enhancement:**

- Every persisted shape goes through the real domain writers, confirmed signature-by-signature against source (not just inferred from a green build): `saveMonthRun` (`populationStorage.ts:165`), `drawSample` (`sampleAlgorithm.ts:57`), `saveSampleMaster`, `updateMonthStatus` (status literals `"sampled"`/`"distributed"` both valid members of `MonthManifestData["status"]`, `monthTypes.ts:20`), `calculateBulkAssignment` (`bulkAssignment.ts:24` — the 4 demo usernames all pass `isAssignableSampleRole`, i.e. role `employee`/`supervisor`; the manager username is deliberately excluded, matching the code comment), `appendDistributionEvents`, `buildCompletedEvent`, `saveEmployeeAnswers`. No hand-rolled JSON shape anywhere; `buildDemoPopulationRow`'s return type is declared `PreparedPopulationRow` with no `as any` escape hatch, so the compiler enforced full structural correctness against the production type — confirmed by reading the type (`populationTypes.ts`) and cross-checking every literal union value used (`"المستوى الأول"`, `"سليمة"`/`"اشتباه"`, `"بحري"`/`"بري"`, `"NonCertscan"`, `"BI Not Provided"`) against its declared union.
- **Determinism is real for the sample draw**: `DEMO_RNG_SEED = "xray-demo-fixed-seed-v1"` is a fixed string fed to `drawSample`'s Mulberry32-seeded RNG, and `calculateBulkAssignment` (Hamilton apportionment) contains no `Math.random()` — the drawn sample, port allocations, and per-employee assignment counts are bit-identical across repeated demo entries.
- **No disk writes**: the entire seed operates on the same in-memory `handle` from `createMemoryDirectory`, never touching a real `FileSystemDirectoryHandle`.
- **Demo passcode unchanged**: `VIEWER_PASSWORD` and the comparison logic in `submitViewPasscode` are untouched by this diff.
- **Non-fatal by design**: `seedDemoMonth` is wrapped in try/catch in `createDemoWorkspace` (`demoWorkspace.ts:39-45`), logged via `logError`, so a seeding failure degrades to the (still-valid) empty workspace rather than blocking demo mode.

### Rework Item 1 — demo KPIs render null, not non-zero (violates C1's stated acceptance criterion)

**File:** `src/data/workspace/demoWorkspace.ts:270-297` (the per-employee answer-seeding loop inside `seedDemoMonth`)

The seeded answers are:
```ts
answers: [
  { fieldId: "result", value: "سليمة" },
  { fieldId: "notes", value: "لا ملاحظات" },
],
```
Neither `fieldId` is `"qualityImageResult"`. Traced end to end, this means the Executive **and** the new C2 Management report's three headline accuracy metrics come back `null` for every demo month, not merely low:

1. `ExecutiveReportConfig.expertResultFieldId` defaults to `"qualityImageResult"` (`src/data/reporting/executiveReportTypes.ts:208`).
2. `expertResult` is resolved as `answerValue(answers, fieldIdsByLabel, resultValidityLabel, config.expertResultFieldId)` (`src/data/reporting/executiveReportData.ts:131-136`). `fieldIdsByLabel` comes from `input.template` (`createFieldResolver`, same file line 29-35) — and the demo workspace never creates a template or a `templates.index.json` selection (`createWorkspaceStructure` only creates an *empty* templates folder, `src/data/storage/fileSystemAccess.ts:312-315`; `Reports/index.tsx:215-217` confirms `template` resolves to `null` when no selection exists). So the label-based lookup is always empty, leaving only the direct `fieldId === "qualityImageResult"` match — which the seeded answers never contain. **`expertResult` is `null` for every seeded record.**
3. `verificationCategory` is only ever set inside `if (expertResult !== null)` (`executiveReportData.ts:151-159`) — so it stays `null` for every row too.
4. `calculateExecutiveKPIs` computes `overallAccuracy`, `suspiciousDetectionRate`, and `missedSuspicionRate` purely from counts of specific `verificationCategory` values (`executiveReportData.ts:224-234`); with zero rows classified, `validStudied === 0` and `expertSuspicious === 0`, so **all three come back `null`** (rendered as `"—"` via `fmtPct(null)`).
5. These three nulls flow straight into `ReportModel.summary` (`reportModel.ts:200-206`) — the same model the new C2 management report (`mgmt_report_kpi_accuracy`, `mgmt_report_kpi_detection`, `mgmt_report_kpi_missed`) and the existing executive report/KPI dashboard all render from. Only the 4th KPI card, `completionRate` (driven by raw submitted-answer count, not `verificationCategory`), shows a real number (~40%, as designed).
6. Separately, `imageAvailable` (`executiveReportData.ts:137`) has **no fallback field id at all** (unlike `expertResult`), so it is unconditionally `null` without a real template — which makes `decisionEvaluable` false for every fact-table record (`decisionFactTable.ts:104-107`), which in turn makes every port's data-sufficiency band compute to `"none"` (`band(0, …)` → `"none"`, `dataSufficiency.ts:23-32`) and `dataQuality.evaluableDecisionRecords` show `0`. The Management report's port table and data-quality footer will render, but every row reads "لا توجد بيانات."

Net effect: demo mode's reports are not blank (`sample.studied`, `completionRate`, population/sample counts, and the reviewer-workload table with `studied: 0` rows all render), but the specific bullet in the plan's C1 acceptance — **"KPIs non-zero"** — fails for exactly the three metrics the product exists to show (accuracy, detection, missed-suspicion), for the app whose entire purpose is X-ray inspection quality control. No test currently guards this (`src/data/workspace/demoWorkspace.ts` has zero test coverage), which is why `typecheck`/`test:run`/`build` all stayed green.

**Suggested minimal fix:** in the `bucket < 2` (submitted) and `bucket === 2` (draft) branches (`demoWorkspace.ts:270-297`), add a third answer field keyed `"qualityImageResult"`. Simplest correct version: build a `xrayImageId → PreparedPopulationRow` lookup before the per-employee loop (the rows are already in scope as `preparedRows`) and set the new field's value to that row's own `xrayLevelOneResult`, i.e. simulate "the quality reviewer agreed with the front-line decision." That alone unblocks `overallAccuracy` (~87-90%, consistent with `DEFAULT_EXEC_CONFIG.accuracyTarget: 90`) and, because ~12.5% of demo rows are seeded suspicious (`isSuspicious = seq % 8 === 0`), also gives `suspiciousDetectionRate` a non-zero denominator. For a more realistic (non-100%-agreement) profile, flip the quality value against the employee decision on a small deterministic fraction of rows to also populate `missedSuspicionRate`/`falseSuspicionRate` with non-zero values. Fixing `decisionEvaluable`/port-band `"none"` (point 6 above) is a deeper, separate lift — it requires seeding an actual `TemplateSchema` with a field labeled `"هل يوجد صورة"` plus a `templates.index.json` selection — flagged as a secondary, non-blocking follow-up rather than part of this rework item, since the plan's literal bullet is "KPIs non-zero," which the minimal fix above satisfies.

### Minor observations (non-blocking, C1)

- **Timestamps aren't seeded/deterministic.** `now = new Date().toISOString()` (`demoWorkspace.ts:531`) and `buildCompletedEvent`'s internal `eventAt` are wall-clock, so `lastSavedAt`/`submittedAt`/`eventAt` differ at the sub-second level between two demo entries. Sample composition, counts, and assignments are still bit-identical (seeded RNG + no randomness in apportionment); only timestamp metadata drifts, which is unlikely to be user-visible but technically means "two consecutive demo entries produce identical data" is true for content, not for exact JSON bytes.
- **Silent partial-failure paths.** Several early `return;` statements (`if (!saveResult.ok) return;`, `if (!drawResult.ok) return;`, `if (!sampleSaveResult.ok) return;`, `if (events.length === 0) return;`, `if (!assignResult.ok) return;`) abort seeding without calling `logError`, unlike the outer try/catch which does log. Under normal conditions none of these should trigger (inputs are valid, type-checked, and internally consistent), but if one ever does, the demo would silently show partial data with zero diagnostic trail. Low priority given the inputs are static and controlled.

---

## Non-blocking observations carried forward from Batch 1 / Batch 2 (App.tsx, C2, C3)

1. **B5 enhancement clause not fully discharged** — the plan asked to verify tabular-nums against Arabic-Indic digits (٠١٢٣) "and note the result in the commit message"; commit 738bbfde's message has no such note. Practically moot: `NUMERIC_RE` (`src/components/DataTable/utils.ts:34`) matches ASCII `\d` only and `fmtNum` uses `ar-SA-u-nu-latn`, so Arabic-Indic digits never receive the numeric treatment — worth recording that rationale somewhere durable.
2. **No opt-out for numeric auto-detection** — `isNumeric?: boolean` (`src/components/DataTable/index.tsx:1007` region) is only checked truthy, so `isNumeric: false` cannot suppress detection; a pure-digit ID column will be end-aligned with no escape hatch. Low priority; add `isNumeric === false ? skip` if it ever bites.
3. **New C3 CSS carries misleading var() fallbacks and raw hex** — `WorkspaceGate.css` (new block, e.g. `var(--c-border, #D6E2EF)` vs actual `#DDE6EF`, `var(--c-sky, #1E6FBA)` vs actual `#009ADE`, `var(--r-lg, 16px)` vs actual `10px`, raw `#162F56`/`#5EB8FF`). Inert today (tokens always defined in `index.css`), but off-pattern for a token-hygiene batch and outside the hex guard's file set.
4. **Dead CSS after C2** — `.rh-card-disabled` (`Reports.css:472`) and `.rh-badge-soon` (`Reports.css:531`) have no remaining TSX consumers now that the last "coming soon" card went live. Harmless; delete or keep for future placeholder cards.
5. **Label reuse nit** — `dataQualityFooter` (`src/data/reporting/management/managementReport.ts`) labels the overall-sufficiency pill with `mgmt_report_scope_title` ("النطاق والتغطية"); a dedicated key would read better.
6. **C2 → D2 handoff** — the builder's header comment correctly marks it for the D2 XSS test set; ensure Batch 3 actually adds `managementReport` to the shared payload corpus (`03-approved-plan.md` §D2).

## Summary

| Item | Verdict |
|---|---|
| B4 token sweep | APPROVED |
| B5 table polish | APPROVED |
| B6 spacing rhythm | APPROVED |
| C1 demo seed | **REWORK — KPI-null bug (Rework Item 1)** |
| C2 management report | APPROVED |
| C3 first-run checklist | APPROVED |
| C4 error buffer | APPROVED (verify-only, out of diff scope) |
| C6 label coverage (App.tsx) | APPROVED |
| C6 label coverage (WorkspaceGate.tsx) | APPROVED |
