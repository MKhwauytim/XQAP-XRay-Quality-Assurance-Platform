# Executive Report Design Toggle (deck3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new executive-deck edition ("deck3") that reproduces the visual design of `design_handoff_xray_qa_deck` (21 fixed slides, its own color/type/chart system) wired to REAL report data, toggleable from the Reports tab, with `deck2` completely unchanged and the toggle's chosen edition persisted to the workspace.

**Architecture:** New sibling module `src/data/reporting/executive/deck3/` (theme + chartKit + slideKit + slides + index), fed by data already computed for `deck2` — five `deck2/section3/*.ts` files get a small number of existing private functions promoted to exported functions (pure additive refactor, zero behavior change, existing tests are the safety net) so deck3 reuses the exact same business logic instead of duplicating it. A new shared, CAS-protected preference file (mirroring `deck2/styleChoices.ts`'s pattern exactly) persists which edition is active. `TabView.tsx` gets a toggle that flips which module `generate()`/`handleExport()` dynamically import.

**Tech Stack:** React 19 + TypeScript (strict), Vite, Vitest (`node` env by default), existing `safeWrite`/`casLoop`/`webLocks` storage primitives, `Somar Sans` font already embedded in `src/branding/somarFonts.ts`.

**Spec:** `docs/superpowers/specs/2026-08-25-executive-report-design-toggle-design.md` — read it alongside this plan; it is the source of truth for exact color/type/spacing tokens, the full 21-slide list with descriptions, locked Arabic terminology, and the chart-construction CSS pattern. The design handoff itself is checked into this repo at `docs/design/design_handoff_xray_qa_deck/` — `README.md` there has the complete per-slide visual description (§"Slides (in order)") and is the authoritative visual reference for any layout detail not repeated verbatim below; `Executive Report Deck v2.dc.html` in that same folder is the actual shipped 21-slide deck (used in Task 11 for the exact locked risk-level definition text).

## Global Constraints

- Node `>=22 <23` (`package.json` engines) — no other runtime assumptions.
- `deck2` (any file under `src/data/reporting/executive/deck2/`, EXCEPT the 6 named export-promotion edits in Tasks 1-6) must not change behavior. Every extraction task's own existing test file must still pass unmodified (or with only an added import), proving this.
- All new UI strings are Arabic, RTL. Locked terminology from the spec (verbatim, never substitute a synonym): `نتائج الوسائل الآلية`, `صورة`/`صور`, `نتيجة`/`نتائج`, `نسبة تحديد موقع الاشتباه`, `دقة السليمة`, `دقة الاشتباه`, `الدقة العامة`, security team names `الوسائل الحية`، `المعاين`، `التفتيش المعاكس`. Differences are always phrased as "+X% فرق ... (A مقابل B)" — never "نقاط".
- `deck3` reuses `SOMAR_SANS_WOFF` from `src/branding/somarFonts.ts` and the ZATCA logo from `src/branding/zatca-logo.svg` — do not add new font/logo asset files.
- Every new/changed report-data function must be a pure function of its inputs (no `Date.now()`/`Math.random()` inside deck3 — sampling/report determinism convention).
- Workspace writes go through `safeWriteJson`/`safeReadJson` (`src/data/storage/safeWrite.ts`) — never raw `getFileHandle`/`createWritable`.
- Tier 3 edit-log entry (`npm run editlog -- --tier=3 ...`) at the end, full gate sweep before calling this done: `lint`, `typecheck`, `test:run`, `check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`.

---

## File Structure

```
src/data/reporting/executive/deck2/section3/
  levelAccuracy.ts        # MODIFY: export collectLevelAccuracyRows + types
  portAgreement.ts        # MODIFY: export collectPortAgreementRows + types
  riskEngineAgreement.ts  # MODIFY: export 4 compute fns + types
  markingImpact.ts        # MODIFY: export computeMarkingImpact + types
  qualityImpact.ts        # MODIFY: export collectQualityStrata (renamed computeQualityImpactStrata) + accuracyGradient + types
  sourceAgreement.ts      # MODIFY: export reviewerTotals (renamed computeReviewerTotals) + type

src/data/reporting/executive/
  deckEditionPreference.ts       # NEW: load/save {edition:"v2"|"v3"} to workspace
  deckEditionPreference.test.ts  # NEW

src/data/reporting/executive/deck3/
  theme.ts          # NEW: DECK_V3_CSS — handoff's tokens, font-face, slide chrome
  chartKit.ts        # NEW: barChart()/groupedBarChart() — the exact CSS bar pattern
  chartKit.test.ts   # NEW: percentage-scale math
  slideKit.ts        # NEW: generic template functions (cover/contents/glossary/kpi/divider/twoPanelTable/matrix/comparisonPanels/impactSplit)
  slides.ts          # NEW: the 21 concrete handoff slides, fed by real model data
  index.ts            # NEW: buildExecutiveDeckV3 / openExecutiveDeckV3
  deck3.test.ts       # NEW: integration test (slide count/order/figures/terminology)

src/components/Sidebar/Tabs/Reports/
  TabView.tsx         # MODIFY: load/save/toggle deckEdition, route generate()/handleExport() to v2 or v3
  index.test.tsx       # MODIFY: add toggle test case
```

---

## Task 1: Promote `collectLevelAccuracyRows` to an exported function

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/levelAccuracy.ts`
- Test: `src/data/reporting/executive/deck2/section3/levelAccuracy.test.ts` (existing — add one new test, don't remove any)

**Interfaces:**
- Produces: `export function collectLevelAccuracyRows(model: ReportModel): { land: LevelAccuracyRow[]; sea: LevelAccuracyRow[] }`, `export type LevelAccuracyRow = { name: string; sea: boolean; l1: LevelStats; l2: LevelStats }`, `export type LevelStats = { counts: LevelCounts; evaluable: number; accuracy: number | null; detection: number | null; rankable: boolean; detectionRankable: boolean }`, `export type LevelCounts = { correctClean: number; correctSuspicion: number; missedSuspicion: number; falseSuspicion: number }`.

- [ ] **Step 1: Read the current file to confirm the exact (unexported) declarations of `collectLevelAccuracyRows`, `LevelAccuracyRow`, `LevelStats`, `LevelCounts`**

Open `src/data/reporting/executive/deck2/section3/levelAccuracy.ts` and locate these four declarations. Do not change their bodies.

- [ ] **Step 2: Add `export` to all four declarations**

Change `function collectLevelAccuracyRows(` to `export function collectLevelAccuracyRows(`, `type LevelAccuracyRow = ` to `export type LevelAccuracyRow = `, and likewise for `LevelStats` and `LevelCounts`. No other code in the file changes.

- [ ] **Step 3: Write a new test confirming the export works and returns real data**

Add to `levelAccuracy.test.ts` (using whatever `ReportModel`-building test helper the existing tests in that file already use — copy their fixture pattern, don't invent a new one):

```ts
import { collectLevelAccuracyRows } from "./levelAccuracy";

it("collectLevelAccuracyRows is exported and returns land/sea rows", () => {
  const model = buildTestModel(/* reuse this file's existing fixture helper/args */);
  const { land, sea } = collectLevelAccuracyRows(model);
  expect(Array.isArray(land)).toBe(true);
  expect(Array.isArray(sea)).toBe(true);
});
```

- [ ] **Step 4: Run the test file**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/levelAccuracy.test.ts`
Expected: all tests PASS (existing ones unchanged, new one passes).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/levelAccuracy.ts src/data/reporting/executive/deck2/section3/levelAccuracy.test.ts
git commit -m "Refactor (deck2/section3): export collectLevelAccuracyRows for reuse by deck3"
```

---

## Task 2: Promote `collectPortAgreementRows` to an exported function

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/portAgreement.ts`
- Test: `src/data/reporting/executive/deck2/section3/portAgreement.test.ts`

**Interfaces:**
- Produces: `export function collectPortAgreementRows(model: ReportModel): { land: PortAgreementRow[]; sea: PortAgreementRow[] }`, `export type PortAgreementRow = { name: string; sea: boolean; l1l2Comparable: number; l1l2Agree: number; l1RevComparable: number; l1RevAgree: number; l2RevComparable: number; l2RevAgree: number; reviewed: number }`.

- [ ] **Step 1: Read the file, confirm the exact declarations of `collectPortAgreementRows` and `PortAgreementRow`**
- [ ] **Step 2: Add `export` to both declarations** (same mechanical change as Task 1 Step 2)
- [ ] **Step 3: Add a test to `portAgreement.test.ts`**

```ts
import { collectPortAgreementRows } from "./portAgreement";

it("collectPortAgreementRows is exported and returns land/sea rows", () => {
  const model = buildTestModel(/* reuse this file's existing fixture helper */);
  const { land, sea } = collectPortAgreementRows(model);
  expect(Array.isArray(land)).toBe(true);
  expect(Array.isArray(sea)).toBe(true);
});
```

- [ ] **Step 4: Run** `npx vitest run src/data/reporting/executive/deck2/section3/portAgreement.test.ts` — expect PASS.
- [ ] **Step 5: Run** `npm run typecheck` — expect no errors.
- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/portAgreement.ts src/data/reporting/executive/deck2/section3/portAgreement.test.ts
git commit -m "Refactor (deck2/section3): export collectPortAgreementRows for reuse by deck3"
```

---

## Task 3: Promote the 4 risk-engine computations to exported functions

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/riskEngineAgreement.ts`
- Test: `src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts`

**Interfaces:**
- Produces:
  - `export function coverageOf(rows: ExecutiveReportRow[]): Coverage` where `Coverage = { recognized: number; unrecognized: number; blank: number }`
  - `export function buildAgreementRows(rows: ExecutiveReportRow[]): AgreementRow[]` where `AgreementRow = { label: string; n: number; agree: number; rate: number | null; headline: boolean }` (this wraps the internal `agreementFold` calls — export the existing `buildAgreementRows` wrapper, not `agreementFold` itself, since `buildAgreementRows` is already the file's own top-level orchestration of the 3 `agreementFold` calls)
  - `export function foldDisagreementSet(rows: ExecutiveReportRow[]): DisagreementFold` where `DisagreementFold = { total: number; reviewed: number; confirmed: number; cleared: number; outsideSample: number; awaitingReview: number; confirmedRate: number | null }`
  - `export function foldReportRows(rows: ExecutiveReportRow[]): ReportFold` where `ReportFold = { n: number; l1Suspected: number; l2Suspected: number; reviewed: number; reviewConfirmed: number; l1Rate: number | null; l2Rate: number | null; reviewRate: number | null }`
  - Export the `Coverage`, `AgreementRow`, `DisagreementFold`, `ReportFold` type aliases too.

- [ ] **Step 1: Read the file, confirm exact current names/signatures of `coverageOf`, `buildAgreementRows`, `foldDisagreementSet`, `foldReportRows` and their 4 type aliases** — if `buildAgreementRows` does not exist as a named top-level function (i.e. the 3 `agreementFold` calls are inlined directly in `riskEngineAgreementSlide`), extract them into a new top-level function `buildAgreementRows(rows: ExecutiveReportRow[]): AgreementRow[]` first (same 3 calls, same labels, moved verbatim out of the slide function into their own function, then called from the slide function) — this is the one function in this task that may need real extraction rather than just adding `export`; everything else is a straight `export` addition.
- [ ] **Step 2: Add `export` to `coverageOf`, `buildAgreementRows` (extracting it per Step 1 if needed), `foldDisagreementSet`, `foldReportRows`, and their 4 return-type aliases**
- [ ] **Step 3: Add tests to `riskEngineAgreement.test.ts`**

```ts
import { coverageOf, buildAgreementRows, foldDisagreementSet, foldReportRows } from "./riskEngineAgreement";

it("exports the 4 risk-engine computation functions with working output shapes", () => {
  const rows = /* reuse this file's existing ExecutiveReportRow[] fixture */;
  const coverage = coverageOf(rows);
  expect(coverage.recognized + coverage.unrecognized + coverage.blank).toBe(rows.length);
  expect(Array.isArray(buildAgreementRows(rows))).toBe(true);
  const dis = foldDisagreementSet(rows);
  expect(dis.total).toBeGreaterThanOrEqual(0);
  const rpt = foldReportRows(rows);
  expect(rpt.n).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 4: Run** `npx vitest run src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts` — expect PASS (existing tests unchanged, new one passes).
- [ ] **Step 5: Run** `npm run typecheck` — expect no errors.
- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/riskEngineAgreement.ts src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts
git commit -m "Refactor (deck2/section3): export risk-engine computation functions for reuse by deck3"
```

---

## Task 4: Extract + export `computeMarkingImpact`

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/markingImpact.ts`
- Test: `src/data/reporting/executive/deck2/section3/markingImpact.test.ts`

**Interfaces:**
- Produces: `export function computeMarkingImpact(model: ReportModel): { present: MarkStratum; absent: MarkStratum; unknown: number; recorded: number }` where `export type MarkStratum = { label: string; caption: string; tone: "green" | "coral"; n: number; accurate: number; outcomes: { correctClean: number; correctSusp: number; missedSusp: number; falseSusp: number }; rankable: boolean; accuracy: number | null; detection: number | null; detectionRankable: boolean }`. Also export `comparable`, `effectOf`, `outcomeShare` (the existing pure helpers).

- [ ] **Step 1: Read `markingImpactSlide` in the current file to find its two `foldStratum(rows, label, caption, tone)` call sites (the "with marking"/"present" arm and the "without marking"/"absent" arm) — note their exact `label`/`caption`/`tone` literal arguments and how `rows` is filtered before each call (verificationCategory !== null, then hasMarking === true / === false)**
- [ ] **Step 2: Add `export` to `foldStratum`, `MarkStratum`, `comparable`, `effectOf`, `outcomeShare`**
- [ ] **Step 3: Add a new exported function `computeMarkingImpact(model: ReportModel)` that reproduces exactly the two `foldStratum` calls found in Step 1 (same filtering, same label/caption/tone literals), plus the `unknown`/`recorded` counts the slide function already derives around them, and returns `{ present, absent, unknown, recorded }`**

```ts
export function computeMarkingImpact(model: ReportModel): {
  present: MarkStratum;
  absent: MarkStratum;
  unknown: number;
  recorded: number;
} {
  // Reproduce the exact filtering/labels/captions/tones read from markingImpactSlide
  // in Step 1 — do not invent new literals. Example shape (fill in the real
  // label/caption/tone strings found in the file):
  const scoped = model.rows.filter((r) => r.verificationCategory !== null);
  const present = foldStratum(
    scoped.filter((r) => r.hasMarking === true),
    /* exact label literal from Step 1 */,
    /* exact caption literal from Step 1 */,
    "green",
  );
  const absent = foldStratum(
    scoped.filter((r) => r.hasMarking === false),
    /* exact label literal from Step 1 */,
    /* exact caption literal from Step 1 */,
    "coral",
  );
  const unknown = model.rows.length - scoped.length;
  return { present, absent, unknown, recorded: scoped.length };
}
```

- [ ] **Step 4: Update `markingImpactSlide` to call `computeMarkingImpact(model)` instead of its own inline two `foldStratum` calls, destructuring `{ present, absent }` from the result** — the rendered HTML output must be byte-identical to before this change (same data, same call order).
- [ ] **Step 5: Add a test to `markingImpact.test.ts`**

```ts
import { computeMarkingImpact } from "./markingImpact";

it("computeMarkingImpact returns present/absent strata summing to the recorded count", () => {
  const model = /* reuse this file's existing ReportModel fixture */;
  const { present, absent, recorded } = computeMarkingImpact(model);
  expect(present.n + absent.n).toBe(recorded);
});
```

- [ ] **Step 6: Run** `npx vitest run src/data/reporting/executive/deck2/section3/markingImpact.test.ts` — expect PASS, including any existing snapshot/HTML-content tests (proves the refactor didn't change output).
- [ ] **Step 7: Run** `npm run typecheck` — expect no errors.
- [ ] **Step 8: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/markingImpact.ts src/data/reporting/executive/deck2/section3/markingImpact.test.ts
git commit -m "Refactor (deck2/section3): extract computeMarkingImpact for reuse by deck3"
```

---

## Task 5: Promote `collectQualityStrata` (as `computeQualityImpactStrata`) + `accuracyGradient`

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/qualityImpact.ts`
- Test: `src/data/reporting/executive/deck2/section3/qualityImpact.test.ts`

**Interfaces:**
- Produces: `export function computeQualityImpactStrata(rows: readonly ExecutiveReportRow[]): QualityFold` where `export type QualityStratum = { level: "عالي" | "متوسط" | "منخفض"; n: number; accurate: number; correctSuspicious: number; missedSuspicious: number; bandKey: DataSufficiencyBand; rankable: boolean; accuracy: number | null; missedRate: number | null; suspiciousBase: number; missedRateRankable: boolean }`, `export type QualityFold = { strata: QualityStratum[]; unknown: number; evaluated: number }`, `export function accuracyGradient(strata: QualityStratum[]): number | null`.

- [ ] **Step 1: Read the file, confirm the exact current name is `collectQualityStrata` (per the design spec) and its signature/return shape, plus `accuracyGradient`'s signature**
- [ ] **Step 2: Rename `collectQualityStrata` to `computeQualityImpactStrata` (update its one internal call site in the slide function to the new name too) and add `export` to it, to `QualityStratum`, `QualityFold`, and to `accuracyGradient`**
- [ ] **Step 3: Add a test to `qualityImpact.test.ts`**

```ts
import { computeQualityImpactStrata, accuracyGradient } from "./qualityImpact";

it("computeQualityImpactStrata returns 3 strata and accuracyGradient computes a delta", () => {
  const rows = /* reuse this file's existing ExecutiveReportRow[] fixture */;
  const fold = computeQualityImpactStrata(rows);
  expect(fold.strata.length).toBe(3);
  const gradient = accuracyGradient(fold.strata);
  expect(typeof gradient === "number" || gradient === null).toBe(true);
});
```

- [ ] **Step 4: Run** `npx vitest run src/data/reporting/executive/deck2/section3/qualityImpact.test.ts` — expect PASS (existing tests unaffected by the rename since it's an internal-name-only change with the same one call site updated).
- [ ] **Step 5: Run** `npm run typecheck` — expect no errors.
- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/qualityImpact.ts src/data/reporting/executive/deck2/section3/qualityImpact.test.ts
git commit -m "Refactor (deck2/section3): export computeQualityImpactStrata + accuracyGradient for reuse by deck3"
```

---

## Task 6: Promote `reviewerTotals` (as `computeReviewerTotals`)

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/sourceAgreement.ts`
- Test: `src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts`

**Interfaces:**
- Produces: `export function computeReviewerTotals(rows: ReviewerAgreementRow[]): ReviewerTotals` where `export type ReviewerTotals = { totalComparable: number; totalAgree: number; totalRate: number | null; totalFlagged: number; totalCleared: number }`.

- [ ] **Step 1: Read the file, confirm the exact current name `reviewerTotals` and its signature**
- [ ] **Step 2: Rename `reviewerTotals` to `computeReviewerTotals` (update its call site in the slide function) and add `export` to it and to `ReviewerTotals`**
- [ ] **Step 3: Add a test to `sourceAgreement.test.ts`**

```ts
import { computeReviewerTotals } from "./sourceAgreement";

it("computeReviewerTotals pools comparable/agree counts across reviewer rows", () => {
  const rows = /* reuse this file's existing ReviewerAgreementRow[] fixture, e.g. from model.resultComparison.reviewerAgreement in a built test model */;
  const totals = computeReviewerTotals(rows);
  expect(totals.totalComparable).toBeGreaterThanOrEqual(0);
  expect(totals.totalAgree).toBeLessThanOrEqual(totals.totalComparable);
});
```

- [ ] **Step 4: Run** `npx vitest run src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts` — expect PASS.
- [ ] **Step 5: Run** `npm run typecheck` — expect no errors.
- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/sourceAgreement.ts src/data/reporting/executive/deck2/section3/sourceAgreement.test.ts
git commit -m "Refactor (deck2/section3): export computeReviewerTotals for reuse by deck3"
```

---

## Task 7: `deckEditionPreference.ts` — workspace-persisted toggle state

**Files:**
- Create: `src/data/reporting/executive/deckEditionPreference.ts`
- Test: `src/data/reporting/executive/deckEditionPreference.test.ts`

**Interfaces:**
- Consumes: `DirectoryHandleLike` from `../../storage/fileSystemAccess`; `safeReadJson`/`safeWriteJson` from `../../storage/safeWrite`; `casLoop` from `../../storage/casLoop` (`casLoop<T>(fn: (writeToken: string) => Promise<{done:true;result:T;verify?:()=>Promise<boolean>}|{done:false}>, options?: {maxRetries?: number; baseDelayMs?: number; conflictError?: string}): Promise<T | {ok:false; error:string}>`); `withResourceLock` from `../../storage/webLocks` (`withResourceLock<T>(resourceName: string, callback: () => Promise<T>): Promise<T>`); `getTemplatesRoot` from `../../workspace/workspacePaths` (`getTemplatesRoot(directoryHandle: DirectoryHandleLike, create?: boolean): Promise<DirectoryHandleLike>`).
- Produces: `export type ExecutiveDeckEdition = "v2" | "v3"`, `export type DeckEditionPreference = { edition: ExecutiveDeckEdition; updatedAt: string; updatedBy: string; revision?: number; _writeToken?: string }`, `export async function loadDeckEditionPreference(directoryHandle: DirectoryHandleLike): Promise<DeckEditionPreference | null>`, `export async function saveDeckEditionPreference(directoryHandle: DirectoryHandleLike, edition: ExecutiveDeckEdition, updatedBy: string): Promise<{ok:true} | {ok:false; error:string}>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/executive/deckEditionPreference.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { loadDeckEditionPreference, saveDeckEditionPreference } from "./deckEditionPreference";

describe("deckEditionPreference", () => {
  it("returns null when nothing has been saved yet", async () => {
    const dir = createMemoryDirectory();
    const result = await loadDeckEditionPreference(dir);
    expect(result).toBeNull();
  });

  it("round-trips a saved edition", async () => {
    const dir = createMemoryDirectory();
    const saveResult = await saveDeckEditionPreference(dir, "v3", "tester");
    expect(saveResult).toEqual({ ok: true });
    const loaded = await loadDeckEditionPreference(dir);
    expect(loaded?.edition).toBe("v3");
    expect(loaded?.updatedBy).toBe("tester");
    expect(loaded?.revision).toBe(1);
  });

  it("bumps the revision on a second save", async () => {
    const dir = createMemoryDirectory();
    await saveDeckEditionPreference(dir, "v3", "tester");
    await saveDeckEditionPreference(dir, "v2", "tester");
    const loaded = await loadDeckEditionPreference(dir);
    expect(loaded?.edition).toBe("v2");
    expect(loaded?.revision).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deckEditionPreference.test.ts`
Expected: FAIL — `deckEditionPreference.ts` does not exist yet.

- [ ] **Step 3: Implement `deckEditionPreference.ts`**

Copy the exact structure of `src/data/reporting/executive/deck2/styleChoices.ts` (already read in full during design), adapted to this file's smaller `{edition}` payload instead of `{choices}`:

```ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { casLoop } from "../../storage/casLoop";
import { withResourceLock } from "../../storage/webLocks";
import { getTemplatesRoot } from "../../workspace/workspacePaths";

const PREFERENCE_FILE = "executive-deck-edition.json";

export type ExecutiveDeckEdition = "v2" | "v3";

/** Global (not per-month) chosen executive-deck edition, persisted to the
 *  workspace's templates root — same shape and CAS contract as
 *  `deck2/styleChoices.ts`'s choices file. Missing/unreadable file means
 *  "no preference recorded"; callers treat that as "v2" (the default). */
export type DeckEditionPreference = {
  edition: ExecutiveDeckEdition;
  updatedAt: string;
  updatedBy: string;
  revision?: number;
  _writeToken?: string;
};

async function getPreferenceDir(
  directoryHandle: DirectoryHandleLike,
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function loadDeckEditionPreference(
  directoryHandle: DirectoryHandleLike,
): Promise<DeckEditionPreference | null> {
  try {
    const dir = await getPreferenceDir(directoryHandle);
    const result = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function saveDeckEditionPreference(
  directoryHandle: DirectoryHandleLike,
  edition: ExecutiveDeckEdition,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getPreferenceDir(directoryHandle);
    const outcome = await withResourceLock(`${dir.name}/deck-edition-preference:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: DeckEditionPreference = {
            edition,
            updatedAt: new Date().toISOString(),
            updatedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, PREFERENCE_FILE, updated);
          const verify = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
                return (
                  recheck.ok &&
                  recheck.value.revision === nextRevision &&
                  recheck.value._writeToken === writeToken
                );
              },
            };
          }
          return { done: false };
        },
        { conflictError: "تعذّر حفظ تفضيل تصميم العرض التنفيذي: تعارض في الكتابة بعد عدة محاولات." },
      ),
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deckEditionPreference.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deckEditionPreference.ts src/data/reporting/executive/deckEditionPreference.test.ts
git commit -m "Add (executive-report): deckEditionPreference — workspace-persisted deck2/deck3 toggle state"
```

---

## Task 8: `deck3/theme.ts` — handoff design tokens + slide chrome

**Files:**
- Create: `src/data/reporting/executive/deck3/theme.ts`

**Interfaces:**
- Consumes: `SOMAR_SANS_WOFF` from `../../../../branding/somarFonts` (`{ light, regular, medium, bold }`, base64 woff data URIs).
- Produces: `export const DECK_V3_CSS: string` — a complete `<style>`-ready CSS string covering: `@font-face` (Somar, 4 weights), CSS custom properties for every token below, `.slide.v3` base chrome (1920x1080 canvas via `aspect-ratio` + `max-width` scaling — reuse the SAME viewport-scaling technique `deck2/theme.ts`'s `.deck-viewer-v2`/`.slide` rules already use, just at the v3 class names and this palette), `.v3-page-foot` (footer: report name + `NN / 21`), and the two cover paddings (`96px 120px 84px`) vs content padding (`84px 100px 56px`).

- [ ] **Step 1: Write `deck3/theme.ts`**

```ts
// Handoff design tokens (design_handoff_xray_qa_deck, 2026-08-25) — see
// docs/superpowers/specs/2026-08-25-executive-report-design-toggle-design.md
// for the full token table this file encodes verbatim. Light theme, distinct
// from deck2's dark navy/gold system — deck3 does not share deck2's CSS.
import { SOMAR_SANS_WOFF } from "../../../../branding/somarFonts";

