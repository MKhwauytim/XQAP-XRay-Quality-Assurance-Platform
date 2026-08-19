# Executive Report Section 3 Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three analytics pages to the executive deck's القسم 3 — a per-day accuracy trend with SPC control bands, the four-outcome result matrix, and a risk-engine agreement page — and rework the workload page into a real correlation view that ships disabled.

**Architecture:** Three new row fields are bridged from `PreparedPopulationRow` (which already carries them) onto `ExecutiveReportRow` and `DecisionRecord`. A new `byEntryDay` aggregate reuses the existing `aggregateDecisions` fold, so no accuracy math is written anywhere in this plan. A new `timeSeriesBand()` SVG primitive joins the existing chart module. Each page is its own module owning its own CSS, registered with one import and one array entry in `section3/index.ts`.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Vitest (node environment, `globals: false`), pure string-building HTML/SVG — no React, no runtime layout, no external chart library.

**Spec:** [`docs/superpowers/specs/2026-08-19-executive-report-analytics-design.md`](../specs/2026-08-19-executive-report-analytics-design.md)

## Global Constraints

- **UI text is Arabic, layout is RTL.** Code identifiers stay English. Prefer a label key over a hard-coded Arabic string where the string is user-customizable; hard-coded Arabic is acceptable inside report builders, which is what the existing section-3 pages do.
- **Every rate is `number | null`.** A zero denominator yields `null`, rendered as a muted `—`. **Never a fabricated `0%`.** Use `rateOf(num, den)` from `slideKit.ts`.
- **Every rate is gated on data sufficiency** with `isRankable(band(n))` against **its own** denominator — not a larger one. A suppressed value renders `<span class="insuff">—</span>`.
- **Every denominator is visible on the page.** No percentage without its `n` somewhere in view.
- **Every interpolated string routes through `esc()`** from `../../primitives`.
- **Builders are pure.** No `Date.now()`, no `Math.random()`, no I/O. Same input → byte-identical output.
- **No runtime layout recomputation.** Slides are a fixed 630px box with `overflow:hidden`; all sizing is decided at build time.
- **No new accuracy math.** Reuse `aggregateDecisions`, `rateOf`, `buildPChart`. Two copies of the same formula is the exact bug class this report family already shipped once.
- **The four `المستوى` levels are categorical, not a severity ranking.** No severity language anywhere.
- **Snapshot before changing a builder, then diff.** Never regenerate a snapshot first and read it after.
- **New fields on `ExecutiveReportRow` / `DecisionRecord` are optional (`?`)**, matching the documented precedent on `PreparedPopulationRow` (`transitDeclarationNumber?` and friends): nine test files build full `ExecutiveReportRow` literals and must not be forced to learn about fields outside their concern.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/data/reporting/executive/model/entryDay.ts` | **create** — `entryDayOf(iso)`: ISO string → day-of-month or `null` |
| `src/data/reporting/executive/model/entryDay.test.ts` | **create** — parser-boundary tests |
| `src/data/reporting/executiveReportTypes.ts` | **modify** — 3 optional fields on `ExecutiveReportRow` |
| `src/data/reporting/executiveReportData.ts` | **modify** — populate those 3 fields (`:166-205`) |
| `src/data/reporting/executive/model/decisionFactTable.ts` | **modify** — 2 optional fields on `DecisionRecord` |
| `src/data/reporting/executive/model/aggregates.ts` | **modify** — `byEntryDay` + `undatedCounts` |
| `src/data/reporting/executive/model/reportModel.ts` | **modify** — surface `dailyTrend` |
| `src/data/reporting/executive/ui/analyticsCharts.ts` | **modify** — add `timeSeriesBand()` |
| `src/data/reporting/executive/deck2/section3/dailyTrend.ts` | **create** — page A |
| `src/data/reporting/executive/deck2/section3/outcomeMatrix.ts` | **create** — page B |
| `src/data/reporting/executive/deck2/section3/riskEngineAgreement.ts` | **create** — page C |
| `src/data/reporting/executive/deck2/section3/workloadAccuracy.ts` | **modify** — correlation view + disable flag |
| `src/data/reporting/executive/deck2/section3/index.ts` | **modify** — register 3 pages, gate 1 |
| `+ one `.test.ts` beside each new page` | **create** — page tests |

Each page module exports exactly two things: its CSS constant and its slide builder. `section3/index.ts` stays the section's only assembly point.

---

### Task 1: Bridge entry day, محضر, and the risk-engine flag onto the report row

**Files:**
- Create: `src/data/reporting/executive/model/entryDay.ts`
- Create: `src/data/reporting/executive/model/entryDay.test.ts`
- Modify: `src/data/reporting/executiveReportTypes.ts` (the `ExecutiveReportRow` type)
- Modify: `src/data/reporting/executiveReportData.ts:166-205` (the returned row literal)
- Modify: `src/data/reporting/executive/model/decisionFactTable.ts` (`DecisionRecord` type + `buildLevelRecord` return)

**Interfaces:**
- Consumes: `PreparedPopulationRow.xrayEntryDate` (already ISO — see spec §4.1), `.reportNumber`, `.targetedByRiskEngine`
- Produces: `entryDayOf(iso: string | null | undefined): number | null`; `ExecutiveReportRow.entryDay?: number | null`, `.hasReport?: boolean`, `.targetedByRiskEngine?: string | null`; `DecisionRecord.entryDay?: number | null`, `.hasReport?: boolean`

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/model/entryDay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { entryDayOf } from "./entryDay";

describe("entryDayOf", () => {
  it("reads the day from a plain ISO date", () => {
    expect(entryDayOf("2026-05-14")).toBe(14);
  });

  it("reads the day from an ISO date carrying a time component", () => {
    expect(entryDayOf("2026-05-01 18:04:11")).toBe(1);
    expect(entryDayOf("2026-05-16T09:14:30.000Z")).toBe(16);
  });

  it("returns null for a value normalizeDate could not parse and passed through", () => {
    // normalizeDate falls back to returning its input unchanged, so a non-ISO
    // value can legitimately reach this helper. It must never be guessed at.
    expect(entryDayOf("14/05/2026")).toBeNull();
    expect(entryDayOf("not a date")).toBeNull();
    expect(entryDayOf("45123")).toBeNull();
  });

  it("returns null for null, undefined, and empty input", () => {
    expect(entryDayOf(null)).toBeNull();
    expect(entryDayOf(undefined)).toBeNull();
    expect(entryDayOf("")).toBeNull();
  });

  it("returns null for a syntactically ISO value with an impossible day", () => {
    expect(entryDayOf("2026-05-00")).toBeNull();
    expect(entryDayOf("2026-05-32")).toBeNull();
  });

  it("accepts the first and last day of a month", () => {
    expect(entryDayOf("2026-05-01")).toBe(1);
    expect(entryDayOf("2026-05-31")).toBe(31);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/model/entryDay.test.ts`
Expected: FAIL — `Failed to resolve import "./entryDay"`

- [ ] **Step 3: Write the implementation**

Create `src/data/reporting/executive/model/entryDay.ts`:

