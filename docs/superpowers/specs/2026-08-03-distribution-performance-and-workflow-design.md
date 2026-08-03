# X-Ray App — Ultimate Performance & Architecture Plan — Design Spec

**Date:** 2026-08-03
**Status:** Sections A–G approved by owner (2026-08-03). Sections H–R added at owner's request ("ultimate plan," all findings folded in) — pending spec-file review before any implementation. Sections S–V added 2026-08-03 (same day, second addendum) from four new production reports (UNC/network-share workspace, cross-navigation reload, double permission prompt persisting, Phase 4 write-side slowness) — owner explicitly waived the approval-gate/questions step for this addendum ("dont ask me anything opus 5 is your guide"); trade-offs are decided inline rather than left as owner questions.
**Owner:** App-wide — Population/Distribution (`src/data/distribution/`, `src/components/Sidebar/Tabs/Population/`), Reporting (`src/data/reporting/`, `src/data/reportDesigner/`), Workspace/Backup (`src/data/workspace/`, `src/data/backup/`), Auth (`src/auth/`)

---

## Table of contents

**Part 1 — Distribution workflow (original scope, already approved)**
1. Problem statement
2. Root cause
3. §A Distribution read-path performance
4. §B Remove sample dual-review approval gate
5. §C Pending/resolved status instead of hiding rows
6. §D Processing file-write parallelization
7. §E Fix double permission prompt
8. §F Fix role-based menu flash
9. §G Fix workspace-switch data leak

**Part 2 — Data-read & report-pipeline architecture (new)**
10. §H Shared directory-read primitive (unifies distribution/answers/approvals)
11. §I Shared report-model cache
12. §J Fix O(n²) in `groupRows`
13. §K Cooperative yielding for XLSX/CSV export

**Part 3 — Startup, bundle, backup, search, cleanup (new)**
14. §L Phase-aware population loading + truly-lightweight Reports meta
15. §M Preserve Browse's mounted state across sub-tab switches
16. §N Code-splitting plan
17. §O Backup/restore concurrency
18. §P BrowseDataView search performance
19. §Q Font deduplication
20. §R Dead code removal + duplicate consolidation

**Part 4 — Network-share performance & remaining workflow fixes (2026-08-03 addendum)**
21. §S Fix the double permission prompt at its root (one `readwrite` grant, not two)
22. §T Generalize sub-tab mount preservation beyond Browse (EmployeeWorkspace + Reports)
23. §U Cut redundant full-log reconstructions from the distribution write path
24. §V Parallelize workspace boot's sequential structure checks

**Part 5 — Cross-cutting**
25. Owner decisions needed before implementation
26. Out of scope (explicitly deferred)
27. Recommended sequencing
28. Testing
29. Key files reference

---

# Part 1 — Distribution workflow

## 1. Problem statement

The owner reported four pain points from daily use of the Population/Distribution workflow, then, on follow-up, six more specific observations. All ten were independently verified against the current codebase (file:line evidence, not assumption) before this spec was written:

1. Loading a ~1,000-row sample takes minutes, not seconds.
2. The "assign"/"replace" popup takes 5+ seconds to open and feels heavy.
3. There's a mandatory two-step sample-approval gate before distribution can start.
4. Replacing or reassigning a sample makes the row disappear immediately, with no visible "pending" state until a supervisor decides.
5. Processing a new month after uploading BI/risk data appears to "create files one by one."
6. Bulk-assigning a sample to employees "saves row by row," and an employee can see (and start working) partial results while the save is still in progress.
7. An employee's own sample view is slow to load even when they only have 2 rows assigned.
8. The supervisor's interactive approve/deny screen is slow; a separate "log" screen showing the same requests loads fast.
9. The app asks for folder permission twice on entry.
10. A role with limited tab access briefly sees all tabs on first load, before the list narrows to what they're actually allowed to see.

A parallel, broader audit (Part 2 & 3 below) surfaced one more item added here because of its severity, not its origin:

11. **Switching workspaces can leave the previous workspace's data on screen** (§G).

That broader audit — requested separately by the owner as a full-codebase performance/architecture review, translated from a generic brief to this app's actual stack (React 19 + TS + Vite SPA, no backend/database) — is what produced Parts 2 and 3.

## 2. Root cause — one architectural issue explains most of Part 1

Items 1, 2, 6, 7, and 8 all trace back to a single function: `loadImmutableDistributionEvents` (`src/data/distribution/distributionEventStore.ts:81-103`). It reads every file in a month's `distribution.events/` directory **sequentially, one at a time, with a plain `for await` loop and no concurrency** — while the write side already uses a 4-way concurrent pool (`IMMUTABLE_EVENT_WRITE_CONCURRENCY`, `distributionStorage.ts:24`).

This directory holds **every event ever recorded for the month, across every employee and every action type** (assign/reassign/complete/replace/reopen) — not scoped to any one employee or one screen. Worse, the function is called redundantly:

- On every month load/switch (`loadOrDeriveDistributionCurrent`, `distributionStorage.ts:361-408`, which reads the *entire* log **before** it even checks whether its own derived-state cache is fresh — the cache only skips re-deriving the fold, never the expensive read).
- Again inside `refreshDistribution` after every single manual action (`useDistributionActions.ts:103-132`).
- A second, separate time in `XrayInspectionResults.tsx:236,241`.
- Inside the supervisor "Review" approve/deny screen, to join each pending request against full distribution context (`useApprovalData.ts:112-115`).

So a single click (e.g. Replace) can trigger this full, unscoped, unparallelized read 2–4 times, and an employee with 2 personal rows pays the cost of the month's *entire* history because filtering to "my rows" happens client-side, after the full read (`XrayReferrals.tsx:372-379`).

**Part 2 found the same anti-pattern reappearing twice more** (§H) — this is now designed as one shared primitive rather than three independent patches.

## 3. §A — Distribution read-path performance

No file-format change, no migration. Fixes items 1, 2, 6 (partially — see §22), 7, 8. **Superseded/generalized by §H — implement via the shared primitive, not a distribution-only fix.**

1. **Parallelize the cold read.** Bounded concurrency pool, mirroring the write side.
2. **Incremental catch-up instead of full re-read.** Events are immutable/append-only — track which filenames are already folded into the cache, read+fold only new ones on later loads.
3. **Scope-gate.** Extend the existing demand-gating pattern (`computeMonthLoadScope`) to distribution data.
4. **Dedupe within one action.** Fold just-written events into local state instead of a second full reload.
5. **Loading feedback.** Disabled/spinner state on the Replace button (`XrayReferrals.tsx:543-564`) — today it has none.

## 4. §B — Remove the sample dual-review approval gate

Fixes item 3. Deliberate segregation-of-duties control (drawer ≠ approver), enforced entirely in UI phase-navigation — `src/data/distribution/` never references it:

- Delete the Phase 3 → Phase 4 block in `moveToNextPhase()` (`index.tsx:1163-1171`, the `isDistributionAllowed(...)` check).
- Remove the `SampleApprovalPanel` render (`PhaseThreeSampling.tsx:92-180`, rendered `~:459`).
- No changes to `src/data/distribution/` — never coupled to `sample.approval`.
- Owner decision: remove entirely, no replacement gate.

## 5. §C — Pending/resolved status instead of hiding rows

Fixes item 4. Rendering/filtering change only — no new approval logic. Two of three replace/reassign paths already write a proper `"pending"` request before anything applies; they're just hidden today.

- **Stop excluding pending rows.** `XrayReferrals.tsx:372-379`: remove `!pendingIds.has(e.xrayImageId)`; extend the same treatment to pending `ReplacementRequest`s (currently unfiltered by `pendingIds`, which only covers the referral log).
- **Pending visual state** — reassign requests, non-recommended replace requests.
- **Resolved/replaced visual state** — recommended-candidate replace (instant, stays instant per owner — see §22) immediately after the swap, plus any reassign/non-recommended-replace once approved. Reuse the "answered/completed" highlight treatment.
- Reuse the pending/approved/denied styling machinery already in `XrayInspectionResults.tsx`.
- Admin/supervisor direct reassign (`useDistributionActions.ts` `handleReassign`) is a separate privileged path, unaffected — `DistributionRow.tsx` already shows every status distinctly there.

## 6. §D — Processing file-write parallelization (minor)

Fixes item 5's mechanics (not its perceived cause). A typical run writes ~18–20 files (`saveMonthRun` + `rebuildReplacementIndex`), staged sequentially through `.tmp`/`.bak`. Small, bounded batch, **not** the source of "1,000 rows take minutes" (that's §A/§H). Still low-risk to fix: parallelize writes with no ordering dependency; only the manifest/index needs to commit last.

Note: the "creates files one by one" *perception* is partly `processPopulation`'s in-memory chunked progress bar (`populationProcessor.ts:687-876`) ticking through row counts with no file I/O per tick — accurate progress reporting, easy to misread, no fix needed for that part.

## 7. §E — Fix the double permission prompt

Fixes item 9. Real bug (reproducible in production build, not a StrictMode artifact). Two different permission *modes*, two independent code paths:

