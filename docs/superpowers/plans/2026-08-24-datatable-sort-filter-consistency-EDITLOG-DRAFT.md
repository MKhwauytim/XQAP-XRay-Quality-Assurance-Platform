# Edit-log draft — table sort/filter UX consistency (sort caret styling, sort+filter composition, shared-DataTable migration)

Source plan: `docs/superpowers/plans/2026-08-24-datatable-sort-filter-consistency-plan.md`

This worktree is shared by several concurrent agent sessions, so this plan's entries are
drafted here instead of being inserted directly into `docs/edit logs/2026-08-24.md` or
`package.json`. Whoever consolidates the day's log should insert these, newest-first (Task 5
first, Task 1 last), as five consecutive headings and bump `package.json` to match the
topmost one. Tasks 1, 2 and 4 are decimal (fix/tests/change) bumps; Task 3 is a whole-number
bump (new shared capability touching every `DataTable` call site); Task 5 is a decimal bump.

All five tasks landed exactly as scoped in the plan, with one necessary addition beyond the
plan's own file list (see Task 3 below) and a few small test-harness corrections against
actual accessible names/paths that the plan's draft tests had guessed slightly wrong (noted
inline). No task's *behavior* deviates from the plan.

---

## Task 1 — Fix (population): style Browse's sort caret to match its filter button instead of browser-default chrome

**Why:** `BrowseDataView.tsx` already rendered a `.bv-sort-btn` (and `.bv-sort-btn.active` / `.bv-sort-btn-idle-icon`) per-column sort control, but no CSS rule for any of those classes existed anywhere in the repo — a repo-wide grep for `sort-btn` across every `*.css` file returned zero matches. The button rendered with user-agent `<button>` chrome (grey face, outset border) sitting directly beside `.bv-filter-btn`, a fully-styled transparent 24×24 square, in the same `.bv-th-content` flex row — exactly the "floating disconnected chip next to a properly-styled control" the report described. The `active` class was applied by the component but consumed by nothing, so a sorted column was visually indistinguishable from an unsorted one.

**What changed:** Added four CSS rules to `Population.css`, inserted immediately before the existing `.bv-filter-btn` rule so the two sibling header-cell controls read together: a base `.bv-sort-btn` rule sized/skinned identically to `.bv-filter-btn` (24×24, transparent, `--p-muted` icon color); a shared `:hover`/`.active` state (bordered, `--c-surface` background, `--p-primary` icon); a `.bv-sort-btn.active` inset ring copied verbatim from `.bv-filter-btn.active`'s `rgba(23, 54, 93, 0.08)` box-shadow; and a `.bv-sort-btn-idle-icon` opacity dim (0.42, full on hover) so the unsorted chevron reads as an affordance rather than a status. Every color is one of the four tokens (`--p-muted`, `--p-border`, `--p-primary`, `--c-surface`) `.bv-filter-btn` already uses, so `check:hex-literals`' count for this file is unchanged (16/16, confirmed by the gate run). No `.tsx` change — the markup already emitted the classes.

**Before:**
```css
.bv-th-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bv-filter-btn {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  ...
```

**After:** (`.bv-sort-btn` + three sibling rules inserted between `.bv-th-label` and `.bv-filter-btn`)
```css
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
.bv-sort-btn.active {
  box-shadow: inset 0 0 0 1px rgba(23, 54, 93, 0.08);
}
.bv-sort-btn-idle-icon {
  opacity: 0.42;
}
.bv-sort-btn:hover .bv-sort-btn-idle-icon {
  opacity: 1;
}
```

Added a CSS-contract regression test (`BrowseDataView.sortButtonStyling.test.tsx`) — jsdom cannot assert computed pixels, so it asserts the stylesheet source itself declares the four rules, sizes `.bv-sort-btn` identically to `.bv-filter-btn`, and stays hex-literal-free. One deviation from the plan's own draft: the plan's test resolved the CSS file path via `fileURLToPath(new URL("./Population.css", import.meta.url))`, which threw `TypeError: The URL must be of scheme file` in this repo's actual Vitest/Windows setup. Switched to the same `join(dirname(fileURLToPath(import.meta.url)), "Population.css")` pattern the existing `uiScaleCss.contract.test.ts` precedent uses — same intent, a path form that actually resolves here.

**File:** `src/components/Sidebar/Tabs/Population/Population.css`

**File:** `src/components/Sidebar/Tabs/Population/BrowseDataView.sortButtonStyling.test.tsx (new)`

**Lines:** 2 files, +41 (Population.css) / +50 (new test file)

