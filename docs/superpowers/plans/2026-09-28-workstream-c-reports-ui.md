# Workstream C — Report & UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Workstream C of the 2026-09-28 corrective plan: (C1) every report and UI stage grouping labels the four المستوى levels in Arabic and orders them first→fourth («غير محدد» last) from ONE shared definition; (C2) an admin can flag whole ports as CertScan (union with the pasted device list, from the next processing run) and users can filter by CertScan in the employee queue, in DataTable views and in Population Browse; (C3) «الحصة اليومية» counts working days only (Sunday–Thursday) from the employee's first assignment to the existing deadline and changes only when the employee's assigned count changes.

**Architecture:** A new dependency-free module `src/data/population/stageLabels.ts` owns stage keys, Arabic labels and canonical ordering; `stageHelpers.ts` re-exports it and adds `stageBucketLabel`; every report model (`executiveKpiProfiles`, `aggregates`, `distributionCoverageModel`, `managementModel`) groups by `getStageKey(stage, workspace stageMappings)` and sorts with `compareStageKeys`; the Reports tab threads the workspace alias table in through a new optional `ExecutiveReportInput.stageMappings`. CertScan port flags are an additive optional `certScanPorts` field in population `config.json`, applied inside `processPopulation` (so `drawSample` is untouched and `SAMPLING_ALGORITHM_VERSION` does NOT change); one pure predicate module `src/data/population/certScanFilter.ts` plus one chip component serve the queue and Browse. The quota keeps its existing inputs (first `assigned` event, live assigned count, deadline = month's last day − 3) but counts working days via `src/utils/workingDays.ts`; `DERIVE_VERSION` 4→5 forces one refold per month so cached `distribution.current.json` quotas and employee mirrors pick up the new value.

**Tech Stack:** React 19, TypeScript 6 (strict, `erasableSyntaxOnly`), Vite + `vite-plugin-singlefile`, Vitest 5 (`node` default environment, per-file `/* @vitest-environment jsdom */`, `globals: false`), @testing-library/react 16, SheetJS (vendored `xlsx`).

**Spec:** `docs/superpowers/specs/2026-09-28-corrective-plan-design.md` — Workstream C only (C1, C2, C3).

---

## Global Constraints

Every task's subagent must honour all of these; they are repeated here because each subagent sees only its own task text plus this section.

- **Node** `>=22 <23`. Run everything from the repo root `/home/user/XQAP-XRay-Quality-Assurance-Platform`.
- **Branch:** `claude/beautiful-einstein-y1ouot`. Commit on it; do not create other branches; do not push unless the controller tells you to.
- **TypeScript** is strict with `erasableSyntaxOnly`: no `enum`, no `namespace`, no constructor parameter properties. Use `import type` for type-only imports.
- **Arabic UI strings go through label keys.** New user-facing text is added to `DEFAULT_LABELS` (`src/data/labels/labelsStore.ts`) or a phase label file spread into it (`src/data/labels/labels.phaseTwo.ts`) and read with `useLabels()` / `getLabels()`. The Settings tab's "أخرى" group picks new keys up automatically (`src/components/Sidebar/Tabs/Settings/index.test.tsx` enforces reachability) — do not edit Settings.
- **`certScanPorts` is additive and optional** (`certScanPorts?: string[]`, default `[]` on load). No existing workspace file changes shape in this workstream. `DERIVE_VERSION` 4→5 changes derived-cache *values* (quotas), not shape; caches are rebuildable.
- **Snapshot first for report builders.** Task 2 captures the pre-change deck2 / document / workbook output before any builder is touched. When a later task's change makes a snapshot fail, inspect the diff (`git diff -- '*.snap'` after `-u`) and accept it ONLY if every changed line is a stage label, stage key or stage ordering change; anything else is a regression — stop and report.
- **Sampling is untouched.** Do not modify `drawSample`/`sampleAlgorithm*.ts` semantics and do not bump `SAMPLING_ALGORITHM_VERSION`. (Task 6 only swaps an identical label/key constant for an import; `sampleAlgorithm.golden.test.ts` must stay green unchanged.)
- **Weekend = Friday and Saturday.** Working days are Sunday–Thursday. No holiday calendar.
- **The four المستوى levels are categorical, not a severity ranking.** "Canonical order" means display order first→fourth only; never describe it as severity in code comments or UI text.
- **Tests:** Vitest with `import { describe, expect, it } from "vitest"` (no globals). Component tests put `/* @vitest-environment jsdom */` on line 1. Disk I/O in tests uses `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts`.
- **Complexity budget:** `XrayReferrals` is at 1447/1450 lines of `max-lines-per-function` and `PopulationTab` at 1407/1450. Edits to `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` must be in-place line replacements that add ZERO net lines inside the component; follow the exact Before/After given.
- **Edits are matched by content, not line number.** Line numbers cite commit `0780a9a`. If a task's Before snippet is not found verbatim (for example because Workstream A or B merged first and touched the same lines), STOP and report BLOCKED with the mismatch — do not guess.
- **Edit log per task.** After the task's code and tests are green, run `npm run editlog -- --tier=N --append --sync-package "<title>"` (tier given per task). It inserts a skeleton at the top of `docs/edit logs/<today>.md` and bumps `package.json`. Then replace the new entry's `<...>` placeholders with the prose given in the task, paste the snippet(s) the task names into **Before:**/**After:** (tier ≥ 2), and paste your gate results into **Verification:**. Then run `npm run generate:changelog` (it regenerates the tracked `src/data/changelog/latestUpdates.generated.ts`).
- **Gates per tier.** Tier 1: `npm run lint`, `npm run typecheck`, the affected test file(s). Tier 2: `npm run lint`, `npm run typecheck`, `npm run test:run`. Tier 3: tier 2 plus `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run build`, `npm run check:bundle-size`. Do not claim a task done without running its gates and reading their output.
- **Commit message** ends with exactly these two lines (after a blank line):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
  ```
  Commit with a heredoc: `git commit -m "$(cat <<'MSG' ... MSG)"`.

## Spec deviations found while verifying root causes (read before starting)

These were verified against the code at `0780a9a`; the tasks below already implement the adjusted design.

1. **Reports never had the workspace stage alias table.** No report path receives `stageMappings` today. Added: optional `ExecutiveReportInput.stageMappings` (loaded by the Reports tab via `loadPopulationConfig`) and optional `ReportModel.stageMappings`, threaded into every grouping.
2. **deck2 `levelIndexForStage` does not need the mappings passed in.** After Task 3 every `StageProfile.stageKey` is canonical on both branches (the fallback branch used to stamp `String(index)`), so level identity resolves from `stageKey` directly; the label re-parse stays only as a fallback for hand-built profiles. `collectStagePortStats` is the deck2 function that does need the mappings (it re-buckets `model.rows`), and gets them from `model.stageMappings`.
3. **The worker's duplicate label map can be removed, not just equality-tested.** The worker cannot import `stageHelpers.ts` (it pulls `populationConfig.ts`'s main-thread graph), but it can import the new `stageLabels.ts`, which has only a type import. Its alias-index logic stays (spec only asked about the map).
4. **More duplicates than the spec lists:** `DataTable/index.tsx` `STAGE_OPTION_ORDER`, `BrowseDataView.tsx` `STAGE_FILTER_ORDER`, `replacementIndexStorage.ts` / `replacementCandidateLookup.ts` key arrays, `populationReport/fold.ts`, `dev/deckPreviewFixture.ts`, deck2 `slides.ts` key arrays. All replaced. `bulkAssignment.ts:324` is deliberately left alone (Workstream A owns that file).
5. **Employee table stage cells:** `XrayReferrals` already renders Arabic with workspace mappings (`buildReferralTableColumns` / `createRenderCell`); `XrayInspectionResults` renders Arabic with DEFAULT mappings only (`getSampleColumnValue`). The raw accessors the spec cites (`subComponents.tsx:47`, `XrayInspectionResults.tsx:91`) are reached only through base-column paths (referral preview, exports, filter options). Fix: Arabic base accessors, plus workspace mappings threaded into `XrayInspectionResults`.
6. **`aggregates.byStage[].key` becomes the Arabic label** (bucketed by canonical key, sorted, then relabelled) because its only consumer (deck3's accuracy table) displays `key` verbatim. `decisionFactTable.ts`'s `stage` stays the raw source value: it feeds the workbook's raw→analytical fact-table sheet, which must show source data.
7. **C2 needs no `SAMPLING_ALGORITHM_VERSION` bump — confirmed.** `drawSample` reads only `row.certScanStatus` (`sampleAlgorithmInternals.ts:130-131,142,168-169`); the port flag is applied in `processPopulation`, before a row ever reaches the draw. Existing samples are never re-flagged.
8. **C3 root cause is narrower than the spec says.** `assignmentDaysRemaining` already measures from the first `assigned` event's `eventAt`, not `now`, and `sampleCount` already counts live (non-replaced, including completed) entries — so the value was already frozen against completion and the passage of time. The defect is counting calendar days (and the calendar-day count's ceil/time-of-day artefacts). The fix swaps in a working-day count and bumps `DERIVE_VERSION` 4→5 so persisted caches/mirrors refold. The mirror writer (`sampleMirrorStorage.ts:427-437`) already copies the derived quota verbatim and its `deriveVersion` guard propagates v5, so it gets documentation + a regression test, not a logic change. `computeDaysRemainingForDeadline` stays (bulk assignment stamps it on events; derivation uses it only for the unparseable-month fallback).
9. **Admin port picker location:** placed in the Population "إعدادات المعالجة" modal next to the pasted CertScan list (where CertScan config already lives), reusing `PortRestrictionsModal`'s markup/CSS.
10. **Deliberately updated existing pins** (each task lists its own): `executiveKpis.golden.test.ts` ("SURPRISE … ARRAY INDEX"), `executiveKpiProfiles.test.ts` fallback, `distributionCoverageModel.test.ts` / `managementModel.test.ts` bucket keys, `fanoutB3StagePort.test.ts` gap-model order, `distributionDerivation.golden.test.ts` / `distributionLog.test.ts` calendar-day values, `distributionStorage.test.ts` `DERIVE_VERSION` pin.
11. **Out of scope, noted:** the pre-processing CertScan match preview panel (`CertScanMatchPreviewPanel`) does not reflect flagged ports; deck2 `section3/riskEngineAgreement.ts` still classifies with default mappings.

## File Structure

**Create**
- `src/data/population/stageLabels.ts` — canonical stage keys/labels/order/comparator (dependency-free).
- `src/data/population/stageLabels.test.ts`
- `src/data/population/stageLabels.duplicates.test.ts` — guard: no re-typed stage maps.
- `src/data/reporting/executive/stageCanonical.snapshot.test.ts` (+ its `__snapshots__/` file, generated)
- `src/data/reporting/executive/model/stageCanonicalOrder.test.ts`
- `src/data/reporting/executive/deck2/stageMappingsDeck.test.ts`
- `src/data/sampling/appendSampleRow.stageLabel.test.ts`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/buildXrayColumns.stage.test.ts`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.stageLabels.test.tsx`
- `src/data/population/populationConfig.certScanPorts.test.ts`
- `src/components/Sidebar/Tabs/Population/processing/populationProcessor.certScanPorts.test.ts`
- `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.tsx`
- `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.test.tsx`
- `src/data/population/certScanFilter.ts` — one CertScan predicate + column-filter helpers.
- `src/data/population/certScanFilter.test.ts`
- `src/data/population/certScanFilter.query.test.ts` — worker + fallback parity.
- `src/components/CertScanFilterChips/CertScanFilterChips.tsx` — the one chip group.
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/certScanColumn.ts` — shared DataTable status-filter props.
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/certScanQueueFilter.test.tsx`
- `src/utils/workingDays.ts`, `src/utils/workingDays.test.ts`
- `src/data/distribution/dailyQuotaWorkingDays.test.ts`
- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/quotaTile.test.tsx`

**Modify**
- C1: `src/data/population/stageHelpers.ts`, `src/data/reporting/executiveKpiProfiles.ts`, `src/data/reporting/executiveReportData.ts`, `src/data/reporting/executiveReportTypes.ts`, `src/data/reporting/executive/model/aggregates.ts`, `src/data/reporting/executive/model/distributionCoverageModel.ts`, `src/data/reporting/management/managementModel.ts`, `src/data/reporting/executive/model/reportModel.ts`, `src/data/reporting/executive/deck2/slides.ts`, `src/components/Sidebar/Tabs/Reports/TabView.tsx`, `src/data/sampling/sampleStorage.ts`, `src/data/sampling/sampleAlgorithmInternals.ts`, `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx`, `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx`, `src/components/Sidebar/Tabs/Population/components/mappingSettingsConfig.ts`, `src/data/reporting/populationReport/fold.ts`, `src/workers/populationQueryWorker.ts`, `src/components/DataTable/index.tsx`, `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`, `src/data/population/replacementIndexStorage.ts`, `src/data/distribution/replacementCandidateLookup.ts`, `src/dev/deckPreviewFixture.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`; test pins in `src/data/reporting/executiveKpiProfiles.test.ts`, `src/data/reporting/executiveKpis.golden.test.ts`, `src/data/reporting/executive/model/distributionCoverageModel.test.ts`, `src/data/reporting/management/managementModel.test.ts`, `src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts`.
- C2: `src/data/population/populationConfig.ts`, `src/components/Sidebar/Tabs/Population/processing/populationProcessingTypes.ts`, `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`, `src/components/Sidebar/Tabs/Population/index.tsx`, `src/data/distribution/portEligibility.ts`, `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx`, `src/components/Sidebar/Tabs/Population/components/PortRestrictionsModal.css`, `src/data/labels/labels.phaseTwo.ts`, `src/data/labels/labelsStore.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/caseFilter.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`, `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`, `src/components/Sidebar/Tabs/Population/Population.css`.
- C3: `src/data/distribution/distributionDerivation.ts`, `src/data/distribution/distributionLog.ts`, `src/data/distribution/distributionTypes.ts`, `src/data/samples/sampleMirrorStorage.ts`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx`, `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (type comment outside the component only), `src/data/labels/labelsStore.ts`; test pins in `src/data/distribution/distributionDerivation.golden.test.ts`, `src/data/distribution/distributionLog.test.ts`, `src/data/distribution/distributionStorage.test.ts`, `src/data/samples/sampleMirrorStorage.test.ts`.

**Task order and dependencies:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (C1), 8 → 9 → 10, 11 → 12 (C2; 11 needs nothing from 8–10), 13 → 14 → 15 (C3), 16 last. Tasks 11–12 and 13–15 do not depend on C1 beyond Task 1 being merged.

---

## Task 1: C1 — Canonical stage definitions in one module (`stageLabels.ts`)

**Files:**
- Create: `src/data/population/stageLabels.ts`
- Create: `src/data/population/stageLabels.test.ts`
- Modify: `src/data/population/stageHelpers.ts` (lines 1-4 imports, 20-25 `STAGE_LABELS_AR`, 54 `STAGE_KEY_ORDER`, append `stageBucketLabel` after `formatStageLabel` at 165-172)

**Interfaces:**
- Consumes: `StageKey`, `StageAliasMappings` types from `src/data/population/populationConfig.ts`; `getStageKey(stage: string | null, stageMappings?: Partial<StageAliasMappings>): StageCountKey` in `stageHelpers.ts`.
- Produces (from `stageLabels.ts`, re-exported by `stageHelpers.ts`):
  - `STAGE_KEY_ORDER: readonly ["first","second","third","fourth"]`
  - `STAGE_COUNT_KEY_ORDER: readonly ["first","second","third","fourth","unknown"]`
  - `STAGE_LABELS_AR: Readonly<Record<StageKey, string>>`
  - `STAGE_UNKNOWN_LABEL: "غير محدد"`
  - `isCanonicalStageKey(key: string): key is StageKey`
  - `stageLabelForKey(key: string): string`
  - `compareStageKeys(a: string, b: string): number`
  - `stageLabelRank(label: string): number | undefined`
- Produces (from `stageHelpers.ts`): `stageBucketLabel(stage: unknown, stageMappings?: Partial<StageAliasMappings>): string`

- [ ] **Step 1: Write the failing test**

Create `src/data/population/stageLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  STAGE_COUNT_KEY_ORDER,
  STAGE_KEY_ORDER,
  STAGE_LABELS_AR,
  STAGE_UNKNOWN_LABEL,
  compareStageKeys,
  isCanonicalStageKey,
  stageLabelForKey,
  stageLabelRank,
} from "./stageLabels";
import * as stageHelpers from "./stageHelpers";

describe("stageLabels — the one canonical stage definition (C1)", () => {
  it("orders the four levels first→fourth and appends unknown for the count order", () => {
    expect(STAGE_KEY_ORDER).toEqual(["first", "second", "third", "fourth"]);
    expect(STAGE_COUNT_KEY_ORDER).toEqual(["first", "second", "third", "fourth", "unknown"]);
  });

  it("labels each level in Arabic and names the unknown bucket", () => {
    expect(STAGE_LABELS_AR).toEqual({
      first: "المستوى الأول",
      second: "المستوى الثاني",
      third: "المستوى الثالث",
      fourth: "المستوى الرابع",
    });
    expect(STAGE_UNKNOWN_LABEL).toBe("غير محدد");
  });

  it("compareStageKeys sorts first→fourth, then unknown, then anything else", () => {
    const keys = ["unknown", "zzz", "fourth", "first", "third", "second"];
    expect([...keys].sort(compareStageKeys)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "unknown",
      "zzz",
    ]);
  });

  it("stageLabelForKey maps keys to labels, unknown to «غير محدد», anything else through", () => {
    expect(stageLabelForKey("third")).toBe("المستوى الثالث");
    expect(stageLabelForKey("unknown")).toBe("غير محدد");
    expect(stageLabelForKey("L1")).toBe("L1");
  });

  it("isCanonicalStageKey accepts only the four level keys", () => {
    expect(isCanonicalStageKey("first")).toBe(true);
    expect(isCanonicalStageKey("fourth")).toBe(true);
    expect(isCanonicalStageKey("unknown")).toBe(false);
    expect(isCanonicalStageKey("0")).toBe(false);
  });

  it("stageLabelRank ranks the Arabic labels 1–4 and nothing else", () => {
    expect(stageLabelRank("المستوى الأول")).toBe(1);
    expect(stageLabelRank("المستوى الرابع")).toBe(4);
    expect(stageLabelRank("غير محدد")).toBeUndefined();
    expect(stageLabelRank("FIRST_STAGE")).toBeUndefined();
  });

  it("stageHelpers re-exports the same objects (one definition, not a copy)", () => {
    expect(stageHelpers.STAGE_LABELS_AR).toBe(STAGE_LABELS_AR);
    expect(stageHelpers.STAGE_KEY_ORDER).toBe(STAGE_KEY_ORDER);
    expect(stageHelpers.compareStageKeys).toBe(compareStageKeys);
  });

  it("stageBucketLabel buckets raw aliases, custom aliases and unmapped values", () => {
    expect(stageHelpers.stageBucketLabel("SECOND_STAG")).toBe("المستوى الثاني");
    expect(stageHelpers.stageBucketLabel("FORTH_STAGE")).toBe("المستوى الرابع");
    expect(stageHelpers.stageBucketLabel("LEVEL-X")).toBe("غير محدد");
    expect(stageHelpers.stageBucketLabel(null)).toBe("غير محدد");
    expect(stageHelpers.stageBucketLabel("Level A", { first: ["Level A"] })).toBe("المستوى الأول");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/population/stageLabels.test.ts`
Expected: FAIL — `Failed to resolve import "./stageLabels"` (the module does not exist yet).

- [ ] **Step 3: Create `src/data/population/stageLabels.ts`**

```ts
// Canonical stage (المستوى) keys, Arabic labels and display order — the ONE
// definition (C1, 2026-09-28 corrective plan). Every module that needs a stage
// label, the first→fourth order or a stage comparator imports it from here
// (directly, or through stageHelpers.ts which re-exports all of it) instead of
// re-typing its own copy.
//
// Deliberately dependency-free (a single `import type`, erased at build), so
// src/workers/populationQueryWorker.ts can import it without dragging
// populationConfig.ts's main-thread graph into the worker bundle.
//
// The four levels are CATEGORICAL, not a severity ranking: "canonical order"
// is only the display order first→fourth used everywhere.
import type { StageKey } from "./populationConfig";

/** The four mapped levels, in display order. */
export const STAGE_KEY_ORDER = ["first", "second", "third", "fourth"] as const satisfies readonly StageKey[];

/** `STAGE_KEY_ORDER` plus the "unknown" bucket `getStageKey` returns for a blank or unmapped value. */
export const STAGE_COUNT_KEY_ORDER = [...STAGE_KEY_ORDER, "unknown"] as const;

/** Arabic display label per level. */
export const STAGE_LABELS_AR: Readonly<Record<StageKey, string>> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

/** Label of the "unknown" bucket (a blank or unmapped stage value). */
export const STAGE_UNKNOWN_LABEL = "غير محدد";

export function isCanonicalStageKey(key: string): key is StageKey {
  return (STAGE_KEY_ORDER as readonly string[]).includes(key);
}

/** Arabic label for a level key; «غير محدد» for "unknown"; any other string unchanged. */
export function stageLabelForKey(key: string): string {
  if (isCanonicalStageKey(key)) return STAGE_LABELS_AR[key];
  if (key === "unknown") return STAGE_UNKNOWN_LABEL;
  return key;
}

function stageKeyRank(key: string): number {
  const index = (STAGE_COUNT_KEY_ORDER as readonly string[]).indexOf(key);
  return index === -1 ? STAGE_COUNT_KEY_ORDER.length : index;
}

/**
 * Canonical comparator for stage keys: first→fourth, then "unknown", then any
 * other string (ties broken by plain string order so the result is
 * deterministic).
 */
export function compareStageKeys(a: string, b: string): number {
  const diff = stageKeyRank(a) - stageKeyRank(b);
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1–4 for an Arabic level label, `undefined` for anything else (filter-option ordering). */
export function stageLabelRank(label: string): number | undefined {
  const index = STAGE_KEY_ORDER.findIndex((key) => STAGE_LABELS_AR[key] === label);
  return index === -1 ? undefined : index + 1;
}
```

- [ ] **Step 4: Point `stageHelpers.ts` at the shared module**

In `src/data/population/stageHelpers.ts`:

Before (lines 1-4):
```ts
import { DEFAULT_STAGE_MAPPINGS } from "./populationConfig";
import type { StageKey, StageAliasMappings } from "./populationConfig";

export type { StageKey, StageAliasMappings };
```
After:
```ts
import { DEFAULT_STAGE_MAPPINGS } from "./populationConfig";
import type { StageKey, StageAliasMappings } from "./populationConfig";
import { STAGE_KEY_ORDER, STAGE_LABELS_AR, stageLabelForKey } from "./stageLabels";

export type { StageKey, StageAliasMappings };
// C1: the canonical stage definitions live in stageLabels.ts (worker-safe);
// re-exported here so existing `stageHelpers` importers keep one entry point.
export {
  STAGE_COUNT_KEY_ORDER,
  STAGE_KEY_ORDER,
  STAGE_LABELS_AR,
  STAGE_UNKNOWN_LABEL,
  compareStageKeys,
  isCanonicalStageKey,
  stageLabelForKey,
  stageLabelRank,
} from "./stageLabels";
```

Delete this block (lines 20-25) together with the blank line after it:
```ts
const STAGE_LABELS_AR: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع"
};
```

Delete this line (line 54) together with the blank line after it:
```ts
const STAGE_KEY_ORDER = ["first", "second", "third", "fourth"] as const;
```

Append at the end of the file (after `formatStageLabel`):
```ts

/**
 * The canonical bucket label for a raw stage value (C1): the Arabic level
 * label for a mapped stage, «غير محدد» for a blank or unmapped one. Unlike
 * `formatStageLabel`, an unmapped value never echoes its raw text — report
 * groupings put every unmapped row in ONE bucket, keyed "unknown".
 */
export function stageBucketLabel(
  stage: unknown,
  stageMappings?: Partial<StageAliasMappings>
): string {
  return stageLabelForKey(getStageKey(stage == null ? null : String(stage), stageMappings));
}
```

`StageKey` is still used by `aliasesFor`/`StageAliasIndex` in this file; keep that type import.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/data/population/stageLabels.test.ts src/data/population/stageHelpers.test.ts`
Expected: PASS (both files).

- [ ] **Step 6: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 7: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (stages): shared canonical stage labels, order and comparator"`
Fill the new entry:
- **Why:** `stageHelpers.ts` kept `STAGE_LABELS_AR` / `STAGE_KEY_ORDER` private, so about eight modules re-typed their own copies and several report paths sorted stages by count or insertion order (spec C1).
- **What changed:** New dependency-free `src/data/population/stageLabels.ts` owns stage keys, Arabic labels, first→fourth order, `compareStageKeys`, `stageLabelForKey`, `stageLabelRank`; `stageHelpers.ts` re-exports them and adds `stageBucketLabel` (unmapped → «غير محدد»).
- **Before/After:** the Step 4 import block.

- [ ] **Step 8: Commit**

```bash
npm run generate:changelog
git add src/data/population/stageLabels.ts src/data/population/stageLabels.test.ts src/data/population/stageHelpers.ts "docs/edit logs" package.json src/data/changelog/latestUpdates.generated.ts
git commit -m "$(cat <<'MSG'
Add (stages): shared canonical stage labels, order and comparator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 2: C1 — Snapshot the executive report builders on raw stage aliases (snapshot-first)

**Files:**
- Create: `src/data/reporting/executive/stageCanonical.snapshot.test.ts`
- Create (generated by Vitest): `src/data/reporting/executive/__snapshots__/stageCanonical.snapshot.test.ts.snap`

**Interfaces:**
- Consumes: `buildExecutiveDeckV2(input: ExecutiveReportInput): Promise<string>` (`deck2/index.ts`), `buildExecutiveReport(input): Promise<string>` (`executive/index.ts`), `buildExecutiveWorkbookObject(input): Promise<XLSX.WorkBook>` and `SHEET_NAMES` (`workbook/workbook.ts`), `makeRow`, `makeDistribution` (`src/data/reporting/reportTestFixtures.ts`).
- Produces: a committed golden snapshot of CURRENT (pre-C1) output for a month whose rows carry raw file aliases (`FORTH_STAGE`, `SECOND_STAG`, `FIRST_STAGE`, `3`, and an unmapped `LEVEL-X`), with a distribution, so Tasks 3–4 can review their stage-only diffs against it.

This task changes no production code. The snapshot deliberately records today's raw-label / count-ordered output.

- [ ] **Step 1: Write the snapshot test**

Create `src/data/reporting/executive/stageCanonical.snapshot.test.ts`:

```ts
// C1 snapshot-first (2026-09-28 corrective plan): pins the deck2, document and
// workbook output for a month whose rows carry the RAW stage aliases a real
// risk file uses (FIRST_STAGE / SECOND_STAG / "3" / FORTH_STAGE) plus one
// unmapped value, BEFORE the stage-grouping fix. The C1 tasks then review
// their snapshot diffs against this file: every changed line must be a stage
// label, key or ordering change and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../executiveReportTypes";
import { makeDistribution, makeRow } from "../reportTestFixtures";
import { buildExecutiveDeckV2 } from "./deck2/index";
import { buildExecutiveReport } from "./index";
import { buildExecutiveWorkbookObject, SHEET_NAMES } from "./workbook/workbook";

function rawStageInput(): ExecutiveReportInput {
  const rows = [
    makeRow("SC-1", "منفذ أ", { stage: "FORTH_STAGE" }),
    makeRow("SC-2", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-3", "منفذ ب", {
      stage: "SECOND_STAG",
      xrayLevelOneResult: "اشتباه",
      xrayLevelTwoResult: "اشتباه",
    }),
    makeRow("SC-4", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-5", "منفذ أ", { stage: "FIRST_STAGE" }),
    makeRow("SC-6", "منفذ ب", { stage: "3" }),
    makeRow("SC-7", "منفذ أ", { stage: "LEVEL-X" }),
  ];
  const distribution = makeDistribution(
    rows.map((row, index) => ({
      id: row.xrayImageId,
      assignedTo: index % 2 === 0 ? "u1" : "u2",
      status: index === 2 ? ("completed" as const) : ("pending" as const),
      row,
    })),
    { monthFolderName: "5-May-2026" },
  );
  return {
    monthFolderName: "5-May-2026",
    populationRows: rows,
    sample: null,
    distribution,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`missing sheet ${name}`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
}

describe("executive report editions on raw stage aliases — golden (C1 snapshot-first)", () => {
  // Both HTML editions stamp today's date; freeze Date only (the builders
  // yield through real setTimeout — see deck2.test.ts's golden snapshot).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deck2 html", async () => {
    expect(await buildExecutiveDeckV2(rawStageInput())).toMatchSnapshot();
  });

  it("document html", async () => {
    expect(await buildExecutiveReport(rawStageInput())).toMatchSnapshot();
  });

  it("workbook stage / coverage / accountability sheets", async () => {
    const wb = await buildExecutiveWorkbookObject(rawStageInput());
    expect({
      stages: sheetRows(wb, SHEET_NAMES.stages),
      coverage: sheetRows(wb, SHEET_NAMES.coverage),
      accountability: sheetRows(wb, SHEET_NAMES.accountability),
    }).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to write the snapshot**

Run: `npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts`
Expected: PASS with "3 snapshots written". Then confirm the capture really is pre-fix output:
`grep -c "SECOND_STAG" src/data/reporting/executive/__snapshots__/stageCanonical.snapshot.test.ts.snap` — Expected: a number ≥ 1 (the raw alias appears as a stage label today).

- [ ] **Step 3: Run it again to verify it is deterministic**

Run: `npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts`
Expected: PASS, "3 passed", no snapshot written/updated.

- [ ] **Step 4: Tier 1 gates**

Run: `npm run lint && npm run typecheck && npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts`
Expected: all green.

- [ ] **Step 5: Edit log (tier 1)**

Run: `npm run editlog -- --tier=1 --append --sync-package "Chore (reports): snapshot executive editions on raw stage aliases before the C1 fix"`
**What changed:** Added a golden snapshot of the deck2, document and workbook (stage/coverage/accountability sheets) output for a month whose rows carry raw stage aliases, captured before any builder change so the C1 stage fix can be reviewed as a stage-only diff.

- [ ] **Step 6: Commit**

```bash
npm run generate:changelog
git add src/data/reporting/executive/stageCanonical.snapshot.test.ts src/data/reporting/executive/__snapshots__/stageCanonical.snapshot.test.ts.snap "docs/edit logs" package.json src/data/changelog/latestUpdates.generated.ts
git commit -m "$(cat <<'MSG'
Chore (reports): snapshot executive editions on raw stage aliases before the C1 fix

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 3: C1 — Report models group by canonical stage key (Arabic labels, first→fourth)

**Files:**
- Create: `src/data/reporting/executive/model/stageCanonicalOrder.test.ts`
- Modify: `src/data/reporting/executiveReportTypes.ts` (imports 1-9; `ExecutiveReportInput` end at ~327)
- Modify: `src/data/reporting/executiveKpiProfiles.ts` (line 1 import; `buildStageProfiles` 159-201)
- Modify: `src/data/reporting/executiveReportData.ts` (imports 1-14; `calculateExecutiveKPIs` signature 214-218; call at 306)
- Modify: `src/data/reporting/executive/model/aggregates.ts` (imports 1-15; `buildAggregates` head 405-413)
- Modify: `src/data/reporting/executive/model/distributionCoverageModel.ts` (imports 8-9; `groupEntries` 69-101; `computeDistributionModel` 103-107 and 158)
- Modify: `src/data/reporting/management/managementModel.ts` (imports 21-22; `groupProgress` 94-126; `computeManagementModel` 128-134 and 175)
- Modify: `src/data/reporting/executive/model/reportModel.ts` (imports; `ReportModel` end ~170-174; calls at 182-187, 280, 286-292; return end)
- Modify (deliberate pin updates): `src/data/reporting/executiveKpiProfiles.test.ts` (84-94), `src/data/reporting/executiveKpis.golden.test.ts` (356-366), `src/data/reporting/executive/model/distributionCoverageModel.test.ts` (60), `src/data/reporting/management/managementModel.test.ts` (30-35), `src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts` (170-182, 301, 306-313, 320-335)
- Update (reviewed): `src/data/reporting/executive/__snapshots__/stageCanonical.snapshot.test.ts.snap`, and `src/data/reporting/executive/deck2/__snapshots__/deck2.test.ts.snap` / `src/data/reporting/__snapshots__/executiveReport.test.ts.snap` only if they change.

**Interfaces:**
- Consumes (Task 1): `getStageKey`, `compareStageKeys`, `stageLabelForKey`, `type StageAliasMappings` from `src/data/population/stageHelpers.ts`.
- Produces:
  - `ExecutiveReportInput.stageMappings?: Partial<StageAliasMappings>`
  - `ReportModel.stageMappings?: Partial<StageAliasMappings>`
  - `buildStageProfiles(rows: ExecutiveReportRow[], sample: SampleMasterData | null, stageMappings?: Partial<StageAliasMappings>): StageProfile[]` — `stageKey` is now always `"first" | "second" | "third" | "fourth" | "unknown"`, `stageLabel` the Arabic label / «غير محدد», sorted canonically.
  - `calculateExecutiveKPIs(rows, sample, config, stageMappings?: Partial<StageAliasMappings>): ExecutiveKPIs`
  - `buildAggregates(records, comparisons, config, stageMappings?: Partial<StageAliasMappings>): Aggregates` — `byStage[].key` is the Arabic label, canonical order.
  - `computeDistributionModel(data, monthFolderName, employeeDisplayNames?, stageMappings?: Partial<StageAliasMappings>): DistributionModel` — `byStage[].key` canonical key, `.label` Arabic, canonical order.
  - `computeManagementModel(data, monthFolderName, employeeDisplayNames?, events?, replacementReasons?, stageMappings?: Partial<StageAliasMappings>): ManagementModel` — same bucket contract.

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/model/stageCanonicalOrder.test.ts`:

```ts
// C1 (2026-09-28 corrective plan): every stage grouping in the executive /
// distribution / management models keys by getStageKey(stage, workspace
// mappings), labels with the Arabic level label, and orders first→fourth with
// «غير محدد» last — never raw file aliases, never count or first-seen order.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../../executiveReportTypes";
import { buildExecutiveReportRows } from "../../executiveReportData";
import { buildStageProfiles } from "../../executiveKpiProfiles";
import { makeDistribution, makeRow, makeSampleMaster } from "../../reportTestFixtures";
import { computeManagementModel } from "../../management/managementModel";
import { buildAggregates } from "./aggregates";
import { buildDecisionRecords } from "./decisionFactTable";
import { computeDistributionModel } from "./distributionCoverageModel";
import { buildReportModel } from "./reportModel";

const CANONICAL_KEYS = ["first", "second", "third", "fourth", "unknown"];
const CANONICAL_LABELS = [
  "المستوى الأول",
  "المستوى الثاني",
  "المستوى الثالث",
  "المستوى الرابع",
  "غير محدد",
];

function rawRows() {
  return [
    makeRow("SC-1", "منفذ أ", { stage: "FORTH_STAGE" }),
    makeRow("SC-2", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-3", "منفذ ب", {
      stage: "SECOND_STAG",
      xrayLevelOneResult: "اشتباه",
      xrayLevelTwoResult: "اشتباه",
    }),
    makeRow("SC-4", "منفذ ب", { stage: "SECOND_STAG" }),
    makeRow("SC-5", "منفذ أ", { stage: "FIRST_STAGE" }),
    makeRow("SC-6", "منفذ ب", { stage: "3" }),
    makeRow("SC-7", "منفذ أ", { stage: "LEVEL-X" }),
  ];
}

function input(overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput {
  const rows = rawRows();
  return {
    monthFolderName: "5-May-2026",
    populationRows: rows,
    sample: null,
    distribution: makeDistribution(
      rows.map((row, index) => ({
        id: row.xrayImageId,
        assignedTo: index % 2 === 0 ? "u1" : "u2",
        status: index === 2 ? ("completed" as const) : ("pending" as const),
        row,
      })),
      { monthFolderName: "5-May-2026" },
    ),
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    ...overrides,
  };
}

describe("C1 — stage groupings are Arabic and canonically ordered", () => {
  it("population stage profiles (no sample): canonical keys, Arabic labels, first→fourth then unknown", () => {
    const model = buildReportModel(input());
    expect(model.population.byStage.map((s) => s.stageKey)).toEqual(CANONICAL_KEYS);
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(CANONICAL_LABELS);
    expect(model.population.byStage.map((s) => s.population)).toEqual([1, 3, 1, 1, 1]);
  });

  it("population stage profiles (sample allocations): relabelled from the key and sorted", () => {
    const base = input();
    const sample = makeSampleMaster(base.populationRows, {
      stageAllocations: [
        { stageKey: "third", stageLabel: "المستوى الثالث", populationSize: 1, targetQuota: 1, actualDrawn: 1, certScanDrawn: 0, nonCertScanDrawn: 1 },
        { stageKey: "first", stageLabel: "FIRST_STAGE", populationSize: 1, targetQuota: 1, actualDrawn: 1, certScanDrawn: 0, nonCertScanDrawn: 1 },
      ],
    });
    const rows = buildExecutiveReportRows({ ...base, sample });
    const profiles = buildStageProfiles(rows, sample);
    expect(profiles.map((p) => p.stageKey)).toEqual(["first", "third"]);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المستوى الأول", "المستوى الثالث"]);
  });

  it("honours the workspace stage alias table and exposes it on the model", () => {
    const rows = [makeRow("CU-1", "منفذ أ", { stage: "Level A" })];
    const model = buildReportModel({
      ...input(),
      populationRows: rows,
      distribution: null,
      stageMappings: { first: ["Level A"] },
    });
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الأول"]);
    expect(model.stageMappings).toEqual({ first: ["Level A"] });
  });

  it("distribution coverage buckets: canonical keys, Arabic labels, canonical order", () => {
    const m = computeDistributionModel(input().distribution!, "5-May-2026");
    expect(m.byStage.map((b) => b.key)).toEqual(CANONICAL_KEYS);
    expect(m.byStage.map((b) => b.label)).toEqual(CANONICAL_LABELS);
  });

  it("management progress buckets: canonical keys, Arabic labels, canonical order", () => {
    const m = computeManagementModel(input().distribution!, "5-May-2026");
    expect(m.byStage.map((b) => b.key)).toEqual(CANONICAL_KEYS);
    expect(m.byStage.map((b) => b.label)).toEqual(CANONICAL_LABELS);
  });

  it("stage accuracy aggregates: Arabic label as key, canonical order", () => {
    const rows = buildExecutiveReportRows(input()).map((row) => ({
      ...row,
      expertResult: "سليمة" as const,
    }));
    const agg = buildAggregates(buildDecisionRecords(rows, "5-May-2026"), [], DEFAULT_EXEC_CONFIG);
    expect(agg.byStage.map((s) => s.key)).toEqual(CANONICAL_LABELS);
  });

  it("the report model threads the alias table into coverage and accountability", () => {
    const rows = [makeRow("CU-1", "منفذ أ", { stage: "Level A" })];
    const model = buildReportModel({
      ...input(),
      populationRows: rows,
      distribution: makeDistribution([{ id: "CU-1", assignedTo: "u1", status: "pending", row: rows[0]! }]),
      stageMappings: { first: ["Level A"] },
    });
    expect(model.distributionCoverage!.byStage.map((b) => b.label)).toEqual(["المستوى الأول"]);
    expect(model.accountabilityProgress!.byStage.map((b) => b.label)).toEqual(["المستوى الأول"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/reporting/executive/model/stageCanonicalOrder.test.ts`
Expected: FAIL — e.g. the first test receives `stageKey` values `["0","1","2","3","4"]` and raw labels such as `"FORTH_STAGE"`; the coverage test receives keys like `"SECOND_STAG"` sorted by count.

- [ ] **Step 3: Add `stageMappings` to `ExecutiveReportInput`**

In `src/data/reporting/executiveReportTypes.ts`:

Before:
```ts
import type { SourceRevisions } from "./sourceRevisions";
```
After:
```ts
import type { SourceRevisions } from "./sourceRevisions";
import type { StageAliasMappings } from "../population/populationConfig";
```

Before (end of `ExecutiveReportInput`):
```ts
  processingSummary?: ProcessingSummaryData | null;
};
```
After:
```ts
  processingSummary?: ProcessingSummaryData | null;
  /**
   * The workspace's stage alias table (`config.json` → `stageMappings`),
   * loaded by the Reports tab (C1). Every stage grouping in the report keys by
   * `getStageKey(row.stage, stageMappings)` so a custom alias lands in the
   * same level processing put it in. Optional: callers that omit it classify
   * against DEFAULT_STAGE_MAPPINGS.
   */
  stageMappings?: Partial<StageAliasMappings>;
};
```

- [ ] **Step 4: Rewrite `buildStageProfiles`**

In `src/data/reporting/executiveKpiProfiles.ts`:

Before (line 1):
```ts
import { formatStageLabel } from "../population/stageHelpers";
```
After:
```ts
import {
  compareStageKeys,
  getStageKey,
  stageLabelForKey,
  type StageAliasMappings,
} from "../population/stageHelpers";
```

Replace the whole `buildStageProfiles` function (from `export function buildStageProfiles(` to the end of the file) with:
```ts
/**
 * Stage profiles in canonical order (C1): first→fourth, "unknown" last, every
 * label the Arabic level label — never the raw file alias (`FIRST_STAGE`,
 * `SECOND_STAG`, …) and never first-seen or count order. `stageMappings` is
 * the workspace alias table (`ExecutiveReportInput.stageMappings`); omitted,
 * DEFAULT_STAGE_MAPPINGS applies.
 */
export function buildStageProfiles(
  rows: ExecutiveReportRow[],
  sample: SampleMasterData | null,
  stageMappings?: Partial<StageAliasMappings>,
): StageProfile[] {
  const stageKeyOf = (row: ExecutiveReportRow): string => getStageKey(row.stage, stageMappings);

  if (sample?.stageAllocations?.length) {
    return sample.stageAllocations
      .map((allocation) => {
        const studied = rows.filter(
          (row) =>
            row.selectedInSample &&
            isRowStudied(row) &&
            stageKeyOf(row) === allocation.stageKey,
        ).length;
        return {
          stageKey: allocation.stageKey,
          // Relabelled from the key: a manual-add allocation written before
          // C1 carries the raw row text as its label (sampleStorage.ts).
          stageLabel: stageLabelForKey(allocation.stageKey),
          population: allocation.populationSize,
          sampleSize: allocation.actualDrawn,
          coverage:
            allocation.populationSize > 0
              ? (allocation.actualDrawn / allocation.populationSize) * 100
              : 0,
          studied,
          completionRate: allocation.actualDrawn > 0 ? (studied / allocation.actualDrawn) * 100 : 0,
        };
      })
      .sort((left, right) => compareStageKeys(left.stageKey, right.stageKey));
  }

  return [...groupRows(rows, stageKeyOf)]
    .sort(([left], [right]) => compareStageKeys(left, right))
    .map(([stageKey, stageRows]) => {
      const sampled = stageRows.filter((row) => row.selectedInSample);
      const studied = sampled.filter(isRowStudied).length;
      return {
        stageKey,
        stageLabel: stageLabelForKey(stageKey),
        population: stageRows.length,
        sampleSize: sampled.length,
        coverage: stageRows.length > 0 ? (sampled.length / stageRows.length) * 100 : 0,
        studied,
        completionRate: sampled.length > 0 ? (studied / sampled.length) * 100 : 0,
      };
    });
}
```

- [ ] **Step 5: Thread the mappings through `calculateExecutiveKPIs`**

In `src/data/reporting/executiveReportData.ts`:

Before:
```ts
import { classifyImageResult } from "../population/imageResult";
```
After:
```ts
import { classifyImageResult } from "../population/imageResult";
import type { StageAliasMappings } from "../population/stageHelpers";
```

Before:
```ts
export function calculateExecutiveKPIs(
  rows: ExecutiveReportRow[],
  sample: SampleMasterData | null,
  config: ExecutiveReportConfig
): ExecutiveKPIs {
```
After:
```ts
export function calculateExecutiveKPIs(
  rows: ExecutiveReportRow[],
  sample: SampleMasterData | null,
  config: ExecutiveReportConfig,
  stageMappings?: Partial<StageAliasMappings>
): ExecutiveKPIs {
```

Before:
```ts
  const stageProfiles = buildStageProfiles(rows, sample);
```
After:
```ts
  const stageProfiles = buildStageProfiles(rows, sample, stageMappings);
```

- [ ] **Step 6: Canonical stage accuracy in `buildAggregates`**

In `src/data/reporting/executive/model/aggregates.ts`, after the existing `import type { ... } from "./decisionFactTable";` block (ends at line 15), add:
```ts
import {
  compareStageKeys,
  getStageKey,
  stageLabelForKey,
  type StageAliasMappings,
} from "../../../population/stageHelpers";
```

Before:
```ts
export function buildAggregates(
  records: DecisionRecord[],
  comparisons: ImageResultComparison[],
  config: ExecutiveReportConfig
): Aggregates {
  const entryDay = buildByEntryDay(records, config);
  return {
    byPort: foldBy(records, (r) => r.portName, config),
    byStage: foldBy(records, (r) => r.stage, config),
```
After:
```ts
export function buildAggregates(
  records: DecisionRecord[],
  comparisons: ImageResultComparison[],
  config: ExecutiveReportConfig,
  stageMappings?: Partial<StageAliasMappings>
): Aggregates {
  const entryDay = buildByEntryDay(records, config);
  return {
    byPort: foldBy(records, (r) => r.portName, config),
    // C1: bucket by canonical stage key (raw aliases such as FIRST_STAGE /
    // SECOND_STAG collapse into their level), order first→fourth with
    // "unknown" last, then expose the Arabic label as `key` — the consumers
    // (deck3's accuracy table) display `key` verbatim.
    byStage: foldBy(records, (r) => getStageKey(r.stage, stageMappings), config)
      .sort((a, b) => compareStageKeys(a.key, b.key))
      .map((s) => ({ ...s, key: stageLabelForKey(s.key) })),
```

- [ ] **Step 7: Canonical buckets in `distributionCoverageModel.ts`**

In `src/data/reporting/executive/model/distributionCoverageModel.ts`:

Before:
```ts
import type { DistributionCurrentData } from "../../../distribution/distributionTypes";
import { formatMonthLabel } from "../../shared/reportChrome";
```
After:
```ts
import type { DistributionCurrentData } from "../../../distribution/distributionTypes";
import {
  compareStageKeys,
  getStageKey,
  stageLabelForKey,
  type StageAliasMappings,
} from "../../../population/stageHelpers";
import { formatMonthLabel } from "../../shared/reportChrome";
```

Replace the whole `groupEntries` function (its doc comment through its closing `}`) with:
```ts
/** Group distribution entries into per-key buckets (stage or port), each with
 *  a per-employee breakdown. Bucket order: highest total first (ties → key
 *  ascending, for deterministic output) unless `options.compareKeys` is given
 *  — the stage grouping passes `compareStageKeys` (C1: first→fourth, unknown
 *  last). `options.labelOf` turns a key into its display label (default: the
 *  key itself). Employee order within a bucket: highest assigned first (ties →
 *  username ascending). */
function groupEntries(
  entries: DistributionCurrentData["entries"],
  keyOf: (e: DistributionCurrentData["entries"][number]) => string,
  nameOf: (u: string) => string,
  options: { labelOf?: (key: string) => string; compareKeys?: (a: string, b: string) => number } = {},
): DistributionBucket[] {
  const { labelOf = (key: string) => key, compareKeys } = options;
  const buckets = new Map<string, Map<string, BucketEmployeeStat>>();
  for (const e of entries) {
    const key = keyOf(e) || "غير محدد";
    let empMap = buckets.get(key);
    if (!empMap) { empMap = new Map(); buckets.set(key, empMap); }
    let stat = empMap.get(e.assignedTo);
    if (!stat) {
      stat = { username: e.assignedTo, displayName: nameOf(e.assignedTo), assigned: 0, completed: 0, completionRate: null };
      empMap.set(e.assignedTo, stat);
    }
    stat.assigned++;
    if (e.status === "completed") stat.completed++;
  }
  return [...buckets.entries()]
    .map(([key, empMap]) => {
      const employees = [...empMap.values()]
        .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.assigned) }))
        .sort((a, b) => b.assigned - a.assigned || a.username.localeCompare(b.username));
      const totalAssigned = employees.reduce((s, e) => s + e.assigned, 0);
      const totalCompleted = employees.reduce((s, e) => s + e.completed, 0);
      return { key, label: labelOf(key), totalAssigned, totalCompleted, completionRate: ratePct(totalCompleted, totalAssigned), employees };
    })
    .sort((a, b) =>
      compareKeys ? compareKeys(a.key, b.key) : b.totalAssigned - a.totalAssigned || a.key.localeCompare(b.key),
    );
}
```

Before:
```ts
export function computeDistributionModel(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
): DistributionModel {
```
After:
```ts
export function computeDistributionModel(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  stageMappings?: Partial<StageAliasMappings>,
): DistributionModel {
```

Before:
```ts
    byStage: groupEntries(data.entries, (e) => e.row.stage ?? "غير محدد", nameOf),
```
After:
```ts
    byStage: groupEntries(data.entries, (e) => getStageKey(e.row.stage, stageMappings), nameOf, {
      labelOf: stageLabelForKey,
      compareKeys: compareStageKeys,
    }),
```

- [ ] **Step 8: Canonical buckets in `managementModel.ts`**

In `src/data/reporting/management/managementModel.ts`:

Before:
```ts
import type { DistributionCurrentData, DistributionEvent } from "../../distribution/distributionTypes";
import { formatMonthLabel } from "../shared/reportChrome";
```
After:
```ts
import type { DistributionCurrentData, DistributionEvent } from "../../distribution/distributionTypes";
import {
  compareStageKeys,
  getStageKey,
  stageLabelForKey,
  type StageAliasMappings,
} from "../../population/stageHelpers";
import { formatMonthLabel } from "../shared/reportChrome";
```

Replace the whole `groupProgress` function with:
```ts
function groupProgress(
  entries: DistributionCurrentData["entries"],
  keyOf: (e: DistributionCurrentData["entries"][number]) => string,
  nameOf: (u: string) => string,
  options: { labelOf?: (key: string) => string; compareKeys?: (a: string, b: string) => number } = {},
): ManagementBucket[] {
  // Same bucket contract as distributionCoverageModel.ts's groupEntries:
  // `compareKeys` (the stage grouping passes compareStageKeys, C1) replaces
  // the default largest-first order; `labelOf` maps a key to its label.
  const { labelOf = (key: string) => key, compareKeys } = options;
  const buckets = new Map<string, Map<string, ManagementEmployeeProgress>>();
  for (const e of entries) {
    // A replaced image is no longer "in progress" for its original assignee —
    // exclude it from progress buckets (it's reported separately, in
    // `replacements`). Everything else (pending/completed/requested) counts.
    if (e.status === "replaced") continue;
    const key = keyOf(e) || "غير محدد";
    let empMap = buckets.get(key);
    if (!empMap) { empMap = new Map(); buckets.set(key, empMap); }
    let stat = empMap.get(e.assignedTo);
    if (!stat) {
      stat = { username: e.assignedTo, displayName: nameOf(e.assignedTo), assigned: 0, completed: 0, completionRate: null };
      empMap.set(e.assignedTo, stat);
    }
    stat.assigned++;
    if (e.status === "completed") stat.completed++;
  }
  return [...buckets.entries()]
    .map(([key, empMap]) => {
      const employees = [...empMap.values()]
        .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.assigned) }))
        .sort((a, b) => b.assigned - a.assigned || a.username.localeCompare(b.username));
      const totalAssigned = employees.reduce((s, e) => s + e.assigned, 0);
      const totalCompleted = employees.reduce((s, e) => s + e.completed, 0);
      return { key, label: labelOf(key), totalAssigned, totalCompleted, completionRate: ratePct(totalCompleted, totalAssigned), employees };
    })
    .sort((a, b) =>
      compareKeys ? compareKeys(a.key, b.key) : b.totalAssigned - a.totalAssigned || a.key.localeCompare(b.key),
    );
}
```

Before:
```ts
  events: DistributionEvent[] = [],
  replacementReasons: Record<string, string> = {},
): ManagementModel {
```
After:
```ts
  events: DistributionEvent[] = [],
  replacementReasons: Record<string, string> = {},
  stageMappings?: Partial<StageAliasMappings>,
): ManagementModel {
```

Before:
```ts
    byStage: groupProgress(data.entries, (e) => e.row.stage ?? "غير محدد", nameOf),
```
After:
```ts
    byStage: groupProgress(data.entries, (e) => getStageKey(e.row.stage, stageMappings), nameOf, {
      labelOf: stageLabelForKey,
      compareKeys: compareStageKeys,
    }),
```

- [ ] **Step 9: Thread the mappings through `buildReportModel`**

In `src/data/reporting/executive/model/reportModel.ts`:

Before:
```ts
import type { ManagementBucket, ManagementModel } from "../../management/managementModel";
```
After:
```ts
import type { ManagementBucket, ManagementModel } from "../../management/managementModel";
import type { StageAliasMappings } from "../../../population/stageHelpers";
```

Before (end of the `ReportModel` type):
```ts
  factTable: DecisionRecord[];
  rows: ExecutiveReportRow[];
  kpis: ExecutiveKPIs;
};
```
After:
```ts
  factTable: DecisionRecord[];
  rows: ExecutiveReportRow[];
  kpis: ExecutiveKPIs;
  /** The workspace stage alias table this model was built with (C1). A
   *  renderer that re-buckets `rows` by stage (deck2's stage×port pages) must
   *  use the SAME table, or a custom alias lands in a different bucket than
   *  `population.byStage`. Undefined = DEFAULT_STAGE_MAPPINGS. */
  stageMappings?: Partial<StageAliasMappings>;
};
```

Before:
```ts
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
```
After:
```ts
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config, input.stageMappings);
```

Before:
```ts
  const aggregates = buildAggregates(factTable, comparisons, input.config);
```
After:
```ts
  const aggregates = buildAggregates(factTable, comparisons, input.config, input.stageMappings);
```

Before:
```ts
        const m = computeDistributionModel(dist, input.monthFolderName, employeeDisplayNames);
```
After:
```ts
        const m = computeDistributionModel(dist, input.monthFolderName, employeeDisplayNames, input.stageMappings);
```

Before:
```ts
          input.distributionEvents ?? [],
          input.replacementReasons ?? {},
        );
```
After:
```ts
          input.distributionEvents ?? [],
          input.replacementReasons ?? {},
          input.stageMappings,
        );
```

Before (end of the returned object):
```ts
    factTable,
    rows,
    kpis,
  };
}
```
After:
```ts
    factTable,
    rows,
    kpis,
    stageMappings: input.stageMappings,
  };
}
```

- [ ] **Step 10: Run the new test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/model/stageCanonicalOrder.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 11: Update the pins that recorded the old behaviour**

Run first to see them fail: `npx vitest run src/data/reporting/executiveKpiProfiles.test.ts src/data/reporting/executiveKpis.golden.test.ts src/data/reporting/executive/model/distributionCoverageModel.test.ts src/data/reporting/management/managementModel.test.ts src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts`
Expected: FAIL in exactly the assertions edited below.

(a) `src/data/reporting/executiveKpiProfiles.test.ts` — Before:
```ts
  it("groups by stage in first-seen order with numeric stageKey", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", stage: "المرحلة الثانية" }),
      row({ xrayImageId: "2", stage: "المرحلة الأولى" }),
      row({ xrayImageId: "3", stage: "المرحلة الثانية" }),
    ];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المرحلة الثانية", "المرحلة الأولى"]);
    expect(profiles.map((p) => p.stageKey)).toEqual(["0", "1"]);
    expect(profiles[0]!.population).toBe(2);
  });
```
After:
```ts
  it("CHANGED (C1): groups raw aliases by canonical stage key, labels in Arabic, orders first→fourth", () => {
    const rows: ExecutiveReportRow[] = [
      row({ xrayImageId: "1", stage: "SECOND_STAG" }),
      row({ xrayImageId: "2", stage: "FIRST_STAGE" }),
      row({ xrayImageId: "3", stage: "SECOND_STAG" }),
    ];
    const profiles = buildStageProfiles(rows, null);
    expect(profiles.map((p) => p.stageLabel)).toEqual(["المستوى الأول", "المستوى الثاني"]);
    expect(profiles.map((p) => p.stageKey)).toEqual(["first", "second"]);
    expect(profiles[1]!.population).toBe(2);
  });
```

(b) `src/data/reporting/executiveKpis.golden.test.ts` — Before:
```ts
  it("SURPRISE: with no stageAllocations, stage profiles key on the ARRAY INDEX and label with the raw stage value", () => {
    // executiveKpiProfiles.ts (buildStageProfiles fallback branch) emits
    // `stageKey: String(index)` and uses the raw `row.stage` string as the
    // label — so a month whose sample master carries no stageAllocations
    // produces stage keys ("0", "1", …) that match nothing else in the app and
    // an un-localized label.
    expect(kpis.stageProfiles).toEqual([
      {
        stageKey: "0",
        stageLabel: "1",
```
After:
```ts
  it("CHANGED (C1): with no stageAllocations, stage profiles key on the canonical stage key and carry the Arabic label", () => {
    // executiveKpiProfiles.ts (buildStageProfiles fallback branch) used to
    // emit `stageKey: String(index)` and the raw `row.stage` text ("1") as
    // the label. It now groups by getStageKey — "1" is a DEFAULT alias of the
    // first level — so the key is canonical and the label Arabic.
    expect(kpis.stageProfiles).toEqual([
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
```

(c) `src/data/reporting/executive/model/distributionCoverageModel.test.ts` — Before:
```ts
    expect(m.byStage[0]!.key).toBe("المستوى الثاني");
```
After:
```ts
    expect(m.byStage[0]!.key).toBe("second");
    expect(m.byStage[0]!.label).toBe("المستوى الثاني");
```

(d) `src/data/reporting/management/managementModel.test.ts` — Before:
```ts
    expect(m.byStage.map((b) => b.key).sort()).toEqual(["المستوى الأول", "المستوى الثاني"]);
    const lvl1 = m.byStage.find((b) => b.key === "المستوى الأول")!;
```
After:
```ts
    expect(m.byStage.map((b) => b.label)).toEqual(["المستوى الأول", "المستوى الثاني"]);
    const lvl1 = m.byStage.find((b) => b.key === "first")!;
```
and Before:
```ts
    const lvl2 = m.byStage.find((b) => b.key === "المستوى الثاني")!;
```
After:
```ts
    const lvl2 = m.byStage.find((b) => b.key === "second")!;
```

(e) `src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts` — the gap model's rows arrive level-4-first but `byStage` is now canonical. Before (doc comment above `function gapModel()`):
```ts
/**
 * A GAP fixture — only المستوى الرابع (level 4, small population) and
 * المستوى الثاني (level 2, large population) have any rows; levels 1 and 3
 * are entirely absent from `model.population.byStage`. Level 4's (smaller)
 * rows come FIRST, so `stages` is `[level4, level2]` — array positions
 * [0, 1]. Position-based indexing (the pre-2026-07-28 bug class) would pair
 * position 0 with level 1's tone/ordinal and position 1 with level 2's —
 * both wrong. A magnitude-sort would additionally put level 2 (4 rows)
 * BEFORE level 4 (1 row); this fixture keeps them in encounter order so a
 * "never sorted by size" check has a real divergence to catch, not a
 * coincidence.
 */
```
After:
```ts
/**
 * A GAP fixture — only المستوى الرابع (level 4, small population) and
 * المستوى الثاني (level 2, large population) have any rows; levels 1 and 3
 * are entirely absent from `model.population.byStage`. Level 4's rows come
 * FIRST in the input, but since C1 (2026-09-28) `byStage` is always in
 * canonical first→fourth order, so `stages` is `[level2, level4]` — array
 * positions [0, 1]. Position-based indexing (the pre-2026-07-28 bug class)
 * would pair position 0 with level 1's tone (gold) and position 1 with level
 * 2's (blue) — wrong for both level 2 (blue) and level 4 (coral).
 */
```
Before:
```ts
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الرابع", "المستوى الثاني"]);
```
After:
```ts
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الثاني", "المستوى الرابع"]);
```
Before:
```ts
    // Position 0 is level 4: coral, NOT level 1's gold that positional
    // indexing (array position 0 → STAGE_TONES[0]) would have produced.
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card coral">');
    // Position 1 is level 2: blue — asserted explicitly, not assumed correct
    // by omission (level 2's own tone happens to also sit at STAGE_TONES[1],
    // so a positional-index bug could coincidentally look right here; the
    // coral assertion above is what actually catches the bug class).
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card blue">');
```
After:
```ts
    // Position 1 is level 4: coral, NOT level 2's blue that positional
    // indexing (array position 1 → STAGE_TONES[1]) would have produced.
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card coral">');
    // Position 0 is level 2: blue — NOT level 1's gold (asserted absent
    // below), which is what positional indexing gives position 0.
    expect(panel1).toContain('class="v2-lg-stage-card v2-stage-port-card blue">');
```
Before:
```ts
  it("Briefing: rank-row tone follows its OWN level, and display order (never sorted by population size) is preserved", () => {
```
After:
```ts
  it("Briefing: rank-row tone follows its OWN level, and display order is canonical stage order", () => {
```
Before:
```ts
    // المستوى الرابع (population 1) comes BEFORE المستوى الثاني (population
    // 4) — a magnitude sort would reverse this; display/stage order must win.
    expect(labels).toEqual(["المستوى الرابع", "المستوى الثاني"]);

    const tones = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(tones).toEqual(["coral", "blue"]);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual([fmtNum(1), fmtNum(4)]);
```
After:
```ts
    // Canonical stage order (C1): المستوى الثاني before المستوى الرابع,
    // whatever order the rows arrived in.
    expect(labels).toEqual(["المستوى الثاني", "المستوى الرابع"]);

    const tones = [...panel2.matchAll(/<span class="v2-bf-rank-num (\w+)">/g)].map((m) => m[1]);
    expect(tones).toEqual(["blue", "coral"]);

    const values = [...panel2.matchAll(/<span class="v2-bf-rank-value">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(values).toEqual([fmtNum(4), fmtNum(1)]);
```

Re-run the five files. Expected: PASS. If any OTHER assertion in them fails, it must be purely a stage-order/label consequence of this task; if it is anything else, stop and report.

- [ ] **Step 12: Review and update the report snapshots**

Run: `npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts src/data/reporting/executive/deck2/deck2.test.ts src/data/reporting/executiveReport.test.ts`
Expected: `stageCanonical.snapshot.test.ts` FAILS (stage labels/order changed); the other two may or may not fail.
For each failing file, re-run it with `-u` (e.g. `npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts -u`), then inspect `git diff -- '*.snap'`. Accept only if every changed line is a stage label (raw alias → Arabic label / «غير محدد»), a stage key (`"0"`… → `"first"`…) or stage ordering. In the workbook snapshot the `stages` / `coverage` / `accountability` stage rows must now read المستوى الأول … المستوى الرابع then غير محدد, in that order. Row-level data columns that print the source `stage` value may legitimately still show raw aliases. Any other kind of diff: `git checkout -- '*.snap'` and report BLOCKED.

- [ ] **Step 13: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 14: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (reports): stage groupings use Arabic labels in canonical order"`
- **Why:** Report models grouped stages by the raw file text (`FIRST_STAGE`, `SECOND_STAG`, `3`…) and ordered them by count or first-seen, so reports showed English aliases in arbitrary order and a custom workspace alias was never honoured (spec C1; `executiveKpiProfiles.ts:185-199`, `distributionCoverageModel.ts:98-100,158`, `managementModel.ts:94-126,175`, `aggregates.ts:413`).
- **What changed:** `buildStageProfiles`, `buildAggregates().byStage`, `computeDistributionModel().byStage` and `computeManagementModel().byStage` key by `getStageKey(stage, stageMappings)`, label with the Arabic level label («غير محدد» for unmapped), and sort first→fourth; `ExecutiveReportInput` / `ReportModel` gain optional `stageMappings`; allocation-branch profiles are relabelled from their key. Pins recording the old order/labels updated; report snapshots reviewed (stage-only diff).
- **Before/After:** the Step 4 `buildStageProfiles` fallback branch (old `groupRows(rows, (row) => row.stage ?? "غير محدد")` block vs the new one).

- [ ] **Step 15: Commit**

```bash
npm run generate:changelog
git add src/data/reporting src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (reports): stage groupings use Arabic labels in canonical order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 4: C1 — deck2 stage identity from the canonical key; Reports tab loads the workspace alias table

**Files:**
- Create: `src/data/reporting/executive/deck2/stageMappingsDeck.test.ts`
- Modify: `src/data/reporting/executive/deck2/slides.ts` (import line 19; line 653; lines 713-750 `CANONICAL_STAGE_ORDER` + `levelIndexForStage`; `collectStagePortStats` 2074-2111; seven `formatStageLabel(<x>.stageLabel)` lookups at 2215, 2260, 2382, 2575, 2579, 2609, 2613)
- Modify: `src/components/Sidebar/Tabs/Reports/TabView.tsx` (imports; `loadExecInput` 319-358)
- Update (reviewed): `src/data/reporting/executive/__snapshots__/stageCanonical.snapshot.test.ts.snap`

**Interfaces:**
- Consumes (Tasks 1, 3): `STAGE_KEY_ORDER`, `isCanonicalStageKey`, `stageLabelForKey`, `stageBucketLabel`, `formatStageLabel`, `getStageKey` from `stageHelpers.ts`; `ReportModel.stageMappings`; `ExecutiveReportInput.stageMappings`; `loadPopulationConfig(directoryHandle: DirectoryHandleLike | null): Promise<PopulationConfig>` from `src/data/population/populationConfig.ts`.
- Produces: `collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]>` now keyed by `stageBucketLabel(row.stage, model.stageMappings)`; the Reports tab's `ExecutiveReportInput` carries `stageMappings`.

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/deck2/stageMappingsDeck.test.ts`:

```ts
// C1: deck2's stage×port pages must bucket rows with the SAME workspace alias
// table as the stage profiles, and resolve a card's level from the canonical
// stageKey — a custom alias must never fall through to "unknown" / neutral.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../../executiveReportTypes";
import type { StageAliasMappings } from "../../../population/populationConfig";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { makeRow } from "../../reportTestFixtures";
import { buildReportModel } from "../model/reportModel";
import { collectStagePortStats, stagePortPopulationSlide } from "./slides";

function input(
  populationRows: PreparedPopulationRow[],
  stageMappings?: Partial<StageAliasMappings>,
): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    stageMappings,
  };
}

describe("deck2 stage identity under workspace stage mappings (C1)", () => {
  it("collectStagePortStats buckets a custom alias under the same Arabic label as its profile", () => {
    const model = buildReportModel(
      input(
        [
          makeRow("A-1", "ميناء أ", { stage: "Custom Two" }),
          makeRow("A-2", "ميناء أ", { stage: "Custom Two" }),
        ],
        { second: ["Custom Two"] },
      ),
    );
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["المستوى الثاني"]);
    expect([...collectStagePortStats(model).keys()]).toEqual(["المستوى الثاني"]);
  });

  it("an unmapped raw stage lands in the «غير محدد» bucket, matching its profile", () => {
    const model = buildReportModel(input([makeRow("B-1", "ميناء أ", { stage: "LEVEL-X" })]));
    expect(model.population.byStage.map((s) => s.stageLabel)).toEqual(["غير محدد"]);
    expect([...collectStagePortStats(model).keys()]).toEqual(["غير محدد"]);
  });

  it("level identity (tone) comes from the canonical stageKey, not from re-parsing the label", () => {
    const model = buildReportModel(input([makeRow("C-1", "ميناء أ", { stage: "SECOND_STAG" })]));
    model.population.byStage = model.population.byStage.map((s) => ({ ...s, stageLabel: "مستوى مخصص" }));
    const html = stagePortPopulationSlide(model, 7, 20, true);
    expect(html).toMatch(/v2-stage-card blue v2-stage-port-card|v2-stage-port-card blue"/);
    expect(html).not.toMatch(/v2-stage-card neutral v2-stage-port-card|v2-stage-port-card neutral"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/stageMappingsDeck.test.ts`
Expected: FAIL — test 1 gets keys `["Custom Two"]`, test 2 gets `["LEVEL-X"]`, test 3 finds a `neutral` card.

- [ ] **Step 3: Edit `slides.ts`**

In `src/data/reporting/executive/deck2/slides.ts`:

Before (line 19):
```ts
import { formatStageLabel, getStageKey } from "../../../population/stageHelpers";
```
After:
```ts
import {
  STAGE_KEY_ORDER,
  formatStageLabel,
  getStageKey,
  isCanonicalStageKey,
  stageBucketLabel,
  stageLabelForKey,
} from "../../../population/stageHelpers";
```

Before (inside `LEVEL_DRAW_WEIGHTS`'s IIFE):
```ts
  const order = ["first", "second", "third", "fourth"] as const;
```
After:
```ts
  const order = STAGE_KEY_ORDER;
```

Before:
```ts
const CANONICAL_STAGE_ORDER = ["first", "second", "third", "fourth"] as const;
```
After:
```ts
const CANONICAL_STAGE_ORDER = STAGE_KEY_ORDER;
```

Replace the doc comment and body of `levelIndexForStage` — Before:
```ts
/**
 * Resolve `stage` to its 0-based index into `RISK_LEVELS`/`LEVEL_DRAW_WEIGHTS`/
 * `STAGE_TONES` BY IDENTITY, never by the stage's position in the `stages`
 * array it came from (see `CANONICAL_STAGE_ORDER`'s doc comment above).
 *
 * Resolved from `stage.stageLabel` via the same alias-matching `getStageKey`
 * every other stage-classification path in the app uses — NOT from
 * `stage.stageKey` directly: that field is only a reliable canonical key
 * ("first"/"second"/…) on the production path (`buildStageProfiles`'s
 * `sample.stageAllocations` branch); on the no-sample fallback branch it is
 * stamped `String(index)` (a placeholder, never a real level key), which
 * would make identity resolution silently fail for the very fixtures/months
 * that most need it. `stageLabel`, by contrast, is real semantic data on
 * BOTH branches (either `STAGE_LABELS[stageKey]` or the row's own `stage`
 * text), so resolving through it — the same way `formatStageLabel` already
 * does — works uniformly everywhere.
 *
 * Returns -1 for a label `getStageKey` can't map to one of the four levels
 * (legacy/unrecognized wording, or the raw label was never one of the four
 * to begin with). Callers MUST treat -1 as "unknown level" — render "—" and
 * a neutral tone — never fall back to a loop index, which would silently
 * reintroduce the exact bug this helper exists to fix.
 */
function levelIndexForStage(stage: StageProfile): number {
  const key = getStageKey(stage.stageLabel);
  return CANONICAL_STAGE_ORDER.indexOf(key as (typeof CANONICAL_STAGE_ORDER)[number]);
}
```
After:
```ts
/**
 * Resolve `stage` to its 0-based index into `RISK_LEVELS`/`LEVEL_DRAW_WEIGHTS`/
 * `STAGE_TONES` BY IDENTITY, never by the stage's position in the `stages`
 * array it came from (see `CANONICAL_STAGE_ORDER`'s doc comment above).
 *
 * Since C1 (2026-09-28) `buildStageProfiles` stamps a canonical `stageKey`
 * ("first"…"fourth", or "unknown") on BOTH of its branches, so identity is
 * read straight from the key — no alias table is needed, which is what keeps
 * a workspace's custom stage aliases from falling through to "unknown" here.
 * A hand-built profile whose key is not canonical (test fixtures, the KPI
 * test model's "L1"…) still resolves through its label with the default
 * aliases, as before.
 *
 * Returns -1 for a stage that is not one of the four levels. Callers MUST
 * treat -1 as "unknown level" — render "—" and a neutral tone — never fall
 * back to a loop index, which would silently reintroduce the positional bug.
 */
function levelIndexForStage(stage: StageProfile): number {
  if (isCanonicalStageKey(stage.stageKey)) return CANONICAL_STAGE_ORDER.indexOf(stage.stageKey);
  const key = getStageKey(stage.stageLabel);
  return CANONICAL_STAGE_ORDER.indexOf(key as (typeof CANONICAL_STAGE_ORDER)[number]);
}
```

First replace the seven card lookups (all are `StageProfile` values named `stage` or `s`) — do this BEFORE adding `stagePortKey`, because the helper's own body legitimately calls `formatStageLabel(stage.stageLabel)`:
```bash
sed -i 's/formatStageLabel(stage\.stageLabel)/stagePortKey(stage)/g; s/formatStageLabel(s\.stageLabel)/stagePortKey(s)/g' src/data/reporting/executive/deck2/slides.ts
grep -c "stagePortKey(" src/data/reporting/executive/deck2/slides.ts
```
Expected: `7`.

Then, immediately above `export function collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]> {`, insert:
```ts
/**
 * The `collectStagePortStats` map key a stage card reads (C1). Canonical-keyed
 * profiles (every profile `buildStageProfiles` produces) resolve from the key,
 * so they always meet the collector's `stageBucketLabel` buckets; a hand-built
 * profile falls back to its label, as before.
 */
function stagePortKey(stage: StageProfile): string {
  if (isCanonicalStageKey(stage.stageKey) || stage.stageKey === "unknown") {
    return stageLabelForKey(stage.stageKey);
  }
  return formatStageLabel(stage.stageLabel);
}

```

Inside `collectStagePortStats` — Before:
```ts
    // Canonicalize: real rows carry the RAW Excel stage alias (e.g. "SECOND_STAG",
    // "2", "الثاني"), while StageProfile.stageLabel is the canonical Arabic label
    // frozen at sample-draw time. Raw-key grouping made every card lookup miss on
    // real data (empty port tables, zero سليمة/اشتباه sums) — the synthetic
    // preview fixture used canonical labels and masked it. formatStageLabel maps
    // known aliases to the canonical label and echoes unknown strings unchanged,
    // so the fallback branch (raw StageProfile labels) still matches too.
    const stageKey = r.stage ? formatStageLabel(r.stage) : "غير محدد";
```
After:
```ts
    // Canonicalize: real rows carry the RAW Excel stage alias (e.g. "SECOND_STAG",
    // "2", "الثاني"), while StageProfile.stageLabel is the canonical Arabic label.
    // Raw-key grouping made every card lookup miss on real data (empty port
    // tables, zero سليمة/اشتباه sums). C1: bucket with the SAME workspace alias
    // table the profiles were built with (`model.stageMappings`), and put every
    // unmapped value in the one «غير محدد» bucket the profiles also use.
    const stageKey = stageBucketLabel(r.stage, model.stageMappings);
```

Check: `grep -n "formatStageLabel" src/data/reporting/executive/deck2/slides.ts` shows exactly two lines — the import and the `return formatStageLabel(stage.stageLabel);` inside `stagePortKey`; `grep -c "stagePortKey(" …` now prints `8`.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/stageMappingsDeck.test.ts src/data/reporting/executive/deck2/fanoutB3StagePort.test.ts src/data/reporting/executive/deck2/deck2.test.ts`
Expected: PASS.

- [ ] **Step 5: Load the workspace alias table in the Reports tab**

In `src/components/Sidebar/Tabs/Reports/TabView.tsx`:

Before:
```ts
import { loadMonthPopulationFinal, loadMonthForEditing, loadMonthPopulationFinalRevision, loadMonthManifest, loadProcessingSummary } from "../../../../data/population/populationStorage";
```
After:
```ts
import { loadMonthPopulationFinal, loadMonthForEditing, loadMonthPopulationFinalRevision, loadMonthManifest, loadProcessingSummary } from "../../../../data/population/populationStorage";
import { loadPopulationConfig } from "../../../../data/population/populationConfig";
```

Before:
```ts
    const [populationFinal, sample, employeeFiles, templateSelection, popRev, sampleRev, distRev, processingSummary] = await Promise.all([
```
After:
```ts
    const [populationFinal, sample, employeeFiles, templateSelection, popRev, sampleRev, distRev, processingSummary, populationConfig] = await Promise.all([
```

Before:
```ts
      loadProcessingSummary(directoryHandle, selectedMonth),
    ]);
    if (!populationFinal) return null;
```
After:
```ts
      loadProcessingSummary(directoryHandle, selectedMonth),
      // C1: the workspace's own stage alias table, so every stage grouping in
      // the report classifies a custom alias the way processing did.
      loadPopulationConfig(directoryHandle),
    ]);
    if (!populationFinal) return null;
```

Before:
```ts
      sourceRevisions,
      processingSummary,
    };
  }, [directoryHandle, selectedMonth]);
```
After:
```ts
      sourceRevisions,
      processingSummary,
      stageMappings: populationConfig.stageMappings,
    };
  }, [directoryHandle, selectedMonth]);
