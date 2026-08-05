# §K Cooperative Export Yielding Implementation Plan [DONE — shipped]

> **STATUS: ✅ DONE.** Shipped v59.175–v59.178 (commits `a17f9e80`, `5db8077c`) — `yieldToMain` extracted to a shared module, 6 local copies deduped, XLSX/CSV export builders now yield cooperatively.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §K from `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — extract the duplicated `yieldToMain()` idiom into a shared module, and add cooperative yielding to the XLSX/CSV export builders that currently have none and can freeze the tab for their full build duration on a large population.

**Architecture:** Extract `yieldToMain` once, reused by the report/deck builders that already yield (mechanical, zero behavior change) and by the XLSX builders that don't yet (new behavior). Convert only the builders that actually have an O(population) synchronous loop; leave the ones that don't touch as-is. Stream the PowerBI CSV writer via a generator, keeping the pure string-builder function's signature unchanged so its 13 existing synchronous tests need no migration.

**Tech Stack:** No new dependencies. `setTimeout(resolve, 0)` verbatim (see Global Constraints).

## Global Constraints

- **`setTimeout(resolve, 0)` verbatim, never `scheduler.yield()`.** `distributionReport.test.ts:85` and `sampleReport.test.ts:107` fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`), specifically to leave `setTimeout` real — faking it too would hang those tests' awaits forever. Do not "modernize" this.
- **Scope correction #1 (verified by research, deviating from the spec's literal count):** the spec says "duplicated 7 times"; the actual count is 6 in the report/deck-builder domain (`sampleReport.ts:196`, `distributionReport.ts:157`, `management/managementDeck.ts:50`, `executive/document/index.ts:45`, `executive/document/partAccountability.ts:34`, `executive/deck2/slides.ts:3582`) plus 5 more in an unrelated domain (`DataTable/index.tsx:220`, `Population/BrowseDataView.tsx:380`, `Population/biData/biDataWorkbook.ts:48`, `Population/riskData/riskDataWorkbook.ts:43`, `Population/processing/populationProcessor.ts:659`). **This plan extracts and migrates only the 6 report/deck-builder sites** (Task 1) — the other 5 are a different concern (Population/DataTable background processing, not "report pages/slides") and are explicitly out of scope; do not touch them.
- **Scope correction #2 (verified by research):** `buildManagementWorkbook`/`buildManagementWorkbookObject` (`src/data/reporting/management/managementWorkbook.ts`) has **no O(population) row loop at all** — its 4 sheet-builders only map over small per-stage/per-port/per-reviewer aggregate arrays, never raw population rows. It does not need async conversion for this plan's purpose and **must not be touched** — converting it anyway would force an unnecessary test migration in `managementWorkbook.test.ts` for zero yielding benefit. Its call site in `Reports/index.tsx` (the `"management-xlsx"` branch) stays exactly as it is today.
- **Scope correction #3 (verified by research):** the spec's "reentrancy risk... hoist `withDeckBuildLock` into a shared `withExclusiveBuild(key, fn)`" step is conditional on the target builders touching module-level mutable state. Verified: **none of the 4 XLSX builders' files have any module-level mutable state** (`distributionReport.ts`, `sampleReport.ts`, `executive/workbook/workbook.ts`, `management/managementWorkbook.ts` — each checked in full; only read-only `const` lookup records/arrays exist). `deck2`'s `withDeckBuildLock` exists for a *different* function (`buildExecutiveDeckV2`, which has real module-level mutable state via `slideKit.ts`'s `activeStyleChoices`) and is unrelated to this plan's scope. **No lock/mutex work is needed or included in this plan.**
- **Chunk size and pattern: reuse the codebase's existing convention, not the spec's proposed one.** The spec proposes a new `EXPORT_YIELD_ROWS = 2000` modulo-check pattern. This codebase already has an established, working convention for exactly this: `EXPORT_CHUNK_SIZE = 1000` with a chunk-slice-then-inner-loop shape, already used identically in `src/components/DataTable/index.tsx:568` and `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx:381`. **Use `EXPORT_CHUNK_SIZE = 1000` and the chunk-slice pattern**, not a new name/threshold/mechanism.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix).