- **Prompt 1 (read):** workspace connect/reconnect (`WorkspaceProvider.tsx:115-221`) — expected.
- **Prompt 2 (readwrite):** `AuthGate.tsx:184-188` unconditionally calls `configureAuthActivityLogWorkspace` the instant `workspaceStatus === "ready"` — **before login**. Flushes `activity.log.json`, which needs "readwrite" — a separate grant from "read."

Fix: defer the first activity-log flush until actually needed (after a real login event) instead of eager init on workspace-ready.

## 8. §F — Fix the role-based menu flash

Fixes item 10. `App.tsx`'s `permissions` state (`:46-48`) initializes from a module-level variable that resets to defaults on every page load, before the real disk-synced matrix loads. `WorkspaceGate` (`:257-264`) renders `AppContent` as soon as `status === "ready"`, without waiting for `usersHydrated` — a flag that already exists for exactly this race elsewhere (`AuthGate`'s stale-session check) but isn't wired into tab rendering.

Fix: gate `AppContent`/tab-list rendering on `usersHydrated`, show a lightweight loading state instead. Not a default-value fix — an ordering fix.

## 9. §G — Fix workspace-switch data leak (urgent)

Fixes item 11. Two-part root cause:

- `useMonthLoad.ts:99`'s reload guard keys only on folder **name**, not workspace identity.
- `reconcileSelection` (`src/data/month/globalMonthLogic.ts:44-47`) compounds this by keeping the existing selection object when the new workspace has a same-named folder — the "month changed" signal never fires.

Fix: key the reload guard on workspace identity (`directoryHandle` or stable id) alongside folder name — matching the pattern `BrowseDataView` and `Reports/index.tsx`'s `loadExecInput` already use correctly.

---

# Part 2 — Data-read & report-pipeline architecture

*Designed by a dedicated architecture pass (Opus) given the confirmed findings above plus the broader audit. Three verified facts govern this whole part — read before implementing anything below:*

> **Only `distribution.events/` is truly append-only.** `{username}.answers.json` and `{supervisor}.decisions.json` are **mutable** — each save rewrites the whole file with a bumped revision. Incremental filename-delta caching is only safe for distribution events; answers/approvals get parallelism + call-dedupe only, never the incremental layer. Applying incremental caching to a mutable file would ship a silent stale-data bug.
>
> **The three existing loaders have different failure policies that must be preserved exactly:** `loadImmutableDistributionEvents` **throws** on any unreadable file (intentional — "no caller can derive a silently incomplete snapshot," `distributionStorage.ts:111-113`); `loadAllEmployeeFiles` and `loadAllSupervisorDecisions` **skip** unreadable files.
>
> **Result order is observable** and flows into rendered lists and report models — any shared primitive must reproduce today's exact ordering (index-assigned results, not push-on-completion).

Existing test tooling already fits this work: `createMemoryDirectory(name, { trackReads: true })` + `getReadLog(dir)`/`clearReadLog(dir)` (`src/data/storage/memoryDirectory.ts`) exists specifically to assert "this load performed no read of X."

## 10. §H — Shared directory-read primitive

**New module `src/data/storage/directoryScan.ts`**, beside `safeWrite.ts`/`casLoop.ts`.

**Layer 0 — listing shim.** Three byte-identical `getDirectoryEntries` copies exist today (`distributionEventStore.ts:9-24`, `answerStorage.ts:19-35`, `approvalStorage.ts:36-52`) — collapse to one `listDirectoryEntries(dir): Promise<DirectoryEntryLike[]>`, same probe order (`values()` → `entries()` → `Symbol.asyncIterator` → `[]`). Must **materialize** the listing before any read starts — this is what makes index-assigned ordering possible, and it's not a new cost (the current loops already walk the same listing; listing is far cheaper than N `getFile()` calls).

**Layer 1 — bounded-concurrency parallel read (universal).**

```ts
export const DIRECTORY_READ_CONCURRENCY = 8; // write side uses 4; reads are cheaper — measure before locking in

export type ReadJsonDirectoryOptions = {
  suffix: string;
  onUnreadable: "throw" | "skip";           // "throw" = distribution's policy; "skip" = answers/approvals' policy
  unreadableError?: (fileName: string) => string;
  concurrency?: number;
};
export type ReadJsonDirectoryResult<T> = {
  values: T[];        // listing order, unreadable entries removed
  fileNames: string[];
  matchedNames: string[];
};
export function readJsonDirectory<T>(dir: DirectoryHandleLike, options: ReadJsonDirectoryOptions): Promise<ReadJsonDirectoryResult<T>>;
```

Implementation constraints (all load-bearing):
- **Pool shape:** copy `writeImmutableEventBatch` (`distributionStorage.ts:34-56`) exactly — shared `nextIndex` cursor, `Promise.all(Array.from({length: workerCount}, worker))`. Never `Promise.all(entries.map(...))` — unbounded.
- **Index-assigned results:** write into `slots[i]`, never `push`.
- **Deterministic first failure:** on `onUnreadable: "throw"`, record `{index, name}` only if lower than current, stop taking new work, await all workers, then throw for the lowest index. Without this, *which* filename appears in the error is a race.
- **Permission-loss short-circuit:** abort on `NotAllowedError`/`SecurityError`/`NoModificationAllowedError` (same classification as `casLoop.ts:42-50`) rather than producing N identical rejections.

No locking — `safeReadJson` takes none today either, so parallel reads can't deadlock against `safeWriteJson`'s `withResourceLock`. A parallel read can observe a file mid-commit, same as a sequential one today; `safeReadJson`'s live→`.bak`→`.tmp` fallback already handles it. Document this in the module so it isn't re-litigated.

**Layer 2 — incremental append-only read (opt-in; distribution events ONLY).**

```ts
export type AppendOnlyScope = { root: DirectoryHandleLike; path: string }; // root MUST be the stable workspace root — getDirectoryHandle() returns a fresh object every call
export function readAppendOnlyDirectory<T>(dir, options: ReadJsonDirectoryOptions & { scope: AppendOnlyScope }): Promise<ReadJsonDirectoryResult<T>>;
export function resetAppendOnlyDirectoryCache(root?: DirectoryHandleLike): void; // wired to the existing dataRefreshSignal
export function __appendOnlyCacheStatsForTests(): { entries: number; filesReadLastCall: number; fullRereads: number };
```

Store: `WeakMap<root, Map<path, {names: Set<string>, byName: Map<string,T>}>>` — disconnected workspace's cache is GC-collectible.

Per call: list directory (only unconditional I/O) → **if any cached name is absent from the listing** (deletion/rename/restore), drop the entry and do a full cold read (counted in `fullRereads`) → read only new listing names via Layer 1 → merge → **return in current-listing order, re-sorted by the caller** (not cache-insertion order), so a new event with an earlier `eventAt` than a cached one still lands correctly in the fold.

In-memory only — no new on-disk format, no migration. Invalidation hooks into the existing `subscribeToDataRefresh` signal (manual-refresh button, 5-minute timer) — reusing this means "refresh purges the cache" is already the expected semantic.

**Layer 3 — in-flight dedupe (universal, separate concern).**

```ts
// src/data/storage/inFlightReads.ts
export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T>; // coalesces OVERLAPPING calls only, no TTL
export function workspaceScopeId(root): string;
export function bumpWorkspaceEpoch(root, month): void;  // called on every successful write
export function workspaceEpoch(root, month): number;
```

Key: `` `${workspaceScopeId(root)}|${month}|${workspaceEpoch(root,month)}|${op}` ``. `bumpWorkspaceEpoch` called from `appendDistributionEvents`, `updateEmployeeAnswerFile`, `appendDecisionEvent` on success — defence-in-depth even if a write path is later mis-migrated to a deduped read.

### Adoption per consumer

- **`loadImmutableDistributionEvents`** → `readJsonDirectory` with `onUnreadable: "throw"`, then the existing final sort (unchanged — makes parallel order irrelevant).
- **`distributionStorage.ts`'s `readCurrentDistributionSource`** gains Layer 2 (stable root+month both in scope here) — always re-sort after merge (fold is order-sensitive).
- **`loadAllEmployeeFiles`** / **`loadAllSupervisorDecisions`** → Layer 1 only, `onUnreadable: "skip"`, outer try/catch unchanged.

### Where dedupe applies — and must NOT

**Rule: opt-in at the call site, never inside a shared loader.** Several re-reads exist specifically to observe a write that happened between two points in the same flow — deduping them would silently defeat a concurrency guard while tests stay green. Add thin deduped siblings (`loadDistributionLogForRead`, `loadOrDeriveDistributionCurrentForRead`, `loadAllEmployeeFilesForRead`, `loadAllSupervisorDecisionsForRead`) and migrate only read-only screens to them.

**Must stay on raw functions:** the CAS read-modify-write and delayed verify re-read (`distributionStorage.ts:258,271,280`); `approveReferral.ts:142,161,186,268` (the cross-reviewer guards — their own comments say "re-scan EVERY reviewer's file right before persisting," existing specifically to catch a concurrent decision); `answers/reopenAnswer.ts:83,91`; `XrayReferrals.tsx:591` (`freshDist`). Tag each with `/** Correctness-critical fresh read — never route through dedupeInFlight. */`.

## 11. §I — Shared report-model cache