export const DECK_V3_FONT_FACE_CSS = `
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.light}) format("woff");font-weight:300;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.regular}) format("woff");font-weight:400;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.medium}) format("woff");font-weight:500;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url(${SOMAR_SANS_WOFF.bold}) format("woff");font-weight:700;font-style:normal;font-display:block;}
`;

export const DECK_V3_CSS = `
${DECK_V3_FONT_FACE_CSS}
:root{
  --v3-bg:#f9f8f5; --v3-panel:#f2f0ea; --v3-land:#f4efe4; --v3-sea:#eaeff5;
  --v3-callout:#eef1f5; --v3-pos-tint:#eef3ee; --v3-neg-tint:#f7eeeb;
  --v3-navy:#10304f; --v3-cover-navy:#0f2b46; --v3-text:#22303e; --v3-muted:#5d6b7a; --v3-hair:#e3e0d8;
  --v3-gold:#b48a3c; --v3-gold-dark:#8a6526; --v3-gold-light:#c9a45e; --v3-gold-lighter:#d9b877;
  --v3-blue:#3f6fa8; --v3-blue-dark:#2c5580;
  --v3-green:#2e7d4f; --v3-red:#b8543f; --v3-neutral-bar:#d9d5ca;
}
.deck-viewer-v3{ display:block; min-height:100vh; padding:28px 16px 56px; background:var(--v3-bg); }
.slide.v3{
  width:1920px; height:1080px; margin:0 auto 26px;
  transform-origin:top center;
  position:relative; overflow:hidden; box-sizing:border-box;
  background:var(--v3-bg); color:var(--v3-text);
  font-family:"Somar","IBM Plex Sans Arabic","Tahoma","Arial",sans-serif;
  display:flex; flex-direction:column;
}
.slide.v3.v3-cover, .slide.v3.v3-closing{ background:var(--v3-cover-navy); color:#fff; }
.slide.v3 .slide-inner{
  flex:1 1 auto; min-height:0; display:flex; flex-direction:column; box-sizing:border-box;
  padding:84px 100px 56px;
}
.slide.v3.v3-cover .slide-inner, .slide.v3.v3-closing .slide-inner{ padding:96px 120px 84px; }
.v3-page-foot{
  display:flex; align-items:center; justify-content:space-between;
  font-size:24px; font-weight:500; color:var(--v3-muted); font-variant-numeric:tabular-nums;
  padding-top:16px; margin-top:auto; border-top:1px solid var(--v3-hair);
}
.slide.v3.v3-cover .v3-page-foot, .slide.v3.v3-closing .v3-page-foot{ border-top-color:rgba(255,255,255,.18); color:rgba(255,255,255,.6); }
@media screen and (max-width:1980px){
  .slide.v3{ transform:scale(calc((100vw - 32px) / 1920)); margin-bottom:calc(-1080px * (1 - (100vw - 32px) / 1920) + 26px); }
}
@media print{
  .deck-viewer-v3{ padding:0; background:#fff; }
  .slide.v3{ transform:none!important; margin:0; box-shadow:none; page-break-after:always; }
}
`;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (this file has no logic to unit-test yet — it's pure CSS/const; covered indirectly once `deck3.test.ts` in Task 12 asserts the built HTML contains `DECK_V3_CSS`'s content).