```

- [ ] **Step 6: Review and update the raw-alias snapshot**

Run: `npx vitest run src/data/reporting/executive/stageCanonical.snapshot.test.ts`
Expected: FAIL only in the deck2 html snapshot (the «غير محدد» stage card now finds its port rows). Re-run with `-u`, inspect `git diff -- '*.snap'`; accept only stage-card port-table changes for the «غير محدد» stage. Anything else: `git checkout -- '*.snap'`, report BLOCKED.

- [ ] **Step 7: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`
Expected: all green.

- [ ] **Step 8: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (deck2): stage cards resolve level and ports with workspace stage mappings"`
- **Why:** deck2 re-bucketed rows with default aliases only and derived a card's level by re-parsing its label, so a workspace custom alias produced empty port tables and a neutral tone; the Reports tab never loaded the workspace alias table at all (spec C1).
- **What changed:** `levelIndexForStage` reads the canonical `stageKey`; `collectStagePortStats` buckets with `stageBucketLabel(row.stage, model.stageMappings)` and cards look up via `stagePortKey`; deck2 key arrays now import `STAGE_KEY_ORDER`; `TabView.loadExecInput` loads `config.json` and passes `stageMappings`.
- **Before/After:** the `levelIndexForStage` body from Step 3.

- [ ] **Step 9: Commit**

