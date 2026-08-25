# Table sort/filter UX consistency — sort caret styling, sort+filter composition, and shared-DataTable migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three related fixes to table sort/filter UX, landed and revertable independently:

- **A.** Population Browse's sort caret renders with browser-default button styling — no `.bv-sort-btn` rule exists anywhere — so it reads as a detached grey chip next to a properly-styled filter button in the same header cell.
- **B.** Verify (do not assume) that sort and column filters compose correctly on **both** Browse query paths — the synchronous fallback and the worker-backed large-population path — and lock the answer down with regression tests.
- **C.** Move small hand-rolled `<table>`s onto the shared `DataTable` component so table UX is consistent app-wide.

**Architecture:** Task 1 is a pure CSS addition, single file, zero behavior change. Task 2 adds tests only — the investigation below found no defect on either path, and this plan does not invent a fix for a bug that does not exist. Tasks 3–5 are the real Bug-C work, restructured around two verified findings that contradict the original brief (see *Findings that change the brief*). Task 3 adds a sort feature to `DataTable` itself — the shared capability the brief assumed already existed — and is the only task that touches existing `DataTable` call sites. Task 4 migrates the one genuine migration candidate. Task 5 records the two "deliberately not migrated" decisions in the docs so the next reader does not re-derive them.

**Tech Stack:** React 19 + TypeScript (strict, `erasableSyntaxOnly`), plain co-located CSS, Vitest + `@testing-library/react` for component tests (`/* @vitest-environment jsdom */` as line 1, `globals: false` so `describe`/`it`/`expect` are imported from `vitest`), `createMemoryDirectory` from `src/data/storage/memoryDirectory.ts` for storage-backed tests, and the existing `createPopulationQueryWorkerStubClass` harness for worker-path component tests.

---

## Findings that change the brief

These were verified against the current working tree before this plan was written. Two of the brief's grounding assumptions are wrong, and Bug C's task shape follows from that.

### F1 — `DataTable` has **no sort feature at all**

CLAUDE.md describes `src/components/DataTable/` as a "Reusable filterable/sortable table with column visibility, XLSX export". It is not sortable. The entire 1442-line component contains exactly one `.sort(` call — `src/components/DataTable/index.tsx:602`, which sorts the *filter dropdown's option list*, not rows:

```ts
    return Array.from(
      new Set(filteredRows.map((row) => (col.accessor as (r: unknown) => string | null)(row) ?? "").filter(Boolean))
    ).sort(compareFilterOptions);
```

A repo-wide grep for `asc`, `desc`, `ترتيب`, `Chevron`, `ArrowUp`, `ArrowDown`, and `localeCompare` across `index.tsx`, `utils.ts` and `DataTable.css` returns only `compareFilterOptions`'s own `localeCompare` (`index.tsx:243`) and one unrelated CSS comment. The rendered header cell (`index.tsx:941-956`) contains a grip, a label, and a filter button — no sort control.

**Consequence:** the brief's "gaining consistent sort UI for free" is not available today. Migrating a table to `DataTable` as it stands gains global search, per-column filters, a column picker, column reorder/resize, XLSX export and pagination — but **loses nothing and gains nothing on sort**, because neither side has it. Delivering the stated goal requires adding sort to `DataTable` first. That is Task 3, and it is what makes Task 4 worth doing.

### F2 — Two of the three named migration targets have no user-facing data table

- **`src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx`** contains exactly one `<table>`, at line 495, with `className="kpi-sr-only"`. It is the screen-reader-only accessible equivalent of the `inaccuracyCalendarSvg` heat-map chart rendered immediately below it (`index.tsx:508-514`), and `.kpi-sr-only` is a visually-hidden rule at `KpiDashboard.css:836`. There is no browsable data table on this page to migrate.
- **`src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx`** contains two `<table>`s (lines 130 and 184), and neither is a row-list. Both are **permission matrices**: rows are tabs/features, columns are *roles*, and every cell is an interactive control — a three-way segmented button group (`PermissionCell`, lines 52-103) or a toggle switch (line 215). `PagePermissionsSection` additionally renders a collapsible **parent/child tree** (`Fragment` per parent, child rows gated on `collapsedParents`, lines 138-157). `DataTable` requires `accessor: (row: TRow) => string | null` on every column and uses it for filtering, date/numeric auto-detection, XLSX export and (after Task 3) sorting; a "role × tab → segmented control" cell has no meaningful string value, sorting by a role column would be meaningless, and `DataTable` has a flat row model with a single `expandedKey`, not a tree.
- **`src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx`** contains two `<table>`s. Line 137's `.rk-sr-only` is the same chart-alternative pattern as above (`ReviewerKpiPanel.css:235`) — this is the one CLAUDE.md's "native responsive SVG plus a semantic screen-reader table" note refers to, and it must stay a plain semantic `<table>`. Line 66's `.rk-table` is a **genuine seven-column reviewer data table** (one row per `ReviewerKpiRow`, real values: assigned, completed, completion rate, median turnaround, suspicion rate, control status). **This is the only real migration candidate among the three files.**

**Consequence:** Bug C's migration surface is one table, not three. Tasks 4 and 5 reflect that.

### F3 — Bug B: no defect found on either path

The full trace is recorded in Task 2. Summary: `runPopulationQuery` applies sort strictly after both filter stages (`src/data/population/populationQuery.ts:136-149`); `BrowseDataView`'s single main-table query effect constructs `params` **inside the effect body** from current render values and lists `sort`, `columnFilters`, `debouncedSearch` and `page` in its dependency array (`BrowseDataView.tsx:723-776`), so no stale closure is possible; `usePopulationBrowseWorker.runQuery` forwards `params` verbatim with no reconstruction (`usePopulationBrowseWorker.ts:267-291`); and the worker hands them straight to the same `runPopulationQuery` (`populationQueryWorker.ts:213-226`). The one place sort is deliberately dropped (`sort: null`, `BrowseDataView.tsx:930`) is the filter-dropdown option preview, which runs on its own query lane and never feeds the table. Task 2 is therefore written as **regression tests only, no production change**, per the brief's explicit instruction for that outcome.

---

## Global Constraints

- Every task's edit needs an entry in `docs/edit logs/2026-08-24.md` (today's file; create it if absent, never a second file for the same date). Generate it — do not hand-write: `npm run editlog -- --tier=<n> --append --sync-package "<Category (scope): title>"`. Insert new entries at the TOP of the day's file (newest-first) — `npm run check:release` reads only the topmost heading.
- Current `package.json` version is `115.2.0`; the latest log entry is `## v115.2 — 2026-08-23`. `--sync-package` keeps the two in step. Tasks 1, 2 and 5 are decimal bumps (fix/tests/docs); Task 3 is a whole-number bump (new shared capability touching every `DataTable` call site); Task 4 is a decimal bump.
- Never a bare `git commit` — always `git add <specific files>` then `git commit -m "..." -- <same files>`.
- Tier-2 gates before any task is considered done: `npm run test:run`, `npm run typecheck`, `npm run lint`. Task 3 is tier 3 and additionally needs `npm run check:complexity`, `npm run check:hex-literals`, `npm run check:release`, `npm run check:vendor`, `npm run build`, `npm run check:bundle-size`.
- **`npm run build` before pushing the branch or opening a PR, at every tier.** A green `test:run` does not imply a working build — `vitest` transpiles per-file and never type-checks.
- **New CSS must use existing custom properties, never raw hex literals.** `npm run check:hex-literals` guards a fixed set of high-offender files against count regressions; `Population.css` and `DataTable.css` are both in scope. Every color in this plan's new rules comes from a `var(--…)` token already used by the sibling rule it is modeled on.
- **Do not migrate `BrowseDataView.tsx`'s own table to `DataTable`.** Explicitly out of scope: it owns a perf-critical worker path for 200k-400k-row populations (`useWorkerPath`, `BrowseDataView.tsx:539`) that the generic component has no equivalent for. Tasks 1 and 2 fix its two specific issues in place and change nothing else about it.
- Task 3 moves two pure functions verbatim into a shared module. `src/data/population/populationQuery.test.ts` already pins sort semantics — including a `"pins search + column filter + sort composed together"` snapshot at line 302 — and must stay green **without editing the expectations**. If a moved comparator changes any pinned output, the move was not verbatim; revert and redo it, do not update the snapshot.

---

### Task 1: Bug A — style Population Browse's sort caret to match its filter button

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/Population.css` (insert before `.bv-filter-btn` at line 3135)
- Create: `src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx`

**Interfaces:**
- Consumes: the existing class names `bv-sort-btn`, `bv-sort-btn.active` and `bv-sort-btn-idle-icon` already emitted by `BrowseDataView.tsx:1361-1381`. **No `.tsx` change at all** — the markup already applies the classes; nothing consumes them.
- Produces: three new CSS rules. No new exports, no JS behavior change.

**Root cause (verified):** `BrowseDataView.tsx:1361-1363` renders

```tsx
                        <button
                          type="button"
                          className={`bv-sort-btn${sort?.column === c.key ? " active" : ""}`}