- [ ] **Step 3: Commit**

```bash
git add src/data/reporting/executive/deck3/theme.ts
git commit -m "Add (executive-report/deck3): theme.ts — handoff color/type/chrome tokens"
```

---

## Task 9: `deck3/chartKit.ts` — the handoff's exact bar-chart CSS pattern

**Files:**
- Create: `src/data/reporting/executive/deck3/chartKit.ts`
- Test: `src/data/reporting/executive/deck3/chartKit.test.ts`

**Interfaces:**
- Consumes: `esc` from `../primitives` (existing Arabic-safe HTML-escaping helper already used throughout `deck2`).
- Produces:
  - `export type ChartBar = { label: string; value: number }`
  - `export function scalePct(value: number, min: number, max: number): number` — `(value-min)/(max-min)*100`, clamped to `[0,100]`.
  - `export function barChart(opts: { bars: ChartBar[]; min: number; max: number; referenceValue?: number; referenceLabel?: string; valueFormat?: (v: number) => string }): string`
  - `export function groupedBarChart(opts: { groups: Array<{ label: string; a: ChartBar; b: ChartBar }>; min: number; max: number; referenceValue?: number; referenceLabel?: string; valueFormat?: (v: number) => string; toneA?: string; toneB?: string }): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/reporting/executive/deck3/chartKit.test.ts
import { describe, expect, it } from "vitest";
import { scalePct, barChart, groupedBarChart } from "./chartKit";

describe("scalePct", () => {
  it("maps the midpoint to 50%", () => {
    expect(scalePct(50, 0, 100)).toBe(50);
  });
  it("clamps below min to 0 and above max to 100", () => {
    expect(scalePct(-10, 0, 100)).toBe(0);
    expect(scalePct(150, 0, 100)).toBe(100);
  });
});

describe("barChart", () => {
  it("renders one bar per category with a height style derived from scalePct", () => {
    const html = barChart({ bars: [{ label: "منفذ أ", value: 92 }], min: 86, max: 98 });
    expect(html).toContain("منفذ أ");
    expect(html).toContain("height:50.0%"); // (92-86)/(98-86)*100 = 50
  });
  it("renders a dashed reference line at the reference value's scaled position", () => {
    const html = barChart({ bars: [{ label: "أ", value: 90 }], min: 86, max: 98, referenceValue: 92, referenceLabel: "المتوسط" });
    expect(html).toContain("bottom:50.0%"); // (92-86)/(98-86)*100 = 50
    expect(html).toContain("المتوسط");
  });
});

describe("groupedBarChart", () => {
  it("renders two bars (a/b) per group with independent heights", () => {
    const html = groupedBarChart({
      groups: [{ label: "منفذ أ", a: { label: "مستوى 1", value: 94 }, b: { label: "مستوى 2", value: 88 } }],
      min: 86, max: 96,
    });
    expect(html).toContain("منفذ أ");
    expect(html).toContain("height:80.0%"); // (94-86)/(96-86)*100 = 80
    expect(html).toContain("height:20.0%"); // (88-86)/(96-86)*100 = 20
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck3/chartKit.test.ts`
Expected: FAIL — `chartKit.ts` does not exist.