**New module `src/data/reporting/executive/model/reportModelCache.ts`.** Module-level, not React context — 5 of 7 call sites are plain functions outside React.

```ts
export function getOrBuildReportModel(input: ExecutiveReportInput, employeeDisplayNames?: Record<string,string>): ReportModel; // sync drop-in for buildReportModel
export function reportModelCacheKey(input, employeeDisplayNames): string;
export function clearReportModelCache(): void;
export function __reportModelCacheStatsForTests(): { hits: number; misses: number; size: number };
```

Bounded LRU, `MAX_CACHED_MODELS = 2` (current month + one previously viewed) — measure memory on the largest available month before merge; drop to 1 if bad. Never persisted to storage.

**The key is the entire correctness argument.** `buildReportModel` is pure in `(ExecutiveReportInput, employeeDisplayNames)`, so the key must fingerprint every field:

| Field | Key material | Why sufficient |
|---|---|---|
| `populationRows` | envelope `contentHash` + `rows.length` | validated on every read |
| `sample` | envelope `contentHash` | same |
| `distribution` | `eventSetId` + `logRevision` | `eventSetId` is an exact length-prefixed identity, already documented as collision-proof |
| `employeeFiles` | sorted `username:revision` | revision bumps on every answer write |
| `template` | `templateId` + `contentHash` | — |
| `config`, `sourceRevisions`, `employeeDisplayNames` | hashed/joined | small, cheap |

Cost: O(employees + template + config), not O(population). **Compile-time completeness guard:** build the key from a `Record<keyof ExecutiveReportInput, string>` literal — adding a field to the input type without adding it to the key then fails `typecheck`, the cheapest permanent defence against staleness.

Requires a new sibling to `readEnvelopeRevision`: `readEnvelopeStamp(dir, fileName): Promise<{revision, contentHash} | null>` in `safeWrite.ts`, sharing its `.bak`-fallback logic.

**Freeze the returned model** (shallow, on `model.rows`, `model.factTable`, `model.population.byPort/byStage`, etc.) before caching — the realistic corruption mode for a shared object is an in-place mutation by one consumer silently poisoning every later consumer. Under strict mode this throws immediately if any renderer still mutates in place (check `deck2/section3/portAgreement.ts`/`sourceAgreement.ts` first — both are mid-edit in the working tree); fix the mutation, don't loosen the freeze.

**Wire `KpiRenderer.tsx` to the shared model** — but fix the loader location first, that's the actual N× bug, not the aggregation:
1. **Hoist the load out of the leaf.** New `DesignerDataProvider`/`useDesignerDataModel()` mounted once at the canvas/preview root; every KPI widget consumes from context instead of independently loading+rebuilding. This alone turns N reads + N full-population rebuilds into 1 + 1.
2. **Source it from `getOrBuildReportModel`.**
3. **Route aggregation through the already-built, currently-unused `reportDesigner/query/runQuery.ts`** (confirmed dead in production — its only reference is its own file/tests — but its Map-based grouping is already the correct O(n) reference implementation for §J). Needs one addition: a `"notNull"` filter operator (`filters.ts`) to match `computeResult`'s null/undefined-drop semantics exactly.

**Bonus finding:** `KpiRenderer.tsx:102-110` calls the row-builder with `template: null` while Reports passes a real template — meaning KPI tiles can silently disagree with the report for the same month **today**. Fixing the loader location fixes this too; flag it in the edit log as a genuine behavior change (values will legitimately shift), not a pure refactor.

## 12. §J — Fix the O(n²) in `groupRows`

`src/data/reporting/executiveKpiProfiles.ts:10-20` spread-copies the whole accumulated bucket on every row push instead of `Array.push`. Fix:

```ts
function groupRows(rows: ExecutiveReportRow[], keyFor: (row) => string): Map<string, ExecutiveReportRow[]> {
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row); else groups.set(key, [row]);
  }
  return groups;
}
```

Same shape already used at `runQuery.ts:32-36` — one idiom instead of two. Output is provably byte-identical: `Map` preserves insertion order (unchanged), buckets keep relative row order (unchanged), the downstream sort in `buildPortProfiles` is stable (V8 guarantee, ties unchanged). Feeds every executive/management report, both decks, both workbooks, and the KPI dashboard.

## 13. §K — Cooperative yielding for XLSX/CSV export

The HTML report/deck builders already yield between pages/slides via a `yieldToMain()` idiom (bare `setTimeout(resolve, 0)`) — duplicated 7 times across the codebase; extract to `src/data/storage/yieldToMain.ts`. **Keep `setTimeout(resolve, 0)` verbatim** — `distributionReport.test.ts:80-84` and `deck2.test.ts:1535` explicitly fake only `Date`, not timers, with a comment that faking `setTimeout` too "would hang those awaits forever." Do not "modernize" to `scheduler.yield()`.

The XLSX builders (`buildDistributionXlsx`, `buildSampleXlsx`, `buildExecutiveWorkbook`, `buildManagementWorkbook`) have no such yielding and can freeze the tab for their full build duration. Convert to async, yield between sheet appends and inside every O(population) row map (`if (i % EXPORT_YIELD_ROWS === 0) await yieldToMain();`, `EXPORT_YIELD_ROWS = 2000`). Propagate `Promise<void>` up to the 5 UI call sites in `Reports/index.tsx` (all already inside async handlers with spinner state — the spinner becomes genuinely accurate as a side effect).

**Honest limit:** `XLSX.utils.aoa_to_sheet`/`XLSX.writeFile` (vendored SheetJS) aren't yieldable — this chunks the O(population) assembly, not the final serialize. Moving SheetJS to a Worker is a real follow-up, out of scope here.

**PowerBI CSV export:** the freeze is `toCsvString` — one synchronous O(rows×cols) string build. **Stream it** instead of chunking it, following the pattern `safeWrite.ts`'s `streamToFile` already establishes in this codebase: a `toCsvChunks()` generator yielding periodically, with `toCsvString = (h,r) => [...toCsvChunks(h,r)].join("")` kept as the single implementation (golden-tested for byte-identity).

**Reentrancy risk:** async conversion reopens the exact hazard `deck2/index.ts:415-458` already documents and guards (`withDeckBuildLock`) for its own module-level mutable state. Verify each workbook builder touches no module-level state before converting; hoist `withDeckBuildLock` into a shared `withExclusiveBuild(key, fn)` helper and reuse it rather than re-deriving the same guard per builder.

---

# Part 3 — Startup, bundle, backup, search, cleanup

*Designed by a second dedicated architecture pass (Opus). Two premises were empirically verified before designing against them:*

> **Dynamic `import()` under `vite-plugin-singlefile` genuinely defers module evaluation** (verified with a built reproduction) — everything still inlines into one `dist/index.html` (no download-size change), but the deferred module's top-level code doesn't run until the `import()` resolves. `React.lazy` is a real startup-eval lever here, **not** a bundle-size lever. Caveat: the deferral is destroyed by any static import path to the same module anywhere in the production graph.
>
> **The font duplication was measured directly against the built `dist/index.html`:** Somar Sans (4 weights) appears **twice** each — 239,708 bytes, **7.3% of the current 3,290,206-byte bundle**.

## 14. §L — Phase-aware population loading + truly-lightweight Reports meta

**The chicken-and-egg:** `derivePhase` runs *on* loaded data, so phase isn't known when `computeMonthLoadScope` is called. Resolution: make the initial load population-free; let a phase-driven top-up own the read (already legitimate — `derivePhase` keys on manifest/sample/distribution/summary, all always-loaded).

```ts
export function computeMonthLoadScope(params: {...}): MonthLoadScope {
  return { summary: true, sample: true, distribution: true,
    population: false,                              // always deferred now
    raw: params.activeSubTab === "process" && (params.canDrawSample || params.canProcessPopulation) };
}

export function needsPopulationForPhase(params: { activeSubTab, phase, canDrawSample, canProcessPopulation }): boolean {
  if (params.activeSubTab !== "process") return false;
  if (!params.canDrawSample && !params.canProcessPopulation) return false;
  return params.phase === 2 || params.phase === 3;   // NOT phase 3 alone — Phase 2's preview + orphan scan need it too
}
```

The real win is phases **1 and 4** — a manager/supervisor opening an already-distributed month currently pays a full `population.final.json` read for nothing; genuine full-row needs (draw-sample click, export) already have on-demand top-ups elsewhere in the codebase (`ensurePopulationLoaded`) that just need to be reused, not invented.

**Row count without rows:** `PopulationStatusBar` needs a count for every phase. Change its prop from the full result object to `populationRowCount: number | null`, derived as `populationProcessingResult?.preparedRows.length ?? processingSummary?.summary.finalPreparedPopulationRows ?? null` — the summary field already exists on disk, no new read.

**Close the phase-2→3 race:** `moveToNextPhase`'s phase-2 gate currently reads state that may not have landed from the top-up yet — await `ensurePopulationLoaded()` directly rather than checking already-set state, or a fast double-click shows a spurious "must finish processing first" error.

**Optional additive follow-up (separate change, not bundled):** persist `stageCounts` + a 10-row preview into `processing.summary.json` at write time — removes the phase-2/3 top-ups entirely for *newly-written* months, matching the original large-population proposal's literal target. Old months fall back to the top-up.