```

and line 1379 renders `<ChevronUp size={13} className="bv-sort-btn-idle-icon" />` for the unsorted state. A repo-wide grep for `sort-btn` across every `*.css` file returns **zero matches** — not in `Population.css`, not in `src/index.css`, not in `src/styles/primitives.css`. The button therefore renders with the user-agent default `<button>` appearance (grey `ButtonFace` background, 2px outset border, its own padding) inside `.bv-th-content`, a flex row (`Population.css:3107-3113`) whose other action — `.bv-filter-btn` (`Population.css:3135-3156`) — is a 24×24 transparent, borderless, `--p-muted`-colored square. Two adjacent controls in one header cell, one styled into the design system and one not: exactly the "floating disconnected chip" the report describes. The `active` class has nothing consuming it either, so a sorted column is visually indistinguishable from an unsorted one apart from the chevron's direction.

- [ ] **Step 1: Write the failing test**

Create `src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx`. jsdom has no layout engine and does not resolve external stylesheets, so this test does **not** assert computed pixels — it asserts that `Population.css` declares the rules, which is the thing that is actually missing. This mirrors the repo's existing CSS-contract test precedent (`uiScaleCss.contract.test.ts`, referenced in the v115.1/v115.2 log entries).

```tsx
/* @vitest-environment jsdom */
// Bug A regression guard — Population Browse's per-column sort button rendered
// with browser-default <button> chrome because Population.css declared no
// .bv-sort-btn rule at all, while the filter button sitting next to it in the
// same .bv-th-content flex row was fully styled. This test pins BOTH halves:
// the markup still emits the classes, and the stylesheet still defines them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = fileURLToPath(new URL("./Population.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

describe("BrowseDataView sort button styling (Bug A)", () => {
  it("declares a base rule for .bv-sort-btn", () => {
    expect(css).toMatch(/^\.bv-sort-btn\s*\{/m);
  });

  it("gives the active (currently-sorted) state its own visual treatment", () => {
    // The `active` class was applied by BrowseDataView but consumed by nothing,
    // so a sorted column looked identical to an unsorted one.
    expect(css).toMatch(/\.bv-sort-btn\.active/);
  });

  it("styles the idle chevron so the unsorted state reads as available, not applied", () => {
    expect(css).toMatch(/\.bv-sort-btn-idle-icon/);
  });

  it("sizes the sort button to match the filter button it sits beside", () => {
    // Both live in the same .bv-th-content flex row; a size mismatch is the
    // single most visible part of the "detached chip" report.
    const sortRule = /\.bv-sort-btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const filterRule = /\.bv-filter-btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const size = (rule: string) => ({
      width: /width:\s*([^;]+);/.exec(rule)?.[1]?.trim(),
      height: /height:\s*([^;]+);/.exec(rule)?.[1]?.trim(),
    });
    expect(size(sortRule)).toEqual(size(filterRule));
    expect(size(filterRule).width).toBeDefined();
  });

  it("uses design tokens, not raw hex literals (check:hex-literals guards this file)", () => {
    const sortRules = css.match(/\.bv-sort-btn[^{]*\{[^}]*\}/g) ?? [];
    expect(sortRules.length).toBeGreaterThan(0);
    for (const rule of sortRules) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx`
Expected: FAIL — the first four tests fail (no `.bv-sort-btn`, `.bv-sort-btn.active` or `.bv-sort-btn-idle-icon` rule exists, and the size comparison finds an empty sort rule against the filter button's `24px`). The fifth passes vacuously today only because `sortRules.length` is 0 — it is asserted to be `> 0` first, so it fails too.

- [ ] **Step 3: Add the CSS**

In `src/components/Sidebar/Tabs/Population/Population.css`, insert the following **immediately before** the existing `.bv-filter-btn` rule at line 3135 (so the two sibling controls' rules read together), leaving `.bv-th-label` at 3129-3134 above it untouched:

```css
/* Sits next to .bv-filter-btn in the same .bv-th-content flex row and is
   deliberately sized/skinned identically — the two are peer affordances on one
   header cell. Before this rule existed the sort button rendered with
   user-agent <button> chrome (grey face, outset border) beside a transparent
   24px filter square, which is what read as a detached chip. */
.bv-sort-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--p-muted);
  cursor: pointer;
  line-height: 1;
}
.bv-sort-btn:hover,
.bv-sort-btn.active {
  border-color: var(--p-border);
  background: var(--c-surface);
  color: var(--p-primary);
}
/* The `active` class was already applied by BrowseDataView.tsx and consumed by
   nothing, so a sorted column was visually identical to an unsorted one. The
   inset ring is the same accent .bv-filter-btn.active uses. */
.bv-sort-btn.active {
  box-shadow: inset 0 0 0 1px rgba(23, 54, 93, 0.08);
}
/* Unsorted state: the chevron is an affordance ("you may sort by this"), not a
   status ("this is sorted ascending"). Dimming it keeps the header quiet across
   a wide table while leaving the control discoverable on hover. */
.bv-sort-btn-idle-icon {
  opacity: 0.42;
}
.bv-sort-btn:hover .bv-sort-btn-idle-icon {
  opacity: 1;
}
```

Notes on token choices, all matched to the sibling rule at 3135-3156 so nothing new enters `check:hex-literals`' count: `--p-muted`, `--p-border`, `--p-primary` and `--c-surface` are exactly the four the filter button uses, and `rgba(23, 54, 93, 0.08)` is copied verbatim from `.bv-filter-btn.active` (an `rgba()`, not a hex literal — the guard counts `#rrggbb` forms only).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx`
Expected: PASS, all five.

- [ ] **Step 5: Run the tier-2 gates**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green. This task adds CSS only — no existing `BrowseDataView.*.test.tsx` file asserts on header-button styling, and none of them can be affected by a stylesheet jsdom does not load.

- [ ] **Step 6: See it in the real app**

Run `npm run dev`, open Population → استعراض البيانات in Chrome/Edge (the File System Access API is required), attach a workspace with at least one processed month, and confirm: the sort caret is now a flush 24×24 transparent square matching the ▾ filter button beside it; hovering either one produces the same bordered surface; and clicking a column's caret gives that button a visibly distinct (bordered, primary-colored, inset-ringed) resting state that the other columns' carets do not have. CLAUDE.md is explicit that reading the code is not evidence a change works — this step is not optional for a visual fix.

- [ ] **Step 7: Generate the edit-log entry, then commit**

```bash
npm run editlog -- --tier=2 --append --sync-package "Fix (population): style Browse's sort caret to match its filter button instead of browser-default chrome"
```

Write the `Why:` / `What changed:` prose plus Before/After snippets into the generated skeleton (tier 2 requires both), then:

```bash
git add src/components/Sidebar/Tabs/Population/Population.css src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Fix (population): style Browse's sort caret to match its filter button instead of browser-default chrome" -- src/components/Sidebar/Tabs/Population/Population.css src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 2: Bug B — no defect found; pin sort+filter composition on both Browse query paths

**Files:**
- Create: `src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx`
- Modify: nothing. **This task ships no production code change.**

**Interfaces:**
- Consumes: `createPopulationQueryWorkerStubClass` from `src/components/Sidebar/Tabs/Population/populationQueryWorkerTestStub.ts`, `createMemoryDirectory`, `saveMonthRun`, `DEFAULT_POPULATION_CONFIG` — the exact harness `BrowseDataView.filter.test.tsx` already uses.
- Produces: nothing.

#### Investigation result — the full trace, both paths

This is recorded here rather than in a commit message because the plan's brief specifically asked for the trace, and because "we looked and there is nothing" is only useful if the next reader can see *where* we looked.

**Shared engine.** `src/data/population/populationQuery.ts:130-161` is a straight-line pipeline: search-filter → column-filter → sort → paginate. Line 149 is `const sortedRows = sortRows(filteredRows, params.sort, displayValueGetter);` — sort consumes the already-filtered set, and `totalRows`/`totalPages` are computed from `sortedRows.length` afterward. Both paths run this same function; the worker does not have its own copy.

**Sort state is reset only on dataset switch, and that is deliberate.** `BrowseDataView.tsx:706-713`:

```tsx
  useEffect(() => {
    const id = setTimeout(() => {
      setColumnFilters({});
      setOpenFilterColumn(null);
      setSort(null);
    }, 0);
    return () => clearTimeout(id);
  }, [dataset]);
```

The dependency array is `[dataset]` only. No filter mutation touches sort: `toggleColumnFilterValue` (1029-1047), `clearColumnFilter` (1049-1056) and `clearAllTableFilters` (1058-1065) each call `setPage(1)` and mutate `columnFilters`/`search`, and none of them calls `setSort`. Conversely `handleSortClick` (1024-1027) calls `setSort` + `setPage(1)` and does not touch filters. Leave all of this alone.

**Main-table query effect — no stale closure is structurally possible.** `BrowseDataView.tsx:723-776`. `params` is built inside the effect body, not captured from an outer memo:

```tsx
    const params: PopulationQueryParams = { search: debouncedSearch, columnFilters, sort, page };
```

and the dependency array (761-776) lists `debouncedSearch`, `columnFilters`, `sort`, `page`, `useWorkerPath`, `rows`, `dataset`, `showAllMonths`, `globalFolder`, `config.stageMappings`, `loadGeneration`, `directoryHandle`, `isPresetLoaded` and `worker.runQuery`. The `eslint-disable-next-line react-hooks/exhaustive-deps` on 760 suppresses only the whole-`worker`-object complaint (`runQuery` is `useCallback([])`-stable, `usePopulationBrowseWorker.ts:267-291`); every state value the params read is present. A filter change and a sort change therefore both re-run this one effect with **both** current values, and React batches `setSort` + `setPage(1)` (or `setColumnFilters` + `setPage(1)`) into a single commit, so one query is posted, not two.

**Worker path threads `params` verbatim.** `usePopulationBrowseWorker.runQuery` (267-291) allocates a request id, records it in the lane map, and posts `{ type: "query", requestId, params }` with no reconstruction, filtering or defaulting of any field. `populationQueryWorker.ts:213-226` destructures nothing — it calls `runPopulationQuery(state.cachedRows, request.params, …)` directly. There is no place between `setSort` and the comparator where a sort field could be dropped.

**The one place sort is intentionally dropped is not the table.** `BrowseDataView.tsx:929-932` posts the filter-dropdown option preview with `sort: null`:

```tsx
    void collectMatchingRows(
      { search: debouncedSearch, columnFilters: filtersExceptOpenColumn, sort: null },
      FILTER_PREVIEW_MAX_PAGES,
      (queryParams) => worker.runQuery(queryParams, FILTER_PREVIEW_QUERY_LANE)
    ).then(({ rows: sampleRows }) => {
```

That result feeds `buildBrowseFilterOptionPreview` (which de-duplicates into a `Set` and re-sorts with `compareBrowseFilterOptions`), never `setQueryResult`. Sorting it would be wasted work. It also runs on `FILTER_PREVIEW_QUERY_LANE`, distinct from `MAIN_QUERY_LANE` (59-64), so it cannot supersede the table's own query — the per-lane staleness model in `usePopulationBrowseWorker`'s doc comment (79-121) exists precisely because a shared counter previously let it do exactly that.

**The race the brief hypothesized was already fixed, and its guard is intact.** The scenario "a filter change fires a worker request before the current sort param is included" cannot occur because there is no intermediate state where `columnFilters` has advanced and `sort` has not: both are read from the same render's props in the same effect body. The nearest historical relative of that bug — the filter-preview query superseding the main table's query — is what the three-lane model prevents, and it is covered by `BrowseDataView.workerRace.test.tsx`.

**Conclusion: no code change. Add the regression tests below**, which the brief explicitly authorizes for this outcome. They close a real coverage gap: `populationQuery.test.ts:302` pins search+filter+sort composition at the **pure-engine** level, but nothing today pins it at the **component** level on either path — i.e. nothing proves `BrowseDataView` actually keeps `sort` in the params it sends when filters change.

- [ ] **Step 1: Read the existing harness first**

Read `src/components/Sidebar/Tabs/Population/BrowseDataView.filter.test.tsx` in full (204 lines) before writing anything. It establishes the exact `vi.mock` of the `?worker&inline` import, the `useGlobalMonth` mock, the `saveMonthRun` seeding helper, and the `renderPopulationBrowse` shape this task reuses. Also read `populationQueryWorkerTestStub.ts` (97 lines) — in particular why its default `replyDelayMs` is 25ms and why erring larger is always safe. Do not write a new harness; copy that one.

- [ ] **Step 2: Write the tests**

Create `src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx`:

```tsx
/* @vitest-environment jsdom */
// Bug B coverage. NOT a fix — the investigation (see
// docs/superpowers/plans/2026-08-24-datatable-sort-filter-consistency-plan.md,
// Task 2) found sort and column filters compose correctly on BOTH Browse query
// paths. What was missing was proof at the COMPONENT level: populationQuery's
// own suite pins the pure engine, but nothing pinned that BrowseDataView keeps
// `sort` in the params it posts when `columnFilters` changes, or that the
// async worker round trip preserves it. These tests fail loudly if a future
// refactor drops either.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { saveMonthRun } from "../../../../data/population/populationStorage";
import { DEFAULT_POPULATION_CONFIG } from "../../../../data/population/populationConfig";
import BrowseDataView from "./BrowseDataView";

const MONTH_FOLDER = "5-may-2026";

vi.mock("../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import("./populationQueryWorkerTestStub");
  return { default: createPopulationQueryWorkerStubClass() };
});

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: MONTH_FOLDER }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: MONTH_FOLDER },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {}
  })
}));