- [ ] **Step 3: Implement `chartKit.ts`**

Follows the handoff README's "Chart Construction (critical)" section verbatim: plot box with a `#10304f` bottom-border baseline, an absolutely-positioned stretch-flex bar row (percentage heights only resolve because the row is stretched to full height — never switch to `align-items:flex-end`), value labels inside the bar top with `z-index` above the dashed reference line, category labels as a sibling row below the plot.

```ts
import { esc } from "../primitives";

export type ChartBar = { label: string; value: number };

export function scalePct(value: number, min: number, max: number): number {
  const pct = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function defaultFormat(v: number): string {
  return `${v.toFixed(1)}%`;
}

function referenceLineHtml(
  referenceValue: number | undefined,
  referenceLabel: string | undefined,
  min: number,
  max: number,
): string {
  if (referenceValue == null) return "";
  const pct = scalePct(referenceValue, min, max);
  return `<div class="v3-chart-refline" style="bottom:${pct.toFixed(1)}%">${referenceLabel ? `<span>${esc(referenceLabel)}</span>` : ""}</div>`;
}

export function barChart(opts: {
  bars: ChartBar[];
  min: number;
  max: number;
  referenceValue?: number;
  referenceLabel?: string;
  valueFormat?: (v: number) => string;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const bars = opts.bars
    .map((b) => {
      const pct = scalePct(b.value, opts.min, opts.max);
      return `<div class="v3-chart-cell"><div class="v3-chart-bar" style="height:${pct.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(b.value))}</span></div></div>`;
    })
    .join("");
  const labels = opts.bars.map((b) => `<div class="v3-chart-label">${esc(b.label)}</div>`).join("");
  return `
    <div class="v3-chart-plot">
      <div class="v3-chart-bars">${bars}</div>
      ${referenceLineHtml(opts.referenceValue, opts.referenceLabel, opts.min, opts.max)}
    </div>
    <div class="v3-chart-labels">${labels}</div>
  `;
}