**`Reports/index.tsx`'s "lightweight" meta effect is not lightweight** — it loads the full population just for a row-count chip, ungated by section, hitting every guest/supervisor/manager/admin on landing. Two-tier fix:
- **Tier 1 (always):** manifest + `processing.summary.json` + sample master only — no population read. Extract the existing `populationStageReached` helper (currently module-private in `backupStorage.ts`, with its own 16-line rationale comment) into a shared `src/data/population/monthStatus.ts` so both call sites use one definition.
- **Tier 2 (studied count):** delete the `loadAllEmployeeFiles` call entirely — derive it from the KPI model's `sample.studied`, which is already built and already gated on `section === "kpi"` (the correct pattern to inherit, not invent). **Trade-off needing owner sign-off:** the "studied" chip shows "—" until the KPI dashboard is opened once. Recommended over the alternatives (an always-on background read, or silently redefining the metric from distribution-completion data) — see §26.

## 15. §M — Preserve Browse's mounted state across sub-tab switches

Replace Population's `{activeSubTab === "browse" && (...)}` conditional with the hidden-div pattern `App.tsx` already uses for top-level tabs, gated by a `visitedSubTabs` set so Browse only mounts (and only pays its full-dataset load) the first time it's actually opened — **not** on every Population landing, which would reintroduce exactly the read §L removes.

**Honest trade-off:** keeping Browse mounted retains its full in-memory dataset (up to ~400k rows) for as long as Population stays in the top-level tab LRU. This is not a *new* class of retention — if the user's last Population visit ended on Browse, those rows are already retained across other tab visits today via the existing 3-tab LRU; this just extends the same already-accepted policy one level deeper. Low-memory fallback if the owner rejects the trade-off: hoist only the UI state (search/filters/page) into the parent instead of the whole mount, fixing the state-reset annoyance but not the reload cost.

## 16. §N — Code-splitting plan

**Do first (highest value): defer the report *builders* themselves**, not just the Reports tab. `Reports/index.tsx` statically imports the entire report-generation graph including the two largest files in the repo (`deck2/slides.ts`, 3,766 lines; `deck2/theme.ts`, 2,081 lines) — so even splitting the Reports tab alone wouldn't help a manager who lives in the KPI dashboard but never exports a deck. Convert the seven builder imports (`distributionReport`, `sampleReport`, `executiveReport`, `deck2`, `management/*`, `powerbiExport/exportManager`) to `await import(...)` inside their click handlers — no `Suspense` needed, they're all handler-invoked. Keep `reportModel`/`ui/charts` static — the KPI dashboard renders them without a click.

**Then, tab-level boundaries**, in priority order: **ReportDesigner** (already conditionally rendered — pure win, do first), **Reports** (biggest subtree, blocked for every `employee` session), **ChangeLog** (~116KB edit-log payload, admin-only), **UserManagement** (admin-only), **TemplateBuilder**. `tabRegistry.ts`'s eager glob must stay eager for `tabConfig` metadata — split *within* each tab folder (`index.tsx` keeps `tabConfig` + `lazy(() => import("./TabView"))`) rather than changing the registry. One shared `Suspense` boundary inside the existing per-tab `ErrorBoundary` in `App.tsx`, with a labeled loading state (label key, not hard-coded Arabic).

**Role-gating comes for free** — `App.tsx` already renders only tabs in `allowedTabs`, so a role that can't see a tab never mounts its lazy component, never triggers its import. Do not add a second role check at the import site; that would duplicate `tabCatalog.ts` and drift from it.

**The one failure mode that silently defeats this:** any stray *static* import of a lazy-boundary module anywhere else in the production graph re-anchors it into the main chunk with no error and no visible symptom. **Enforce with an ESLint `no-restricted-imports` rule** (already have `lint:ci --max-warnings 0` in CI) forbidding static imports of each lazy-boundary path from outside its own subtree. Also confirm `src/dev/deckPreview.ts` (which deliberately keeps the v1 deck alive, see §R) is absent from the production entry graph.

**What NOT to expect:** `check:bundle-size` will not improve — this is a startup-eval fix, not a byte-size fix, everything still inlines into the one HTML file. Measure with `performance.now()` to first interactive paint and DevTools "Evaluate Script" self-time instead, comparing an `employee` session against `admin`.

## 17. §O — Backup/restore concurrency

**New shared primitive** `mapWithConcurrency<T,R>(items, limit, fn)` in `src/data/storage/concurrency.ts` — index-addressed results (never push-on-completion, preserves determinism), fail-fast-then-drain (stop starting new work on first error, await in-flight, then throw), never `Promise.all(items.map(...))` unbounded. One semaphore per *operation* (not per directory) since the walk is recursive — a per-directory limit would multiply (8 dirs × 8 files = 64 concurrent handles). Budgets: **8 for copy** (no locks involved), **4 for restore** (each write takes a Web Lock).

**The core argument for why this is safe, not just faster:** a backup is *already* not an atomic snapshot today — `backupStorage.ts` already documents that concurrent app writes create/remove `.tmp` files mid-walk and tolerates `NotFoundError`. A sequential walk of a large workspace spans minutes, during which many concurrent mutations can land; an 8-way walk spans roughly 1/8th of that, so **parallelizing reduces the window for interleaved mutations, it doesn't introduce one.** What genuinely needs care: build the copied/restored manifest from **index-addressed results in input order** (not completion order) so backup manifests stay deterministic and snapshot-testable; materialize the directory listing before starting concurrent restore reads (holding a live async iterator across concurrent awaits is the actual new hazard, not the concurrency itself).

**Two cheap real improvements while in this code:** a `restore.inprogress.json` sentinel (written before, removed after) makes an interrupted restore *detectable* instead of silently half-applied; a `backup.complete.json` marker written *last* lets the restore UI refuse incomplete backups. Neither existed before and neither depends on the concurrency change.

**Do `loadArchiveStatus` first** — read-only, zero integrity risk, best payoff ratio: outer `mapWithConcurrency(months, 4, ...)`, inner `Promise.all` over the per-month reads that don't depend on the manifest. Latency model: ~12 months goes from ~84 sequential round-trips to ~6. **Must land alongside the `loadAllEmployeeFiles` fix (§H)** or the measurement will be dominated by that still-sequential call inside it.

## 18. §P — BrowseDataView search performance

Four steps, first two required, third needs sign-off, fourth contingent:

1. **Debounce (required) — copy the pattern already in this codebase.** `DataTable/index.tsx` already solves this exactly (immediate input state + 200ms-debounced filter state) — mirror it in `BrowseDataView`, don't invent a new pattern.
2. **Hoist string normalization out of the per-row loop (required, free).** `rowMatchesSearch` recomputes `search.trim().toLowerCase()` **inside** the per-row callback today — pass an already-normalized query instead. At 400k rows this removes 400k redundant allocations per keystroke pass for zero risk.
3. **Scope the scan to visible columns only (needs sign-off — real behavior change).** Today it scans every column including hidden/internal ones. Restricting to visible columns is ~3× less work per row *and* aligns Browse with `DataTable`'s existing documented search semantics ("match any visible column") — but a row matching only via a hidden column stops matching. Product decision, not a pure perf fix.
4. **Chunked yielding (bridge only, if needed before the real fix lands).** Reuse the file's own existing `yieldToMain`/`EXPORT_CHUNK_SIZE` idioms already present in this file, with a stale-result guard token matching `useMonthLoad.ts`'s existing pattern.

**Explicitly rejected: a memoized lowercase search index.** The obvious "precompute a lowercased haystack per row" would retain roughly 48MB of extra UTF-16 on the main thread at real scale — exactly the resource the existing (unapproved) large-population proposal's Phase B is designed to eliminate by moving search/filter into a Worker returning only the visible page. An index here is work Phase B deletes, bought with memory on the thread that proposal is trying to relieve. **Steps 1–2 now, step 3 with sign-off, step 4 only as a stopgap — the real fix is Phase B, tracked separately, not re-designed here.**

## 19. §Q — Font deduplication

**Root cause:** two independent Vite inlining pipelines duplicate the same 4 font files — CSS `url()` inlining (app shell) and a separate `?inline` JS import (report theme) — neither aware of the other. Measured: 239,708 bytes duplicated, **7.3% of the current bundle**.

**The self-containment constraint doesn't actually require two copies in the *app* bundle** — it requires the font bytes to appear once *inside each generated report*, which is a different thing. Proof already lives in this codebase: IBM Plex Sans Arabic is already funneled through one JS constant (`branding/fonts.ts`) consumed by both the app and reports, and it appears exactly once in the built bundle. Apply the same pattern to Somar Sans: one new module owning the base64 imports, exporting a small builder function (not a constant, since the app uses font-family name "Somar Sans" while reports use "Somar" — a builder avoids doubling the CSS rules inside every generated report while still keeping one copy of the base64 literal in the bundle). Delete the CSS-based `@font-face` blocks from `index.css`; inject the app's copy via the same `main.tsx` mechanism already used for IBM Plex.