```ts
/**
 * Day-of-month extractor for the daily-trend page.
 *
 * `PreparedPopulationRow.xrayEntryDate` is ALREADY normalized to `YYYY-MM-DD`
 * by Phase 2 (`populationProcessor.ts:484` → the exported `normalizeDate`), so
 * there is deliberately no date PARSING here — building a second parser would
 * be a second source of truth for date semantics, and the processor's is the
 * one that already handles Excel serials, DD/MM/YYYY, DD-MMM-YYYY and the rest.
 *
 * The one thing this helper must handle is that `normalizeDate` FALLS BACK to
 * returning its input unchanged when it cannot parse (`?? raw`, `?? rawFill`,
 * `String(value)`). So the field is usually, but not guaranteed, ISO. Anything
 * that is not a well-formed ISO date with an in-range day returns `null` and
 * is counted into the page's غير مؤرخ bucket — never guessed at, never dropped
 * silently.
 *
 * Pure: no Date construction, no locale dependence, no I/O.
 */
export function entryDayOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^\d{4}-\d{2}-(\d{2})(?:[T ]|$)/.exec(iso);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/model/entryDay.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Add the three optional fields to `ExecutiveReportRow`**

In `src/data/reporting/executiveReportTypes.ts`, inside the `ExecutiveReportRow` type, immediately after the `notes: string | null;` line, add:

```ts
  /**
   * Day of month (1–31) from `xrayEntryDate`, or `null` when the value was not
   * a well-formed ISO date. Optional for the same reason
   * `PreparedPopulationRow.transitDeclarationNumber` is: nine test files build
   * a full `ExecutiveReportRow` literal by hand, and making these required
   * would force every one of them to learn about fields outside its concern.
   */
  entryDay?: number | null;
  /** A محضر (seizure report) number is present and non-blank on the risk row. */
  hasReport?: boolean;
  /**
   * RAW risk-engine targeting value, exactly as the risk file carried it. The
   * flag→verdict mapping lives in the risk-engine page, NOT here — the real
   * value vocabulary is unknown at design time, so nothing upstream may assume
   * what an affirmative looks like.
   */
  targetedByRiskEngine?: string | null;
```

- [ ] **Step 6: Populate them in the row builder**

In `src/data/reporting/executiveReportData.ts`, add this import beside the existing ones at the top of the file:

```ts
import { entryDayOf } from "./executive/model/entryDay";
```

Then in the returned row literal (currently ending at `notes: pop.notes ?? null,` around `:204`), add immediately after the `notes` line:

```ts
      entryDay: entryDayOf(pop.xrayEntryDate),
      hasReport: (pop.reportNumber ?? "").trim().length > 0,
      targetedByRiskEngine: pop.targetedByRiskEngine ?? null,
```

- [ ] **Step 7: Add the two optional fields to `DecisionRecord`**

In `src/data/reporting/executive/model/decisionFactTable.ts`, inside the `DecisionRecord` type, after `dataSufficiencyGroup: DataSufficiencyBand | null;`, add:

```ts
  /** Day of month from the image's entry date; `null` when undated. Optional —
   *  `reviewerKpis.test.ts` builds `DecisionRecord` literals by hand. */
  entryDay?: number | null;
  /** Whether the image's risk row carried a محضر number. */
  hasReport?: boolean;
```

Then in `buildLevelRecord`'s returned object, alongside the other row-derived fields, add:

```ts
    entryDay: row.entryDay ?? null,
    hasReport: row.hasReport ?? false,
```

- [ ] **Step 8: Write the bridging test**

Append to `src/data/reporting/executive/model/entryDay.test.ts`:

```ts
import { buildExecutiveReportRows } from "../../executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: "2026-05-14",
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function inputWith(rows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("report-row bridging", () => {
  it("carries the entry day onto the report row", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ xrayEntryDate: "2026-05-14" })]));
    expect(row.entryDay).toBe(14);
  });

  it("leaves entryDay null when the date is unusable", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ xrayEntryDate: "غير معروف" })]));
    expect(row.entryDay).toBeNull();
  });

  it("treats a blank or whitespace-only محضر number as absent", () => {
    const [blank] = buildExecutiveReportRows(inputWith([popRow({ reportNumber: "   " })]));
    expect(blank.hasReport).toBe(false);
    const [present] = buildExecutiveReportRows(inputWith([popRow({ reportNumber: "M-42" })]));
    expect(present.hasReport).toBe(true);
  });

  it("carries the risk-engine value through RAW, without interpreting it", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ targetedByRiskEngine: "نعم" })]));
    expect(row.targetedByRiskEngine).toBe("نعم");
  });
});
```

- [ ] **Step 9: Run the test and the neighbouring suites**

Run: `npx vitest run src/data/reporting/executive/model/entryDay.test.ts src/data/reporting/executiveReportData.test.ts src/data/reporting/executive/model/model.test.ts`
Expected: PASS. The optional fields mean no existing fixture needs changing; if any file fails to compile, the field was declared required — go back to Step 5/7.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 11: Commit**

```bash
git add src/data/reporting/executive/model/entryDay.ts src/data/reporting/executive/model/entryDay.test.ts src/data/reporting/executiveReportTypes.ts src/data/reporting/executiveReportData.ts src/data/reporting/executive/model/decisionFactTable.ts
git commit -m "Add (reporting): bridge entry day, محضر flag, and risk-engine value onto the report row"
```

---

### Task 2: Fold accuracy by day of month

**Files:**
- Modify: `src/data/reporting/executive/model/aggregates.ts`
- Modify: `src/data/reporting/executive/model/reportModel.ts`
- Test: `src/data/reporting/executive/model/dailyTrend.model.test.ts` (create)

**Interfaces:**
- Consumes: `DecisionRecord.entryDay` (Task 1), `aggregateDecisions`, `metricsFromCounts`, `emptyCounts`, `sumCounts`
- Produces: `Aggregates.byEntryDay: DayAccuracy[]`, `Aggregates.undatedAccuracy: AccuracyMetrics`; `ReportModel.dailyTrend: { days: DayAccuracy[]; undated: AccuracyMetrics; datedShare: number | null }`
- `DayAccuracy = AccuracyMetrics & { day: number }`

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/model/dailyTrend.model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import { buildAggregates } from "./aggregates";
import { buildDecisionRecords, buildImageComparisons } from "./decisionFactTable";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function reportRow(overrides: Partial<ExecutiveReportRow> = {}): ExecutiveReportRow {
  return {
    xrayImageId: "XR-1",
    portCode: "P1",
    portName: "منفذ الاختبار",
    portType: "منفذ بري",
    movementType: "بري",
    stage: "المستوى الأول",
    levelOneEmployeeId: "E1",
    levelTwoEmployeeId: "E2",
    levelOneResult: "سليمة",
    levelTwoResult: "سليمة",
    imageResult: "سليمة",
    selectedInSample: true,
    assignedTo: "rev1",
    distributionStatus: "completed",
    expertResult: "سليمة",
    imageAvailable: true,
    noImageReason: null,
    hasMarking: true,
    imageQuality: "عالي",
    lowQualityReason: null,
    suspicionLevel: null,
    suspectedTypes: null,
    smuggleMethod: null,
    answerStatus: "submitted",
    assignedAt: null,
    submittedAt: null,
    imageResultAccurate: true,
    levelOneAccurate: true,
    levelTwoAccurate: true,
    verificationCategory: "correct-clean",
    otherResults: {
      manual: { result: null, employeeId: null },
      opposite: { result: null, employeeId: null },
      liveMeans: { result: null, employeeId: null },
    },
    notes: null,
    entryDay: 5,
    hasReport: false,
    targetedByRiskEngine: null,
    ...overrides,
  };
}

function aggregatesFor(rows: ExecutiveReportRow[]) {
  const facts = buildDecisionRecords(rows, "مايو 2026");
  return buildAggregates(facts, buildImageComparisons(rows), DEFAULT_EXEC_CONFIG);
}

describe("byEntryDay", () => {
  it("buckets decisions by day, ascending, with days absent rather than zero-filled", () => {
    const agg = aggregatesFor([
      reportRow({ xrayImageId: "A", entryDay: 3 }),
      reportRow({ xrayImageId: "B", entryDay: 1 }),
      reportRow({ xrayImageId: "C", entryDay: 3 }),
    ]);
    expect(agg.byEntryDay.map((d) => d.day)).toEqual([1, 3]);
    // two decision records per image (L1 + L2)
    expect(agg.byEntryDay[0].evaluable).toBe(2);
    expect(agg.byEntryDay[1].evaluable).toBe(4);
  });

  it("routes undated decisions to their own bucket, never to a day", () => {
    const agg = aggregatesFor([
      reportRow({ xrayImageId: "A", entryDay: 7 }),
      reportRow({ xrayImageId: "B", entryDay: null }),
    ]);
    expect(agg.byEntryDay.map((d) => d.day)).toEqual([7]);
    expect(agg.undatedAccuracy.evaluable).toBe(2);
  });

  it("reconciles: dated + undated evaluable equals the month total", () => {
    const rows = [
      reportRow({ xrayImageId: "A", entryDay: 1 }),
      reportRow({ xrayImageId: "B", entryDay: null }),
      reportRow({ xrayImageId: "C", entryDay: 9 }),
    ];
    const agg = aggregatesFor(rows);
    const dated = agg.byEntryDay.reduce((s, d) => s + d.evaluable, 0);
    const total = agg.byPort.reduce((s, p) => s + p.evaluable, 0);
    expect(dated + agg.undatedAccuracy.evaluable).toBe(total);
  });

  it("counts the four outcome classes per day", () => {
    const agg = aggregatesFor([
      reportRow({
        xrayImageId: "A",
        entryDay: 2,
        levelOneResult: "سليمة",
        levelTwoResult: "سليمة",
        expertResult: "اشتباه",
      }),
    ]);
    expect(agg.byEntryDay[0].missedSuspicion).toBe(2);
    expect(agg.byEntryDay[0].accuracy).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/model/dailyTrend.model.test.ts`