export function groupedBarChart(opts: {
  groups: Array<{ label: string; a: ChartBar; b: ChartBar }>;
  min: number;
  max: number;
  referenceValue?: number;
  referenceLabel?: string;
  valueFormat?: (v: number) => string;
  toneA?: string;
  toneB?: string;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const groups = opts.groups
    .map((g) => {
      const pctA = scalePct(g.a.value, opts.min, opts.max);
      const pctB = scalePct(g.b.value, opts.min, opts.max);
      return `<div class="v3-chart-group">
        <div class="v3-chart-cell"><div class="v3-chart-bar v3-chart-bar-a" style="height:${pctA.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(g.a.value))}</span></div></div>
        <div class="v3-chart-cell"><div class="v3-chart-bar v3-chart-bar-b" style="height:${pctB.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(g.b.value))}</span></div></div>
      </div>`;
    })
    .join("");
  const labels = opts.groups.map((g) => `<div class="v3-chart-label">${esc(g.label)}</div>`).join("");
  return `
    <div class="v3-chart-plot v3-chart-plot-grouped">
      <div class="v3-chart-bars">${groups}</div>
      ${referenceLineHtml(opts.referenceValue, opts.referenceLabel, opts.min, opts.max)}
    </div>
    <div class="v3-chart-labels">${labels}</div>
  `;
}
```

Add the corresponding CSS to `deck3/theme.ts` (`DECK_V3_CSS`, append to the string built in Task 8) — the exact structural pattern from the handoff README:

```css
.v3-chart-plot{ position:relative; background:var(--v3-panel); border-bottom:2px solid var(--v3-navy); height:100%; }
.v3-chart-bars{ position:absolute; inset:0; z-index:1; display:flex; align-items:stretch; gap:12px; padding:0 12px; }
.v3-chart-plot-grouped .v3-chart-bars{ gap:26px; }
.v3-chart-group{ flex:1; display:flex; gap:8px; align-items:stretch; }
.v3-chart-cell{ flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-self:stretch; height:100%; }
.v3-chart-bar{ background:var(--v3-gold); position:relative; }
.v3-chart-bar-a{ background:var(--v3-gold); }
.v3-chart-bar-b{ background:var(--v3-blue); }
.v3-chart-value{ display:block; padding-top:10px; text-align:center; color:#fff; font-size:24px; font-weight:700; }
.v3-chart-refline{ position:absolute; right:0; left:0; border-top:3px dashed var(--v3-navy); }
.v3-chart-refline span{ position:absolute; inset-inline-end:0; top:-28px; font-size:24px; color:var(--v3-muted); }
.v3-chart-labels{ display:flex; gap:12px; padding:10px 12px 0; }
.v3-chart-plot-grouped + .v3-chart-labels{ gap:26px; }
.v3-chart-label{ flex:1; text-align:center; font-size:25px; color:var(--v3-text); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck3/chartKit.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/deck3/chartKit.ts src/data/reporting/executive/deck3/chartKit.test.ts src/data/reporting/executive/deck3/theme.ts
git commit -m "Add (executive-report/deck3): chartKit.ts — handoff's pure-CSS bar-chart pattern"
```

---

## Task 10: `deck3/slideKit.ts` — reusable slide templates

**Files:**
- Create: `src/data/reporting/executive/deck3/slideKit.ts`

**Interfaces:**
- Consumes: `esc` from `../primitives`; `icon` from `../ui/icons` (existing icon helper deck2 already uses).
- Produces (this is the extensibility scaffold — a future deck2-only section added to this skin becomes a new call to one of these, not a new CSS pass; say so in a header comment):
  - `export function coverSlide(opts: { kicker: string; title: string; periodLabel: string; metaRows: Array<{ label: string; value: string }>; num: number; total: number }): string`
  - `export function closingSlide(opts: { kicker: string; title: string; closingLine: string; num: number; total: number }): string`
  - `export function contentsSlide(opts: { rows: Array<{ index: number; title: string; description: string; pageRange: string }>; num: number; total: number }): string`
  - `export function glossaryCard(opts: { term: string; definition: string; tone?: "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan" }): string` + `export function glossarySlide(opts: { cards: ReturnType<typeof glossaryCard>[]; num: number; total: number }): string`
  - `export function levelDefinitionCard(opts: { ordinal: string; title: string; definition: string; samplingWeight: string; tone: "gold" | "blue" | "green" | "coral" }): string` + `export function levelDefinitionSlide(opts: { cards: string[]; highlightValue: string; highlightNote: string; num: number; total: number }): string`
  - `export function kpiGrid(opts: { cells: Array<{ label: string; value: string }>; num: number; total: number }): string`
  - `export function sectionDivider(opts: { ordinal: string; title: string; description: string; pageList: string; num: number; total: number }): string`
  - `export function twoPanelTable(opts: { landTitle: string; landSub: string; seaTitle: string; seaSub: string; theadCells: string; landRowsHtml: string; landTotalsHtml: string; seaRowsHtml: string; seaTotalsHtml: string; num: number; total: number; title: string }): string`
  - `export function matrixSlide(opts: { title: string; topLeft: { label: string; value: string }; topRight: { label: string; value: string }; bottomLeft: { label: string; value: string }; bottomRight: { label: string; value: string }; totalLabel: string; totalValue: string; num: number; total: number }): string`
  - `export function comparisonPanels(opts: { title: string; leftTitle: string; leftRows: Array<{ label: string; value: string }>; rightTitle: string; rightRows: Array<{ label: string; value: string }>; num: number; total: number }): string`
  - `export function impactSplitSlide(opts: { title: string; left: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string }; right: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string }; num: number; total: number }): string`
  - `export function pageFoot(num: number, total: number): string`

- [ ] **Step 1: Implement `deck3/theme.ts`-paired `slideKit.ts`**

```ts
// Generic, data-driven slide templates for deck3 (design_handoff_xray_qa_deck
// visual language). Every function here takes typed data and returns HTML —
// a future deck2-only section (workloadAccuracy, dailyTrend, section4)
// reproduced in THIS skin is a new slides.ts entry calling one of these
// functions with real data, not a new theme/CSS pass. See
// docs/superpowers/specs/2026-08-25-executive-report-design-toggle-design.md.
import { esc } from "../primitives";

export function pageFoot(num: number, total: number): string {
  return `<div class="v3-page-foot"><span>تقرير ضمان جودة فحص الأشعة</span><span dir="ltr">${num} / ${total}</span></div>`;
}

export function coverSlide(opts: {
  kicker: string;
  title: string;
  periodLabel: string;
  metaRows: Array<{ label: string; value: string }>;
  num: number;
  total: number;
}): string {
  const meta = opts.metaRows
    .map((m) => `<div class="v3-cover-meta-item"><span class="v3-cover-meta-label">${esc(m.label)}</span><b>${esc(m.value)}</b></div>`)
    .join("");
  return `<section class="slide v3 v3-cover">
    <div class="slide-inner">
      <span class="v3-kicker">${esc(opts.kicker)}</span>
      <h1 class="v3-cover-h1">${esc(opts.title)}</h1>
      <div class="v3-cover-period">${esc(opts.periodLabel)}</div>
      <div class="v3-cover-meta">${meta}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function closingSlide(opts: {
  kicker: string;
  title: string;
  closingLine: string;
  num: number;
  total: number;
}): string {
  return `<section class="slide v3 v3-closing">
    <div class="slide-inner">
      <span class="v3-kicker">${esc(opts.kicker)}</span>
      <h1 class="v3-closing-h1">${esc(opts.title)}</h1>
      <p class="v3-closing-line">${esc(opts.closingLine)}</p>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function contentsSlide(opts: {
  rows: Array<{ index: number; title: string; description: string; pageRange: string }>;
  num: number;
  total: number;
}): string {
  const rows = opts.rows
    .map(
      (r) => `<div class="v3-toc-row">
        <span class="v3-toc-index">${r.index}</span>
        <span class="v3-toc-title">${esc(r.title)}</span>
        <span class="v3-toc-desc">${esc(r.description)}</span>
        <span class="v3-toc-pages" dir="ltr">${esc(r.pageRange)}</span>
      </div>`,
    )
    .join("");
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">المحتويات</h2>
      <div class="v3-toc">${rows}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function glossaryCard(opts: {
  term: string;
  definition: string;
  tone?: "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";
}): string {
  return `<div class="v3-term-card${opts.tone ? ` ${opts.tone}` : ""}"><b>${esc(opts.term)}</b><p>${esc(opts.definition)}</p></div>`;
}

export function glossarySlide(opts: { title: string; cards: string[]; num: number; total: number }): string {
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-term-grid">${opts.cards.join("")}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function levelDefinitionCard(opts: {
  ordinal: string;
  title: string;
  definition: string;
  samplingWeight: string;
  tone: "gold" | "blue" | "green" | "coral";
}): string {
  return `<div class="v3-level-card ${opts.tone}">
    <span class="v3-level-num">${esc(opts.ordinal)}</span>
    <h4>${esc(opts.title)}</h4>
    <p>${esc(opts.definition)}</p>
    <div class="v3-level-goal"><span>وزن العينة</span><b>${esc(opts.samplingWeight)}</b></div>
  </div>`;
}

export function levelDefinitionSlide(opts: {
  title: string;
  cards: string[];
  highlightValue: string;
  highlightNote: string;
  num: number;
  total: number;
}): string {
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-level-grid">${opts.cards.join("")}</div>
      <div class="v3-level-highlight"><b>${esc(opts.highlightValue)}</b><span>${esc(opts.highlightNote)}</span></div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function kpiGrid(opts: { title: string; cells: Array<{ label: string; value: string }>; num: number; total: number }): string {
  const cells = opts.cells
    .map((c) => `<div class="v3-kpi-cell"><span class="v3-kpi-label">${esc(c.label)}</span><b class="v3-kpi-value">${esc(c.value)}</b></div>`)
    .join("");
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-kpi-grid">${cells}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function sectionDivider(opts: { ordinal: string; title: string; description: string; pageList: string; num: number; total: number }): string {
  return `<section class="slide v3 v3-divider">
    <div class="slide-inner">
      <span class="v3-divider-num">${esc(opts.ordinal)}</span>
      <h1 class="v3-divider-h1">${esc(opts.title)}</h1>
      <p class="v3-divider-desc">${esc(opts.description)}</p>
      <span class="v3-divider-pages" dir="ltr">${esc(opts.pageList)}</span>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function twoPanelTable(opts: {
  title: string;
  landTitle: string; landSub: string; landRowsHtml: string; landTotalsHtml: string;
  seaTitle: string; seaSub: string; seaRowsHtml: string; seaTotalsHtml: string;
  theadCells: string;
  num: number; total: number;
}): string {
  const panel = (variant: "land" | "sea", title: string, sub: string, rows: string, totals: string) => `
    <div class="v3-panel v3-panel-${variant}">
      <div class="v3-panel-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
      <table class="v3-table"><thead><tr>${opts.theadCells}</tr></thead><tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-two-panel">
        ${panel("land", opts.landTitle, opts.landSub, opts.landRowsHtml, opts.landTotalsHtml)}
        ${panel("sea", opts.seaTitle, opts.seaSub, opts.seaRowsHtml, opts.seaTotalsHtml)}
      </div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function matrixSlide(opts: {
  title: string;
  topLeft: { label: string; value: string };
  topRight: { label: string; value: string };
  bottomLeft: { label: string; value: string };
  bottomRight: { label: string; value: string };
  totalLabel: string;
  totalValue: string;
  num: number;
  total: number;
}): string {
  const cell = (c: { label: string; value: string }) => `<div class="v3-matrix-cell"><b>${esc(c.value)}</b><span>${esc(c.label)}</span></div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-matrix">
        ${cell(opts.topLeft)}${cell(opts.topRight)}
        ${cell(opts.bottomLeft)}${cell(opts.bottomRight)}
        <div class="v3-matrix-total"><b>${esc(opts.totalValue)}</b><span>${esc(opts.totalLabel)}</span></div>
      </div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function comparisonPanels(opts: {
  title: string;
  leftTitle: string; leftRows: Array<{ label: string; value: string }>;
  rightTitle: string; rightRows: Array<{ label: string; value: string }>;
  num: number; total: number;
}): string {
  const panel = (title: string, rows: Array<{ label: string; value: string }>) => `
    <div class="v3-cmp-panel">
      <b class="v3-cmp-panel-title">${esc(title)}</b>
      ${rows.map((r) => `<div class="v3-cmp-row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join("")}
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-cmp-grid">${panel(opts.leftTitle, opts.leftRows)}${panel(opts.rightTitle, opts.rightRows)}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function impactSplitSlide(opts: {
  title: string;
  left: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string };
  right: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string };
  num: number;
  total: number;
}): string {
  const col = (c: typeof opts.left) => `
    <div class="v3-impact-col">
      <b class="v3-impact-col-title">${esc(c.title)}</b>
      <div class="v3-impact-chart">${c.chartHtml}</div>
      <div class="v3-impact-callout"><b>${esc(c.calloutValue)}</b><span>${esc(c.calloutLabel)}</span></div>
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-impact-split">${col(opts.left)}${col(opts.right)}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}
```

- [ ] **Step 2: Append the corresponding structural CSS to `deck3/theme.ts`'s `DECK_V3_CSS`** — one rule block per class used above (`.v3-kicker`, `.v3-cover-h1`, `.v3-cover-period`, `.v3-cover-meta`/`-item`/`-label`, `.v3-closing-h1`/`-line`, `.v3-h2`, `.v3-toc`/`-row`/`-index`/`-title`/`-desc`/`-pages`, `.v3-term-grid`/`-card` (+ tone variants `.gold`/`.blue`/`.green`/`.coral`/`.slate`/`.purple`/`.cyan`), `.v3-level-grid`/`-card`/`-num`/`-goal`/`-highlight`, `.v3-kpi-grid`/`-cell`/`-label`/`-value`, `.v3-divider`/`-num`/`-h1`/`-desc`/`-pages`, `.v3-panel`/`-land`/`-sea`/`-head`, `.v3-table`, `.v3-matrix`/`-cell`/`-total`, `.v3-cmp-grid`/`-panel`/`-row`, `.v3-impact-split`/`-col`/`-chart`/`-callout`) — using ONLY the token custom properties defined in Task 8 (`var(--v3-*)`) and the exact spacing/type-size values from the spec's Design Tokens table (grid gaps 48px/44-56px, table rows 56px fixed height, minimum type size 24px, rules 2px `#10304f` / 1px `#e3e0d8` hairlines). This is layout-only CSS with no new business logic — no dedicated unit test needed beyond `deck3.test.ts`'s (Task 12) rendered-output assertions.
- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/data/reporting/executive/deck3/slideKit.ts src/data/reporting/executive/deck3/theme.ts
git commit -m "Add (executive-report/deck3): slideKit.ts — generic handoff-styled slide templates"
```

---

## Task 11: `deck3/slides.ts` — the 21 handoff slides wired to real data

**Files:**
- Create: `src/data/reporting/executive/deck3/slides.ts`

**Interfaces:**
- Consumes: everything from `./slideKit` (Task 10) and `./chartKit` (Task 9); `ReportModel` from `../model/reportModel`; `esc`/`fmtNum` from `../primitives`; `collectLevelAccuracyRows`/`LevelAccuracyRow` from `../deck2/section3/levelAccuracy` (Task 1); `coverageOf`/`buildAgreementRows`/`foldReportRows` from `../deck2/section3/riskEngineAgreement` (Task 3 — this task's 21 slides do not need `foldDisagreementSet` or Task 2's `collectPortAgreementRows`/`PortAgreementRow`; do not import either — an unused import fails lint); `computeMarkingImpact` from `../deck2/section3/markingImpact` (Task 4); `computeQualityImpactStrata`/`accuracyGradient` from `../deck2/section3/qualityImpact` (Task 5); `computeReviewerTotals` from `../deck2/section3/sourceAgreement` (Task 6); `collectPortStats` from `../deck2/slideKit` (existing, already exported — returns `{ land: PortPopRow[]; sea: PortPopRow[] }` from raw `model` population/sample counts, reused as-is per the spec's population/port-distribution rows).
- Produces: `export async function buildDeck3Slides(model: ReportModel, monthLabel: string, monthlyTarget: number): Promise<string>` — concatenates the 21 slides below in order, using the SAME main-thread-chunking convention `deck2/slides.ts` uses (`await yieldToMain()` from `../../../storage/yieldToMain` every few slides, so this stays consistent with the rest of the reporting layer even though deck3 is smaller). `monthlyTarget` is `ExecutiveReportConfig.monthlyTarget` from the report input — `ReportModel` itself does NOT surface `config` (confirmed: `reportModel.ts` has no `monthlyTarget` reference at all), so Task 12's `buildExecutiveDeckV3` passes `input.config.monthlyTarget` through explicitly rather than this file reaching into a field `ReportModel` doesn't have.

- [ ] **Step 1: Implement `deck3/slides.ts`**

```ts
import { yieldToMain } from "../../../storage/yieldToMain";
import { esc, fmtNum } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import { collectPortStats } from "../deck2/slideKit";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import { coverageOf, buildAgreementRows, foldReportRows } from "../deck2/section3/riskEngineAgreement";
import { computeMarkingImpact } from "../deck2/section3/markingImpact";
import { computeQualityImpactStrata, accuracyGradient } from "../deck2/section3/qualityImpact";
import { computeReviewerTotals } from "../deck2/section3/sourceAgreement";
import {
  coverSlide, closingSlide, contentsSlide, glossaryCard, glossarySlide,
  levelDefinitionCard, levelDefinitionSlide, kpiGrid, sectionDivider,
  twoPanelTable, matrixSlide, comparisonPanels, impactSplitSlide,
} from "./slideKit";
import { barChart, groupedBarChart } from "./chartKit";

const TOTAL = 21;

export async function buildDeck3Slides(model: ReportModel, monthLabel: string, monthlyTarget: number): Promise<string> {
  const parts: string[] = [];

  // 1 — Cover
  parts.push(coverSlide({
    kicker: "عرض تنفيذي · تقرير شهري",
    title: "تقرير ضمان جودة فحص الأشعة",
    periodLabel: monthLabel,
    metaRows: [
      { label: "تاريخ الإصدار", value: new Date().toLocaleDateString("ar-SA") },
      { label: "القسم", value: "ضمان الجودة" },
    ],
    num: 1, total: TOTAL,
  }));

  // 2 — Contents
  parts.push(contentsSlide({
    rows: [
      { index: 1, title: "المعجم", description: "المصطلحات ومستويات المخاطر", pageRange: "3-4" },
      { index: 2, title: "مؤشرات الشهر", description: "لمحة سريعة عن الأداء", pageRange: "5" },
      { index: 3, title: "المجتمع والتوزيع", description: "المجتمع والعينة حسب المستوى والمنفذ", pageRange: "7-8" },
      { index: 4, title: "الدقة", description: "الدقة العامة، حسب المنفذ وحسب المستوى", pageRange: "10-13" },
      { index: 5, title: "التحليلات المتقدمة", description: "المصفوفة، التوافق، أثر التحديد والجودة", pageRange: "15-20" },
    ],
    num: 2, total: TOTAL,
  }));

  await yieldToMain();

  // 3 — Glossary: terms
  parts.push(glossarySlide({
    title: "المعجم — المصطلحات",
    cards: [
      glossaryCard({ term: "نتائج الوسائل الآلية", definition: "نتيجة تحليل صورة الأشعة بواسطة أنظمة الفحص الآلي.", tone: "gold" }),
      glossaryCard({ term: "صورة", definition: "الوحدة الأساسية للفحص — صورة أشعة واحدة لشحنة أو حاوية.", tone: "blue" }),
      glossaryCard({ term: "نتيجة", definition: "التصنيف المسجل لصورة بعد المراجعة: سليمة أو اشتباه.", tone: "green" }),
      glossaryCard({ term: "نسبة تحديد موقع الاشتباه", definition: "نسبة الصور المشتبه بها التي تم تحديد موقع الاشتباه فيها.", tone: "coral" }),
      glossaryCard({ term: "دقة السليمة / دقة الاشتباه / الدقة العامة", definition: "نسب الدقة المحسوبة لكل تصنيف نتيجة على حدة وللنتيجة العامة.", tone: "slate" }),
    ],
    num: 3, total: TOTAL,
  }));

  // 4 — Glossary: risk levels
  // Locked wording — copied verbatim from the handoff's own HTML
  // (design_handoff_xray_qa_deck/Executive Report Deck v2.dc.html, slide 4,
  // read directly during plan preflight — this is the actual shipped
  // deck text, not the shorter slide-table summary in the spec doc). Do
  // not paraphrase or shorten any of the 4 definition/"ما يقيسه" strings
  // below. Live per-level population/sample share comes from
  // model.population.byStage (already computed, real data) — only the
  // static prose is hardcoded, matching how deck2 hardcodes its own
  // one-off slide copy (see deck2/slides.ts's glossary/riskStages slides).
  const LEVEL_DEFINITIONS = [
    {
      title: "المستوى الأول",
      definition: "الصور التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون استهداف من محرك المخاطر.",
      measures: "انفراد الفحص بالاشتباه دون مؤشرات أخرى.",
      samplingWeight: "وزن السحب: 100% — حصر كامل لمجتمع المستوى",
      tone: "gold" as const,
    },
    {
      title: "المستوى الثاني",
      definition: "الصور التي استهدفها محرك المخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.",
      measures: "ما يلتقطه محرك المخاطر ولا يُلتقط من قبل أخصائي الوسائل الآلية.",
      samplingWeight: "وزن السحب: 40% من حصة العدد الثابت — 2,500 صورة",
      tone: "blue" as const,
    },
    {
      title: "المستوى الثالث",
      definition: "الصور التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى.",
      measures: "ما تلتقطه الفرق الأمنية الأخرى ولا يلتقطه الفحص.",
      samplingWeight: "وزن السحب: 30% من حصة العدد الثابت — 1,875 صورة",
      tone: "green" as const,
    },
    {
      title: "المستوى الرابع",
      definition: "الصور التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين.",
      measures: "ما ثبت فواته بضبط أمني أو باكتشاف خارجي.",
      samplingWeight: "وزن السحب: 30% من حصة العدد الثابت — 1,875 صورة",
      tone: "coral" as const,
    },
  ];
  parts.push(levelDefinitionSlide({
    title: "المعجم — مستويات المخاطر",
    cards: LEVEL_DEFINITIONS.map((lvl, i) => levelDefinitionCard({
      ordinal: String(i + 1),
      title: lvl.title,
      // "definition" carries both the level's scope sentence and its "ما
      // يقيسه" line — levelDefinitionCard (Task 10) only has one prose
      // slot, so join them the same way the handoff's card stacks the two
      // text blocks vertically.
      definition: `${lvl.definition} — ما يقيسه: ${lvl.measures}`,
      samplingWeight: lvl.samplingWeight,
      tone: lvl.tone,
    })),
    // Primary monthly target sample size — real config value (passed in as
    // monthlyTarget, since ReportModel itself doesn't surface config), NOT
    // the handoff's own placeholder 6,250.
    highlightValue: fmtNum(monthlyTarget),
    highlightNote: "أوزان المستويات الثاني–الرابع تُسحب من هذا العدد؛ المستوى الأول حصر كامل من مجتمعه خارج هذه الحصة.",
    num: 4, total: TOTAL,
  }));

  await yieldToMain();

  // 5 — Month KPIs
  parts.push(kpiGrid({
    title: "مؤشرات الشهر",
    cells: [
      { label: "مجتمع الفحص", value: fmtNum(model.population.total) },
      { label: "العيّنة", value: fmtNum(model.sample.total) },
      { label: "التغطية", value: `${(model.sample.coverage ?? 0).toFixed(1)}%` },
      { label: "دقة النتيجة", value: `${(model.summary.overallAccuracy ?? 0).toFixed(1)}%` },
      { label: "نسبة تحديد موقع الاشتباه", value: `${(model.imageQuality.markingRate ?? 0).toFixed(1)}%` },
      { label: "الاشتباهات الفائتة", value: fmtNum(model.errorAnalysis.totals.missedSuspicion) },
    ],
    num: 5, total: TOTAL,
  }));

  // 6 — Section 1 divider
  parts.push(sectionDivider({
    ordinal: "1", title: "المجتمع والعينة",
    description: "توزيع مجتمع الفحص والعينة حسب المستوى والمنفذ.",
    pageList: "7-8", num: 6, total: TOTAL,
  }));

  await yieldToMain();

  // 7 — Population per level (model.population.byStage is already the real
  // per-level population/sample breakdown consumed by deck2's own riskStagesSlide)
  {
    const rows = model.population.byStage
      .map((s) => `<tr><td>${esc(s.stage)}</td><td>${fmtNum(s.total)}</td><td>${fmtNum(s.sampleTotal ?? 0)}</td></tr>`)
      .join("");
    parts.push(twoPanelTable({
      title: "مجتمع الفحص",
      landTitle: "حسب المستوى", landSub: `${fmtNum(model.population.total)} صورة`,
      landRowsHtml: rows, landTotalsHtml: "",
      seaTitle: "العيّنة", seaSub: `${fmtNum(model.sample.total)} صورة`,
      seaRowsHtml: rows, seaTotalsHtml: "",
      theadCells: "<th>المستوى</th><th>المجتمع</th><th>العيّنة</th>",
      num: 7, total: TOTAL,
    }));
  }

  // 8 — Port distribution (reuses deck2's own collectPortStats — same data,
  // no duplicated fold logic)
  {
    const { land, sea } = collectPortStats(model);
    const rowsHtml = (ports: typeof land) =>
      ports.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}(${fmtNum(p.sampleTotal)})</td><td>${fmtNum(p.clean)}(${fmtNum(p.sampleClean)})</td><td>${fmtNum(p.suspicious)}(${fmtNum(p.sampleSuspicious)})</td></tr>`).join("");
    parts.push(twoPanelTable({
      title: "توزيع المنافذ",
      landTitle: "برية", landSub: `تغطية ${(model.sample.coverage ?? 0).toFixed(1)}%`,
      landRowsHtml: rowsHtml(land), landTotalsHtml: "",
      seaTitle: "بحرية", seaSub: `تغطية ${(model.sample.coverage ?? 0).toFixed(1)}%`,
      seaRowsHtml: rowsHtml(sea), seaTotalsHtml: "",
      theadCells: "<th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th>",
      num: 8, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 9 — Section 2 divider
  parts.push(sectionDivider({
    ordinal: "2", title: "الدقة",
    description: "دقة الرصد العامة، حسب المنفذ وحسب المستوى.",
    pageList: "10-13", num: 9, total: TOTAL,
  }));

  // 10 — Overall detection accuracy (model.errorAnalysis.totals, byPort — no
  // new math, same numbers outcomeMatrix.ts already reads verbatim)
  {
    const t = model.errorAnalysis.totals;
    const evaluable = t.evaluable || 1;
    const overall = ((t.correctClean + t.correctSuspicion) / evaluable) * 100;
    const cleanAcc = t.correctClean / ((t.correctClean + t.missedSuspicion) || 1) * 100;
    const suspAcc = t.correctSuspicion / ((t.correctSuspicion + t.falseSuspicion) || 1) * 100;
    parts.push(kpiGrid({
      title: "دقة الرصد العامة",
      cells: [
        { label: "الدقة العامة", value: `${overall.toFixed(1)}%` },
        { label: "دقة السليمة", value: `${cleanAcc.toFixed(1)}%` },
        { label: "دقة الاشتباه", value: `${suspAcc.toFixed(1)}%` },
      ],
      num: 10, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 11 — Accuracy by port (land/sea), 12 — chart
  {
    const byPort = model.portAccuracy; // Aggregates["byPort"] = KeyedAccuracy[]
    const rowsHtml = byPort.map((p) => `<tr><td>${esc(p.key)}</td><td>${((p.accuracyByDecision ?? 0)).toFixed(1)}%</td></tr>`).join("");
    parts.push(twoPanelTable({
      title: "الدقة حسب المنفذ",
      landTitle: "برية", landSub: "", landRowsHtml: rowsHtml, landTotalsHtml: "",
      seaTitle: "بحرية", seaSub: "", seaRowsHtml: rowsHtml, seaTotalsHtml: "",
      theadCells: "<th>المنفذ</th><th>الدقة العامة</th>",
      num: 11, total: TOTAL,
    }));
    const avg = byPort.reduce((s, p) => s + (p.accuracyByDecision ?? 0), 0) / (byPort.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">رسم الدقة حسب المنفذ</h2>${barChart({
      bars: byPort.map((p) => ({ label: p.key, value: p.accuracyByDecision ?? 0 })),
      min: 86, max: 98, referenceValue: avg, referenceLabel: "المتوسط",
    })}</div></section>`);
  }

  // 13 — Accuracy by level (chart) — reuses Task 1's collectLevelAccuracyRows
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const all = [...land, ...sea];
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">رسم الدقة حسب المستوى</h2>${groupedBarChart({
      groups: all.map((r) => ({
        label: r.name,
        a: { label: "سليمة", value: r.l1.accuracy ?? 0 },
        b: { label: "اشتباه", value: r.l2.accuracy ?? 0 },
      })),
      min: 60, max: 100,
    })}</div></section>`);
  }

  await yieldToMain();

  // 14 — Section 3 divider
  parts.push(sectionDivider({
    ordinal: "3", title: "التحاليل المتقدمة",
    description: "مصفوفة النتائج، مقارنة المستويين، التوافق مع الفرق والمحرك، وأثر التحديد والجودة.",
    pageList: "15-20", num: 14, total: TOTAL,
  }));

  // 15 — Outcome matrix (model.errorAnalysis.totals verbatim — outcomeMatrix.ts's
  // own header comment confirms this is read, never recomputed)
  {
    const t = model.errorAnalysis.totals;
    const overall = ((t.correctClean + t.correctSuspicion) / (t.evaluable || 1)) * 100;
    parts.push(matrixSlide({
      title: "مصفوفة نتائج الوسائل الآلية",
      topLeft: { label: "توافق سليم", value: fmtNum(t.correctClean) },
      topRight: { label: "اشتباه فائت", value: fmtNum(t.missedSuspicion) },
      bottomLeft: { label: "اشتباه خاطئ", value: fmtNum(t.falseSuspicion) },
      bottomRight: { label: "توافق اشتباه", value: fmtNum(t.correctSuspicion) },
      totalLabel: `الدقة العامة (${fmtNum(t.evaluable)})`,
      totalValue: `${overall.toFixed(1)}%`,
      num: 15, total: TOTAL,
    }));
  }

  // 16 — Level 1 vs Level 2 accuracy (reuses collectLevelAccuracyRows totals)
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const all = [...land, ...sea];
    const sum = (pick: (r: (typeof all)[number]) => { evaluable: number; accuracy: number | null }) => {
      const total = all.reduce((s, r) => s + pick(r).evaluable, 0);
      const weighted = all.reduce((s, r) => s + (pick(r).accuracy ?? 0) * pick(r).evaluable, 0);
      return { total, avg: total ? weighted / total : null };
    };
    const l1 = sum((r) => r.l1);
    const l2 = sum((r) => r.l2);
    parts.push(comparisonPanels({
      title: "دقة إجابات المستوى الأول والثاني",
      leftTitle: "المستوى الأول",
      leftRows: [
        { label: "النتائج المُقيَّمة", value: fmtNum(l1.total) },
        { label: "الدقة العامة", value: `${(l1.avg ?? 0).toFixed(1)}%` },
      ],
      rightTitle: "المستوى الثاني",
      rightRows: [
        { label: "النتائج المُقيَّمة", value: fmtNum(l2.total) },
        { label: "الدقة العامة", value: `${(l2.avg ?? 0).toFixed(1)}%` },
      ],
      num: 16, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 17 — Level 1/2 accuracy, land ports; 18 — sea ports (grouped chart per port)
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const landAvg = land.reduce((s, r) => s + (r.l1.accuracy ?? 0), 0) / (land.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">دقة المستويين في المنافذ البرية</h2>${groupedBarChart({
      groups: land.map((r) => ({ label: r.name, a: { label: "مستوى 1", value: r.l1.accuracy ?? 0 }, b: { label: "مستوى 2", value: r.l2.accuracy ?? 0 } })),
      min: 86, max: 96, referenceValue: landAvg, referenceLabel: "المتوسط",
    })}</div></section>`);
    const seaAvg = sea.reduce((s, r) => s + (r.l1.accuracy ?? 0), 0) / (sea.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">دقة المستويين في المنافذ البحرية</h2>${groupedBarChart({
      groups: sea.map((r) => ({ label: r.name, a: { label: "مستوى 1", value: r.l1.accuracy ?? 0 }, b: { label: "مستوى 2", value: r.l2.accuracy ?? 0 } })),
      min: 86, max: 96, referenceValue: seaAvg, referenceLabel: "المتوسط",
    })}</div></section>`);
  }

  // 19 — Security-team + risk-engine agreement (reuses Task 3's + Task 6's exports)
  {
    const totals = computeReviewerTotals(model.resultComparison.reviewerAgreement);
    const rows = model.rows;
    const coverage = coverageOf(rows);
    const agreementRows = buildAgreementRows(rows);
    const reportFold = foldReportRows(rows);
    parts.push(comparisonPanels({
      title: "توافق النتائج بين المستويات والفرق الأمنية",
      leftTitle: "توافق الفرق الأمنية",
      leftRows: [
        { label: "صور مشتركة", value: fmtNum(totals.totalComparable) },
        { label: "التوافق", value: `${(totals.totalRate ?? 0).toFixed(1)}%` },
      ],
      rightTitle: "التوافق مع محرك المخاطر",
      rightRows: [
        { label: "الصور المستهدفة", value: fmtNum(coverage.recognized) },
        { label: "توافق أيّدت الجودة المحرك", value: fmtNum(reportFold.reviewConfirmed) },
      ],
      num: 19, total: TOTAL,
    }));
    void agreementRows; // available for a richer per-team breakdown if the reviewer wants it added inline above
  }

  await yieldToMain();

  // 20 — Marking + image-quality impact (reuses Task 4's + Task 5's exports)
  {
    const marking = computeMarkingImpact(model);
    const quality = computeQualityImpactStrata(model.rows);
    const gradient = accuracyGradient(quality.strata);
    const markingDelta = (marking.present.accuracy ?? 0) - (marking.absent.accuracy ?? 0);
    parts.push(impactSplitSlide({
      title: "أثر التحديد وجودة الصورة على الدقة",
      left: {
        title: "أثر تحديد موقع الاشتباه",
        chartHtml: barChart({
          bars: [
            { label: "مع تحديد", value: marking.present.accuracy ?? 0 },
            { label: "بدون تحديد", value: marking.absent.accuracy ?? 0 },
          ],
          min: 70, max: 100,
        }),
        calloutValue: `${markingDelta >= 0 ? "+" : ""}${markingDelta.toFixed(1)}%`,
        calloutLabel: `فرق في الدقة العامة (${(marking.present.accuracy ?? 0).toFixed(1)}% مقابل ${(marking.absent.accuracy ?? 0).toFixed(1)}%)`,
      },
      right: {
        title: "أثر جودة الصورة",
        chartHtml: barChart({
          bars: quality.strata.map((s) => ({ label: s.level, value: s.accuracy ?? 0 })),
          min: 70, max: 100,
        }),
        calloutValue: `${(gradient ?? 0) >= 0 ? "+" : ""}${(gradient ?? 0).toFixed(1)}%`,
        calloutLabel: "فرق في الدقة بين أعلى وأدنى مستوى جودة",
      },
      num: 20, total: TOTAL,
    }));
  }

  // 21 — Closing
  parts.push(closingSlide({
    kicker: "ختام العرض",
    title: "شكراً",
    closingLine: "تقرير ضمان جودة فحص الأشعة",
    num: 21, total: TOTAL,
  }));

  return parts.join("\n");
}
```