afterEach(cleanup);

// Two ports × three ids each. Sorting by معرف الأشعة puts them in a known order;
// filtering to one port must keep that order among the survivors, which is the
// exact composition under test.
const ROWS = [
  { xrayImageId: "X-30", portName: "ميناء الأول",  stage: "المستوى الأول" },
  { xrayImageId: "X-10", portName: "ميناء الثاني", stage: "المستوى الأول" },
  { xrayImageId: "X-20", portName: "ميناء الأول",  stage: "المستوى الأول" },
  { xrayImageId: "X-40", portName: "ميناء الثاني", stage: "المستوى الأول" },
  { xrayImageId: "X-50", portName: "ميناء الأول",  stage: "المستوى الأول" }
];

async function renderBrowse() {
  const dir = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  await saveMonthRun({
    directoryHandle: dir,
    month: 5,
    year: 2026,
    username: "tester",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    riskRawRows: [],
    biRawRows: [],
    processedRows: ROWS,
    certScanRows: 0,
    nonCertScanRows: ROWS.length
  });
  render(
    <BrowseDataView
      directoryHandle={dir}
      refreshKey={0}
      username="tester"
      config={DEFAULT_POPULATION_CONFIG}
      canExportReports
    />
  );
  await screen.findByText("X-30");
}

/** The معرف الأشعة column's rendered values, in visual row order. */
function visibleIds(): string[] {
  return Array.from(document.querySelectorAll("tbody tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""))
    .flat()
    .filter((text) => /^X-\d+$/.test(text));
}

async function sortByXrayId(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب معرف الأشعة" }));
}

async function filterToFirstPort(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "تصفية المنفذ" }));
  const menu = within(screen.getByRole("dialog", { name: "تصفية المنفذ" }));
  await waitFor(() => expect(menu.getByText("ميناء الأول")).toBeTruthy());
  const checkbox = menu.getByText("ميناء الأول").closest("label")?.querySelector("input");
  if (!checkbox) throw new Error("Expected a checkbox next to the 'ميناء الأول' filter option");
  fireEvent.click(checkbox);
}

describe("BrowseDataView — sort survives a filter change (worker path, Bug B)", () => {
  it("keeps the active sort when a column filter is applied after sorting", async () => {
    await renderBrowse();

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    await filterToFirstPort();

    // Both constraints must hold at once: only ميناء الأول's rows survive, AND
    // they are still ascending. A dropped sort would show them in the seeded
    // order (X-30, X-20, X-50) instead.
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });

  it("keeps the active filter when a sort is applied after filtering", async () => {
    await renderBrowse();

    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));

    await sortByXrayId();

    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });

  it("cycles asc → desc → none without losing the filter at any step", async () => {
    await renderBrowse();
    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-50", "X-30", "X-20"]));

    await sortByXrayId(); // third click clears the sort (cycleSort returns null)
    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-20", "X-50"]));
  });

  it("clears sort — and only sort — on a dataset switch, per the deliberate [dataset] reset", async () => {
    await renderBrowse();
    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    // Switching datasets and back must land on the unsorted seed order, proving
    // the [dataset]-scoped reset at BrowseDataView.tsx:706-713 still fires and
    // was not accidentally widened to fire on filter changes too.
    const datasetPicker = screen.getByRole("combobox", { name: /مجموعة|البيانات/ });
    fireEvent.change(datasetPicker, { target: { value: "sample" } });
    fireEvent.change(datasetPicker, { target: { value: "population" } });

    await waitFor(() => expect(visibleIds()).toEqual(["X-30", "X-10", "X-20", "X-40", "X-50"]));
  });
});
```

**Implementer notes, in order of likelihood of biting:**

1. The last test's dataset-picker query is a guess at the control's accessible name. Before writing it, find the real control in `BrowseDataView.tsx`'s render (search for `BROWSE_DATASETS` / `setDataset`) and use its actual role and name. If the reset behaves differently for the `sample` dataset in an empty workspace, seed a sample or pick another dataset that renders — the assertion that matters is "sort is null again", so if landing back on `population` proves awkward, assert on the sort button's `aria-label` reverting to the unsorted form (`"ترتيب حسب معرف الأشعة"`, no direction suffix — see `BrowseDataView.tsx:1364-1368`) instead of on row order.
2. `visibleIds()` is a deliberately loose scraper because the visible column set is preset-driven. If `معرف الأشعة` is not visible by default in this harness, open the column picker in the helper first, or narrow the scrape to the column index resolved from the header row.
3. Every assertion is wrapped in `waitFor` because the worker stub replies on a 25ms macrotask. Do not replace them with synchronous `expect`s — that is precisely the unrealistic-timing mistake `populationQueryWorkerTestStub.ts`'s doc comment warns about, and it previously hid two Critical bugs.

- [ ] **Step 3: Run the tests — they must PASS against unmodified code**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx`
Expected: **PASS on the first run.** This is the one task in this plan that inverts the usual TDD order, and deliberately so: these tests characterize behavior that is already correct, so a red-first run would mean either the investigation was wrong or the test is wrong. If any test fails, **stop and diagnose before touching production code** — a genuine failure here means Bug B is real after all and this plan's Task 2 needs rewriting as a fix, not a characterization.