---

## Task 2 — Add (tests): pin sort+filter composition on both Population Browse query paths

**Why:** The plan's Bug B investigation (recorded in full in the plan document itself) traced sort+filter composition through both Browse query paths — the worker-backed path and the synchronous fallback — and found no defect: `runPopulationQuery` (`src/data/population/populationQuery.ts:136-159`, pre-move line numbers) applies sort strictly after both filter stages; `BrowseDataView`'s single main-table query effect (`BrowseDataView.tsx:723-776`) builds `params` fresh inside the effect body from current render values with `sort`, `columnFilters`, `debouncedSearch` and `page` all in its dependency array, so no stale closure is structurally possible; `usePopulationBrowseWorker.runQuery` forwards `params` verbatim with no reconstruction; and the one place sort is deliberately dropped (`sort: null` on the filter-dropdown option preview, a different query lane) never feeds the table. What was missing was proof at the *component* level — `populationQuery.test.ts` pins the pure engine's search+filter+sort composition, but nothing pinned that `BrowseDataView` actually keeps `sort` in the params it sends when filters change, on either path, through the real async worker round trip. This task ships tests only, per the plan's explicit instruction for a "no defect found" outcome — **no production code changed**.

**What changed:** Added `BrowseDataView.sortWithFilters.test.tsx`, reusing the exact worker-mock/month-mock harness `BrowseDataView.filter.test.tsx` already established. Five tests: sort survives a filter applied after it; a filter survives a sort applied after it; a full asc→desc→none cycle keeps the filter active at every step; a dataset switch clears sort (and only sort, confirming the `[dataset]`-scoped reset effect was not accidentally widened to fire on filter changes); and one more test on the synchronous fallback path (reached by ticking "show all months," which drops `useWorkerPath`), proving the two engines don't diverge. Verified per the plan's own instruction: temporarily forced `{ ..., sort: null, page }` in the query effect and confirmed three of the five tests went red, then reverted — the suite is not vacuous.

Two corrections against the plan's draft, found by reading the actual current component before writing the test rather than trusting the plan's guessed selectors:
1. The "show all months" checkbox's accessible label text is `labels.gm_all_months` = `"كل الأشهر"`, not the `"عرض كل الشهور"` the plan's draft assumed (that string only appears in a code *comment*, not the rendered label). Used the real string.
2. The dataset picker is a `role="group"` of plain toggle buttons (`BROWSE_DATASETS.map(...)`), not a `<select>`/combobox as the plan's draft guessed. Queried it via `within(screen.getByRole("group", { name: "مصدر البيانات" }))` and its buttons' real labels ("العينة المسحوبة" / "المجتمع النهائي"). Per the plan's own fallback guidance for this exact situation, the post-switch assertion checks the sort button's accessible name reverting to its unsorted form (`"ترتيب حسب معرف الأشعة"`, no direction suffix) rather than row order — more robust than depending on how the unrelated, unseeded "sample" dataset happens to load in this harness.

One further fix needed after the first run: `sortByXrayId()`'s helper originally re-queried the sort button by its *exact* unsorted-form accessible name on every call, which breaks after the first click (the button's `aria-label` grows a `"(تصاعدي)"`/`"(تنازلي)"` suffix once sorted). Changed the query to a prefix regex (`/^ترتيب حسب معرف الأشعة/`) so the same button is found regardless of its current sort direction; the one assertion that specifically wants the *unsorted* form (proving the dataset-switch reset worked) still matches on the exact string.

**File:** `src/components/Sidebar/Tabs/Population/BrowseDataView.sortWithFilters.test.tsx (new)`

**Lines:** 1 file, +185

---

## Task 3 — Add (data-table): per-column sorting in the shared DataTable, on primitives extracted from Population Browse

**Why:** CLAUDE.md described `DataTable` as "filterable/sortable," but it had zero sort feature — a repo-wide grep for `asc`, `desc`, `Chevron`, `localeCompare` etc. across the component turned up only the filter-dropdown's own option-list sort, not a row sort. Meanwhile Population Browse had grown a real sort feature (`cycleSort`/`sortRows`/`compareQueryValues` in `BrowseDataView.tsx` / `populationQuery.ts`) with nowhere else to reuse it from. This task moves those primitives into a shared, dependency-free module and gives `DataTable` its own per-column sort, so migrating a hand-rolled table onto it (Task 4) actually gains something on sort instead of nothing.