---

### Task 1: Extract shared `yieldToMain` and adopt in the 6 report/deck builders

**Files:**
- Create: `src/data/storage/yieldToMain.ts`
- Modify: `src/data/reporting/sampleReport.ts:196` (remove local def, import instead)
- Modify: `src/data/reporting/distributionReport.ts:157`
- Modify: `src/data/reporting/management/managementDeck.ts:50`
- Modify: `src/data/reporting/executive/document/index.ts:45`
- Modify: `src/data/reporting/executive/document/partAccountability.ts:34`
- Modify: `src/data/reporting/executive/deck2/slides.ts:3582`
- Test: `src/data/storage/yieldToMain.test.ts` (new)

**Interfaces:**
- Produces: `export function yieldToMain(): Promise<void>` from `src/data/storage/yieldToMain.ts`.

**Context:** Every one of the 6 sites currently defines an identically-worded local `const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));` with a doc comment explaining it's not shared because "there isn't one; every yielding module keeps its own copy." This task creates that shared module and removes the 6 local copies. Zero behavior change — this is pure deduplication.

- [ ] **Step 1: Write the new module and its test**

Create `src/data/storage/yieldToMain.ts`:

```ts
/**
 * Yields the main thread back to the browser for one macrotask tick.
 * Deliberately `setTimeout(resolve, 0)`, not `scheduler.yield()` or a
 * microtask-based alternative -- several report/deck builder tests
 * (distributionReport.test.ts, sampleReport.test.ts) fake only `Date` via
 * `vi.useFakeTimers({ toFake: ["Date"] })`, leaving `setTimeout` real on
 * purpose; faking it too would hang those tests' awaits forever.
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
```

Create `src/data/storage/yieldToMain.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { yieldToMain } from "./yieldToMain";

describe("yieldToMain", () => {
  it("resolves via a real setTimeout(0), not a microtask", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let resolved = false;
    void yieldToMain().then(() => { resolved = true; });
    await Promise.resolve(); // flush microtasks -- must NOT have resolved yet
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/data/storage/yieldToMain.test.ts`
Expected: PASS (this is new code with a straightforward implementation, not a red/green TDD cycle against existing behavior).

- [ ] **Step 3: Replace each of the 6 local definitions with an import**