```bash
npm run generate:changelog
git add src/data/reporting src/components/Sidebar/Tabs/Reports/TabView.tsx src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (deck2): stage cards resolve level and ports with workspace stage mappings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 5: C1 — Manual-add stage allocation gets the Arabic label and canonical position

**Files:**
- Create: `src/data/sampling/appendSampleRow.stageLabel.test.ts`
- Modify: `src/data/sampling/sampleStorage.ts` (line 2 import; `adjustStageAllocations` 172-186)

**Interfaces:**
- Consumes (Task 1): `STAGE_LABELS_AR`, `compareStageKeys` from `stageHelpers.ts`.
- Produces: `appendSampleRow(...)` — unchanged signature; a NEW `StageAllocation` it creates now has `stageLabel = STAGE_LABELS_AR[stageKey]` and the allocation list is kept in canonical order.

- [ ] **Step 1: Write the failing test**

Create `src/data/sampling/appendSampleRow.stageLabel.test.ts`:

```ts
// C1 (sampleStorage.ts:179): a manual add / replacement into a stage the draw
// never allocated used to create the bucket with the RAW row text as its label
// ("THIRD_STAGE"), appended at the end. It must carry the Arabic label and sit
// in canonical first→fourth position like every draw-time allocation.
import { describe, expect, test } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { makeRow } from "../reporting/reportTestFixtures";
import type { SampleMasterData } from "./sampleTypes";
import { appendSampleRow, loadSampleMaster, saveSampleMaster } from "./sampleStorage";