**What changed:** Created `src/utils/tableSort.ts` — `compareTableValues` (numeric-vs-`localeCompare("ar")` comparator, with the blank-string guard load-bearing per its own test), `cycleTableSort` (three-state none→asc→desc→none click cycle), `sortRowsBy` (single-column stable sort with an explicit index tiebreaker), and the `TableSort` type — moved **byte-for-byte** out of `populationQuery.ts`'s `compareQueryValues`/`sortRows` and `BrowseDataView.tsx`'s `cycleSort`. Zero imports, deliberately: `populationQuery.ts` runs inside `populationQueryWorker.ts`'s DedicatedWorker, which must not acquire main-thread dependencies. Repointed both original call sites at the shared module (`PopulationQuerySort` is now a type alias for `TableSort`, so its ~15 existing import sites needed no change) and reran `populationQuery.test.ts` (including its `"pins search + column filter + sort composed together"` snapshot at the old line 302) and `populationQueryWorker.test.ts` with **zero expectation edits** — confirming the move was verbatim, not a rewrite.

Gave `DataTable` (`src/components/DataTable/index.tsx`) a `sort` state, a `sortedRows` memo inserted between the existing `filteredRows` and pagination (same search→filter→sort→paginate order as `runPopulationQuery`, so the two engines can't drift), and a per-column `.dt-sort-btn` header control (grip → label → sort → filter, matching Browse's own action ordering) styled as a peer of the existing `.dt-filter-btn` in `DataTable.css` (same box/transition/token set: `--r-xs`, `--c-ink-4`, `--c-sky`/`--c-sky-light` active state — matched to this file's *actual* `.dt-filter-btn` tokens, which differ slightly from the plan's guessed `--c-border`/`--c-surface`). Added `sortable?: boolean` and `sortAccessor?: (row) => string` to `DataTableCol`, and `canSortColumns?: boolean` / `initialSort?: TableSort` to `DataTableProps` — both opt-outs default to sorting on. `handleExport`'s two `filteredRows` references became `sortedRows` so the exported XLSX matches what's on screen; `onFilteredRowsChange` deliberately keeps emitting `filteredRows` (its documented "visible after search+filter" contract; membership is identical either way, and its five consumers treat the emission as a set). Bumped `headerMinWidth`/`estimateColumnFr`'s constants (+48px / +62px) so the new 20px control doesn't squeeze Arabic headers into wrapping. Added three label keys (`dt_sort_button_prefix`, `dt_sort_asc`, `dt_sort_desc`) to `labelsStore.ts`, mirroring the Arabic strings `BrowseDataView.tsx` already hard-codes for the same purpose. Added an 8-test "DataTable — column sorting" block to `index.test.tsx` (button presence/absence per opt-out, caller-order-until-sorted, numeric-not-lexicographic, full asc→desc→none cycle, sort+filter composition, accessible-name direction announcement) and updated the file's stale header comment (previously "DataTable has NO row-sort UI").

**Necessary addition beyond the plan's own file list — `XrayInspectionResults.tsx`:** adding `sortAccessor?: (row: TRow) => string` to the generic `DataTableCol<TRow>` broke `npm run typecheck` in one place the plan didn't anticipate. `XrayInspectionResults.tsx` builds `DataTableCol<ResultRow>[]` by spreading `DataTableCol<DistributionEntry>[]` columns (`sampleColumns`, from `buildSampleColumns`) and overriding only `accessor`; TypeScript correctly refused to carry a `sortAccessor` typed `(row: DistributionEntry) => string` into a slot typed `(row: ResultRow) => string`. `buildSampleColumns` never actually sets `sortAccessor` (verified by reading the whole function — every column definition omits it, so the value is always `undefined` at runtime), so the fix explicitly drops the property during the remap (`const { sortAccessor, ...rest } = column; void sortAccessor;`) rather than spreading a value the type system can't verify is safe for the destination row type. Those columns now sort by `accessor`'s value, same as every other column with no dedicated `sortAccessor` — no behavior change, whole-repo `typecheck` and this file's own test suite (7/7) both green after the fix.

**Gates run for this tier-3 task:** `test:run` (scoped, see Task 9 note below), `typecheck` (whole-repo, clean), `lint` (scoped, clean), `check:complexity` (clean, no output), `check:hex-literals` (clean — `DataTable.css` unchanged at 3/3, `Population.css` unchanged at 16/16 baseline).

**File:** `src/utils/tableSort.ts (new)`

**File:** `src/utils/tableSort.test.ts (new)`

**File:** `src/data/population/populationQuery.ts`

**File:** `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`

**File:** `src/components/DataTable/index.tsx`