To confirm the tests are not vacuous (a characterization test that cannot fail is worthless), temporarily change `BrowseDataView.tsx:726` to `{ search: debouncedSearch, columnFilters, sort: null, page }`, re-run, and confirm tests 1-3 go red. **Revert that edit immediately** — it must not be committed.

- [ ] **Step 4: Add the sync-path counterpart**

The tests above exercise the worker path (`useWorkerPath` is true: dataset is `population`, `showAllMonths` is false, `globalFolder` is set — `BrowseDataView.tsx:539`). Add one more `describe` block to the same file covering the synchronous fallback, reached by ticking عرض كل الشهور (which flips `showAllMonths` and drops out of the worker path):

```tsx
describe("BrowseDataView — sort survives a filter change (sync fallback path, Bug B)", () => {
  it("composes sort and filter identically when the worker path is not in use", async () => {
    await renderBrowse();

    // Ticking "show all months" drops out of the worker path entirely
    // (useWorkerPath requires !showAllMonths) onto loadBrowseRows +
    // synchronous runPopulationQuery. Same data, same UI, different engine —
    // the two must not diverge.
    fireEvent.click(screen.getByLabelText(/عرض كل الشهور/));
    await waitFor(() => expect(visibleIds().length).toBe(ROWS.length));

    await sortByXrayId();
    await waitFor(() => expect(visibleIds()).toEqual(["X-10", "X-20", "X-30", "X-40", "X-50"]));

    await filterToFirstPort();
    await waitFor(() => expect(visibleIds()).toEqual(["X-20", "X-30", "X-50"]));
  });
});
```

Confirm the "عرض كل الشهور" control's real accessible name from `BrowseDataView.tsx`'s render before relying on `getByLabelText`. Note that the sync path's filter dropdown is populated synchronously from `fallbackFilterOptions` (`BrowseDataView.tsx:840-852`) rather than by an async worker query, so `filterToFirstPort`'s `waitFor` will simply resolve on its first check — the helper works unchanged on both paths.

Run: `npx vitest run src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the tier-2 gates**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green. Test-only addition; no existing test can be affected.

- [ ] **Step 6: Generate the edit-log entry, then commit**

Tier 2 rather than tier 1: this is not a trivial test tweak, and the `Why:` needs to record the negative finding so the next person does not re-investigate.

```bash
npm run editlog -- --tier=2 --append --sync-package "Add (tests): pin sort+filter composition on both Population Browse query paths"
```

In the prose, state plainly that no defect was found, name the four places checked (`populationQuery.ts:149`, `BrowseDataView.tsx:706-713`, `BrowseDataView.tsx:723-776`, `usePopulationBrowseWorker.ts:267-291`), and point at this plan's Task 2 for the full trace.

```bash
git add src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (tests): pin sort+filter composition on both Population Browse query paths" -- src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 3: Bug C prerequisite — add column sorting to the shared `DataTable`

**Tier 3.** New shared capability, touches every existing `DataTable` call site's header UI, and moves two functions between modules. Run the full gate sweep.

**Files:**
- Create: `src/utils/tableSort.ts`
- Create: `src/utils/tableSort.test.ts`
- Modify: `src/data/population/populationQuery.ts` (delete the now-shared `compareQueryValues`, import it instead)
- Modify: `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (delete the now-shared `cycleSort` at 470-478, import it instead)
- Modify: `src/components/DataTable/index.tsx`
- Modify: `src/components/DataTable/DataTable.css`
- Modify: `src/data/labels/labelsStore.ts` (three new `dt_sort_*` keys)
- Modify: `src/components/DataTable/index.test.tsx`

**Interfaces:**
- Produces `src/utils/tableSort.ts`:
  - `export type TableSort = { column: string; direction: "asc" | "desc" } | null;`
  - `export function compareTableValues(first: string, second: string): number` — verbatim move of `populationQuery.ts:76-90`'s `compareQueryValues`. Numeric comparison when both display values parse as finite non-blank numbers, otherwise `localeCompare(…, "ar")`.
  - `export function cycleTableSort(current: TableSort, column: string): TableSort` — verbatim move of `BrowseDataView.tsx:470-478`'s `cycleSort`. Three-state cycle: not-this-column → asc → desc → null.
  - `export function sortRowsBy<T>(rows: T[], sort: TableSort, valueOf: (row: T, column: string) => string): T[]` — verbatim move of `populationQuery.ts:96-122`'s `sortRows`, including the explicit index tiebreaker that makes stability independent of the runtime's `Array.prototype.sort`.
  - Zero imports. Pure. Safe for the worker bundle (`populationQuery.ts` is imported by `src/workers/populationQueryWorker.ts`, which must not acquire main-thread dependencies).
- `populationQuery.ts` keeps exporting `PopulationQuerySort` — redefined as `export type PopulationQuerySort = TableSort;` so its ~15 existing import sites need no change.
- `DataTableCol<TRow>` gains `sortable?: boolean` (default `true`) and `sortAccessor?: (row: TRow) => string`.
- `DataTableProps<TRow>` gains `canSortColumns?: boolean` (default `true`) and `initialSort?: TableSort`.
- Not produced: no persistence of sort state. Sort is transient per-mount, exactly as it is in `BrowseDataView` today. `ColConfig` is unchanged, so no `onColConfigChange` consumer sees a new shape and no on-disk preset format changes.

- [ ] **Step 1: Write the shared module's tests**

Create `src/utils/tableSort.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareTableValues, cycleTableSort, sortRowsBy, type TableSort } from "./tableSort";

describe("compareTableValues", () => {
  it("compares two numeric strings numerically, not lexicographically", () => {
    // A lexicographic sort puts "10" before "2"; this must not.
    expect(compareTableValues("2", "10")).toBeLessThan(0);
    expect(compareTableValues("10", "2")).toBeGreaterThan(0);
    expect(compareTableValues("7", "7")).toBe(0);
  });

  it("falls back to Arabic locale comparison when either side is not numeric", () => {
    expect(compareTableValues("ألف", "باء")).toBeLessThan(0);
    expect(compareTableValues("10", "باء")).not.toBe(0);
  });

  it("treats a blank string as non-numeric so '' never sorts as zero", () => {
    // Number("") is 0 and finite — without the explicit blank guard, an empty
    // cell would sort in among real zeros instead of as text.
    expect(compareTableValues("", "0")).not.toBe(0);
  });
});

describe("cycleTableSort", () => {
  it("starts a fresh column ascending", () => {
    expect(cycleTableSort(null, "a")).toEqual({ column: "a", direction: "asc" });
  });
  it("switches to a different column ascending, discarding the old direction", () => {
    expect(cycleTableSort({ column: "a", direction: "desc" }, "b")).toEqual({
      column: "b",
      direction: "asc",
    });
  });
  it("cycles asc → desc → null on the same column", () => {
    const asc: TableSort = { column: "a", direction: "asc" };
    const desc = cycleTableSort(asc, "a");
    expect(desc).toEqual({ column: "a", direction: "desc" });
    expect(cycleTableSort(desc, "a")).toBeNull();
  });
});