Expected: FAIL — `agg.byEntryDay is undefined`

- [ ] **Step 3: Add the fold to `aggregates.ts`**

Add the exported type next to the other keyed types (after `ErrorTypeBreakdown`):

```ts
/** One day-of-month bucket of the decision fact table. */
export type DayAccuracy = AccuracyMetrics & { day: number };
```

Add these two fields to the `Aggregates` type, after `errorTypeByPort`:

```ts
  /** Accuracy per day of month (1–31), ascending; days with no evaluable
   *  decision are ABSENT, not zero-filled — a gap must render as a gap. */
  byEntryDay: DayAccuracy[];
  /** The غير مؤرخ bucket: evaluable decisions whose image carried no usable
   *  entry date. Never merged into a day. */
  undatedAccuracy: AccuracyMetrics;
```

Add the fold function beside `buildErrorTypeByPort`:

```ts
/**
 * Fold the fact table by day of month. Reuses `aggregateDecisions` — the ONE
 * shared fold — so a day's accuracy can never drift from the port page's, which
 * is exactly the class of bug three independent folds produced before.
 *
 * Undated records are keyed to a sentinel and split out afterwards rather than
 * being dropped: the page states the dated/undated split, so both halves must
 * survive the fold.
 */
const UNDATED_KEY = "__undated__";

function buildByEntryDay(
  records: DecisionRecord[],
  config: ExecutiveReportConfig
): { days: DayAccuracy[]; undated: AccuracyMetrics } {
  const map = aggregateDecisions(records, "decision", (r) =>
    typeof r.entryDay === "number" ? String(r.entryDay) : UNDATED_KEY
  , UNDATED_KEY);

  const undatedCounts = map.get(UNDATED_KEY) ?? emptyCounts();
  const days: DayAccuracy[] = [];
  for (const [key, counts] of map) {
    if (key === UNDATED_KEY) continue;
    days.push({ day: Number(key), ...metricsFromCounts(counts, config) });
  }
  days.sort((a, b) => a.day - b.day);
  return { days, undated: metricsFromCounts(undatedCounts, config) };
}
```

In `buildAggregates`, add before the returned object:

```ts
  const entryDay = buildByEntryDay(records, config);
```

and add to the returned object:

```ts
    byEntryDay: entryDay.days,
    undatedAccuracy: entryDay.undated,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/model/dailyTrend.model.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Surface it on the report model**

In `src/data/reporting/executive/model/reportModel.ts`, add to the `ReportModel` type after `portAccuracyByLevel`:

```ts
  /** Per-day accuracy for the القسم 3 trend page, plus the غير مؤرخ bucket and
   *  the share of evaluable decisions that carried a usable date. `datedShare`
   *  is `null` when there are no evaluable decisions at all. */
  dailyTrend: {
    days: Aggregates["byEntryDay"];
    undated: Aggregates["undatedAccuracy"];
    datedShare: number | null;
  };
```

and in the returned object, after `portAccuracyByLevel: aggregates.byPortAndLevel,`:

```ts
    dailyTrend: (() => {
      const dated = aggregates.byEntryDay.reduce((s, d) => s + d.evaluable, 0);
      const total = dated + aggregates.undatedAccuracy.evaluable;
      return {
        days: aggregates.byEntryDay,
        undated: aggregates.undatedAccuracy,
        datedShare: total > 0 ? (dated / total) * 100 : null,
      };
    })(),
```

- [ ] **Step 6: Add the datedShare test**

Append to `dailyTrend.model.test.ts`:

```ts
import { buildReportModel } from "./reportModel";

describe("dailyTrend.datedShare", () => {
  it("is the share of evaluable decisions carrying a usable date", () => {
    const model = buildReportModel({
      monthFolderName: "5-may-2026",
      populationRows: [],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });
    expect(model.dailyTrend.datedShare).toBeNull();
    expect(model.dailyTrend.days).toEqual([]);
  });
});
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/data/reporting/executive/model/ && npm run typecheck`
Expected: PASS, clean

- [ ] **Step 8: Commit**

```bash
git add src/data/reporting/executive/model/aggregates.ts src/data/reporting/executive/model/reportModel.ts src/data/reporting/executive/model/dailyTrend.model.test.ts
git commit -m "Add (reporting): fold decision accuracy by day of month, with an explicit undated bucket"
```

---

### Task 3: `timeSeriesBand()` chart primitive

**Files:**
- Modify: `src/data/reporting/executive/ui/analyticsCharts.ts`
- Test: `src/data/reporting/executive/ui/timeSeriesBand.test.ts` (create)

**Interfaces:**
- Consumes: the module's existing private helpers `svgOpen`, `emptyState`, `isNum`, `r`, `cssVar`, `TYPE`, and the `ColorRole` type
- Produces:
```ts
export type BandPoint = { x: number; y: number | null; n: number; lo: number | null; hi: number | null };
export type BandSeries = { label: string; tone: ColorRole; points: BandPoint[] };
export type TimeSeriesBandOpts = { width?: number; height?: number; caption?: string; xMax?: number; emptyNote?: string };
export function timeSeriesBand(series: BandSeries[], opts?: TimeSeriesBandOpts): string;
```

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/ui/timeSeriesBand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timeSeriesBand } from "./analyticsCharts";
import type { BandSeries } from "./analyticsCharts";

function series(points: BandSeries["points"]): BandSeries[] {
  return [{ label: "دقة السليمة", tone: "good", points }];
}

describe("timeSeriesBand", () => {
  it("renders an empty state when no series has a plottable point", () => {
    const html = timeSeriesBand(series([{ x: 1, y: null, n: 0, lo: null, hi: null }]));
    expect(html).toContain("<svg");
    expect(html).toContain("—");
  });

  it("renders one polyline segment per contiguous run and never bridges a gap", () => {
    const html = timeSeriesBand(
      series([
        { x: 1, y: 90, n: 10, lo: 80, hi: 100 },
        { x: 2, y: null, n: 0, lo: null, hi: null },
        { x: 3, y: 95, n: 10, lo: 85, hi: 100 },
      ]),
    );
    // two separate runs → two polylines, not one spanning x=1..3
    expect((html.match(/<polyline/g) ?? [])).toHaveLength(2);
  });

  it("keeps the x axis at a fixed 1..31 regardless of how sparse the data is", () => {
    const dense = timeSeriesBand(series([{ x: 1, y: 50, n: 5, lo: 40, hi: 60 }]));
    const sparse = timeSeriesBand(series([{ x: 31, y: 50, n: 5, lo: 40, hi: 60 }]));
    expect(dense).toContain('data-x-max="31"');
    expect(sparse).toContain('data-x-max="31"');
  });

  it("marks a point that falls outside its own band", () => {
    const html = timeSeriesBand(
      series([
        { x: 1, y: 95, n: 20, lo: 90, hi: 99 },
        { x: 2, y: 50, n: 20, lo: 90, hi: 99 },
      ]),
    );
    expect(html).toContain("ts-out");
  });

  it("escapes series labels", () => {
    const html = timeSeriesBand([
      { label: '<script>x</script>', tone: "good", points: [{ x: 1, y: 50, n: 5, lo: 40, hi: 60 }] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is deterministic — same input, byte-identical output", () => {
    const points = [{ x: 4, y: 88.5, n: 12, lo: 70, hi: 99 }];
    expect(timeSeriesBand(series(points))).toBe(timeSeriesBand(series(points)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/ui/timeSeriesBand.test.ts`
