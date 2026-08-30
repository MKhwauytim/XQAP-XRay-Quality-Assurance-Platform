# تقرير المجتمع — Merged Population Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reports tab's `تقرير العينة` (Sample) and `تقرير التوزيع` (Distribution) cards with one new report, `تقرير المجتمع` (Population Report) — doc + deck + xlsx editions — telling one story: population received → processed into a sample → distributed to employees with results.

**Architecture:** A new `src/data/reporting/populationReport/` module (types → pure fold helpers → model → deck → document → xlsx → public index), built on the existing `executive/deck3` slide-kit for its deck edition and a **new** `executive/documentV3` chrome module (same design tokens, adapted to flowing A4 pages) for its document edition. Before deletion, `distributionReport.ts`'s `computeDistributionModel`/`DistributionBucket` — which the Executive report's model, deck2 coverage slide, document Part 6, and workbook export all depend on — are relocated to a standalone module so removing the old report builder doesn't break Executive reporting.

**Tech Stack:** TypeScript (strict), Vitest (`toMatchSnapshot` goldens + `vi.useFakeTimers`), SheetJS (`xlsx`, vendored), no framework — every builder returns/writes plain HTML or `.xlsx` strings/files.

**Spec:** `docs/superpowers/specs/2026-08-27-population-report-merge-design.md` — read it alongside this plan; the plan does not restate every rationale from §1–§3 and §7's decisions (D1–D10), only how to execute them.

## Global Constraints

