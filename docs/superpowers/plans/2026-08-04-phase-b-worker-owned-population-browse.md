# Phase B — Worker-Owned Population Browse Implementation Plan [DONE — shipped v59.189–v59.190]

> **STATUS: ✅ DONE.** Shipped v59.189–v59.190 (commits `dfa9e7b1`, `adaff2c5`, `2478d1ed`, `56f52ee4`) — `populationQueryWorker.ts` now owns the parsed population array off the main thread; `BrowseDataView.tsx` consumes it via `usePopulationBrowseWorker.ts` instead of holding the full array in React state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase B of `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` — move Population Browse's `JSON.parse` + search/filter/sort of a large legacy `population.final.json` off the main thread into a dedicated Web Worker, so the main thread only ever receives the visible page (never the full array), and stays interactive during a 200k+/400k+-row query. User-approved 2026-08-04 after reporting live app sluggishness on a 100k+-row workspace.

**Architecture:** A new `populationQueryWorker.ts` owns the parsed legacy array for the lifetime of an active Browse query session. The main thread sends query messages (search/filter/sort/page) and receives only the resulting page + metadata. Search/filter/sort logic is factored into plain, worker-agnostic pure functions first (parity-preserving for search/filter, new for sort), then wired into the worker's message dispatcher. A new hook (`usePopulationBrowseWorker.ts`) owns worker spawn/lifecycle/postMessage plumbing and staleness guarding, following this codebase's existing "latest request wins" token-ref idiom (5 existing precedents, most directly `useMonthLoad.ts`'s `loadMonthTokenRef`) rather than `AbortController` (zero precedent in this codebase). `BrowseDataView.tsx` is refactored to consume the hook instead of holding the full array in React state.

**Tech Stack:** Native Web Worker via Vite's `?worker&inline` import suffix (matches the codebase's one existing worker, `workbookWorker.ts` — critically, `&inline` embeds the worker as a base64 data URL so it does NOT break the single-file `dist/index.html` build guarantee; a plain `?worker` import would emit a separate chunk file and must never be used here). No new dependencies.

## Global Constraints