Expected: FAIL — `timeSeriesBand is not a function`

- [ ] **Step 3: Implement it**

Append to `src/data/reporting/executive/ui/analyticsCharts.ts`, following the file's existing section-comment style:

```ts
// ════════════════════════════════════════════════════════════════════════════
// 4. timeSeriesBand — day-of-month series with per-point control bands
// ════════════════════════════════════════════════════════════════════════════

/** One day's point. `y === null` is a GAP (no evaluable decisions that day) and
 *  must never be interpolated across — a quiet day is not a measurement. */
export type BandPoint = {
  x: number;
  y: number | null;
  n: number;
  lo: number | null;
  hi: number | null;
};

export type BandSeries = {
  label: string;
  tone: ColorRole;
  points: BandPoint[];
};

export type TimeSeriesBandOpts = {
  width?: number;
  height?: number;
  caption?: string;
  /** Fixed axis maximum. Defaults to 31 — the axis is the MONTH, not the data,
   *  so a sparse month must not silently compress into a dense-looking chart. */
  xMax?: number;
  emptyNote?: string;
};

/**
 * A percentage time series over day-of-month, each series carrying a shaded
 * control band. Points outside their own band get an explicit marker — that
 * signal is the entire reason the band is drawn.
 *
 * Pure SVG string, built once at render time. No runtime layout recomputation,
 * per the deck's standing rule.
 */
export function timeSeriesBand(series: BandSeries[], opts: TimeSeriesBandOpts = {}): string {
  const w = opts.width ?? 620;
  const h = opts.height ?? 300;
  const xMax = opts.xMax ?? 31;
  const title = opts.caption ?? "الاتجاه اليومي";
  const plottable = series.filter((s) => s.points.some((p) => isNum(p.y)));
  if (plottable.length === 0) return emptyState(w, h, title, opts.emptyNote);

  const padL = 44;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const sx = (x: number): number => padL + ((x - 1) / (xMax - 1)) * plotW;
  const sy = (y: number): number => padT + (1 - Math.max(0, Math.min(100, y)) / 100) * plotH;

  // Horizontal gridlines + y labels at 0/25/50/75/100.
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${r(padL)}" y1="${r(sy(v))}" x2="${r(w - padR)}" y2="${r(sy(v))}" ` +
        `stroke="currentColor" stroke-opacity="0.12"/>` +
        `<text x="${r(padL - 6)}" y="${r(sy(v) + 3)}" text-anchor="end" ` +
        `font-size="${TYPE.tick}" fill="currentColor" fill-opacity="0.55">${v}</text>`,
    )
    .join("");

  // X ticks every 5 days plus the last day.
  const ticks = [1, 5, 10, 15, 20, 25, 30, xMax]
    .filter((d, i, a) => d <= xMax && a.indexOf(d) === i)
    .map(
      (d) =>
        `<text x="${r(sx(d))}" y="${r(h - padB + 16)}" text-anchor="middle" ` +
        `font-size="${TYPE.tick}" fill="currentColor" fill-opacity="0.55">${d}</text>`,
    )
    .join("");

  const body = plottable
    .map((s) => {
      const color = cssVar(s.tone);
      // Contiguous runs of plottable points — a null y ENDS the run.
      const runs: BandPoint[][] = [];
      let run: BandPoint[] = [];
      for (const p of s.points) {
        if (isNum(p.y)) run.push(p);
        else if (run.length > 0) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length > 0) runs.push(run);

      const bands = runs
        .filter((rn) => rn.every((p) => isNum(p.lo) && isNum(p.hi)))
        .map((rn) => {
          const top = rn.map((p) => `${r(sx(p.x))},${r(sy(p.hi as number))}`).join(" ");
          const bottom = [...rn]
            .reverse()
            .map((p) => `${r(sx(p.x))},${r(sy(p.lo as number))}`)
            .join(" ");
          return `<polygon points="${top} ${bottom}" fill="${color}" fill-opacity="0.14"/>`;
        })
        .join("");

      const lines = runs
        .map(
          (rn) =>
            `<polyline points="${rn
              .map((p) => `${r(sx(p.x))},${r(sy(p.y as number))}`)
              .join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`,
        )
        .join("");

      const dots = s.points
        .filter((p) => isNum(p.y))
        .map((p) => {
          const y = p.y as number;
          const out = isNum(p.lo) && isNum(p.hi) && (y > (p.hi as number) || y < (p.lo as number));
          return (
            `<circle class="${out ? "ts-out" : "ts-dot"}" cx="${r(sx(p.x))}" cy="${r(sy(y))}" ` +
            `r="${out ? 4.5 : 2.5}" fill="${out ? color : color}" ` +
            `stroke="${out ? "currentColor" : "none"}" stroke-width="${out ? 1.5 : 0}"/>`
          );
        })
        .join("");

      return bands + lines + dots;
    })
    .join("");

  const legend = plottable
    .map(
      (s, i) =>
        `<g transform="translate(${r(padL + i * 150)}, ${r(padT - 6)})">` +
        `<rect width="9" height="9" y="-8" rx="2" fill="${cssVar(s.tone)}"/>` +
        `<text x="14" font-size="${TYPE.tick}" fill="currentColor" fill-opacity="0.75">${escText(
          s.label,
        )}</text></g>`,
    )
    .join("");

  return (
    `<div class="v2-ts-wrap" data-x-max="${xMax}">` +
    svgOpen(w, h, title) +
    grid +
    ticks +
    body +
    legend +
    `</svg></div>`
  );
}
```

> **Note for the implementer:** `svgOpen`, `emptyState`, `isNum`, `r`, `cssVar`, `escText` and `TYPE` are existing private helpers in this file. If any of their names differ from the above, use the file's actual names — do NOT add duplicates. `TYPE.tick` is used by the existing charts for axis text; if the property is named differently, match it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/ui/timeSeriesBand.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the existing chart tests still pass**

Run: `npx vitest run src/data/reporting/executive/ui/`
Expected: PASS — this task only appends; nothing existing should change.

- [ ] **Step 6: Commit**

```bash
git add src/data/reporting/executive/ui/analyticsCharts.ts src/data/reporting/executive/ui/timeSeriesBand.test.ts
git commit -m "Add (reporting): timeSeriesBand chart primitive with per-point control bands"
```

---

### Task 4: الاتجاه اليومي للدقة page

**Files:**
- Create: `src/data/reporting/executive/deck2/section3/dailyTrend.ts`
- Create: `src/data/reporting/executive/deck2/section3/dailyTrend.test.ts`
- Modify: `src/data/reporting/executive/deck2/section3/index.ts`

**Interfaces:**
- Consumes: `ReportModel.dailyTrend` (Task 2), `timeSeriesBand`/`BandSeries` (Task 3), `buildPChart`/`P_CHART_MIN_N` from `../../model/reviewerKpis`, `v2Slide`/`rateOf`/`pctCell` from `../slideKit`
- Produces: `DAILY_TREND_CSS: string`, `dailyTrendSlide(model, num, total, variantPreview): string`

**Two lines, both using the deck's existing formulas verbatim** (`slides.ts:3148-3149`):
- دقة الاشتباه = `correctSuspicion / (correctSuspicion + missedSuspicion)`
- دقة السليمة = `correctClean / (correctClean + falseSuspicion)`

Control limits come from `buildPChart`, which is **already exported** — do not reimplement or re-extract it. Each series gets its own p-chart against its own denominator, so the سليمة band is tight and the اشتباه band is wide.

- [ ] **Step 1: Write the failing test**

Create `src/data/reporting/executive/deck2/section3/dailyTrend.test.ts`. Reuse the `reportRow` fixture helper from `dailyTrend.model.test.ts` (copy it in — do not import across test files):

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import { DAILY_TREND_CSS, dailyTrendSlide } from "./dailyTrend";

// popRow(): copy the fixture from entryDay.test.ts Step 8 verbatim.

function modelWith(rows: PreparedPopulationRow[]) {
  const input: ExecutiveReportInput = {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
  return buildReportModel(input);
}

describe("dailyTrendSlide", () => {
  it("renders the slide shell with its own id and section", () => {
    const html = dailyTrendSlide(modelWith([popRow()]), 5, 20, false);
    expect(html).toContain('id="slide-s3-daily-trend"');
    expect(html).toContain('data-section="section3"');
  });

  it("states the dated share and the غير مؤرخ count as a headline, not a footnote", () => {
    const html = dailyTrendSlide(
      modelWith([
        popRow({ xrayImageId: "A", xrayEntryDate: "2026-05-01" }),
        popRow({ xrayImageId: "B", xrayEntryDate: "غير معروف" }),
      ]),
      5,
      20,
      false,
    );
    expect(html).toContain("غير مؤرخ");
    expect(html).toContain("v2-dt-share");
  });

  it("renders an honest empty state when no decision carries a date", () => {
    const html = dailyTrendSlide(
      modelWith([popRow({ xrayEntryDate: "غير معروف" })]),
      5,
      20,
      false,
    );
    expect(html).toContain("v2-dt-empty");
  });

  it("exposes four variant panels in preview mode and one in production", () => {
    const model = modelWith([popRow()]);
    expect((dailyTrendSlide(model, 5, 20, true).match(/v2-variant-panel/g) ?? [])).toHaveLength(4);
    expect(dailyTrendSlide(model, 5, 20, false)).not.toContain("v2-variant-panel");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow()]);
    expect(dailyTrendSlide(model, 5, 20, false)).toBe(dailyTrendSlide(model, 5, 20, false));
  });

  it("ships CSS scoped to its own class prefix", () => {
    expect(DAILY_TREND_CSS).toContain(".v2-dt-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/dailyTrend.test.ts`