describe("sortRowsBy", () => {
  const rows = [
    { id: "r1", group: "b", n: "10" },
    { id: "r2", group: "a", n: "2" },
    { id: "r3", group: "b", n: "9" },
    { id: "r4", group: "a", n: "2" },
  ];
  const valueOf = (row: (typeof rows)[number], column: string) =>
    String((row as unknown as Record<string, string>)[column] ?? "");

  it("is a no-op for a null sort, preserving the caller's order", () => {
    expect(sortRowsBy(rows, null, valueOf)).toEqual(rows);
  });

  it("sorts numerically on a numeric column", () => {
    const out = sortRowsBy(rows, { column: "n", direction: "asc" }, valueOf);
    expect(out.map((r) => r.n)).toEqual(["2", "2", "9", "10"]);
  });

  it("is stable in BOTH directions — equal keys keep their original relative order", () => {
    const asc = sortRowsBy(rows, { column: "group", direction: "asc" }, valueOf);
    expect(asc.map((r) => r.id)).toEqual(["r2", "r4", "r1", "r3"]);
    const desc = sortRowsBy(rows, { column: "group", direction: "desc" }, valueOf);
    // The GROUPS reverse; ties within a group must not.
    expect(desc.map((r) => r.id)).toEqual(["r1", "r3", "r2", "r4"]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortRowsBy(input, { column: "n", direction: "asc" }, valueOf);
    expect(input).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/tableSort.test.ts`
Expected: FAIL — `src/utils/tableSort.ts` does not exist.

- [ ] **Step 3: Create the shared module by moving the three functions verbatim**

Create `src/utils/tableSort.ts`. Move `compareQueryValues` (`populationQuery.ts:76-90`), `sortRows` (`populationQuery.ts:96-122`) and `cycleSort` (`BrowseDataView.tsx:470-478`) **byte-for-byte**, renaming only the identifiers and adjusting the leading doc comments to say where they came from and that they are now shared. Do not "clean up" the comparator while moving it — the blank-string guard and the `Number.isFinite` pair in `compareQueryValues` are load-bearing (see the third `compareTableValues` test), and the explicit index tiebreaker in `sortRows` is what makes stability independent of the runtime.

Header comment for the new file:

```ts
// Shared, dependency-free table sort primitives.
//
// Moved verbatim out of two places that had independently grown the same
// semantics: src/data/population/populationQuery.ts (compareQueryValues,
// sortRows — the Population Browse query engine, also run inside
// src/workers/populationQueryWorker.ts) and
// src/components/Sidebar/Tabs/Population/BrowseDataView.tsx (cycleSort — the
// header caret's three-state click cycle). DataTable is the third consumer.
//
// ZERO imports, deliberately: populationQuery.ts runs inside a DedicatedWorker
// that must not acquire main-thread dependencies (see populationQueryWorker.ts's
// own comment on why it duplicates stageHelpers' logic rather than importing it).
```

- [ ] **Step 4: Run to verify the module's tests pass**

Run: `npx vitest run src/utils/tableSort.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the two original call sites at the shared module**

In `src/data/population/populationQuery.ts`: delete `compareQueryValues` (76-90) and `sortRows` (96-122), replace the local `PopulationQuerySort` definition at line 13 with an alias, and import:

```ts
import { sortRowsBy, type TableSort } from "../../utils/tableSort";

export type PopulationQuerySort = TableSort;
```

Then at line 149, `sortRows(filteredRows, params.sort, displayValueGetter)` becomes `sortRowsBy(filteredRows, params.sort, displayValueGetter)`. Nothing else in the file changes; the pipeline order (search → filter → sort → paginate) is untouched.

In `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`: delete `cycleSort` (470-478) and import `cycleTableSort`, then update the one call site at line 1025 to `setSort((current) => cycleTableSort(current, columnKey));`.

Run: `npm run test:run`
Expected: all green **with no test expectations edited**. `src/data/population/populationQuery.test.ts` pins sort output including the `"pins search + column filter + sort composed together"` snapshot at line 302; `src/workers/populationQueryWorker.test.ts` exercises the same engine through the worker's message handler; Task 2's new component tests cover `cycleTableSort` through the UI. If any of these go red, the move was not verbatim — revert and redo it. **Do not update a snapshot to match new output.**

- [ ] **Step 6: Write the failing `DataTable` sort tests**

Read `src/components/DataTable/index.test.tsx` (440 lines) in full first to match its existing mock setup and describe-block structure, then add a new describe block:

```tsx
describe("DataTable — column sorting", () => {
  // Seeded out of order on purpose, with a duplicate `dept` to exercise the
  // stable tiebreak and a numeric column to prove numeric-not-lexicographic.
  const rows = [
    { id: "c", dept: "تشغيل", count: "10" },
    { id: "a", dept: "أمن",   count: "2"  },
    { id: "b", dept: "تشغيل", count: "9"  },
  ];
  const columns: DataTableCol<(typeof rows)[number]>[] = [
    { id: "id",    label: "المعرف", accessor: (r) => r.id },
    { id: "dept",  label: "القسم",  accessor: (r) => r.dept },
    { id: "count", label: "العدد",  accessor: (r) => r.count, isNumeric: true },
  ];

  function renderTable(extra: Partial<DataTableProps<(typeof rows)[number]>> = {}) {
    return render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => col.accessor(row)}
        {...extra}
      />
    );
  }

  function bodyIds(): string[] {
    return Array.from(document.querySelectorAll("tbody tr"))
      .map((tr) => tr.querySelector("td")?.textContent ?? "")
      .filter((t) => t !== "");
  }

  it("renders a sort button in every sortable column header", () => {
    renderTable();
    expect(screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: المعرف` }))
      .toBeInTheDocument();
  });

  it("leaves rows in caller order until the user sorts", () => {
    renderTable();
    expect(bodyIds()).toEqual(["c", "a", "b"]);
  });

  it("cycles a column asc → desc → back to caller order", () => {
    renderTable();
    const btn = screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: المعرف` });
    fireEvent.click(btn);
    expect(bodyIds()).toEqual(["a", "b", "c"]);
    fireEvent.click(btn);
    expect(bodyIds()).toEqual(["c", "b", "a"]);
    fireEvent.click(btn);
    expect(bodyIds()).toEqual(["c", "a", "b"]);
  });

  it("sorts a numeric column numerically, not lexicographically", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: العدد` }));
    // Lexicographic would give 10, 2, 9.
    expect(bodyIds()).toEqual(["a", "b", "c"]);
  });

  it("keeps sort and column filters composed — filtering does not clear the sort", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: المعرف` }));
    fireEvent.change(screen.getByLabelText(getLabels().dt_search_placeholder), {
      target: { value: "تشغيل" },
    });
    return waitFor(() => expect(bodyIds()).toEqual(["b", "c"]));
  });

  it("omits the sort button when the column opts out", () => {
    renderTable({
      columns: columns.map((c) => (c.id === "dept" ? { ...c, sortable: false } : c)),
    });
    expect(
      screen.queryByRole("button", { name: `${getLabels().dt_sort_button_prefix}: القسم` })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: المعرف` })
    ).toBeInTheDocument();
  });

  it("omits every sort button when the table opts out", () => {
    renderTable({ canSortColumns: false });
    for (const label of ["المعرف", "القسم", "العدد"]) {
      expect(
        screen.queryByRole("button", { name: `${getLabels().dt_sort_button_prefix}: ${label}` })
      ).not.toBeInTheDocument();
    }
  });

  it("announces the active direction in the sort button's accessible name", () => {
    renderTable();
    const btn = screen.getByRole("button", { name: `${getLabels().dt_sort_button_prefix}: المعرف` });
    fireEvent.click(btn);
    expect(
      screen.getByRole("button", {
        name: `${getLabels().dt_sort_button_prefix}: المعرف (${getLabels().dt_sort_asc})`,
      })
    ).toBeInTheDocument();
  });
});
```

Note the search-composition test debounces (`index.tsx:826-830` uses a 200ms `setTimeout`), hence `waitFor` rather than a synchronous assertion.

- [ ] **Step 7: Run to verify they fail**

Run: `npx vitest run src/components/DataTable/index.test.tsx -t "column sorting"`
Expected: FAIL — no sort button exists, and `dt_sort_button_prefix` is not a label key yet (a TypeScript error on `getLabels().dt_sort_button_prefix`, which counts as a red first run for a type-level addition).

- [ ] **Step 8: Add the three label keys**

In `src/data/labels/labelsStore.ts`, add alongside the existing `dt_*` block (`dt_filter_button_prefix` is at line 119):

```ts
  dt_sort_button_prefix:     "ترتيب حسب",
  dt_sort_asc:               "تصاعدي",
  dt_sort_desc:              "تنازلي",
```

These mirror the Arabic strings `BrowseDataView.tsx:1364-1368` already hard-codes for the same purpose. Per CLAUDE.md, UI strings belong in `DEFAULT_LABELS`, not inline.

- [ ] **Step 9: Implement sort in `DataTable`**

**9a — types.** In `src/components/DataTable/index.tsx`, extend `DataTableCol` (40-61):

```ts
  /**
   * Set false to hide this column's sort control. Defaults true. Use it for
   * columns whose accessor value is not a meaningful sort key (an action
   * column, a rendered badge whose accessor exists only to feed the filter).
   */
  sortable?: boolean;
  /**
   * Value used for SORTING only, when it must differ from `accessor`'s value.
   * The common case is a cell rendered as a formatted string ("80.0%",
   * "١٢٣") whose accessor returns the display text — sorting that
   * lexicographically is wrong. Return the raw comparable value here.
   * Defaults to `accessor`.
   */
  sortAccessor?: (row: TRow) => string;