- UI text is Arabic; RTL. Every user-facing string in new code must be Arabic (label keys preferred over hard-coded strings only when the string is meant to be admin-overridable — this report's fixed structural labels, e.g. column headers, following existing report-builder precedent, are hard-coded like `sampleReport.ts`'s `STAGE_LABELS` are).
- سليمة/اشتباه classification is **image-grain, OR-combined** (`xrayLevelOneResult === "اشتباه" || xrayLevelTwoResult === "اشتباه"`) — never the 4-way reviewer-accuracy split. This is the **only** classification this report uses (spec §4.3, D5).
- Land/sea split rule: `(portType ?? "").includes("بحري")` → sea; everything else → land (spec §4.4, D6). No enum — follow the existing convention verbatim.
- Workflow status (pending/completed/replacement-requested/replaced) must **never** appear anywhere in this report (spec D4).
- No border-radius, no box-shadows in anything touching the deck3/documentV3 visual language (deck3's own hard rule, `theme.ts` header comment) — a new "v3 document chrome" inherits this.
- Sampling, distribution folding, and report/export builders are deterministic by contract (CLAUDE.md) — write golden snapshots once content is finalized in this plan, never re-snapshot silently after.
- Every workspace read goes through the existing typed loaders (`loadMonthForEditing`, etc.) — never call `getFileHandle`/`createWritable` directly, never hand-roll a new path string (`workspacePaths.ts` is the source of truth, already respected by every loader this plan reuses).
- Node **>=22 <23**. Tier 3 CLAUDE.md gates (this is a Tier 3 change — new data format edition, architecture-level report retirement) apply before claiming done: `lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`, plus an `npm run editlog --tier=3` entry.
- `npm run build` is mandatory before pushing, at every task, not just at the end — a broken build is cheaper to catch locally in 13 seconds than in CI.

---

## File Map (created/modified/deleted across this plan)

**New:**
- `src/data/population/imageResult.ts`
- `src/data/reporting/executive/model/distributionCoverageModel.ts` (+ `.test.ts`)
- `src/data/reporting/executive/documentV3/theme.ts`
- `src/data/reporting/executive/documentV3/shared.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/types.ts`
- `src/data/reporting/populationReport/fold.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/model.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/deck.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/document.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/xlsx.ts` (+ `.test.ts`)
- `src/data/reporting/populationReport/openFailure.test.ts`
- `src/data/reporting/populationReport/index.ts`

**Modified:**
- `src/data/reporting/executiveReportData.ts` (use shared `classifyImageResult`)
- `src/data/reporting/executive/model/decisionFactTable.ts` (use shared `classifyImageResult`)
- `src/data/reporting/executive/model/reportModel.ts` (import path)
- `src/data/reporting/executive/deck2/section4/coverage.ts` (import path)
- `src/data/reporting/executive/document/partCoverageAccountability.ts` (import path)
- `src/data/reporting/executive/workbook/workbook.ts` (import path)
- `src/components/Sidebar/Tabs/Reports/TabView.tsx` (new card, new `generate()` branch, remove old cards/branches)
- `src/data/reporting/reportBuilders.xss.test.ts` (swap sample/distribution blocks for population-report blocks)
- `src/data/reporting/sourceRevisions.test.ts` (repoint from `buildSampleDocument`/`buildSampleDeck`)

**Deleted (Task 12, after everything above lands):**
- `src/data/reporting/sampleReport.ts`, `sampleReport.test.ts`, `sampleReport.openFailure.test.ts`, `__snapshots__/sampleReport.test.ts.snap`
- `src/data/reporting/distributionReport.ts`, `distributionReport.test.ts`, `distributionReport.openFailure.test.ts`, `__snapshots__/distributionReport.test.ts.snap`

---

### Task 1: Extract shared `imageResult` classifier

**Files:**
- Create: `src/data/population/imageResult.ts`
- Create: `src/data/population/imageResult.test.ts`
- Modify: `src/data/reporting/executiveReportData.ts` (~line 129)
- Modify: `src/data/reporting/executive/model/decisionFactTable.ts` (~lines 245–259)

**Interfaces:**
- Produces: `export type ImageResult = "سليمة" | "اشتباه"` and `export function classifyImageResult(a: string | null | undefined, b: string | null | undefined): ImageResult` — every later task in this plan that classifies a row imports this.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/population/imageResult.test.ts
import { describe, it, expect } from "vitest";
import { classifyImageResult } from "./imageResult";

describe("classifyImageResult", () => {
  it("returns اشتباه when either level is اشتباه", () => {
    expect(classifyImageResult("اشتباه", "سليمة")).toBe("اشتباه");
    expect(classifyImageResult("سليمة", "اشتباه")).toBe("اشتباه");
    expect(classifyImageResult("اشتباه", "اشتباه")).toBe("اشتباه");
  });

  it("returns سليمة when both levels are سليمة", () => {
    expect(classifyImageResult("سليمة", "سليمة")).toBe("سليمة");
  });

  it("treats null/undefined as سليمة (not اشتباه) for that level", () => {
    expect(classifyImageResult(null, "سليمة")).toBe("سليمة");
    expect(classifyImageResult(undefined, undefined)).toBe("سليمة");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/population/imageResult.test.ts`
Expected: FAIL — `Cannot find module './imageResult'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/data/population/imageResult.ts
/**
 * The image-result grain used by every report that answers "what did we
 * find" rather than "was screening right" (that's `classifyOutcome`'s
 * reviewer-accuracy 4-way split — a different question, deliberately not
 * this one). Shared so the OR-rule can't drift between call sites; mirrors
 * `riskEngineVerdict.ts`'s precedent for a small, pure, population-layer
 * classifier with no UI or I/O dependency.
 */
export type ImageResult = "سليمة" | "اشتباه";

export function classifyImageResult(
  levelOneResult: string | null | undefined,
  levelTwoResult: string | null | undefined
): ImageResult {
  return levelOneResult === "اشتباه" || levelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/population/imageResult.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Update `executiveReportData.ts` to use the shared classifier**

In `src/data/reporting/executiveReportData.ts`, inside `buildExecutiveReportRows` (~line 88 onward), replace:

```ts
const imageResult: "سليمة" | "اشتباه" =
  levelOneResult === "اشتباه" || levelTwoResult === "اشتباه" ? "اشتباه" : "سليمة";
```

with:

```ts
const imageResult = classifyImageResult(levelOneResult, levelTwoResult);
```

Add the import near the top of the file:

```ts
import { classifyImageResult } from "../population/imageResult";
```

- [ ] **Step 6: Update `decisionFactTable.ts` to use the shared classifier**

In `src/data/reporting/executive/model/decisionFactTable.ts`, inside the private `collapseToImageRecords` function (~lines 245–259), replace:

```ts
const employeeDecision: ResultValue =
  l1?.employeeDecision === "اشتباه" || l2?.employeeDecision === "اشتباه" ? "اشتباه" : "سليمة";
```

with:

```ts
const employeeDecision: ResultValue = classifyImageResult(l1?.employeeDecision, l2?.employeeDecision);
```

Add the import:

```ts
import { classifyImageResult } from "../../../population/imageResult";
```

(Verify the relative path — `decisionFactTable.ts` lives at `src/data/reporting/executive/model/`, three levels below `src/data/`, so `../../../population/imageResult` resolves to `src/data/population/imageResult`.)

- [ ] **Step 7: Run the full existing test suites for both touched files to confirm no regression**

Run: `npx vitest run src/data/reporting/executiveReportData.test.ts src/data/reporting/executive/model/decisionFactTable.test.ts`
Expected: PASS, unchanged pass count from before this change (this is a pure refactor — same logic, new call site).

- [ ] **Step 8: Commit**

```bash
git add src/data/population/imageResult.ts src/data/population/imageResult.test.ts \
  src/data/reporting/executiveReportData.ts src/data/reporting/executive/model/decisionFactTable.ts
git commit -m "Refactor (reporting): extract shared classifyImageResult OR-rule"
```

---

### Task 2: Relocate `computeDistributionModel` / `DistributionBucket` out of `distributionReport.ts`

**Why this task exists:** `distributionReport.ts` is being retired (Task 12), but `computeDistributionModel` (function) and `DistributionBucket` (type) are load-bearing dependencies of the **Executive** report family — `reportModel.ts`, `deck2/section4/coverage.ts`, `document/partCoverageAccountability.ts`, and `workbook/workbook.ts` all import from `distributionReport.ts` today. They must move to a home that survives the old file's deletion *before* Task 12 deletes it.

**Files:**
- Create: `src/data/reporting/executive/model/distributionCoverageModel.ts`
- Create: `src/data/reporting/executive/model/distributionCoverageModel.test.ts`
- Modify: `src/data/reporting/distributionReport.ts` (delete the moved code, import it back)
- Modify: `src/data/reporting/executive/model/reportModel.ts` (import path)
- Modify: `src/data/reporting/executive/deck2/section4/coverage.ts` (import path)
- Modify: `src/data/reporting/executive/document/partCoverageAccountability.ts` (import path)
- Modify: `src/data/reporting/executive/workbook/workbook.ts` (import path)
- Modify: `src/data/reporting/distributionReport.test.ts` (remove the `describe("computeDistributionModel")` block — it moves to the new test file)

**Interfaces:**
- Produces: `export type DistributionBucket`, `export type DistributionModel`, `export function computeDistributionModel(data: DistributionCurrentData, monthFolderName: string, employeeDisplayNames?: Record<string, string>): DistributionModel` from `src/data/reporting/executive/model/distributionCoverageModel.ts`.

- [ ] **Step 1: Read the exact code being moved**

Read `src/data/reporting/distributionReport.ts` lines 1–196 to copy verbatim: the imports it needs (`DistributionCurrentData` type, any others used only by this block), `STATUS_LABELS`, `statusLabel()`, `ratePct()`, the private `EmployeeStat`/`BucketEmployeeStat` types, `export type DistributionBucket`, `export type DistributionModel`, `groupEntries()`, and `export function computeDistributionModel(...)`.

- [ ] **Step 2: Write the failing test (moved verbatim from `distributionReport.test.ts`)**

Open `src/data/reporting/distributionReport.test.ts`, find the `describe("computeDistributionModel", ...)` block (per-employee aggregation, highlights, byStage/byPort bucket grouping — R2). Copy that whole block into a new file:

```ts
// src/data/reporting/executive/model/distributionCoverageModel.test.ts
import { describe, it, expect } from "vitest";
import { computeDistributionModel } from "./distributionCoverageModel";
import { makeDistribution } from "../../reportTestFixtures";

// (paste the computeDistributionModel describe block's contents here verbatim,
//  updating only the import path for makeDistribution/makeRow-style fixtures
//  to "../../reportTestFixtures" — three levels up from
//  src/data/reporting/executive/model/ to src/data/reporting/.)
```

- [ ] **Step 3: Run the new test file to verify it fails**

Run: `npx vitest run src/data/reporting/executive/model/distributionCoverageModel.test.ts`
Expected: FAIL — `Cannot find module './distributionCoverageModel'`

- [ ] **Step 4: Create the new module with the moved code**

```ts
// src/data/reporting/executive/model/distributionCoverageModel.ts
// Relocated from distributionReport.ts (2026-08-27): computeDistributionModel
// and DistributionBucket are consumed by the Executive report family
// (reportModel.ts, deck2's coverage slide, the document's Part 6, and the
// workbook export) independently of the standalone "تقرير التوزيع"
// document/deck/xlsx builder, which is being retired. This module is their
// shared home so retiring that builder doesn't break Executive reporting.
import type { DistributionCurrentData, DistributionStatus } from "../../../distribution/distributionTypes";

// [paste STATUS_LABELS, statusLabel(), ratePct(), EmployeeStat, BucketEmployeeStat,
//  DistributionBucket, DistributionModel, groupEntries(), computeDistributionModel()
//  verbatim from distributionReport.ts lines ~34-196, adjusting the relative
//  import path for DistributionCurrentData/DistributionStatus from
//  "../distribution/distributionTypes" (old file, one level under src/data/reporting/)
//  to "../../../distribution/distributionTypes" (new file, three levels under
//  src/data/reporting/executive/model/).]
```

- [ ] **Step 5: Run the new test file to verify it passes**

Run: `npx vitest run src/data/reporting/executive/model/distributionCoverageModel.test.ts`
Expected: PASS, same test count as the moved-from block in `distributionReport.test.ts`.

- [ ] **Step 6: Remove the moved code from `distributionReport.ts`, import it back**

Delete lines ~34–196 from `distributionReport.ts` (everything moved in Step 4) and its now-unused `DistributionCurrentData`/`DistributionStatus` type imports if `distributionReport.ts` no longer references them directly (it likely still does, for its own doc/deck/xlsx builders — keep whichever imports are still used). Add:

```ts
import {
  computeDistributionModel,
  type DistributionBucket,
  type DistributionModel,
} from "./executive/model/distributionCoverageModel";
```

- [ ] **Step 7: Remove the moved `describe("computeDistributionModel")` block from `distributionReport.test.ts`**

Delete it — its coverage now lives in `distributionCoverageModel.test.ts`. Leave the rest of `distributionReport.test.ts` (renderer smoke tests, golden snapshots, xlsx chunking tests) untouched for now — this file is deleted wholesale in Task 12, not before.

- [ ] **Step 8: Update the four Executive-family import sites**

In `src/data/reporting/executive/model/reportModel.ts` (~lines 27–28), replace:

```ts
import { computeDistributionModel } from "../../distributionReport";
import type { DistributionBucket } from "../../distributionReport";
```

with:

```ts
import { computeDistributionModel, type DistributionBucket } from "./distributionCoverageModel";
```

In `src/data/reporting/executive/deck2/section4/coverage.ts` (~line 37), replace:

```ts
import type { DistributionBucket } from "../../../distributionReport";
```

with:

```ts
import type { DistributionBucket } from "../../model/distributionCoverageModel";
```

In `src/data/reporting/executive/document/partCoverageAccountability.ts` (~line 24), replace:

```ts
import type { DistributionBucket } from "../../distributionReport";
```

with:

```ts
import type { DistributionBucket } from "../model/distributionCoverageModel";
```

In `src/data/reporting/executive/workbook/workbook.ts` (~line 9), replace:

```ts
import type { DistributionBucket } from "../../distributionReport";
```

with:

```ts
import type { DistributionBucket } from "../model/distributionCoverageModel";
```

(Verify each relative path by the file's actual depth under `src/data/reporting/executive/` — `reportModel.ts` and `distributionCoverageModel.ts` are siblings in `model/`, so `./distributionCoverageModel`; `coverage.ts` is at `deck2/section4/`, two levels below `executive/`, so `../../model/distributionCoverageModel`; `partCoverageAccountability.ts` is at `document/`, one level below `executive/`, so `../model/distributionCoverageModel`; `workbook.ts` is at `workbook/`, one level below `executive/`, so `../model/distributionCoverageModel`.)

- [ ] **Step 9: Run the full reporting test suite to confirm no regression**

Run: `npx vitest run src/data/reporting`
Expected: PASS, same total test count as before this task (minus the one block that moved, which is now counted in its new file — net zero change).

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this task is pure import-path surgery plus one file move; a broken relative path shows up here immediately).

- [ ] **Step 11: Commit**

```bash
git add src/data/reporting/executive/model/distributionCoverageModel.ts \
  src/data/reporting/executive/model/distributionCoverageModel.test.ts \
  src/data/reporting/distributionReport.ts src/data/reporting/distributionReport.test.ts \
  src/data/reporting/executive/model/reportModel.ts \
  src/data/reporting/executive/deck2/section4/coverage.ts \
  src/data/reporting/executive/document/partCoverageAccountability.ts \
  src/data/reporting/executive/workbook/workbook.ts
git commit -m "Refactor (reporting): relocate computeDistributionModel out of distributionReport.ts"
```

---

### Task 3: Population Report — types and pure fold helpers

**Files:**
- Create: `src/data/reporting/populationReport/types.ts`
- Create: `src/data/reporting/populationReport/fold.ts`
- Create: `src/data/reporting/populationReport/fold.test.ts`

**Interfaces:**
- Consumes: `classifyImageResult` from `../../population/imageResult` (Task 1); `getStageKey` from `../../population/stageHelpers` (`export function getStageKey(stage: string | null, stageMappings?): StageCountKey`); `PreparedPopulationRow` from `../../population/populationTypes`; `DistributionEntry` from `../../distribution/distributionTypes`.
- Produces: everything below, consumed by Task 4 (`model.ts`) and indirectly by every later task.

```ts
// src/data/reporting/populationReport/types.ts — exact shapes later tasks rely on
export type ResultCounts = { سليمة: number; اشتباه: number; total: number };
export type StageBucket = { stageKey: string; stageLabel: string; counts: ResultCounts };
export type PortBucket = { portName: string; counts: ResultCounts };
export type PortBreakdown = { land: PortBucket[]; sea: PortBucket[] };
export type EmployeeStageRow = {
  username: string;
  displayName: string;
  stages: Record<string, ResultCounts>;
  total: ResultCounts;
};
export type EmployeePortRow = {
  username: string;
  displayName: string;
  ports: { land: ResultCounts; sea: ResultCounts };
  total: ResultCounts;
};
export type EmployeeCertScanRow = {
  username: string;
  displayName: string;
  certScanCount: number;
  nonCertScanCount: number;
  total: number;
};
```

- [ ] **Step 1: Write `types.ts` verbatim as shown above**

```ts
// src/data/reporting/populationReport/types.ts
export type ResultCounts = { سليمة: number; اشتباه: number; total: number };

export type StageBucket = { stageKey: string; stageLabel: string; counts: ResultCounts };

export type PortBucket = { portName: string; counts: ResultCounts };

export type PortBreakdown = { land: PortBucket[]; sea: PortBucket[] };

export type EmployeeStageRow = {
  username: string;
  displayName: string;
  stages: Record<string, ResultCounts>;
  total: ResultCounts;
};

export type EmployeePortRow = {
  username: string;
  displayName: string;
  ports: { land: ResultCounts; sea: ResultCounts };
  total: ResultCounts;
};

export type EmployeeCertScanRow = {
  username: string;
  displayName: string;
  certScanCount: number;
  nonCertScanCount: number;
  total: number;
};
```

- [ ] **Step 2: Write the failing test for `fold.ts`**

```ts
// src/data/reporting/populationReport/fold.test.ts
import { describe, it, expect } from "vitest";
import {
  groupRowsByStage,
  groupRowsByPort,
  sumCounts,
  groupEntriesByEmployeeStage,
  groupEntriesByEmployeePort,
  groupEntriesByEmployeeCertScan,
} from "./fold";
import type { PreparedPopulationRow } from "../../population/populationTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";

function row(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "1",
    xrayImageId: "IMG-1",
    xrayEntryDate: null,
    portCode: null,
    portType: "بري",
    portName: "منفذ اختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
      opposite: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
      liveMeans: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
    },
    notes: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  } as PreparedPopulationRow;
}

function entry(overrides: Partial<DistributionEntry> = {}): DistributionEntry {
  return {
    xrayImageId: "IMG-1",
    assignedTo: "user1",
    status: "completed",
    replacedById: null,
    lastEventAt: "2026-08-01T00:00:00.000Z",
    row: {
      stage: "1",
      portName: "منفذ اختبار",
      xrayEntryDate: null,
      plateOrContainerNumber: null,
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
      certScanStatus: "NonCertscan",
      declarationNumber: null,
      declarationDate: null,
      chassisNumber: null,
      movementType: null,
      portCode: null,
      portType: "بري",
      targetedByRiskEngine: null,
      riskMessage: null,
      biEnrichmentStatus: "BI Not Provided",
      reportNumber: null,
    },
    ...overrides,
  } as DistributionEntry;
}

describe("groupRowsByStage", () => {
  it("counts سليمة/اشتباه/total per stage and orders stages first→fourth→unknown", () => {
    const rows = [
      row({ stage: "1", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
      row({ stage: "1", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "سليمة" }),
      row({ stage: "2", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
    ];
    const buckets = groupRowsByStage(rows);
    expect(buckets.map((b) => b.stageKey)).toEqual(["first", "second"]);
    const first = buckets.find((b) => b.stageKey === "first")!;
    expect(first.counts).toEqual({ سليمة: 1, اشتباه: 1, total: 2 });
  });

  it("returns an empty array for no rows", () => {
    expect(groupRowsByStage([])).toEqual([]);
  });
});

describe("groupRowsByPort", () => {
  it("splits ports into land/sea by the بحري substring rule", () => {
    const rows = [
      row({ portName: "ميناء جدة", portType: "منفذ بحري" }),
      row({ portName: "منفذ الحديثة", portType: "منفذ بري" }),
    ];
    const { land, sea } = groupRowsByPort(rows);
    expect(sea.map((p) => p.portName)).toEqual(["ميناء جدة"]);
    expect(land.map((p) => p.portName)).toEqual(["منفذ الحديثة"]);
  });

  it("sorts ports within each column by total descending", () => {
    const rows = [
      row({ portName: "أ", portType: "بري" }),
      row({ portName: "ب", portType: "بري" }),
      row({ portName: "ب", portType: "بري" }),
    ];
    const { land } = groupRowsByPort(rows);
    expect(land.map((p) => p.portName)).toEqual(["ب", "أ"]);
  });
});

describe("sumCounts", () => {
  it("sums سليمة/اشتباه/total across buckets", () => {
    const total = sumCounts([
      { counts: { سليمة: 2, اشتباه: 1, total: 3 } },
      { counts: { سليمة: 5, اشتباه: 0, total: 5 } },
    ]);
    expect(total).toEqual({ سليمة: 7, اشتباه: 1, total: 8 });
  });
});

describe("groupEntriesByEmployeeStage", () => {
  it("groups by assignedTo, then by stage, and resolves display names", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, stage: "1", xrayLevelOneResult: "اشتباه" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, stage: "2" } }),
      entry({ assignedTo: "user2", row: { ...entry().row, stage: "1" } }),
    ];
    const { rows, stageKeysPresent } = groupEntriesByEmployeeStage(entries, { user1: "أحمد" });
    expect(stageKeysPresent).toEqual(["first", "second"]);
    const ahmed = rows.find((r) => r.username === "user1")!;
    expect(ahmed.displayName).toBe("أحمد");
    expect(ahmed.stages.first).toEqual({ سليمة: 0, اشتباه: 1, total: 1 });
    expect(ahmed.total).toEqual({ سليمة: 1, اشتباه: 1, total: 2 });
    const other = rows.find((r) => r.username === "user2")!;
    expect(other.displayName).toBe("user2"); // falls back to username when no display name mapping
  });
});

describe("groupEntriesByEmployeePort", () => {
  it("groups by assignedTo, then land/sea", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, portType: "بحري" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, portType: "بري" } }),
    ];
    const [row1] = groupEntriesByEmployeePort(entries, {});
    expect(row1.ports.sea.total).toBe(1);
    expect(row1.ports.land.total).toBe(1);
    expect(row1.total.total).toBe(2);
  });
});

describe("groupEntriesByEmployeeCertScan", () => {
  it("counts CertScan vs NonCertScan per employee, degrading unknown status to neither bucket", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: "Certscan" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: "NonCertscan" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: undefined as never } }),
    ];
    const [row1] = groupEntriesByEmployeeCertScan(entries, {});
    expect(row1.certScanCount).toBe(1);
    expect(row1.nonCertScanCount).toBe(1);
    expect(row1.total).toBe(3); // total counts every assignment even when status is missing
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/fold.test.ts`
Expected: FAIL — `Cannot find module './fold'`

- [ ] **Step 4: Write the implementation**

```ts
// src/data/reporting/populationReport/fold.ts
// Pure, side-effect-free grouping helpers shared by Section 1/2 (population/
// sample rows) and Section 3 (per-employee distribution entries) of تقرير
// المجتمع. Every grouping in this report uses the same سليمة/اشتباه/total
// grain (spec §4.3) — one set of helpers, reused with different row sources,
// rather than re-deriving the fold per section.
import { classifyImageResult } from "../../population/imageResult";
import { getStageKey } from "../../population/stageHelpers";
import type { PreparedPopulationRow } from "../../population/populationTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";
import type {
  ResultCounts,
  StageBucket,
  PortBucket,
  PortBreakdown,
  EmployeeStageRow,
  EmployeePortRow,
  EmployeeCertScanRow,
} from "./types";

// Local label map, not imported from stageHelpers.ts (STAGE_LABELS_AR there is
// module-private, and formatStageLabel() expects a RAW stage value to
// re-derive the key from — passing an already-canonical key like "first"
// back through it would misclassify to "unknown"). Same pattern
// sampleReport.ts/distributionReport.ts already use for their own label maps.
const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

const STAGE_ORDER = ["first", "second", "third", "fourth", "unknown"];

function emptyCounts(): ResultCounts {
  return { سليمة: 0, اشتباه: 0, total: 0 };
}

function addResult(counts: ResultCounts, result: "سليمة" | "اشتباه"): void {
  counts[result] += 1;
  counts.total += 1;
}

function isSeaPort(portType: string | null | undefined): boolean {
  return (portType ?? "").includes("بحري");
}

export function groupRowsByStage(rows: PreparedPopulationRow[]): StageBucket[] {
  const buckets = new Map<string, ResultCounts>();
  for (const row of rows) {
    const key = getStageKey(row.stage);
    const counts = buckets.get(key) ?? emptyCounts();
    addResult(counts, classifyImageResult(row.xrayLevelOneResult, row.xrayLevelTwoResult));
    buckets.set(key, counts);
  }
  return STAGE_ORDER.filter((key) => buckets.has(key)).map((stageKey) => ({
    stageKey,
    stageLabel: STAGE_LABELS[stageKey] ?? stageKey,
    counts: buckets.get(stageKey)!,
  }));
}

export function groupRowsByPort(rows: PreparedPopulationRow[]): PortBreakdown {
  const map = new Map<string, { sea: boolean; counts: ResultCounts }>();
  for (const row of rows) {
    const name = row.portName ?? "غير محدد";
    let bucket = map.get(name);
    if (!bucket) {
      bucket = { sea: isSeaPort(row.portType), counts: emptyCounts() };
      map.set(name, bucket);
    }
    addResult(bucket.counts, classifyImageResult(row.xrayLevelOneResult, row.xrayLevelTwoResult));
  }
  const all: PortBucket[] = [...map.entries()].map(([portName, b]) => ({ portName, counts: b.counts }));
  const seaNames = new Set([...map.entries()].filter(([, b]) => b.sea).map(([name]) => name));
  const bySize = (a: PortBucket, b: PortBucket) => b.counts.total - a.counts.total;
  return {
    land: all.filter((p) => !seaNames.has(p.portName)).sort(bySize),
    sea: all.filter((p) => seaNames.has(p.portName)).sort(bySize),
  };
}

export function sumCounts(buckets: Array<{ counts: ResultCounts }>): ResultCounts {
  const total = emptyCounts();
  for (const b of buckets) {
    total.سليمة += b.counts.سليمة;
    total.اشتباه += b.counts.اشتباه;
    total.total += b.counts.total;
  }
  return total;
}

export function groupEntriesByEmployeeStage(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): { rows: EmployeeStageRow[]; stageKeysPresent: string[] } {
  const byUser = new Map<string, EmployeeStageRow>();
  const stageKeysSeen = new Set<string>();
  for (const entry of entries) {
    const stageKey = getStageKey(entry.row.stage);
    stageKeysSeen.add(stageKey);
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        stages: {},
        total: emptyCounts(),
      };
      byUser.set(entry.assignedTo, user);
    }
    const result = classifyImageResult(entry.row.xrayLevelOneResult, entry.row.xrayLevelTwoResult);
    const stageCounts = user.stages[stageKey] ?? emptyCounts();
    addResult(stageCounts, result);
    user.stages[stageKey] = stageCounts;
    addResult(user.total, result);
  }
  const rows = [...byUser.values()].sort((a, b) => b.total.total - a.total.total);
  const stageKeysPresent = STAGE_ORDER.filter((key) => stageKeysSeen.has(key));
  return { rows, stageKeysPresent };
}

export function groupEntriesByEmployeePort(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): EmployeePortRow[] {
  const byUser = new Map<string, EmployeePortRow>();
  for (const entry of entries) {
    const sea = isSeaPort(entry.row.portType);
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        ports: { land: emptyCounts(), sea: emptyCounts() },
        total: emptyCounts(),
      };
      byUser.set(entry.assignedTo, user);
    }
    const result = classifyImageResult(entry.row.xrayLevelOneResult, entry.row.xrayLevelTwoResult);
    addResult(user.ports[sea ? "sea" : "land"], result);
    addResult(user.total, result);
  }
  return [...byUser.values()].sort((a, b) => b.total.total - a.total.total);
}

export function groupEntriesByEmployeeCertScan(
  entries: DistributionEntry[],
  employeeDisplayNames: Record<string, string>
): EmployeeCertScanRow[] {
  const byUser = new Map<string, EmployeeCertScanRow>();
  for (const entry of entries) {
    let user = byUser.get(entry.assignedTo);
    if (!user) {
      user = {
        username: entry.assignedTo,
        displayName: employeeDisplayNames[entry.assignedTo] ?? entry.assignedTo,
        certScanCount: 0,
        nonCertScanCount: 0,
        total: 0,
      };
      byUser.set(entry.assignedTo, user);
    }
    // Spec §4.5: degrade to neither bucket (never crash) when certScanStatus
    // is absent on a pre-B5 legacy distribution entry.
    if (entry.row.certScanStatus === "Certscan") user.certScanCount += 1;
    else if (entry.row.certScanStatus === "NonCertscan") user.nonCertScanCount += 1;
    user.total += 1;
  }
  return [...byUser.values()].sort((a, b) => b.certScanCount - a.certScanCount);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/data/reporting/populationReport/fold.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/populationReport/types.ts src/data/reporting/populationReport/fold.ts \
  src/data/reporting/populationReport/fold.test.ts
git commit -m "Add (reporting): population report fold helpers"
```

---

### Task 4: Population Report — model

**Files:**
- Create: `src/data/reporting/populationReport/model.ts`
- Create: `src/data/reporting/populationReport/model.test.ts`

**Interfaces:**
- Consumes: everything from Task 3's `fold.ts`/`types.ts`; `formatMonthLabel` from `../shared/reportChrome` (`export function formatMonthLabel(folderName: string): string`); `liveSampleRows` from `../../sampling/sampleStorage` (`export function liveSampleRows(sample: SampleMasterData): PreparedPopulationRow[]` — filters out `replacedRowIds`); `ProcessingSummary` from `../../population/populationTypes`; `MonthManifestData` from `../../population/monthTypes`; `SourceRevisions` type used by `sampleReport.ts`/`distributionReport.ts` today (import from `./sourceRevisions` sibling module — verify exact export name by reading `src/data/reporting/sourceRevisions.ts`'s top-level exports before writing this file).
- Produces: `PopulationReportInput`, `PopulationReportModel` types and `computePopulationReportModel(input: PopulationReportInput): PopulationReportModel`, consumed by Task 6 (deck), Task 8 (document), Task 9 (xlsx).

- [ ] **Step 1: Read `src/data/reporting/sourceRevisions.ts`'s exports**

Confirm the exact exported type name for the revisions bag (referenced in the spec as `SourceRevisions`) and the exact signature of whatever footer/sheet helper functions Tasks 6/8/9 will need later (e.g. `sourceRevisionsFooterHtml`). Note them for later tasks — no code change in this step.

- [ ] **Step 2: Write the failing test**

```ts
// src/data/reporting/populationReport/model.test.ts
import { describe, it, expect } from "vitest";
import { computePopulationReportModel } from "./model";
import { makeRow, makeManifest, makeSampleMaster, makeDistribution, makeProcessingSummary } from "../reportTestFixtures";

describe("computePopulationReportModel", () => {
  it("folds population rows, live sample rows, and distribution entries into the report model", () => {
    const populationRows = [
      makeRow("1", "منفذ أ", { stage: "1", xrayLevelOneResult: "سليمة" }),
      makeRow("2", "منفذ أ", { stage: "1", xrayLevelOneResult: "اشتباه" }),
    ];
    const sample = makeSampleMaster([populationRows[0]]);
    const distribution = makeDistribution([
      { id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } },
    ]);
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });

    expect(model.monthFolderName).toBe("8-August-2026");
    expect(model.reconciled.byStage[0].counts.total).toBe(2);
    expect(model.reconciled.totals.total).toBe(2);
    expect(model.sample.totals.total).toBe(1);
    expect(model.distribution.byEmployeeStage[0].displayName).toBe("أحمد");
    expect(model.distribution.certScanByEmployee).toHaveLength(1);
  });

  it("carries riskRawRowCount and a null biRawRowCount through when BI wasn't provided", () => {
    const model = computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: null,
      processingSummary: null,
      riskRawRowCount: 5,
      biRawRowCount: null,
      populationRows: [],
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    expect(model.reconciled.riskRawRowCount).toBe(5);
    expect(model.reconciled.biRawRowCount).toBeNull();
    expect(model.reconciled.totals).toEqual({ سليمة: 0, اشتباه: 0, total: 0 });
  });
});
```

(If `makeRow`/`makeManifest`/`makeSampleMaster`/`makeDistribution`/`makeProcessingSummary` in `reportTestFixtures.ts` have different exact parameter shapes than assumed above, adjust the test to match the fixture file's real signatures — read `src/data/reporting/reportTestFixtures.ts` first if unsure.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/model.test.ts`
Expected: FAIL — `Cannot find module './model'`

- [ ] **Step 4: Write the implementation**

```ts
// src/data/reporting/populationReport/model.ts
import { groupRowsByStage, groupRowsByPort, sumCounts, groupEntriesByEmployeeStage, groupEntriesByEmployeePort, groupEntriesByEmployeeCertScan } from "./fold";
import { formatMonthLabel } from "../shared/reportChrome";
import type { PreparedPopulationRow, ProcessingSummary } from "../../population/populationTypes";
import type { MonthManifestData } from "../../population/monthTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";
import type { StageBucket, PortBreakdown, ResultCounts, EmployeeStageRow, EmployeePortRow, EmployeeCertScanRow } from "./types";
// SourceRevisions import: confirm exact type/export name from sourceRevisions.ts (Step 1) and use it here.
import type { SourceRevisions } from "../sourceRevisions";

export type PopulationReportInput = {
  monthFolderName: string;
  manifest: MonthManifestData | null;
  processingSummary: ProcessingSummary | null;
  riskRawRowCount: number;
  biRawRowCount: number | null;
  populationRows: PreparedPopulationRow[];
  sampleRows: PreparedPopulationRow[];
  distributionEntries: DistributionEntry[];
  employeeDisplayNames: Record<string, string>;
  sourceRevisions?: SourceRevisions;
};

export type PopulationReportModel = {
  monthFolderName: string;
  monthLabel: string;
  reconciled: {
    riskRawRowCount: number;
    biRawRowCount: number | null;
    processingSummary: ProcessingSummary | null;
    byStage: StageBucket[];
    byPort: PortBreakdown;
    totals: ResultCounts;
  };
  sample: {
    byStage: StageBucket[];
    byPort: PortBreakdown;
    totals: ResultCounts;
  };
  distribution: {
    byEmployeeStage: EmployeeStageRow[];
    byEmployeePort: EmployeePortRow[];
    certScanByEmployee: EmployeeCertScanRow[];
    stageKeysPresent: string[];
  };
  sourceRevisions?: SourceRevisions;
};

export function computePopulationReportModel(input: PopulationReportInput): PopulationReportModel {
  const reconciledByStage = groupRowsByStage(input.populationRows);
  const reconciledByPort = groupRowsByPort(input.populationRows);
  const sampleByStage = groupRowsByStage(input.sampleRows);
  const sampleByPort = groupRowsByPort(input.sampleRows);
  const { rows: byEmployeeStage, stageKeysPresent } = groupEntriesByEmployeeStage(
    input.distributionEntries,
    input.employeeDisplayNames
  );
  const byEmployeePort = groupEntriesByEmployeePort(input.distributionEntries, input.employeeDisplayNames);
  const certScanByEmployee = groupEntriesByEmployeeCertScan(input.distributionEntries, input.employeeDisplayNames);

  return {
    monthFolderName: input.monthFolderName,
    monthLabel: formatMonthLabel(input.monthFolderName),
    reconciled: {
      riskRawRowCount: input.riskRawRowCount,
      biRawRowCount: input.biRawRowCount,
      processingSummary: input.processingSummary,
      byStage: reconciledByStage,
      byPort: reconciledByPort,
      totals: sumCounts(reconciledByStage),
    },
    sample: {
      byStage: sampleByStage,
      byPort: sampleByPort,
      totals: sumCounts(sampleByStage),
    },
    distribution: {
      byEmployeeStage,
      byEmployeePort,
      certScanByEmployee,
      stageKeysPresent,
    },
    sourceRevisions: input.sourceRevisions,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/populationReport/model.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors — this step is where a wrong `SourceRevisions` import name or a wrong `formatMonthLabel` signature would surface; fix and re-run before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/populationReport/model.ts src/data/reporting/populationReport/model.test.ts
git commit -m "Add (reporting): population report model"
```

---

### Task 5: New `documentV3` chrome (A4 pages in the deck3 visual language)

**Why new, not reused from `executive/document/shared.ts`:** that module is the *old*, dark-navy A4 theme (spec D8/§6 — deliberately not reused). deck3's own slide builders (`coverSlide`, `sectionDivider`, `contentsSlide`, `closingSlide`) can't be reused directly either — they all call `slideShell`, which hard-codes a fixed 1920×1080 canvas class (`<section class="slide v3">`), wrong for a flowing, variable-length A4 document. This task builds a parallel, page-shaped shell reusing deck3's **content-only** builders (`contentHead`, `tintedPanel`, `dataTable`, `kpiBand` — none of which call `slideShell`) and deck3's exact color tokens, with new page-chrome CSS and new cover/divider/closing functions shaped for A4.

**Files:**
- Create: `src/data/reporting/executive/documentV3/theme.ts`
- Create: `src/data/reporting/executive/documentV3/shared.ts`
- Create: `src/data/reporting/executive/documentV3/shared.test.ts`

**Interfaces:**
- Consumes: `DECK_V3_CSS`, `DECK_V3_FONT_FACE_CSS` from `../deck3/theme`; `contentHead`, `tintedPanel`, `dataTable`, `kpiBand`, `orgBlockHtml`, `coverMetaRow`, type `OrgBlock`, type `TableCell`, type `KpiCell` from `../deck3/slideKit`; `esc` from `../primitives`.
- Produces: `DOCUMENT_V3_CSS` (string), and from `shared.ts`: `docPage`, `docCover`, `docClosing`, `docSectionDivider`, `docPageHeader`, `docKpiStrip`, `docPanel`, `docTwoColumn`, `docPaginateTable` — consumed by Task 8 (`document.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/executive/documentV3/shared.test.ts
import { describe, it, expect } from "vitest";
import { docPage, docCover, docSectionDivider, docPageHeader, docPaginateTable } from "./shared";

describe("documentV3 shared chrome", () => {
  it("docPage wraps body content in a .docpage.v3 shell with the given id/title", () => {
    const html = docPage({ id: "s1-overview", title: "لمحة عامة", pageNo: "01", body: "<p>test</p>" });
    expect(html).toContain('class="docpage v3"');
    expect(html).toContain('id="s1-overview"');
    expect(html).toContain("<p>test</p>");
    expect(html).toContain("01");
  });

  it("docCover renders the org block, title, and period", () => {
    const html = docCover({
      org: { logoUrl: "", orgName: "الهيئة", lines: [] },
      title: "تقرير المجتمع",
      periodLabel: "الشهر",
      periodValue: "أغسطس ٢٠٢٦",
      metaRows: [],
    });
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("أغسطس ٢٠٢٦");
  });

  it("docSectionDivider renders a ghost numeral and title", () => {
    const html = docSectionDivider({ ghost: "١", kicker: "القسم الأول", title: "المجتمع", description: "" });
    expect(html).toContain("القسم الأول");
    expect(html).toContain("المجتمع");
  });

  it("escapes untrusted content in docPageHeader", () => {
    const html = docPageHeader({ eyebrow: "<script>alert(1)</script>", title: "عنوان" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("docPaginateTable splits rows into chunks of the given page size, repeating headers", () => {
    const rows = Array.from({ length: 25 }, (_, i) => [{ html: String(i) }]);
    const chunks = docPaginateTable({ headers: ["#"], rows, rowsPerPage: 10 });
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toContain("24");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/documentV3/shared.test.ts`
Expected: FAIL — `Cannot find module './shared'`

- [ ] **Step 3: Write `theme.ts`**

```ts
// src/data/reporting/executive/documentV3/theme.ts
// A4, flowing-page counterpart to deck3's fixed 1920x1080 slide canvas.
// Reuses deck3's exact CSS (tokens + every .v3-* component class — panels,
// tables, KPI bands, eyebrows are all canvas-size-agnostic) and layers a
// page-shell block on top that replaces .slide.v3's fixed dimensions with
// A4 print-flow rules. No border-radius, no box-shadow — inherited from
// deck3's CSS, not re-declared here.
import { DECK_V3_CSS } from "../deck3/theme";

const DOCUMENT_V3_PAGE_CSS = `
@page { size: A4; margin: 0; }
html,body{margin:0;padding:0;background:var(--v3-bg);}
.docviewer{display:flex;min-height:100vh;}
.docviewer .sidebar{
  width:280px;flex:0 0 280px;background:var(--v3-navy);color:var(--v3-bg);
  padding:40px 28px;position:sticky;top:0;height:100vh;overflow-y:auto;
}
.docviewer .sidebar .doc-brand{font-size:22px;font-weight:700;margin-bottom:8px;}
.docviewer .sidebar .doc-brand-sub{font-size:16px;color:rgba(249,248,245,.7);margin-bottom:32px;}
.docviewer .sidebar nav.toc a{
  display:block;padding:10px 0;color:rgba(249,248,245,.82);text-decoration:none;
  font-size:16px;border-bottom:1px solid rgba(249,248,245,.12);
}
.docviewer .sidebar nav.toc a.active{color:var(--v3-gold-lighter);font-weight:600;}
.docviewer .content{flex:1;padding:24px 0;}
.docpage.v3{
  width:210mm;min-height:297mm;box-sizing:border-box;margin:0 auto 24px;
  background:var(--v3-bg);padding:18mm 16mm;display:flex;flex-direction:column;gap:28px;
  page-break-after:always;border:none;box-shadow:none;
}
.docpage.v3 .docpage-foot{
  margin-top:auto;display:flex;justify-content:space-between;
  font-size:15px;color:var(--v3-muted);border-top:1px solid var(--v3-hair);padding-top:14px;
}
.docpage.v3.docpage-divider{
  background:var(--v3-navy);color:var(--v3-bg);justify-content:center;padding:40mm 20mm;
}
.docpage.v3.docpage-divider .doc-div-ghost{
  font-size:180px;font-weight:700;line-height:.8;color:rgba(249,248,245,.16);
  direction:ltr;unicode-bidi:isolate;
}
.docpage.v3.docpage-divider .doc-div-kicker{font-size:22px;font-weight:500;color:var(--v3-gold-lighter);}
.docpage.v3.docpage-divider .doc-div-h1{font-size:52px;font-weight:700;margin:12px 0;}
.docpage.v3.docpage-divider .doc-div-desc{font-size:20px;line-height:1.6;color:rgba(249,248,245,.78);}
.docpage.v3.docpage-cover{background:var(--v3-cover-navy);color:var(--v3-bg);justify-content:space-between;padding:40mm 20mm;}
.docpage.v3.docpage-cover .doc-cover-title{font-size:56px;font-weight:700;margin:16px 0;}
@media print {
  .docviewer .sidebar, .docviewer .no-print { display:none; }
  .docpage.v3 { margin:0; }
}
`;

export const DOCUMENT_V3_CSS = `${DECK_V3_CSS}\n${DOCUMENT_V3_PAGE_CSS}`;
```

- [ ] **Step 4: Write `shared.ts`**

```ts
// src/data/reporting/executive/documentV3/shared.ts
import { esc } from "../primitives";
import { contentHead, tintedPanel, dataTable, kpiBand, orgBlockHtml, coverMetaRow } from "../deck3/slideKit";
import type { OrgBlock, TableCell, KpiCell } from "../deck3/slideKit";

export type DocPageOpts = { id: string; title: string; pageNo: string; body: string; extraClass?: string };

export function docPage(opts: DocPageOpts): string {
  return `<section id="${esc(opts.id)}" data-title="${esc(opts.title)}" class="docpage v3 ${esc(opts.extraClass ?? "")}">
${opts.body}
<div class="docpage-foot"><span>${esc(opts.title)}</span><span>${esc(opts.pageNo)}</span></div>
</section>`;
}

export function docPageHeader(opts: { eyebrow: string; title: string; note?: string }): string {
  return contentHead(opts);
}

export function docKpiStrip(cells: KpiCell[]): string {
  return kpiBand(cells, "solo");
}

export function docPanel(title: string, body: string): string {
  return tintedPanel({ variant: "land", title, body, padLg: true });
}

export function docTwoColumn(opts: {
  land: { title: string; note?: string; body: string };
  sea: { title: string; note?: string; body: string };
}): string {
  return `<div class="v3-two-col">
${tintedPanel({ variant: "land", title: opts.land.title, note: opts.land.note, body: opts.land.body })}
${tintedPanel({ variant: "sea", title: opts.sea.title, note: opts.sea.note, body: opts.sea.body })}
</div>`;
}

export type DocCoverOpts = {
  org: OrgBlock;
  title: string;
  periodLabel: string;
  periodValue: string;
  metaRows: Array<{ label: string; value: string; end?: boolean }>;
};

export function docCover(opts: DocCoverOpts): string {
  return `<section class="docpage v3 docpage-cover" data-title="${esc(opts.title)}">
${orgBlockHtml(opts.org)}
<div>
  <div class="v3-eyebrow">${esc(opts.periodLabel)}</div>
  <h1 class="doc-cover-title">${esc(opts.title)}</h1>
  <div>${esc(opts.periodValue)}</div>
</div>
${coverMetaRow(opts.metaRows)}
</section>`;
}

export function docClosing(opts: { org: OrgBlock; title: string; closingLine: string }): string {
  return `<section class="docpage v3 docpage-cover" data-title="${esc(opts.title)}">
${orgBlockHtml(opts.org)}
<div><h1 class="doc-cover-title">${esc(opts.title)}</h1><p>${esc(opts.closingLine)}</p></div>
</section>`;
}

export function docSectionDivider(opts: {
  ghost: string;
  kicker: string;
  title: string;
  description: string;
}): string {
  return `<section class="docpage v3 docpage-divider" data-title="${esc(opts.title)}">
<div class="doc-div-ghost">${esc(opts.ghost)}</div>
<div class="doc-div-kicker">${esc(opts.kicker)}</div>
<h1 class="doc-div-h1">${esc(opts.title)}</h1>
<p class="doc-div-desc">${esc(opts.description)}</p>
</section>`;
}

export type PaginateTableOpts = {
  headers: string[];
  rows: TableCell[][];
  totals?: TableCell[];
  rowsPerPage?: number;
};

export function docPaginateTable(opts: PaginateTableOpts): string[] {
  const rowsPerPage = opts.rowsPerPage ?? 20;
  if (opts.rows.length === 0) {
    return [dataTable({ headers: opts.headers, rows: [], totals: opts.totals })];
  }
  const chunks: string[] = [];
  for (let i = 0; i < opts.rows.length; i += rowsPerPage) {
    const slice = opts.rows.slice(i, i + rowsPerPage);
    const isLast = i + rowsPerPage >= opts.rows.length;
    chunks.push(dataTable({ headers: opts.headers, rows: slice, totals: isLast ? opts.totals : undefined }));
  }
  return chunks;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/documentV3/shared.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors — confirm `OrgBlock`/`TableCell`/`KpiCell` are actually exported from `deck3/slideKit.ts` under those exact names (they are, per this plan's research); fix the import if not.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/executive/documentV3/theme.ts src/data/reporting/executive/documentV3/shared.ts \
  src/data/reporting/executive/documentV3/shared.test.ts
git commit -m "Add (reporting): documentV3 A4 chrome in the deck3 visual language"
```

---

### Task 6: Population Report deck — Section 1 slides

**Files:**
- Create: `src/data/reporting/populationReport/deck.ts`
- Create: `src/data/reporting/populationReport/deck.test.ts`

**Interfaces:**
- Consumes: `PopulationReportModel` (Task 4); `coverSlide`, `contentsSlide`, `sectionDivider`, `contentHead`, `tintedPanel`, `dataTable`, `kpiBand`, `slideShell`, types `SlideMeta`/`TableCell`/`KpiCell`/`OrgBlock` from `../executive/deck3/slideKit`; `yieldToMain` from `../../storage/yieldToMain`; `fmtNum`, `fmtPct`, `esc` from `../executive/primitives`.
- Produces (this task): `buildSection1Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta): string[]` — an internal (not publicly exported outside the module — exported from `deck.ts` for its own test file to call directly) slide-array builder covering slides 1–7 (cover, contents, section divider, receipt, risk before/after, BI before/after, reconciled by stage, reconciled by port — 8 items, cover+contents+divider+5 content slides). Task 7 builds Section 2/3/closing and the public assembly that calls this.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/populationReport/deck.test.ts
import { describe, it, expect } from "vitest";
import { buildSection1Slides } from "./deck";
import { computePopulationReportModel } from "./model";
import { makeRow, makeManifest, makeProcessingSummary } from "../reportTestFixtures";

function testModel() {
  return computePopulationReportModel({
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 100,
    biRawRowCount: 90,
    populationRows: [makeRow("1", "ميناء جدة", { portType: "بحري" }), makeRow("2", "منفذ الحديثة", { portType: "بري" })],
    sampleRows: [],
    distributionEntries: [],
    employeeDisplayNames: {},
  });
}

describe("buildSection1Slides", () => {
  it("builds cover, contents, divider, and 5 content slides for Section 1", () => {
    const slides = buildSection1Slides(testModel(), (num) => ({
      num,
      total: 13,
      sectionKey: "s1",
      sectionLabel: "المجتمع",
      footText: "تقرير المجتمع",
    }));
    expect(slides).toHaveLength(8);
    expect(slides.join("")).toContain("تقرير المجتمع");
    expect(slides.join("")).toContain("ميناء جدة");
    expect(slides.join("")).toContain("منفذ الحديثة");
  });

  it("never renders workflow-status text", () => {
    const html = buildSection1Slides(testModel(), (num) => ({
      num,
      total: 13,
      sectionKey: "s1",
      sectionLabel: "المجتمع",
      footText: "",
    })).join("");
    expect(html).not.toContain("قيد الانتظار");
    expect(html).not.toContain("مكتمل");
    expect(html).not.toContain("مستبدل");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: FAIL — `Cannot find module './deck'`

- [ ] **Step 3: Write the implementation**

```ts
// src/data/reporting/populationReport/deck.ts
import {
  coverSlide,
  contentsSlide,
  sectionDivider,
  contentHead,
  tintedPanel,
  dataTable,
  kpiBand,
  slideShell,
} from "../executive/deck3/slideKit";
import type { SlideMeta, TableCell, KpiCell, OrgBlock } from "../executive/deck3/slideKit";
import { fmtNum, fmtPct, esc } from "../executive/primitives";
import type { PopulationReportModel } from "./model";
import type { PortBreakdown, ResultCounts } from "./types";

const ORG: OrgBlock = { logoUrl: "", orgName: "ضمان جودة الأشعة", lines: [] };

// deck3's dataTable()/kpiBand() do NOT escape their `html` fields themselves
// (same convention as every other deck3 slide) — every cell built from
// data (port names, stage labels, employee display names) must be escaped
// by the caller, here, before it reaches a TableCell.
function resultRow(label: string, counts: ResultCounts): TableCell[] {
  return [
    { html: esc(label) },
    { html: fmtNum(counts.total), cls: "v-navy" },
    { html: fmtNum(counts.سليمة), cls: "v-green" },
    { html: fmtNum(counts.اشتباه), cls: "v-red" },
  ];
}

const RESULT_HEADERS = ["البند", "الإجمالي", "سليمة", "اشتباه"];

function portBreakdownTwoColumn(breakdown: PortBreakdown): string {
  const padTo = Math.max(breakdown.land.length, breakdown.sea.length);
  const rowsFor = (ports: PortBreakdown["land"]) => ports.map((p) => resultRow(p.portName, p.counts));
  const totalsFor = (ports: PortBreakdown["land"], label: string) => {
    const total = { سليمة: 0, اشتباه: 0, total: 0 };
    for (const p of ports) {
      total.سليمة += p.counts.سليمة;
      total.اشتباه += p.counts.اشتباه;
      total.total += p.counts.total;
    }
    return resultRow(label, total);
  };
  return `<div class="v3-two-col">
${tintedPanel({
  variant: "land",
  title: "المنافذ البرية",
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(breakdown.land), totals: totalsFor(breakdown.land, "إجمالي البرية"), padToRows: padTo }),
})}
${tintedPanel({
  variant: "sea",
  title: "المنافذ البحرية",
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(breakdown.sea), totals: totalsFor(breakdown.sea, "إجمالي البحرية"), padToRows: padTo }),
})}
</div>`;
}

export function buildSection1Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta): string[] {
  const slides: string[] = [];

  // 1 — Cover
  slides.push(
    coverSlide({
      org: ORG,
      kicker: "تقرير المجتمع",
      title: "تقرير المجتمع",
      periodLabel: "الفترة",
      periodValue: model.monthLabel,
      metaRows: [{ label: "تاريخ الإصدار", value: new Date().toLocaleDateString("ar-SA") }],
      meta: meta(1),
    })
  );

  // 2 — Contents
  slides.push(
    contentsSlide({
      eyebrow: "تقرير المجتمع",
      title: "المحتويات",
      rows: [
        { index: 1, title: "المجتمع", description: "المجتمع المستلم والمعالج", topics: "الاستلام، المعالجة، التوزيع حسب المرحلة والمنفذ", pages: "٣" },
        { index: 2, title: "العينة", description: "تكوين العينة المسحوبة", topics: "حسب المرحلة والمنفذ", pages: "٢" },
        { index: 3, title: "التوزيع", description: "التوزيع على الموظفين", topics: "حسب المرحلة، المنفذ، وCertScan", pages: "٣" },
      ],
      meta: meta(2),
    })
  );

  // 3 — Section 1 divider
  slides.push(
    sectionDivider({
      eyebrow: "القسم الأول",
      ghost: "١",
      kicker: "القسم الأول",
      title: "المجتمع",
      description: "المجتمع المستلم وكيف تمت معالجته",
      footItems: [],
      meta: meta(3),
    })
  );

  // 4 — Receipt overview: Risk | BI two tables side by side
  const summary = model.reconciled.processingSummary;
  const receiptInner = `${contentHead({ eyebrow: "القسم الأول", title: "الاستلام" })}
<div class="v3-two-col">
${tintedPanel({
  variant: "land",
  title: "بيانات المخاطر (Risk)",
  body: kpiBand(
    [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.riskRawRowCount) } satisfies KpiCell],
    "solo"
  ),
})}
${tintedPanel({
  variant: "sea",
  title: "بيانات معلومات الأعمال (BI)",
  body: kpiBand(
    model.reconciled.biRawRowCount === null
      ? [{ label: "لم يتم توفير BI لهذا الشهر", value: "—" } satisfies KpiCell]
      : [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.biRawRowCount) } satisfies KpiCell],
    "solo"
  ),
})}
</div>`;
  slides.push(slideShell(meta(4), "", receiptInner));

  // 5 — Risk before -> after
  const riskInner = `${contentHead({ eyebrow: "القسم الأول", title: "بيانات المخاطر — قبل وبعد" })}
${
  summary
    ? kpiBand(
        [
          { label: "الصفوف الأصلية", value: fmtNum(summary.riskOriginalRows) },
          { label: "معرّفات صحيحة", value: fmtNum(summary.validRiskIdRows) },
          { label: "بعد إزالة التكرار", value: fmtNum(summary.rowsAfterDeduplication) },
          { label: "المجتمع النهائي", value: fmtNum(summary.finalPreparedPopulationRows), valueTone: "gold" },
        ] satisfies KpiCell[],
        "solo"
      )
    : contentHead({ eyebrow: "", title: "لا تتوفر بيانات المعالجة لهذا الشهر" })
}`;
  slides.push(slideShell(meta(5), "", riskInner));

  // 6 — BI before -> after
  const biRows: TableCell[][] = summary
    ? summary.biFieldFillSummary.map((f) => [
        { html: f.fieldName },
        { html: fmtNum(f.riskEmptyBefore) },
        { html: fmtNum(f.filledFromBi) },
        { html: fmtNum(f.stillEmptyAfter) },
        { html: fmtPct(f.fillPercentage) },
      ])
    : [];
  const biInner = `${contentHead({ eyebrow: "القسم الأول", title: "بيانات BI — قبل وبعد" })}
${
  summary && summary.biProvided
    ? `${kpiBand(
        [
          { label: "تمت المطابقة", value: fmtNum(summary.biMatchedRows) },
          { label: "لم تتم المطابقة", value: fmtNum(summary.biUnmatchedRows) },
          { label: "نسبة المطابقة", value: fmtPct(summary.biMatchPercentage) },
        ] satisfies KpiCell[],
        "solo"
      )}
${dataTable({ headers: ["الحقل", "فارغ قبل", "تمت التعبئة", "لا يزال فارغًا", "نسبة التعبئة"], rows: biRows })}`
    : contentHead({ eyebrow: "", title: "لم يتم توفير BI لهذا الشهر" })
}`;
  slides.push(slideShell(meta(6), "", biInner));

  // 7 — Reconciled population by stage
  const stageRows = model.reconciled.byStage.map((b) => resultRow(b.stageLabel, b.counts));
  const stageInner = `${contentHead({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المرحلة" })}
${dataTable({ headers: RESULT_HEADERS, rows: stageRows, totals: resultRow("الإجمالي", model.reconciled.totals) })}`;
  slides.push(slideShell(meta(7), "", stageInner));

  // 8 — Reconciled population by port (land/sea)
  const portInner = `${contentHead({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المنفذ" })}
${portBreakdownTwoColumn(model.reconciled.byPort)}`;
  slides.push(slideShell(meta(8), "", portInner));

  return slides;
}

export { resultRow, RESULT_HEADERS, portBreakdownTwoColumn };
```

Note: this makes 8 slides (cover, contents, divider, receipt, risk, bi, stage, port), not 7 — the task interface line above undercounted by one; the test asserts `toHaveLength(8)`, which is correct — trust the test/step-3 code above, not the earlier prose estimate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors — this is where any wrong `KpiCell`/`TableCell` field name would surface.

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/populationReport/deck.ts src/data/reporting/populationReport/deck.test.ts
git commit -m "Add (reporting): population report deck — Section 1 (المجتمع)"
```

---

### Task 7: Population Report deck — Section 2, Section 3, closing, and assembly

**Files:**
- Modify: `src/data/reporting/populationReport/deck.ts` (add Section 2/3/closing builders + public assembly)
- Modify: `src/data/reporting/populationReport/deck.test.ts` (add coverage + golden snapshot)

**Interfaces:**
- Consumes: everything Task 6 already imports, plus `openReportWindow`, `writeOrCloseOnFailure` from `../htmlReport`; `buildDeckV3Html` from `../executive/deck3` (reuse the same HTML-doc wrapper deck3's own executive deck uses — confirm its exact export name and signature by reading `executive/deck3/index.ts` before writing this task, since Task 6's research summary already gives the signature as `buildDeckV3Html(slides: string, monthLabel: string): string`); `yieldToMain` from `../../storage/yieldToMain`.
- Produces (public, consumed by Task 10's TabView wiring): `export type PopulationDeckInput` (same shape as `PopulationReportInput` from Task 4 — re-export it under this name for callers, or just re-export `PopulationReportInput` directly and use it verbatim, whichever keeps naming simplest — re-exporting `PopulationReportInput` verbatim is simpler and avoids a duplicate type, use that), `export async function buildPopulationDeck(input: PopulationReportInput): Promise<string>`, `export async function openPopulationDeck(input: PopulationReportInput): Promise<void>`.

- [ ] **Step 1: Read `executive/deck3/index.ts` to confirm `buildDeckV3Html`'s exact signature**

Confirm `buildDeckV3Html(slides: string, monthLabel: string): string` matches what's actually exported — adjust the code below if not.

- [ ] **Step 2: Write the failing test additions**

Append to `src/data/reporting/populationReport/deck.test.ts`:

```ts
import { buildPopulationDeck } from "./deck";
import { makeSampleMaster, makeDistribution } from "../reportTestFixtures";

describe("buildPopulationDeck", () => {
  it("produces a self-contained HTML deck with all three sections and no workflow-status text", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    const html = await buildPopulationDeck({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("أحمد");
    expect(html).not.toContain("قيد الانتظار");
  });

  describe("golden snapshot (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
        const sample = makeSampleMaster(populationRows);
        const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
        const html = await buildPopulationDeck({
          monthFolderName: "8-August-2026",
          manifest: makeManifest(),
          processingSummary: makeProcessingSummary(),
          riskRawRowCount: 10,
          biRawRowCount: 8,
          populationRows,
          sampleRows: sample.rows,
          distributionEntries: distribution.entries,
          employeeDisplayNames: { user1: "أحمد" },
        });
        expect(html).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
```

Add `import { vi } from "vitest";` to the top of the test file if not already present.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: FAIL — `buildPopulationDeck` is not exported from `./deck`.

- [ ] **Step 4: Append Section 2, Section 3, closing, and assembly to `deck.ts`**

```ts
// append to src/data/reporting/populationReport/deck.ts

import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { buildDeckV3Html } from "../executive/deck3";
import { yieldToMain } from "../../storage/yieldToMain";
import type { PopulationReportModel } from "./model";
import type { PopulationReportInput } from "./model";
import { computePopulationReportModel } from "./model";

const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

function buildSection2Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta): string[] {
  const slides: string[] = [];

  slides.push(
    sectionDivider({
      eyebrow: "القسم الثاني",
      ghost: "٢",
      kicker: "القسم الثاني",
      title: "العينة",
      description: "العينة المسحوبة من المجتمع، على نفس المحاور",
      footItems: [],
      meta: meta(9),
    })
  );

  const sampleStageRows = model.sample.byStage.map((b) => resultRow(b.stageLabel, b.counts));
  slides.push(
    slideShell(
      meta(10),
      "",
      `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المرحلة" })}
${dataTable({ headers: RESULT_HEADERS, rows: sampleStageRows, totals: resultRow("الإجمالي", model.sample.totals) })}`
    )
  );

  slides.push(
    slideShell(
      meta(11),
      "",
      `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المنفذ" })}
${portBreakdownTwoColumn(model.sample.byPort)}`
    )
  );

  return slides;
}

function employeeStageTable(model: PopulationReportModel): string {
  const headers = ["الموظف", ...model.distribution.stageKeysPresent.map((k) => STAGE_LABELS[k] ?? k), "الإجمالي"];
  const rows: TableCell[][] = model.distribution.byEmployeeStage.map((emp) => [
    { html: esc(emp.displayName) },
    ...model.distribution.stageKeysPresent.map((k) => ({ html: fmtNum(emp.stages[k]?.total ?? 0) })),
    { html: fmtNum(emp.total.total), cls: "v-navy" },
  ]);
  return dataTable({ headers, rows });
}

function employeePortTable(model: PopulationReportModel): string {
  const headers = ["الموظف", "برية", "بحرية", "الإجمالي"];
  const rows: TableCell[][] = model.distribution.byEmployeePort.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.ports.land.total) },
    { html: fmtNum(emp.ports.sea.total) },
    { html: fmtNum(emp.total.total), cls: "v-navy" },
  ]);
  return dataTable({ headers, rows });
}

function certScanTable(model: PopulationReportModel): string {
  const rows: TableCell[][] = model.distribution.certScanByEmployee.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.certScanCount), cls: "v-gold" },
    { html: fmtNum(emp.nonCertScanCount) },
    { html: fmtNum(emp.total), cls: "v-navy" },
  ]);
  return dataTable({ headers: ["الموظف", "CertScan", "غير CertScan", "الإجمالي"], rows });
}

function buildSection3Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta): string[] {
  const slides: string[] = [];

  slides.push(
    sectionDivider({
      eyebrow: "القسم الثالث",
      ghost: "٣",
      kicker: "القسم الثالث",
      title: "التوزيع",
      description: "من استلم ماذا، وما هي النتائج",
      footItems: [],
      meta: meta(12),
    })
  );

  slides.push(
    slideShell(
      meta(13),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمرحلة" })}
${employeeStageTable(model)}`
    )
  );

  slides.push(
    slideShell(
      meta(14),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمنفذ" })}
${employeePortTable(model)}`
    )
  );

  slides.push(
    slideShell(
      meta(15),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب CertScan" })}
${certScanTable(model)}`
    )
  );

  return slides;
}

const TOTAL_SLIDES = 16; // cover, contents, s1-divider + 5, s2-divider + 2, s3-divider + 3, closing

export async function buildPopulationDeckSlides(model: PopulationReportModel): Promise<string> {
  const meta = (num: number): SlideMeta => ({
    num,
    total: TOTAL_SLIDES,
    sectionKey: num <= 8 ? "s1" : num <= 11 ? "s2" : "s3",
    sectionLabel: num <= 8 ? "المجتمع" : num <= 11 ? "العينة" : "التوزيع",
    footText: `تقرير المجتمع — ${model.monthLabel}`,
  });

  const parts: string[] = [];
  parts.push(...buildSection1Slides(model, meta));
  await yieldToMain();
  parts.push(...buildSection2Slides(model, meta));
  await yieldToMain();
  parts.push(...buildSection3Slides(model, meta));
  await yieldToMain();
  parts.push(
    closingSlide({
      org: ORG,
      kicker: "تقرير المجتمع",
      title: "نهاية التقرير",
      closingLine: `تقرير المجتمع — ${model.monthLabel}`,
      metaRows: [],
      meta: meta(TOTAL_SLIDES),
    })
  );
  return parts.join("\n");
}

export async function buildPopulationDeck(input: PopulationReportInput): Promise<string> {
  const model = computePopulationReportModel(input);
  const slides = await buildPopulationDeckSlides(model);
  return buildDeckV3Html(slides, model.monthLabel);
}

export async function openPopulationDeck(input: PopulationReportInput): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(reportWindow, () => buildPopulationDeck(input), `تقرير_المجتمع_${input.monthFolderName}.html`);
}
```

Also import `closingSlide` in the existing import list at the top of `deck.ts` (it was omitted from Task 6's import line, which only imported `coverSlide, contentsSlide, sectionDivider, contentHead, tintedPanel, dataTable, kpiBand, slideShell` — add `closingSlide`).

- [ ] **Step 5: Run to verify it passes and generate the golden snapshot**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: PASS, and a new `src/data/reporting/populationReport/__snapshots__/deck.test.ts.snap` file is created — open it and confirm by eye it looks like a real HTML deck (no obviously wrong content, no stray placeholder text) before committing it as the pinned baseline.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/populationReport/deck.ts src/data/reporting/populationReport/deck.test.ts \
  src/data/reporting/populationReport/__snapshots__/deck.test.ts.snap
git commit -m "Add (reporting): population report deck — Section 2/3, closing, assembly"
```

---

### Task 7b: Export-scope switch (population / sample / both) — deck retrofit

**Why this task exists:** added mid-flight, after Task 7 shipped and was reviewed, via
`docs/superpowers/specs/2026-08-27-population-report-merge-design.md` §9 (decision D11): the تقرير
المجتمع card needs a 3-way segmented switch — **المجتمع فقط** (population only → Section 1 alone),
**العينة فقط** (sample only → Sections 2 **and** 3 together), **الكل** (both, default → all three).
Applies uniformly to whichever format is exported. Task 7's deck (this task retrofits) hardcoded
absolute slide numbers assuming all three sections always render — this task makes that
scope-relative. Tasks 8/9/10 (not yet built) incorporate scope from the start instead of needing a
retrofit.

**Files:**
- Modify: `src/data/reporting/populationReport/types.ts` (add `PopulationReportScope`)
- Modify: `src/data/reporting/populationReport/deck.ts`
- Modify: `src/data/reporting/populationReport/deck.test.ts`

**Interfaces:**
- Produces: `export type PopulationReportScope = "population" | "sample" | "both"` (types.ts) —
  consumed by Tasks 8, 9, 10.
- Modifies (backward-compatible, default `"both"` reproduces today's exact output byte-for-byte):
  `buildSection1Slides(model, meta, scope = "both")`, `buildPopulationDeckSlides(model, scope = "both")`,
  `buildPopulationDeck(input, scope = "both")`, `openPopulationDeck(input, scope = "both")`.

- [ ] **Step 1: Add the scope type**

```ts
// src/data/reporting/populationReport/types.ts — append
export type PopulationReportScope = "population" | "sample" | "both";
```

- [ ] **Step 2: Write the failing tests**

Append to `src/data/reporting/populationReport/deck.test.ts`:

```ts
import type { PopulationReportScope } from "./types";

describe("export scope", () => {
  function scopedModel() {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([
      { id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } },
    ]);
    return computePopulationReportModel({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
  }

  it("scope='population' includes only Section 1 content, still has cover/contents/closing", async () => {
    const html = await buildPopulationDeckSlides(scopedModel(), "population");
    expect(html).toContain("الاستلام"); // Section 1 content present
    expect(html).not.toContain("التوزيع حسب الموظف"); // Section 3 content absent
    expect(html).not.toContain("العينة حسب المرحلة"); // Section 2 content absent
  });

  it("scope='sample' includes Sections 2+3 together but not Section 1's content", async () => {
    const html = await buildPopulationDeckSlides(scopedModel(), "sample");
    expect(html).toContain("العينة حسب المرحلة"); // Section 2 present
    expect(html).toContain("التوزيع حسب الموظف والمرحلة"); // Section 3 present
    expect(html).not.toContain("بيانات المخاطر — قبل وبعد"); // Section 1 content absent
  });

  it("defaults to 'both' when scope is omitted, matching today's full output", async () => {
    const withDefault = await buildPopulationDeckSlides(scopedModel());
    const withExplicitBoth = await buildPopulationDeckSlides(scopedModel(), "both");
    expect(withDefault).toBe(withExplicitBoth);
  });

  describe("golden snapshot — non-default scope (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot for scope='population'", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        const html = await buildPopulationDeck(
          {
            monthFolderName: "8-August-2026",
            manifest: makeManifest(),
            processingSummary: makeProcessingSummary(),
            riskRawRowCount: 10,
            biRawRowCount: 8,
            populationRows: [makeRow("1", "ميناء جدة", { portType: "بحري" })],
            sampleRows: [],
            distributionEntries: [],
            employeeDisplayNames: {},
          },
          "population" satisfies PopulationReportScope
        );
        expect(html).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: FAIL — `buildPopulationDeckSlides`/`buildPopulationDeck` don't accept a second `scope` argument yet, and Section-1-only/Section-2+3-only output doesn't exist yet.

- [ ] **Step 4: Refactor `deck.ts` to be scope-aware**

Replace the `contentsSlide`'s hardcoded `rows` array inside `buildSection1Slides` and the function's signature, add a `contentsRows` helper, add an early return for `scope === "sample"`, give `buildSection2Slides`/`buildSection3Slides` a `startNum` parameter instead of their hardcoded `meta(9)`..`meta(15)` calls, and rewrite `buildPopulationDeckSlides`/`buildPopulationDeck`/`openPopulationDeck` to compute slide counts and boundaries from which sections are included. Full replacement code for the affected functions:

```ts
// Replace the `rows: [...]` array literal inside buildSection1Slides's contentsSlide call with:
      rows: contentsRows(scope),

// Add this helper above buildSection1Slides:
function contentsRows(
  scope: PopulationReportScope
): Array<{ index: number; title: string; description: string; topics: string; pages: string }> {
  const rows: Array<{ index: number; title: string; description: string; topics: string; pages: string }> = [];
  if (scope !== "sample") {
    rows.push({
      index: rows.length + 1,
      title: "المجتمع",
      description: "المجتمع المستلم والمعالج",
      topics: "الاستلام، المعالجة، التوزيع حسب المرحلة والمنفذ",
      pages: "٥",
    });
  }
  if (scope !== "population") {
    rows.push({
      index: rows.length + 1,
      title: "العينة",
      description: "تكوين العينة المسحوبة",
      topics: "حسب المرحلة والمنفذ",
      pages: "٢",
    });
    rows.push({
      index: rows.length + 1,
      title: "التوزيع",
      description: "التوزيع على الموظفين",
      topics: "حسب المرحلة، المنفذ، وCertScan",
      pages: "٣",
    });
  }
  return rows;
}

// buildSection1Slides's new signature and early return (everything else in its body is unchanged):
export function buildSection1Slides(
  model: PopulationReportModel,
  meta: (num: number) => SlideMeta,
  scope: PopulationReportScope = "both"
): string[] {
  const slides: string[] = [];
  // 1 — Cover (unchanged)
  slides.push(coverSlide({ /* ...unchanged... */ meta: meta(1) }));
  // 2 — Contents (rows now come from contentsRows(scope))
  slides.push(contentsSlide({ eyebrow: "تقرير المجتمع", title: "المحتويات", rows: contentsRows(scope), meta: meta(2) }));

  if (scope === "sample") return slides; // cover + contents only; Section 1's own content is excluded

  // 3 — Section 1 divider, 4-8 content slides: UNCHANGED from the existing implementation
  // ...
  return slides;
}

// buildSection2Slides and buildSection3Slides: replace every meta(9)/meta(10)/meta(11) and
// meta(12)/meta(13)/meta(14)/meta(15) call with meta(startNum), meta(startNum + 1), etc., and add
// `startNum: number` as a new third parameter to both function signatures:
function buildSection2Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta, startNum: number): string[] {
  const slides: string[] = [];
  slides.push(sectionDivider({ /* ...unchanged fields... */ meta: meta(startNum) }));
  const sampleStageRows = model.sample.byStage.map((b) => resultRow(b.stageLabel, b.counts));
  slides.push(slideShell(meta(startNum + 1), "", `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المرحلة" })}
${dataTable({ headers: RESULT_HEADERS, rows: sampleStageRows, totals: resultRow("الإجمالي", model.sample.totals) })}`));
  slides.push(slideShell(meta(startNum + 2), "", `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المنفذ" })}
${portBreakdownTwoColumn(model.sample.byPort)}`));
  return slides;
}

function buildSection3Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta, startNum: number): string[] {
  const slides: string[] = [];
  slides.push(sectionDivider({ /* ...unchanged fields... */ meta: meta(startNum) }));
  slides.push(slideShell(meta(startNum + 1), "", `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمرحلة" })}
${employeeStageTable(model)}`));
  slides.push(slideShell(meta(startNum + 2), "", `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمنفذ" })}
${employeePortTable(model)}`));
  slides.push(slideShell(meta(startNum + 3), "", `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب CertScan" })}
${certScanTable(model)}`));
  return slides;
}

// Replace TOTAL_SLIDES and buildPopulationDeckSlides/buildPopulationDeck/openPopulationDeck entirely:
export async function buildPopulationDeckSlides(
  model: PopulationReportModel,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const includePopulation = scope !== "sample";
  const includeSample = scope !== "population";
  const section1Count = includePopulation ? 6 : 0; // divider + 5 content slides, NOT counting cover/contents
  const totalSlides = 2 /* cover + contents */ + section1Count + (includeSample ? 7 : 0) /* s2(3) + s3(4) */ + 1 /* closing */;
  const s1End = 2 + section1Count;
  const s2End = s1End + (includeSample ? 3 : 0);

  const meta = (num: number): SlideMeta => ({
    num,
    total: totalSlides,
    sectionKey: num <= s1End ? "s1" : num <= s2End ? "s2" : "s3",
    sectionLabel: num <= s1End ? "المجتمع" : num <= s2End ? "العينة" : "التوزيع",
    footText: `تقرير المجتمع — ${model.monthLabel}`,
  });

  const parts: string[] = [];
  parts.push(...buildSection1Slides(model, meta, scope));
  await yieldToMain();
  if (includeSample) {
    parts.push(...buildSection2Slides(model, meta, s1End + 1));
    await yieldToMain();
    parts.push(...buildSection3Slides(model, meta, s1End + 4));
    await yieldToMain();
  }
  parts.push(
    closingSlide({
      org: ORG,
      kicker: "تقرير المجتمع",
      title: "نهاية التقرير",
      closingLine: `تقرير المجتمع — ${model.monthLabel}`,
      metaRows: [],
      meta: meta(totalSlides),
    })
  );
  return parts.join("\n");
}

export async function buildPopulationDeck(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const model = computePopulationReportModel(input);
  const slides = await buildPopulationDeckSlides(model, scope);
  return buildDeckV3Html(slides, model.monthLabel, {
    title: "تقرير المجتمع",
    navBrand: "تقرير المجتمع",
    toolbarBrand: "تقرير المجتمع",
  });
}

export async function openPopulationDeck(input: PopulationReportInput, scope: PopulationReportScope = "both"): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(reportWindow, () => buildPopulationDeck(input, scope), `تقرير_المجتمع_${input.monthFolderName}.html`);
}
```

Add `import type { PopulationReportScope } from "./types";` to `deck.ts`'s existing imports (it already imports other types from `./types`).

Double-check `s1End + 4` for Section 3's `startNum`: Section 2 occupies `s1End+1, s1End+2, s1End+3` (3 slides: divider + 2 content), so Section 3 correctly starts at `s1End + 4`.

- [ ] **Step 5: Run to verify tests pass and generate the new golden snapshot**

Run: `npx vitest run src/data/reporting/populationReport/deck.test.ts`
Expected: PASS, including the pre-existing Task 6/7 tests (the `"both"`-default behavior must be byte-identical to before — the `toBe()` equality test in Step 2 checks this directly). A new snapshot entry for scope=`"population"` is added to the existing `__snapshots__/deck.test.ts.snap` file — eyeball it: cover, contents (listing only "المجتمع"), Section 1 divider + 5 content slides, closing — 9 slides total, no "العينة"/"التوزيع" section content anywhere.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/populationReport/types.ts src/data/reporting/populationReport/deck.ts \
  src/data/reporting/populationReport/deck.test.ts \
  src/data/reporting/populationReport/__snapshots__/deck.test.ts.snap
git commit -m "Add (reporting): export-scope switch (population/sample/both) — deck retrofit"
```

---

### Task 8: Population Report document (A4, full detail, paginated)

**Files:**
- Create: `src/data/reporting/populationReport/document.ts`
- Create: `src/data/reporting/populationReport/document.test.ts`

**Interfaces:**
- Consumes: `docPage`, `docCover`, `docClosing`, `docSectionDivider`, `docPageHeader`, `docKpiStrip`, `docTwoColumn`, `docPaginateTable` from `../executive/documentV3/shared` (Task 5); `DOCUMENT_V3_CSS` from `../executive/documentV3/theme`; `PopulationReportModel`/`PopulationReportInput`/`computePopulationReportModel` from `./model`; `RESULT_HEADERS`, `resultRow` re-exported from `./deck` (Task 6/7 — reuse, don't duplicate); `openReportWindow`/`writeOrCloseOnFailure` from `../htmlReport`; `yieldToMain` from `../../storage/yieldToMain`; `fmtNum`, `fmtPct` from `../executive/primitives`.
- Produces: `export async function buildPopulationDocument(input: PopulationReportInput, scope: PopulationReportScope = "both"): Promise<string>`, `export async function openPopulationDocument(input: PopulationReportInput, scope: PopulationReportScope = "both"): Promise<void>` — consumed by Task 10.

**Scope note (spec §9/D11, added after Tasks 1-7 shipped):** this task builds scope support in from
the start, unlike Task 7b which had to retrofit it. `PopulationReportScope` (`"population" | "sample"
| "both"`, from `./types`, added in Task 7b) gates which sections' pages are included: `scope !==
"sample"` includes Section 1's pages, `scope !== "population"` includes Sections 2+3's pages together
(never independently). Cover and closing always render. Unlike the deck, the document has no
cross-section absolute page numbering to recompute — each section's page-number counter (`pad(n++)`)
is already local to that section's own build function, so skipping a section's pages entirely
requires no renumbering math, just conditionally calling (or not calling) that section's builder.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/populationReport/document.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildPopulationDocument, openPopulationDocument } from "./document";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";

function baseInput() {
  const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" }), makeRow("2", "منفذ الحديثة", { portType: "بري" })];
  const sample = makeSampleMaster(populationRows);
  const distribution = makeDistribution(
    populationRows.map((r) => ({ id: r.xrayImageId, assignedTo: "user1", status: "completed" as const, row: { ...r } }))
  );
  return {
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 10,
    biRawRowCount: 8,
    populationRows,
    sampleRows: sample.rows,
    distributionEntries: distribution.entries,
    employeeDisplayNames: { user1: "أحمد" },
  };
}

describe("buildPopulationDocument", () => {
  it("produces a self-contained A4 document with all three sections", async () => {
    const html = await buildPopulationDocument(baseInput());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("تقرير المجتمع");
    expect(html).toContain("ميناء جدة");
    expect(html).toContain("منفذ الحديثة");
    expect(html).toContain("أحمد");
    expect(html).not.toContain("قيد الانتظار");
  });

  it("paginates per-employee detail rather than truncating it", async () => {
    const input = baseInput();
    // 50 distinct employees to force pagination of the employee tables
    const manyEntries = Array.from({ length: 50 }, (_, i) => ({
      xrayImageId: `IMG-${i}`,
      assignedTo: `user${i}`,
      status: "completed" as const,
      replacedById: null,
      lastEventAt: "2026-08-01T00:00:00.000Z",
      row: { ...input.populationRows[0], xrayImageId: `IMG-${i}` },
    }));
    input.distributionEntries = manyEntries;
    input.employeeDisplayNames = Object.fromEntries(manyEntries.map((e) => [e.assignedTo, `موظف ${e.assignedTo}`]));
    const html = await buildPopulationDocument(input);
    expect(html).toContain("موظف user0");
    expect(html).toContain("موظف user49"); // last employee still present, not truncated
  });

  describe("golden snapshot (deterministic-by-contract)", () => {
    it("matches the frozen-time snapshot", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
      try {
        expect(await buildPopulationDocument(baseInput())).toMatchSnapshot();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/document.test.ts`
Expected: FAIL — `Cannot find module './document'`

- [ ] **Step 3: Write the implementation**

```ts
// src/data/reporting/populationReport/document.ts
import {
  docPage,
  docCover,
  docClosing,
  docSectionDivider,
  docPageHeader,
  docKpiStrip,
  docTwoColumn,
  docPaginateTable,
} from "../executive/documentV3/shared";
import { DOCUMENT_V3_CSS } from "../executive/documentV3/theme";
import { fmtNum, fmtPct, esc } from "../executive/primitives";
import { yieldToMain } from "../../storage/yieldToMain";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { computePopulationReportModel } from "./model";
import type { PopulationReportModel, PopulationReportInput } from "./model";
import { RESULT_HEADERS, resultRow } from "./deck";
import type { PortBreakdown } from "./types";

const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

// rowsPerPage is set well above any realistic port count (a country's customs
// ports are a small, bounded list) so the [0] chunk below is never actually
// truncating data — a real unbounded list would need per-column pagination
// instead of the fixed two-column layout this page uses. If a future
// workspace ever exceeds this, this is the line to revisit.
const PORT_TABLE_ROWS_PER_PAGE = 60;

function portBreakdownPage(id: string, pageNo: string, title: string, breakdown: PortBreakdown): string {
  return docPage({
    id,
    pageNo,
    title,
    body: `${docPageHeader({ eyebrow: "", title })}
${docTwoColumn({
  land: { title: "المنافذ البرية", body: docPaginateTable({ headers: RESULT_HEADERS, rows: breakdown.land.map((p) => resultRow(p.portName, p.counts)), rowsPerPage: PORT_TABLE_ROWS_PER_PAGE })[0] },
  sea: { title: "المنافذ البحرية", body: docPaginateTable({ headers: RESULT_HEADERS, rows: breakdown.sea.map((p) => resultRow(p.portName, p.counts)), rowsPerPage: PORT_TABLE_ROWS_PER_PAGE })[0] },
})}`,
  });
}

async function buildSection1Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  let n = 1;
  const pad = (v: number) => String(v).padStart(2, "0");

  pages.push(
    docSectionDivider({ ghost: "١", kicker: "القسم الأول", title: "المجتمع", description: "المجتمع المستلم وكيف تمت معالجته" })
  );

  const summary = model.reconciled.processingSummary;
  pages.push(
    docPage({
      id: "s1-receipt",
      pageNo: pad(n++),
      title: "الاستلام",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "الاستلام" })}
${docTwoColumn({
  land: { title: "بيانات المخاطر (Risk)", body: docKpiStrip([{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.riskRawRowCount) }]) },
  sea: {
    title: "بيانات معلومات الأعمال (BI)",
    body: docKpiStrip(
      model.reconciled.biRawRowCount === null
        ? [{ label: "لم يتم توفير BI لهذا الشهر", value: "—" }]
        : [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.biRawRowCount) }]
    ),
  },
})}`,
    })
  );
  await yieldToMain();

  pages.push(
    docPage({
      id: "s1-risk",
      pageNo: pad(n++),
      title: "بيانات المخاطر — قبل وبعد",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "بيانات المخاطر — قبل وبعد" })}
${
  summary
    ? docKpiStrip([
        { label: "الصفوف الأصلية", value: fmtNum(summary.riskOriginalRows) },
        { label: "معرّفات صحيحة", value: fmtNum(summary.validRiskIdRows) },
        { label: "معرّفات غير صحيحة", value: fmtNum(summary.invalidRiskIdRows) },
        { label: "بعد إزالة التكرار", value: fmtNum(summary.rowsAfterDeduplication) },
        { label: "المجتمع النهائي", value: fmtNum(summary.finalPreparedPopulationRows) },
      ])
    : docPageHeader({ eyebrow: "", title: "لا تتوفر بيانات المعالجة لهذا الشهر" })
}`,
    })
  );
  await yieldToMain();

  const biRows = summary
    ? summary.biFieldFillSummary.map((f) => [
        { html: f.fieldName },
        { html: fmtNum(f.riskEmptyBefore) },
        { html: fmtNum(f.filledFromBi) },
        { html: fmtNum(f.stillEmptyAfter) },
        { html: fmtPct(f.fillPercentage) },
      ])
    : [];
  pages.push(
    docPage({
      id: "s1-bi",
      pageNo: pad(n++),
      title: "بيانات BI — قبل وبعد",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "بيانات BI — قبل وبعد" })}
${
  summary && summary.biProvided
    ? `${docKpiStrip([
        { label: "تمت المطابقة", value: fmtNum(summary.biMatchedRows) },
        { label: "لم تتم المطابقة", value: fmtNum(summary.biUnmatchedRows) },
        { label: "نسبة المطابقة", value: fmtPct(summary.biMatchPercentage) },
      ])}
${docPaginateTable({ headers: ["الحقل", "فارغ قبل", "تمت التعبئة", "لا يزال فارغًا", "نسبة التعبئة"], rows: biRows }).join("")}`
    : docPageHeader({ eyebrow: "", title: "لم يتم توفير BI لهذا الشهر" })
}`,
    })
  );
  await yieldToMain();

  pages.push(
    docPage({
      id: "s1-stage",
      pageNo: pad(n++),
      title: "المجتمع النهائي حسب المرحلة",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المرحلة" })}
${docPaginateTable({
  headers: RESULT_HEADERS,
  rows: model.reconciled.byStage.map((b) => resultRow(b.stageLabel, b.counts)),
  totals: resultRow("الإجمالي", model.reconciled.totals),
}).join("")}`,
    })
  );
  await yieldToMain();

  pages.push(portBreakdownPage("s1-port", pad(n++), "المجتمع النهائي حسب المنفذ", model.reconciled.byPort));
  await yieldToMain();

  return pages;
}

async function buildSection2Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  const pad = (v: number) => String(v).padStart(2, "0");
  pages.push(docSectionDivider({ ghost: "٢", kicker: "القسم الثاني", title: "العينة", description: "العينة المسحوبة من المجتمع" }));
  pages.push(
    docPage({
      id: "s2-stage",
      pageNo: pad(1),
      title: "العينة حسب المرحلة",
      body: `${docPageHeader({ eyebrow: "القسم الثاني", title: "العينة حسب المرحلة" })}
${docPaginateTable({
  headers: RESULT_HEADERS,
  rows: model.sample.byStage.map((b) => resultRow(b.stageLabel, b.counts)),
  totals: resultRow("الإجمالي", model.sample.totals),
}).join("")}`,
    })
  );
  await yieldToMain();
  pages.push(portBreakdownPage("s2-port", pad(2), "العينة حسب المنفذ", model.sample.byPort));
  await yieldToMain();
  return pages;
}

async function buildSection3Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  pages.push(docSectionDivider({ ghost: "٣", kicker: "القسم الثالث", title: "التوزيع", description: "من استلم ماذا، وما هي النتائج" }));

  const stageHeaders = ["الموظف", ...model.distribution.stageKeysPresent.map((k) => STAGE_LABELS[k] ?? k), "الإجمالي"];
  const stageRows = model.distribution.byEmployeeStage.map((emp) => [
    { html: esc(emp.displayName) },
    ...model.distribution.stageKeysPresent.flatMap((k) => {
      const c = emp.stages[k] ?? { سليمة: 0, اشتباه: 0, total: 0 };
      return [{ html: `${fmtNum(c.total)} (${fmtNum(c.سليمة)}/${fmtNum(c.اشتباه)})` }];
    }),
    { html: fmtNum(emp.total.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: stageHeaders, rows: stageRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-stage-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب الموظف والمرحلة", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمرحلة" })}${chunk}` }));
    await yieldToMain();
  }

  const portRows = model.distribution.byEmployeePort.map((emp) => [
    { html: esc(emp.displayName) },
    { html: `${fmtNum(emp.ports.land.total)} (${fmtNum(emp.ports.land.سليمة)}/${fmtNum(emp.ports.land.اشتباه)})` },
    { html: `${fmtNum(emp.ports.sea.total)} (${fmtNum(emp.ports.sea.سليمة)}/${fmtNum(emp.ports.sea.اشتباه)})` },
    { html: fmtNum(emp.total.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: ["الموظف", "برية", "بحرية", "الإجمالي"], rows: portRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-port-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب الموظف والمنفذ", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمنفذ" })}${chunk}` }));
    await yieldToMain();
  }

  const certRows = model.distribution.certScanByEmployee.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.certScanCount) },
    { html: fmtNum(emp.nonCertScanCount) },
    { html: fmtNum(emp.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: ["الموظف", "CertScan", "غير CertScan", "الإجمالي"], rows: certRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-cert-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب CertScan", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب CertScan" })}${chunk}` }));
    await yieldToMain();
  }

  return pages;
}