Expected: FAIL — cannot resolve `./dailyTrend`

- [ ] **Step 3: Implement the page**

Create `src/data/reporting/executive/deck2/section3/dailyTrend.ts`.

The subtle part is turning the day folds into banded series — that logic in full. Everything else on the page is presentation around it:

```ts
import { buildPChart, P_CHART_MIN_N } from "../../model/reviewerKpis";
import { timeSeriesBand } from "../../ui/analyticsCharts";
import type { BandPoint, BandSeries } from "../../ui/analyticsCharts";
import type { ReportModel } from "../../model/reportModel";

/** Below this dated-share percentage the page renders an explicit caution
 *  line: the chart then describes a fraction of the month, and that fact has
 *  to be as visible as the chart itself. */
const CAUTION_THRESHOLD = 80;

type DayFold = ReportModel["dailyTrend"]["days"][number];

/**
 * Build one banded series from a numerator/denominator pair over the day folds.
 *
 * Both formulas come from the deck's existing accuracy page VERBATIM
 * (slides.ts:3148-3149) — this module invents no accuracy math:
 *   دقة الاشتباه = correctSuspicion / (correctSuspicion + missedSuspicion)
 *   دقة السليمة  = correctClean    / (correctClean    + falseSuspicion)
 *
 * Control limits come from `buildPChart`, already exported by reviewerKpis.ts
 * and already tested there. Each series gets its OWN p-chart against its OWN
 * denominator, which is why the سليمة band comes out tight and the اشتباه band
 * wide — that asymmetry is the honest picture, not a defect.
 */
function bandSeriesFrom(
  days: DayFold[],
  label: string,
  tone: BandSeries["tone"],
  numOf: (d: DayFold) => number,
  denOf: (d: DayFold) => number,
): BandSeries {
  const chart = buildPChart(
    days.map((d) => ({ key: String(d.day), n: denOf(d), x: numOf(d) })),
    P_CHART_MIN_N,
  );
  const byDay = new Map(chart.groups.map((g) => [Number(g.key), g]));

  const points: BandPoint[] = days.map((d): BandPoint => {
    const g = byDay.get(d.day);
    // n === 0 days are dropped by buildPChart and become an explicit GAP here.
    // A day nobody screened is not a measurement of zero accuracy.
    if (!g) return { x: d.day, y: null, n: 0, lo: null, hi: null };
    return {
      x: d.day,
      y: g.p * 100,
      n: g.n,
      // A low-n day keeps its point but loses its band: the limits exist but
      // are not trustworthy at that subgroup size, and drawing them would
      // dress up noise as a measured range.
      lo: g.lowN ? null : g.lcl * 100,
      hi: g.lowN ? null : g.ucl * 100,
    };
  });

  return { label, tone, points };
}

function buildSeries(days: DayFold[]): BandSeries[] {
  return [
    bandSeriesFrom(
      days,
      "دقة السليمة",
      "good",
      (d) => d.correctClean,
      (d) => d.correctClean + d.falseSuspicion,
    ),
    bandSeriesFrom(
      days,
      "دقة الاشتباه",
      "warn",
      (d) => d.correctSuspicion,
      (d) => d.correctSuspicion + d.missedSuspicion,
    ),
  ];
}
```

Then assemble the page body around it:

1. **Module header comment** stating: the two formulas and where they come from; that limits come from the already-exported `buildPChart`; that a `null` day is a gap and is never interpolated across; and that the dated share is a headline because a low-coverage month otherwise reads as a complete picture.
2. **Share headline** (`.v2-dt-share`) — dated share via `fmtPct(model.dailyTrend.datedShare)`, the غير مؤرخ evaluable count via `fmtNum(model.dailyTrend.undated.evaluable)`, and — when `datedShare !== null && datedShare < CAUTION_THRESHOLD` — an explicit caution line.
3. **The chart**: `timeSeriesBand(buildSeries(model.dailyTrend.days), { caption: "الاتجاه اليومي للدقة" })`.
4. **A per-day `n` strip**, so no percentage appears without its denominator in view.
5. **A legend** explaining what the shaded band means and that a hollow point is a low-n day.
6. **Empty state** (`.v2-dt-empty`) when `model.dailyTrend.days.length === 0`, naming the غير مؤرخ count so an all-undated month explains itself rather than looking broken.
7. `v2Slide({ id: "slide-s3-daily-trend", section: "section3", iconName: "chart", headline: "الاتجاه اليومي للدقة", bodyVariants: [body, body, body, body], variantPreview, num, total })` — the single-variant pattern documented at `section4/coverage.ts:124`.
8. `DAILY_TREND_CSS`, every rule scoped under `.v2-dt-`, with a `body.theme-light` block and `@media print { break-inside: avoid; }`, matching `markingImpact.ts`'s CSS shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/dailyTrend.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Register the page**

In `src/data/reporting/executive/deck2/section3/index.ts`:

```ts
import { DAILY_TREND_CSS, dailyTrendSlide } from "./dailyTrend";
```

Add `DAILY_TREND_CSS` to the `SECTION_THREE_CSS` array, and add to the returned builder array immediately after the `workloadAccuracySlideBuilders(...)` spread:

```ts
    (num, total) => dailyTrendSlide(model, num, total, variantPreview),
```

- [ ] **Step 6: Verify it renders in the real deck**

Run: `npm run report:static && grep -c 'slide-s3-daily-trend' dist-preview/executive-report.html`
Expected: `1`