**File:** `src/components/DataTable/DataTable.css`

**File:** `src/components/DataTable/index.test.tsx`

**File:** `src/data/labels/labelsStore.ts`

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx` (necessary type fix-up, not in the plan's original file list)

**Lines:** 9 files; `tableSort.ts` +80, `tableSort.test.ts` +74, `populationQuery.ts` net -56 lines (two functions removed, one import+alias added), `BrowseDataView.tsx` +14/-net (cycleSort removed, import added), `DataTable/index.tsx` +87, `DataTable/DataTable.css` +36, `DataTable/index.test.tsx` +112, `labelsStore.ts` +3, `XrayInspectionResults.tsx` +19/-net

---

## Task 4 — Change (reports): render the reviewer KPI table through the shared DataTable

**Why:** Of the plan's three original migration candidates, two turned out to have no browsable data table at all — `KpiDashboard.tsx`'s `.kpi-sr-only` table and `PermissionSections.tsx`'s two `.um-*-table`s are a chart's screen-reader alternative and two permission matrices (role × tab → interactive control), respectively; neither has a meaningful string value per cell for `DataTable`'s `accessor` contract to drive. `ReviewerKpiPanel.tsx`'s line-66 `.rk-table` was the one genuine seven-column reviewer data table (assigned, completed, completion rate, median turnaround, suspicion rate, control status) — the only real migration target, and only worth doing once Task 3 gave `DataTable` something to gain on sort.

**What changed:** Replaced `ReviewerKpiPanel.tsx`'s hand-rolled `.rk-table-wrap`/`<table>` block with a `DataTable`, `canConfigureColumns={false}` (seven fixed KPI columns are the panel's designed content, not a browsable set — no `exportFileName` either, since this data already ships through the executive report builders and a second XLSX egress point for the same numbers would be a divergence waiting to happen), `density="compact"`. Column `accessor`s return the **raw comparable value** (`String(row.completed)`, not `nf(row.completed)`'s locale-formatted string) so numeric sort works correctly — `nf`/`pf`/`hf` still do the display formatting inside `renderCell`. Null numerics map to `accessor` `""` (kept out of the numeric sort/filter branch by `compareTableValues`'s blank-string guard) while `renderCell` still shows `"—"`. The status column is `sortable: false` (a pill's alphabetical order isn't meaningful) but keeps `filterKind: "multiselect"`. The completion-rate progress bar and the الحالة status pill stay as custom `renderCell` JSX, not flattened into their accessor strings. Line 137's `.rk-sr-only` chart-alternative table — the one CLAUDE.md's "native responsive SVG plus a semantic screen-reader table" note refers to — was deliberately left untouched as a plain semantic `<table>`; a regression test now pins that it does NOT acquire `dt-table`/DataTable classes. Retired the now-dead `.rk-table*` CSS rules in `ReviewerKpiPanel.css` (kept `.rk-sr-only`, `.rk-cell-name`, `.rk-num`, `.rk-progress*`, `.rk-status*` — all still applied by the new `renderCell`); also dropped `.rk-cell-completion` (a `min-width` rule that only ever applied to the old hand-rolled `<td>` and has no equivalent slot in the new markup — DataTable owns its own column-width system).

**Deviation from the plan's test draft:** the plan's Step 2 said to extend the *existing* `makeModel()` helper to three rows for the new sort/filter tests. Doing that as written would have broken all four pre-existing tests, which pass a *constant*-returning `resolveName={() => "اسم المراجع"}` and assert `screen.getByRole("cell", { name: "اسم المراجع" })` — with three rows sharing that identical name, `getByRole` throws on an ambiguous match instead of resolving. Added a separate `makeMultiReviewerModel()` (three distinguishable rows, `completed` of 8/3/12 and `turnaroundMedianHours` of 2/9/5 as the plan specified) used only by the five new DataTable-migration tests, and left `makeModel()`/the four pre-existing tests completely untouched. Also added a `ResizeObserver` stub (`beforeEach`/`afterEach`, matching `DataTable/index.test.tsx`'s own convention) since the reviewer table now renders through DataTable's virtualizer, which jsdom has no native support for.

**File:** `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.tsx`

**File:** `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.css`

**File:** `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx`

**Lines:** 3 files, +173 (test) / +100/-net (tsx, net growth despite the table block shrinking, from the new columns array + renderCell switch) / -46 net (css, dead rules removed)

---

## Task 5 — Docs: correct CLAUDE.md's DataTable description and record the two tables deliberately left off it

**Why:** CLAUDE.md's `DataTable` row claimed "filterable/sortable" before Task 3 made that true, and before this task nothing recorded *why* `KpiDashboard.tsx` and `PermissionSections.tsx`'s tables were deliberately not migrated — without a pointer, the next reader re-derives Finding F2 from scratch.

**What changed:** Replaced CLAUDE.md's `DataTable` row with a description of what "sortable" actually means now (opt-out via `sortable: false` / `canSortColumns={false}`, transient per-mount, never persisted through `ColConfig`) and a pointer to `src/utils/tableSort.ts` as the primitives shared with Population Browse. Added a one-comment pointer above `KpiDashboard.tsx`'s `.kpi-sr-only` table (screen-reader chart alternative, not a browsable table, same pattern as `ReviewerKpiPanel`'s `.rk-sr-only`) and above both of `PermissionSections.tsx`'s `.um-perm-table`/`.um-feat-table` (permission matrices — every cell is an interactive control, no meaningful `accessor` string value).

**File:** `CLAUDE.md`

**File:** `src/components/Sidebar/Tabs/Reports/KpiDashboard.tsx`

**File:** `src/components/Sidebar/Tabs/UserManagement/PermissionSections.tsx`

**Lines:** 3 files, +15 / -1

---

## Task 9 (partial) — scoped gate results

Per this shared worktree's protocol (five other plans already landed in this same tree before
this session started; `package.json` and today's `docs/edit logs/2026-08-24.md` are left
untouched for a separate consolidation pass), gates were run scoped to every file this plan
touched or added, after all 5 tasks' code and tests were written:

- `npx vitest run` across `src/utils/tableSort.test.ts`, `src/data/population/populationQuery.test.ts`,
  `src/components/Sidebar/Tabs/Population/` (55 files), `src/components/DataTable/` (5 files),
  `src/components/Sidebar/Tabs/Reports/ReviewerKpiPanel.test.tsx`,
  `src/components/Sidebar/Tabs/EmployeeWorkspace/` (28 files), `src/components/Sidebar/Tabs/UserManagement/`,
  `src/workers/populationQueryWorker.test.ts`, `src/data/labels/` — **107 test files, 831 tests, all
  passed.**
- `npm run typecheck` (whole-repo `tsc -b`, run anyway since it's fast and project-wide by nature) —
  **clean** after the `XrayInspectionResults.tsx` fix documented under Task 3.
- `npx eslint <every file this plan touched, 14 files>` — **clean** after one fix (below).
- `npm run check:complexity` (whole-repo, Task 3's tier-3 requirement) — **clean**, no output.
- `npm run check:hex-literals` (whole-repo, Task 3's tier-3 requirement) — **clean**; `DataTable.css`
  and `Population.css` both unchanged at their existing baselines (3/3 and 16/16).

**One real lint failure found and fixed during this pass:** the first cut of the
`XrayInspectionResults.tsx` type fix-up destructured `sortAccessor` into a variable named
`_sortAccessor` expecting the repo's `argsIgnorePattern: '^_'` ESLint rule to exempt it — but that
rule only covers *function arguments*, not destructured object variables, so it still fired
`@typescript-eslint/no-unused-vars`. Fixed by keeping the plain name and adding `void sortAccessor;`
immediately after the destructure, which the rule recognizes as a real usage. Re-ran the scoped
lint + typecheck + this file's own test suite after the fix; all green.

**Not run from this session, left to the consolidation pass:** `npm run build`,
`npm run check:bundle-size`, `npm run check:release`, `npm run check:vendor`, whole-repo
`npm run test:run`. None of this plan's changes are expected to move the bundle-size or vendor
checks (no new dependency; `tableSort.ts` is a small, dependency-free module and the DataTable
sort UI is a handful of CSS rules and one header button); `check:release` depends on
`package.json` being synced to whichever version these entries land at during consolidation.

**One pre-existing, out-of-scope failure observed and NOT touched:** `src/components/Sidebar/Tabs/Reports/index.test.tsx`
and `Reports.landingSubTab.test.tsx` both fail with `Error: Denied ID
.../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?inline`
— a Vite module-resolution/font-loading error, reproducible with the sandbox both on and off, and
entirely unrelated to sort/filter/DataTable (the only import of that font package anywhere in `src/`
is `src/branding/fonts.ts`, which neither file references directly; the two failing files also
don't reference `DataTable`, `ReviewerKpiPanel`, or `KpiDashboard` by name). Confirmed pre-existing
and out of this plan's scope — left for whoever owns that area.

---