export async function buildPopulationDocument(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const model = computePopulationReportModel(input);
  const org = { logoUrl: "", orgName: "ضمان جودة الأشعة", lines: [] };
  const pages: string[] = [
    docCover({ org, title: "تقرير المجتمع", periodLabel: "الفترة", periodValue: model.monthLabel, metaRows: [] }),
  ];
  if (scope !== "sample") pages.push(...(await buildSection1Pages(model)));
  if (scope !== "population") {
    pages.push(...(await buildSection2Pages(model)));
    pages.push(...(await buildSection3Pages(model)));
  }
  pages.push(docClosing({ org, title: "نهاية التقرير", closingLine: `تقرير المجتمع — ${model.monthLabel}` }));

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>تقرير المجتمع — ${model.monthLabel}</title>
<style>${DOCUMENT_V3_CSS}</style></head>
<body><div class="docviewer"><aside class="sidebar no-print"><div class="doc-brand">تقرير المجتمع</div><div class="doc-brand-sub">${model.monthLabel}</div></aside>
<main class="content">${pages.join("\n")}</main></div></body></html>`;
}

export async function openPopulationDocument(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(reportWindow, () => buildPopulationDocument(input, scope), `تقرير_المجتمع_${input.monthFolderName}.html`);
}
```

Add `import type { PopulationReportScope } from "./types";` to `document.ts`'s existing import list.

- [ ] **Step 3b: Add a scope test**

Append to `document.test.ts`:

```ts
describe("export scope", () => {
  it("scope='population' excludes Sections 2+3's content", async () => {
    const html = await buildPopulationDocument(baseInput(), "population");
    expect(html).toContain("الاستلام");
    expect(html).not.toContain("العينة حسب المرحلة");
    expect(html).not.toContain("التوزيع حسب الموظف والمرحلة");
  });

  it("scope='sample' excludes Section 1's content but includes Sections 2+3 together", async () => {
    const html = await buildPopulationDocument(baseInput(), "sample");
    expect(html).not.toContain("بيانات المخاطر — قبل وبعد");
    expect(html).toContain("العينة حسب المرحلة");
    expect(html).toContain("التوزيع حسب الموظف والمرحلة");
  });
});
```

Run `npx vitest run src/data/reporting/populationReport/document.test.ts` after adding this — it must pass alongside the existing tests before moving to Step 4.

- [ ] **Step 4: Run test to verify it passes and generate the golden snapshot**

Run: `npx vitest run src/data/reporting/populationReport/document.test.ts`
Expected: PASS, snapshot file created at `src/data/reporting/populationReport/__snapshots__/document.test.ts.snap` — eyeball it before committing, same as Task 7 Step 5.

- [ ] **Step 5: Write the failing openFailure test**

```ts
// src/data/reporting/populationReport/openFailure.test.ts
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { openPopulationDocument } from "./document";
import { openPopulationDeck } from "./deck";
import { makeRow, makeManifest, makeProcessingSummary } from "../reportTestFixtures";

function makeFakeReportWindow() {
  const doc = { write: vi.fn(), close: vi.fn(), open: vi.fn() };
  return { document: doc, close: vi.fn(), closed: false } as unknown as Window;
}

function badInput() {
  return {
    monthFolderName: "8-August-2026",
    manifest: makeManifest(),
    processingSummary: makeProcessingSummary(),
    riskRawRowCount: 1,
    biRawRowCount: null,
    populationRows: [makeRow("1", "x")],
    sampleRows: [],
    distributionEntries: [],
    employeeDisplayNames: {},
  };
}

describe("openPopulationDocument / openPopulationDeck — abandoned blank tab regression", () => {
  it("closes the opened tab and never writes when the document builder throws", async () => {
    vi.doMock("./document", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./document")>();
      return { ...actual, buildPopulationDocument: vi.fn().mockRejectedValue(new Error("boom")) };
    });
    const fakeWindow = makeFakeReportWindow();
    vi.spyOn(window, "open").mockReturnValue(fakeWindow);
    await openPopulationDocument(badInput()).catch(() => undefined);
    expect((fakeWindow as unknown as { close: () => void }).close).toHaveBeenCalled();
    vi.doUnmock("./document");
  });
});
```

Note: if this mocking approach doesn't match the exact idiom `sampleReport.openFailure.test.ts` uses (it may mock `./shared/reportChrome`'s viewer builder rather than the module's own exported build function), read `sampleReport.openFailure.test.ts` first and mirror its exact mocking mechanism instead of the sketch above — the important behavioral assertion (closes on throw, never calls `document.write`) is what must be preserved, not this exact mock wiring.

- [ ] **Step 6: Run, fix mocking approach if needed, verify pass**

Run: `npx vitest run src/data/reporting/populationReport/openFailure.test.ts`
Expected: PASS after adjusting the mock to match this repo's actual working idiom from `sampleReport.openFailure.test.ts`.

- [ ] **Step 7: Typecheck, lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add src/data/reporting/populationReport/document.ts src/data/reporting/populationReport/document.test.ts \
  src/data/reporting/populationReport/openFailure.test.ts \
  src/data/reporting/populationReport/__snapshots__/document.test.ts.snap
git commit -m "Add (reporting): population report document (A4, deck3 visual language)"
```

---

### Task 9: Population Report xlsx

**Files:**
- Create: `src/data/reporting/populationReport/xlsx.ts`
- Create: `src/data/reporting/populationReport/xlsx.test.ts`

**Interfaces:**
- Consumes: `xlsx` (vendored SheetJS); `PopulationReportModel`/`PopulationReportInput`/`computePopulationReportModel` from `./model`; `yieldToMain` from `../../storage/yieldToMain`.
- Produces: `export async function buildPopulationXlsx(input: PopulationReportInput, scope: PopulationReportScope = "both"): Promise<void>` — consumed by Task 10.

**Scope note (spec §9/D11):** `scope !== "sample"` includes the two المجتمع sheets, `scope !==
"population"` includes all five العينة/التوزيع sheets together. No cross-sheet numbering concerns —
just conditionally call `book_append_sheet` for each sheet.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/populationReport/xlsx.test.ts
import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildPopulationXlsx } from "./xlsx";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

describe("buildPopulationXlsx", () => {
  it("writes one sheet per section with a filename matching the report convention", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), "تقرير_المجتمع_8-August-2026.xlsx");
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls[0][0] as XLSX.WorkBook;
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining([
        "المجتمع - المرحلة",
        "المجتمع - المنفذ",
        "العينة - المرحلة",
        "العينة - المنفذ",
        "التوزيع - الموظف والمرحلة",
        "التوزيع - الموظف والمنفذ",
        "التوزيع - CertScan",
      ])
    );
  });

  it("never includes workflow-status columns", async () => {
    const populationRows = [makeRow("1", "x")];
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: null,
      processingSummary: null,
      riskRawRowCount: 1,
      biRawRowCount: null,
      populationRows,
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    const anySheetJson = wb.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(wb.Sheets[name]));
    const serialized = JSON.stringify(anySheetJson);
    expect(serialized).not.toContain("قيد الانتظار");
    expect(serialized).not.toContain("مستبدل");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/reporting/populationReport/xlsx.test.ts`
Expected: FAIL — `Cannot find module './xlsx'`

- [ ] **Step 3: Write the implementation**

```ts
// src/data/reporting/populationReport/xlsx.ts
import * as XLSX from "xlsx";
import { computePopulationReportModel } from "./model";
import type { PopulationReportInput, PopulationReportModel } from "./model";

const STAGE_LABELS: Record<string, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
  unknown: "غير محدد",
};

function stageSheetRows(model: PopulationReportModel, source: "reconciled" | "sample") {
  const bucket = model[source];
  return [
    ...bucket.byStage.map((b) => ({ المرحلة: b.stageLabel, الإجمالي: b.counts.total, سليمة: b.counts.سليمة, اشتباه: b.counts.اشتباه })),
    { المرحلة: "الإجمالي", الإجمالي: bucket.totals.total, سليمة: bucket.totals.سليمة, اشتباه: bucket.totals.اشتباه },
  ];
}

function portSheetRows(model: PopulationReportModel, source: "reconciled" | "sample") {
  const { land, sea } = model[source].byPort;
  return [
    ...land.map((p) => ({ المنفذ: p.portName, النوع: "بري", الإجمالي: p.counts.total, سليمة: p.counts.سليمة, اشتباه: p.counts.اشتباه })),
    ...sea.map((p) => ({ المنفذ: p.portName, النوع: "بحري", الإجمالي: p.counts.total, سليمة: p.counts.سليمة, اشتباه: p.counts.اشتباه })),
  ];
}

export async function buildPopulationXlsx(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<void> {
  const model = computePopulationReportModel(input);
  const wb = XLSX.utils.book_new();

  if (scope !== "sample") {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stageSheetRows(model, "reconciled")), "المجتمع - المرحلة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(portSheetRows(model, "reconciled")), "المجتمع - المنفذ");
  }
  if (scope === "population") {
    XLSX.writeFile(wb, `تقرير_المجتمع_${input.monthFolderName}.xlsx`);
    return;
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stageSheetRows(model, "sample")), "العينة - المرحلة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(portSheetRows(model, "sample")), "العينة - المنفذ");

  const employeeStageRows = model.distribution.byEmployeeStage.map((emp) => {
    const record: Record<string, string | number> = { الموظف: emp.displayName };
    for (const key of model.distribution.stageKeysPresent) {
      const c = emp.stages[key] ?? { سليمة: 0, اشتباه: 0, total: 0 };
      record[`${STAGE_LABELS[key] ?? key} - الإجمالي`] = c.total;
      record[`${STAGE_LABELS[key] ?? key} - سليمة`] = c.سليمة;
      record[`${STAGE_LABELS[key] ?? key} - اشتباه`] = c.اشتباه;
    }
    record["الإجمالي"] = emp.total.total;
    return record;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeeStageRows), "التوزيع - الموظف والمرحلة");

  const employeePortRows = model.distribution.byEmployeePort.map((emp) => ({
    الموظف: emp.displayName,
    "برية - الإجمالي": emp.ports.land.total,
    "برية - سليمة": emp.ports.land.سليمة,
    "برية - اشتباه": emp.ports.land.اشتباه,
    "بحرية - الإجمالي": emp.ports.sea.total,
    "بحرية - سليمة": emp.ports.sea.سليمة,
    "بحرية - اشتباه": emp.ports.sea.اشتباه,
    الإجمالي: emp.total.total,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeePortRows), "التوزيع - الموظف والمنفذ");

  const certScanRows = model.distribution.certScanByEmployee.map((emp) => ({
    الموظف: emp.displayName,
    CertScan: emp.certScanCount,
    "غير CertScan": emp.nonCertScanCount,
    الإجمالي: emp.total,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(certScanRows), "التوزيع - CertScan");

  XLSX.writeFile(wb, `تقرير_المجتمع_${input.monthFolderName}.xlsx`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/reporting/populationReport/xlsx.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck, lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/populationReport/xlsx.ts src/data/reporting/populationReport/xlsx.test.ts
git commit -m "Add (reporting): population report xlsx export"
```

---

### Task 10: Public index + wire into Reports tab

**Files:**
- Create: `src/data/reporting/populationReport/index.ts`
- Modify: `src/components/Sidebar/Tabs/Reports/TabView.tsx`

**Interfaces:**
- Consumes: `buildPopulationDocument`/`openPopulationDocument` from `./document`; `buildPopulationDeck`/`openPopulationDeck` from `./deck`; `buildPopulationXlsx` from `./xlsx`; `type PopulationReportInput` from `./model`; `type PopulationReportScope` from `./types` (added in Task 7b).
- Produces: the public surface `TabView.tsx` imports via dynamic `import(".../populationReport")`.

**Scope note (spec §9/D11):** this task adds the UI half of the export-scope switch — a 3-way
segmented control (المجتمع فقط / العينة فقط / الكل, default الكل) on the تقرير المجتمع card, threaded
into every `generate()` call for this report. Tasks 7b/8/9 already built the format-side support
(`scope` parameter on every builder, defaulting to `"both"`) — this task is purely UI + wiring, no
new report-building logic.

- [ ] **Step 1: Write `index.ts`**

```ts
// src/data/reporting/populationReport/index.ts
export { buildPopulationDocument, openPopulationDocument } from "./document";
export { buildPopulationDeck, openPopulationDeck } from "./deck";
export { buildPopulationXlsx } from "./xlsx";
export type { PopulationReportInput, PopulationReportModel } from "./model";
export type { PopulationReportScope } from "./types";
```

- [ ] **Step 2: Add the new `ReportBaseType`/`ReportType` members in `TabView.tsx`**

Locate (line ~68–75):

```ts
type ReportType =
  | "sample" | "sample-xlsx" | "sample-deck"
  | "distribution" | "distribution-xlsx" | "distribution-deck"
  | "executive" | "executive-xlsx" | "executive-deck"
  | "management" | "management-xlsx" | "management-deck";
type ReportBaseType = "sample" | "distribution" | "executive" | "management";
```

Replace with:

```ts
type ReportType =
  | "population-report" | "population-report-xlsx" | "population-report-deck"
  | "executive" | "executive-xlsx" | "executive-deck"
  | "management" | "management-xlsx" | "management-deck";
type ReportBaseType = "population-report" | "executive" | "management";
```

(Note: `"sample"`/`"distribution"` are fully removed here, not kept alongside the new type — Task 12 deletes their builder modules, so leaving these members would let the app compile a dead-end `generate()` branch. This step and Task 12 must land together, or `generate()`'s sample/distribution branches must be removed in this same step — see Step 4 below, which removes them now rather than deferring to Task 12, so the codebase never has a `ReportType` member with no matching branch.)

- [ ] **Step 3: Update the `formats` state default**

Find the `formats` state initialization (a `Record<ReportBaseType, ReportFormat>` with a default entry per base type) and change its `sample`/`distribution` keys to a single `"population-report"` key (default `"document"`, matching the existing convention for every other base type).

- [ ] **Step 4: Replace the sample/distribution branches in `generate()` with one population-report branch**

In the `generate(type: ReportType)` function, remove the two `if` blocks handling `"sample"|"sample-xlsx"|"sample-deck"` and `"distribution"|"distribution-xlsx"|"distribution-deck"` (previously lines ~612–670), replacing them with:

```ts
if (type === "population-report" || type === "population-report-xlsx" || type === "population-report-deck") {
  const { populationRows, sampleData, distributionCurrent, manifest, processingSummary, riskRawRows, biRawRows } =
    await loadMonthForEditing(directoryHandle, selectedMonth);
  if (!sampleData) {
    showToast("error", "لم يتم العثور على بيانات عينة لهذا الشهر.");
    return;
  }
  const { liveSampleRows } = await import("../../../../data/sampling/sampleStorage");
  const [populationRev, sampleRev] = await Promise.all([
    loadMonthPopulationFinalRevision(directoryHandle, selectedMonth),
    loadSampleMasterRevision(directoryHandle, selectedMonth),
  ]);
  const input = {
    monthFolderName: selectedMonth,
    manifest,
    processingSummary: processingSummary?.summary ?? null,
    riskRawRowCount: riskRawRows.length,
    biRawRowCount: processingSummary?.summary?.biProvided ? biRawRows.length : null,
    populationRows: (populationRows ?? []) as unknown as PreparedPopulationRow[],
    sampleRows: liveSampleRows(sampleData),
    distributionEntries: distributionCurrent?.entries ?? [],
    employeeDisplayNames: buildDisplayNameMap(),
    sourceRevisions: collectRevisions([
      { label: "المجتمع", revision: populationRev },
      { label: "العينة", revision: sampleRev },
    ]),
  };
  if (type === "population-report-xlsx") {
    const { buildPopulationXlsx } = await import("../../../../data/reporting/populationReport");
    await buildPopulationXlsx(input, populationReportScope);
  } else if (type === "population-report-deck") {
    const { openPopulationDeck } = await import("../../../../data/reporting/populationReport");
    await openPopulationDeck(input, populationReportScope);
  } else {
    const { openPopulationDocument } = await import("../../../../data/reporting/populationReport");
    await openPopulationDocument(input, populationReportScope);
  }
}
```

(`populationReportScope` is the component-level state added in Step 5b below — this branch reads it directly, the same way it already reads other component state like `selectedMonth`.)

Verify the exact relative import depth (`../../../../data/reporting/populationReport`) against `TabView.tsx`'s real path (`src/components/Sidebar/Tabs/Reports/TabView.tsx` is 4 levels below `src/`, matching the existing dynamic import depth already used for `sampleReport`/`distributionReport` in the code being replaced — copy that exact prefix rather than re-deriving it, to avoid an off-by-one).

Confirm `collectRevisions` accepts this array shape by checking its existing call in the code you're replacing — reuse the exact same helper signature already used by the sample branch, not a new shape.

- [ ] **Step 5: Replace the two cards with one**

Remove the Sample card block (~lines 1019–1040) and the Distribution card block (~lines 1043–1063). Insert one new card in their place, following the exact same `.rh-card` structure documented by this plan's research:

```tsx
<div className="rh-card rh-acc-navy">
  <div className="rh-icon"><Layers size={22} /></div>
  <span className="rh-badge">جاهز</span>
  <h3 className="rh-card-title">تقرير المجتمع</h3>
  <p className="rh-card-desc">
    من المجتمع المستلم، إلى العينة المسحوبة، إلى التوزيع على الموظفين — سليمة/اشتباه في كل خطوة.
  </p>
  <div className="rh-tags">
    <span>المجتمع</span>
    <span>العينة</span>
    <span>التوزيع</span>
    <span>XLSX</span>
  </div>
  <div className="rh-card-footer">{renderExportControls("population-report", "rh-btn-navy")}</div>
</div>
```

Add `Layers` to the existing `lucide-react` import line at the top of `TabView.tsx` if it isn't already imported (it likely already is, since `sampleReport.ts`'s doc pages use `iconName: "layers"` in the old chrome — but that's a string key into an icon-name lookup, not necessarily the same as a direct `lucide-react` import in `TabView.tsx`; check the existing import list and add `Layers` from `"lucide-react"` if missing).

- [ ] **Step 5b: Add the export-scope segmented control (spec §9/D11)**

Add component state (near the existing `deckEdition` state, ~line 242):

```ts
const [populationReportScope, setPopulationReportScope] = useState<PopulationReportScope>("both");
```

Add the import (alongside the other `populationReport` type imports this task already needs):

```ts
import type { PopulationReportScope } from "../../../../data/reporting/populationReport/types";
```

Before writing the control's JSX, read `renderExportControls`'s existing 3-way format toggle (deck/xlsx/document — the same function this card already calls at the bottom of the card block) to see its real CSS class names and button structure. Mirror that exact pattern for visual consistency — this card should not introduce a visibly different toggle style from the format toggle sitting directly below it. If, after reading it, the format toggle's classes are a clean fit, reuse them directly (e.g. wrap the same button/icon-button class in a new row); if they're too tightly coupled to icon-based formats to reuse for text-only labels, fall back to this plain, self-contained structure instead of forcing a mismatch:

```tsx
<div className="rh-scope-toggle" role="radiogroup" aria-label="نطاق التصدير">
  {(
    [
      { value: "population" as const, label: "المجتمع فقط" },
      { value: "sample" as const, label: "العينة فقط" },
      { value: "both" as const, label: "الكل" },
    ]
  ).map((opt) => (
    <button
      key={opt.value}
      type="button"
      className={`rh-scope-btn${populationReportScope === opt.value ? " rh-scope-btn-active" : ""}`}
      aria-pressed={populationReportScope === opt.value}
      onClick={() => setPopulationReportScope(opt.value)}
    >
      {opt.label}
    </button>
  ))}
</div>
```

Place this inside the تقرير المجتمع card, above `renderExportControls`'s call (so scope is chosen before format/export). If you used the fallback structure, add matching CSS to `src/components/Sidebar/Tabs/Reports/Reports.css` — a plain segmented-button row is enough (flex row, one bordered button per option, an `-active` modifier class with a filled/highlighted background); mirror the existing `.rh-deck-edition-toggle` or format-toggle button's border-radius/padding/font-size values from the same file so it doesn't look like a foreign component bolted onto the card.

- [ ] **Step 6: Update the "Quick actions" bar**

Find the three shortcut buttons calling `generate("executive")`, `generate("sample")`, `generate("distribution")` (~lines 1131–1160). Replace the `generate("sample")` and `generate("distribution")` buttons with one `generate("population-report")` button, keeping the same label/icon pattern as its siblings.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: this is where any remaining reference to `"sample"`/`"distribution"` `ReportType` members, or to `buildSampleXlsx`/`openSampleDeck`/etc. still imported somewhere in `TabView.tsx`, will surface as a compile error — fix every one before moving on. (`sampleReport.ts`/`distributionReport.ts` themselves are NOT deleted until Task 12, so this step only breaks if `TabView.tsx` itself still references the old identifiers — it must not, after Steps 2–6.)

- [ ] **Step 8: Manual smoke test in the dev server**

Run: `npm run dev`, open the Reports tab in Chrome/Edge with a workspace that has at least one processed-and-sampled-and-distributed month selected. Confirm: only one card reads "تقرير المجتمع" (no leftover Sample/Distribution cards), the format toggle (deck/xlsx/document) works, and clicking "التصدير" for each format produces a report containing real Arabic content with no console errors. Also exercise the new scope switch: select "المجتمع فقط" and export the deck — confirm it opens with only Section 1 content (no العينة/التوزيع slides) and the contents page lists only one section; switch to "العينة فقط" and confirm the opposite (Section 1 absent, Sections 2+3 present together); confirm "الكل" (the default) still produces the full three-section report. This is a UI change — CLAUDE.md requires exercising it in a real browser, not just trusting the test suite.

- [ ] **Step 9: Lint**

Run: `npm run lint`

- [ ] **Step 10: Commit**

```bash
git add src/data/reporting/populationReport/index.ts src/components/Sidebar/Tabs/Reports/TabView.tsx
git commit -m "Change (reports): replace Sample/Distribution cards with تقرير المجتمع"
```

---

### Task 11: Migrate shared test coverage off the old builders

**Files:**
- Modify: `src/data/reporting/reportBuilders.xss.test.ts`
- Modify: `src/data/reporting/sourceRevisions.test.ts`

**Interfaces:**
- Consumes: `buildPopulationDocument`, `buildPopulationDeck` from `./populationReport`; `PopulationReportInput` from `./populationReport/model`.

- [ ] **Step 1: Read the current sample/distribution `describe` blocks in `reportBuilders.xss.test.ts`**

Note their exact malicious-fixture construction pattern (which fields get which `XSS_PAYLOADS` entry) so the replacement blocks inject payloads into equivalently sensitive fields of the new input shape (port names, employee display names, month folder name, manifest fields).

- [ ] **Step 2: Replace the sample/distribution blocks with population-report blocks**

```ts
// in reportBuilders.xss.test.ts, replacing the buildSampleDocument/buildSampleDeck
// and buildDistributionDocument/buildDistributionDeck describe blocks
import { buildPopulationDocument, buildPopulationDeck } from "./populationReport";

describe("buildPopulationDocument / buildPopulationDeck — XSS safety", () => {
  function maliciousInput(): PopulationReportInput {
    return {
      monthFolderName: XSS_PAYLOADS.attrBreak,
      manifest: null,
      processingSummary: null,
      riskRawRowCount: 1,
      biRawRowCount: null,
      populationRows: [
        {
          ...baseRow(),
          portName: XSS_COMBINED,
          xrayImageId: XSS_PAYLOADS.imgOnerror,
        },
      ],
      sampleRows: [],
      distributionEntries: [
        {
          xrayImageId: "1",
          assignedTo: "user1",
          status: "completed",
          replacedById: null,
          lastEventAt: "2026-08-01T00:00:00.000Z",
          row: { ...baseRow(), portName: XSS_PAYLOADS.scriptTag },
        } as never,
      ],
      employeeDisplayNames: { user1: XSS_PAYLOADS.svgOnload },
    };
  }

  it("buildPopulationDocument neutralizes every payload", async () => {
    assertSafe(await buildPopulationDocument(maliciousInput()));
  });

  it("buildPopulationDeck neutralizes every payload", async () => {
    assertSafe(await buildPopulationDeck(maliciousInput()));
  });
});
```

(`baseRow()` — write a tiny local helper returning a minimally-valid `PreparedPopulationRow`, matching the fixture style `makeRow` already uses elsewhere in this file for the builders being replaced; reuse `makeRow` from `./reportTestFixtures` directly if its signature fits, rather than writing a new helper.)

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/data/reporting/reportBuilders.xss.test.ts`
Expected: PASS — both new blocks green, old sample/distribution blocks gone (not just skipped).

- [ ] **Step 4: Repoint `sourceRevisions.test.ts`**

Read `src/data/reporting/sourceRevisions.test.ts` to find its `buildSampleDocument`/`buildSampleDeck` import and usage (it uses them only as "a convenient real HTML-producing builder," per this plan's research — not testing sample-report-specific behavior). Replace the import with `buildPopulationDocument`/`buildPopulationDeck` from `./populationReport`, and adjust whatever minimal input object the test constructs to match `PopulationReportInput`'s shape instead of `SampleReportInput`'s.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/data/reporting/sourceRevisions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full reporting suite**

Run: `npx vitest run src/data/reporting`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/reportBuilders.xss.test.ts src/data/reporting/sourceRevisions.test.ts
git commit -m "Test (reporting): migrate XSS and source-revisions coverage to populationReport"
```

---

### Task 12: Retire `sampleReport.ts` and `distributionReport.ts`

**Files:**
- Delete: `src/data/reporting/sampleReport.ts`, `src/data/reporting/sampleReport.test.ts`, `src/data/reporting/sampleReport.openFailure.test.ts`, `src/data/reporting/__snapshots__/sampleReport.test.ts.snap`
- Delete: `src/data/reporting/distributionReport.ts`, `src/data/reporting/distributionReport.test.ts`, `src/data/reporting/distributionReport.openFailure.test.ts`, `src/data/reporting/__snapshots__/distributionReport.test.ts.snap`

**Interfaces:** none — by this point (Tasks 2, 10, 11 complete), nothing imports these files. This task is pure deletion plus a repo-wide confirmation grep.

- [ ] **Step 1: Grep-confirm no remaining importers**

Run:
```bash
grep -rn "from .*sampleReport\"" src --include="*.ts" --include="*.tsx"
grep -rn "from .*distributionReport\"" src --include="*.ts" --include="*.tsx"
```
Expected: zero matches (Task 2 already moved `computeDistributionModel`/`DistributionBucket` out; Task 10 repointed `TabView.tsx`; Task 11 repointed `reportBuilders.xss.test.ts` and `sourceRevisions.test.ts`). If anything still matches, stop and repoint it before deleting — do not delete a file something still imports.

- [ ] **Step 2: Delete the files**

```bash
git rm src/data/reporting/sampleReport.ts src/data/reporting/sampleReport.test.ts \
  src/data/reporting/sampleReport.openFailure.test.ts \
  src/data/reporting/__snapshots__/sampleReport.test.ts.snap
git rm src/data/reporting/distributionReport.ts src/data/reporting/distributionReport.test.ts \
  src/data/reporting/distributionReport.openFailure.test.ts \
  src/data/reporting/__snapshots__/distributionReport.test.ts.snap
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:run`
Expected: PASS, total test count down by exactly the number of tests in the four deleted `.test.ts` files (their real coverage already lives in `distributionCoverageModel.test.ts`, `populationReport/*.test.ts`, and the migrated `reportBuilders.xss.test.ts`/`sourceRevisions.test.ts` — nothing should be silently lost).

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed — `build` in particular catches any lingering reference `test:run`'s per-file transpilation wouldn't (per CLAUDE.md's build-vs-test-suite gotcha).

- [ ] **Step 5: Commit**

```bash
git commit -m "Remove (reporting): retire sampleReport.ts and distributionReport.ts"
```

---

### Task 13: Final Tier-3 gate sweep, edit log, release

**Files:**
- Modify: `docs/edit logs/2026-08-27.md` (via `npm run editlog`)
- Modify: `package.json` (version bump, via `--sync-package`)

**Interfaces:** none — this task runs the full CLAUDE.md Tier 3 gate list and records it.

- [ ] **Step 1: Run every Tier 3 gate**

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check:complexity
npm run check:hex-literals
npm run check:release
npm run check:vendor
npm run build
npm run check:bundle-size
```

Fix anything that fails before proceeding — in particular, `check:complexity` may flag `document.ts` or `deck.ts` if either grew too large/complex in one function; if so, split the offending function (e.g. break `buildSection3Pages` into three smaller named functions, one per sub-table) rather than suppressing the check.

- [ ] **Step 2: Generate the edit-log entry**

```bash
npm run editlog -- --tier=3 --append --sync-package "Refactor: merge Sample + Distribution reports into تقرير المجتمع"
```

Fill in the generated skeleton's `Why:`/`What changed:` prose, covering: the merge itself (D1–D10 from the spec), the `computeDistributionModel` relocation (Task 2) and why it was necessary, the new `documentV3` chrome, and the retirement of the two old builders — one `**File:**` block per file touched across all 13 tasks (the `editlog` script's own file-diff scan fills this in mechanically; review it for completeness against this plan's File Map before treating it as done).

- [ ] **Step 3: Confirm the version bump matches the change's weight**

Per CLAUDE.md's semver-lite rule, this is an architectural change (major feature retirement + new report) — bump the whole number (e.g. `v127.0` if `v126.x` was current), not the decimal. Confirm `--sync-package` applied this correctly in `package.json`.

- [ ] **Step 4: Final full-suite confirmation**

Run: `npm run test:run && npm run build`
Expected: both green, one more time, after the edit-log/version-bump commit — a version-only change shouldn't break anything, but confirm rather than assume.

- [ ] **Step 5: Commit**

```bash
git add "docs/edit logs/2026-08-27.md" package.json
git commit -m "Docs (edit-log/release): document the تقرير المجتمع merge, bump version"
```

- [ ] **Step 6: Push and update the PR**

```bash
git push -u origin claude/sample-population-reports-zj0xwd
```

Update PR #122's description to reflect that it now contains the full implementation (not just the design spec) — update its "Test plan" checklist to check off the golden snapshots / lint / typecheck / test:run / build items now that they're real, and mark the PR ready for review (undraft) once every Tier 3 gate is green.

---

## Self-Review Notes

- **Spec coverage:** D1 (Task 10, one card), D2/D3 (Tasks 6–9, three sections with Risk|BI two-table Section 1 page), D4 (verified by explicit "no workflow-status text" assertions in Tasks 6/7/8/9's tests), D5 (Task 1's `classifyImageResult`, used throughout Task 3's fold helpers), D6 (`isSeaPort` in Task 3), D7 (CertScan slide/page, last in Section 3 — Tasks 7/8/9), D8 (deck3-based deck in Tasks 6–7, new documentV3-based document in Task 5/8), D9 (all-new `populationReport/` module, Task 3 onward), D10 (Task 9). §4.2's raw-row-count constraint is honored — Section 1 never attempts sheet-level detail, only `processingSummary` + raw `.length` counts (Task 10 Step 4). §7's migration/cleanup is Tasks 2, 11, 12. §8's open items are resolved by this plan's architecture section: single-file-per-concern module layout (not one giant file), `imageResult` extracted now (Task 1), documentV3's API surface defined in Task 5, `reportBuilders.xss.test.ts` migrated in the same effort (Task 11) rather than deferred.
- **Placeholder scan:** no TODO/TBD/"handle appropriately" strings in any task's code blocks; every function referenced by a later task is defined with a concrete signature by an earlier task.
- **Type consistency:** `ResultCounts`/`StageBucket`/`PortBucket`/`PortBreakdown`/`EmployeeStageRow`/`EmployeePortRow`/`EmployeeCertScanRow` are defined once in Task 3's `types.ts` and used with identical field names through Tasks 4, 6, 7, 8, 9. `PopulationReportInput`/`PopulationReportModel` are defined once in Task 4 and reused verbatim (never renamed) through every later task and the TabView wiring in Task 10.