> The demo fixture's `xrayEntryDate` is `null` for every row, so this will render the empty state. That is the correct result and confirms the empty path. Task 8 adds dates to the fixture.

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/dailyTrend.ts src/data/reporting/executive/deck2/section3/dailyTrend.test.ts src/data/reporting/executive/deck2/section3/index.ts
git commit -m "Add (reporting): daily accuracy trend page with SPC control bands"
```

---

### Task 5: مصفوفة نتائج الفحص page

**Files:**
- Create: `src/data/reporting/executive/deck2/section3/outcomeMatrix.ts`
- Create: `src/data/reporting/executive/deck2/section3/outcomeMatrix.test.ts`
- Modify: `src/data/reporting/executive/deck2/section3/index.ts`

**Interfaces:**
- Consumes: `ReportModel.errorAnalysis.totals` and `.byPort` (`ErrorTypeBreakdown[]`), `rateOf`, `pctCell`, `barCell`, `v2Slide`
- Produces: `OUTCOME_MATRIX_CSS: string`, `outcomeMatrixSlide(model, num, total, variantPreview): string`

The four classes, in the fixed order/label/tone the report already uses (`markingImpact.ts`'s `OUTCOME_CLASSES`):

| | المراجع: اشتباه | المراجع: سليمة |
|---|---|---|
| **الفحص: اشتباه** | اشتباه صحيح (`correctSuspicion`, blue) | اشتباه خاطئ (`falseSuspicion`, gold) |
| **الفحص: سليمة** | **اشتباه فائت** (`missedSuspicion`, coral) | سليمة صحيحة (`correctClean`, green) |

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { OUTCOME_MATRIX_CSS, outcomeMatrixSlide } from "./outcomeMatrix";
// popRow / modelWith: copy from dailyTrend.test.ts

describe("outcomeMatrixSlide", () => {
  it("renders the slide shell", () => {
    const html = outcomeMatrixSlide(modelWith([popRow()]), 6, 20, false);
    expect(html).toContain('id="slide-s3-outcome-matrix"');
    expect(html).toContain('data-section="section3"');
  });

  it("states اشتباه فائت as an absolute count, not only a rate", () => {
    const html = outcomeMatrixSlide(
      modelWith([
        popRow({
          xrayImageId: "A",
          xrayLevelOneResult: "سليمة",
          xrayLevelTwoResult: "سليمة",
        }),
      ]),
      6,
      20,
      false,
    );
    expect(html).toContain("اشتباه فائت");
    expect(html).toContain("v2-om-count");
  });

  it("renders — rather than 0% when there is nothing evaluable", () => {
    const html = outcomeMatrixSlide(modelWith([]), 6, 20, false);
    expect(html).not.toContain("0.0%");
  });

  it("lists ports below the month-wide matrix", () => {
    const html = outcomeMatrixSlide(modelWith([popRow()]), 6, 20, false);
    expect(html).toContain("v2-om-ports");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow()]);
    expect(outcomeMatrixSlide(model, 6, 20, false)).toBe(outcomeMatrixSlide(model, 6, 20, false));
  });

  it("ships scoped CSS", () => {
    expect(OUTCOME_MATRIX_CSS).toContain(".v2-om-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/outcomeMatrix.test.ts`
Expected: FAIL — cannot resolve `./outcomeMatrix`

- [ ] **Step 3: Implement the page**

Create `outcomeMatrix.ts`. The matrix cell builder in full:

```ts
import type { ErrorTypeBreakdown } from "../../model/aggregates";
import { esc, fmtNum } from "../../primitives";
import { rateOf, pctCell } from "../slideKit";
import type { CellTone } from "../slideKit";

/**
 * One cell of the 2x2. The COUNT is the primary figure and is always printed:
 * اشتباه فائت is the single number an audit of this kind exists to produce, and
 * a bare percentage buries it. The share is secondary and goes through
 * `rateOf`, so a zero denominator renders "—" rather than a fabricated 0%.
 */
function matrixCell(
  label: string,
  count: number,
  evaluable: number,
  tone: CellTone,
  emphasis = false,
): string {
  return `<div class="v2-om-cell ${tone}${emphasis ? " emphasis" : ""}">
    <div class="v2-om-cell-label">${esc(label)}</div>
    <div class="v2-om-count">${fmtNum(count)}</div>
    <div class="v2-om-share">${pctCell(rateOf(count, evaluable))}</div>
  </div>`;
}

/** The 2x2, in the fixed order/label/tone the report already uses for this
 *  legend (markingImpact.ts's OUTCOME_CLASSES / document/frontMatter.ts). */
function matrixBlock(t: ErrorTypeBreakdown): string {
  return `<div class="v2-om-matrix">
    <div class="v2-om-corner"></div>
    <div class="v2-om-colhead">المراجع: اشتباه</div>
    <div class="v2-om-colhead">المراجع: سليمة</div>
    <div class="v2-om-rowhead">الفحص: اشتباه</div>
    ${matrixCell("اشتباه صحيح", t.correctSuspicion, t.evaluable, "blue")}
    ${matrixCell("اشتباه خاطئ", t.falseSuspicion, t.evaluable, "gold")}
    <div class="v2-om-rowhead">الفحص: سليمة</div>
    ${matrixCell("اشتباه فائت", t.missedSuspicion, t.evaluable, "coral", true)}
    ${matrixCell("سليمة صحيحة", t.correctClean, t.evaluable, "green")}
  </div>`;
}
```

Then:

1. **Module header comment** stating that the grain here is **decision** (one record per level per image) and why — `markingImpact.ts` deliberately uses IMAGE grain, and mixing the two is how this report family has produced disagreeing numbers before. Also state that `model.errorAnalysis` is read verbatim and nothing is refolded in this module.
2. **`matrixBlock(model.errorAnalysis.totals)`** for the month-wide 2×2.
3. **Per-port table** (`.v2-om-ports`) from `model.errorAnalysis.byPort`, sorted by `missedSuspicion` descending then `key` ascending for a stable, deterministic order, with a totals row. Every rate through `rateOf`, gated with `isRankable(band(p.evaluable))`.
4. **Totals band** naming total evaluable decisions, so the matrix's denominator is stated.
5. `v2Slide({ id: "slide-s3-outcome-matrix", section: "section3", iconName: "alert", headline: "مصفوفة نتائج الفحص", bodyVariants: [body, body, body, body], variantPreview, num, total })`.
6. `OUTCOME_MATRIX_CSS` scoped under `.v2-om-`, with light-theme and print blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/outcomeMatrix.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Register it**

In `section3/index.ts`, import `OUTCOME_MATRIX_CSS`/`outcomeMatrixSlide`, add the CSS to the array, and add the builder entry immediately after the daily-trend entry.

- [ ] **Step 6: Verify in the real deck**

Run: `npm run report:static && grep -c 'slide-s3-outcome-matrix' dist-preview/executive-report.html`
Expected: `1`