- **Single-file build guarantee is non-negotiable.** `vite-plugin-singlefile` inlines everything into one `dist/index.html` (CLAUDE.md: "`dist/` is intentionally just the single self-contained `index.html` — no other files"). The worker MUST be imported with the exact suffix `?worker&inline` (matching `Population/index.tsx:54`'s existing `import WorkbookWorker from "../../../../workers/workbookWorker?worker&inline";`). After any task that adds/changes a worker import, run `npm run build` and confirm `dist/` contains only `index.html` (`ls dist/` — exactly one file) before considering that task done.
- **No `AbortController` anywhere in this plan.** This codebase has zero precedent for it. Use the established numeric-counter-ref "latest request wins" idiom instead — increment a ref before dispatching a query, compare it when the response arrives, discard silently if stale. Copy the exact shape from `src/components/Sidebar/Tabs/Population/useMonthLoad.ts` (`loadMonthTokenRef`, lines ~64-136).
- **Worker never receives a `DirectoryHandleLike`/`FileSystemDirectoryHandle`.** The main thread already holds the workspace directory handle and File System Access permissions — it does the actual file read (`getFile()` + `.text()`, i.e. what `safeReadJson`'s internals already do), then posts the raw JSON **text string** into the worker. The worker does `JSON.parse` + query, and returns only the requested page. This keeps the worker fully decoupled from `DirectoryHandleLike` (which has no real Worker-transferable equivalent, and whose `memoryDirectory.ts` test double is not real-worker-compatible either) and matches this codebase's only existing worker (`workbookWorker.ts`, which likewise only ever receives plain `File`/data, never a directory handle).
- **Message protocol follows `workbookWorkerTypes.ts`'s established shape**, not a new convention: a discriminated union on a `type` field. Actual existing discriminants are `"progress"` / `"done"` / `"error"` (not `"progress"`/`"result"` — verify against the real file, not CLAUDE.md's paraphrase, before writing Task 2). Every request AND response in the new protocol carries a numeric `requestId` field (new — `workbookWorkerTypes.ts` doesn't need one since only one job is ever in flight, but Browse's query worker must correlate out-of-order responses to the token-ref staleness check).
- **Scope is Population Browse's single-month read path ONLY** (`loadBrowseRows` → `loadMonthPopulationFinal`, `BrowseDataView.tsx`). Two things are explicitly OUT of scope for this plan, each because they're either a separate mechanism or a separate, smaller, independently-shippable win:
  1. **The replacement-candidate-lookup fallback** (`src/data/distribution/replacementCandidateLookup.ts`, which also calls `loadMonthPopulationFinal` on its fallback path) is a deliberate, pre-existing exception to this whole proposal's phase sequence (its own file comment says so) and has its own dedicated fast-path (a small pre-built index) that this plan does not touch. A future, separate small task could route its fallback through this plan's new worker, but do not attempt that here.
  2. **`loadAllPopulationRows`/`loadAllSampleRows`/`loadAllRawRows`'s "all months" checkbox** in Browse's toolbar does N *sequential* (non-`mapWithConcurrency`) full-month reads — a real, currently-uncharacterized bottleneck, worse than the single-month case. This plan includes ONE small, independent, low-risk task (Task 5) to parallelize those three functions with `mapWithConcurrency` (already proven in tonight's §O backup/restore work) — a cheap win that doesn't require the worker architecture. It does not route the "all months" path through the new worker; that stays a `safeReadJson`-per-month loop, just a concurrent one.
- **Search must preserve exact current behavior** (parity, not a redesign): `rowMatchesSearch` today scans every own key on the row object via `Object.keys(row).some(...)`, not just visible/active columns (`BrowseDataView.tsx:344-356`). Preserve this exactly when extracting to a pure function — do not narrow to visible columns as part of this plan.
- **Sort is new functionality**, not a relocation of existing behavior. Confirmed via research: no row-level sort exists anywhere in `BrowseDataView.tsx` or the shared `DataTable` component today (their only `.sort()` calls sort UI option/column lists, not row data). Design it fresh; there is no existing behavior to preserve parity with.
- **Test strategy**: pure query functions (Task 1) get direct, worker-agnostic unit tests. Worker plumbing (Task 2's `onmessage` dispatcher, Task 3's hook spawn/postMessage/terminate/token-comparison) is tested via a mocked `WorkerStub` class, following the exact precedent in `src/components/Sidebar/Tabs/Population/Population.wizard.test.tsx:5-25` (`vi.mock("...workbookWorker?worker&inline", () => ({ default: class WorkerStub {...} }))`) — Vitest's node/jsdom environment cannot run a real `DedicatedWorker`, so do not attempt to.
- **`BrowseDataView.tsx` is 913 lines with its own budget independent of `PopulationTab`** (`index.tsx`, 1321 lines, ~298 lines headroom under the 1450-line `max-lines-per-function` CI gate — `PopulationTab` itself is NOT touched by this plan since Browse doesn't route through it). If `BrowseDataView.tsx` or the new hook approaches the 1450-line gate, extract, following the `useMonthLoad.ts`/`useDistributionActions.ts` precedent (small focused hook files) rather than letting one file grow.
- Follow CLAUDE.md's edit-log requirement for every task (version bump, Before/After, `npm run count-lines -- --quiet` before/after, category prefix) — per this session's established pattern, implementers skip `docs/edit logs/2026-08-04.md` and `package.json`; the controller applies one combined entry per task (or a combined entry per parallel batch) afterward.

---

### Task 1: Extract pure query functions (`populationQuery.ts`) — search/filter/paginate parity + new sort

**Files:**
- Create: `src/data/population/populationQuery.ts`
- Create: `src/data/population/populationQuery.test.ts`
- Read (do not modify): `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (source of the current search/filter/pagination logic to extract, lines ~344-356 `rowMatchesSearch`, ~481-528 the `useMemo` chain, plus whatever `rowMatchesColumnFilters`/`getBrowseDisplayValue` do — read the full file first)
- Read (do not modify): `src/components/Pagination/paginationUtils.ts` (existing `DATA_PAGE_SIZE`, `clampPage`, `pageSlice` — reuse these, don't reinvent)

**Interfaces:**
- Produces:
  ```ts
  export type PopulationQuerySort = { column: string; direction: "asc" | "desc" } | null;

  export type PopulationQueryParams = {
    search: string;
    columnFilters: Record<string, string[]>;   // exact shape must match BrowseDataView's current columnFilters state type — check it, don't guess
    sort: PopulationQuerySort;
    page: number;
  };

  export type PopulationQueryResult<T> = {
    pageRows: T[];
    totalRows: number;          // count after search+filter, before pagination
    totalPages: number;
  };

  export function runPopulationQuery<T extends Record<string, unknown>>(
    rows: T[],
    params: PopulationQueryParams,
    displayValueGetter: (row: T, key: string) => string   // reuse BrowseDataView's existing getBrowseDisplayValue shape
  ): PopulationQueryResult<T>;
  ```
  This function must be a straight-line composition of: search-filter (exact port of `rowMatchesSearch`'s all-key scan) → column-filter (exact port of `rowMatchesColumnFilters`) → sort (new — stable sort, `null` sort returns rows in original order) → paginate (reuse `pageSlice`/`clampPage` from `paginationUtils.ts`).
- Consumes: nothing beyond what's passed as parameters — this file has zero React/worker/postMessage dependencies, making it directly unit-testable and later importable from both the main thread (temporarily, if needed for a fallback) and the worker.

- [ ] **Step 1: Read `BrowseDataView.tsx` in full** to get the exact current `rowMatchesSearch`, `rowMatchesColumnFilters`, `getBrowseDisplayValue`, and `columnFilters`'s real type. Do not paraphrase from this plan's excerpts — copy the real logic.

- [ ] **Step 2: Write failing characterization tests first**, covering: search matches on a non-visible/non-first column (proving the all-key-scan is preserved), column-filter behavves identically to today, sort ascending/descending/null on a string column and a numeric column, sort is stable (equal keys preserve relative order), pagination page-size and page-clamping matches `paginationUtils.ts`'s existing behavior, and an empty-rows edge case.

- [ ] **Step 3: Implement `runPopulationQuery`** to pass those tests, porting the real logic from `BrowseDataView.tsx` verbatim for search/filter (do not "improve" it — parity is the requirement) and writing sort fresh.

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `npx vitest run src/data/population/populationQuery.test.ts && npm run typecheck && npm run lint:ci`
Expected: all clean.

- [ ] **Step 5: Commit**
```bash
git add src/data/population/populationQuery.ts src/data/population/populationQuery.test.ts
git commit -m "Add (population): pure query engine (search/filter/sort/paginate) for worker-owned Browse"
```

---

### Task 2: Worker protocol types + worker entry (`populationQueryWorker.ts`)

**Files:**
- Create: `src/workers/populationQueryWorkerTypes.ts`
- Create: `src/workers/populationQueryWorker.ts`
- Read (do not modify): `src/workers/workbookWorker.ts` and `src/workers/workbookWorkerTypes.ts` (the pattern to follow — read both in full first, confirm the real `type` discriminant values, `"progress"`/`"done"`/`"error"`, before writing anything)

**Interfaces:**
- Consumes: `runPopulationQuery` and its types from Task 1's `src/data/population/populationQuery.ts`.
- Produces:
  ```ts
  // populationQueryWorkerTypes.ts
  export type PopulationQueryWorkerRequest =
    | { type: "load"; requestId: number; rawJsonText: string }   // worker parses + caches the array
    | { type: "query"; requestId: number; params: PopulationQueryParams };  // requires a prior "load"

  export type PopulationQueryWorkerResponse =
    | { type: "loaded"; requestId: number; totalRows: number }
    | { type: "result"; requestId: number; result: PopulationQueryResult<Record<string, unknown>> }
    | { type: "error"; requestId: number; error: string };
  ```
  (Adjust exact field names/shape if Task 1's real types differ from this plan's sketch — Task 1's actual exported types are the source of truth, not this excerpt.)

- [ ] **Step 1: Read `workbookWorker.ts`/`workbookWorkerTypes.ts` in full**, confirm the exact message-handling shape (`ctx.onmessage`, `send()` helper, try/catch-the-whole-job pattern) to mirror.

- [ ] **Step 2: Write `populationQueryWorkerTypes.ts`** with the request/response discriminated unions above (refined against Task 1's real exported types).

- [ ] **Step 3: Write `populationQueryWorker.ts`**: a single `onmessage` handler that — on `"load"` — `JSON.parse`s `rawJsonText` once, extracts the `.data.rows` array (match whatever `PopulationFinalData`'s envelope shape actually is — check `populationStorage.ts`'s `PopulationFinalData` type), stores it in a module-level variable, replies `{type:"loaded", requestId, totalRows}`; on `"query"` — calls `runPopulationQuery(cachedRows, params, ...)` and replies `{type:"result", requestId, result}`; wraps the whole handler body in try/catch replying `{type:"error", requestId, error}` on any failure (including "query received before load").

- [ ] **Step 4: Unit-test the worker's exported pure logic**, NOT the worker via a real `postMessage` round-trip (Vitest cannot run a real Worker — per this plan's Global Constraints, extract the `onmessage` body into a plain exported function `handleWorkerMessage(state, request): response` that the actual `self.onmessage` assignment just calls, so this function is directly unit-testable without any worker environment). Write `populationQueryWorker.test.ts` covering: load-then-query happy path, query-before-load error, malformed JSON error, two sequential loads (second replaces first).

- [ ] **Step 5: Run tests, typecheck, lint.**
Run: `npx vitest run src/workers/ && npm run typecheck && npm run lint:ci`

- [ ] **Step 6: Commit**
```bash
git add src/workers/populationQueryWorkerTypes.ts src/workers/populationQueryWorker.ts src/workers/populationQueryWorker.test.ts
git commit -m "Add (workers): populationQueryWorker — parses + queries population.final.json off the main thread"
```

---

### Task 3: `usePopulationBrowseWorker.ts` hook — spawn/lifecycle/postMessage/staleness guard

**Files:**
- Create: `src/components/Sidebar/Tabs/Population/usePopulationBrowseWorker.ts`
- Create: `src/components/Sidebar/Tabs/Population/usePopulationBrowseWorker.test.ts`
- Read (do not modify): `src/components/Sidebar/Tabs/Population/useMonthLoad.ts` (the token-ref "latest request wins" idiom to copy exactly, lines ~64-136) and `Population.wizard.test.tsx:5-25` (the `WorkerStub` mock pattern to copy exactly) and `Population/index.tsx:369-374,685-739` (the existing ad hoc spawn/postMessage/cleanup shape for `WorkbookWorker` — same pattern, applied to a persistent-rather-than-per-job worker lifecycle)

**Interfaces:**
- Consumes: `PopulationQueryWorkerRequest`/`PopulationQueryWorkerResponse` from Task 2.
- Produces:
  ```ts
  export type UsePopulationBrowseWorkerResult = {
    loadRawJson: (rawJsonText: string) => void;   // fire a "load" request
    runQuery: (params: PopulationQueryParams) => Promise<PopulationQueryResult<Record<string, unknown>> | null>;  // null = superseded by a newer call
    isLoaded: boolean;
    isQuerying: boolean;
    error: string | null;
  };

  export function usePopulationBrowseWorker(): UsePopulationBrowseWorkerResult;
  ```
  Internally: spawns `new PopulationQueryWorker()` (imported via `?worker&inline`) once per hook-instance mount (`useEffect` with `[]` deps, `terminate()` on cleanup — mirrors `Population/index.tsx:369-374`'s exact pattern for `WorkbookWorker`), maintains a `requestIdRef` counter incremented on every `loadRawJson`/`runQuery` call, and on each `"result"`/`"error"`/`"loaded"` message compares `response.requestId` against the CURRENT value of the ref before resolving/updating state — discarding (not throwing) if stale, per this plan's Global Constraints.

- [ ] **Step 1: Read the 3 precedent files** listed above in full.

- [ ] **Step 2: Write failing tests first** using the `WorkerStub` mock pattern: hook spawns the worker on mount and terminates on unmount; `loadRawJson` posts a `"load"` message and `isLoaded` becomes true only after a matching `"loaded"` response; `runQuery` resolves with the query result on a matching `"result"` response; **a `runQuery` call issued while an earlier one is still pending, followed by the earlier one's response arriving late, must resolve the earlier call's promise with `null` (superseded), never overwrite `isQuerying`/state meant for the later call** (this is the core staleness-guard behavior — write it as an explicit test, not an incidental one); an `"error"` response sets `error` and does not crash.

- [ ] **Step 3: Implement `usePopulationBrowseWorker`** to pass those tests.

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `npx vitest run src/components/Sidebar/Tabs/Population/usePopulationBrowseWorker.test.ts && npm run typecheck && npm run lint:ci`

- [ ] **Step 5: Commit**
```bash
git add src/components/Sidebar/Tabs/Population/usePopulationBrowseWorker.ts src/components/Sidebar/Tabs/Population/usePopulationBrowseWorker.test.ts
git commit -m "Add (population): usePopulationBrowseWorker hook — worker lifecycle + latest-request-wins staleness guard"
```

---

### Task 4: Integrate into `BrowseDataView.tsx` (highest-risk task — do last, after Tasks 1-3 land)

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (913 lines — the `rows` state, the load `useEffect` at ~451-479, and the `useMemo` chain at ~481-528 are replaced by calls into Task 3's hook; the existing search-input debounce, column-filter UI, and pagination UI controls stay, just re-wired to trigger `runQuery` instead of recomputing local `useMemo`s)
- Modify/Read: `src/components/Sidebar/Tabs/Population/BrowseDataView.test.tsx` (or wherever its existing tests live — find via `git ls-files` — this task WILL need test updates since Browse's data flow becomes async)

**Interfaces:**
- Consumes: `usePopulationBrowseWorker` from Task 3.
- Note the population-family data kinds Browse supports beyond `"population"` (sample/raw/etc, per `loadBrowseRows`'s dataset parameter) — confirm from `populationStorage.ts` whether this plan's worker-backed path applies to ALL of them or only the `"population"` kind specifically (the proposal's stated concern is the 200k+-row processed population; smaller datasets may not need worker-offloading at all). Scope this integration to the `"population"` dataset kind only unless another kind is comparably large — check row-count expectations for `sample`/`riskRaw`/`biRaw` in `populationTypes.ts`/`populationStorage.ts` before deciding, and document the decision in this task's commit message.

- [ ] **Step 1: Read the full current `BrowseDataView.tsx`** plus its existing test file, cataloguing every test that currently asserts on synchronous `rows`/`filteredRows`/`pagedRows` state, since those assertions will need `await waitFor(...)`-style conversion once the query becomes worker-async (same test-migration risk category as tonight's earlier `React.lazy` work in a separate plan — the pattern is well-established this session: fix the assertion style, don't work around the async boundary).

- [ ] **Step 2: Replace the load effect.** Where the effect currently calls `loadBrowseRows` and sets `rows` state directly, instead: read the raw file text (reuse whatever `safeReadJson`/`loadMonthPopulationFinal` internally does to get text, OR add a small new `loadMonthPopulationFinalRawText`-style export to `populationStorage.ts` if no such raw-text accessor exists yet — check first) and call the hook's `loadRawJson(rawText)`.

- [ ] **Step 3: Replace the `useMemo` filter/search/sort/paginate chain** with calls to the hook's `runQuery({ search: debouncedSearch, columnFilters, sort, page })`, storing the returned `PopulationQueryResult` in local state, guarding against the `null` (superseded) return per Task 3's contract.

- [ ] **Step 4: Wire up the new sort feature** in the column-header UI (click-to-sort) — this is genuinely new UI, not present today; keep it minimal (single-column sort, ascending → descending → none cycle is a reasonable default, but check if there's an existing sort-icon/chevron convention elsewhere in this codebase's `DataTable` or similar components to stay visually consistent).

- [ ] **Step 5: Fix/convert the existing test suite** per Step 1's catalogue — convert synchronous assertions to `await waitFor(...)`/`await screen.findBy...` wherever the data flow is now worker-async, using the `WorkerStub` mock pattern from Task 3.

- [ ] **Step 6: Run the full targeted + whole suite + typecheck + lint + build.**
Run: `npx vitest run src/components/Sidebar/Tabs/Population/ && npm run test:run && npm run typecheck && npm run lint:ci && npm run build`
Expected: all clean; `ls dist/` shows exactly one file (`index.html`) — confirm the worker's `?worker&inline` import didn't leak a separate chunk.

- [ ] **Step 7: Manual smoke-check note.** A full startup/interaction timing measurement requires a manual DevTools profile per this proposal's own guidance (same limitation noted in Plan 10/§N's task reports) — note in your report that this wasn't automated, and that the characterization tests (Task 1) plus this task's parity-preserving test conversions are the available automated evidence that behavior is unchanged while execution moved off the main thread.

- [ ] **Step 8: Commit**
```bash
git add src/components/Sidebar/Tabs/Population/BrowseDataView.tsx src/components/Sidebar/Tabs/Population/BrowseDataView.test.tsx
git commit -m "Change (population): Browse consumes worker-owned query engine instead of holding the full population array in React state"
```
(Add any other touched test files or the new raw-text accessor in `populationStorage.ts` to this same `git add` if Step 2 required one.)

---

### Task 5: Parallelize the "all months" sequential read loop (independent — may run in parallel with Tasks 1-4)

**Files:**
- Modify: `src/data/population/populationStorage.ts` (`loadAllPopulationRows` ~lines 567-590, and the analogous `loadAllSampleRows`/`loadAllRawRows` ~lines 623-668)
- Test: `src/data/population/populationStorage.test.ts` (existing — add coverage; find and read its current structure first)

**Interfaces:** none consumed from other tasks in this plan — fully independent. Produces no new exports; internal behavior change only (same return shape, now built via concurrent reads instead of a sequential loop).

**Context:** Confirmed by this plan's research: these three functions each do a `for (const month of months) { await safeReadJson(...) }` sequential loop, one full month-file parse at a time, merging into a single in-memory `Map`. This is reachable today via Browse's "عرض كل الأشهر" (show all months) toolbar checkbox and is a real, currently-unaddressed bottleneck — worse than the single-month case Tasks 1-4 target. This task does NOT route these functions through the new worker (Task 2); it only parallelizes the existing sequential I/O using `mapWithConcurrency` (`src/data/storage/concurrency.ts`, already proven in tonight's §O backup/restore work at concurrency budgets of 4-8).

- [ ] **Step 1: Read the 3 current functions in full** (`populationStorage.ts` ~567-668) to confirm the exact sequential shape and the `Map`-merge/dedup logic that must be preserved.

- [ ] **Step 2: Write a characterization test first** (if one doesn't already exist) proving the current sequential implementation preserves month-folder-list order in its merge (or documents that order doesn't matter — check the actual dedup logic to know which is true), so the parallelized version can be verified against the same property.

- [ ] **Step 3: Convert each function's sequential loop to `mapWithConcurrency(months, 4, async (month) => { ... })`** (budget 4 — matches this session's `loadArchiveStatus` precedent for a similarly-shaped "N months, bounded reads" pattern; not 8, since each individual read here is a full population-sized file, heavier than the small per-employee files `loadArchiveStatus` reads), collecting per-month results in an index-addressed array, then folding into the same `Map` merge logic as before — index-addressed so the merge order stays deterministic regardless of which month's read finishes first (same pattern as tonight's §O `mapWithConcurrency` adoptions).

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `npx vitest run src/data/population/populationStorage.test.ts && npm run typecheck && npm run lint:ci`

- [ ] **Step 5: Commit**
```bash
git add src/data/population/populationStorage.ts src/data/population/populationStorage.test.ts
git commit -m "Change (population): parallelize loadAllPopulationRows/loadAllSampleRows/loadAllRawRows with mapWithConcurrency"
```

---

## Task Order

**Task 1 first, alone** (Tasks 2-4 all depend on its pure functions/types).

**Task 2 after Task 1** (needs Task 1's real exported types to build the worker protocol against).

**Task 3 after Task 2** (needs the worker to exist to spawn/message it).

**Task 4 after Task 3, last among 1-4** (the highest-risk integration step; assumes the hook is fully working and tested).

**Task 5 is fully independent and may run in parallel with Tasks 1-4** (touches only `populationStorage.ts`'s "all months" functions — disjoint files from everything else in this plan). Dispatch it alongside Task 1 at the very start.