```

and `DataTableProps` (80-154):

```ts
  /** Shows per-column sort controls. Defaults to true. */
  canSortColumns?: boolean;
  /**
   * Sort applied on first mount. Sort is transient per-mount state and is
   * deliberately NOT persisted through ColConfig/onColConfigChange — a caller
   * that wants a durable default passes it here.
   */
  initialSort?: TableSort;
```

Destructure both in the component signature (252-274) with `canSortColumns = true`.

**9b — state.** Next to the other UI state (near `colPickerOpen` at 298):

```ts
  const [sort, setSort] = useState<TableSort>(initialSort ?? null);
```

**9c — pipeline.** Insert between `filteredRows` (477-492) and `requestedPage` (494). Sort runs **after** both filter stages and **before** pagination, matching `runPopulationQuery`'s proven order:

```ts
  // Sort runs after search+filter and before pagination — same order as
  // runPopulationQuery (src/data/population/populationQuery.ts:136-159), so the
  // two engines cannot drift. `sortRowsBy` is a no-op for a null sort and
  // returns `filteredRows` itself, so an unsorted table pays nothing and keeps
  // its array identity.
  const sortedRows = useMemo(
    () => sortRowsBy(filteredRows, sort, (row, columnId) => {
      const col = visibleCols.find((c) => c.id === columnId);
      if (!col) return "";
      return col.sortAccessor ? col.sortAccessor(row) : (col.accessor(row) ?? "");
    }),
    [filteredRows, sort, visibleCols]
  );
```

Then change line 498-502 to slice from `sortedRows`:

```ts
  const page = clampPage(requestedPage, sortedRows.length, DATA_PAGE_SIZE);
  const pageRows = useMemo(
    () => pageSlice(sortedRows, page, DATA_PAGE_SIZE),
    [sortedRows, page]
  );
```

and change `handleExport`'s two `filteredRows` references (652-653) to `sortedRows`, so the exported file matches what is on screen.

**Deliberately NOT changed:** `onFilteredRowsChange` (535-545) keeps emitting `filteredRows`, not `sortedRows`. Its documented contract is "the rows currently visible after global search and column filters" (126-127), membership is identical either way, and its five consumers (`XrayReferrals`' bulk-reassign, `XrayInspectionResults`, `AdhocImport`, `HistoryView`, `XrayReferrals/subComponents`) treat the emission as a set. Leaving it untouched makes those five call sites provably unaffected by this task and avoids an extra parent setState on every sort toggle. Also unchanged: `filteredRows.length` in the row-count line (900-901) and `totalItems` (1063) — the counts are the same set either way — and `openColOptions` (596-603), which de-duplicates into a `Set`.

**9d — header control.** In the `.dt-th-inner` block (941-956), insert a sort button between the label and the filter button, so the header reads grip → label → sort → filter, matching Browse's own action ordering:

```tsx
                      {canSortColumns && col.sortable !== false && (
                        <button
                          type="button"
                          className={`dt-sort-btn${sort?.column === col.id ? " active" : ""}`}
                          title={
                            sort?.column === col.id
                              ? `${L.dt_sort_button_prefix}: ${col.label} (${sort.direction === "asc" ? L.dt_sort_asc : L.dt_sort_desc})`
                              : `${L.dt_sort_button_prefix}: ${col.label}`
                          }
                          aria-label={
                            sort?.column === col.id
                              ? `${L.dt_sort_button_prefix}: ${col.label} (${sort.direction === "asc" ? L.dt_sort_asc : L.dt_sort_desc})`
                              : `${L.dt_sort_button_prefix}: ${col.label}`
                          }
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSort((current) => cycleTableSort(current, col.id));
                            setPageState({ resetKey, page: 1 });
                          }}
                        >
                          {sort?.column === col.id ? (
                            sort.direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                          ) : (
                            <ChevronUp size={12} className="dt-sort-btn-idle-icon" />
                          )}
                        </button>
                      )}
```

`onMouseDown` stops propagation because the `<th>` is `draggable` for column reordering (925-928) — without it, dragging from the sort button starts a column drag. `BrowseDataView.tsx:1373` guards its own sort button the same way. Add `ChevronUp, ChevronDown` to the existing lucide import on line 1.

**9e — layout constants.** The header cell now carries one more 20px control. Bump both width heuristics so an Arabic label does not start wrapping where it previously fit:

- `headerMinWidth` (719-721): `Math.max(88, col.label.length * 9 + 28)` → `+ 48`.
- `estimateColumnFr` (723-733): `maxChars * 8 + 42` → `+ 62`.

These are layout constants; jsdom has no layout engine so they cannot be unit-tested. Verify them visually in Step 12.

- [ ] **Step 10: Add the CSS**

In `src/components/DataTable/DataTable.css`, insert immediately before the `.dt-filter-btn` rule at line 272, mirroring its geometry, transition and token set exactly (20px here, not Browse's 24px — `DataTable`'s header is denser and has a compact density mode):

```css
/* Peer of .dt-filter-btn in the same .dt-th-inner row — same box, same
   transition, same tokens, so the two controls read as one pair rather than as
   a styled control next to an unstyled one. */
.dt-sort-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: none;
  cursor: pointer;
  color: var(--c-ink-4);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease;
}
.dt-sort-btn:hover,
.dt-sort-btn.active {
  border-color: var(--c-border);
  background: var(--c-surface);
  color: var(--c-navy);
}
/* Unsorted: an affordance, not a status. Dimmed so a wide header row stays
   quiet, full-strength on hover so it stays discoverable. */
.dt-sort-btn-idle-icon {
  opacity: 0.42;
}
.dt-sort-btn:hover .dt-sort-btn-idle-icon {
  opacity: 1;
}
```

No raw hex literals — `--r-xs`, `--c-ink-4`, `--c-border`, `--c-surface` and `--c-navy` are the five `.dt-filter-btn` already uses (272-294). `DataTable.css` is one of the files `check:hex-literals` guards, so this must stay token-only.

- [ ] **Step 11: Run to verify the tests pass**

Run: `npx vitest run src/components/DataTable/`
Expected: PASS, including every pre-existing test across `index.test.tsx`, `errorAndFocusTrap.test.tsx`, `pageRetention.test.tsx`, `popoverPlacement.test.tsx` and `stickyColumns.test.tsx`. Watch specifically for:
- `pageRetention.test.tsx` — asserts the `resetToken` page-retention contract. The new `setPageState({ resetKey, page: 1 })` on sort click is a *user-initiated* page move, the same class as the existing search/filter resets (825, 837), and must not be confused with the refresh-driven reset that file guards against. If one of its tests goes red, the sort click is firing when it should not.
- `stickyColumns.test.tsx` — sticky header cells now contain an extra child; if it asserts on `.dt-th-inner`'s children by index, update the index, not the behavior.

- [ ] **Step 12: See it in the real app**

Run `npm run dev` and exercise at least two of the five existing `DataTable` call sites — `Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` (the widest, with sticky columns) and `Tabs/EmployeeWorkspace/views/ReferralApproval/HistoryView.tsx`. Confirm: sort carets appear in every header and match the filter buttons visually; clicking cycles asc → desc → off; sorting composes with an active column filter and with the global search; column drag-to-reorder still works when dragging from the label or grip (and does **not** start when dragging from the sort button); Arabic headers still fit on one line at default widths; compact density still looks right.

- [ ] **Step 13: Run the full tier-3 gate sweep**

```bash
npm run test:run && npm run typecheck && npm run lint && npm run check:complexity && npm run check:hex-literals && npm run check:vendor && npm run build && npm run check:bundle-size
```

Expected: all green. Two to watch: `check:complexity` (the `DataTable` component function grows by the header block and the `sortedRows` memo — if it trips the budget, extract the header's sort button into a small local `SortButton` component alongside the existing `ColPickerPanel`/`ColFilterMenu` rather than raising the budget) and `check:hex-literals` (must be unchanged; if it moved, a raw hex slipped into the new CSS).

Run `npm run check:release` last, after the edit-log entry exists.

- [ ] **Step 14: Generate the edit-log entry, then commit**

Tier 3 — the entry needs full prose plus migration/rollback notes. Rollback is clean and worth stating: reverting this commit removes the sort controls and restores caller-order rows everywhere; nothing is persisted, no on-disk format changed, so there is no data to migrate back.

```bash
npm run editlog -- --tier=3 --append --sync-package "Add (data-table): per-column sorting in the shared DataTable, on primitives extracted from Population Browse"
npm run check:release
```

```bash
git add src/utils/tableSort.ts src/utils/tableSort.test.ts src/data/population/populationQuery.ts src/components/Sidebar/Tabs/Population/BrowseDataView.tsx src/components/DataTable/index.tsx src/components/DataTable/DataTable.css src/components/DataTable/index.test.tsx src/data/labels/labelsStore.ts "docs/edit logs/2026-08-24.md" package.json
git commit -m "Add (data-table): per-column sorting in the shared DataTable, on primitives extracted from Population Browse" -- src/utils/tableSort.ts src/utils/tableSort.test.ts src/data/population/populationQuery.ts src/components/Sidebar/Tabs/Population/BrowseDataView.tsx src/components/DataTable/index.tsx src/components/DataTable/DataTable.css src/components/DataTable/index.test.tsx src/data/labels/labelsStore.ts "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 4: Bug C — migrate `ReviewerKpiPanel`'s reviewer table to `DataTable`