At each of the 6 sites below, delete the local `const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));` definition and its doc comment, and add `import { yieldToMain } from "../../storage/yieldToMain";` (adjust the relative path per each file's actual depth from `src/data/storage/`) near the file's other imports. Every existing *call* to `yieldToMain()` in these 6 files stays exactly as-is — only the definition moves.

- `src/data/reporting/sampleReport.ts` (relative path: `./storage/yieldToMain` is wrong depth — use `../storage/yieldToMain`, verify against the file's other existing `../storage/...` imports for the correct depth)
- `src/data/reporting/distributionReport.ts` (same relative depth as above)
- `src/data/reporting/management/managementDeck.ts` (one level deeper: `../../storage/yieldToMain`)
- `src/data/reporting/executive/document/index.ts` (two levels deeper: `../../../storage/yieldToMain`)
- `src/data/reporting/executive/document/partAccountability.ts` (same as above)
- `src/data/reporting/executive/deck2/slides.ts` (two levels deeper: `../../../storage/yieldToMain`)

In each file, verify the exact correct relative import path by checking an existing sibling import in that same file (e.g. an import of something else from `src/data/storage/`) rather than guessing — if no such sibling import exists in a given file, count directory levels from that file's own path to `src/data/storage/yieldToMain.ts`.

- [ ] **Step 4: Run the tests to verify no regression**

Run: `npx vitest run src/data/reporting/` (covers all 6 modified files' own test suites plus anything that imports them)
Expected: all PASS, zero snapshot deltas (this is a pure refactor — every builder's actual output is unchanged).

Then typecheck and lint:
Run: `npm run typecheck && npm run lint:ci`
Expected: clean.

- [ ] **Step 5: Edit log + commit**

```bash
git add src/data/storage/yieldToMain.ts src/data/storage/yieldToMain.test.ts src/data/reporting/sampleReport.ts src/data/reporting/distributionReport.ts src/data/reporting/management/managementDeck.ts src/data/reporting/executive/document/index.ts src/data/reporting/executive/document/partAccountability.ts src/data/reporting/executive/deck2/slides.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Refactor (reporting): extract shared yieldToMain, dedupe 6 local copies"
```

---

### Task 2: Chunked yielding for `buildDistributionXlsx` and `buildSampleXlsx`

**Files:**
- Modify: `src/data/reporting/distributionReport.ts:376-449` (`buildDistributionXlsx`)
- Modify: `src/data/reporting/sampleReport.ts:464-561` (`buildSampleXlsx`)
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (2 call sites — the `"distribution-xlsx"` and `"sample-xlsx"` branches inside `generate`)
- Modify: `src/components/Sidebar/Tabs/Reports/index.test.tsx` (update the 2 corresponding spy mocks from sync to async)
- Test: extend whatever test coverage already exists for these 2 builders (research found neither currently has a dedicated test file — only synchronous spy mocks in `Reports/index.test.tsx`; add real behavioral tests as part of this task, not just update the mocks)

**Interfaces:**
- Consumes: `yieldToMain` from `src/data/storage/yieldToMain.ts` (Task 1).
- Produces: `buildDistributionXlsx` and `buildSampleXlsx` change from `(...): void` to `(...): Promise<void>`.

**Context:** Both builders have exactly one O(population) row-mapping loop each (Sheet 2's row body), built via a single `.map()` call inside an otherwise-synchronous function. This task converts each function to `async`, replaces the `.map()` with a chunked `for` loop yielding every `EXPORT_CHUNK_SIZE` (1000) rows, and threads the `await` up through the 2 UI call sites.

- [ ] **Step 1: Convert `buildDistributionXlsx`**

Read `src/data/reporting/distributionReport.ts:376-449` in full first to get the exact current row-map line (research cites line 405-410, "Sheet 2 'التعيينات'") and confirm the function's exact current signature and every other line inside it that must be preserved unchanged.

Change the function signature from `export function buildDistributionXlsx(...): void {` to `export async function buildDistributionXlsx(...): Promise<void> {`.

Replace the Sheet 2 row-building `.map()` call with a chunked loop matching the `EXPORT_CHUNK_SIZE` pattern already established in `DataTable/index.tsx:568-584`/`BrowseDataView.tsx:381-661` (add `const EXPORT_CHUNK_SIZE = 1000;` as a module-level const in this file if one doesn't already exist there):

```ts
const rows: Cell[][] = [];
for (let i = 0; i < data.entries.length; i += EXPORT_CHUNK_SIZE) {
  const chunk = data.entries.slice(i, i + EXPORT_CHUNK_SIZE);
  for (const e of chunk) {
    rows.push([/* exact same per-row cell array the removed .map() callback produced */]);
  }
  if (data.entries.length > EXPORT_CHUNK_SIZE) await yieldToMain();
}
```

Use `rows` in place of wherever the `.map()` result was previously spread/assigned into the Sheet 2 array — preserve the exact same final sheet shape (header row + these body rows), so the XLSX output is byte-identical to before.

Every other synchronous part of the function (sheet setup calls, `XLSX.utils.*`, `XLSX.writeFile`) stays exactly as-is — only the one row-building loop changes shape and the function becomes `async`.

- [ ] **Step 2: Convert `buildSampleXlsx`**

Same transformation, applied to `src/data/reporting/sampleReport.ts:464-561`'s Sheet 2 "1 · الاستلام" row loop (research cites line 500-504, `...populationRows.map((r) => [...])`). Add the same `EXPORT_CHUNK_SIZE = 1000` const to this file (or import a shared one if Step 1 introduced it in a way that's reasonably shareable — your call whether a tiny shared const is worth a new file for just 2 consumers; a local const in each file is also acceptable and matches this codebase's existing per-file pattern for the same constant name in `DataTable.tsx`/`BrowseDataView.tsx`).

- [ ] **Step 3: Write tests proving the yielding actually happens**

Neither builder has a dedicated test file today. Create minimal new test files (or extend `distributionReport.test.ts`/`sampleReport.test.ts` if you judge that more appropriate given their existing structure — read those files first) with at least one test per builder that:
1. Builds a fixture with more than `EXPORT_CHUNK_SIZE` (1000) rows.
2. Spies on `yieldToMain` (mock the module) and asserts it was called at least once during the build.
3. Asserts the final XLSX output (via whatever assertion mechanism the codebase already uses for these builders — check how `workbook.test.ts` asserts on `buildExecutiveWorkbookObject`'s output for the established pattern) is unchanged in row count/content from a small-fixture baseline, proving the chunking didn't drop or duplicate rows.

- [ ] **Step 4: Update the 2 UI call sites in `Reports/index.tsx`**

In the `generate` function's `"distribution-xlsx"` branch (currently, post-Plan-10, around line 445-447):
```tsx
          const { buildDistributionXlsx } = await import("../../../../data/reporting/distributionReport");
          buildDistributionXlsx(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم تنزيل ملف Excel.");
```
add `await` before the call:
```tsx
          const { buildDistributionXlsx } = await import("../../../../data/reporting/distributionReport");
          await buildDistributionXlsx(data, selectedMonth, names, distRevisions);
          showToast("ok", "تم تنزيل ملف Excel.");
```

Same treatment for the `"sample-xlsx"` branch (currently around line 419-421) calling `buildSampleXlsx`.

- [ ] **Step 5: Update the 2 corresponding spy mocks in `Reports/index.test.tsx`**

The existing mocks (research cites lines 121-134 and 136-146) are synchronous `vi.fn((...) => undefined)`. Change each to an async mock (`vi.fn(async (...) => undefined)` or equivalent) so they accurately model the new `Promise<void>` signature and don't mask a missing `await` at the call site.

- [ ] **Step 6: Run the tests to verify everything passes**

Run: `npx vitest run src/data/reporting/distributionReport.test.ts src/data/reporting/sampleReport.test.ts src/components/Sidebar/Tabs/Reports/index.test.tsx` (plus your new test file(s) if created separately)
Expected: all PASS, including the new yielding-proof tests and every pre-existing test in these 3 files unchanged.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 7: Edit log + commit**

```bash
git add src/data/reporting/distributionReport.ts src/data/reporting/sampleReport.ts src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (reporting): chunked yielding for buildDistributionXlsx/buildSampleXlsx"
```

(Include any new test file(s) created in Step 3 in this same `git add`.)

---

### Task 3: Chunked yielding for `buildExecutiveWorkbook` (the largest, 3 loops)

**Files:**
- Modify: `src/data/reporting/executive/workbook/workbook.ts` (`buildExecutiveWorkbookObject` lines 571-614, `rowSheet` 282-329, `rawRiskSheet` 336-369, `resultComparisonSheet` ~453-471, `buildExecutiveWorkbook` wrapper 620-626)
- Modify: `src/data/reporting/executive/workbook/workbook.test.ts` (11+ call sites need `await` added — read the file first to get the exact count and every line)
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (2 call sites calling `buildExecutiveXlsx`, which wraps this — `handleExport`'s xlsx branch and `generate`'s `"executive-xlsx"` branch)
- Modify: `src/components/Sidebar/Tabs/Reports/index.test.tsx` (the `buildExecutiveXlsx` spy mock, sync → async)

**Interfaces:**
- Consumes: `yieldToMain` (Task 1).
- Produces: `buildExecutiveWorkbookObject` and `buildExecutiveWorkbook` (and its re-export `buildExecutiveXlsx` in `executiveReport.ts`) change from sync to `Promise<...>`-returning.

**Context:** This is the highest-value target (the executive workbook is the most complete/heaviest export) and the highest-cost one to migrate, because `buildExecutiveWorkbookObject` is the PURE function under direct test in `workbook.test.ts` — converting it to async means every one of that file's synchronous call sites needs an `await` added, not just the 2 UI call sites. There are 3 separate O(population) loops to convert: `rowSheet` (`model.rows.map(...)`), `rawRiskSheet` (`rows.map(...)` over `input.populationRows`), and `resultComparisonSheet` (`model.resultComparison.images.map(...)`).

- [ ] **Step 1: Convert the 3 sheet-builder functions**

Read `workbook.ts` in full first (it's a large file; get exact current line numbers before editing, since they may have shifted from the research citations above).

For each of `rowSheet`, `rawRiskSheet`, `resultComparisonSheet`: change the function signature to `async function xxxSheet(...): Promise<Cell[][]>`, and replace its `.map()` call with the same chunked-loop pattern from Task 2 Step 1 (build into a local `rows`/`body` array via a `for` loop with `EXPORT_CHUNK_SIZE`-sized slices, yielding between chunks), preserving the exact same final return shape (header row + body rows) each function currently produces.

Add `const EXPORT_CHUNK_SIZE = 1000;` once at module scope in this file (or reuse Task 2's if that task chose a shared location — check what Task 2 actually did before duplicating).

- [ ] **Step 2: Thread `await` through `buildExecutiveWorkbookObject`**

`buildExecutiveWorkbookObject` (lines 571-614) currently calls `rowSheet(model)`, `rawRiskSheet(...)`, `resultComparisonSheet(...)` synchronously and uses their results to build the workbook. Change this function to `async function buildExecutiveWorkbookObject(...): Promise<WorkBook>` (or whatever its actual current return type is — check), and add `await` before each of the 3 now-async sheet-builder calls. Every other sheet-builder call in this function that ISN'T one of the 3 converted ones (there are more sheets than just these 3 per the research — `rawBiSheet`, `exclusionsSheet`, etc.) stays synchronous and un-awaited, since they don't touch population-scale data.

- [ ] **Step 3: Thread `await` through `buildExecutiveWorkbook`**

The thin wrapper (lines 620-626) calls `buildExecutiveWorkbookObject` then presumably calls `XLSX.writeFile` on the result. Change its signature to `async function buildExecutiveWorkbook(...): Promise<void>`, add `await` before the now-async `buildExecutiveWorkbookObject` call, keep `XLSX.writeFile` synchronous and un-awaited (per the spec's "honest limit" — SheetJS's own serialize call isn't yieldable and that's explicitly out of scope here).

- [ ] **Step 4: Update `executiveReport.ts`'s re-export**

`src/data/reporting/executiveReport.ts:13-18` wraps `buildExecutiveWorkbook` as `buildExecutiveXlsx`. Read this file and update its signature/body to `await` the now-async `buildExecutiveWorkbook` and return `Promise<void>` itself.

- [ ] **Step 5: Update every synchronous call site in `workbook.test.ts`**

Read `workbook.test.ts` in full. Every call site that currently does `const wb = buildExecutiveWorkbookObject(...)` (research cites at least 11: lines 102, 111, 122, 139, 149, 162, 175, 192, 201, 214, and possibly more — get the exact current full list by reading the file) needs to become `const wb = await buildExecutiveWorkbookObject(...)`, and its enclosing `it(...)` callback needs to be `async` if it isn't already. Do this for every single call site in the file — a missed one will fail with "wb is a Promise, not a WorkBook" wherever the test then tries to read a property off `wb`.

- [ ] **Step 6: Update the 2 UI call sites in `Reports/index.tsx` and the spy mock**

`handleExport`'s xlsx branch and `generate`'s `"executive-xlsx"` branch both call `buildExecutiveXlsx(execInput, names)` without `await` today (post-Plan-10). Add `await` at both. Update the corresponding spy mock in `Reports/index.test.tsx` (research cites lines 148-156) from sync to async, matching Task 2 Step 5's treatment.

- [ ] **Step 7: Add a yielding-proof test**

Add at least one test (in `workbook.test.ts` or a new file, your call) that builds a fixture with more than `EXPORT_CHUNK_SIZE` population rows, spies on `yieldToMain`, and asserts it was called during the build of at least one of the 3 converted sheets — mirroring Task 2 Step 3's approach.

- [ ] **Step 8: Run the tests to verify everything passes**

Run: `npx vitest run src/data/reporting/executive/workbook/workbook.test.ts src/data/reporting/executiveReport.test.ts src/components/Sidebar/Tabs/Reports/index.test.tsx`
Expected: all PASS — this is the step most likely to surface a missed `await` conversion in `workbook.test.ts`; if any test fails with a Promise-related type error, find and fix the missed call site rather than working around it.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 9: Edit log + commit**

```bash
git add src/data/reporting/executive/workbook/workbook.ts src/data/reporting/executive/workbook/workbook.test.ts src/data/reporting/executiveReport.ts src/components/Sidebar/Tabs/Reports/index.tsx src/components/Sidebar/Tabs/Reports/index.test.tsx "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (reporting): chunked yielding for buildExecutiveWorkbook (3 population loops)"
```

---

### Task 4: Stream the PowerBI CSV export instead of one synchronous string build

**Files:**
- Modify: `src/data/powerbiExport/csvSerializer.ts:23-33` (`toCsvString`)
- Modify: `src/data/powerbiExport/exportWriter.ts` (`writeCsvExport`, the caller)
- Test: `src/data/powerbiExport/csvSerializer.test.ts` (must stay green UNCHANGED — see constraint below)

**Interfaces:**
- Consumes: `yieldToMain` (Task 1).
- Produces: new `export function* toCsvChunks(headers: string[], rows: Record<string, unknown>[]): Generator<string>` in `csvSerializer.ts`. `toCsvString`'s existing signature and behavior are UNCHANGED — it becomes `export function toCsvString(headers, rows): string { return [...toCsvChunks(headers, rows)].join(""); }`, still fully synchronous.

**Context:** `runPowerBiExport`'s freeze is one synchronous `toCsvString` call per export file inside `writeCsvExport`'s `for (const exp of exports)` loop. The spec wants this streamed, not chunked-with-yields — a generator (`toCsvChunks`) that yields string pieces, consumed by an async wrapper in `writeCsvExport` that periodically yields the main thread while writing. `toCsvString` itself must stay synchronous (per the spec: `toCsvString = (h,r) => [...toCsvChunks(h,r)].join("")`) so `csvSerializer.test.ts`'s 13 existing synchronous tests need zero changes — do not convert `toCsvString` to async.

- [ ] **Step 1: Write the failing test for `toCsvChunks`**

Read `csvSerializer.ts` and `csvSerializer.test.ts` in full first. Add a new test to `csvSerializer.test.ts`:

```ts
it("toCsvChunks yields the same content as toCsvString, split into pieces", () => {
  const headers = ["a", "b"];
  const rows = [{ a: "1", b: "2" }, { a: "3", b: "4" }];
  const chunks = [...toCsvChunks(headers, rows)];
  expect(chunks.join("")).toBe(toCsvString(headers, rows));
  expect(chunks.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/powerbiExport/csvSerializer.test.ts -t "toCsvChunks yields"`
Expected: FAIL — `toCsvChunks` doesn't exist yet.

- [ ] **Step 3: Implement `toCsvChunks` and redefine `toCsvString` in terms of it**

Replace the current `toCsvString`:

```ts
export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  }
  return "﻿" + lines.join("\n");
}
```

with:

```ts
export function* toCsvChunks(
  headers: string[],
  rows: Record<string, unknown>[]
): Generator<string> {
  yield "﻿" + headers.join(",");
  for (const row of rows) {
    yield "\n" + headers.map((h) => escapeCell(row[h])).join(",");
  }
}

export function toCsvString(
  headers: string[],
  rows: Record<string, unknown>[]
): string {
  return [...toCsvChunks(headers, rows)].join("");
}
```

(Verify the exact byte output is identical to the original — the original joins lines with `"\n"` after building an array; the generator version prepends `"\n"` to every row after the first including the header-to-first-row transition, which produces the same final string when joined with `""`. Run Step 2's test to confirm this byte-for-byte, and double check against the file's OTHER existing tests, e.g. the BOM/quoting/formula-injection-escaping ones, to make sure none of them depend on incremental/partial output in a way this restructuring could break.)

- [ ] **Step 4: Run the tests to verify `toCsvChunks` passes and nothing else regressed**

Run: `npx vitest run src/data/powerbiExport/csvSerializer.test.ts`
Expected: all 13 pre-existing tests PASS UNCHANGED, plus the new one.

- [ ] **Step 5: Stream in `writeCsvExport`**

Read `src/data/powerbiExport/exportWriter.ts` in full. Its `writeCsvExport` function currently calls `toCsvString(...)` synchronously once per export inside a `for (const exp of exports)` loop, then presumably writes the resulting string to a file. Convert the per-export write to iterate `toCsvChunks(...)` instead, periodically calling `await yieldToMain()` (e.g. every ~500 chunks/rows, matching the spirit of `EXPORT_CHUNK_SIZE` from Task 2 — an exact threshold constant here is fine, name it clearly), accumulating chunks into the file write. If `writeCsvExport` already writes via `safeWriteJson`/a text-write helper that expects a single string argument, either accumulate the yielded chunks into a buffer string before that call (simplest, and still yields the main thread during accumulation even though the final write call itself is one shot) — or investigate whether a streaming write API is available and appropriate; default to the simpler buffer-with-periodic-yield approach unless the file-write layer already has a streaming primitive that's a clear fit (check `safeWrite.ts`'s `streamToFile`, referenced in this plan's research, but note its `emit`-callback shape is NOT the same as what a spread-generator wants — adapting it or writing a small local loop is fine, use your judgment for the cleanest fit with what's already in this file).

- [ ] **Step 6: Run the tests to verify everything passes**

Run: `npx vitest run src/data/powerbiExport/`
Expected: all PASS.

Then the whole suite, typecheck, lint:
Run: `npm run test:run && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 7: Edit log + commit**

```bash
git add src/data/powerbiExport/csvSerializer.ts src/data/powerbiExport/csvSerializer.test.ts src/data/powerbiExport/exportWriter.ts "docs/edit logs/2026-08-04.md" package.json
git commit -m "Change (powerbi-export): stream CSV generation via a chunked generator instead of one synchronous build"
```

---

## Task Order

Task 1 (extraction) has no dependents that require it to land first in git history, but every other task consumes `yieldToMain` from it — run Task 1 first, alone. Tasks 2, 3, and 4 touch disjoint file sets from each other EXCEPT that Tasks 2 and 3 both edit `src/components/Sidebar/Tabs/Reports/index.tsx` and `Reports/index.test.tsx` (different branches/mocks, but the same two files) — **Tasks 2 and 3 must run sequentially relative to each other** (2 then 3, matching this list's order), never in parallel. Task 4 touches an entirely disjoint file set (`powerbiExport/`) and may run in parallel with Task 2 or Task 3, using this session's established parallel-implementer protocol (skip the edit log and `package.json`; controller applies one combined commit per task afterward).