**Expected gain:** −239,708 bytes raw (−7.3%), roughly −180KB gzip (~15% of current gzip size, since the two copies are far outside DEFLATE's dedup window) — **the single largest available bundle reduction in the codebase**, and it converts the current thin ~8.5% budget headroom into a comfortable margin.

**Required care:** report snapshot tests embed the report CSS including the font-face block — the builder must emit byte-identical rule text (same order, same `font-display`, same quoting) so `npm run test:run` shows zero snapshot deltas; any delta means the builder drifted. Rejected alternative: reading font data back out of `document.styleSheets` at report-build time — would make report builders depend on a live DOM, breaking their "deterministic, runs under Vitest's `node` environment" contract. Font subsetting/dropping weights is a separate, owner-facing decision — not bundled here.

## 20. §R — Dead code removal + duplicate consolidation

**Confirmed-dead exports (implementer-ready removal list — each re-verified as having exactly one hit, its own definition, across the whole repo including tests):**

`primitives.ts`: `barRow`, `badgeHtml`, `heatCell`, `statPill`, `noticeBox`, `pagePanel` · `htmlReport.ts`: `buildReportHtml`, `formatNum` (check the new untracked `htmlReport.test.ts` first — it may now exercise one) · `executiveReportData.ts`: `fmtK` · `feedbackStorage.ts`: `saveFeedback` · `slideKit.ts`: `getActiveStyleChoices` · `fileSystemAccess.ts`: `getStatusFromStructureResult` · `userManagement.ts`: `DEFAULT_USER_TEMP_PASSWORD` (bonus: this is a literal plaintext password shipped in the client bundle — removing it is a small security win, not just cleanup) · `branding/fonts.ts`: `ARABIC_FONT_FAMILY` (remove *after* §Q, which touches this file) · `userManagement.ts`: `getPublicManagedUsers`.

**Needs owner confirmation before removal — not an implementer decision:**
- `workspaceDefaults.ts`'s legacy-schema write-side constructors — *question:* is there any supported path (downgrade, reset-to-defaults, migration rollback) that still *writes* the old unnumbered layout, or is legacy now strictly read-only?
- `src/data/reporting/executive/deck/` (v1 deck) — **not dead code, do not remove**; deliberately kept alive by the `deckPreview.ts` dev comparison tool. *Question:* is the v1-vs-v2 comparison still needed, and until when?

**Consolidations (exact before/after, both already given in the investigation):**
- `formatIssueDate` — 3 byte-identical copies → keep the existing canonical `reportChrome.ts` export, delete the two duplicates in `executive/index.ts` and `management/managementReport.ts`, import instead.
- `normalizeText` (4 copies) / `normalizeArabicText` (2 copies) — new shared `Population/processing/textNormalization.ts` (not the heavier `populationProcessor.ts`, to avoid forcing light consumers to import the whole processor module); delete the 4 duplicate bodies, import instead. Do **not** merge `normalizeHeader` (adds `.toLowerCase()`, genuinely different) or `normalizeXrayId` (already correctly exported, just composes the shared helper) into this consolidation.

Both consolidations must produce byte-identical output — report/population golden snapshots must show zero deltas.

---

# Part 4 — Network-share performance & remaining workflow fixes (2026-08-03 addendum)

Owner report, verbatim: the workspace folder in production is a UNC/network-share path ("PRD File," a shared file server), not local disk — the app is fast locally and "takes forever" on the share; navigating between pages reloads content that was already loaded; the app still prompts for permission twice, and should instead request everything it needs in one popup at attach time; Phase 4 (distribution/save) is "still very very slow," possibly from interleaving writes across employees. Four research passes (external Chromium/File-System-Access-API research plus exact file:line codebase analysis) grounded the following four fixes. Owner explicitly waived the questions/approval-gate step for this addendum, so trade-offs below are decided, not posed as open questions.

**Why local-fast/network-slow at all — the shared root cause behind §S–§V.** Chromium's File System Access API on Windows routes every file operation through a sandboxed broker process over IPC; locally that's sub-millisecond overhead on top of sub-millisecond NTFS I/O (invisible), but over SMB each of those same calls becomes a real network round trip (commonly 1–50ms+, more under load), and every `createWritable()` commit additionally stages through a `.crswap` file and a Safe Browsing scan before the final rename (Chromium issue 40899722: 142s vs 3.4s for the same 1,000-file test, Windows vs macOS) — a cost that's fixed per-operation, not per-byte. Corporate antivirus/EDR scanning network file opens is a common further multiplier. **None of this is fixable from application code** — the actionable lever is exclusively reducing *how many* file operations a given user action performs, which is what §S–§V do. (A fifth lever — relaxing `safeWriteJson`'s 3-write/3-read stage-verify-commit cycle, worth roughly a 3× per-file cost — is deliberately **not** touched here: it's this app's only crash-safety guarantee, CLAUDE.md documents it as load-bearing, and weakening it needs its own dedicated risk review, not a bundled line-item. Tracked in §26.)

## 21. §S — Fix the double permission prompt at its root

**Root cause (confirmed against the current code, not assumption):** `selectWorkspaceDirectory` (`src/data/storage/fileSystemAccess.ts:93-105`) already supports requesting `readwrite` in the *same* `showDirectoryPicker()` interaction (`mode` defaults to `"readwrite"` at line 94) — Chromium grants read+write from one picker dialog when asked, no separate follow-up prompt needed. But both call sites that actually invoke it override that default down to `"read"`: `WorkspaceProvider.tsx:209` (`selectWorkspaceDirectory("read")`, the attach flow) and `WorkspaceProvider.tsx:176-179` (`ensureDirectoryPermission(persisted.directoryHandle, "read")`, the manual-reconnect flow). Because only `read` is ever granted up front, the **second** prompt is simply whatever write happens first afterward — most commonly `AuthGate.tsx`'s post-login activity-log flush (`configureAuthActivityLogWorkspace` → `safeWriteJson` → `workspaceWriteAccess.ts:46-48`'s `requestPermission({mode:"readwrite"})`), or, on first-time workspace setup, `createWorkspaceStructure`'s explicit `readwrite` request (`fileSystemAccess.ts:281-284`). This is not a leftover independent caller and not the AuthGate fix's fault — the AuthGate consolidation (already shipped, Plan 2) is correct and unrelated; the gap is entirely these two `WorkspaceProvider.tsx` call sites still asking for less than the app is about to need.

**Fix:** change both call sites to request `readwrite` up front:
- `WorkspaceProvider.tsx:209`: `selectWorkspaceDirectory("read")` → `selectWorkspaceDirectory("readwrite")`.
- `WorkspaceProvider.tsx:176-179`: `ensureDirectoryPermission(persisted.directoryHandle, "read")` → `ensureDirectoryPermission(persisted.directoryHandle, "readwrite")`.