**Depends on Task 3** (the migration is only worth doing once `DataTable` can sort). Independently revertable: reverting this commit alone restores the hand-rolled `<table>` and leaves Task 3's shared sort in place for every other table.

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx` (the `.rk-table` block, lines 65-108, only)
- Modify: `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.css` (retire the now-unused `.rk-table*` rules; keep `.rk-sr-only`, `.rk-progress*`, `.rk-status*`, `.rk-num`)
- Modify: `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx`

**Interfaces:**
- Consumes: `DataTable`, `type DataTableCol` from `src/components/DataTable`; the existing `ReviewerKpiRow` shape from `src/data/reporting/executive/model/reviewerKpis.ts:122-148`; the panel's existing `nf`/`pf`/`hf` formatters (21-25) and `statusLabel` (27-33).
- Produces: no new exports. `ReviewerKpiPanel`'s props (35-40) are unchanged, so `KpiDashboard.tsx:659` needs no edit.

**Scope note — one of this file's two tables moves, not both.** Line 137's `.rk-sr-only` table stays exactly as it is: it is the screen-reader alternative for the `aria-hidden` `answersBarsSvg` chart below it, and wrapping it in `DataTable` would give a visually-hidden accessibility affordance a toolbar, a search box, a column picker and pagination. That is the table CLAUDE.md's "native responsive SVG plus a semantic screen-reader table" note is about. Only line 66's `.rk-table` — a real seven-column reviewer data table — moves.

- [ ] **Step 1: Read the current implementation and its test in full**

Read `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx` (183 lines) and `ReviewerKpiPanel.test.tsx` (113 lines). Note in particular that the existing tests assert via `getByRole("cell", { name: … })` and `getByRole("table", { name: … })`, and that the third test (78-100) asserts on the **sr-only** table by its caption — that assertion must keep passing untouched, which is a useful guard that this task did not disturb the wrong table.

- [ ] **Step 2: Write the failing tests**

Add to `ReviewerKpiPanel.test.tsx`. Extend `makeModel()` to return **three** reviewers with distinguishable, deliberately out-of-order values (e.g. `completed` of 8, 3, 12 and `turnaroundMedianHours` of 2, 9, 5) so sort assertions are meaningful, and update `resolveName` in the new tests to return a distinct name per id.

```tsx
describe("ReviewerKpiPanel — reviewer table on the shared DataTable", () => {
  it("renders the reviewer rows through DataTable, with its toolbar", () => {
    render(<ReviewerKpiPanel model={makeModel()} resolveName={nameOf} answers={makeAnswers()} statuses={new Map()} />);
    // The shared toolbar's global search box is DataTable's signature — a
    // hand-rolled <table> has none.
    expect(screen.getByLabelText(labels.dt_search_placeholder)).toBeInTheDocument();
  });

  it("sorts by a numeric column numerically", () => {
    render(<ReviewerKpiPanel model={makeModel()} resolveName={nameOf} answers={makeAnswers()} statuses={new Map()} />);
    fireEvent.click(
      screen.getByRole("button", { name: `${labels.dt_sort_button_prefix}: ${labels.rk_col_completed}` })
    );
    expect(reviewerNamesInOrder()).toEqual(["المراجع الثاني", "المراجع الأول", "المراجع الثالث"]);
  });

  it("filters via the shared global search", async () => {
    render(<ReviewerKpiPanel model={makeModel()} resolveName={nameOf} answers={makeAnswers()} statuses={new Map()} />);
    fireEvent.change(screen.getByLabelText(labels.dt_search_placeholder), {
      target: { value: "الثالث" },
    });
    await waitFor(() => expect(reviewerNamesInOrder()).toEqual(["المراجع الثالث"]));
  });

  it("keeps the completion progress bar and the الحالة pill as custom cells", () => {
    const statuses = new Map<string, ReviewerControlStatus>([["reviewer-1", "in-control"]]);
    const { container } = render(
      <ReviewerKpiPanel model={makeModel()} resolveName={nameOf} answers={makeAnswers()} statuses={statuses} />
    );
    // These are the two cells that are NOT plain text; migrating must not
    // flatten them into their accessor strings.
    expect(container.querySelector(".rk-progress-fill")).toBeTruthy();
    expect(screen.getByText(labels.rk_status_in_control)).toBeInTheDocument();
  });

  it("still renders the sr-only chart table as a plain semantic table (NOT migrated)", () => {
    const { container } = render(
      <ReviewerKpiPanel model={makeModel()} resolveName={nameOf} answers={makeAnswers()} statuses={new Map()} />
    );
    const srTable = container.querySelector("table.rk-sr-only");
    expect(srTable).toBeTruthy();
    // If someone routes this one through DataTable too, it acquires dt- classes.
    expect(srTable?.classList.contains("dt-table")).toBe(false);
  });
});
```

Add a `reviewerNamesInOrder()` helper scoped to the `DataTable` body (`document.querySelectorAll(".dt-table tbody tr")`), reading the first cell of each row.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx`
Expected: the four new `DataTable` tests FAIL (no search box, no sort button, no `.dt-table`). The fifth (sr-only guard) passes already — correct, it is a "did not break this" guard, not a driver.

- [ ] **Step 4: Migrate the `.rk-table` block**

Replace `ReviewerKpiPanel.tsx` lines 65-108 (the `<div className="rk-table-wrap">` through its closing `</div>`) with a `DataTable`. Define the columns above the `return`:

```tsx
  const reviewerColumns: DataTableCol<ReviewerKpiRow>[] = [
    { id: "reviewer",   label: labels.rk_col_reviewer,           accessor: (row) => resolveName(row.reviewerId) },
    { id: "assigned",   label: labels.rk_col_assigned,           accessor: (row) => String(row.assigned),  isNumeric: true },
    { id: "completed",  label: labels.rk_col_completed,          accessor: (row) => String(row.completed), isNumeric: true },
    // accessor returns the RAW number so search and (numeric) sort work on the
    // value; renderCell below draws the progress bar and the "80.0%" text.
    { id: "completion", label: labels.rk_col_completion,         accessor: (row) => row.completionRate == null ? "" : String(row.completionRate),          isNumeric: true },
    { id: "turnaround", label: labels.rk_col_turnaround_median,  accessor: (row) => row.turnaroundMedianHours == null ? "" : String(row.turnaroundMedianHours), isNumeric: true },
    { id: "suspicion",  label: labels.rk_col_suspicion_rate,     accessor: (row) => row.suspicionOrReferralRate == null ? "" : String(row.suspicionOrReferralRate), isNumeric: true },
    // Sorting a status pill alphabetically is not useful; filtering it is.
    { id: "status",     label: labels.kpi_reviewers_col_status,  sortable: false, filterKind: "multiselect",
      accessor: (row) => statusLabel(statuses.get(row.reviewerId) ?? "low-n", labels) },
  ];
```

and render:

```tsx
        <DataTable
          columns={reviewerColumns}
          rows={model.rows}
          getRowKey={(row) => row.reviewerId}
          canConfigureColumns={false}
          density="compact"
          renderCell={(col, row) => {
            switch (col.id) {
              case "reviewer":
                return <span className="rk-cell-name">{resolveName(row.reviewerId)}</span>;
              case "assigned":
                return nf(row.assigned);
              case "completed":
                return nf(row.completed);
              case "completion":
                return (
                  <>
                    <span className="rk-progress">
                      <span
                        className="rk-progress-fill"
                        style={{ width: `${Math.max(0, Math.min(100, row.completionRate ?? 0))}%` }}
                      />
                    </span>
                    <span className="rk-num rk-progress-value">{pf(row.completionRate)}</span>
                  </>
                );
              case "turnaround":
                return hf(row.turnaroundMedianHours);
              case "suspicion":
                return pf(row.suspicionOrReferralRate);
              case "status": {
                const status = statuses.get(row.reviewerId) ?? "low-n";
                return <span className={`rk-status rk-status-${status}`}>{statusLabel(status, labels)}</span>;
              }
              default:
                return null;
            }
          }}
        />
```

**Three points the implementer must get right:**