Both the locked per-level definition text and the `monthlyTarget` plumbing are already filled in verbatim/correctly typed in Step 1's code above — confirmed against the actual handoff HTML and the real `ExecutiveReportConfig`/`ReportModel` types during plan preflight (`ReportModel` does not surface `config`, so `monthlyTarget` is a parameter, not a `model.*` field read). Nothing is left as a placeholder to fill in.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors — this surfaces any field-name mismatch against the real `ReportModel`/`Aggregates` types immediately (this is the main risk in this task, since the file references many model fields).

- [ ] **Step 3: Commit**

```bash
git add src/data/reporting/executive/deck3/slides.ts
git commit -m "Add (executive-report/deck3): slides.ts — the 21 handoff slides wired to real report data"
```

---

## Task 12: `deck3/index.ts` + integration test

**Files:**
- Create: `src/data/reporting/executive/deck3/index.ts`
- Test: `src/data/reporting/executive/deck3/deck3.test.ts`

**Interfaces:**
- Consumes: `buildReportModel` from `../model/reportModel`; `buildDeck3Slides` from `./slides` (Task 11); `DECK_V3_CSS` from `./theme` (Task 8); `ARABIC_FONT_FACE_CSS` from `../../../../branding/fonts`; `openReportWindow`/`writeOrCloseOnFailure` from `../../htmlReport` (`openReportWindow(): Window | null`, `writeOrCloseOnFailure(reportWindow: Window | null, buildHtml: () => Promise<string>, filename: string): Promise<void>`); `formatMonthFolderShortLabel` from `../../../population/monthFolder`; `ExecutiveReportInput` type from `../../executiveReportTypes`.
- Produces: `export function buildDeckV3Html(slides: string, monthLabel: string): string`, `export async function buildExecutiveDeckV3(input: ExecutiveReportInput, employeeDisplayNames?: Record<string, string>): Promise<string>`, `export async function openExecutiveDeckV3(input: ExecutiveReportInput, employeeDisplayNames?: Record<string, string>): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/data/reporting/executive/deck3/deck3.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV3 } from "./index";

// Same fixture pattern as deck2.test.ts (Task 9's exploration confirmed this
// shape) — a minimal but complete PreparedPopulationRow, overridden per test row.
function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني", xrayImageId: "XR-1", xrayEntryDate: null,
    portCode: "P1", portType: "منفذ بري", portName: "منفذ الاختبار",
    declarationNumber: null, declarationDate: null, plateOrContainerNumber: null, chassisNumber: null,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: "بري",
    reportNumber: null, targetedByRiskEngine: null, riskMessage: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanStatus: "NonCertscan", certScanSnippet: null, originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided", biMatched: false, biFilledFields: [],
    sourceSheetName: "Sheet1", sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildExecutiveDeckV3", () => {
  it("renders exactly 21 slides in the handoff's fixed order", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const slideCount = (html.match(/class="slide v3/g) ?? []).length;
    expect(slideCount).toBe(21);
  });

  it("uses locked terminology verbatim", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain("نتائج الوسائل الآلية");
    expect(html).toContain("نسبة تحديد موقع الاشتباه");
    expect(html).toContain("دقة السليمة");
  });

  it("wires real population counts, not the handoff's placeholder 148326/7563", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("148,326");
    expect(html).not.toContain("148326");
  });

  it("embeds the Somar font-face and handoff color tokens", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain('font-family:"Somar"');
    expect(html).toContain("#10304f");
  });

  it("footer page indicators are sequential 1..21", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    for (let n = 1; n <= 21; n++) {
      expect(html).toContain(`>${n} / 21<`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck3/deck3.test.ts`