const MONTH = "5-may-2026";

function sampleWithSecondOnly(): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [
      {
        stageKey: "second",
        stageLabel: "المستوى الثاني",
        populationSize: 1,
        targetQuota: 1,
        actualDrawn: 1,
        certScanDrawn: 0,
        nonCertScanDrawn: 1,
      },
    ],
    drawnAt: "2026-05-02T00:00:00.000Z",
    drawnBy: "admin",
    rows: [makeRow("S-1", "بري", { stage: "SECOND_STAG" })],
  };
}

describe("appendSampleRow — new stage allocation label and order (C1)", () => {
  test("labels a new stage bucket in Arabic from its key, never with the raw row text", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, sampleWithSecondOnly());

    const result = await appendSampleRow(dir, MONTH, makeRow("S-2", "بري", { stage: "THIRD_STAGE" }));
    expect(result.ok).toBe(true);

    const saved = await loadSampleMaster(dir, MONTH);
    const third = saved?.stageAllocations.find((a) => a.stageKey === "third");
    expect(third?.stageLabel).toBe("المستوى الثالث");
    expect(third?.actualDrawn).toBe(1);
  });

  test("inserts a new bucket in canonical order", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, sampleWithSecondOnly());

    await appendSampleRow(dir, MONTH, makeRow("S-3", "بري", { stage: "FIRST_STAGE" }));

    const saved = await loadSampleMaster(dir, MONTH);
    expect(saved?.stageAllocations.map((a) => a.stageKey)).toEqual(["first", "second"]);
    expect(saved?.stageAllocations.map((a) => a.stageLabel)).toEqual(["المستوى الأول", "المستوى الثاني"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/sampling/appendSampleRow.stageLabel.test.ts`
Expected: FAIL — label `"THIRD_STAGE"` instead of `"المستوى الثالث"`; order `["second","first"]`.

- [ ] **Step 3: Implement**

In `src/data/sampling/sampleStorage.ts`:

Before (line 2):
```ts
import { getStageKey } from "../population/stageHelpers";
```
After:
```ts
import { compareStageKeys, getStageKey, STAGE_LABELS_AR } from "../population/stageHelpers";
```

Before (inside `adjustStageAllocations`):
```ts
  if (!existing) {
    if (delta < 0) return allocations;
    return [
      ...allocations,
      {
        stageKey,
        stageLabel: row.stage ?? "غير محدد",
        populationSize: 0,
        targetQuota: 0,
        actualDrawn: 1,
        certScanDrawn: isCertScan ? 1 : 0,
        nonCertScanDrawn: isCertScan ? 0 : 1,
      },
    ];
  }
```
After:
```ts
  if (!existing) {
    if (delta < 0) return allocations;
    // C1: the label comes from the key (never the raw row text) and the new
    // bucket takes its canonical first→fourth position, exactly like the
    // allocations the draw itself writes.
    return [
      ...allocations,
      {
        stageKey,
        stageLabel: STAGE_LABELS_AR[stageKey],
        populationSize: 0,
        targetQuota: 0,
        actualDrawn: 1,
        certScanDrawn: isCertScan ? 1 : 0,
        nonCertScanDrawn: isCertScan ? 0 : 1,
      },
    ].sort((left, right) => compareStageKeys(left.stageKey, right.stageKey));
  }
```
(`stageKey` is already narrowed to the four level keys by the `if (stageKey === "unknown") return allocations;` guard above.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/sampling/appendSampleRow.stageLabel.test.ts src/data/sampling/appendSampleRow.stageMappings.test.ts src/data/sampling/replacementSampleTotals.test.ts src/data/sampling/sampleAlgorithm.golden.test.ts`
Expected: PASS (the golden draw is untouched).

- [ ] **Step 5: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`

- [ ] **Step 6: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (sampling): manual-add stage allocation uses the Arabic label in canonical order"`
- **Why:** `adjustStageAllocations` created a new stage bucket labelled with the raw row text (`sampleStorage.ts:179`) and appended it last, so reports showed e.g. `THIRD_STAGE` after `المستوى الرابع` (spec C1).
- **What changed:** new buckets take `STAGE_LABELS_AR[stageKey]` and the list is re-sorted with `compareStageKeys`. `drawSample` untouched; existing files are relabelled at report time by Task 3.
- **Before/After:** the Step 3 snippet.

- [ ] **Step 7: Commit**

```bash
npm run generate:changelog
git add src/data/sampling/sampleStorage.ts src/data/sampling/appendSampleRow.stageLabel.test.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (sampling): manual-add stage allocation uses the Arabic label in canonical order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 6: C1 — Replace the re-typed stage label / order copies with imports

**Files:**
- Create: `src/data/population/stageLabels.duplicates.test.ts`
- Modify: `src/data/sampling/sampleAlgorithmInternals.ts` (line 3; lines 55-62)
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx` (imports ~5; lines 64-69)
- Modify: `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx` (imports ~9; lines 45-53)
- Modify: `src/components/Sidebar/Tabs/Population/components/mappingSettingsConfig.ts` (imports 1-5; lines 14-21)
- Modify: `src/data/reporting/populationReport/fold.ts` (line 7; lines 20-33)
- Modify: `src/workers/populationQueryWorker.ts` (imports 1-7; lines 43-59)
- Modify: `src/components/DataTable/index.tsx` (imports; lines 253-262)
- Modify: `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (imports; lines 358-369)
- Modify: `src/data/population/replacementIndexStorage.ts` (line 20; line 33)
- Modify: `src/data/distribution/replacementCandidateLookup.ts` (line 16; line 38)
- Modify: `src/dev/deckPreviewFixture.ts` (imports; lines 50 and 62-69)

**Interfaces:**
- Consumes (Task 1): `STAGE_KEY_ORDER`, `STAGE_COUNT_KEY_ORDER`, `STAGE_LABELS_AR`, `STAGE_UNKNOWN_LABEL`, `stageLabelRank` from `src/data/population/stageLabels.ts` (components/worker/dev import this module directly; `src/data` modules may import via `stageHelpers.ts`).
- Produces: no new API. Every value is identical to the copy it replaces, so rendered output, the sampling draw and the population-report output are unchanged. `src/data/distribution/bulkAssignment.ts` is intentionally NOT touched (Workstream A owns it).

- [ ] **Step 1: Write the failing guard test**

Create `src/data/population/stageLabels.duplicates.test.ts`:

```ts
// C1 guard: the canonical stage labels and key order live ONLY in
// src/data/population/stageLabels.ts. Each file below used to re-type its own
// copy (the drift CLAUDE.md's "no duplicate state" rule forbids); a copy that
// creeps back fails here. bulkAssignment.ts is deliberately not listed — its
// stage list is owned by Workstream A.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../..");

const FORMER_COPIES = [
  "data/population/stageHelpers.ts",
  "data/sampling/sampleAlgorithmInternals.ts",
  "components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx",
  "components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx",
  "components/Sidebar/Tabs/Population/components/mappingSettingsConfig.ts",
  "data/reporting/populationReport/fold.ts",
  "workers/populationQueryWorker.ts",
  "components/DataTable/index.tsx",
  "components/Sidebar/Tabs/Population/BrowseDataView.tsx",
  "data/population/replacementIndexStorage.ts",
  "data/distribution/replacementCandidateLookup.ts",
  "data/reporting/executive/deck2/slides.ts",
  "dev/deckPreviewFixture.ts",
];

const LABEL_MAP_ENTRY = /\bfourth\s*:\s*"المستوى الرابع"/;
const RANK_MAP_ENTRY = /"المستوى الرابع"\s*:\s*4/;
const KEY_ARRAY_LITERAL = /\[\s*"first"\s*,\s*"second"\s*,\s*"third"\s*,\s*"fourth"/;

describe("no re-typed stage label / order copies (C1)", () => {
  for (const relative of FORMER_COPIES) {
    it(`${relative} imports the canonical stage definitions instead of copying them`, () => {
      const source = readFileSync(path.join(srcRoot, relative), "utf8");
      expect(source).not.toMatch(LABEL_MAP_ENTRY);
      expect(source).not.toMatch(RANK_MAP_ENTRY);
      expect(source).not.toMatch(KEY_ARRAY_LITERAL);
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/population/stageLabels.duplicates.test.ts`
Expected: FAIL for the 11 files still holding a copy (`stageHelpers.ts` and `slides.ts` already pass after Tasks 1 and 4).

- [ ] **Step 3: Capture the outputs that must not change**

Run: `npx vitest run src/data/sampling src/data/reporting/populationReport src/workers/populationQueryWorker.test.ts src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.test.tsx`
Expected: PASS. These suites (including `sampleAlgorithm.golden.test.ts` and the population-report snapshots) are the before/after oracle; do not update any of their snapshots in this task.

- [ ] **Step 4: Replace each copy**

(a) `src/data/sampling/sampleAlgorithmInternals.ts` — Before:
```ts
import { getStageKey, resolveStageMappings } from "../population/stageHelpers";
```
After:
```ts
import { getStageKey, resolveStageMappings, STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../population/stageHelpers";
```
Before:
```ts
const STAGE_KEYS: StageKey[] = ["first", "second", "third", "fourth"];
const REDISTRIBUTABLE_STAGES: StageKey[] = ["second", "third", "fourth"];
const STAGE_LABELS: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع"
};
```
After:
```ts
const STAGE_KEYS: readonly StageKey[] = STAGE_KEY_ORDER;
const REDISTRIBUTABLE_STAGES: StageKey[] = ["second", "third", "fourth"];
const STAGE_LABELS = STAGE_LABELS_AR;
```

(b) `src/components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx` — Before:
```ts
import { formatNumber, getStageKey } from "./helpers";
```
After:
```ts
import { formatNumber, getStageKey } from "./helpers";
import { STAGE_LABELS_AR } from "../../../../../data/population/stageLabels";
```
Before:
```ts
const STAGE_LABELS: Record<string, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع"
};
```
After:
```ts
const STAGE_LABELS: Readonly<Record<string, string>> = STAGE_LABELS_AR;
```

(c) `src/components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx` — Before:
```ts
import { getStageKey, formatNumber } from "./helpers";
```
After:
```ts
import { getStageKey, formatNumber } from "./helpers";
import { STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../../../../../data/population/stageLabels";
```
Before:
```ts
const STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
type StageKey = (typeof STAGE_KEYS)[number];

const STAGE_LABELS: Record<StageKey, string> = {
  first:  "المستوى الأول",
  second: "المستوى الثاني",
  third:  "المستوى الثالث",
  fourth: "المستوى الرابع"
};
```
After:
```ts
const STAGE_KEYS = STAGE_KEY_ORDER;
type StageKey = (typeof STAGE_KEYS)[number];

const STAGE_LABELS = STAGE_LABELS_AR;
```

(d) `src/components/Sidebar/Tabs/Population/components/mappingSettingsConfig.ts` — Before:
```ts
import type {
  PopulationConfig,
  ProcessingWorkflowStep,
  StageKey,
} from "../../../../../data/population/populationConfig";
```
After:
```ts
import type {
  PopulationConfig,
  ProcessingWorkflowStep,
  StageKey,
} from "../../../../../data/population/populationConfig";
import { STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../../../../../data/population/stageLabels";
```
Before:
```ts
export const STAGE_KEY_LABELS: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

const STAGE_KEYS: StageKey[] = ["first", "second", "third", "fourth"];
```
After:
```ts
export const STAGE_KEY_LABELS: Readonly<Record<StageKey, string>> = STAGE_LABELS_AR;

const STAGE_KEYS: readonly StageKey[] = STAGE_KEY_ORDER;
```

(e) `src/data/reporting/populationReport/fold.ts` — Before:
```ts
import { getStageKey } from "../../population/stageHelpers";
```
After:
```ts
import {
  getStageKey,
  STAGE_COUNT_KEY_ORDER,
  STAGE_LABELS_AR,
  STAGE_UNKNOWN_LABEL,
} from "../../population/stageHelpers";
```
Before:
```ts
// Local label map, not imported from stageHelpers.ts (STAGE_LABELS_AR there is
// module-private, and formatStageLabel() expects a RAW stage value to
// re-derive the key from — passing an already-canonical key like "first"
// back through it would misclassify to "unknown"). Same pattern
// sampleReport.ts/distributionReport.ts already use for their own label maps.
export const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

const STAGE_ORDER = ["first", "second", "third", "fourth", "unknown"];
```
After:
```ts
// Keyed by canonical stage key (formatStageLabel expects a RAW stage value, so
// it cannot relabel an already-canonical key). Derived from the one canonical
// definition in stageLabels.ts plus the "unknown" bucket label (C1) — never
// re-typed.
export const STAGE_LABELS: Readonly<Record<string, string>> = {
  ...STAGE_LABELS_AR,
  unknown: STAGE_UNKNOWN_LABEL,
};

const STAGE_ORDER: readonly string[] = STAGE_COUNT_KEY_ORDER;
```

(f) `src/workers/populationQueryWorker.ts` — Before:
```ts
import type { StageAliasMappings } from "../data/population/populationConfig";
```
After:
```ts
import type { StageAliasMappings } from "../data/population/populationConfig";
import { STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../data/population/stageLabels";
```
Before:
```ts
// ── Stage-alias display parity (Task 4) ─────────────────────────────────────────
// Worker-local copy of src/data/population/stageHelpers.ts's normalizeStageToken /
// getStageKey / STAGE_LABELS_AR logic. NOT imported directly: stageHelpers.ts pulls
// its DEFAULT_STAGE_MAPPINGS constant from populationConfig.ts, a file whose other
// exports (safeReadJson, casLoop, withResourceLock, getPopulationRoot) assume a
// main-thread Window/File-System-Access-API context this DedicatedWorker doesn't
// have. Duplicating this small, pure slice avoids dragging that dependency graph
// into the worker bundle -- the same "defined locally per-file rather than shared
// across tab boundaries" idiom BrowseDataView.tsx already uses for its yieldToMain.
// Keep in sync with stageHelpers.ts by hand; both are covered by their own tests.
const WORKER_STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
const WORKER_STAGE_LABELS_AR: Record<(typeof WORKER_STAGE_KEYS)[number], string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};
```
After:
```ts
// ── Stage-alias display parity (Task 4) ─────────────────────────────────────────
// Worker-local copy of src/data/population/stageHelpers.ts's normalizeStageToken /
// getStageKey alias-index logic. NOT imported directly: stageHelpers.ts pulls its
// DEFAULT_STAGE_MAPPINGS constant from populationConfig.ts, a file whose other
// exports (safeReadJson, casLoop, withResourceLock, getPopulationRoot) assume a
// main-thread Window/File-System-Access-API context this DedicatedWorker doesn't
// have. Keep that logic in sync with stageHelpers.ts by hand; both are covered by
// their own tests. The stage KEYS and Arabic LABELS, however, come from the
// dependency-free stageLabels.ts (C1) — the one definition, no copy.
const WORKER_STAGE_KEYS = STAGE_KEY_ORDER;
const WORKER_STAGE_LABELS_AR = STAGE_LABELS_AR;
```

(g) `src/components/DataTable/index.tsx` — Before:
```ts
import { cycleTableSort, sortRowsBy, type TableSort } from "../../utils/tableSort";
```
After:
```ts
import { cycleTableSort, sortRowsBy, type TableSort } from "../../utils/tableSort";
import { stageLabelRank } from "../../data/population/stageLabels";
```
Before:
```ts
const STAGE_OPTION_ORDER: Record<string, number> = {
  "المستوى الأول": 1,
  "المستوى الثاني": 2,
  "المستوى الثالث": 3,
  "المستوى الرابع": 4,
};

function compareFilterOptions(first: string, second: string): number {
  const firstStageOrder = STAGE_OPTION_ORDER[first];
  const secondStageOrder = STAGE_OPTION_ORDER[second];
```
After:
```ts
function compareFilterOptions(first: string, second: string): number {
  const firstStageOrder = stageLabelRank(first);
  const secondStageOrder = stageLabelRank(second);
```

(h) `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` — Before:
```ts
import { cycleTableSort } from "../../../../utils/tableSort";
```
After:
```ts
import { cycleTableSort } from "../../../../utils/tableSort";
import { stageLabelRank } from "../../../../data/population/stageLabels";
```
Before:
```ts
const STAGE_FILTER_ORDER: Record<string, number> = {
  "المستوى الأول": 1,
  "المستوى الثاني": 2,
  "المستوى الثالث": 3,
  "المستوى الرابع": 4
};

function compareBrowseFilterOptions(first: string, second: string): number {
  const firstStageOrder = STAGE_FILTER_ORDER[first];
  const secondStageOrder = STAGE_FILTER_ORDER[second];
```
After:
```ts
function compareBrowseFilterOptions(first: string, second: string): number {
  const firstStageOrder = stageLabelRank(first);
  const secondStageOrder = stageLabelRank(second);
```

(i) `src/data/population/replacementIndexStorage.ts` — Before:
```ts
import { getStageKey, resolveStageMappings, type StageCountKey } from "./stageHelpers";
```
After:
```ts
import { getStageKey, resolveStageMappings, STAGE_COUNT_KEY_ORDER, type StageCountKey } from "./stageHelpers";
```
Before:
```ts
const ALL_STAGE_KEYS: readonly StageCountKey[] = ["first", "second", "third", "fourth", "unknown"];
```
After:
```ts
const ALL_STAGE_KEYS: readonly StageCountKey[] = STAGE_COUNT_KEY_ORDER;
```

(j) `src/data/distribution/replacementCandidateLookup.ts` — Before:
```ts
import { getStageKey, type StageCountKey } from "../population/stageHelpers";
```
After:
```ts
import { getStageKey, STAGE_COUNT_KEY_ORDER, type StageCountKey } from "../population/stageHelpers";
```
Before:
```ts
const ALL_STAGE_KEYS: readonly StageCountKey[] = ["first", "second", "third", "fourth", "unknown"];
```
After:
```ts
const ALL_STAGE_KEYS: readonly StageCountKey[] = STAGE_COUNT_KEY_ORDER;
```

(k) `src/dev/deckPreviewFixture.ts` — Before:
```ts
import { toEmployeeMirrorRowStub } from "../data/population/populationTypes";
```
After:
```ts
import { toEmployeeMirrorRowStub } from "../data/population/populationTypes";
import { STAGE_KEY_ORDER, STAGE_LABELS_AR } from "../data/population/stageLabels";
```
Before:
```ts
const STAGE_KEYS = ["first", "second", "third", "fourth"] as const;
```
After:
```ts
const STAGE_KEYS = STAGE_KEY_ORDER;
```
Before:
```ts
const STAGE_LABELS: Record<(typeof STAGE_KEYS)[number], string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};
```
After:
```ts
const STAGE_LABELS = STAGE_LABELS_AR;
```

- [ ] **Step 5: Run the guard and the oracle suites**

Run: `npx vitest run src/data/population/stageLabels.duplicates.test.ts src/data/sampling src/data/reporting/populationReport src/workers/populationQueryWorker.test.ts src/components/Sidebar/Tabs/Population src/components/DataTable`
Expected: PASS, with NO snapshot written or updated (the output line must not say "updated" or "written").

- [ ] **Step 6: Tier 2 gates plus build (the worker is bundled `?worker&inline`)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run build`
Expected: all green; `dist/index.html` produced.

- [ ] **Step 7: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Refactor (stages): import the canonical stage labels instead of eleven local copies"`
- **Why:** Eleven modules re-typed the stage label map / key order / label rank (spec C1 "~8 modules copy them"; four more found during verification), which is how labels drift.
- **What changed:** each copy now aliases `STAGE_LABELS_AR` / `STAGE_KEY_ORDER` / `STAGE_COUNT_KEY_ORDER` / `stageLabelRank` from `stageLabels.ts`; the worker imports the dependency-free module directly. Values identical — sampling golden and population-report snapshots unchanged. New guard test fails if a copy returns.
- **Before/After:** snippet (f), the worker block.

- [ ] **Step 8: Commit**

```bash
npm run generate:changelog
git add src/data src/components src/workers src/dev "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Refactor (stages): import the canonical stage labels instead of eleven local copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```
(Before committing, run `git status` and confirm only the 12 files above, the new test, the edit log, `package.json` and the regenerated changelog are staged.)

---

## Task 7: C1 — Employee table stage cells always Arabic, with workspace mappings in «نتائج فحص الأشعة»

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/buildXrayColumns.stage.test.ts`
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.stageLabels.test.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` (line 47)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (imports ~67; line 91; state ~225; effect after the browse-preset effect ~253; columns memo ~477 and its deps ~500; `getSampleColumnValue` 1154-1161)

**Interfaces:**
- Consumes: `formatStageLabel(stage: unknown, stageMappings?: Partial<StageAliasMappings>): string` (`stageHelpers.ts`), `loadPopulationConfig` (`populationConfig.ts`).
- Produces: `buildXrayColumns(L)` stage accessor returns the Arabic label (default aliases); `XrayInspectionResults` stage cells use the workspace `config.stageMappings`. `XrayReferrals.tsx` is NOT modified (it already renders with workspace mappings).

- [ ] **Step 1: Write the failing tests**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/buildXrayColumns.stage.test.ts`:

```ts
// C1: the base "stage" column of the employee queue is also what the referral
// preview, exports and filter options read — it must never surface the raw
// file alias (SECOND_STAG / FORTH_STAGE).
import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { makeRow } from "../../../../../../data/reporting/reportTestFixtures";
import { buildXrayColumns } from "./subComponents";

function entry(stage: string | null): DistributionEntry {
  return {
    xrayImageId: "IMG-1",
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-04T09:00:00.000Z",
    row: makeRow("IMG-1", "منفذ أ", { stage }),
  };
}

describe("buildXrayColumns — stage cell (C1)", () => {
  it("renders the Arabic level label, not the raw file alias", () => {
    const stageColumn = buildXrayColumns(DEFAULT_LABELS).find((column) => column.id === "stage")!;
    expect(stageColumn.accessor(entry("SECOND_STAG"))).toBe("المستوى الثاني");
    expect(stageColumn.accessor(entry("FORTH_STAGE"))).toBe("المستوى الرابع");
  });
});
```

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.stageLabels.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// C1: «نتائج فحص الأشعة» must label a stage with the WORKSPACE alias table
// (config.json → stageMappings), not only the built-in defaults — a custom
// alias rendered as its raw text here while the referral queue already showed
// the Arabic level label.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import {
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_STAGE_MAPPINGS,
  savePopulationConfig,
} from "../../../../../data/population/populationConfig";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import { makeRow } from "../../../../../data/reporting/reportTestFixtures";
import XrayInspectionResults from "./XrayInspectionResults";

const MONTH = "5-may-2026";

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-02T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

describe("XrayInspectionResults — stage labels use the workspace alias table (C1)", () => {
  it("renders a custom-alias stage as its Arabic level label", async () => {
    writeSession({ role: "supervisor", username: "sup-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const root = createMemoryDirectory("root");
    const savedConfig = await savePopulationConfig(root, {
      ...DEFAULT_POPULATION_CONFIG,
      stageMappings: {
        ...DEFAULT_STAGE_MAPPINGS,
        second: [...DEFAULT_STAGE_MAPPINGS.second, "X2-CUSTOM"],
      },
    });
    if (!savedConfig.ok) throw new Error(`seed config failed: ${savedConfig.error}`);
    await saveSampleMaster(root, MONTH, makeSample([makeRow("IMG-S2", "بري", { stage: "X2-CUSTOM" })]));
    const assigned = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "IMG-S2", assignedTo: "emp-1", eventBy: "admin" }),
    ]);
    if (!assigned.ok) throw new Error(`seed assign failed: ${assigned.error}`);

    render(<XrayInspectionResults directoryHandle={root} />);

    await waitFor(() => expect(screen.getAllByText("IMG-S2").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryAllByText("X2-CUSTOM")).toHaveLength(0));
    expect(screen.getAllByText("المستوى الثاني").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/buildXrayColumns.stage.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.stageLabels.test.tsx`
Expected: FAIL — the accessor returns `"SECOND_STAG"`; the results table keeps showing `"X2-CUSTOM"` (waitFor times out).

- [ ] **Step 3: Arabic base accessor in the queue columns**

In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` (`formatStageLabel` is already imported) — Before:
```ts
  { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => e.row.stage },
```
After:
```ts
  { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => formatStageLabel(e.row.stage) },
```

- [ ] **Step 4: Workspace mappings in `XrayInspectionResults.tsx`**

Before:
```ts
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
```
After:
```ts
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
import { loadPopulationConfig } from "../../../../../data/population/populationConfig";
import type { StageAliasMappings } from "../../../../../data/population/populationConfig";
```

Before (in `buildSampleColumns`):
```ts
    { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => e.row.stage },
```
After:
```ts
    { id: "stage",                  label: L.col_stage,                     widthFr: 8,  accessor: (e) => formatStageLabel(e.row.stage) },
```

Before:
```ts
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
```
After:
```ts
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  // C1: the workspace stage alias table, so a custom alias renders as its
  // Arabic level label here exactly as it does in the referral queue.
  const [stageMappings, setStageMappings] = useState<StageAliasMappings | undefined>(undefined);
```

Before:
```ts
      .catch(logRejection("xrayInspectionResults:loadBrowsePresets"));
  }, [directoryHandle, sampleColumns, username]);
```
After:
```ts
      .catch(logRejection("xrayInspectionResults:loadBrowsePresets"));
  }, [directoryHandle, sampleColumns, username]);

  useEffect(() => {
    void loadPopulationConfig(directoryHandle)
      .then((config) => setStageMappings(config.stageMappings))
      .catch(logRejection("xrayInspectionResults:loadPopulationConfig"));
  }, [directoryHandle]);
```

Before:
```ts
        accessor: (row) => getSampleColumnValue(row, column, templatesById, template, L),
```
After:
```ts
        accessor: (row) => getSampleColumnValue(row, column, templatesById, template, L, stageMappings),
```

Before:
```ts
  }, [L, answerFields, referralColConfig, sampleColumns, template, templatesById]);
```
After:
```ts
  }, [L, answerFields, referralColConfig, sampleColumns, stageMappings, template, templatesById]);
```

Before:
```ts
function getSampleColumnValue(
  row: ResultRow,
  column: DataTableCol<DistributionEntry>,
  templatesById: ReadonlyMap<string, TemplateSchema>,
  fallbackTemplate: TemplateSchema | null,
  labels: Labels
): string | null {
  if (column.id === "stage") return formatStageLabel(row.entry.row.stage);
```
After:
```ts
function getSampleColumnValue(
  row: ResultRow,
  column: DataTableCol<DistributionEntry>,
  templatesById: ReadonlyMap<string, TemplateSchema>,
  fallbackTemplate: TemplateSchema | null,
  labels: Labels,
  stageMappings?: StageAliasMappings
): string | null {
  if (column.id === "stage") return formatStageLabel(row.entry.row.stage, stageMappings);
```
Confirm there is no other caller: `grep -n "getSampleColumnValue(" src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` → exactly the definition and the one call above.

- [ ] **Step 5: Run to verify they pass, plus the neighbouring suites**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/buildXrayColumns.stage.test.ts src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.stageLabels.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.test.ts`
Expected: PASS.
If `XrayInspectionResults.test.tsx`'s "does not re-read the workspace folder when switching…" test now fails because its spies catch the new mount-time `loadPopulationConfig` read, insert this flush in that test directly before `const getDirectoryHandleSpy = vi.spyOn(root, "getDirectoryHandle");`:
```ts
    // Let the mount-time population-config read (C1) settle before counting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
```
(`act` is already imported there.) Re-run; expected PASS.

- [ ] **Step 6: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`

- [ ] **Step 7: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (employee-workspace): stage cells always Arabic, workspace aliases in inspection results"`
- **Why:** The base stage accessors (`subComponents.tsx:47`, `XrayInspectionResults.tsx:91`) returned the raw file alias to every path that reads the base column (referral preview, exports, filter options), and «نتائج فحص الأشعة» labelled stages with default aliases only (spec C1).
- **What changed:** both base accessors call `formatStageLabel`; `XrayInspectionResults` loads `config.stageMappings` once per workspace and passes it to its stage cell.
- **Before/After:** the `getSampleColumnValue` head from Step 4.

- [ ] **Step 8: Commit**

```bash
npm run generate:changelog
git add src/components/Sidebar/Tabs/EmployeeWorkspace src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (employee-workspace): stage cells always Arabic, workspace aliases in inspection results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 8: C2 — `certScanPorts` config field (additive, optional, default `[]`)

**Files:**
- Create: `src/data/population/populationConfig.certScanPorts.test.ts`
- Modify: `src/data/population/populationConfig.ts` (imports 1-7; `PopulationConfig` type 121-131; `DEFAULT_POPULATION_CONFIG` 384-400; new `normalizeCertScanPorts` before `loadPopulationConfig`; merge 416-429)

**Interfaces:**
- Consumes: `normalizePortName(portName: string | null): string` from `src/data/distribution/portEligibility.ts`.
- Produces:
  - `PopulationConfig.certScanPorts?: string[]`
  - `DEFAULT_POPULATION_CONFIG.certScanPorts` = `[]`
  - `normalizeCertScanPorts(value: unknown): string[]`
  - `loadPopulationConfig(...)` always returns `certScanPorts` as a normalized array (legacy file → `[]`).

- [ ] **Step 1: Write the failing test**

Create `src/data/population/populationConfig.certScanPorts.test.ts`:

```ts
// C2: whole-port CertScan flags live in population config.json next to
// employeePortRestrictions. The field is additive and optional — every
// config.json written before it existed must load as [] (no migration).
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  DEFAULT_POPULATION_CONFIG,
  loadPopulationConfig,
  normalizeCertScanPorts,
  savePopulationConfig,
} from "./populationConfig";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

describe("PopulationConfig.certScanPorts (C2)", () => {
  it("defaults to [] on the built-in config", () => {
    expect(DEFAULT_POPULATION_CONFIG.certScanPorts).toEqual([]);
  });

  it("loads a legacy config.json that predates the field as [] without disturbing other fields", async () => {
    const root = makeRoot();
    const legacy = { ...DEFAULT_POPULATION_CONFIG } as Record<string, unknown>;
    delete legacy.certScanPorts;
    await savePopulationConfig(root, legacy as unknown as typeof DEFAULT_POPULATION_CONFIG);

    const loaded = await loadPopulationConfig(root);
    expect(loaded.certScanPorts).toEqual([]);
    expect(loaded.employeePortRestrictions).toEqual([]);
    expect(loaded.samplingRules).toEqual(DEFAULT_POPULATION_CONFIG.samplingRules);
  });

  it("round-trips a saved list", async () => {
    const root = makeRoot();
    await savePopulationConfig(root, {
      ...DEFAULT_POPULATION_CONFIG,
      certScanPorts: ["ميناء جدة الإسلامي", "منفذ البطحاء"],
    });
    expect((await loadPopulationConfig(root)).certScanPorts).toEqual(["ميناء جدة الإسلامي", "منفذ البطحاء"]);
  });

  it("normalizes a stored value: strings only, no blanks, de-duplicated in first-seen order", () => {
    expect(normalizeCertScanPorts(["منفذ أ", "", "منفذ ب", "منفذ أ", 7, null])).toEqual(["منفذ أ", "منفذ ب"]);
    expect(normalizeCertScanPorts(undefined)).toEqual([]);
    expect(normalizeCertScanPorts("منفذ أ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/population/populationConfig.certScanPorts.test.ts`
Expected: FAIL — `certScanPorts` is `undefined`; `normalizeCertScanPorts is not a function`.

- [ ] **Step 3: Implement**

In `src/data/population/populationConfig.ts`:

Before:
```ts
import { logError } from "../storage/errorLogger";
```
After:
```ts
import { logError } from "../storage/errorLogger";
import { normalizePortName } from "../distribution/portEligibility";
```
(`portEligibility.ts` imports only types from this module, so there is no runtime cycle.)

Before:
```ts
  employeeAllocations: EmployeeStageAllocation[];
  employeePortRestrictions: EmployeePortRestriction[];
};

export const MONTHLY_SAMPLE_TARGET = 6500;
```
After:
```ts
  employeeAllocations: EmployeeStageAllocation[];
  employeePortRestrictions: EmployeePortRestriction[];
  /**
   * Ports whose EVERY row is processed as CertScan (C2), in addition to rows
   * matched by the pasted CertScan device list (a union). Port names exactly
   * as they appear in the population (`normalizePortName`). Applies from the
   * next processing run only — an already-drawn sample is never re-flagged.
   *
   * Additive and optional: a config.json written before this field existed
   * loads as `[]` (see `loadPopulationConfig`), so no migration is needed.
   */
  certScanPorts?: string[];
};

export const MONTHLY_SAMPLE_TARGET = 6500;
```

Before:
```ts
  employeeAllocations: [],
  employeePortRestrictions: []
};
```
After:
```ts
  employeeAllocations: [],
  employeePortRestrictions: [],
  certScanPorts: []
};
```

Before:
```ts
export async function loadPopulationConfig(
```
After:
```ts
/**
 * Normalizes a stored `certScanPorts` value (C2): keeps non-empty strings,
 * normalized through `normalizePortName` and de-duplicated in first-seen
 * order. Anything that is not an array (a legacy config without the field,
 * or a hand-edited file) yields `[]`.
 */
export function normalizeCertScanPorts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ports = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") continue;
    ports.add(normalizePortName(item));
  }
  return [...ports];
}

export async function loadPopulationConfig(
```

Before:
```ts
        employeeAllocations: loaded.employeeAllocations || [],
        employeePortRestrictions: loaded.employeePortRestrictions || []
      };
```
After:
```ts
        employeeAllocations: loaded.employeeAllocations || [],
        employeePortRestrictions: loaded.employeePortRestrictions || [],
        certScanPorts: normalizeCertScanPorts(loaded.certScanPorts)
      };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/population/populationConfig.certScanPorts.test.ts src/data/population/populationConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Tier 3 gates (workspace data format — additive field)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run check:hex-literals && npm run check:release && npm run check:vendor && npm run build && npm run check:bundle-size`
(`check:release` passes only after Step 6's `--sync-package`; run it again after Step 6.)

- [ ] **Step 6: Edit log (tier 3)**

Run: `npm run editlog -- --tier=3 --append --sync-package "Add (population): certScanPorts config field for whole-port CertScan flags"`
- **Why:** The owner wants to flag whole ports as CertScan (spec C2); today CertScan status comes only from the pasted device list. Rejected: a new file under `5-system/` — the flag is population processing configuration and belongs next to `employeePortRestrictions` in `config.json`.
- **What changed:** `PopulationConfig.certScanPorts?: string[]`, default `[]`, loaded through `normalizeCertScanPorts` (strings only, de-duplicated) with the same load-default/merge pattern as `employeePortRestrictions`.
- **Migration/rollback:** None needed — additive optional field; a legacy `config.json` loads as `[]`; an older build ignores the key. Rollback = revert.
- **Before/After:** the `loadPopulationConfig` merge lines.

- [ ] **Step 7: Commit**

```bash
npm run generate:changelog
git add src/data/population/populationConfig.ts src/data/population/populationConfig.certScanPorts.test.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): certScanPorts config field for whole-port CertScan flags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 9: C2 — Processing applies the union rule (flagged port OR pasted-list match)

**Files:**
- Create: `src/components/Sidebar/Tabs/Population/processing/populationProcessor.certScanPorts.test.ts`
- Modify: `src/components/Sidebar/Tabs/Population/processing/populationProcessingTypes.ts` (`PopulationProcessingInput` 17-21)
- Modify: `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts` (imports 1-20; `matchCertScan` 714-739; `processPopulation` 760; call 911-915; summary 1034)
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (`processPopulation` call ~900-904; `processingContext.certScanProvided` ~1563)

**Interfaces:**
- Consumes (Task 8): `PopulationConfig.certScanPorts`; `normalizePortName` from `src/data/distribution/portEligibility.ts`.
- Produces: `PopulationProcessingInput.certScanPorts?: readonly string[]`; `processPopulation` sets `certScanStatus = "Certscan"` for every row whose port is flagged (snippet fields `null` unless the list also matched); `summary.certScanProvided` is true when either a usable paste or at least one flagged port exists. `drawSample` is untouched — it already splits on `row.certScanStatus` alone, so NO `SAMPLING_ALGORITHM_VERSION` bump.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/Population/processing/populationProcessor.certScanPorts.test.ts`:

```ts
// C2: a row is CertScan when its port is flagged as a whole
// (PopulationConfig.certScanPorts) OR its id matches the pasted CertScan
// device list — a union. Unflagged ports keep today's list-only behaviour.
import { describe, expect, it } from "vitest";
import { processPopulation } from "./populationProcessor";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../riskData/riskDataTypes";

function riskRow(xrayImageId: string, portName: string, sourceRowNumber: number): NormalizedRiskRow {
  return {
    movementType: "بري",
    portCode: "P1",
    portName,
    portType: "بري",
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    transitDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    manifestDate: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    xrayImageId,
    xrayEntryDate: "2026-05-04",
    targetedByRiskEngine: null,
    riskMessage: null,
    stage: "FIRST_STAGE",
    sourceSheetName: "بري",
    sourceRowNumber,
  };
}

function workbook(rows: NormalizedRiskRow[]): RiskWorkbookResult {
  return {
    rows,
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0,
  };
}

// Device-code-anchored ids (shape A: [device][YYYYMMDD][sequence]); the paste
// lists device 96601PB04 for منفذ ب only.
const ROWS = [
  riskRow("96601PB04202605040001", "منفذ أ", 2),
  riskRow("96601PB04202605040002", "منفذ ب", 3),
  riskRow("77777XX99202605040003", "منفذ ب", 4),
  riskRow("55555YY11202605040004", "منفذ ج", 5),
];
const PASTE = "Port Name\tSystem S/N\nمنفذ ب\t96601PB04";

function statusById(rows: Array<{ xrayImageId: string; certScanStatus: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.xrayImageId, row.certScanStatus]));
}

describe("processPopulation — whole-port CertScan flags (C2)", () => {
  it("flags every row of a flagged port, unions with the pasted list, leaves other ports alone", async () => {
    const result = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
      certScanPorts: ["منفذ أ"],
    });
    expect(statusById(result.preparedRows)).toEqual({
      "96601PB04202605040001": "Certscan", // flagged port
      "96601PB04202605040002": "Certscan", // list match
      "77777XX99202605040003": "NonCertscan",
      "55555YY11202605040004": "NonCertscan",
    });
    expect(result.summary.certScanRows).toBe(2);
    expect(result.summary.nonCertScanRows).toBe(2);
    const flagged = result.preparedRows.find((row) => row.xrayImageId === "96601PB04202605040001")!;
    expect(flagged.certScanSnippet).toBeNull();
  });

  it("a flagged port alone (no paste) still counts as CertScan provided", async () => {
    const result = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: "",
      certScanPorts: ["منفذ ج"],
    });
    expect(statusById(result.preparedRows)["55555YY11202605040004"]).toBe("Certscan");
    expect(result.summary.certScanRows).toBe(1);
    expect(result.summary.certScanProvided).toBe(true);
  });

  it("no flagged ports: identical to the list-only behaviour", async () => {
    const withEmpty = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
      certScanPorts: [],
    });
    const withoutField = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
    });
    expect(statusById(withEmpty.preparedRows)).toEqual(statusById(withoutField.preparedRows));
    expect(statusById(withoutField.preparedRows)["96601PB04202605040001"]).toBe("NonCertscan");
    expect(withoutField.summary.certScanRows).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/processing/populationProcessor.certScanPorts.test.ts`
Expected: FAIL — the flagged-port rows come back `"NonCertscan"`; `certScanProvided` is `false` in test 2. (Test 3 already passes.)

- [ ] **Step 3: Implement**

`src/components/Sidebar/Tabs/Population/processing/populationProcessingTypes.ts` — Before:
```ts
export type PopulationProcessingInput = {
  riskWorkbookResult: RiskWorkbookResult;
  biWorkbookResult: BiWorkbookResult | null;
  certScanPasteText: string;
};
```
After:
```ts
export type PopulationProcessingInput = {
  riskWorkbookResult: RiskWorkbookResult;
  biWorkbookResult: BiWorkbookResult | null;
  certScanPasteText: string;
  /**
   * C2: ports flagged CertScan as a whole (`PopulationConfig.certScanPorts`).
   * A row is CertScan when its port is listed here OR its id matches the
   * pasted device list. Optional — omitted means no port is flagged.
   */
  certScanPorts?: readonly string[];
};
```

`src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts` — Before:
```ts
import { attachLazyRawRow } from "../../../../../data/population/populationTypes";
```
After:
```ts
import { attachLazyRawRow } from "../../../../../data/population/populationTypes";
import { normalizePortName } from "../../../../../data/distribution/portEligibility";
```

Before:
```ts
function matchCertScan(params: {
  xrayImageId: string;
  portName: string | null;
  entriesByPopulationPort: Map<string, CertScanEntry[]>;
}): CertScanMatchResult {
  const { xrayImageId, portName, entriesByPopulationPort } = params;

  const portKey = normalizeText(portName);
  const entries = entriesByPopulationPort.get(portKey) ?? [];

  const snippetMatch = matchXrayIdAgainstPortEntries(xrayImageId, entries);

  if (!snippetMatch.matched) {
    return {
```
After:
```ts
function matchCertScan(params: {
  xrayImageId: string;
  portName: string | null;
  entriesByPopulationPort: Map<string, CertScanEntry[]>;
  /** C2: the row's port is flagged CertScan as a whole (config.certScanPorts). */
  portFlagged: boolean;
}): CertScanMatchResult {
  const { xrayImageId, portName, entriesByPopulationPort, portFlagged } = params;

  const portKey = normalizeText(portName);
  const entries = entriesByPopulationPort.get(portKey) ?? [];

  const snippetMatch = matchXrayIdAgainstPortEntries(xrayImageId, entries);

  if (!snippetMatch.matched && portFlagged) {
    // Union rule (C2): a flagged port makes the row CertScan even without a
    // device-list match. No snippet — nothing in the pasted list matched it.
    return {
      certScanStatus: "Certscan",
      certScanSnippet: null,
      originalCertScanSnippet: null
    };
  }

  if (!snippetMatch.matched) {
    return {
```

Before:
```ts
  const { riskWorkbookResult, biWorkbookResult, certScanPasteText } = input;
```
After:
```ts
  const { riskWorkbookResult, biWorkbookResult, certScanPasteText } = input;
  const certScanPortSet = new Set((input.certScanPorts ?? []).map((port) => normalizePortName(port)));
```

Before:
```ts
      const certScanMatch = matchCertScan({
        xrayImageId: enrichment.row.xrayImageId,
        portName: enrichment.row.portName,
        entriesByPopulationPort: certScanByPort
      });
```
After:
```ts
      const certScanMatch = matchCertScan({
        xrayImageId: enrichment.row.xrayImageId,
        portName: enrichment.row.portName,
        entriesByPopulationPort: certScanByPort,
        portFlagged: certScanPortSet.has(normalizePortName(enrichment.row.portName))
      });
```

Before:
```ts
      certScanProvided: certScanEntries.length > 0,
```
After:
```ts
      // C2: flagged ports are a CertScan reference too.
      certScanProvided: certScanEntries.length > 0 || certScanPortSet.size > 0,
```

`src/components/Sidebar/Tabs/Population/index.tsx` — Before:
```ts
      const result = await processPopulation({
        riskWorkbookResult,
        biWorkbookResult,
        certScanPasteText
      }, (stage, percent) => {
```
After:
```ts
      const result = await processPopulation({
        riskWorkbookResult,
        biWorkbookResult,
        certScanPasteText,
        certScanPorts: config.certScanPorts ?? []
      }, (stage, percent) => {
```
Before:
```ts
          certScanProvided: certScanPasteText.trim().length > 0,
```
After:
```ts
          certScanProvided: certScanPasteText.trim().length > 0 || (config.certScanPorts?.length ?? 0) > 0,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/processing`
Expected: PASS (new file plus the existing processor/parser suites).

- [ ] **Step 5: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`

- [ ] **Step 6: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (population): process flagged ports as CertScan (union with the pasted list)"`
- **Why:** Owner decision (spec C2): a port flag means CertScan; a row is CertScan if its port is flagged OR its id is in the pasted list; applies from the next processing run.
- **What changed:** `PopulationProcessingInput.certScanPorts`; `matchCertScan` returns `Certscan` (no snippet) for a flagged port without a list match; `summary.certScanProvided` counts flagged ports; the Population tab passes `config.certScanPorts`. `drawSample` untouched → no `SAMPLING_ALGORITHM_VERSION` bump; existing samples unchanged.
- **Before/After:** the `matchCertScan` head and new branch.

- [ ] **Step 7: Commit**

```bash
npm run generate:changelog
git add src/components/Sidebar/Tabs/Population src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): process flagged ports as CertScan (union with the pasted list)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 10: C2 — Admin port picker for whole-port CertScan flags

**Files:**
- Create: `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.tsx`
- Create: `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.test.tsx`
- Modify: `src/data/distribution/portEligibility.ts` (`derivePortCatalog` signature at 43)
- Modify: `src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.tsx` (imports 1-18; props 20-35; destructure 37-48; hooks before `if (!isOpen) return null;`; processing quick section ~153-162; after the `ConfirmDialog` at the end)
- Modify: `src/components/Sidebar/Tabs/Population/components/PortRestrictionsModal.css` (append)
- Modify: `src/components/Sidebar/Tabs/Population/index.tsx` (`<MappingSettingsModal` props ~1548-1557)
- Modify: `src/data/labels/labels.phaseTwo.ts` (append keys before `} as const;`)

**Interfaces:**
- Consumes (Task 8): `PopulationConfig.certScanPorts`; `PortCatalogCategory`, `derivePortCatalog` from `portEligibility.ts`.
- Produces:
  - `export type PortCatalogRow = Pick<PreparedPopulationRow, "portName" | "portType">` and `derivePortCatalog(rows: readonly PortCatalogRow[]): PortCatalogCategory[]` (widened input; unchanged output).
  - `CertScanPortsModal` default export: props `{ portCatalog: PortCatalogCategory[]; selectedPorts: readonly string[]; onSave: (ports: string[]) => void; onClose: () => void }`.
  - `MappingSettingsModal` new optional prop `certScanPortRows?: readonly PortCatalogRow[]`; saving the picker calls `onConfigChange({ ...config, certScanPorts })` (the Population tab's existing `handleConfigChange` persists it, gated on `canConfigureSample`).

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import CertScanPortsModal from "./CertScanPortsModal";
import MappingSettingsModal from "./MappingSettingsModal";

afterEach(() => cleanup());

const CATALOG: PortCatalogCategory[] = [
  {
    category: "بحري",
    ports: [
      { portName: "ميناء جدة", rowCount: 10 },
      { portName: "ميناء الدمام", rowCount: 5 },
    ],
  },
  { category: "بري", ports: [{ portName: "منفذ الحديثة", rowCount: 3 }] },
];

describe("CertScanPortsModal (C2)", () => {
  it("pre-checks the flagged ports and saves the new selection in catalog order", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["منفذ الحديثة"]} onSave={onSave} onClose={() => {}} />);

    expect(screen.getByRole("checkbox", { name: "منفذ الحديثة" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ميناء جدة" })).not.toBeChecked();
    expect(screen.getByText("1 من 3 منفذ محدَّد كـ CertScan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "ميناء جدة" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith(["ميناء جدة", "منفذ الحديثة"]);
  });

  it("keeps a flagged port that is missing from this month's catalog", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["منفذ قديم"]} onSave={onSave} onClose={() => {}} />);

    expect(screen.getByText("محددة سابقاً — غير موجودة في ملف هذا الشهر")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "منفذ قديم" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith(["منفذ قديم"]);
  });

  it("clears every flag", () => {
    const onSave = vi.fn();
    render(<CertScanPortsModal portCatalog={CATALOG} selectedPorts={["ميناء جدة", "منفذ الحديثة"]} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء تحديد الكل" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(onSave).toHaveBeenCalledWith([]);
  });
});

describe("MappingSettingsModal — CertScan port picker wiring (C2)", () => {
  it("opens the picker from processing settings and saves certScanPorts through onConfigChange", () => {
    const onConfigChange = vi.fn();
    render(
      <MappingSettingsModal
        isOpen
        mode="processing"
        onClose={vi.fn()}
        config={{ ...DEFAULT_POPULATION_CONFIG, certScanPorts: ["منفذ ب"] }}
        onConfigChange={onConfigChange}
        certScanPortRows={[
          { portName: "منفذ أ", portType: "بري" },
          { portName: "منفذ ب", portType: "بري" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "تحديد المنافذ (1 محدد)" }));
    const picker = screen.getByRole("dialog", { name: "منافذ CertScan الكاملة" });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "منفذ أ" }));
    fireEvent.click(within(picker).getByRole("button", { name: "حفظ" }));

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ certScanPorts: ["منفذ أ", "منفذ ب"] }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.test.tsx`
Expected: FAIL — `Failed to resolve import "./CertScanPortsModal"`.

- [ ] **Step 3: Label keys**

In `src/data/labels/labels.phaseTwo.ts` — Before:
```ts
  p2_preview_header_certscan:       "CertScan",
} as const;
```
After:
```ts
  p2_preview_header_certscan:       "CertScan",

  // ── إعدادات المعالجة · منافذ CertScan الكاملة (C2) ──────────────────────
  p2_certscan_ports_section_title:  "منافذ CertScan الكاملة",
  p2_certscan_ports_section_hint:   "كل صورة من منفذ محدَّد هنا تُعامَل كـ CertScan عند المعالجة القادمة، إضافةً إلى الصور المطابقة لقائمة CertScan الملصقة. العينات المسحوبة سابقاً لا تتغير.",
  p2_certscan_ports_open:           "تحديد المنافذ ({count} محدد)",
  p2_certscan_ports_title:          "منافذ CertScan الكاملة",
  p2_certscan_ports_status:         "{count} من {total} منفذ محدَّد كـ CertScan",
  p2_certscan_ports_empty_catalog:  "ارفع ملف وكالة المخاطر أولاً لعرض منافذ الشهر.",
  p2_certscan_ports_missing_category: "محددة سابقاً — غير موجودة في ملف هذا الشهر",
  p2_certscan_ports_clear:          "إلغاء تحديد الكل",
  p2_certscan_ports_cancel:         "إلغاء",
  p2_certscan_ports_save:           "حفظ",
  p2_certscan_ports_close_aria:     "إغلاق نافذة منافذ CertScan",
} as const;
```

- [ ] **Step 4: Widen `derivePortCatalog`'s input**

In `src/data/distribution/portEligibility.ts` — Before:
```ts
export function derivePortCatalog(rows: PreparedPopulationRow[]): PortCatalogCategory[] {
```
After:
```ts
/** The two fields `derivePortCatalog` reads — satisfied by processed population
 *  rows and by raw risk-workbook rows alike (C2's CertScan port picker lists
 *  the ports of whichever the month has loaded). */
export type PortCatalogRow = Pick<PreparedPopulationRow, "portName" | "portType">;

export function derivePortCatalog(rows: readonly PortCatalogRow[]): PortCatalogCategory[] {
```

- [ ] **Step 5: Create `CertScanPortsModal.tsx`**

Create `src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.tsx`:

```tsx
import { useState } from "react";
import { ModalPortal } from "../../../../ModalPortal/ModalPortal";
import { useFocusTrap } from "../../../../../hooks/useFocusTrap";
import type { PortCatalogCategory } from "../../../../../data/distribution/portEligibility";
import { useLabels } from "../../../../../data/labels/useLabels";
import "./PortRestrictionsModal.css";

type CertScanPortsModalProps = {
  portCatalog: PortCatalogCategory[];
  selectedPorts: readonly string[];
  onSave: (ports: string[]) => void;
  onClose: () => void;
};

/**
 * Admin picker for `PopulationConfig.certScanPorts` (C2): every row whose port
 * is checked here is processed as CertScan, in addition to rows matched by
 * the pasted CertScan device list. Reuses PortRestrictionsModal's markup and
 * CSS (`prm-*`) so the two port pickers read as one control family.
 *
 * A previously flagged port absent from the current catalog (not in this
 * month's risk file) is kept and listed under its own group, so opening and
 * saving the picker for one month never silently drops another month's flag.
 * No backdrop-click-to-close (unsaved checkbox edits); close via ✕, the
 * cancel button or Escape.
 */
export default function CertScanPortsModal({ portCatalog, selectedPorts, onSave, onClose }: CertScanPortsModalProps) {
  const L = useLabels();
  const catalogPortNames = new Set(portCatalog.flatMap((category) => category.ports.map((port) => port.portName)));
  const missingPorts = selectedPorts.filter((portName) => !catalogPortNames.has(portName));
  const categories: PortCatalogCategory[] =
    missingPorts.length > 0
      ? [
          ...portCatalog,
          {
            category: L.p2_certscan_ports_missing_category,
            ports: missingPorts.map((portName) => ({ portName, rowCount: 0 })),
          },
        ]
      : portCatalog;
  const totalPorts = categories.reduce((sum, category) => sum + category.ports.length, 0);

  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectedPorts));
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  function togglePort(portName: string, on: boolean) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (on) next.add(portName);
      else next.delete(portName);
      return next;
    });
  }

  function toggleCategory(category: PortCatalogCategory, on: boolean) {
    setChecked((previous) => {
      const next = new Set(previous);
      for (const port of category.ports) {
        if (on) next.add(port.portName);
        else next.delete(port.portName);
      }
      return next;
    });
  }

  function handleSave() {
    onSave(
      categories
        .flatMap((category) => category.ports.map((port) => port.portName))
        .filter((portName) => checked.has(portName)),
    );
  }

  return (
    <ModalPortal>
      <div className="prm-backdrop csp-over-modal">
        <div ref={dialogRef} className="prm-modal" role="dialog" aria-modal="true" aria-labelledby="csp-title">
          <div className="prm-head">
            <div>
              <h3 id="csp-title">{L.p2_certscan_ports_title}</h3>
              <p className="prm-sub">{L.p2_certscan_ports_section_hint}</p>
            </div>
            <button type="button" className="prm-close" onClick={onClose} aria-label={L.p2_certscan_ports_close_aria}>
              ✕
            </button>
          </div>

          <div className={`prm-status ${checked.size > 0 ? "restricted" : "unrestricted"}`} role="status">
            <span>
              {L.p2_certscan_ports_status
                .replace("{count}", String(checked.size))
                .replace("{total}", String(totalPorts))}
            </span>
          </div>

          <div className="prm-body">
            {categories.length === 0 ? (
              <p className="prm-empty">{L.p2_certscan_ports_empty_catalog}</p>
            ) : (
              categories.map((category) => {
                const checkedInCategory = category.ports.filter((port) => checked.has(port.portName)).length;
                const allOn = checkedInCategory === category.ports.length;
                const noneOn = checkedInCategory === 0;
                return (
                  <div className="prm-cat-block" key={category.category}>
                    <div className="prm-cat-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = !allOn && !noneOn;
                          }}
                          onChange={(e) => toggleCategory(category, e.target.checked)}
                        />
                        {category.category}
                      </label>
                      <span className="prm-cat-count num">
                        {checkedInCategory}/{category.ports.length}
                      </span>
                    </div>
                    <ul className="prm-port-list">
                      {category.ports.map((port) => (
                        <li className="prm-port-row" key={port.portName}>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked.has(port.portName)}
                              onChange={(e) => togglePort(port.portName, e.target.checked)}
                            />
                            {port.portName}
                          </label>
                          <span className="prm-port-count num">{port.rowCount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          <div className="prm-foot">
            <button type="button" className="prm-btn prm-btn-danger-ghost" onClick={() => setChecked(new Set())}>
              {L.p2_certscan_ports_clear}
            </button>
            <div className="prm-foot-actions">
              <button type="button" className="prm-btn prm-btn-ghost" onClick={onClose}>
                {L.p2_certscan_ports_cancel}
              </button>
              <button type="button" className="prm-btn prm-btn-primary" onClick={handleSave}>
                {L.p2_certscan_ports_save}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
```

Append to `src/components/Sidebar/Tabs/Population/components/PortRestrictionsModal.css`:
```css

/* CertScan port picker (C2) opens on top of the «إعدادات المعالجة» modal,
   which already sits at --z-modal; lift this backdrop to the dialog layer. */
.prm-backdrop.csp-over-modal {
  z-index: var(--z-dialog);
}
```

- [ ] **Step 6: Wire it into `MappingSettingsModal.tsx`**

Before:
```ts
import { Settings2, X } from "lucide-react";
```
After:
```ts
import { useMemo, useState } from "react";
import { Settings2, X } from "lucide-react";
import { derivePortCatalog, type PortCatalogRow } from "../../../../../data/distribution/portEligibility";
import { useLabels } from "../../../../../data/labels/useLabels";
import CertScanPortsModal from "./CertScanPortsModal";
```

Before:
```ts
  sampleSeed?: string;
  onSampleSeedChange?: (seed: string) => void;
};
```
After:
```ts
  sampleSeed?: string;
  onSampleSeedChange?: (seed: string) => void;
  /** C2: rows whose ports populate the «منافذ CertScan الكاملة» picker (the
   *  risk workbook's rows, or the processed population's). Optional; without
   *  it the picker lists only the already-flagged ports. */
  certScanPortRows?: readonly PortCatalogRow[];
};
```

Before:
```ts
  sampleSeed = "",
  onSampleSeedChange,
}: MappingSettingsModalProps) {
```
After:
```ts
  sampleSeed = "",
  onSampleSeedChange,
  certScanPortRows,
}: MappingSettingsModalProps) {
```

Before:
```ts
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose, enabled: isOpen });

  if (!isOpen) return null;
```
After:
```ts
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose, enabled: isOpen });
  const labels = useLabels();
  const [certScanPortsOpen, setCertScanPortsOpen] = useState(false);
  const certScanPortCatalog = useMemo(() => derivePortCatalog(certScanPortRows ?? []), [certScanPortRows]);

  if (!isOpen) return null;
```

Before:
```tsx
                <CertScanGrid
                  initialText={certScanPasteText || undefined}
                  onDataChange={(value) => onCertScanPasteTextChange?.(value)}
                />
              </div>
```
After:
```tsx
                <CertScanGrid
                  initialText={certScanPasteText || undefined}
                  onDataChange={(value) => onCertScanPasteTextChange?.(value)}
                />
              </div>

              <div>
                <h3 style={{ margin: "0 0 8px", fontSize: "15px" }}>{labels.p2_certscan_ports_section_title}</h3>
                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--population-muted)" }}>
                  {labels.p2_certscan_ports_section_hint}
                </p>
                <button type="button" className="proc-export-btn" onClick={() => setCertScanPortsOpen(true)}>
                  {labels.p2_certscan_ports_open.replace("{count}", String(config.certScanPorts?.length ?? 0))}
                </button>
              </div>
```

Before (end of the component):
```tsx
        onCancel={() => controller.setPendingRemoval(null)}
      />
    </div>
    </ModalPortal>
```
After:
```tsx
        onCancel={() => controller.setPendingRemoval(null)}
      />
      {certScanPortsOpen && (
        <CertScanPortsModal
          portCatalog={certScanPortCatalog}
          selectedPorts={config.certScanPorts ?? []}
          onClose={() => setCertScanPortsOpen(false)}
          onSave={(ports) => {
            onConfigChange({ ...config, certScanPorts: ports });
            setCertScanPortsOpen(false);
          }}
        />
      )}
    </div>
    </ModalPortal>
```

- [ ] **Step 7: Pass the rows from the Population tab**

In `src/components/Sidebar/Tabs/Population/index.tsx` — Before:
```tsx
        sampleSeed={sampleSeed}
        onSampleSeedChange={setSampleSeed}
        processingContext={{
```
After:
```tsx
        sampleSeed={sampleSeed}
        onSampleSeedChange={setSampleSeed}
        certScanPortRows={riskWorkbookResult?.rows ?? populationProcessingResult?.preparedRows}
        processingContext={{
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/components/CertScanPortsModal.test.tsx src/components/Sidebar/Tabs/Population/components/MappingSettingsModal.test.tsx src/components/Sidebar/Tabs/Population/components/PortRestrictionsModal.test.tsx src/data/distribution/portEligibility.test.ts`
Expected: PASS.

- [ ] **Step 9: Tier 2 gates plus hex/complexity checks (new CSS + a 1407-line component touched)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:hex-literals && npm run check:complexity`

- [ ] **Step 10: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (population): admin picker for whole-port CertScan flags in processing settings"`
- **Why:** Admins need a way to set `certScanPorts` (spec C2 "admin port picker reusing the port-restriction modal UI").
- **What changed:** new `CertScanPortsModal` (prm-* markup, keeps flagged ports missing from the month's file); «إعدادات المعالجة» shows a «منافذ CertScan الكاملة» section opening it and saving through `onConfigChange`; `derivePortCatalog` accepts raw risk rows; label keys in `labels.phaseTwo.ts`.
- **Before/After:** the `MappingSettingsModal` processing-section insertion.

- [ ] **Step 11: Commit**

```bash
npm run generate:changelog
git add src/components/Sidebar/Tabs/Population src/data/distribution/portEligibility.ts src/data/labels/labels.phaseTwo.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): admin picker for whole-port CertScan flags in processing settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 11: C2 — CertScan chip in the employee case queue + CertScan status-filter column

**Files:**
- Create: `src/data/population/certScanFilter.ts`
- Create: `src/components/CertScanFilterChips/CertScanFilterChips.tsx`
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/certScanColumn.ts`
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/certScanQueueFilter.test.tsx`
- Modify: `src/data/labels/labelsStore.ts` (after `ew_case_filter_empty`, ~293)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/caseFilter.ts` (imports 38-40; `CaseFilterState` 90-96; `useCaseFilter` 108-113)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` (imports ~30; `certScanStatus` column ~61; new `CaseFilterBar` after `CaseFilterSwitcher` ~1239; `ReferralWorkspaceShell` 1252-1296)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (lines 105, 2108, 2116, 2234 — in-place replacements only, zero net lines)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (imports; `certScanStatus` column ~110)

**Interfaces:**
- Produces (`src/data/population/certScanFilter.ts`):
  - `type CertScanFilter = "any" | "certscan" | "noncertscan"`, `CERTSCAN_FILTERS`, `type CertScanFilterCounts = Record<CertScanFilter, number>`
  - `matchesCertScanFilter(status: string | null | undefined, filter: CertScanFilter): boolean` — CertScan iff `status === "Certscan"` (the sampler's rule).
  - `filterByCertScan<T extends { row: { certScanStatus: string | null } }>(entries: T[], filter: CertScanFilter): T[]` (identity for `"any"`)
  - `countCertScanFilters(entries: readonly { row: { certScanStatus: string | null } }[]): CertScanFilterCounts`
- Produces (UI): `CertScanFilterChips` default export `{ value; onChange; counts?; groupClassName; chipClassName; countClassName? }`; `certScanStatusFilterProps(L: Labels)`; `CaseFilterState` gains `certScan`, `setCertScan`, `certScanCounts` (and `entries` now applies both chip groups); `CaseFilterBar({ state })`; `ReferralWorkspaceShell` prop `caseFilterValue` replaced by `caseFilterEmpty: boolean`.
- Label keys: `certscan_filter_aria`, `certscan_filter_any`, `certscan_filter_certscan`, `certscan_filter_noncertscan`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/certScanQueueFilter.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// C2: a CertScan chip in the employee case queue that COMPOSES with the case
// chips (applied after them), plus a certScanStatus status-filter column —
// both through the one predicate in src/data/population/certScanFilter.ts.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import { makeRow } from "../../../../../../data/reporting/reportTestFixtures";
import {
  countCertScanFilters,
  filterByCertScan,
  matchesCertScanFilter,
} from "../../../../../../data/population/certScanFilter";
import { certScanStatusFilterProps } from "../certScanColumn";
import { useCaseFilter, type CaseFilterState } from "./caseFilter";
import { buildXrayColumns, CaseFilterBar } from "./subComponents";

afterEach(() => cleanup());

function entry(id: string, certScanStatus: "Certscan" | "NonCertscan"): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-04T09:00:00.000Z",
    row: makeRow(id, "منفذ أ", { certScanStatus }),
  };
}

const ENTRIES: DistributionEntry[] = [
  entry("C-1", "Certscan"),
  entry("N-1", "NonCertscan"),
  entry("C-2", "Certscan"),
];

describe("CertScan predicate (C2)", () => {
  it("matches on the processed certScanStatus", () => {
    expect(matchesCertScanFilter("Certscan", "certscan")).toBe(true);
    expect(matchesCertScanFilter("NonCertscan", "certscan")).toBe(false);
    expect(matchesCertScanFilter("NonCertscan", "noncertscan")).toBe(true);
    expect(matchesCertScanFilter(null, "noncertscan")).toBe(true);
    expect(matchesCertScanFilter("Certscan", "any")).toBe(true);
  });

  it("counts and filters; 'any' is identity-stable", () => {
    expect(countCertScanFilters(ENTRIES)).toEqual({ any: 3, certscan: 2, noncertscan: 1 });
    expect(filterByCertScan(ENTRIES, "noncertscan").map((e) => e.xrayImageId)).toEqual(["N-1"]);
    expect(filterByCertScan(ENTRIES, "any")).toBe(ENTRIES);
  });
});

describe("useCaseFilter — the CertScan chip composes with the case chips (C2)", () => {
  it("narrows the visible entries and keeps its counts over the case-filtered set", () => {
    const { result } = renderHook(() => useCaseFilter(ENTRIES));
    expect(result.current.certScan).toBe("any");
    expect(result.current.certScanCounts).toEqual({ any: 3, certscan: 2, noncertscan: 1 });

    act(() => result.current.setCertScan("certscan"));
    expect(result.current.entries.map((e) => e.xrayImageId)).toEqual(["C-1", "C-2"]);

    act(() => result.current.setValue("adhoc"));
    expect(result.current.entries).toEqual([]);
    expect(result.current.certScanCounts).toEqual({ any: 0, certscan: 0, noncertscan: 0 });
  });
});

describe("CaseFilterBar (C2)", () => {
  it("renders the CertScan chips beside the case chips and reports a click", () => {
    const calls: string[] = [];
    const state: CaseFilterState = {
      value: "all",
      setValue: () => {},
      certScan: "any",
      setCertScan: (next) => calls.push(next),
      entries: ENTRIES,
      counts: { all: 3, "risk-targeted": 3, adhoc: 0 },
      certScanCounts: { any: 3, certscan: 2, noncertscan: 1 },
    };
    render(<CaseFilterBar state={state} />);

    expect(screen.getByRole("group", { name: DEFAULT_LABELS.ew_case_filter_aria })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: DEFAULT_LABELS.certscan_filter_aria });
    fireEvent.click(within(group).getByRole("button", { name: /^CertScan/ }));
    expect(calls).toEqual(["certscan"]);
  });
});

describe("certScanStatus DataTable column (C2)", () => {
  it("is a status filter whose option values are the row's own certScanStatus values", () => {
    const column = buildXrayColumns(DEFAULT_LABELS).find((c) => c.id === "certScanStatus")!;
    expect(column.filterKind).toBe("status");
    expect(column.statusOptions?.map((option) => option.value)).toEqual(["all", "Certscan", "NonCertscan"]);
    expect(column.accessor(ENTRIES[0]!)).toBe("Certscan");
    expect(certScanStatusFilterProps(DEFAULT_LABELS)).toEqual({
      filterKind: column.filterKind,
      statusOptions: column.statusOptions,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/certScanQueueFilter.test.tsx`
Expected: FAIL — `Failed to resolve import ".../data/population/certScanFilter"`.

- [ ] **Step 3: The shared predicate module**

Create `src/data/population/certScanFilter.ts`:

```ts
// The one CertScan filter predicate (C2, 2026-09-28 corrective plan). A row is
// CertScan iff its processed `certScanStatus` is "Certscan" — the same rule
// the sampling split uses (sampleAlgorithmInternals.ts). Since C2 that status
// already folds in whole-port flags (processPopulation), so filters never need
// to know about `certScanPorts` themselves. The employee case queue
// (caseFilter.ts) and Population Browse both go through this module, so a chip
// can never disagree with the draw about what "CertScan" means.

export type CertScanFilter = "any" | "certscan" | "noncertscan";

/** Render order of the chips; "any" first because it is the default. */
export const CERTSCAN_FILTERS = ["any", "certscan", "noncertscan"] as const satisfies readonly CertScanFilter[];

export type CertScanFilterCounts = Record<CertScanFilter, number>;

type CertScanStatusCarrier = { row: { certScanStatus: string | null } };

export function matchesCertScanFilter(status: string | null | undefined, filter: CertScanFilter): boolean {
  if (filter === "any") return true;
  const isCertScan = status === "Certscan";
  return filter === "certscan" ? isCertScan : !isCertScan;
}

/** `entries` narrowed to the chip. Identity-stable for "any". */
export function filterByCertScan<T extends CertScanStatusCarrier>(entries: T[], filter: CertScanFilter): T[] {
  return filter === "any"
    ? entries
    : entries.filter((entry) => matchesCertScanFilter(entry.row.certScanStatus, filter));
}

/** How many rows each chip would show, over whatever set is passed in. */
export function countCertScanFilters(entries: readonly CertScanStatusCarrier[]): CertScanFilterCounts {
  const counts: CertScanFilterCounts = { any: entries.length, certscan: 0, noncertscan: 0 };
  for (const entry of entries) {
    if (matchesCertScanFilter(entry.row.certScanStatus, "certscan")) counts.certscan += 1;
    else counts.noncertscan += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Label keys**

In `src/data/labels/labelsStore.ts` — Before:
```ts
  ew_case_filter_empty:            "لا توجد حالات ضمن هذه التصفية. اختر «جميع الحالات» للعودة إلى القائمة كاملة.",
```
After:
```ts
  ew_case_filter_empty:            "لا توجد حالات ضمن هذه التصفية. اختر «جميع الحالات» للعودة إلى القائمة كاملة.",

  // ── CertScan chip (C2) — shared by the employee queue and Population Browse.
  // "CertScan" is the processed row's certScanStatus: its port is flagged as a
  // CertScan port OR its id matched the pasted CertScan device list.
  certscan_filter_aria:            "تصفية حسب CertScan",
  certscan_filter_any:             "كل الصور",
  certscan_filter_certscan:        "CertScan",
  certscan_filter_noncertscan:     "غير CertScan",
```

- [ ] **Step 5: The shared chip component**

Create `src/components/CertScanFilterChips/CertScanFilterChips.tsx`:

```tsx
import {
  CERTSCAN_FILTERS,
  type CertScanFilter,
  type CertScanFilterCounts,
} from "../../data/population/certScanFilter";
import { useLabels } from "../../data/labels/useLabels";

type CertScanFilterChipsProps = {
  value: CertScanFilter;
  onChange: (next: CertScanFilter) => void;
  /** Optional per-chip counts; omitted → no count badge (Population Browse,
   *  whose matching set lives in the query worker). */
  counts?: CertScanFilterCounts;
  groupClassName: string;
  chipClassName: string;
  countClassName?: string;
};

/**
 * «كل الصور» / «CertScan» / «غير CertScan» — the one CertScan chip group (C2),
 * shared by the employee case queue and Population Browse. Styling comes from
 * the caller's class names so each surface keeps its own control family;
 * `aria-pressed` states each chip's on/off.
 */
export default function CertScanFilterChips({
  value,
  onChange,
  counts,
  groupClassName,
  chipClassName,
  countClassName,
}: CertScanFilterChipsProps) {
  const L = useLabels();
  const chipLabel: Record<CertScanFilter, string> = {
    any: L.certscan_filter_any,
    certscan: L.certscan_filter_certscan,
    noncertscan: L.certscan_filter_noncertscan,
  };
  return (
    <div className={groupClassName} role="group" aria-label={L.certscan_filter_aria}>
      {CERTSCAN_FILTERS.map((id) => (
        <button
          key={id}
          type="button"
          className={`${chipClassName}${value === id ? " active" : ""}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {chipLabel[id]}
          {counts && <span className={countClassName}>{counts[id]}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Compose the chip into `useCaseFilter`**

In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/caseFilter.ts` — Before:
```ts
import { useMemo, useState } from "react";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
```
After:
```ts
import { useMemo, useState } from "react";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import {
  countCertScanFilters,
  filterByCertScan,
  type CertScanFilter,
  type CertScanFilterCounts,
} from "../../../../../../data/population/certScanFilter";
```
Before:
```ts
export type CaseFilterState = {
  value: CaseFilter;
  setValue: (next: CaseFilter) => void;
  /** `scopedEntries` narrowed to the active bucket — what the table renders. */
  entries: DistributionEntry[];
  counts: CaseFilterCounts;
};
```
After:
```ts
export type CaseFilterState = {
  value: CaseFilter;
  setValue: (next: CaseFilter) => void;
  /** The CertScan chip (C2). Composes with the case chip: applied AFTER it. */
  certScan: CertScanFilter;
  setCertScan: (next: CertScanFilter) => void;
  /** `scopedEntries` narrowed to the active case bucket AND CertScan chip — what the table renders. */
  entries: DistributionEntry[];
  counts: CaseFilterCounts;
  /** CertScan chip counts over the case-filtered set, so each number is what clicking that chip shows. */
  certScanCounts: CertScanFilterCounts;
};
```
Before:
```ts
export function useCaseFilter(scopedEntries: DistributionEntry[]): CaseFilterState {
  const [value, setValue] = useState<CaseFilter>("all");
  const counts = useMemo(() => countCaseFilters(scopedEntries), [scopedEntries]);
  const entries = useMemo(() => filterCases(scopedEntries, value), [scopedEntries, value]);
  return { value, setValue, entries, counts };
}
```
After:
```ts
export function useCaseFilter(scopedEntries: DistributionEntry[]): CaseFilterState {
  const [value, setValue] = useState<CaseFilter>("all");
  const [certScan, setCertScan] = useState<CertScanFilter>("any");
  const counts = useMemo(() => countCaseFilters(scopedEntries), [scopedEntries]);
  const caseEntries = useMemo(() => filterCases(scopedEntries, value), [scopedEntries, value]);
  const certScanCounts = useMemo(() => countCertScanFilters(caseEntries), [caseEntries]);
  const entries = useMemo(() => filterByCertScan(caseEntries, certScan), [caseEntries, certScan]);
  return { value, setValue, certScan, setCertScan, entries, counts, certScanCounts };
}
```

- [ ] **Step 7: Shared status-filter props for the `certScanStatus` column**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/certScanColumn.ts`:

```ts
import type { DataTableCol } from "../../../../DataTable";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import type { Labels } from "../../../../../data/labels/labelsStore";

/**
 * DataTable status-filter props for the `certScanStatus` column of the
 * employee sample tables (C2). The option values ARE the processed row's own
 * `certScanStatus` values, so DataTable's default status match
 * (`accessor(row) === value`) filters correctly with no custom matcher; the
 * option labels reuse the shared CertScan chip keys.
 */
export function certScanStatusFilterProps(
  L: Labels
): Pick<DataTableCol<DistributionEntry>, "filterKind" | "statusOptions"> {
  return {
    filterKind: "status",
    statusOptions: [
      { value: "all", label: L.status_all },
      { value: "Certscan", label: L.certscan_filter_certscan },
      { value: "NonCertscan", label: L.certscan_filter_noncertscan },
    ],
  };
}
```

- [ ] **Step 8: `subComponents.tsx` — column, `CaseFilterBar`, shell prop**

Before:
```ts
import { CASE_FILTERS, type CaseFilter, type CaseFilterCounts } from "./caseFilter";
```
After:
```ts
import { CASE_FILTERS, type CaseFilter, type CaseFilterCounts, type CaseFilterState } from "./caseFilter";
import CertScanFilterChips from "../../../../../CertScanFilterChips/CertScanFilterChips";
import { certScanStatusFilterProps } from "../certScanColumn";
```

Before:
```ts
  { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  accessor: (e) => e.row.certScanStatus },
```
After:
```ts
  { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  ...certScanStatusFilterProps(L), accessor: (e) => e.row.certScanStatus },
```

Immediately after the closing `}` of `export function CaseFilterSwitcher(...)`, insert:
```tsx

/**
 * The queue's two chip groups side by side (C2): the case chips, then the
 * CertScan chips, which filter what the case chip already narrowed. Takes the
 * whole `useCaseFilter` state so the call site in XrayReferrals.tsx stays one
 * line (that component is at its max-lines-per-function budget).
 */
export function CaseFilterBar({ state }: { state: CaseFilterState }) {
  return (
    <>
      <CaseFilterSwitcher value={state.value} counts={state.counts} onChange={state.setValue} />
      <CertScanFilterChips
        value={state.certScan}
        counts={state.certScanCounts}
        onChange={state.setCertScan}
        groupClassName="ew-view-switcher ew-case-filter"
        chipClassName="ew-view-seg"
        countClassName="ew-case-filter-count"
      />
    </>
  );
}
```

In `ReferralWorkspaceShell` — Before:
```ts
  showingRetainedDraft,
  caseFilterValue,
  caseFilterCounts,
  labels: L,
  table,
}: {
```
After:
```ts
  showingRetainedDraft,
  caseFilterEmpty,
  caseFilterCounts,
  labels: L,
  table,
}: {
```
Before:
```ts
  caseFilterValue: CaseFilter;
  caseFilterCounts: CaseFilterCounts;
```
After:
```ts
  /** True when the case chip AND the CertScan chip together leave no rows (C2). */
  caseFilterEmpty: boolean;
  caseFilterCounts: CaseFilterCounts;
```
Before:
```tsx
      {caseFilterCounts[caseFilterValue] === 0 && caseFilterCounts.all > 0 && (
```
After:
```tsx
      {caseFilterEmpty && caseFilterCounts.all > 0 && (
```

- [ ] **Step 9: `XrayReferrals.tsx` — four in-place line replacements (zero net lines)**

Before:
```ts
  CaseFilterSwitcher,
```
After:
```ts
  CaseFilterBar,
```
Before:
```tsx
              resetToken={`${selMonth}::${scopeEmployee}::${caseFilter.value}`}
```
After:
```tsx
              resetToken={`${selMonth}::${scopeEmployee}::${caseFilter.value}::${caseFilter.certScan}`}
```
Before:
```tsx
              toolbarStart={<CaseFilterSwitcher value={caseFilter.value} counts={caseFilter.counts} onChange={caseFilter.setValue} />}
```
After:
```tsx
              toolbarStart={<CaseFilterBar state={caseFilter} />}
```
Before:
```tsx
            caseFilterValue={caseFilter.value}
```
After:
```tsx
            caseFilterEmpty={caseFilter.entries.length === 0}
```

- [ ] **Step 10: `XrayInspectionResults.tsx` — same column props**

Before:
```ts
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
```
After:
```ts
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
import { certScanStatusFilterProps } from "./certScanColumn";
```
Before:
```ts
    { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  accessor: (e) => e.row.certScanStatus },
```
After:
```ts
    { id: "certScanStatus",         label: L.col_certscan_status,           widthFr: 9,  ...certScanStatusFilterProps(L), accessor: (e) => e.row.certScanStatus },
```

- [ ] **Step 11: Run to verify it passes, plus the queue suites**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace`
Expected: PASS — including the new file, `XrayReferrals.caseFilter.test.tsx`, `caseFilter.test.ts`, `subComponents.test.ts`, `employeeMirrorFields.contract.test.ts`-driven views, and the `XrayInspectionResults` suites.

- [ ] **Step 12: Tier 2 gates plus complexity (XrayReferrals budget)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`
Expected: green; `check:complexity` must still pass `XrayReferrals` (≤ 1450 lines).

- [ ] **Step 13: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (employee-workspace): CertScan chip and CertScan status filter in the sample queues"`
- **Why:** Users need to find CertScan work in their queue (spec C2 "a CertScan chip in the employee case queue (composes with the case chips), certScanStatus status-filter column in DataTable views").
- **What changed:** one predicate module `src/data/population/certScanFilter.ts`; shared `CertScanFilterChips`; `useCaseFilter` applies the CertScan chip after the case chip with its own counts; `CaseFilterBar` renders both groups; the empty-queue notice now reflects both chips; the `certScanStatus` column is a status filter in the referral queue and «نتائج فحص الأشعة». XrayReferrals changed by in-place line swaps only.
- **Before/After:** the `useCaseFilter` body from Step 6.

- [ ] **Step 14: Commit**

```bash
npm run generate:changelog
git add src/data/population/certScanFilter.ts src/components/CertScanFilterChips src/components/Sidebar/Tabs/EmployeeWorkspace src/data/labels/labelsStore.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (employee-workspace): CertScan chip and CertScan status filter in the sample queues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 12: C2 — CertScan filter in Population Browse (worker + fallback paths)

**Files:**
- Create: `src/data/population/certScanFilter.query.test.ts`
- Modify: `src/data/population/certScanFilter.ts` (append Browse helpers)
- Modify: `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (imports; toolbar before `<span className="bv-row-count">` ~1248)
- Modify: `src/components/Sidebar/Tabs/Population/Population.css` (append)

**Interfaces:**
- Consumes (Task 11): `CertScanFilter`, `CertScanFilterChips`; `runPopulationQuery` (`src/data/population/populationQuery.ts`); `handleWorkerMessage`, `createInitialWorkerState` (`src/workers/populationQueryWorker.ts`).
- Produces: `CERTSCAN_STATUS_COLUMN = "certScanStatus"`; `certScanFilterFromColumnFilters(columnFilters: Readonly<Record<string, readonly string[]>>): CertScanFilter`; `withCertScanFilter(columnFilters: Readonly<Record<string, string[]>>, filter: CertScanFilter): Record<string, string[]>`. The chip is expressed as an ordinary `certScanStatus` column filter, so it rides the existing `PopulationQueryParams.columnFilters` through BOTH the worker ("query" request) and the main-thread fallback (`runPopulationQuery`) with no worker protocol change.

- [ ] **Step 1: Write the failing test**

Create `src/data/population/certScanFilter.query.test.ts`:

```ts
// C2: Population Browse's CertScan chip is an ordinary certScanStatus column
// filter, so the worker-backed path (populationQueryWorker "query") and the
// main-thread fallback (runPopulationQuery) filter identically.
import { describe, expect, it } from "vitest";
import { createInitialWorkerState, handleWorkerMessage } from "../../workers/populationQueryWorker";
import { runPopulationQuery, type PopulationQueryParams } from "./populationQuery";
import {
  CERTSCAN_STATUS_COLUMN,
  certScanFilterFromColumnFilters,
  withCertScanFilter,
} from "./certScanFilter";

const ROWS: Array<Record<string, unknown>> = [
  { xrayImageId: "1", certScanStatus: "Certscan", portName: "ميناء أ" },
  { xrayImageId: "2", certScanStatus: "NonCertscan", portName: "ميناء أ" },
  { xrayImageId: "3", certScanStatus: "Certscan", portName: "ميناء ب" },
];

function envelope(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    metadata: {
      schemaVersion: 1,
      revision: 1,
      contentHash: "irrelevant-for-this-test",
      writtenAt: "2026-09-28T00:00:00.000Z",
    },
    data: {
      sourceMonthFolder: "5-May-2026",
      processedAt: "2026-09-28T00:00:00.000Z",
      processedBy: "tester",
      totalRows: rows.length,
      certScanRows: 2,
      nonCertScanRows: 1,
      rows,
    },
  });
}

function params(columnFilters: Record<string, string[]>): PopulationQueryParams {
  return { search: "", columnFilters, sort: null, page: 1 };
}

describe("CertScan chip ↔ Browse column filters (C2)", () => {
  it("maps each chip to a certScanStatus column filter and back", () => {
    expect(CERTSCAN_STATUS_COLUMN).toBe("certScanStatus");
    expect(withCertScanFilter({}, "certscan")).toEqual({ certScanStatus: ["Certscan"] });
    expect(withCertScanFilter({ portName: ["ميناء أ"] }, "noncertscan")).toEqual({
      portName: ["ميناء أ"],
      certScanStatus: ["NonCertscan"],
    });
    expect(withCertScanFilter({ certScanStatus: ["Certscan"], portName: ["ميناء أ"] }, "any")).toEqual({
      portName: ["ميناء أ"],
    });
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["Certscan"] })).toBe("certscan");
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["NonCertscan"] })).toBe("noncertscan");
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["Certscan", "NonCertscan"] })).toBe("any");
    expect(certScanFilterFromColumnFilters({})).toBe("any");
  });

  it("worker path: the CertScan chip returns only CertScan rows", () => {
    const loaded = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: envelope(ROWS),
    });
    const queried = handleWorkerMessage(loaded.state, {
      type: "query",
      requestId: 2,
      params: params(withCertScanFilter({}, "certscan")),
    });
    if (queried.response.type !== "result") throw new Error("expected a result response");
    expect(queried.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1", "3"]);
  });

  it("fallback path: the same chip over runPopulationQuery returns the same rows", () => {
    const result = runPopulationQuery(ROWS, params(withCertScanFilter({}, "certscan")), (row, key) =>
      String(row[key] ?? "—"),
    );
    expect(result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1", "3"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/population/certScanFilter.query.test.ts`
Expected: FAIL — `withCertScanFilter is not a function` (not exported yet).

- [ ] **Step 3: Append the Browse helpers to `certScanFilter.ts`**

Append to `src/data/population/certScanFilter.ts`:
```ts

// ── Population Browse (C2) ───────────────────────────────────────────────────
// Browse expresses the chip as an ordinary `certScanStatus` column filter, so
// it travels in PopulationQueryParams.columnFilters through BOTH the query
// worker and the main-thread fallback with no protocol change. Browse matches
// the exact stored value, so "noncertscan" selects "NonCertscan" rows — every
// processed row carries one of the two values, so this agrees with
// matchesCertScanFilter above in practice.

/** The Browse column the CertScan chip filters on. */
export const CERTSCAN_STATUS_COLUMN = "certScanStatus";

const STATUS_FOR_FILTER: Record<Exclude<CertScanFilter, "any">, string> = {
  certscan: "Certscan",
  noncertscan: "NonCertscan",
};

/** Which chip a Browse column-filter state corresponds to ("any" unless exactly one status is selected). */
export function certScanFilterFromColumnFilters(
  columnFilters: Readonly<Record<string, readonly string[]>>
): CertScanFilter {
  const selected = columnFilters[CERTSCAN_STATUS_COLUMN] ?? [];
  if (selected.length !== 1) return "any";
  if (selected[0] === STATUS_FOR_FILTER.certscan) return "certscan";
  if (selected[0] === STATUS_FOR_FILTER.noncertscan) return "noncertscan";
  return "any";
}

/** `columnFilters` with the CertScan chip applied ("any" removes the column filter). */
export function withCertScanFilter(
  columnFilters: Readonly<Record<string, string[]>>,
  filter: CertScanFilter
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...columnFilters };
  if (filter === "any") delete next[CERTSCAN_STATUS_COLUMN];
  else next[CERTSCAN_STATUS_COLUMN] = [STATUS_FOR_FILTER[filter]];
  return next;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/population/certScanFilter.query.test.ts src/workers/populationQueryWorker.test.ts src/data/population/populationQuery.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the chip into the Browse toolbar**

In `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` — Before:
```ts
import { cycleTableSort } from "../../../../utils/tableSort";
```
After:
```ts
import { cycleTableSort } from "../../../../utils/tableSort";
import CertScanFilterChips from "../../../CertScanFilterChips/CertScanFilterChips";
import { certScanFilterFromColumnFilters, withCertScanFilter } from "../../../../data/population/certScanFilter";
```
(If Task 6 already added `import { stageLabelRank } ...` directly below that line, keep it; add these two lines after it.)

Confirm the anchor is unique: `grep -c 'className="bv-row-count"' src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` → `1`. Before:
```tsx
            <span className="bv-row-count">
```
After:
```tsx
            {dataset === "population" && (
              <CertScanFilterChips
                value={certScanFilterFromColumnFilters(columnFilters)}
                onChange={(next) => {
                  setPage(1);
                  setColumnFilters((current) => withCertScanFilter(current, next));
                }}
                groupClassName="bv-certscan-filter"
                chipClassName="bv-certscan-chip"
              />
            )}
            <span className="bv-row-count">
```

Append to `src/components/Sidebar/Tabs/Population/Population.css`:
```css

/* CertScan chip group in the Browse toolbar (C2). Mirrors the toolbar's
   button skin (.bv-clear-filters-btn); the active chip takes the primary fill. */
.bv-certscan-filter {
  display: inline-flex;
  gap: var(--sp-1);
  flex: 0 0 auto;
}
.bv-certscan-chip {
  padding: var(--sp-2) var(--sp-3);
  border: 1.5px solid var(--p-border);
  border-radius: 8px;
  background: var(--c-surface);
  font-size: 12.5px;
  color: var(--p-muted);
  cursor: pointer;
}
.bv-certscan-chip.active {
  border-color: var(--p-primary);
  background: var(--p-primary);
  color: var(--c-surface);
}
```

- [ ] **Step 6: Tier 2 gates plus hex-literal and build (worker bundle)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:hex-literals && npm run build`

- [ ] **Step 7: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (population): CertScan filter chips in Population Browse"`
- **Why:** Spec C2: "a CertScan filter in Population Browse (worker + fallback path)".
- **What changed:** `withCertScanFilter` / `certScanFilterFromColumnFilters` express the chip as a `certScanStatus` column filter; the Browse toolbar shows `CertScanFilterChips` for the population dataset; worker and fallback paths are covered by one parity test; no worker protocol change.
- **Before/After:** the toolbar insertion.

- [ ] **Step 8: Commit**

```bash
npm run generate:changelog
git add src/data/population/certScanFilter.ts src/data/population/certScanFilter.query.test.ts src/components/Sidebar/Tabs/Population/BrowseDataView.tsx src/components/Sidebar/Tabs/Population/Population.css src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (population): CertScan filter chips in Population Browse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 13: C3 — `countWorkingDays` utility (Sunday–Thursday)

**Files:**
- Create: `src/utils/workingDays.ts`
- Create: `src/utils/workingDays.test.ts`

**Interfaces:**
- Produces: `WEEKEND_DAYS: ReadonlySet<number>` (= `{5, 6}`, Friday/Saturday by `Date#getDay()`); `isWorkingDay(date: Date): boolean`; `countWorkingDays(start: Date, deadline: Date): number` — local calendar days, both ends inclusive, time of day ignored, 0 when `start` is after `deadline` or either date is invalid. The single definition every C3 consumer imports.

- [ ] **Step 1: Write the failing test**

Create `src/utils/workingDays.test.ts`:

```ts
// C3: working days are Sunday–Thursday; Friday and Saturday are the weekend.
// Dates are built with the local-time constructor so the test is independent
// of the runner's time zone.
import { describe, expect, it } from "vitest";
import { WEEKEND_DAYS, countWorkingDays, isWorkingDay } from "./workingDays";

describe("countWorkingDays (C3) — Sunday–Thursday, both ends inclusive", () => {
  it("treats Friday and Saturday as the weekend", () => {
    expect([...WEEKEND_DAYS].sort()).toEqual([5, 6]);
    expect(isWorkingDay(new Date(2026, 4, 1))).toBe(false); // Fri 1 May 2026
    expect(isWorkingDay(new Date(2026, 4, 2))).toBe(false); // Sat 2 May
    expect(isWorkingDay(new Date(2026, 4, 3))).toBe(true); // Sun 3 May
    expect(isWorkingDay(new Date(2026, 4, 7))).toBe(true); // Thu 7 May
  });

  it("assigned Monday 4 May, deadline Thursday 28 May 2026 → 19 working days", () => {
    expect(countWorkingDays(new Date(2026, 4, 4), new Date(2026, 4, 28))).toBe(19);
  });

  it("a full Sunday–Saturday week has 5 working days", () => {
    expect(countWorkingDays(new Date(2026, 4, 3), new Date(2026, 4, 9))).toBe(5);
  });

  it("ignores the time of day on both ends", () => {
    expect(countWorkingDays(new Date(2026, 4, 4, 23, 59), new Date(2026, 4, 4, 0, 1))).toBe(1);
    expect(countWorkingDays(new Date(2026, 4, 4, 12), new Date(2026, 4, 28, 23, 59, 59))).toBe(19);
  });

  it("crosses a month boundary (Thu 30 Apr → Sun 3 May = 2)", () => {
    expect(countWorkingDays(new Date(2026, 3, 30), new Date(2026, 4, 3))).toBe(2);
  });

  it("is 0 for a weekend-only span or a start after the deadline", () => {
    expect(countWorkingDays(new Date(2026, 4, 29), new Date(2026, 4, 30))).toBe(0);
    expect(countWorkingDays(new Date(2026, 4, 30), new Date(2026, 4, 28))).toBe(0);
  });

  it("is 0 for an invalid date", () => {
    expect(countWorkingDays(new Date("not-a-date"), new Date(2026, 4, 28))).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/workingDays.test.ts`
Expected: FAIL — `Failed to resolve import "./workingDays"`.

- [ ] **Step 3: Implement**

Create `src/utils/workingDays.ts`:

```ts
// Working-day arithmetic for «الحصة اليومية» (C3, 2026-09-28 corrective plan).
// The weekend is Friday and Saturday; every other day (Sunday–Thursday) is a
// working day. No holiday calendar (out of scope by owner decision). All
// arithmetic is on LOCAL calendar days, matching how the quota deadline itself
// is built (`new Date(year, month - 1, lastDay - 3)` in distributionDerivation.ts).

/** `Date#getDay()` values of the weekend: Friday (5) and Saturday (6). */
export const WEEKEND_DAYS: ReadonlySet<number> = new Set([5, 6]);

export function isWorkingDay(date: Date): boolean {
  return !WEEKEND_DAYS.has(date.getDay());
}

/**
 * Working days from `start`'s calendar day through `deadline`'s calendar day,
 * BOTH inclusive; the time of day is ignored. 0 when `start` falls after
 * `deadline`, or when either date is invalid.
 */
export function countWorkingDays(start: Date, deadline: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(deadline.getTime())) return 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  let count = 0;
  while (cursor.getTime() <= end.getTime()) {
    if (isWorkingDay(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/workingDays.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Tier 2 gates**

Run: `npm run lint && npm run typecheck && npm run test:run`

- [ ] **Step 6: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Add (utils): countWorkingDays — Sunday to Thursday, Friday/Saturday weekend"`
- **Why:** The daily quota must count working days only (spec C3); one definition in `src/utils/`.
- **What changed:** new `src/utils/workingDays.ts` (`WEEKEND_DAYS`, `isWorkingDay`, `countWorkingDays`, local calendar days, inclusive) with tests.
- **Before/After:** Before: none (new file). After: `countWorkingDays`.

- [ ] **Step 7: Commit**

```bash
npm run generate:changelog
git add src/utils/workingDays.ts src/utils/workingDays.test.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Add (utils): countWorkingDays — Sunday to Thursday, Friday/Saturday weekend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 14: C3 — Quota derivation counts working days; `DERIVE_VERSION` 4 → 5

**Files:**
- Create: `src/data/distribution/dailyQuotaWorkingDays.test.ts`
- Modify: `src/data/distribution/distributionDerivation.ts` (imports 1-13; add `computeWorkingDaysForDeadline` after `computeDaysRemainingForDeadline` 80-89; `deriveEmployeeQuotasWithFacts` doc 325-347; `assignmentDaysRemaining` 394-403)
- Modify: `src/data/distribution/distributionLog.ts` (`DERIVE_VERSION` doc + value 24-40)
- Modify: `src/data/distribution/distributionTypes.ts` (`EmployeeQuota` 38-49)
- Modify: `src/data/samples/sampleMirrorStorage.ts` (`EmployeeMirrorQuota` 38-42)
- Modify (deliberate pin updates): `src/data/distribution/distributionDerivation.golden.test.ts` (576-578, 586, 593, 614, 625-629, 715, 876), `src/data/distribution/distributionLog.test.ts` (371-387), `src/data/distribution/distributionStorage.test.ts` (644)
- Modify (new regression case): `src/data/samples/sampleMirrorStorage.test.ts` (before the test at ~283)

**Interfaces:**
- Consumes (Task 13): `countWorkingDays(start: Date, deadline: Date): number`.
- Produces:
  - `computeWorkingDaysForDeadline(month: number, year: number, fromDate: Date): number` (exported from `distributionDerivation.ts`).
  - `EmployeeQuota.daysRemainingAtAssignment` now holds WORKING days from the first `assigned` event's calendar day to the deadline (the sample month's last day − 3), inclusive; `dailyQuota = ceil(sampleCount / max(1, that))`. Same field names — no shape change.
  - `DERIVE_VERSION = 5` (every cached `distribution.current.json` / fold checkpoint refolds once; mirrors are rewritten through their existing `deriveVersion` guard).
  - `computeDaysRemainingForDeadline` is unchanged (still calendar days; used by `bulkAssignment.ts` to stamp events and as the unparseable-month fallback).

- [ ] **Step 1: Write the failing test**

Create `src/data/distribution/dailyQuotaWorkingDays.test.ts`:

```ts
// C3: «الحصة اليومية» = ceil(assigned / working days), working days = Sunday–
// Thursday from the employee's first `assigned` event to the deadline (the
// sample month's last day − 3), inclusive, minimum 1. Frozen: completing work
// and the passage of time never move it; only a change in the employee's
// assigned count does. eventAt instants are 09:00Z so the local calendar day
// is the same in every time zone from UTC−9 to UTC+14.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRow } from "../reporting/reportTestFixtures";
import {
  computeWorkingDaysForDeadline,
  deriveEmployeeQuotasWithFacts,
  foldDistributionEvents,
} from "./distributionDerivation";
import type { DistributionEvent } from "./distributionTypes";

const MONTH = "5-May-2026"; // deadline: Thursday 28 May 2026
const MONDAY_4_MAY = "2026-05-04T09:00:00.000Z";

function evt(
  eventId: string,
  eventType: DistributionEvent["eventType"],
  xrayImageId: string,
  assignedTo: string,
  eventAt: string,
  extra: Partial<DistributionEvent> = {},
): DistributionEvent {
  return { eventId, eventSchemaVersion: 1, eventType, xrayImageId, assignedTo, eventAt, eventBy: "admin", ...extra };
}

function assignAll(count: number, employee: string, eventAt: string): DistributionEvent[] {
  return Array.from({ length: count }, (_, i) => evt(`a${i}`, "assigned", `img-${i}`, employee, eventAt));
}

function quotaFor(events: DistributionEvent[], employee: string) {
  const ids = [...new Set(events.map((event) => event.xrayImageId))];
  const fold = foldDistributionEvents(events, ids.map((id) => makeRow(id, "بري")), 1);
  return deriveEmployeeQuotasWithFacts(events, fold.entries, fold, MONTH).quotas?.[employee];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("daily quota over working days (C3)", () => {
  it("computeWorkingDaysForDeadline: Monday 4 May → Thursday 28 May 2026 = 19", () => {
    expect(computeWorkingDaysForDeadline(5, 2026, new Date(2026, 4, 4, 12))).toBe(19);
  });

  it("assigned on the 4th, deadline the 28th, weekends excluded → ceil(40 / 19) = 3", () => {
    expect(quotaFor(assignAll(40, "emp-a", MONDAY_4_MAY), "emp-a")).toMatchObject({
      sampleCount: 40,
      daysRemainingAtAssignment: 19,
      dailyQuota: 3,
    });
  });

  it("does not move when items are completed", () => {
    const completed = Array.from({ length: 10 }, (_, i) =>
      evt(`c${i}`, "completed", `img-${i}`, "emp-a", "2026-05-10T09:00:00.000Z"),
    );
    expect(quotaFor([...assignAll(40, "emp-a", MONDAY_4_MAY), ...completed], "emp-a")).toMatchObject({
      sampleCount: 40,
      daysRemainingAtAssignment: 19,
      dailyQuota: 3,
    });
  });

  it("does not move with the passage of time (before, near and after the deadline)", () => {
    const events = assignAll(40, "emp-a", MONDAY_4_MAY);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-05T09:00:00.000Z"));
    const early = quotaFor(events, "emp-a");
    vi.setSystemTime(new Date("2026-05-27T09:00:00.000Z"));
    const late = quotaFor(events, "emp-a");
    vi.setSystemTime(new Date("2026-06-15T09:00:00.000Z"));
    const afterDeadline = quotaFor(events, "emp-a");
    expect(early).toMatchObject({ dailyQuota: 3 });
    expect(late).toEqual(early);
    expect(afterDeadline).toEqual(early);
  });

  it("changes when the assigned count changes (10 reassigned away → ceil(30 / 19) = 2)", () => {
    const reassigned = Array.from({ length: 10 }, (_, i) =>
      evt(`r${i}`, "reassigned", `img-${i}`, "emp-a", "2026-05-06T09:00:00.000Z", { reassignedTo: "emp-b" }),
    );
    expect(quotaFor([...assignAll(40, "emp-a", MONDAY_4_MAY), ...reassigned], "emp-a")).toMatchObject({
      sampleCount: 30,
      daysRemainingAtAssignment: 19,
      dailyQuota: 2,
    });
  });

  it("first assignment after the deadline → floor of one working day (whole assignment per day)", () => {
    expect(quotaFor(assignAll(5, "emp-a", "2026-05-29T09:00:00.000Z"), "emp-a")).toMatchObject({
      daysRemainingAtAssignment: 0,
      dailyQuota: 5,
    });
  });

  it("first assignment on the deadline day itself → exactly one working day", () => {
    expect(quotaFor(assignAll(5, "emp-a", "2026-05-28T09:00:00.000Z"), "emp-a")).toMatchObject({
      daysRemainingAtAssignment: 1,
      dailyQuota: 5,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/distribution/dailyQuotaWorkingDays.test.ts`
Expected: FAIL — `computeWorkingDaysForDeadline is not a function`; the quota cases report calendar days (25 for 4 May, `dailyQuota: 2`).

- [ ] **Step 3: Implement in `distributionDerivation.ts`**

Before:
```ts
import { logError } from "../storage/errorLogger";
```
After:
```ts
import { logError } from "../storage/errorLogger";
import { countWorkingDays } from "../../utils/workingDays";
```

Before:
```ts
export function computeDaysRemainingForDeadline(
  month: number,
  year: number,
  fromDate = new Date()
): number {
  const lastDay = new Date(year, month, 0).getDate();
  const deadline = new Date(year, month - 1, lastDay - 3, 23, 59, 59);
  return Math.max(0, Math.ceil((deadline.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
}
```
After:
```ts
export function computeDaysRemainingForDeadline(
  month: number,
  year: number,
  fromDate = new Date()
): number {
  const lastDay = new Date(year, month, 0).getDate();
  const deadline = new Date(year, month - 1, lastDay - 3, 23, 59, 59);
  return Math.max(0, Math.ceil((deadline.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * C3: WORKING days (Sunday–Thursday; Friday/Saturday excluded) from
 * `fromDate`'s calendar day through the quota deadline — the sample month's
 * last day − 3 — both inclusive, local time. 0 when `fromDate` is after the
 * deadline. This, not the calendar count above, is what the daily quota uses
 * since DERIVE_VERSION 5; the calendar count stays for bulk-assignment event
 * stamps.
 */
export function computeWorkingDaysForDeadline(month: number, year: number, fromDate: Date): number {
  const lastDay = new Date(year, month, 0).getDate();
  const deadline = new Date(year, month - 1, lastDay - 3);
  return countWorkingDays(fromDate, deadline);
}
```

Before (last paragraph of `deriveEmployeeQuotasWithFacts`'s doc comment):
```ts
 * Known, pre-existing gap left unchanged: an employee who only ever received
 * rows by reassignment has no `assigned` event, hence no assignment window,
 * hence no quota row — they own entries but appear in neither `firstAssignments`
 * nor `quotas`.
 */
```
After:
```ts
 * Known, pre-existing gap left unchanged: an employee who only ever received
 * rows by reassignment has no `assigned` event, hence no assignment window,
 * hence no quota row — they own entries but appear in neither `firstAssignments`
 * nor `quotas`.
 *
 * C3 (DERIVE_VERSION 5): the window is counted in WORKING days (Sunday–
 * Thursday) from the first assignment's calendar day to the deadline,
 * inclusive, floored at 1 in the division. Nothing here reads `now`, so the
 * value is frozen: completion and the passage of time never move it; only a
 * change in the employee's live assigned count (`sampleCount`) does.
 */
```

Before:
```ts
  const firstAssignedAt = new Date(firstAssignment.eventAt);
  return monthInfo && !Number.isNaN(firstAssignedAt.getTime())
    ? computeDaysRemainingForDeadline(monthInfo.month, monthInfo.year, firstAssignedAt)
    : storedQuota?.daysRemainingAtAssignment;
```
After:
```ts
  const firstAssignedAt = new Date(firstAssignment.eventAt);
  return monthInfo && !Number.isNaN(firstAssignedAt.getTime())
    ? computeWorkingDaysForDeadline(monthInfo.month, monthInfo.year, firstAssignedAt)
    : storedQuota?.daysRemainingAtAssignment;
```

- [ ] **Step 4: Bump `DERIVE_VERSION` and document the field meaning**

`src/data/distribution/distributionLog.ts` — Before:
```ts
 *   is being reinterpreted, only re-validated.
 */
export const DERIVE_VERSION = 4;
```
After:
```ts
 *   is being reinterpreted, only re-validated.
 * - v5: (C3, 2026-09-28) `quotas[].daysRemainingAtAssignment` counts WORKING
 *   days (Sunday–Thursday) from the employee's first assignment through the
 *   deadline, inclusive, instead of calendar days, and `dailyQuota` follows
 *   from it. Persisted derived output changes, so every v4 snapshot and
 *   checkpoint refolds once, and employee mirrors pick the new quota up
 *   through their deriveVersion guard. Folded ENTRIES are unchanged.
 */
export const DERIVE_VERSION = 5;
```

`src/data/distribution/distributionTypes.ts` — Before (inside `EmployeeQuota`):
```ts
  sampleCount: number;
  dailyQuota: number;
  daysRemainingAtAssignment: number;
  assignedAt: string;
};
```
After:
```ts
  sampleCount: number;
  /** ceil(sampleCount / max(1, daysRemainingAtAssignment)) — frozen; moves only when sampleCount does (C3). */
  dailyQuota: number;
  /**
   * WORKING days (Sunday–Thursday; Friday/Saturday excluded) from the first
   * `assigned` event's calendar day through the deadline (the sample month's
   * last day − 3), both inclusive — since DERIVE_VERSION 5 (C3); calendar
   * days before that. Name kept: no persisted shape change.
   */
  daysRemainingAtAssignment: number;
  assignedAt: string;
};
```

`src/data/samples/sampleMirrorStorage.ts` — Before:
```ts
export type EmployeeMirrorQuota = {
  dailyQuota: number;
  daysRemainingAtAssignment: number;
  sampleCount: number;
};
```
After:
```ts
export type EmployeeMirrorQuota = {
  dailyQuota: number;
  /** Working days (Sun–Thu) in the assignment window since DERIVE_VERSION 5
   *  (C3) — copied verbatim from the derived quota, never recomputed here. */
  daysRemainingAtAssignment: number;
  sampleCount: number;
};
```
(The mirror writer at `sampleMirrorStorage.ts:427-437` needs no logic change: it copies `current.quotas[username]` verbatim, and its same-revision/newer-`deriveVersion` rule is what carries v5 to every employee — pinned in Step 6.)

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx vitest run src/data/distribution/dailyQuotaWorkingDays.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Update the calendar-day pins and add the mirror regression case**

Run first: `npx vitest run src/data/distribution/distributionDerivation.golden.test.ts src/data/distribution/distributionLog.test.ts src/data/distribution/distributionStorage.test.ts`
Expected: FAIL exactly in the assertions below.

`src/data/distribution/distributionDerivation.golden.test.ts`:
```bash
sed -i 's/daysRemainingAtAssignment: 28,/daysRemainingAtAssignment: 20,/g; s/daysRemainingAtAssignment: 9,/daysRemainingAtAssignment: 7,/g' src/data/distribution/distributionDerivation.golden.test.ts
grep -c "daysRemainingAtAssignment: 20," src/data/distribution/distributionDerivation.golden.test.ts   # expect 2
grep -c "daysRemainingAtAssignment: 7," src/data/distribution/distributionDerivation.golden.test.ts    # expect 3
```
Then fix the comments that state the old arithmetic. Before:
```ts
    // Deadline for May 2026 = 28 May 23:59:59 (3 days before month end).
    // emp-a first assigned 1 May 00:00Z → ceil(27d 23:59:59) = 28 days.
    // emp-b first assigned 20 May 00:00Z → ceil(8d 23:59:59)  = 9 days.
```
After:
```ts
    // Deadline for May 2026 = Thursday 28 May (3 days before month end).
    // CHANGED (C3, DERIVE_VERSION 5): WORKING days only — Sunday–Thursday,
    // both ends inclusive, local calendar day (UTC here; KSA's UTC+3 keeps the
    // same calendar day for these 00:00Z instants).
    // emp-a first assigned Fri 1 May → Sun 3 … Thu 28 May = 20 working days.
    // emp-b first assigned Wed 20 May → 20, 21, 24, 25, 26, 27, 28 = 7.
```
Before:
```ts
    // ceil(57 / 28) === 3
```
After:
```ts
    // ceil(57 / 20) === 3 (20 working days, C3)
```
Before:
```ts
    // The 20 May event wins purely because it appears first in the array, so
    // the employee's whole quota is computed off the SHORTER window: 9 days
    // rather than 28. ceil(2/9) === 1 here, but the effect scales.
```
After:
```ts
    // The 20 May event wins purely because it appears first in the array, so
    // the employee's whole quota is computed off the SHORTER window: 7 working
    // days rather than 20. ceil(2/7) === 1 here, but the effect scales.
```

`src/data/distribution/distributionLog.test.ts` — Before:
```ts
test("daily quota is derived from assignment date through three days before month end", () => {
```
After:
```ts
test("daily quota is derived from assignment date through three days before month end, over working days (C3)", () => {
```
Before:
```ts
  expect(result.quotas?.emp1?.daysRemainingAtAssignment).toBe(27);
  expect(result.quotas?.emp1?.dailyQuota).toBe(38);
```
After:
```ts
  // C3 (DERIVE_VERSION 5): working days only. Monday 1 June → Saturday 27 June
  // 2026 (June's last day − 3), Friday/Saturday excluded = 19; ceil(1000 / 19)
  // = 53. computeDaysRemainingForDeadline above still reports CALENDAR days —
  // it stamps bulk-assignment events and is no longer what the quota uses.
  expect(result.quotas?.emp1?.daysRemainingAtAssignment).toBe(19);
  expect(result.quotas?.emp1?.dailyQuota).toBe(53);
```

`src/data/distribution/distributionStorage.test.ts` — Before:
```ts
    expect(DERIVE_VERSION).toBe(4);
```
After:
```ts
    expect(DERIVE_VERSION).toBe(5);
```

`src/data/samples/sampleMirrorStorage.test.ts` — insert immediately before `  it("a legacy mirror with NO deriveVersion is rewritten exactly once", async () => {`:
```ts
  it("C3: a v4 (calendar-day) mirror at the SAME revision is rewritten with the v5 (working-day) quota", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 4, [makeMirrorEntry("A1", "pending")], 9));
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 5, [makeMirrorEntry("A1", "pending")], 4));

    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.deriveVersion).toBe(5);
    expect(mirror?.quota?.dailyQuota).toBe(4);
    expect(mirror?.sourceLogRevision).toBe(5);
  });

```

Re-run: `npx vitest run src/data/distribution src/data/samples`
Expected: PASS. Any failure other than a calendar-vs-working-day quota value is a regression — stop and report.

- [ ] **Step 7: Tier 3 gates (derived on-disk values change; cache version bump)**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity && npm run check:hex-literals && npm run check:release && npm run check:vendor && npm run build && npm run check:bundle-size`
(Run `check:release` again after Step 8's `--sync-package`.)

- [ ] **Step 8: Edit log (tier 3)**

Run: `npm run editlog -- --tier=3 --append --sync-package "Fix (distribution): daily quota counts working days (Sun-Thu); DERIVE_VERSION 5"`
- **Why:** «الحصة اليومية» counted calendar days (`distributionDerivation.ts:363-369` via `computeDaysRemainingForDeadline`), so Fridays/Saturdays inflated the window and the per-day figure was too low (spec C3). Verified: the value was already frozen against completion and time (window from the first `assigned` event, count from live entries); rejected: recomputing from `now` (the spec's owner rule freezes it) and a new persisted field (reusing `daysRemainingAtAssignment` keeps every file's shape).
- **What changed:** `computeWorkingDaysForDeadline` (Sun–Thu, inclusive, via `countWorkingDays`) feeds `deriveEmployeeQuotasWithFacts`; `DERIVE_VERSION` 4→5; field docs on `EmployeeQuota` / `EmployeeMirrorQuota`; golden pins moved to working-day values.
- **Migration/rollback:** No shape change. On first load each month's cached `distribution.current.json` / checkpoint (v4) refolds once; employee mirrors at the same log revision are rewritten via the existing `deriveVersion` guard. Rollback = revert; a v4 build treats v5 caches as foreign-version and refolds them back to calendar days.
- **Before/After:** the `assignmentDaysRemaining` return expression.

- [ ] **Step 9: Commit**

```bash
npm run generate:changelog
git add src/data/distribution src/data/samples src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (distribution): daily quota counts working days (Sun-Thu); DERIVE_VERSION 5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 15: C3 — «الحصة اليومية» tile strings move to label keys

**Files:**
- Create: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/quotaTile.test.tsx`
- Modify: `src/data/labels/labelsStore.ts` (after `ew_queue_stats_employee_scope`, ~357)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` (`ReferralStatsStrip` 778-793)
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (line 166 — the `PersonalQuota` type, OUTSIDE the component; no budget impact)

**Interfaces:**
- Consumes (Task 14): `PersonalQuota.daysRemaining` now carries working days.
- Produces label keys: `ew_quota_tile_label`, `ew_quota_tile_label_mine`, `ew_quota_tile_title` (placeholders `{daily}`, `{total}`, `{days}`), `ew_quota_tile_title_none`. `ReferralStatsStrip` renders them; its props are unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/quotaTile.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// C3: the «الحصة اليومية» tile shows the frozen quota; its strings are label
// keys (admin-overridable in Settings), and its title names the working-day
// window instead of "الأيام المتبقية".
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetLabel, setLabel } from "../../../../../../data/labels/labelsStore";
import type { PersonalStats } from "../XrayReferrals";
import { ReferralStatsStrip } from "./subComponents";

const STATS: PersonalStats = {
  assigned: 40,
  submitted: 10,
  onHold: 0,
  notStarted: 30,
  replaced: 0,
  active: 40,
  completionPct: 25,
};
const QUOTA = { dailyQuota: 3, daysRemaining: 19, sampleCount: 40 };

afterEach(() => {
  cleanup();
  resetLabel("ew_quota_tile_label");
});

describe("«الحصة اليومية» tile (C3)", () => {
  it("shows the daily quota under its label, with the working-day window in the title", () => {
    const { container } = render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="emp-1" />);
    expect(screen.getByText("الحصة اليومية")).toBeInTheDocument();
    expect(container.querySelector(".ew-ref-stats-title")?.getAttribute("title")).toBe(
      "الحصة اليومية: 3 صورة / يوم · الحصة: 40 · أيام العمل (الأحد–الخميس): 19",
    );
  });

  it("labels the quota as the reader's own under a foreign scope", () => {
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="sup-1" scope="all" />);
    expect(screen.getByText("الحصة اليومية (لي)")).toBeInTheDocument();
  });

  it("uses the no-quota label when there is no quota", () => {
    const { container } = render(<ReferralStatsStrip stats={STATS} quota={null} username="emp-1" />);
    expect(container.querySelector(".ew-ref-stats-title")?.getAttribute("title")).toBe(
      "لا توجد حصة محفوظة لهذا الشهر",
    );
  });

  it("reads the tile label from the labels store (admin-overridable)", () => {
    setLabel("ew_quota_tile_label", "حصتي اليومية");
    render(<ReferralStatsStrip stats={STATS} quota={QUOTA} username="emp-1" />);
    expect(screen.getByText("حصتي اليومية")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/quotaTile.test.tsx`
Expected: FAIL — the tile still reads «حصة اليوم» and its title says «الأيام المتبقية»; `setLabel("ew_quota_tile_label", …)` has no effect.

- [ ] **Step 3: Label keys**

In `src/data/labels/labelsStore.ts` — Before:
```ts
  ew_queue_stats_employee_scope:   "نطاق العرض: {name}",
```
After:
```ts
  ew_queue_stats_employee_scope:   "نطاق العرض: {name}",

  // «الحصة اليومية» tile in the stats strip (C3). The quota is frozen: working
  // days (Sunday–Thursday) from the employee's first assignment to the
  // deadline (the sample month's last day − 3); it moves only when their
  // assigned count changes. {daily}/{total}/{days} are filled at the call site.
  ew_quota_tile_label:             "الحصة اليومية",
  ew_quota_tile_label_mine:        "الحصة اليومية (لي)",
  ew_quota_tile_title:             "الحصة اليومية: {daily} صورة / يوم · الحصة: {total} · أيام العمل (الأحد–الخميس): {days}",
  ew_quota_tile_title_none:        "لا توجد حصة محفوظة لهذا الشهر",
```

- [ ] **Step 4: Use them in `ReferralStatsStrip`**

In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx` — Before:
```tsx
    {
      label: isForeignScope ? "حصة اليوم (لي)" : "حصة اليوم",
      value: quota ? quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn") : "—",
      tone: "quota",
    },
```
After:
```tsx
    {
      label: isForeignScope ? L.ew_quota_tile_label_mine : L.ew_quota_tile_label,
      value: quota ? quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn") : "—",
      tone: "quota",
    },
```
Before:
```tsx
  const quotaTitle = quota
    ? `الحصة اليومية: ${quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn")} صورة / يوم · الحصة: ${quota.sampleCount.toLocaleString("ar-SA-u-nu-latn")} · الأيام المتبقية: ${quota.daysRemaining.toLocaleString("ar-SA-u-nu-latn")}`
    : "لا توجد حصة محفوظة لهذا الشهر";
```
After:
```tsx
  // C3: `daysRemaining` is the frozen working-day window (Sun–Thu), not a
  // countdown — hence «أيام العمل», not «الأيام المتبقية».
  const quotaTitle = quota
    ? L.ew_quota_tile_title
        .replace("{daily}", quota.dailyQuota.toLocaleString("ar-SA-u-nu-latn"))
        .replace("{total}", quota.sampleCount.toLocaleString("ar-SA-u-nu-latn"))
        .replace("{days}", quota.daysRemaining.toLocaleString("ar-SA-u-nu-latn"))
    : L.ew_quota_tile_title_none;
```
(`const L = useLabels();` is already declared above `statsItems` in this component.)

In `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (module scope, outside the component) — Before:
```ts
export type PersonalQuota = { dailyQuota: number; daysRemaining: number; sampleCount: number } | null;
```
After:
```ts
/** `daysRemaining` is the assignment window in WORKING days (Sun–Thu) since
 *  DERIVE_VERSION 5 (C3) — `EmployeeQuota.daysRemainingAtAssignment`. */
export type PersonalQuota = { dailyQuota: number; daysRemaining: number; sampleCount: number } | null;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/quotaTile.test.tsx src/components/Sidebar/Tabs/Settings/index.test.tsx`
Expected: PASS (the Settings reachability test picks the new keys up through its "أخرى" fallback group).
Then run: `grep -rn "حصة اليوم\|الأيام المتبقية" src --include=*.test.tsx --include=*.test.ts` — Expected: no match (no other test pinned the old strings); if one exists, update it to the new label text.

- [ ] **Step 6: Tier 2 gates plus complexity**

Run: `npm run lint && npm run typecheck && npm run test:run && npm run check:complexity`

- [ ] **Step 7: Edit log (tier 2)**

Run: `npm run editlog -- --tier=2 --append --sync-package "Fix (employee-workspace): daily quota tile strings as label keys, working-day wording"`
- **Why:** The tile's strings were hard-coded Arabic (`subComponents.tsx:778-793`) and its title called the frozen window «الأيام المتبقية», which reads as a countdown (spec C3).
- **What changed:** four `ew_quota_tile_*` label keys; the tile reads «الحصة اليومية» and its title «أيام العمل (الأحد–الخميس)»; `PersonalQuota` documented.
- **Before/After:** the `quotaTitle` expression.

- [ ] **Step 8: Commit**

```bash
npm run generate:changelog
git add src/components/Sidebar/Tabs/EmployeeWorkspace src/data/labels/labelsStore.ts src/data/changelog/latestUpdates.generated.ts "docs/edit logs" package.json
git commit -m "$(cat <<'MSG'
Fix (employee-workspace): daily quota tile strings as label keys, working-day wording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
MSG
)"
```

---

## Task 16: Final gate sweep for Workstream C

**Files:**
- No production changes expected. If a gate fails, fix the cause in the file the failure names (following the owning task's constraints) and record it in an extra tier-2 edit-log entry.

**Interfaces:**
- Consumes: everything from Tasks 1–15.
- Produces: a branch whose every CI gate is green and whose `dist/index.html` builds.

- [ ] **Step 1: Confirm the tree and history**

Run: `git status --short && git log --oneline -16`
Expected: clean tree; the 15 task commits on `claude/beautiful-einstein-y1ouot`.

- [ ] **Step 2: Run the full gate sequence, in order, stopping at the first failure**

```bash
npm run lint
npm run lint:ci
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
```
Expected: every command exits 0. `test:run` reports 0 failed and no "snapshots obsolete/written"; `check:release` agrees with the newest edit-log version; `check:bundle-size` stays under its ceiling (compare raw/gzip with the pre-workstream `dist/index.html` if the owner asks — this workstream adds only small modules).

- [ ] **Step 3: Scope audit (spec coverage)**

Run and read the output:
```bash
grep -rn "STAGE_LABELS_AR\s*[:=]\s*{" src --include=*.ts --include=*.tsx
grep -rn "certScanPorts" src --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn "computeWorkingDaysForDeadline\|countWorkingDays" src --include=*.ts | grep -v "\.test\."
grep -n "SAMPLING_ALGORITHM_VERSION" src/data/sampling/sampleTypes.ts
git diff 0780a9a -- src/data/sampling/sampleTypes.ts src/data/sampling/sampleAlgorithm.ts
```
Expected: `STAGE_LABELS_AR = {` defined only in `src/data/population/stageLabels.ts`; `certScanPorts` in `populationConfig.ts`, `populationProcessingTypes.ts`, `populationProcessor.ts`, `Population/index.tsx`, `MappingSettingsModal.tsx`; `countWorkingDays` defined once in `src/utils/workingDays.ts` and used by `distributionDerivation.ts`; `SAMPLING_ALGORITHM_VERSION` unchanged and `git diff` of the two sampling files empty.

- [ ] **Step 4: Report**

Do not push unless the controller instructs. Report: gate outputs (pass/fail per command), the final `package.json` version, and any fix commit made in this task. If the controller asks for a PR, `npm run build` has already passed in Step 2 (required before pushing, per CLAUDE.md), and the PR description ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NU4UP8LM3qkAnTNccmKZEJ
```

---
