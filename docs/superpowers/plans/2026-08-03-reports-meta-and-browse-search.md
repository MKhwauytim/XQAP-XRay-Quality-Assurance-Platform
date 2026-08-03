# Reports Lightweight Meta + Browse Search Performance (§L Reports part, §P steps 1-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent landing-cost/keystroke-latency fixes from the design spec's Part 3. (1) `Reports/index.tsx`'s "lightweight" month-meta effect currently loads the FULL `population.final.json` (up to ~400k rows) plus every employee's full answer file just to populate three small header chips (population/sample/studied counts) — and it does this unconditionally on every month/workspace change, regardless of which section (`reports` vs `kpi`) is open. (2) `BrowseDataView`'s search re-filters up to 400k rows on every keystroke with no debounce, and re-normalizes (`.trim().toLowerCase()`) the search term inside the per-row callback instead of once.

**Architecture:** Task 1 replaces the population/employee-files reads with data already available cheaply (the month manifest's `totalProcessedRows`, and the KPI dashboard's already-built report model) — no new modules. Task 2 copies `DataTable/index.tsx`'s already-working debounced-search pattern verbatim into `BrowseDataView.tsx` rather than inventing a new one.

**Tech Stack:** React 19 hooks (`useState`, `useRef`, `useEffect`, `useMemo`), Vitest + `@testing-library/react`.

## Global Constraints