Expected: FAIL — `deck3/index.ts` does not exist.

- [ ] **Step 3: Implement `deck3/index.ts`**

Mirrors `deck2/index.ts`'s shape exactly (Task-2-exploration-confirmed signatures), minus the variant-preview/style-choices machinery (out of scope per the spec) and minus `DECK_CSS`/`DECK_V2_CSS`/section3/4 CSS (deck3 has its own theme, no shared v1/v2 chrome):

```ts
import { buildReportModel } from "../model/reportModel";
import { buildDeck3Slides } from "./slides";
import { DECK_V3_CSS } from "./theme";
import { ARABIC_FONT_FACE_CSS } from "../../../../branding/fonts";
import { openReportWindow, writeOrCloseOnFailure } from "../../htmlReport";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";
import type { ExecutiveReportInput } from "../../executiveReportTypes";

export function buildDeckV3Html(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>العرض التنفيذي — ${monthLabel}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_V3_CSS}</style>
</head>
<body>
<div class="deck-viewer-v3">
${slides}
</div>
</body>
</html>`;
}

export async function buildExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = await buildDeck3Slides(model, formatMonthFolderShortLabel(input.monthFolderName), input.config.monthlyTarget);
  return buildDeckV3Html(slides, formatMonthFolderShortLabel(input.monthFolderName));
}