- [ ] **Step 7: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/outcomeMatrix.ts src/data/reporting/executive/deck2/section3/outcomeMatrix.test.ts src/data/reporting/executive/deck2/section3/index.ts
git commit -m "Add (reporting): مصفوفة نتائج الفحص page — the four outcome classes, overall and per port"
```

---

### Task 6: توافق نتائج الفحص مع محرك المخاطر page

**Files:**
- Create: `src/data/reporting/executive/deck2/section3/riskEngineAgreement.ts`
- Create: `src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts`
- Modify: `src/data/reporting/executive/deck2/section3/index.ts`

**Interfaces:**
- Consumes: `ReportModel.rows` (`entryDay` unused here; `targetedByRiskEngine`, `hasReport`, `stage`, `levelOneResult`, `levelTwoResult`, `expertResult`)
- Produces: `RISK_ENGINE_CSS: string`, `riskEngineAgreementSlide(model, num, total, variantPreview): string`, and the exported mapper `engineVerdictOf(raw: string | null | undefined): "اشتباه" | "سليمة" | null`

**The mapping rule — this is the correctness core of the page.** A blank or unrecognized value maps to `null` and is excluded from every rate. **A blank must never map to سليمة**: it means "we do not know what the engine said", not "the engine cleared it", and mapping it to a clean verdict would fabricate agreement across potentially most of the month.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { RISK_ENGINE_CSS, engineVerdictOf, riskEngineAgreementSlide } from "./riskEngineAgreement";
// popRow / modelWith: copy from dailyTrend.test.ts

describe("engineVerdictOf", () => {
  it("maps recognized affirmatives to اشتباه", () => {
    for (const v of ["نعم", "مستهدف", "Y", "YES", "TRUE", "1"]) {
      expect(engineVerdictOf(v)).toBe("اشتباه");
    }
  });

  it("maps recognized negatives to سليمة", () => {
    for (const v of ["لا", "غير مستهدف", "N", "NO", "FALSE", "0"]) {
      expect(engineVerdictOf(v)).toBe("سليمة");
    }
  });

  it("NEVER maps a blank to سليمة — blank means unknown", () => {
    expect(engineVerdictOf(null)).toBeNull();
    expect(engineVerdictOf("")).toBeNull();
    expect(engineVerdictOf("   ")).toBeNull();
  });

  it("maps an unrecognized value to null rather than guessing", () => {
    expect(engineVerdictOf("ربما")).toBeNull();
    expect(engineVerdictOf("xyz")).toBeNull();
  });

  it("ignores surrounding whitespace and case", () => {
    expect(engineVerdictOf("  yes  ")).toBe("اشتباه");
    expect(engineVerdictOf(" نعم ")).toBe("اشتباه");
  });
});

describe("riskEngineAgreementSlide", () => {
  it("renders the slide shell", () => {
    const html = riskEngineAgreementSlide(modelWith([popRow()]), 8, 20, false);
    expect(html).toContain('id="slide-s3-risk-engine"');
    expect(html).toContain('data-section="section3"');
  });

  it("prints the recognized / unrecognized / blank counts so the vocabulary is discoverable", () => {
    const html = riskEngineAgreementSlide(
      modelWith([
        popRow({ xrayImageId: "A", targetedByRiskEngine: "نعم" }),
        popRow({ xrayImageId: "B", targetedByRiskEngine: "ربما" }),
        popRow({ xrayImageId: "C", targetedByRiskEngine: null }),
      ]),
      8,
      20,
      false,
    );
    expect(html).toContain("v2-re-coverage");
  });

  it("carries the definitional-overlap footnote", () => {
    const html = riskEngineAgreementSlide(modelWith([popRow()]), 8, 20, false);
    expect(html).toContain("v2-re-caveat");
  });

  it("renders an empty state when no row carries a usable engine value", () => {
    const html = riskEngineAgreementSlide(
      modelWith([popRow({ targetedByRiskEngine: null })]),
      8,
      20,
      false,
    );
    expect(html).toContain("v2-re-empty");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow({ targetedByRiskEngine: "نعم" })]);
    expect(riskEngineAgreementSlide(model, 8, 20, false)).toBe(
      riskEngineAgreementSlide(model, 8, 20, false),
    );
  });

  it("ships scoped CSS", () => {
    expect(RISK_ENGINE_CSS).toContain(".v2-re-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts`
Expected: FAIL — cannot resolve `./riskEngineAgreement`

- [ ] **Step 3: Implement the mapper**

```ts
/** Recognized affirmative values, normalized (trimmed, lower-cased). Extend
 *  this list — with a test — once a real month reveals the actual vocabulary;
 *  that is what the page's coverage counter exists to surface. */
const AFFIRMATIVE = new Set(["نعم", "مستهدف", "y", "yes", "true", "1"]);
const NEGATIVE = new Set(["لا", "غير مستهدف", "n", "no", "false", "0"]);

/**
 * Map the RAW risk-engine column value to a سليمة/اشتباه verdict.
 *
 * Returns `null` for blank AND for unrecognized values, and both are excluded
 * from every rate on the page. A blank means "we do not know what the engine
 * said" — NOT "the engine cleared it". Mapping blanks to سليمة would fabricate
 * agreement across potentially most of the month and inflate every figure here.
 */
export function engineVerdictOf(raw: string | null | undefined): "اشتباه" | "سليمة" | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (AFFIRMATIVE.has(key)) return "اشتباه";
  if (NEGATIVE.has(key)) return "سليمة";
  return null;
}
```

- [ ] **Step 4: Implement the page**

Three blocks in `riskEngineAgreementSlide`:

1. **Agreement** (`.v2-re-agree`) — engine vs المستوى الأول, vs المستوى الثاني, vs المراجع. Each row: agreement %, `ن`. The engine-vs-المراجع row is the headline: it is the only one independent of how `stage` is defined. Gate each rate on `isRankable(band(comparable))`.
2. **المستوى الثاني disagreement set** (`.v2-re-disagree`) — rows whose `stage` maps to المستوى الثاني: the engine flagged it, L1/L2 cleared it. Break down by what the reviewer found, with counts.
3. **محضر** (`.v2-re-report`) — rows with `hasReport === true`: what L1/L2 and the reviewer concluded.

Plus `.v2-re-coverage` (recognized / unrecognized / blank counts) and `.v2-re-caveat` (the definitional-overlap footnote, stating that المستوى الثاني is *defined* as engine-flagged-and-not-suspected so part of the engine-vs-L1/L2 relationship is structural, not a finding).

Empty state `.v2-re-empty` when no row yields a non-null verdict.

`v2Slide({ id: "slide-s3-risk-engine", section: "section3", bodyVariants: [body, body, body, body], ... })`.

> **Stage matching:** rows carry the RAW stage alias (`SECOND_STAG`, `المستوى الثاني`, …), not a canonical label — see `deckPreviewFixture.ts`'s own comment about the bug this caused before. Match through the canonical stage helpers in `src/data/population/`, never by comparing to a hard-coded Arabic label.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 6: Register it**

In `section3/index.ts`, import the CSS and builder, add the CSS to the array, and add the builder entry **after** `sourceAgreementSlide` and **before** `portAgreementSlideBuilders`, matching the page order in the spec's §6 table.

- [ ] **Step 7: Verify in the real deck**

Run: `npm run report:static && grep -c 'slide-s3-risk-engine' dist-preview/executive-report.html`
Expected: `1`