Every downstream `queryPermission`/`requestPermission` call (`checkWorkspaceStructure`'s read check, `createWorkspaceStructure`'s readwrite check, `workspaceWriteAccess.ts`'s pre-write check) is already written defensively — query first, request only on `"prompt"` — and needs no change: once the grant at attach/reconnect time is `readwrite`, every one of them observes `"granted"` on its first query and never reaches its own `requestPermission` branch, so no second prompt fires. `read` **implies** `readwrite`'s read access, so nothing that only needs read is weakened. This literally *is* "request read+write and everything else in the one popup" — the File System Access API has exactly two modes (`"read"`, `"readwrite"`); there is no broader third tier to request.

**Left unchanged, deliberately:** the passive mount-time auto-reconnect probe (`WorkspaceProvider.tsx:137-140`, `queryDirectoryPermission(..., "read")`) — it only decides whether to auto-resume or show the manual "reconnect" button, never prompts either way, and checking `read` there (rather than `readwrite`) avoids forcing users who reload before this fix ships (and therefore only hold a `read` grant from the browser) through an extra manual reconnect click; they'll be silently upgraded to `readwrite` the next time they do reconnect or re-attach.

## 22. §T — Generalize sub-tab mount preservation beyond Browse

**Confirmed scope, not assumption.** `App.tsx` already solves this problem at the top level: up to 3 most-recently-used top-level tabs stay mounted via `touchTabMountLru` (`src/app/tabMountLru.ts`) and a `hidden={tab.id !== activeTabId}` wrapper (`App.tsx:282-297`) instead of conditional mount/unmount — switching between top-level tabs does not reload their data. §M (already speced, §15 above) extends exactly this pattern to Population's Browse sub-tab, which is the one sub-view research confirmed still fully unmounts/remounts (and reloads up to ~400k rows from scratch) on every switch away and back, because it owns its own `rows`/`loading` state and load effect (`BrowseDataView.tsx:400-478`) with no "already loaded" guard.

Research into the other two multi-sub-tab parents found the *same* unmount bug in one of them, and a **different, already-tracked, non-bug** in the other — both confirmed against current code:

- **EmployeeWorkspace (`src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx:83-120`) — genuine instance of the same bug.** Four `if (activeSubTab === X) return <Component/>` branches (`XrayReferrals`, `ReferralApproval`, `XrayInspectionResults`, `TemplateBuilderTab`) fully unmount the outgoing sub-view on every switch; three of the four own their own data-loading effects that re-fire on every fresh mount. **Fix:** replace the four early returns with the same `visitedSubTabs` + hidden-div pattern as §M — track which sub-tab IDs have ever been active in a `useState<Set<WorkspaceSubTab>>`, render every visited one in a `hidden={activeSubTab !== id}` wrapper instead of only the active one, and only add an ID to the visited set (mounting it for the first time) once its permission check (`canAccessTab`/`can(...)`) passes — an ID that fails its check is never mounted and never added, so `AccessDenied` keeps rendering for the active slot exactly as today. If a previously-visited sub-tab's permission is later revoked mid-session (role-preview switch), drop it from the rendered set on the next render — mirrors `touchTabMountLru`'s existing behavior of purging a tab that's become disallowed, so a permission downgrade still hides content instead of leaking it.
- **Reports' `reports`↔`kpi` toggle (`Reports/index.tsx:279-305`) — not this bug, already tracked elsewhere.** `section` is `ReportsContent`'s own local state; switching between "reports" and "kpi" never unmounts `ReportsContent`, so this isn't a mount/unmount problem at all. The KPI model *is* deliberately cleared and rebuilt every time `section` becomes `"kpi"` again (`setModel(null)` at line 281, effect re-runs on `[section, ...]`) — but that's intentional recompute-on-reopen behavior, exactly the gap **§I (report-model cache)** already exists to close. Do not touch this effect here; §T's fix does not extend inside `ReportsContent`.
- **Reports' `reports/kpi` ↔ `report-designer` swap (`Reports/index.tsx:1208-1227`) — genuine instance of the same bug, one level up.** `ReportsTab`'s own `if (activeSubTab === "report-designer") return <ReportDesignerTab/>; return <ReportsContent/>;` fully unmounts whichever side isn't active — so leaving the KPI dashboard open to visit Report Designer and coming back re-triggers everything in `ReportsContent` from a cold mount (toast state, `section`, the whole component tree), independent of and in addition to the §I gap above. **Fix:** apply the identical `visitedSubTabs` + hidden-div swap at this one outer branch point — `ReportsContent` and `ReportDesignerTab` both mount at most once each and stay hidden-not-unmounted thereafter. This does not touch anything inside either component.

**Trade-off, decided (not posed as a question, per this addendum's mandate):** all three surfaces here have small, bounded sub-tab counts (2, 4, and 2 respectively) — unlike Browse's up-to-400k-row retention concern that justified an explicit owner sign-off in §26 item 2, keeping every visited sub-tab mounted in these three parents is bounded, cheap, and carries no comparable memory trade-off worth gating on. No LRU eviction is added here; `visitedSubTabs` only grows for the lifetime of the parent's own mount (which itself is already LRU-bounded by `App.tsx`'s top-level 3-tab policy).

## 23. §U — Cut redundant full-log reconstructions from the distribution write path

**Quantified root cause.** A single bulk-assignment call (`useDistributionActions.ts:289-336` → one `appendDistributionEvents` call, not a per-employee loop — the owner's "employee by employee" hypothesis does not match how the code is structured today) triggers `loadDistributionLog` **four separate times**, and each call fully re-lists and re-reads *every file ever written* to the month's `distribution.events/` directory (`distributionStorage.ts:207-214` → `readCurrentDistributionSource` → `loadImmutableDistributionEvents`), a cost that scales with the month's cumulative event history, not with the size of the current batch:

1. `distributionStorage.ts:258` — inside the CAS loop, computing the pre-write state to base the new revision on. **Load-bearing, stays as a full `loadDistributionLog` — this is the one call that legitimately needs the complete merged event list** (to compute `nextRevision` and to preserve full ordering via `preserveAppendedBatchOrder`).
2. `distributionStorage.ts:271` — the in-attempt verify, checking only `verify.revision === nextRevision && verify._writeToken === writeToken`.
3. `distributionStorage.ts:280` — `casLoop`'s delayed lost-update re-check, checking the identical two scalar fields.
4. `useDistributionActions.ts:106` — `refreshDistribution`'s own fresh call, immediately after `appendDistributionEvents` already returned success.

Calls 2 and 3 only ever compare `revision`/`_writeToken` — two scalar fields that live entirely in the compatibility-log file (`distribution.log.json`), **not** in the immutable-events directory (`mergeDistributionLogSources` computes both purely from `currentLog`/`legacyLog`, never from `immutableEvents`) — so both are paying for a full directory scan to check two numbers that a two-file read already has. Call 4 is fetching data that call 1's own CAS attempt already computed and durably wrote moments earlier.

For a mid-month bulk-assign (~1,000 accumulated events), this is roughly **4× a ~1,000-file directory scan for one user action** — the dominant cost in the reported Phase 4 slowness, and one that gets *worse* every subsequent distribution in the same month as event history accumulates, independent of batch size. This matches "gets progressively slower" far better than any per-employee-interleaving explanation.

**Fix — two independent, low-risk changes, neither touching `deriveCurrentDistribution` or the fold algorithm itself:**

1. **Add a lightweight stamp-only reader** in `distributionStorage.ts` that reads just the two compatibility-log files (current + legacy, via the existing `readCompatibilityLog` helper — already used by `readProjectedEventIds`) and returns `{ revision, writeToken }` computed with the same `Math.max`/`selectWriteToken` logic `mergeDistributionLogSources` already uses — **without** calling `loadImmutableDistributionEvents`. Use it in place of `loadDistributionLog` at call sites 2 and 3 above. Removes 2 of 4 full directory scans per append; the two-file compatibility-log read that remains is orders of magnitude cheaper.
2. **Thread the CAS loop's own successful result back to the caller** instead of re-fetching it. `appendDistributionEvents`'s return type grows from `{ok:true} | {ok:false; error}` to `{ok:true; log: DistributionLog} | {ok:false; error}` (`log` is exactly the `updated` object the CAS loop already built and durably wrote — by construction the correct post-write state). `refreshDistribution(monthFolderName, preloadedLog?)` accepts an optional preloaded log and skips its own `loadDistributionLog` call when given one; all five call sites in `useDistributionActions.ts` (`handleAssign`, `handleReassign`, `handleMarkComplete`, `handleRequestReplacement`, `handleApplyBulkAssignment`) pass `result.log` through. Removes the 4th full scan.

Net: 4 full directory reconstructions per append drop to 1. This composes cleanly with the already-written, not-yet-executed Plan 3 (§H Layer 2 incremental cache) — Plan 3's exclusion list already correctly keeps call site 1 (line 258) as a genuinely fresh, undeduped read (it's inside the CAS loop and must see the latest state); this fix does not change what Plan 3 excludes, it only removes two *other* calls that never needed the full read in the first place. Once Plan 3's Layer 2 also lands, call site 1's own scan becomes incremental (only new files since last read) rather than full — stacking with this fix rather than overlapping it.

**Deliberately not done here (bigger, riskier, separate follow-up):** consolidating the one-physical-file-per-event write pattern (`writeImmutableEventBatch`, `distributionStorage.ts:34-56`) into fewer files per bulk operation. This would also cut real cost (roughly 8 round trips per new event today) but requires a migration path for the existing per-event files already on disk in production workspaces and a characterization pass per CLAUDE.md's rule for deterministic distribution logic — out of scope for this addendum, tracked in §26.

## 24. §V — Parallelize workspace boot's sequential structure checks

**Confirmed root cause.** `checkWorkspaceStructure` (`src/data/storage/fileSystemAccess.ts:150-249`), which runs on every workspace attach, reconnect, and reload, performs its existence/read checks as three **sequential** `for...of` loops with `await` inside each iteration: all top-level folders (`allTopFolders`, lines 174-180), then the system subfolders (lines 188-194, itself gated behind resolving the `.system` handle first), then the two required bootstrap files (`requiredFileLocations`, lines 199-221, each a full `readJsonFile` with a `.bak` fallback on failure). None of these checks depend on each other's *results* — they only ever accumulate into the same `missingItems`/`invalidItems` arrays — yet every one runs one-at-a-time. Locally this is invisible (sub-millisecond per check); over a network share each check pays a real round trip, so this single function is a strictly-sequential chain of roughly a dozen network round trips before the workspace can even report its status, every time.

**Fix:** run each loop's checks concurrently with `Promise.allSettled` (not `Promise.all` — a single missing folder must not short-circuit the rest of the scan, matching today's try/catch-per-item behavior exactly) and reassemble `missingItems`/`invalidItems` by concatenating each category's results **in the same category order the sequential code already produces** (top folders, then system subfolders, then required files) — this parallelizes execution while keeping the returned array order byte-identical to today's, so no consumer or test needs to change its assumptions about ordering. The two required-file reads (`requiredFileLocations`) already run through `readJsonFile`, itself untouched — only the loop that awaits each iteration in sequence changes shape, from `for...of` to a mapped `Promise.allSettled`.

## 25. Out of scope for this addendum — Part 4 items