export async function openExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildExecutiveDeckV3(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck3/deck3.test.ts`
Expected: PASS (all 5 tests). If the slide-count assertion fails, check `slides.ts` for a missing/extra `parts.push(...)` call against the 21-item list in Task 11 Step 1's comments.

- [ ] **Step 5: Run the full deck2 test suite to confirm zero regression from Tasks 1-6's refactors being exercised transitively**

Run: `npx vitest run src/data/reporting/executive/deck2`
Expected: PASS, same test count as before Task 1.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/executive/deck3/index.ts src/data/reporting/executive/deck3/deck3.test.ts
git commit -m "Add (executive-report/deck3): index.ts — buildExecutiveDeckV3/openExecutiveDeckV3 + integration test"
```

---

## Task 13: Wire the toggle into `TabView.tsx`

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/TabView.tsx`
- Test: `src/components/Sidebar/Tabs/Reports/index.test.tsx`

**Interfaces:**
- Consumes: `loadDeckEditionPreference`/`saveDeckEditionPreference`/`ExecutiveDeckEdition` from `../../../../data/reporting/executive/deckEditionPreference` (Task 7); `openExecutiveDeckV3` from `../../../../data/reporting/executive/deck3` (Task 12, dynamic import); `usePermissions()`'s existing `canMutate`, `getMutationCapability`, `directoryHandle` (already in scope in this component per the exploration).

- [ ] **Step 1: Add state + load-on-mount for the edition preference**

Near the component's other `useState`/`useEffect` workspace-scoped reads (same lifecycle as the existing `directoryHandle`-triggered loads), add:

```tsx
import { loadDeckEditionPreference, saveDeckEditionPreference, type ExecutiveDeckEdition } from "../../../../data/reporting/executive/deckEditionPreference";
```

```tsx
const [deckEdition, setDeckEdition] = useState<ExecutiveDeckEdition>("v2");

useEffect(() => {
  if (!directoryHandle) return;
  let cancelled = false;
  void loadDeckEditionPreference(directoryHandle).then((pref) => {
    if (!cancelled && pref) setDeckEdition(pref.edition);
  });
  return () => { cancelled = true; };
}, [directoryHandle]);

function handleToggleDeckEdition(): void {
  const next: ExecutiveDeckEdition = deckEdition === "v3" ? "v2" : "v3";
  setDeckEdition(next); // reflects immediately for the next export, regardless of save outcome
  if (!directoryHandle) return;
  const capability = getMutationCapability("export-reports");
  if (!capability.allowed) {
    showToast("error", exportBlockedMessage(capability.reason));
    return;
  }
  const session = readSession();
  void saveDeckEditionPreference(directoryHandle, next, session?.username ?? "admin").then((result) => {
    if (!result.ok) showToast("error", result.error);
  });
}
```

- [ ] **Step 2: Branch `handleExport`'s `"deck"` case (line ~503-508) on `deckEdition`**

```tsx
} else if (kind === "deck") {
  if (deckEdition === "v3") {
    const { openExecutiveDeckV3 } = await import("../../../../data/reporting/executive/deck3");
    await openExecutiveDeckV3(execInput, names);
  } else {
    const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
    const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
    await openExecutiveDeckV2(execInput, names, saved?.choices);
  }
  logExport("executive-deck");
  showToast("ok", "تم فتح العرض التنفيذي.");
}
```

- [ ] **Step 3: Branch `generate()`'s `"executive-deck"` case (line ~638-642) the same way**

```tsx
} else if (type === "executive-deck") {
  if (deckEdition === "v3") {
    const { openExecutiveDeckV3 } = await import("../../../../data/reporting/executive/deck3");
    await openExecutiveDeckV3(execInput, names);
  } else {
    const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
    const { openExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
    await openExecutiveDeckV2(execInput, names, saved?.choices);
  }
  showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
}
```

- [ ] **Step 4: Render the toggle in the executive report card**

In the JSX around line 946 (right after the `rh-card-top` div closes, before `rh-card-title`), add:

```tsx
<label className="rh-deck-edition-toggle">
  <input
    type="checkbox"
    checked={deckEdition === "v3"}
    onChange={handleToggleDeckEdition}
    disabled={!selectedMonth}
  />
  <span>التصميم الجديد</span>
</label>
```

- [ ] **Step 5: Add the toggle's CSS to `Reports.css`**

```css
.rh-deck-edition-toggle{
  display:flex;align-items:center;gap:8px;font-size:0.78rem;font-weight:700;
  color:var(--slate,#5d6b7a);cursor:pointer;margin:6px 0 2px;
}
.rh-deck-edition-toggle input{ width:16px;height:16px;cursor:pointer; }
.rh-deck-edition-toggle input:disabled{ cursor:not-allowed;opacity:.5; }
```

- [ ] **Step 6: Add a test to `index.test.tsx`**

Follow whatever existing pattern that test file already uses to mock `directoryHandle`/render `TabView` and assert on export button clicks (reuse its existing render/setup helper rather than writing a new one). Add:

```tsx
it("routes the executive deck export to deck3 when the design toggle is on", async () => {
  // Render TabView with the existing test setup (directoryHandle, selectedMonth
  // already mocked by this file's existing tests), click the "التصميم الجديد"
  // toggle, then trigger the executive deck export and assert the deck3 dynamic
  // import path was used instead of deck2 — mirror how this file's existing
  // export-path tests already mock `import()` (grep this file's existing tests
  // for how deck2's dynamic import is currently asserted/mocked and reuse that
  // exact technique against deck3's import path instead).
});
```

- [ ] **Step 7: Run the test file**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar/Tabs/Reports/TabView.tsx src/components/Sidebar/Tabs/Reports/Reports.css src/components/Sidebar/Tabs/Reports/index.test.tsx
git commit -m "Add (reports): التصميم الجديد toggle — routes executive deck export to deck3, persisted to workspace"
```

---

## Task 14: Full gate sweep + edit log (Tier 3 release gate)

**Files:** none new — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS, count increased by the new test files from Tasks 1-13 (no regressions in the pre-existing count).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors/warnings.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the complexity/regression budget checks**

Run: `npm run check:complexity && npm run check:hex-literals && npm run check:vendor`
Expected: all pass. If `check:hex-literals` flags any raw hex in the new `deck3/theme.ts`/`chartKit.ts` CSS-in-JS strings, confirm those are inside template-literal CSS (same pattern `deck2/theme.ts` already uses, which the check presumably already allows) rather than actual color-literal violations in TS logic.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds — this is the step most likely to catch a bad import path (e.g. a wrong relative path into `deck2/section3/*` from `deck3/slides.ts`) that `vitest`'s per-file transpilation wouldn't catch.

- [ ] **Step 6: Bundle-size check**

Run: `npm run check:bundle-size`
Expected: within budget. `deck3` is dynamically imported (Task 13's `await import(...)`), so it should not land in the initial bundle — if this check flags a size regression, verify the import in `TabView.tsx` is still a dynamic `import()` and not a static top-level import.

- [ ] **Step 7: Version + edit log**

Bump `package.json`'s version per the semver-lite convention (this is a new feature → bump the whole number, e.g. current → next major-in-repo-terms per `check:release`'s comparison rule), then:

```bash
npm run editlog -- --tier=3 --sync-package "Add (executive-report): deck3 — handoff-styled report edition with التصميم الجديد toggle"
```

Fill in the generated entry's `Why:`/`What changed:` prose referencing this plan and the spec doc, and the per-file `**File:**` blocks for every file touched across Tasks 1-13.

- [ ] **Step 8: `check:release`**

Run: `npm run check:release`
Expected: passes (version bump matches the new edit-log entry).

- [ ] **Step 9: Commit**

```bash
git add package.json "docs/edit logs"
git commit -m "Chore (release): version bump + edit log for deck3 executive report edition"
```

---

## Self-Review Notes (for the plan author, not a task)

- **Spec coverage:** Module layout (Tasks 8-12) ✓, chart construction (Task 9) ✓, slideKit extensibility (Task 10, documented in its header comment) ✓, 21-slide data table (Task 11, one block per spec row) ✓, toggle + persistence (Tasks 7, 13) ✓, error handling (Task 13 Step 1's save-failure toast, Task 12's existing try/catch reuse in `TabView.tsx`'s outer `handleExport`/`generate` — no new error path needed, per spec) ✓, testing (every task has its own test) ✓, Tier 3 gates (Task 14) ✓, non-goals (no deck2 changes beyond the 6 export-promotions, no customizer changes, no workloadAccuracy/dailyTrend/section4 slides) — respected, none of Tasks 1-14 touch `DeckDesignCustomizer.tsx` or add a 22nd slide.
- **Two defects caught and fixed during preflight, before any dispatch:** (1) Task 11 originally imported `collectPortAgreementRows` (Task 2) without using it — an unused-import lint failure; removed from both the Consumes list and the import statement, since slides 11/12 already get port accuracy from `model.portAccuracy`. (2) Task 11's slide 4 originally left the locked risk-level definitions as an empty-string placeholder and read a non-existent `model.config.monthlyTarget` (confirmed via grep that `reportModel.ts` never surfaces `config` on `ReportModel` at all). Fixed by reading the actual locked text straight from `design_handoff_xray_qa_deck/Executive Report Deck v2.dc.html`'s slide 4 markup (quoted verbatim into the plan) and by threading `monthlyTarget` through as an explicit parameter (`buildDeck3Slides(model, monthLabel, monthlyTarget)`, supplied by Task 12 from `input.config.monthlyTarget`) instead of a `model.*` field read.
- **Type consistency check:** `collectPortStats`'s return type `{ land: PortPopRow[]; sea: PortPopRow[] }` (from `deck2/slideKit.ts`, already exported) is used identically in Task 11's slide 8. `LevelAccuracyRow`/`PortAgreementRow`/etc. field names in Task 11 match exactly what Tasks 1-2's Interfaces sections define. `ReportModel` field paths used throughout Task 11 (`model.population.byStage`, `model.sample.coverage`, `model.errorAnalysis.totals`, `model.portAccuracy`, `model.resultComparison.reviewerAgreement`, `model.rows`, `model.imageQuality.markingRate`) all trace back to the exact `ReportModel` shape captured during exploration — no invented field names.