1. **`accessor` returns the raw comparable value; `renderCell` returns the formatted display.** They are separate hooks for a reason. If `completionRate`'s accessor returned `pf(row.completionRate)` (`"80.0%"`), Task 3's comparator would fall through to `localeCompare` and sort it as text — `"100.0%"` before `"80.0%"`. Returning `"80"` sorts numerically. The same applies to `turnaround` and `suspicion`. `nf()` is also a trap: it formats through `toLocaleString("ar-SA-u-nu-latn")`, so use `String(row.assigned)` in the accessor and `nf(row.assigned)` in `renderCell`.
2. **`null` numerics map to `""`, not `"—"`.** `compareTableValues`'s blank-string guard already keeps `""` out of the numeric branch, and an empty accessor value is correctly excluded from the multiselect filter's option list (`index.tsx:601` filters falsy). `pf`/`hf` still render `"—"` on screen via `renderCell`.
3. **`canConfigureColumns={false}`** — seven fixed KPI columns are the panel's designed content, not a browsable set; a column picker here invites a user to hide a metric with no way to know it is missing. Do not set `exportFileName` either: this data already ships through the executive report builders (`src/data/reporting/executive/`), and adding a second, differently-shaped XLSX egress point for the same numbers is a divergence waiting to happen.

Keep everything else in the file untouched: the `model.rows.length === 0` early return (45-54), the whole second `<section>` with its toggle, sr-only table, SVG and legend (111-180).

- [ ] **Step 5: Retire the dead CSS**

In `ReviewerKpiPanel.css`, remove the rules that only ever applied to the replaced markup — `.rk-table-wrap`, `.rk-table`, and any `.rk-table th` / `.rk-table td` descendant rules. **Keep**: `.rk-sr-only` (still used by the chart's alternative table), `.rk-cell-name`, `.rk-num`, `.rk-progress`, `.rk-progress-fill`, `.rk-progress-value`, `.rk-status`, `.rk-status-*` — all still applied by `renderCell`. Grep the file for each class before deleting it; several are shared between the two tables.

- [ ] **Step 6: Run to verify the tests pass**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports/`
Expected: PASS, including the four pre-existing `ReviewerKpiPanel` tests. Two of them will need small updates and this is expected, not a regression — `getByRole("cell", { name: "اسم المراجع" })` (line 62) still resolves because `renderCell` puts the name in a `<td>`, but if `DataTable`'s virtualizer renders zero rows under jsdom's stubbed `ResizeObserver`, check `initialRect` handling (`index.tsx:570-576` explicitly provides a 600px fallback for exactly this case). Do not delete a failing pre-existing assertion — update it and say why in the edit-log entry.

- [ ] **Step 7: See it in the real app**

Run `npm run dev` → Reports → مؤشرات الأداء → المراجعون with a workspace containing answered assignments. Confirm the reviewer table renders with the shared toolbar, the progress bars and status pills survive intact, sorting by العدد المكتمل orders numerically, the global search narrows to a reviewer, and the bar chart plus its legend below are untouched.

- [ ] **Step 8: Run the tier-2 gates**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 9: Generate the edit-log entry, then commit**

```bash
npm run editlog -- --tier=2 --append --sync-package "Change (reports): render the reviewer KPI table through the shared DataTable"
```

Record in the prose that the sr-only chart table in the same file was deliberately left alone, and why.

```bash
git add src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.css src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Change (reports): render the reviewer KPI table through the shared DataTable" -- src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.css src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

### Task 5: Record the "deliberately not migrated" decisions, and fix CLAUDE.md's DataTable description

**Tier 1.** Docs only, no production code. Small but worth its own commit: without it, the next person reading "migrate the small custom tables to DataTable" re-derives findings F1 and F2 from scratch, and CLAUDE.md keeps asserting a capability that only exists after Task 3.

**Files:**
- Modify: `CLAUDE.md` (the `DataTable` row of the *Shared UI components* table, line 173)
- Modify: `src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx` (one comment)
- Modify: `src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx` (one comment)

- [ ] **Step 1: Correct CLAUDE.md**

Line 173 currently reads:

```
| `DataTable` | `src/components/DataTable/` | Reusable filterable/sortable table with column visibility, XLSX export |
```

After Task 3 this is finally true, but it should say what "sortable" means and that sort is not persisted:

```
| `DataTable` | `src/components/DataTable/` | Reusable table: global search, per-column filters, per-column sort (opt-out via `sortable: false` / `canSortColumns={false}`; transient per-mount, never persisted through `ColConfig`), column visibility/reorder/resize, XLSX export, virtualized paging. Sort primitives are shared with Population Browse via `src/utils/tableSort.ts` |
```

If Task 5 lands **before** Task 3 for any reason, correct the line to say the component is *not* sortable instead — an inaccurate CLAUDE.md is worse than a terse one. This is the single most load-bearing correction in this task: F1 above exists because the description was trusted over the code.

- [ ] **Step 2: Leave a pointer at each non-migrated table**

In `KpiDashboard.tsx`, above the `<table className="kpi-sr-only">` at line 495:

```tsx
              {/* Screen-reader alternative to the aria-hidden calendar heat map
                  below — NOT a browsable data table, and deliberately not
                  routed through the shared DataTable: a visually-hidden a11y
                  affordance has no use for a toolbar, search box, column picker
                  or pagination. Same pattern as ReviewerKpiPanel's .rk-sr-only. */}
```

In `PermissionSections.tsx`, above the `<table className="um-perm-table">` at line 130 (and a one-line pointer above `.um-feat-table` at 184):

```tsx
        {/* A permission MATRIX, not a row list: columns are roles, every cell is
            an interactive control (segmented group / toggle), and parents own a
            collapsible child tree. Deliberately not on the shared DataTable —
            that component requires `accessor: (row) => string | null` per column
            to drive filtering, sorting and export, and a "role × tab → control"
            cell has no meaningful string value to give it. */}
```

- [ ] **Step 3: Run the tier-1 gates**

Run: `npm run lint && npm run typecheck`
Expected: green. Comment- and docs-only; no test file is affected, so no test run is required beyond the lint/typecheck pair (tier 1's third gate, "the affected test file", has no counterpart here).

- [ ] **Step 4: Generate the edit-log entry, then commit**

Tier 1: one or two sentences, no `Why:` required, no Before/After snippets required.

```bash
npm run editlog -- --tier=1 --append --sync-package "Docs: correct CLAUDE.md's DataTable description and record the two tables deliberately left off it"
```

```bash
git add CLAUDE.md src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx "docs/edit logs/2026-08-24.md" package.json
git commit -m "Docs: correct CLAUDE.md's DataTable description and record the two tables deliberately left off it" -- CLAUDE.md src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx "docs/edit logs/2026-08-24.md" package.json
```

---

## Ordering and independence

| | Task | Tier | Depends on | Revert impact if reverted alone |
|---|---|---|---|---|
| A | 1 — Browse sort caret CSS | 2 | — | Caret returns to browser-default chrome. Nothing else. |
| B | 2 — sort+filter regression tests | 2 | — | Coverage gap reopens. No behavior change either way. |
| C | 3 — `DataTable` sort | 3 | — | Sort controls disappear from all five existing `DataTable` call sites; rows return to caller order. Nothing persisted, nothing to migrate. Task 4 must be reverted first or it will not compile. |
| C | 4 — `ReviewerKpiPanel` migration | 2 | Task 3 | The hand-rolled `.rk-table` returns. Task 3 stays intact for every other table. |
| C | 5 — docs | 1 | Task 3 (for wording) | Docs revert to the current inaccurate description. |

Tasks 1 and 2 are independent of everything and of each other — land them in either order, or in parallel. Task 3 must precede Tasks 4 and 5. Task 4 must be reverted before Task 3 if both are being rolled back.

## Testing summary (repo-level gates)

`npm run test:run`, `npm run typecheck`, `npm run lint` after **every** task. Task 3 additionally needs the full tier-3 sweep (`check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`). `npm run build` before pushing the branch or opening a PR regardless of which subset of tasks landed.

Two tasks carry a mandatory real-browser step (Task 1 Step 6, Task 3 Step 12, Task 4 Step 7) because they change what the user sees and jsdom cannot verify layout. CLAUDE.md is explicit that this repo has a documented history of self-reviewed changes shipping broken; a green suite is not evidence a visual fix looks right.

## Key files touched

| Task | Files |
|---|---|
| 1 (Bug A) | `src/components/Sidebar/Tabs/Population/Population.css`, `BrowseDataView.sortButtonStyling.test.tsx` (new) |
| 2 (Bug B) | `src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx` (new) — no production file |
| 3 (Bug C prereq) | `src/utils/tableSort.ts` (new), `src/utils/tableSort.test.ts` (new), `src/data/population/populationQuery.ts`, `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`, `src/components/DataTable/index.tsx`, `src/components/DataTable/DataTable.css`, `src/components/DataTable/index.test.tsx`, `src/data/labels/labelsStore.ts` |
| 4 (Bug C) | `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx`, `.css`, `.test.tsx` |
| 5 (Bug C) | `CLAUDE.md`, `src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx`, `src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx` |

Every task also touches `docs/edit logs/2026-08-24.md` and `package.json`.