- **Relaxing `safeWriteJson`'s stage/verify/commit cycle** for append-heavy paths (see Part 4's opening note) — real, but this app's only crash-safety guarantee; needs its own dedicated risk review, not a bundled line-item.
- **Consolidating one-file-per-event into fewer physical files per bulk write** (§U) — needs a migration path and its own characterization pass; real follow-up, not done here.
- **Caching the detected workspace layout (current vs. legacy) per session** in `workspacePaths.ts`'s `getRoot` (`src/data/workspace/workspacePaths.ts:43-59`) — investigated and found to be a real *extra* round trip only for workspaces still on the legacy unnumbered folder layout (a current-layout workspace's primary lookup succeeds on the first try, so the fallback branch never executes and there is no double round trip to begin with). Given production workspaces are expected to already be on the current numbered layout, this optimization's real-world payoff is conditional and likely small — not pursued in this addendum to keep scope tight to confirmed, unconditional wins.

---

# Part 5 — Cross-cutting

## 26. Owner decisions needed before implementation

These are genuine trade-offs the two design passes surfaced — not implementer calls:

1. **Reports "studied count" chip shows "—" until the KPI dashboard is opened once** (§L, Tier 2). Recommended over an always-on background read or silently redefining the metric. Confirm, or pick an alternative.
2. **Browse stays memory-resident (up to ~400k rows) whenever Population is in the tab LRU** (§M), extending an already-accepted retention policy one level deeper rather than introducing a new one. Confirm, or take the lower-memory fallback (state preserved, reload cost not fixed).
3. **BrowseDataView search scoped to visible columns only** (§P step 3) — a row matching solely via a hidden column stops matching. Confirm, defer, or reject (keep the wider, slower scan).
4. **The two dead-code items above** (`workspaceDefaults.ts` legacy constructors; v1 deck folder) need direct answers before anyone deletes anything.
5. **Coordination check against `LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`.** CLAUDE.md states that proposal's Phase A→B→C→D order gates any "proposal-covered" finding, and nothing should be implemented independently of that phase order. Phase A has shipped. **Before implementing §H's Layer 2 (incremental cache) or §I (report-model cache), confirm neither is already meant to be superseded by that proposal's Phase B (worker-owned paging) or Phase C (partitioned storage + bounded LRU)** — if either overlaps, this design folds into the proposal's sequencing rather than landing alongside it.
6. **§S–§V (this addendum) were explicitly exempted from the owner-question step** — decided inline in Part 4 rather than listed here, per the owner's instruction for this round of work.

## 27. Out of scope (explicitly deferred)

- **Bulk-write atomicity / in-progress marker** (§A/§H area). Owner chose "just make it fast enough" — the read-path fix shrinks but does not close the window where a concurrent reader could see a partial bulk-assignment. Revisit if observed in practice.
- **Event-log partitioning/sharding**, a Phase-C-style change for `distribution.events/`. Rejected: event counts scale with monthly activity, not population size, unlikely to justify partitioning; would also reintroduce a shared-mutable-index race the current one-file-per-event design deliberately avoids.
- **Extending approval to the recommended-candidate replace path.** Owner confirmed it stays instant; only its visual state changes (§C).
- **Moving SheetJS execution into a Worker** (§K) — real follow-up, not designed here; §K only chunks the assembly step, not the final serialize.
- **Font subsetting/weight reduction** (§Q) — owner-facing decision, separate from the duplication fix.
- **Cross-file backup consistency** (§O) — e.g. an interrupted restore leaving `month.manifest.json`'s row count out of sync with `population.final.json`. Pre-existing today (sequential order isn't a transaction either); concurrency doesn't add this failure mode, but doesn't remove it either. The two new sentinel files (§O) make interruption *detectable*, not prevented.
- **Phases B/C/D of the existing large-population proposal** (worker-owned paging, partitioned population storage) — remain their own gated, unapproved effort; §L/§M/§P are explicitly framed as mitigations that Phase B would make partially redundant, not replacements for it.

## 28. Recommended sequencing

Merged from both design passes, ordered by risk/payoff — each step independently shippable and revertible. **§S–§V (this addendum) are inserted at the front** — they're the owner's most recently reported, highest-frustration items (production network-share slowness, a still-open double prompt, Phase 4 write slowness), all low-risk and already fully grounded:

| Order | Work | Risk | Payoff |
|---|---|---|---|
| 0a | §S One `readwrite` grant, not two | very low, 2-line change | closes the still-open double-prompt complaint |
| 0b | §U Cut redundant distribution-log reconstructions | low, additive helper + return-type widen | dominant Phase 4 write-side cost |
| 0c | §V Parallelize `checkWorkspaceStructure` | low, order-preserving | every workspace attach/reconnect/reload, worst on UNC |
| 0d | §T Sub-tab mount preservation (EmployeeWorkspace, Reports outer swap) + §M (Browse) | low, bounded mount counts | closes "reloads from 0 on navigation" |
| 1 | §J `groupRows` O(n²) fix | trivial | immediate, every report |
| 2 | §H Layers 0–1 (shim dedup + parallel reads, all 3 loaders) | low | fixes items 1,2,6,7,8 + the answers/approvals twin bug |
| 3 | §O `loadArchiveStatus` concurrency (pairs with #2) | very low, read-only | Archive tab |
| 4 | §Q Font dedup | low (snapshot discipline) | **largest single bundle win**, −7.3% raw |
| 5 | §G Workspace-switch fix | low, isolated | closes the correctness bug |
| 6 | §H Layer 3 (dedupe) | medium — see owner decision §26.5 | compounds #2 |
| 7 | §B, §C, §D, §E, §F (original UI/workflow fixes) | low | the original 4 complaints, fully resolved |
| 8 | §L Phase-aware loading + Reports meta | medium | Population/Reports landing cost |
| 9 | §P Search debounce + normalization hoist (steps 1–2) | very low | keystroke latency |
| 10 | §N Code-splitting: builders (§N first bullet) + ReportDesigner | low | boot eval time |
| 11 | §H Layer 2 (incremental cache) | medium — gated on §26.5 | the biggest remaining click-latency win |
| 12 | §I Report-model cache + KPI widget rewire | medium — gated on §26.5 | report/export regeneration cost |
| 13 | (§M folded into 0d above) | — | — |
| 14 | §N remaining tab boundaries + lint guard | medium | boot eval, non-admin roles |
| 15 | §K XLSX/CSV yielding | low–medium (reentrancy care) | large export freeze |
| 16 | §O backup/restore concurrency + sentinels | **highest** — write path | backup/restore wall time |
| 17 | §R dead code + consolidation | low | hygiene, small security win |

## 29. Testing

Per CLAUDE.md's rule that deterministic logic (sampling, distribution event folding, report/export builders) must be **characterized before** it's changed, not after — the precedent to copy throughout is `distributionReport.test.ts:68-101`: a golden snapshot with `vi.useFakeTimers({ toFake: ["Date"] })` (never a bare `useFakeTimers()` — this codebase relies on real `setTimeout` for its yield idiom) and an explicit rule that a snapshot update must never paper over a regression.

**Part 1 (original scope):**
- Golden-fixture test for current distribution fold output, written before touching `loadImmutableDistributionEvents`/`loadOrDeriveDistributionCurrent`.
- Concurrent-read ordering test; incremental-catch-up correctness test (new-files-only diff matches a full read).
- Update `sampleApprovalRules.test.ts`/`PhaseThreeSampling.test.tsx` for the removed gate.
- Update `XrayReferrals.test.tsx`/`XrayInspectionResults.test.tsx` for pending/resolved visual states.
- New test for `ReplacementRequest` pending state (currently untested).
- `WorkspaceProvider.test.tsx`/`AuthGate` tests for the deferred activity-log flush and `usersHydrated`-gated tab rendering.
- New test for §G: connecting workspace B (same-named month folder as workspace A) reloads B's data.
- `distributionLog.test.ts`'s reopen-request coverage is untouched, must stay green unmodified.

**Part 2 (§H–§K):**
- New `directoryScan.test.ts`: order-preservation, bounded concurrency (deferred-promise harness asserting peak in-flight ≤ limit), deterministic-lowest-index failure under `"throw"` (repeated ~50× to catch races), `"skip"` behavior, permission-loss short-circuit.
- Per-loader: `{trackReads:true}` + `getReadLog` diffing — identical results, identical read-log set, existing corrupt-file behavior unchanged.
- New `distributionEventStore.incremental.test.ts`: cold→warm zero-reads; one new file → exactly one read; out-of-order `eventAt` arrival still folds correctly; file disappearance triggers full re-read; two-workspace isolation; manual-refresh forces full re-read.
- New `inFlightReads.test.ts`: overlapping calls share one promise/one read; post-settle calls re-read; rejection isn't cached; epoch bump forces fresh read after write. **Critical regression case:** drive `approveReferral` with a competing decision file appearing mid-flow — must still return `already-reviewed`. Written and passing *before* any dedupe migration.
- New `reportModelCache.test.ts`: identity + single-build on repeat call; **table-driven key-completeness test, one case per `ExecutiveReportInput` field** (each must independently change the key); LRU eviction at bound; freeze throws on mutation attempt; refresh-signal clears cache. Then: **zero snapshot deltas** across every existing report/deck/workbook snapshot after switching call sites to the cache — any delta means the cache is wrong, hard gate. Cross-format identity test: one input → document+deck+xlsx, assert `buildReportModel` called exactly once.
- New `executiveKpiProfiles.test.ts` (doesn't exist today) pinning `buildPortProfiles`/`buildStageProfiles` output including tie-order, before touching `groupRows`.
- Per-sheet AOA snapshots (`XLSX.utils.sheet_to_json(..., {header:1})`) for each workbook builder before async conversion, asserted byte-identical after. CSV: snapshot `toCsvString` first, then assert `[...toCsvChunks(...)].join("")` matches.

**Part 3 (§L–§R):**
- Unit tests for `computeMonthLoadScope`/`needsPopulationForPhase` covering every phase × role × sub-tab combination, including the phase-2 preview and orphan-scan cases that justify including phase 2 (not phase 3 alone).
- Regression test for the phase-2→3 race (`ensurePopulationLoaded()` awaited, not read from possibly-stale state).
- `Reports/index.tsx` meta-effect test: asserts zero `population.final.json`/`loadAllEmployeeFiles` reads on landing (via read-log tracking), studied-count populated correctly once the KPI section has been visited.
- Browse mount-preservation test: state (search/filters/page) survives a Process→Browse→Process→Browse round trip; still reloads correctly on month/workspace change.
- Bundle/eval tests: confirm via build output that lazy-boundary modules are absent from the main chunk (grep the built file for a unique string constant in each, e.g. from `deck2/slides.ts`); `performance.now()`-based boot-time comparison fixture for `employee` vs `admin`.
- `mapWithConcurrency` unit tests mirroring `directoryScan`'s: order preservation, fail-fast-then-drain, bounded fan-out.
- Backup/restore integration test asserting the copied/restored manifest list is deterministic (same input order every run) under concurrency; sentinel-file presence/absence tests.
- `BrowseDataView` search tests: debounce timing, normalization-hoist output equivalence, visible-columns-only behavior change explicitly asserted (once §26.3 is decided).
- Font-dedup: zero snapshot deltas on every report/deck snapshot; a build-output assertion that the Somar Sans base64 payload appears exactly once (mirroring how IBM Plex already does).
- Dead-code removals: `npm run lint` (`--max-warnings 0`) as the arbiter for orphaned imports/types; consolidation changes must produce zero snapshot deltas.

**Part 4 (§S–§V, this addendum):**
- `WorkspaceProvider.test.tsx`: attach flow requests `showDirectoryPicker`/`selectWorkspaceDirectory` with `"readwrite"` (not `"read"`); reconnect flow calls `ensureDirectoryPermission` with `"readwrite"`; a permission mock that only ever grants `"read"` still leaves the app usable read-only (no regression for a user who denies write).
- New test asserting `refreshDistribution`, `checkWorkspaceStructure` (missingItems/invalidItems array order), and every existing `distributionLog.test.ts`/`distributionEventStore.test.ts` case stay green unmodified — §U and §V change *how* data is fetched, never *what* is returned.
- New test: `appendDistributionEvents` on a fixture with N pre-existing immutable event files calls `loadImmutableDistributionEvents`-backed `loadDistributionLog` exactly once per append (via `{trackReads:true}`/read-log diffing, the established pattern), not four times — regression guard for §U's whole point.
- New test: the stamp-only reader (§U fix 1) returns the same `{revision, writeToken}` as the full `loadDistributionLog` would, across current-only, legacy-only, and both-present fixtures.
- `checkWorkspaceStructure` test: with several folders/files deliberately missing, `Promise.allSettled`-based version returns the identical `missingItems`/`invalidItems` arrays (same order) as a snapshot captured from the pre-change sequential version — byte-identical output is the whole point of §V, not just "still detects missing items."
- Mount-preservation tests for EmployeeWorkspace and Reports mirroring the Browse one already planned in Part 3: state survives a round trip across sub-tabs (e.g. draft text in `XrayReferrals`, scroll/filter state in `XrayInspectionResults`, `ReportDesigner`'s in-progress canvas edits survive a visit to the KPI dashboard and back); a sub-tab whose permission check fails is never mounted/added to the visited set; a sub-tab whose permission is revoked mid-session drops out of the visited set on the next render.

**Repo-level gates for every step in this plan:** `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run check:complexity`, `npm run check:bundle-size`, `npm run check:release`. Per CLAUDE.md, every edit gets a `docs/edit logs/YYYY-MM-DD.md` entry with `**Before:**`/`**After:**` snippets and a `**Lines:**` stat from `npm run count-lines -- --quiet` run before and after.

## 30. Key files reference

| Area | Files |
|---|---|
| Distribution read/write | `src/data/distribution/distributionEventStore.ts`, `distributionStorage.ts`, `distributionTypes.ts` |
| Sample approval gate | `src/components/Sidebar/Tabs/Population/index.tsx`, `components/PhaseThreeSampling.tsx`, `src/data/sampling/sampleApprovalRules.ts` |
| Replace/reassign UI | `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`, `XrayInspectionResults.tsx` |
| Referral/replacement requests | `src/data/referral/referralStorage.ts`, `referralTypes.ts`, `approveReferral.ts` |
| Bulk assignment | `src/components/Sidebar/Tabs/Population/useDistributionActions.ts`, `src/data/distribution/bulkAssignment.ts` |
| Approve/deny screen | `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/index.tsx`, `useApprovalData.ts`, `HistoryView.tsx` |
| Processing/save | `src/data/population/populationStorage.ts`, `replacementIndexStorage.ts`, `src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts` |
| Permission prompt | `src/data/workspace/WorkspaceProvider.tsx`, `src/data/storage/fileSystemAccess.ts`, `workspaceWriteAccess.ts`, `src/auth/AuthGate.tsx`, `authActivityLog.ts` |
| Menu flash | `src/App.tsx`, `src/data/workspace/WorkspaceGate.tsx`, `WorkspaceProvider.tsx`, `src/auth/userManagement.ts` |
| Workspace-switch data leak | `src/components/Sidebar/Tabs/Population/useMonthLoad.ts`, `src/data/month/globalMonthLogic.ts` |
| Shared directory-read primitive | `src/data/storage/directoryScan.ts` (new), `src/data/storage/inFlightReads.ts` (new), `src/data/answers/answerStorage.ts`, `src/data/approvals/approvalStorage.ts` |
| Report-model cache | `src/data/reporting/executive/model/reportModelCache.ts` (new), `reportModel.ts`, `src/data/storage/safeWrite.ts` (`readEnvelopeStamp`) |
| KPI widget rewire | `src/components/Sidebar/Tabs/ReportDesigner/renderers/KpiRenderer.tsx`, `src/data/reportDesigner/query/runQuery.ts`, `filters.ts` |
| O(n²) fix | `src/data/reporting/executiveKpiProfiles.ts` |
| Export yielding | `src/data/storage/yieldToMain.ts` (new), `src/data/reporting/distributionReport.ts`, `sampleReport.ts`, `executive/workbook/workbook.ts`, `management/managementWorkbook.ts`, `src/data/powerbiExport/exportManager.ts`, `exportWriter.ts`, `csvSerializer.ts` |
| Phase-aware population loading | `src/components/Sidebar/Tabs/Population/populationWorkflowHelpers.ts`, `useMonthLoad.ts`, `index.tsx`, `PopulationWorkflowChrome.tsx` |
| Reports lightweight meta | `src/components/Sidebar/Tabs/Reports/index.tsx`, `src/data/backup/backupStorage.ts` (`populationStageReached` extraction), `src/data/population/monthStatus.ts` (new) |
| Browse mount preservation | `src/components/Sidebar/Tabs/Population/index.tsx`, `BrowseDataView.tsx` |
| §S Permission prompt root fix | `src/data/workspace/WorkspaceProvider.tsx` (lines 176-179, 209) |
| §T Sub-tab mount preservation (EmployeeWorkspace, Reports) | `src/components/Sidebar/Tabs/EmployeeWorkspace/index.tsx`, `src/components/Sidebar/Tabs/Reports/index.tsx` (the `ReportsTab` wrapper only, not `ReportsContent`'s internals) |
| §U Distribution write-path redundant reads | `src/data/distribution/distributionStorage.ts` (`appendDistributionEvents`, new stamp-only reader), `src/components/Sidebar/Tabs/Population/useDistributionActions.ts` (`refreshDistribution` + its 5 call sites) |
| §V Workspace boot parallelization | `src/data/storage/fileSystemAccess.ts` (`checkWorkspaceStructure`) |
| Code-splitting | `src/components/Sidebar/Tabs/Reports/index.tsx`, `src/App.tsx`, `tabRegistry.ts`, ESLint config (`no-restricted-imports`) |
| Backup/restore concurrency | `src/data/storage/concurrency.ts` (new), `src/data/backup/backupStorage.ts` |
| Browse search | `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`, `src/components/DataTable/index.tsx` (reference pattern) |
| Font dedup | `src/branding/somarFonts.ts` (new), `src/branding/fonts.ts`, `src/index.css`, `src/main.tsx`, `src/data/reporting/executive/theme.ts` |
| Dead code / consolidation | `src/data/reporting/executive/primitives.ts`, `htmlReport.ts`, `executiveReportData.ts`, `slideKit.ts`, `src/data/storage/fileSystemAccess.ts`, `src/auth/userManagement.ts`, `src/data/reporting/shared/reportChrome.ts`, new `Population/processing/textNormalization.ts` |