- Every edit needs a `docs/edit logs/YYYY-MM-DD.md` entry (today's file) per CLAUDE.md: version bump, category prefix, Before/After snippets, `**Lines:**` stat.
- Pathspec-scoped git commits only (`git add <files>` then `git commit -m "..." -- <same files>`) — never a bare `git commit`; this repo routinely has unrelated pre-existing uncommitted work in the tree from other sessions (in particular, `src/components/Sidebar/Tabs/Population/populationWorkflowHelpers.ts` currently has substantial unrelated in-progress work from a different session implementing the same "Large-Population Performance Proposal Phase A" this plan's Task 1 builds on — do NOT touch that file; Task 1 only touches `Reports/index.tsx`).
- Repo-level gates: `npm run test:run`, `npm run typecheck`, `npm run lint` after every task.
- **Task 1's studied-count trade-off is a deliberate, already-made decision, not open for re-litigation:** the "studied" chip shows "—" until the KPI dashboard (`section === "kpi"`) has been opened at least once this session, rather than doing an always-on background read or redefining the metric. This was the explicitly recommended choice in the design spec (over the alternatives) — implement it as specified.
- **Both tasks are independent — no shared files.** They may be implemented in parallel by separate subagents; if so, neither should touch `docs/edit logs/2026-08-03.md` or `package.json` (the controller applies edit-log entries and the version bump afterward to avoid a lost-update race on those shared files).

---

### Task 1: Reports' month-meta effect stops loading the full population

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx`

**Interfaces:**
- Consumes: `loadMonthManifest` from `src/data/population/populationStorage.ts` (already exported, already used elsewhere in this codebase's Phase-A work — confirm the exact import path this file already uses for its other `populationStorage` imports and match it). `MonthManifestData`'s `totalProcessedRows: number` field (already used the same way in `src/data/backup/backupStorage.ts`'s `populationStageReached`/`loadArchiveStatus` — read that file's usage around line 1020-1050 as a reference for the field's reliability, but do NOT modify `backupStorage.ts`, just use the same field). The existing `ReportModel` type's `sample.studied: number` field (`src/data/reporting/executive/model/reportModel.ts:55`, populated from `kpis.studiedImages` at `reportModel.ts:252`).
- No exported interface changes to this file.

**Background:** The current effect (search for `"// Load lightweight meta for the month bar chips"` in this file) calls `loadMonthPopulationFinal` (the full population read) and, when a sample exists, `loadAllEmployeeFiles` (every employee's full answer file) — every time `directoryHandle`/`selectedMonth` changes, regardless of which section is open. This hits every guest/supervisor/manager/admin session on landing. Fix in two tiers: Tier 1 replaces the population read with a cheap manifest read (`totalProcessedRows`, already tracked on every population save); Tier 2 removes the `loadAllEmployeeFiles` call entirely, sourcing `studiedCount` from the KPI dashboard's already-built model instead (which only builds when `section === "kpi"`, matching the correct "don't pay for it until it's actually needed" pattern this codebase already uses elsewhere).

- [ ] **Step 1: Locate the current exact code**

Run: `grep -n "Load lightweight meta\|loadMonthPopulationFinal\|loadAllEmployeeFiles\|monthMeta\|MonthMeta" src/components/Sidebar/Tabs/Reports/index.tsx`

Confirm the effect's current shape matches what's described below (line numbers may have shifted slightly since this plan was written — use the grep output to find the real current lines, don't guess from this plan's line numbers). Also confirm whether `loadMonthPopulationFinal` is used anywhere ELSE in this file (e.g. inside `loadExecInput`) — if so, leave those other call sites completely untouched; this task only changes the ONE call site inside the month-meta effect.

- [ ] **Step 2: Write a failing test for the new behavior**

Find or create a test file for this component (check for an existing `Reports/index.test.tsx` first — this repo already has one with extensive `vi.mock` scaffolding; read it in full before adding to it, per the established convention for this large file). Add a test using the file's existing mock conventions (mock `useWorkspace`, a memory directory, etc. — mirror an existing test in the same file rather than inventing new scaffolding) asserting: (a) landing on the Reports tab with a processed month calls `loadMonthManifest` (or whatever the chosen lightweight read is) but does NOT call `loadMonthPopulationFinal` or `loadAllEmployeeFiles` for the meta effect; (b) the population count chip still shows a real number (sourced from the manifest's `totalProcessedRows`); (c) the studied count chip shows "—" (null) until `section` becomes `"kpi"` and the model has built, at which point it reflects `model.sample.studied`.

- [ ] **Step 3: Run the test to verify it fails**

Run the new/updated test file. Expected: FAIL — the current code still calls `loadMonthPopulationFinal`/`loadAllEmployeeFiles` unconditionally.

- [ ] **Step 4: Implement Tier 1 (manifest instead of full population) and Tier 2 (studied count from the KPI model)**

Replace the month-meta effect's body. The exact shape (adapt to the real current line numbers found in Step 1):

```tsx
  // Load lightweight meta for the month bar chips (§L Tier 1/2: manifest
  // instead of the full population, no employee-files read at all --
  // studiedCount is sourced from the KPI model below once it's built,
  // matching the pattern that model already uses to defer its own cost).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync null-clear when workspace or month is deselected; synchronizes with external workspace state
    if (!directoryHandle || !selectedMonth) { setMonthMeta(null); return; }
    let cancelled = false;
    setMonthMeta(null);
    void (async () => {
      try {
        const [manifest, sample] = await Promise.all([
          loadMonthManifest(directoryHandle, selectedMonth),
          loadSampleMaster(directoryHandle, selectedMonth),
        ]);
        if (cancelled) return;
        setMonthMeta({
          folderName: selectedMonth,
          populationCount: manifest?.totalProcessedRows ?? null,
          sampleCount: sample ? sample.rows.length : null,
          studiedCount: null,
        });
      } catch {
        if (!cancelled) {
          setMonthMeta({ folderName: selectedMonth, populationCount: null, sampleCount: null, studiedCount: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [directoryHandle, selectedMonth]);
```

Add the `loadMonthManifest` import from wherever this file already imports `loadSampleMaster`/other `populationStorage`/`sampleStorage` functions (match the existing import grouping style in this file rather than adding a new import statement block).

Remove the now-unused `loadAllEmployeeFiles`/`loadMonthPopulationFinal` imports from this file ONLY IF Step 1 confirmed they're not used elsewhere in the file — if `loadMonthPopulationFinal` is still used by `loadExecInput` or another function, keep that import, only remove `loadAllEmployeeFiles` if it becomes genuinely unused (check `lint`'s unused-import rule will catch this either way — trust it as the final check).

Then wire `studiedCount` from the KPI model. Find the existing `useEffect` that builds `model` (search for `"Build the live analytics model ONCE per month"` or `setModel(buildReportModel(...))`), and update `monthMeta`'s `studiedCount` once the model successfully builds — add this INSIDE that same model-building effect (not a new effect), right after the `setModel(...)` call on success:

```tsx
        const builtModel = buildReportModel(execInput, buildDisplayNameMap());
        setModel(builtModel);
        // §L Tier 2: backfill the studied-count chip from the model we just
        // built instead of a separate loadAllEmployeeFiles read -- only
        // available once the KPI dashboard has actually been opened.
        setMonthMeta((current) =>
          current && current.folderName === selectedMonth
            ? { ...current, studiedCount: builtModel.sample.studied }
            : current
        );
```

(Verify the exact current success-path code inside that effect via Step 1's investigation before editing — the brief above shows the target shape, not necessarily character-for-character what's currently there; `builtModel` may need to be a new local variable if the current code calls `setModel(buildReportModel(...))` inline without capturing the result first.)

- [ ] **Step 5: Run the test to verify it passes**

Run the test file again. Expected: PASS.

- [ ] **Step 6: Run the full Reports test suite, typecheck, lint**

Run: `npx vitest run src/components/Sidebar/Tabs/Reports`
Expected: PASS, including every pre-existing test in the file (none of them should have depended on the meta effect loading full population/employee data — if one does, that's a real pre-existing coupling to investigate, not paper over).

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Edit log + version bump + commit**

If implemented as part of a parallel batch with Task 2, skip this step (controller handles it) and instead write the edit-log material (category `Fix:`, one-line description, before/after snippets) into your report file. If implemented standalone, do it directly:

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (reports): stop loading the full population + all employee files for the month-meta chips (§L)" -- src/components/Sidebar/Tabs/Reports/index.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 2: BrowseDataView search — debounce + hoist normalization

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`

**Interfaces:**
- No new exports. `rowMatchesSearch`'s signature changes from accepting a raw search string (which it normalized internally) to accepting an already-normalized search string — this is a module-private function; confirm via `grep -n "rowMatchesSearch" src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` that its only call site is the one this task changes before editing its signature.

**Background:** `BrowseDataView.tsx`'s search input re-filters the full (up to ~400k row) dataset on every keystroke with no debounce, and `rowMatchesSearch` (module-level, called once per row from a `.filter()`) recomputes `search.trim().toLowerCase()` on every single row on every keystroke. `DataTable/index.tsx` (a sibling component) already solves both problems: an immediate `globalSearch` state for the visible input value, a `debouncedSearch` state (200ms debounce via a `setTimeout`/`useRef` pattern) that's ALREADY normalized at the moment it's set, and filtering reads only `debouncedSearch`. Mirror that exact pattern here — do not invent a different debounce mechanism.

- [ ] **Step 1: Locate the current exact code and confirm the single call site**

Run: `grep -n "rowMatchesSearch\|const \[search\|setSearch\|searchFilteredRows" src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`

Confirm `rowMatchesSearch` has exactly one call site (inside the `searchFilteredRows` `useMemo`) before changing its signature. Also read `src/components/DataTable/index.tsx`'s existing debounce implementation once more directly (search for `debouncedSearch`/`searchDebounceRef`) as the reference pattern to mirror exactly — same 200ms delay, same `useRef`-held timer, same clear-on-cleanup shape.

- [ ] **Step 2: Write failing tests for the new behavior**

Find or create a test file for `BrowseDataView` (check for an existing one first). Add tests asserting: (a) typing in the search box does NOT immediately re-filter — the visible row count stays unchanged until ~200ms after the last keystroke (use fake timers, e.g. `vi.useFakeTimers()` + `vi.advanceTimersByTime(200)`, matching whatever timer-faking convention this codebase already uses elsewhere — check an existing debounce test if one exists for `DataTable` itself, and mirror its exact setup); (b) after the debounce fires, rows are correctly filtered by the search term, case-insensitively, with leading/trailing whitespace trimmed (same behavior as before, just later); (c) clearing all filters (`clearAllTableFilters`) resets both the immediate and debounced search state, and cancels any pending debounce timer.

- [ ] **Step 3: Run the tests to verify they fail**

Expected: FAIL against the current unconditional-per-keystroke-filter code.

- [ ] **Step 4: Implement the debounce + normalization hoist**

Add state and a ref near the existing `const [search, setSearch] = useState("");` (confirm exact current line via Step 1):

```tsx
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Change `rowMatchesSearch` to accept an already-normalized term (remove its internal `.trim().toLowerCase()` call):

```tsx
function rowMatchesSearch(
  row: BrowseRow,
  normalizedSearch: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  if (!normalizedSearch) {
    return true;
  }
  return Object.keys(row).some((key) =>
    getBrowseDisplayValue(row, key, stageMappings).toLowerCase().includes(normalizedSearch)
  );
}
```

Change the `searchFilteredRows` `useMemo` to filter on `debouncedSearch` instead of `search`:

```tsx
  const searchFilteredRows = useMemo(
    () => debouncedSearch
      ? monthFilteredRows.filter((row) => rowMatchesSearch(row, debouncedSearch, config.stageMappings))
      : monthFilteredRows,
    [monthFilteredRows, debouncedSearch, config.stageMappings]
  );
```

Change the search input's `onChange` handler to update `search` immediately (so the input stays responsive) and debounce `debouncedSearch`:

```tsx
            <input
              type="text"
              className="bv-search"
              placeholder="بحث في جميع الأعمدة..."
              value={search}
              onChange={(e) => {
                const v = e.target.value;
                setSearch(v);
                setPageState({ rowsKey: rowsPageKey, page: 1 });
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                searchDebounceRef.current = setTimeout(
                  () => setDebouncedSearch(v.trim().toLowerCase()),
                  200
                );
              }}
            />
```

Update `clearAllTableFilters` to also clear `debouncedSearch` and cancel any pending timer:

```tsx
  function clearAllTableFilters(): void {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearch("");
    setDebouncedSearch("");
    setColumnFilters({});
    setOpenFilterColumn(null);
    setPageState({ rowsKey: rowsPageKey, page: 1 });
  }
```

Check whether `useRef` is already imported in this file (it very likely is, given the file's size) — add it to the existing `react` import if not.

Also check the row-count display text (`{(search || activeFilterCount > 0) && ...}`, near the search input) — decide whether it should key off `search` (immediate, so the "filtered from N" hint appears the instant the user starts typing) or `debouncedSearch` (only appears once filtering actually happened). Keep it keyed on `search` (the immediate value) — this is a text hint, not the actual filtered count, and it reading slightly ahead of the debounce is not a correctness issue, just matches user intent faster.

- [ ] **Step 5: Run the tests to verify they pass**

Expected: PASS.

- [ ] **Step 6: Run the full Population/BrowseDataView test suite, typecheck, lint**

Run: `npx vitest run src/components/Sidebar/Tabs/Population`
Expected: PASS, including every pre-existing test.

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Edit log + version bump + commit**

If implemented as part of a parallel batch with Task 1, skip this step (controller handles it) and instead write the edit-log material (category `Fix:`, one-line description, before/after snippets) into your report file. If implemented standalone:

```bash
git add src/components/Sidebar/Tabs/Population/BrowseDataView.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (population-browse): debounce search + hoist string normalization out of the per-row loop (§P steps 1-2)" -- src/components/Sidebar/Tabs/Population/BrowseDataView.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

## Explicitly out of scope

- §P step 3 (scoping the search to visible columns only) — the design spec explicitly flags this as a real behavior change needing product/owner sign-off (a row matching only via a hidden column stops matching), not a pure performance fix. Not implemented here.
- §P step 4 (chunked yielding) — contingent bridge-only step, not needed now that steps 1-2 (debounce + normalization hoist) already remove the dominant cost.
- §L's `computeMonthLoadScope`/`needsPopulationForPhase` population-loading-scope work — already implemented by a separate, still-in-progress session (`src/components/Sidebar/Tabs/Population/populationWorkflowHelpers.ts`, currently uncommitted in the working tree, doc-commented as "Large-Population Performance Proposal, Phase A step 3"). Do not duplicate or touch it.
- §L's "close the phase-2→3 race" and "row count without rows" (`PopulationStatusBar` prop change) — likely also covered by that same in-progress session's work; not investigated further here to avoid touching contested files.

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/components/Sidebar/Tabs/Reports/index.tsx` |
| 2 | `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` |