- [ ] **Step 8: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/riskEngineAgreement.ts src/data/reporting/executive/deck2/section3/riskEngineAgreement.test.ts src/data/reporting/executive/deck2/section3/index.ts
git commit -m "Add (reporting): risk-engine agreement page with an explicit unknown-verdict rule"
```

---

### Task 7: Rework الأداء حسب حجم الأعمال and ship it disabled

**Files:**
- Modify: `src/data/reporting/executive/deck2/section3/workloadAccuracy.ts`
- Modify: `src/data/reporting/executive/deck2/section3/index.ts`
- Modify: `src/data/reporting/executive/deck2/fanoutB2b.test.ts` (its `slide-s3-workload` block)
- Test: `src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts`

**Interfaces:**
- Consumes: `model.population.byPort` (volume), `model.portAccuracy` (accuracy — NOT `population.byPort[].accuracy`, which hard-nulls below 30 rows and would disagree with the section-2 page)
- Produces: unchanged exports `WORKLOAD_ACCURACY_CSS`, `workloadAccuracySlideBuilders`, plus a new module-local `SHOW_WORKLOAD_ACCURACY_SLIDE`

**Decision to flag at review:** this page currently ships a full four-system fan-out (Risk / Ledger / Briefing / Grid). The rework collapses it to the single-variant `[body, body, body, body]` pattern. That is a deliberate reduction, justified only because the page ships disabled and is slated for removal — four designs for a dormant page is not a good use of the rework. **If the reviewer disagrees, this is the step to say so**, because restoring the fan-out afterwards costs more than keeping it now.

- [ ] **Step 1: Snapshot the current output BEFORE changing anything**

```bash
npx vitest run src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts src/data/reporting/executive/deck2/fanoutB2b.test.ts
npm run report:static
cp dist-preview/executive-report.html /tmp/deck-before-task7.html
```

Keep `/tmp/deck-before-task7.html` until Step 8. This is the deterministic-builder rule: snapshot first, then change, then diff.

- [ ] **Step 2: Write the failing test**

Append to `workloadAccuracy.test.ts`:

```ts
describe("workload page — correlation view", () => {
  it("expresses each port's accuracy as a deviation from the month mean", () => {
    const model = modelWith([/* several ports with differing volumes */]);
    const [build] = workloadAccuracySlideBuilders(model, false);
    const html = build(5, 20);
    expect(html).toContain("v2-wa-dev");
  });

  it("orders ports by volume, busiest first", () => {
    const model = modelWith([/* ports sized 100, 500, 250 */]);
    const [build] = workloadAccuracySlideBuilders(model, false);
    const html = build(5, 20);
    const order = [...html.matchAll(/data-port="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([/* busiest first */]);
  });

  it("keeps the association-not-causation caveat", () => {
    const model = modelWith([popRow()]);
    const [build] = workloadAccuracySlideBuilders(model, false);
    expect(build(5, 20)).toContain("لا تُثبت");
  });
});

describe("workload page — disabled by default", () => {
  it("contributes no builder while the flag is false", () => {
    expect(workloadAccuracySlideBuilders(modelWith([popRow()]), false)).toHaveLength(0);
  });
});
```

> Fill the `modelWith([...])` fixtures with concrete `popRow({ portName, xrayImageId })` arrays producing the stated volumes — no placeholder comments in the committed test.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts`
Expected: FAIL

- [ ] **Step 4: Rework the body**

Replace the four fan-out bodies with one body containing:
- the existing land/sea `.v2-port-col` tables (unchanged — they are the deck's shared idiom and the reason the previous scatter was rejected was that it was *not* one)
- a new deviation strip (`.v2-wa-dev`): ports ordered by volume, each showing accuracy as a signed deviation from the month mean, built with the existing `barCell`/`rankedBar` idioms so it reads as part of the deck's visual system
- `data-port="<portName>"` on each row so ordering is assertable
- the existing `CAUSAL_CAVEAT` verbatim

Keep every existing sufficiency gate (`rankable` / `missedRankable`) exactly as-is — the 2026-07-30 fix that gates the missed-suspicion rate on its own smaller denominator must survive the rework.

- [ ] **Step 5: Add the flag**

At the top of `workloadAccuracy.ts`:

```ts
/**
 * Owner request 2026-08-19: hide الأداء حسب حجم الأعمال from the generated
 * report — its accuracy column restated the section-2 port-accuracy page from
 * the same source (`model.portAccuracy`). NOT a removal: the builder, its
 * helpers, its CSS and its tests all stay, just skipped, so it can be flipped
 * back on without rebuilding any of it. Same pattern and same intent as
 * SHOW_MONTH_NUMBERS_SLIDE in slides.ts. Do not delete this module while the
 * flag is false; it is dormant, not dead code.
 */
const SHOW_WORKLOAD_ACCURACY_SLIDE = false;
```

and make `workloadAccuracySlideBuilders` return `[]` immediately when it is false.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts`
Expected: PASS

- [ ] **Step 7: Update the fan-out test**

`fanoutB2b.test.ts` asserts four variant panels for `slide-s3-workload`. Update that block to assert the single-variant shape, and add a comment naming this plan and the reason (dormant page, fan-out deliberately collapsed).

- [ ] **Step 8: Diff against the pre-change snapshot**

```bash
npm run report:static
diff <(grep -o 'id="slide-[a-z0-9-]*"' /tmp/deck-before-task7.html) <(grep -o 'id="slide-[a-z0-9-]*"' dist-preview/executive-report.html)
```

Expected: `slide-s3-workload` present before, absent after; the three new pages present after. Read the diff — do not just confirm it is non-empty.

- [ ] **Step 9: Commit**

```bash
git add src/data/reporting/executive/deck2/section3/workloadAccuracy.ts src/data/reporting/executive/deck2/section3/workloadAccuracy.test.ts src/data/reporting/executive/deck2/section3/index.ts src/data/reporting/executive/deck2/fanoutB2b.test.ts
git commit -m "Change (reporting): rework الأداء حسب حجم الأعمال into a correlation view and disable it by default"
```

---

### Task 8: Fixture dates, deck snapshot, full gates, edit log

**Files:**
- Modify: `src/dev/deckPreviewFixture.ts`
- Modify: `src/data/reporting/executive/deck2/__snapshots__/deck2.test.ts.snap`
- Create: `docs/edit logs/2026-08-19.md` entry

- [ ] **Step 1: Give the preview fixture real entry dates and engine flags**

In `makeRow` in `src/dev/deckPreviewFixture.ts`, replace `xrayEntryDate: null` with a deterministic date spread across the month, and populate the engine flag and محضر so the three new pages render with content rather than empty states:

```ts
    xrayEntryDate: `2026-05-${String(1 + Math.floor(rnd() * 31)).padStart(2, "0")}`,
    targetedByRiskEngine: rnd() < 0.18 ? "نعم" : "لا",
    reportNumber: rnd() < 0.03 ? `M-${id}` : null,
```

Leave roughly 5% of rows with an unusable date so the `غير مؤرخ` path is visible in preview:

```ts
    // every 20th row keeps an unparseable date so the غير مؤرخ bucket renders
```

- [ ] **Step 2: Verify all four pages render with content**

```bash
npm run report:static
```

Then open `dist-preview/executive-report.html` and confirm by eye: the trend chart draws two banded lines, the outcome matrix shows four non-zero cells, the risk-engine page shows agreement rows and a coverage line, and `slide-s3-workload` is absent.

- [ ] **Step 3: Regenerate the deck snapshot deliberately**

```bash
npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -u
git diff --stat src/data/reporting/executive/deck2/__snapshots__/
```

Read the diff. Expected: three pages added, one removed, page numbers and the deck total shifted. **Anything else is a regression — stop and investigate rather than accepting the snapshot.**

- [ ] **Step 4: Run the full suite**

Run: `npm run test:run`
Expected: pass, except the known worktree font-denial failures (8 files / 21 tests, `Denied ID .../@fontsource/...woff2?inline`) documented in the spec §8. Any *other* failure is real.

- [ ] **Step 5: Run the tier-3 gates**

```bash
npm run lint
npm run typecheck
npm run check:complexity
npm run check:hex-literals
npm run check:vendor
npm run build
npm run check:bundle-size
```

Expected: all pass. `check:bundle-size` is the one to watch — three new pages plus a chart primitive move the single-file bundle against a finite budget.

- [ ] **Step 6: Write the edit-log entry**

```bash
npm run editlog -- --tier=3 --append --sync-package "Add (reporting): three القسم 3 analytics pages — daily accuracy trend, outcome matrix, risk-engine agreement"
```

Fill in `Why:` / `What changed:` / before-after snippets / `Verification:` with the actual gate output. Then:

```bash
npm run check:release
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add (reporting): three القسم 3 analytics pages, fixture dates, and the regenerated deck snapshot"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4.1 date normalization (superseded — nothing to build) | — |
| §4.2 `entryDayOf` | 1 |
| §4.3 pre-2026-08-18 caveat | documented, no code |
| §4.4 model changes (`ExecutiveReportRow`, `DecisionRecord`, `byEntryDay`, `dailyTrend`) | 1, 2 |
| §4.5 control limits reuse | 4 (imports the already-exported `buildPChart`) |
| §4.6 risk-engine flag mapping | 6 |
| §5 `timeSeriesBand` | 3 |
| §6.1 dailyTrend page | 4 |
| §6.2 outcomeMatrix page | 5 |
| §6.3 riskEngineAgreement page | 6 |
| §6.4 workloadAccuracy rework + flag | 7 |
| §7 testing, reconciliation invariant | 2 (Step 1, third test), each page task |
| §8 gates | 8 |

No gaps.

**Deviations from the spec, both deliberate:**
1. §4.5 says "extract the p-chart math into a shared helper". `buildPChart` and `P_CHART_MIN_N` are **already exported** from `reviewerKpis.ts`, so Task 4 imports them directly. The spec's intent — one implementation, not two — is satisfied without the churn of moving the function.
2. Task 7 collapses `workloadAccuracy`'s four-variant fan-out to the single-variant pattern. Flagged in that task for the reviewer to reject if they disagree.

**Type consistency:** `entryDayOf` (Task 1) is used in Tasks 1 and 2. `DayAccuracy`/`byEntryDay`/`undatedAccuracy` (Task 2) are consumed by Task 4 through `ReportModel.dailyTrend`. `BandSeries`/`BandPoint`/`timeSeriesBand` (Task 3) are consumed only by Task 4. `engineVerdictOf` (Task 6) is local to its page. Each page exports exactly `<NAME>_CSS` and `<name>Slide`, matching the existing section-3 modules. Names check out across tasks.
