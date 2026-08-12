# Perceived-Performance & Sync Enhancement — Spec + Implementation Plan

**Date:** 2026-08-12
**Revision:** r2 — post-review, implementation-ready
**Status:** approved for Milestone 0 + Slice A; Phases 1–4 approved in principle, gated on Milestone 0 evidence
**Owner goal (verbatim):** *"my goal is to have a smooth experience for EMP and supervisor and manager, the admin i dont really care. I dont want the app to keep refreshing or feel slow or unsynced. i want it fast efficient Smart. once it load for the first time in booting it doesnt say refresh ever again in all pages or freeze until it refresh."*

**Prime directive for every change in this document: enhance the app, do not break it.** A change that makes the
app feel faster while making it show wrong data is a net loss. Where this spec cannot make a guard airtight, it
says so explicitly rather than hiding it.

**What changed in r2.** Two independent reviews found that three Slice A items could not be built from the r1
text without the implementer inventing intent, that one item was a net regression for the priority persona, and
that the spec was silent about a TanStack Query invalidation authority that already exists in-tree and would
have made the central mechanism a no-op. Every Slice A item below now names the exact file, function, edit,
DONE criteria, and parallel-safety class. §3.2 records where a reviewer was wrong about the code, with the
refuting citation, so those points are not silently re-proposed either.

---

## 1. Problem statement

The app re-reads workspace JSON from a slow UNC share far more often than the data changes, and several views
blank to a spinner while it happens. The felt symptoms — "keeps refreshing", "freezes", "unsynced" — come from
four distinct mechanisms, only one of which is raw load time:

1. **Blanking on background refresh.** Two views unconditionally `setLoadState("loading")` on the periodic tick.
2. **Full reload as the sync mechanism.** Eight subscribers to `xray-data-refresh` respond by re-running their
   entire load function, whether or not anything changed.
3. **Readers that write.** Opening a month fires an unawaited multi-MB cache write from a *read* path, so N
   machines opening the same month generate N large writes of byte-identical data.
4. **Warm-up product stored in `useState`.** The 3-tab LRU (`src/App.tsx:211`) evicts a tab and destroys
   everything it loaded, so returning to it pays a full cold read.

## 2. Constraints (owner decisions — not open for redesign)

| Constraint | Detail | Delivered by |
|---|---|---|
| Sync cadence | 30–60 s, plus on window focus | A7 commits 2 and 3 (r1 never implemented this — see §3.2 C7) |
| Dataset residency | Only the selected month's **heavy** datasets are resident; switching months evicts them | Phase 2 `removeQueries`; A1 must not silently widen it |
| Cross-month KPI | Required, but must not grow memory or make the app heavy | §4.6 |
| Population paging | Approved in scope (Phase C of `LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`) | Phase 4 |
| Priority personas | employee, supervisor, manager. Admin experience is explicitly deprioritized | A1's landing rule, A2, A6 |

---

## 3. Verified facts this spec is built on

Each was read in the working tree, not recalled. These are load-bearing; if one is wrong, the design element
resting on it must be revisited. F1–F15 are from r1 (corrections marked); F16–F24 were added by the r2 review
and every one was re-read at the cited line.

| # | Fact | Evidence |
|---|---|---|
| F1 | The streamed envelope writer emits `{"data":…,"metadata":{…}}` — **metadata last**, necessarily, because the content hash over `data` must exist before metadata can be built. Key order is explicitly documented as irrelevant to `isEnvelope`/`unwrap`. | `src/data/storage/safeWrite.ts:228-252` |
| F2 | `readEnvelopeRevision` parses the whole file. There is no cheap prefix probe for a JSON envelope, and F1 means one cannot be added without changing the writer. | `safeWrite.ts:600-617` |
| F3 | `loadOrDeriveDistributionCurrent` — a **read** path — fires `void saveDistributionCurrent(...)`, unawaited, from **two** sites: the checkpoint-resume path and the full-refold path. Every peer that opens a month rewrites the cache on byte-identical data. | `distributionStorage.ts:580, 676` |
| F4 | A cheap distribution change stamp **already exists**: `readDistributionLogStamp` reads only the two small compatibility logs and returns `{revision, writeToken}`. Its revision comes from `appendDistributionEvents`, never from `saveDistributionCurrent` — so it is structurally immune to F3. It is currently **module-private**. | `distributionStorage.ts:232-260` (declaration at `:240`) |
| F5 | `safeWriteJson` returns `void`, and its post-commit check is weaker for small files than large: `skipVerify = compact.length > VERIFY_SIZE_LIMIT` (512 KB, `:133`); large files get a byte-exact compare, small (more contended) files only `parseValidJson(verify) !== null`. A peer's valid envelope passes. | `safeWrite.ts:432, 462-464` |
| F6 | The employee read path loads the workspace-wide `distribution.current.json`, then loads the lean per-employee mirror, and uses the mirror only as a `??` fallback — then filters client-side. `sample.master.json` is loaded solely to feed the derivation. | `XrayReferrals.tsx:499-521, 532` |
| F7 | The mirror does not carry quotas; the daily quota is read from `dist.quotas[username]`. | `XrayReferrals.tsx:535` |
| F8 | `syncSampleMirrors` builds `entriesByEmployee` from `current.entries` and writes only for employees present in that map. An employee whose last assignment is reassigned away is never rewritten and keeps a stale mirror indefinitely; a monotonic revision guard reinforces this. | `sampleMirrorStorage.ts:71-92` |
| F9 | B5 shipped: mirror/distribution entries carry a 17-field `EmployeeMirrorRowStub`, enforced by a contract test. Old entries are never rewritten in place. | `populationTypes.ts:88-131` |
| F10 | Two views refresh silently and correctly; two blank unconditionally. | `XrayReferrals.tsx:470-497, 597` and `XrayInspectionResults.tsx:317` (correct); `NotificationManager.tsx:75, 93` and `useApprovalData.ts:105, 194` (blanking) |
| F11 | `bulkDecision` awaits `approve`/`deny` per item, and each of those awaits a full `loadData()` — which blanks, does a cross-month pending scan, loads `sample.master`, and derives distribution. | `useApprovalData.ts:404-418`; reload sites `:221, 248, 276, 303, 332, 359` |
| F12 | Population defaults to the `process` sub-tab, which sets `population: true, raw: true` in the load scope **only** for a viewer holding `draw-sample` or `process-population`; `useMonthLoad` re-runs that scope on every periodic tick. | `Population/index.tsx:175`; `populationWorkflowHelpers.ts:74-88`; `useMonthLoad.ts:267-305` |
| F13 | `markBootSourceLoaded` is called **inside** the view's load function. A TanStack `queryFn` does not run on a cache hit — so a naive migration means the boot source never marks loaded on a second mount and the splash never reaches `allLoaded`. | `XrayReferrals.tsx:486-490` |
| F14 | The v61.0 distribution rewrite cut write ops 192,063 → 78, but the edit log states plainly these are Node `fs` numbers and **not a browser prediction**. The benchmark never calls `saveDistributionCurrent`, so the slowest half of a real save is uncovered. | `docs/edit logs/2026-08-07.md:167-185`; `scripts/bench/bench-distribution.mjs` |
| F15 | `foldDistributionEvents` drops any event whose `xrayImageId` is absent from `sampleRows` with a **bare `continue` placed before `recordDroppedEvent`** — so the drop is neither reported in `droppedEventIds` nor logged. Callers pass `sample?.rows ?? []`. Under a forced re-derive with a missing `sample.master.json` this yields `entries: []`, which the read path then writes as the cache; the next reader's fast-path guard passes because `logRevision`/`eventSetId` still match. | `distributionDerivation.ts:139-141` (bare `continue`), `:145` (first real `recordDroppedEvent`), `:109` (helper); `distributionStorage.ts:643-650` |
| **F16** | **TanStack Query is already installed, mounted, and wired as an invalidation authority.** `queryClient.ts` sets `staleTime: Infinity` with every refetch trigger off; `queryRefreshBridge.ts:20` calls **unscoped** `queryClient.invalidateQueries()` on **any** `xray-data-refresh` broadcast, by explicit design ("deliberately dumb"); mounted at `main.tsx:41`, bridged at `App.tsx:47`. `monthFoldersQuery.ts:29-30` keys on `directoryHandle?.name`, not `workspaceScopeId`. | `src/data/query/queryClient.ts`, `queryRefreshBridge.ts:18-23`, `monthFoldersQuery.ts:29-30`, `main.tsx:41`, `App.tsx:26,47` |
| **F17** | **`AuthGate` is the parent of `GlobalMonthProvider`.** The 3-minute tick lives in AuthGate's own body at `:333-350` (`AUTO_REFRESH_INTERVAL_MS = 3 * 60_000` at `:337`, `document.hidden` skip at `:345`, `refreshPermissions()` at `:346`, `broadcastDataRefresh("periodic")` at `:347`); `GlobalMonthProvider` is rendered *by* AuthGate at `:608`. AuthGate therefore **cannot** call `useGlobalMonth()`. | `src/auth/AuthGate.tsx:333-350, 608` |
| **F18** | **`saveDistributionCurrent` has exactly one non-read caller in the entire tree: `useDistributionActions.ts:139`.** `bulkAssignment.ts:362`, `approveReferral.ts:268`, `adhocImportAssignment.ts:185`, `reopenAnswer.ts:83` and `populationStorage.ts:949` call `loadOrDeriveDistributionCurrent` to *validate before* appending events, and never persist afterwards. Today the post-event cache and mirror refresh for those four flows happens **only** as a side effect of the next reader's F3 fire-and-forget write. | `grep saveDistributionCurrent src/` → `useDistributionActions.ts:139`, `distributionStorage.ts:402, 580, 676` only |
| **F19** | `syncSampleMirrors` is reachable **only** from `saveDistributionCurrent` (`distributionStorage.ts:411`). Removing the read-path save therefore also removes every mirror refresh those readers were performing. | `distributionStorage.ts:402-412`; `sampleMirrorStorage.ts:45` |
| **F20** | `saveDistributionCurrent` calls `ensureMonthWritable` first (`distributionStorage.ts:408`), which throws `MonthClosedError` on a closed month (`monthLock.ts:119-127`); and `autoLockWhenFullyDistributed` (`useDistributionActions.ts:140, 156-179`) closes a month automatically once every sample row carries an entry. **Consequence: on a closed month the read-path cache write already fails today** — A6 changes nothing there. | `distributionStorage.ts:408`; `population/monthLock.ts:119-127`; `useDistributionActions.ts:140, 156-179` |
| **F21** | `listDirectoryEntries` returns **only `{name, kind}`** — no size, no mtime. A name-diff can detect a *new* employee/supervisor file but **cannot** detect a request appended into an *existing* `{user}.answers.json`. Byte size requires one `getFileHandle` + `getFile()` per file, exactly as `readSegmentTails` already does (`directoryScan.ts:339-341`). §4.2's r1 claim "diff by listing, **never per file**" was therefore false for both `readSegmentTails` and any answers-directory diff. | `directoryScan.ts:44-52` (listing shape), `:339-341` (per-file `getFile`) |
| **F22** | Each of `loadReferralLog` / `loadReplacementLog` / `loadReopenLog` independently calls `loadAllEmployeeFiles` **and** `loadAllSupervisorDecisions` (`referralStorage.ts:43-46, 120-123, 174-177`), neither of which is cached (`readJsonDirectory`, `directoryScan.ts:150-161`). `useApprovalData.ts:107-111` calls all three concurrently for the selected month and `:132-139` calls all three again **per other month**. Both loaders degrade independently to `[]` on failure (`answerStorage.ts:333-336`; `approvalStorage.ts:91-93`). | as cited |
| **F23** | `readUserManagementState()` returns the module-level runtime object when set, but a **fresh** `createEmptyUserManagementState()` object on every call when it is null. | `src/auth/userManagement.ts:588-590` |
| **F24** | `DataTable` resets to page 1 keyed on `rowsPageKey = ${rows.length}:${firstRowKey}:${lastRowKey}` — **not** on row-array identity. `BrowseDataView` additionally sets `loading = true` and renders `LoadingState` **in place of the whole table** on every load-effect re-run, including `refreshKey` bumps after wizard mutations, despite having previously rendered rows. | `DataTable/index.tsx:326-327`; `BrowseDataView.tsx:584-589, 1043` |

### 3.1 Explicitly rejected premises

Recorded so they are not re-proposed:

- **A 1 KB envelope-prefix probe.** Refuted by F1 for the largest file in the app.
- **`revision` as a universal change signal.** Refuted by F3.
- **A single cache authority.** False as stated: `inFlightReads`, the append-only directory cache, the on-disk
  fold checkpoint, and the population worker's `cachedRows` each have correct, deliberate, independent
  invalidation. The achievable rule is *two tiers* (§4.1).
- **Month-granular residency.** Some cross-month reads are small and deliberate (pending-only request logs, tiny
  per-employee mirrors). Residency is a property of **heavy datasets**, not months.
- **A per-month `kpi.summary.json` on disk.** Its fingerprint omitted the inspection template — already a shipped
  bug where KPI tiles disagreed with the executive report — and omitted any algorithm version, a lesson
  `DERIVE_VERSION` already taught. Replaced by in-memory, month-scoped memoization (§4.6).
- **"Immutable after processed" file classification.** `population.final.json` and `sample.master.json` are not
  immutable (reprocess, re-draw), and `month.manifest.json` changes on lock/unlock.
- **NEW — "gate the tick on the distribution stamp".** Rejected in this revision: the distribution stamp is
  bumped only by `appendDistributionEvents` (F4), so a whole-tick gate on it starves notifications, new
  referral/replacement/reopen requests, answer submissions, manifest changes, and permission propagation. The
  replacement is the per-family change set in §4.2.
- **NEW — reading auth state from inside `src/data/`.** Rejected: it inverts the two-persistence-layer rule in
  `CLAUDE.md` and, for A6 specifically, gates on the wrong axis (F18 — a manager doing a pure read would still
  write; a supervisor's genuine write path would be spared nothing). The read/write split already exists in the
  `…ForRead` function names; §4.3 uses that.

### 3.2 Corrections to the two r2 reviews

Both reviews were substantially right. These specific claims are not:

- **C1 — "A6 makes the locked-month case unbounded; nothing can ever repair the cache."** Overstated.
  `saveDistributionCurrent` already throws on a closed month via `ensureMonthWritable`
  (`distributionStorage.ts:408` → `monthLock.ts:119-127`), so the read-path write **already fails there today**
  (F20); the failure is swallowed by `logRejection("distribution:cache-write")`. A6 does not change closed-month
  behaviour at all. The in-memory derive memo is still **required** — but for the `DERIVE_VERSION`-bump and
  late-event refold cases, not for auto-lock. Retained as A6c with the corrected rationale.
- **C2 — "the four write paths already await `saveDistributionCurrent`, just verify it."** False, and this is the
  most consequential correction in the review round. F18: `saveDistributionCurrent` has exactly **one** non-read
  caller. `bulkAssignment`, `approveReferral`, `adhocImportAssignment` and `reopenAnswer` never persist. A6
  without A6b would therefore freeze the cache **and** every mirror for approvals, reopens, ad-hoc assignment and
  bulk reassignment — a data-freshness regression, not a perf win. A6b is now mandatory and blocking.
- **C3 — "diff the answers/decisions directories by listing (name + size)".** Not achievable with the existing
  helper: `listDirectoryEntries` returns `{name, kind}` only (F21). Size costs one `getFile()` per file. The
  round-trip budget in §4.2 is now stated explicitly instead of assumed away, and r1's own "never per file"
  sentence is retracted.
- **C4 — "`readSegmentTails` is a pure listing".** False: `directoryScan.ts:339-341` does
  `getFileHandle` + `getFile()` per segment (F21). §4.2's cost model is corrected.
- **C5 — "land on `browse` whenever `can('view-browse')`".** Correct about the permission gate and about
  `visitedSubTabs`, wrong about the cost: `BrowseDataView.tsx:593-597` reads the month's entire
  `population.final` on mount with no already-loaded guard, while `computeMonthLoadScope`
  (`populationWorkflowHelpers.ts:79-86`) returns `population: false` for a viewer without `draw-sample` /
  `process-population`. An unconditional browse landing charges the #1 priority persona a multi-MB UNC read it
  pays nothing for today. A1's rule below is the intersection of both reviews' conditions.
- **C6 — "gate the proactive `ensurePopulationLoaded()` behind Phase 2/3" (r1's own A1 text).** That gate already
  exists: `Population/index.tsx:524-529` is already `activeSubTab !== "process" || currentPhase !== 3` plus a
  capability check. The clause is deleted and replaced with a verification-only instruction.
- **C7 — "the plan delivers §2's 30–60 s + focus cadence".** It did not: no r1 item touched
  `AUTO_REFRESH_INTERVAL_MS` (`AuthGate.tsx:337`) or added a `visibilitychange` listener. Now A7 commits 2 and 3.
- **C8 — "A5 saves I/O".** It does not; `userDisplayMap` (`useApprovalData.ts:75-76`) is a render-time object
  allocation. Combined with F23 it is the only wrong-data risk in the slice for zero I/O benefit. **A5 is
  dropped** — see the Slice A table.

---

## 4. Design

### 4.1 Cache tiers

Two tiers, each with one owner:

- **View-facing tier — TanStack Query** (already mounted, F16). No view owns workspace data in `useState`. Keys
  are `[workspaceScopeId(root), monthFolderName, dataset]`, reusing `workspaceScopeId` from
  `src/data/storage/inFlightReads.ts:34` rather than `handle.name`.
- **I/O-facing tier — the existing storage caches.** `dedupeInFlight`, the append-only directory cache, the fold
  checkpoint, and the worker's `cachedRows` keep their own invalidation, keyed by `workspaceEpoch`.

**Rule:** a Query invalidation must be paired with `bumpWorkspaceEpoch(root, month)` to actually reach disk.
Invalidating one tier alone is a silent no-op — and `queryRefreshBridge.ts:20` is that exact counterexample
living in-tree today (F16): it invalidates every registered query on every broadcast, which is why A7's gate is
worthless until the bridge is narrowed in the same commit.

**Dataset residency:** on month switch, `removeQueries` the heavy keys only — `population.final`,
`sample.master`, `distribution.current`. Small cross-month reads stay free.

### 4.2 Sync tick — change-set driven, not reload-driven

Replaces the periodic full reload. The tick computes a **per-family change set**, never a single global gate.

Per tick, for the currently selected month:

| Family | Probe | Cost (round trips) |
|---|---|---|
| `distribution` | `readDistributionLogStamp` (F4) — compare `{revision, writeToken}` | ~4–6 small reads |
| `notifications` | read `5-system/…/notifications.json` outright, compare envelope `contentHash` | 1 read (small file, capped at 500 entries — `notificationStorage.ts:24`) |
| `requests` + `answers` | list the answers dir and the approvals dir, then `getFile()` each matching file for `size` — compare the `name→size` map (F21) | 2 listings + N + M `getFile()` calls, **no content transfer** |
| `manifest` | `readEnvelopeRevision(monthDir, "month.manifest.json")` — small file, full parse is fine (F2) | 1 read |

**Honest cost statement (replaces r1's "never per file"):** an unchanged tick costs
`2 (compat logs) + 1 (notifications) + 2 (listings) + N+M (answers/decisions getFile) + 1 (manifest)` round
trips. For a 20-employee month with 3 supervisors that is ~29 round trips of metadata, versus today's tick which
re-reads `sample.master.json` and re-derives `distribution.current.json` in five separate views. `getFile()`
returns a `File` handle without reading content — this is the same mechanism `readSegmentTails` already relies on
(`directoryScan.ts:339-341`) and the same reason it prefers `size` over `lastModified` (clock skew on a share).

**Permissions are never gated.** `refreshPermissions()` (`AuthGate.tsx:346`) stays on its own unconditional path,
outside the change set — an admin revoking access must propagate even when no data changed.

**Broadcast contract.** `DataRefreshSource` (`dataRefreshSignal.ts:29`) gains a third form. The event detail
becomes:

```ts
export type DataRefreshFamily = "distribution" | "notifications" | "requests" | "answers" | "manifest";
export type DataRefreshDetail =
  | { source: "manual" }                                   // discard everything — unchanged semantics
  | { source: "periodic"; changed: ReadonlySet<DataRefreshFamily> };
```

`broadcastDataRefresh("manual" | "periodic")` keeps working (back-compat overload) so no existing subscriber
breaks mid-migration; `subscribeToDataRefresh` keeps delivering the bare source string to callbacks that declare
one parameter. Subscribers that want the change set opt in via a new `subscribeToDataChange(families, cb)`.

Unchanged ⇒ zero invalidation, zero setState, zero re-render, zero large reads.
Changed ⇒ invalidate only that family's keys, and `bumpWorkspaceEpoch`.

Manual refresh keeps its unconditional discard-everything path (`dataRefreshSignal.ts:19-28, 31-33`), which is
the safety valve if a family probe ever misses a mutation class.

**Rule:** the change detector must never read `distribution.current.json`. It is the file A6 stops writing, and
using it as a signal would couple the gate to the cache it is meant to make optional.

### 4.3 Readers stop writing

Three coupled changes, all in `src/data/distribution/distributionStorage.ts` unless noted.

**(a) Mechanism — an options parameter, not a permission check.**
`loadOrDeriveDistributionCurrent(dir, month, sampleRows, opts?: { persistCache?: boolean })`, defaulting to
`persistCache: true`. Both `void saveDistributionCurrent` sites (`:580` inside `tryResumeFromCheckpoint`, `:676`
in the full-refold path) become `if (persistCache) void saveDistributionCurrent(...)`.
`loadOrDeriveDistributionCurrentForRead` (`:705`) passes `{ persistCache: false }` unconditionally. The read/write
split already exists in the function names; no auth import enters `src/data/`.

**(b) The write paths must now persist explicitly (F18, correction C2).** Because
`saveDistributionCurrent` has exactly one non-read caller today, (a) alone would freeze the cache and every
mirror (F19) for approvals, reopens, ad-hoc assignment and bulk reassignment. A6b adds an awaited refresh at the
end of each of those flows — see the Slice A table.

**(c) Session-scoped derive memo.** A month whose cache is unusable (a `DERIVE_VERSION` bump, or a late-event
full refold — `distributionStorage.ts:625-628`) would otherwise pay a cold fold on **every component mount**.
An in-module memo keyed exactly like the existing dedupe key
(`${workspaceScopeId(dir)}|${month}|${workspaceEpoch(dir, month)}`, `distributionStorage.ts:710`) holding the last
derived `DistributionCurrentData`, capped at 2 entries, makes that once per session per month.

**Accepted regression, stated plainly:** with (a)+(b)+(c) in place, an employee-only session on an **open** month
never opened by a manager still re-derives once per session instead of reading a warm cache. Bounded by (c), and
the file's own comment concedes the cache is "an optimization, never a correctness input"
(`distributionStorage.ts:571-575`). **Not** a regression on closed months — the read-path write already throws
there today (F20).

**Separately (F15/H3): the empty-sample gate moves to function entry, not around the persists.** Gating only the
two `void saveDistributionCurrent` calls leaves the worse failure intact: with `sampleRows = []`,
`tryResumeFromCheckpoint` (`:526-543`) folds the new events, every one hits the bare `continue` at
`distributionDerivation.ts:140-141` — before `recordDroppedEvent`, so it is neither reported nor logged — and the
checkpoint's `knownEventIds`/`segmentOffsets` still advance past them. That is permanent absorption written to
disk, strictly worse than the empty-snapshot case r1 described. The gate therefore goes at the **top** of
`loadOrDeriveDistributionCurrent`, before `tryResumeFromCheckpoint`, and returns `null`. `null` is the safe shape:
`XrayReferrals.tsx:519-521` already falls back to the personal mirror on `null`, `useApprovalData.ts:160` already
tolerates `distribution?.entries ?? []`, and `adhocImportEmployeeView.ts:97-100` already implements this exact
guard at its own call site — the in-tree precedent.

### 4.4 Write-through

`safeWriteJson` changes signature from `Promise<void>` to `Promise<WriteStamp>` where
`WriteStamp = { revision: number; contentHash: string; size: number }`.

**Rule, restated as a read-back-proof rule (not a provenance rule).** r1 said "taken from its own read-back,
never synthesized from what we intended to write." Taken literally that is unimplementable on two of the three
commit paths without adding a full `JSON.parse` of an 18.8 MB string to the write hot path — a perf regression
inside a perf spec. The buildable rule:

- **Streamed path** (`safeWrite.ts:385-427`) and **small-file `skipVerify === true` path** (`:462-463`): the
  read-back is a **byte-exact** comparison (`verifyStreamedFile` whole-file hash; `verify === serialized`). That
  comparison *is* the proof the file's content matches. The stamp may therefore be taken from the metadata this
  call constructed (`buildMetadata`'s output / `nextValue.metadata`).
- **Small-file `skipVerify === false` path**: the read-back proves only well-formedness (F5). The stamp **must**
  be read from `parseValidJson(verify)` — which may legitimately be a *peer's* envelope. That is the desired
  behaviour: it makes the lost update observable within one sync interval instead of permanent.

**Four exit points must each return a stamp:** `safeWrite.ts:410` (streamed promotion-recovery), `:427` (streamed
normal), `:488` (small promotion-recovery), and the fall-through at the end of the small path (`:497-498`). The
return value must also thread out through `withWorkspaceWriteAccess(dir, () => withResourceLock(...))`
(`:322-323`), both of which discard it today. Typing the return as **non-optional** makes `tsc` flag any missed
exit, so this is documentation, not a runtime guard.

**`casLoop` needs no signature change.** Its callers must return a stamp derived from the read-back inside their
own attempt function, not from the object they constructed. `appendDistributionEvents` is the reference: it
already reads `readDistributionLogStamp` at `distributionStorage.ts:372` and checks it against `nextRevision`,
but its `result.log` at `:381` is built from `updated` — the object it wrote. It must return that verified stamp
explicitly rather than letting callers infer freshness from `updated.revision`. The other six casLoop call sites
(`actionLog.ts:267`, `approvalStorage.ts:132`, `notificationStorage.ts:113`, `monthLock.ts:175, 253`,
`answerStorage.ts:149`, `templateSelectionStorage.ts:59`) are unaffected until they feed a stamp table.

Given F5, this does not eliminate the commit-to-verify window; it bounds a lost update to one sync interval and
makes it self-healing by construction, instead of a silent permanent divergence.

### 4.5 Never blank

**Invariant, scoped:** *for any reload driven by the refresh signal*, a loading state may render only when there
is no previously rendered data for that key.

The scope qualifier is deliberate. `XrayReferrals.tsx:470-497` already implements it via a `silent` flag, and
`XrayInspectionResults.tsx:317` follows it. A2 plumbs the same flag into the two blanking views. Under Query it
becomes `isPending` vs `isFetching`.

Views that blank only on **mount** (`Archive/index.tsx`, `Reports/TabView.tsx`, `UserManagement/AuditSections.tsx`,
`TemplateBuilder/TabView.tsx`, `ReferralApproval/HistoryView.tsx`, `EmployeeWorkspace/index.tsx`) do not subscribe
to the tick and are out of scope.

**`BrowseDataView` is the known exception and is explicitly out of Slice A scope.** It sets `loading = true` and
renders `LoadingState` instead of the table on every load-effect re-run — including `refreshKey` bumps after any
wizard mutation and every month switch — despite having previously rendered rows (F24,
`BrowseDataView.tsx:584-589, 1043`). Fixing it means keeping prior rows rendered under a dimmed overlay and
blanking only when `loadGeneration === 0`. Scheduled as an A-adjunct (A10) precisely because A1 does *not* make
Browse the landing tab for the personas who would notice.

**Pagination.** `DataTable` resets to page 1 whenever `rowsPageKey` changes — row count or first/last row key
(F24, `DataTable/index.tsx:326-327`) — which a silent refresh routinely does. r1's "key on (month, dataset)"
prescription is wrong twice: it misdescribes the current mechanism, and it needs a new prop threaded through
every call site, which is not budgeted. The correct change is behavioural: **clamp instead of reset** — keep
`pageState.page`, clamp it against the new page count, and reset to 1 only when a caller-supplied optional
`datasetKey` prop changes. The same clamp is needed in the hand-rolled paginators at `BrowseDataView.tsx:533` and
`CertScanGrid.tsx:77`. This is Phase 2 work, not Slice A — it touches a shared component with many consumers.

### 4.6 Cross-month KPI

Computed per month on demand, held in Query under a month-scoped key. **No disk file.**

`isMonthClosed` is used as an in-memory *cache-lifetime hint* — a closed month's `ReviewerKpiModel` is held for
the session — not as a correctness claim, because `monthLock.ts` exports `reopenMonth` and the lock fails open on
an unreadable manifest. A reopen surfaces as a manifest revision change, which is why `manifest` is one of the
§4.2 families.

If disk memoization is ever proven necessary, it must carry `templateId`/`templateVersion`, a
`KPI_DERIVE_VERSION`, and a per-writer filename.

### 4.7 Boot progress — inverted, and first

Because of F13, boot progress must stop being marked from inside load functions and instead be derived from
query **status transitions**.

The mapping must key on the `(status, fetchStatus)` **pair**, not `status` alone — a query with `enabled: false`
(the existing pattern, `monthFoldersQuery.ts:37`) sits at `status: "pending", fetchStatus: "idle"` indefinitely,
and mapping `pending → markBootSourceLoading` would leave that source non-terminal forever, so
`allLoaded = entries.every(isTerminal)` (`bootProgress.ts:150`) never goes true and the splash hangs to its 8 s
timeout valve. That is exactly H5. The required hook:

```
useBootSourceFromQuery(key, labels, result):
  fetchStatus === "fetching"                  → markBootSourceLoading
  status === "error"                          → markBootSourceError
  status === "success"                        → markBootSourceLoaded
  status === "pending" && fetchStatus === "idle" → markBootSourceLoaded   // disabled/N-A is TERMINAL
```

It must be called from the same component as the `useQuery` it wraps — the boot-source *set* is role- and
view-dependent (`referralsBootSources(username, canSeeAll)`, `XrayReferrals.tsx:488`; `useMonthLoad.ts:168`
registers its own), so one global effect cannot know it. `registerBootSources` must run in the same effect,
before the first mark, so the child-before-parent ordering that motivated `useSyncExternalStore`
(`bootProgress.ts:122-146`) cannot reopen.

A warm cache hit resolving `success` in the registering commit is safe: `visibleNow` (`BootSplashOverlay.tsx:213`)
simply never latches `shown`, so the overlay does not appear at all — which is the owner's stated goal.

This lands as its own reviewed, test-first change **before** any view migrates. The area regressed five
consecutive times (v59.190–197), every round caught by review rather than self-testing, including after
real-browser confirmation. It is sequenced alone precisely because it is the highest-probability regression.

### 4.8 The 3-tab LRU

Unchanged. Once data survives eviction, the cap is a DOM/memory decision, which is what it was always intended
to be.

---

## 5. What this does not fix

**The distribution save.** Per F14, the v61.0 rewrite may already have fixed it, but has never been run in a
browser and the benchmark did not cover `saveDistributionCurrent` — the slowest half.

The uncovered tail: `saveDistributionCurrent` writes a multi-MB `distribution.current.json` (up to 5 full-file
passes, `safeWrite.ts:286-288`); then `syncSampleMirrors` writes `main.samples.json` the same way and, **per
employee**, calls `readMirrorRevision` → a full `safeReadJson` parse of that mirror just to read one integer
(`sampleMirrorStorage.ts:34-42, 66, 81`) followed by another 5-pass write. And `DistributionWriteProgress` emits
nothing for any of it — the bar sits frozen at 86% through the entire tail.

Two candidate fixes, both deferred to the separate write-path work item Milestone 0 gates:

1. **Skip the `main.samples.json` write when nothing changed** — compare the existing envelope `contentHash`
   against a hash over `current.entries` (reusing `createSimpleHasher` from `safeWrite.ts`, not a second hash
   function) before calling `safeWriteJson` at `sampleMirrorStorage.ts:68`. Sequence this **after** A6/A6b so
   Milestone 0 measures the post-A6 baseline — once readers stop writing, the remaining callers are genuine
   mutations where entries really did change, and the win may evaporate.
2. **A `*.samples.rev` sidecar** holding `sourceLogRevision` alone, so the monotonic guard reads one tiny file
   instead of parsing an ~1 MB mirror per employee. **This is the only on-disk format change proposed anywhere
   in this document** — it needs its own migration note and must **not** be folded into Slice A's "nothing
   changes on-disk format" rollback claim.

---

## 6. Correctness hazards, ranked by likelihood × damage

| # | Hazard | Guard | Airtight? |
|---|---|---|---|
| H1 | **Mirror-first shows an employee the wrong assignments, silently** (F8). Today harmless because the mirror is only a `??` fallback (F6); inverting makes it primary. | All four required before inversion: (a) emit an empty-entries file for every employee who previously had entries and now has none; (b) carry quota in the mirror (F7); (c) persist on the **write** path rather than inheriting a fire-and-forget read-path call — **pulled forward into Slice A as A6b**, because F19 makes A6 remove the only thing keeping mirrors warm; (d) a drop-to-zero contract test. | **No.** The mirror still lags by up to one sync interval. Mitigation: first paint from the mirror, background reconcile against the distribution on the sync cadence, never on the interactive path. |
| H2 | **Write-through seeds the cache with a value that never hit disk** (F5). | `safeWriteJson` returns a stamp admissible only when that call's own read-back proved the content (§4.4). | **No.** The commit-to-verify window remains on the `skipVerify === false` path; it becomes observable and one-interval-lived rather than permanent. |
| H3 | **Events silently absorbed into an advancing checkpoint, and/or an empty snapshot persisted as authoritative** (F15). | Gate at the **entry** of `loadOrDeriveDistributionCurrent` on `sampleRows.length === 0`, returning `null` — before `tryResumeFromCheckpoint` can fold and advance. Plus a once-per-call `logError` when `rows.size === 0 && events.length > 0`. | Yes for the persist and the checkpoint advance. The fold's own per-event `continue` semantics are left alone deliberately — converting it to `recordDroppedEvent` would change `droppedEventIds`, which feeds `deriveEmployeeQuotasWithFacts` (`distributionLog.ts:225, 300`) and would alter quota output on a deterministic-by-contract surface. |
| H4 | **A client-written KPI summary serves confidently wrong numbers forever.** | Don't write one (§4.6). | Yes, by omission. |
| H5 | **The splash hangs after boot-progress migration** (F13). Not wrong data, but a hard block. | Invert to query-status-derived progress as its own reviewed change, first, with the `(status, fetchStatus)` pair mapping in §4.7. | Yes, if sequenced as specified. |
| **H6** | **The stamp gate is silently defeated by the existing blanket invalidation** (F16). `queryRefreshBridge.ts:20` invalidates every registered query on every broadcast; any query-backed data refetches on every tick regardless of the change set, and the failure mode is invisible — the app still works, just as slowly. | Narrow the bridge to keyed invalidation **in the same commit as A7**, and re-key `monthFoldersQuery.ts:29-30` from `directoryHandle?.name` to `workspaceScopeId` so it falls inside the scoped invalidation. | Yes, if the two land together. A partial landing reads as "the stamp gate didn't help" and would drive the wrong Phase 1–3 decision at the STOP-AND-REASSESS point. |

---

## 7. Implementation plan

### Milestone 0 — Measure (no behavior change)

**Deliverable:** a `perfMark`/`perfReport` ring buffer beside `errorLogger.ts`; `performance.now()` deltas around
the four existing `DistributionWriteProgress` emit sites plus `saveDistributionCurrent` and `syncSampleMirrors`;
one added `phase: "mirrors"` so the progress bar stops lying between 86% and done. Record
`distribution.current.json` byte size before and after.

Two additions from review:

- Pass `safeWriteJson`'s existing `SafeWriteProgressCallback` (five phases, `safeWrite.ts:294-301`) through from
  `saveDistributionCurrent` (`distributionStorage.ts:410`) — it is a two-line change that turns the frozen
  86%→done gap into five visible steps. Add `bytesWritten`/`bytesTotal` to `DistributionWriteProgress`
  (`distributionStorage.ts:34-36`).
- Instrument the **read** side too: per employee page load, record the round-trip count and byte volume of
  `loadOrDeriveDistributionCurrentForRead`. Without that number, STOP-AND-REASSESS question 2 has no measurement
  behind it and A6's accepted regression can be neither confirmed nor refuted against real UNC latency.

`distributionStorage.test.ts:108` asserts on the progress array, so the typed-union widening fails that test
loudly — which is the intent.

**Run instructions (owner):** one real bulk distribution on the production share, on a **copied** month folder to
preserve latency characteristics. Take a backup first — `autoLockWhenFullyDistributed` closes the month
(F20), so a rerun needs an admin unlock.

**Gate:** tier 2.

---

### Slice A — Felt wins, near-zero risk

Every item below states its exact edit, DONE criteria, and parallel-safety class. **Implement in the commit
order given in §7.1, not in table order.**

---

#### A1 — Conditional landing sub-tab for Population

**File:** `src/components/Sidebar/Tabs/Population/index.tsx`

**Change.** Replace the constant initializer at `:175`:

```ts
const [activeSubTab, setActiveSubTab] = useState<SubTab>("process");
```

with a lazy initializer computed from the permissions already in scope at `:173` (`const { can, canMutate } = usePermissions()`):

```ts
const [activeSubTab, setActiveSubTab] = useState<SubTab>(() =>
  can("view-browse") && (canMutate("draw-sample") || canMutate("process-population"))
    ? "browse"
    : "process"
);
```

**Why this exact condition** (both reviews were half-right, C5): `can("view-browse")` is required or the user
lands on the "غير مصرح" placeholder (`:1210-1218`). The capability clause is required because
`BrowseDataView` reads the month's entire `population.final` on mount with no already-loaded guard
(`BrowseDataView.tsx:593-597`), while `computeMonthLoadScope` returns `population: false, raw: false` for a
viewer without `draw-sample`/`process-population` (`populationWorkflowHelpers.ts:79-86`). So browse-by-default
*saves* the manager a per-tick population reload (F12) and *costs* an employee a multi-MB UNC read they pay
nothing for today. The condition gives the win only to those it is a win for.

**Also:** `visitedSubTabs`'s initializer at `:184` seeds from `activeSubTab` and must continue to — exactly one
sub-tab resident at mount, per §2's residency constraint. It already reads `new Set([activeSubTab])`; verify no
edit changes that.

**Verification only, no code change:** the effect at `:524-529` is already gated on
`activeSubTab !== "process" || currentPhase !== 3` plus a `canDrawSample`/`canProcessPopulation` check. r1's
"gate the proactive `ensurePopulationLoaded()`" clause described code that already exists (C6). Confirm the gate
still holds with `activeSubTab` starting as `browse` — expected: the effect correctly stays idle until the user
opens process. Do **not** touch `handleDrawSample`'s on-click top-up at `:1026`; gating that breaks the draw.

**DONE criteria.**
- jsdom test: mount `PopulationTab` with an employee session (no `draw-sample`, no `process-population`); assert
  initial sub-tab is `"process"` and that `loadMonthPopulationFinalRawText` / `loadBrowseRows` are never called.
- jsdom test: mount with a manager session; assert initial sub-tab is `"browse"` and `computeMonthLoadScope`
  returns `population: false`.
- jsdom test: mount with a session lacking `view-browse` but holding `draw-sample`; assert `"process"`.
- Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** **Serialize with A10 only.** Touches `Population/index.tsx` exclusively; disjoint from
A2–A9. Safe to run concurrently with every other Slice A item.

---

#### A2 — Silent refresh in the two blanking views

**Files:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/NotificationManager.tsx`,
`src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`

**Change.** Copy `XrayReferrals.tsx:470-497, 578-583, 597` as the pattern, verbatim in shape:

1. `reload` (`NotificationManager.tsx:74`) and `loadData` (`useApprovalData.ts:~100`) take
   `opts?: { silent?: boolean }`.
2. `const silent = opts?.silent ?? false;` and wrap the blanking setState:
   `if (!silent) setLoadState("loading");` — `NotificationManager.tsx:75`, `useApprovalData.ts:105`.
3. **Silent error path logs and returns**, never `setLoadState("error")` — copy
   `XrayReferrals.tsx:578-583` exactly. A transient UNC hiccup must not unmount previously rendered content.
4. **Rewrite both subscriptions as explicit lambdas.** This is the failure mode that would ship a no-op:
   `subscribeToDataRefresh(reload)` (`NotificationManager.tsx:93`) and `subscribeToDataRefresh(loadData)`
   (`useApprovalData.ts:194`) pass the callback directly, and `subscribeToDataRefresh` invokes it with the
   `DataRefreshSource` **string** as its first argument (`dataRefreshSignal.ts:35-40`). After adding `opts`, that
   string lands in `opts`, `opts.silent` is `undefined`, and both views blank exactly as before. Required form:
   ```ts
   useEffect(() => subscribeToDataRefresh(() => { void loadData({ silent: true }); }), [loadData]);
   ```
5. The six post-decision reloads in `useApprovalData` (`:221, 248, 276, 303, 332, 359`) become
   `loadData({ silent: true })` — the list is already on screen.

**Watch item:** `loadData`'s `useCallback` deps at `useApprovalData.ts:186` include `months` from
`useGlobalMonth()`. If `months` is not referentially stable, `loadData` changes identity every render and the
subscription re-subscribes every render. Adding a parameter is safe; **restructuring the callback is not**.
Verify `months` identity stability in `GlobalMonthProvider` before touching the dep list, and memoize it there in
the same commit if it is unstable.

**DONE criteria.**
- jsdom test per view: render with data ready, `broadcastDataRefresh("periodic")`, assert the previously rendered
  cards/rows remain in the DOM **continuously** across the refresh — hold a node reference or use a
  MutationObserver, not a post-hoc snapshot (a post-hoc snapshot passes even if the view blanked and re-rendered).
- jsdom test per view: with the loader rejecting, assert prior data is still rendered and no error state appears.
- Regression test that would have caught the no-op: assert the subscription callback invokes the loader with
  `{ silent: true }` when fired with the string `"periodic"`.
- Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** the two files are disjoint from each other **but `useApprovalData.ts` is shared with A3 and
the dropped A5**. Serialize A2 → A3 in that file. `NotificationManager.tsx` is disjoint from everything else in
Slice A.

---

#### A3 — `bulkDecision` reloads once, not per item

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`

**Change.** The reload is **not** in `bulkDecision` (`:404-418`); it is inside each of the six approve/deny
functions at `:221, 248, 276, 303, 332, 359` (F11). Naively hoisting it would remove the reload from the
**single-item** path, which is the interactive path a supervisor uses most.

Give each of the six an internal option `{ reload?: boolean }` defaulting to `true`. `bulkDecision` passes
`false` and calls `await loadData({ silent: true })` **once after the loop, in a `finally`**, so a mid-loop throw
still reconciles. **Do not change the six exported single-item signatures' observable behaviour.**

**DONE criteria.**
- Test with a spied loader: a 5-item `bulkDecision` triggers exactly **one** load.
- Test: a single `approve` still triggers exactly one load.
- Test: a `bulkDecision` where item 3 rejects still triggers exactly one load (the `finally` path).
- Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** **serialize after A2** — same file, and A3's reload calls are the ones A2 makes silent.

---

#### A4 — One shared `loadRequestLogs`, deduped

**File:** `src/data/referral/referralStorage.ts`

**Change.** Add:

```ts
export async function loadRequestLogs(dir, month): Promise<{
  referrals: ReferralLog; replacements: ReplacementLog; reopens: ReopenLog;
}>
```

performing `loadAllEmployeeFiles` + `loadAllSupervisorDecisions` **once** and folding all three kinds from that
one pair of scans. `loadReferralLog` (`:39`), `loadReplacementLog` (`:116`), `loadReopenLog` (`:170`) become thin
delegating wrappers so no caller's error handling changes.

**Delegation alone does not reduce I/O.** Callers invoke the three concurrently under `Promise.all`
(`useApprovalData.ts:107-111`; `XrayReferrals.tsx:499-502` calls two), so three delegating exports each awaiting
the shared loader is still six scans. The shared loader **must** be wrapped in `dedupeInFlight`
(`src/data/storage/inFlightReads.ts:12`) keyed
`` `${workspaceScopeId(dir)}|${month}|${workspaceEpoch(dir, month)}|request-logs` `` — mirroring
`loadDistributionLogForRead` (`distributionStorage.ts:692-698`) — so concurrent per-kind calls within one load
pass share a single scan. Additionally, change `useApprovalData.ts:107-111` and `:132-139` to call
`loadRequestLogs` directly, so the reduction does not depend on the dedupe window alone.

**Preserve per-kind degradation exactly.** Today each of the three degrades independently: `loadAllEmployeeFiles`
catches and returns `[]` (`answerStorage.ts:333-336`), `loadAllSupervisorDecisions` likewise
(`approvalStorage.ts:91-93`), and both use `onUnreadable: "skip"` so one corrupt file skips only that file. A
shared loader collapses three failure domains into one unless this is preserved deliberately.

**DONE criteria.**
- Memory-directory test with an instrumented handle: a `Promise.all` of all three exported loaders performs
  **exactly one** `loadAllEmployeeFiles` scan and **exactly one** `loadAllSupervisorDecisions` scan (down from
  three each).
- Memory-directory test with one corrupt `*.answers.json` among three: all three request kinds still return the
  requests from the two good files.
- Snapshot the three logs' output before the refactor and diff after — the status join via `effectiveDecision`
  and the `history` field must be byte-identical, or the History tab and the pending-ID sets drift silently.
- Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** `referralStorage.ts` is disjoint from A1, A2, A6–A9. The `useApprovalData.ts` call-site edit
**serializes after A3**.

---

#### A5 — DROPPED

r1's `useMemo` on `userDisplayMap` (`useApprovalData.ts:75-76`) is removed from the slice. It saves one
render-time object allocation and **zero I/O**, while carrying the only wrong-data risk in Slice A: the obvious
dep `[userManagementState]` never memoizes, because `readUserManagementState()` returns a **fresh** object on
every call while the runtime state is null (F23, `userManagement.ts:588-590`), and the tempting `[]` freezes
display names permanently across a user rename — visibly wrong in `describeRequestShort`
(`useApprovalData.ts:395`). If it is ever revived, the only correct form is
`useMemo(..., [userManagementState.users])`, relying on `usePermissions()`'s own
`subscribeToUserManagementChanges` re-render (`usePermissions.ts:59-62`) to change the dep after a rename.

**Related note so the implementer optimizes the right thing:** `NotificationManager`'s `computeAudienceUsers` is
already lazily initialized and re-derived only on roster change (`NotificationManager.tsx:72, 95-98`). The
remaining per-tick cost in that view is the **reload**, which A7's `notifications` family gate removes. Do not
"optimize" the roster.

---

#### A6 — Readers stop writing (three coupled parts, one commit)

**Files:** `src/data/distribution/distributionStorage.ts`, `src/data/distribution/distributionDerivation.ts`,
plus the four write flows named in A6b.

**A6a — `persistCache` option.** As specified in §4.3(a): add
`opts?: { persistCache?: boolean }` (default `true`) to `loadOrDeriveDistributionCurrent` (`:610`); guard both
`void saveDistributionCurrent` sites (`:580`, `:676`) on it;
`loadOrDeriveDistributionCurrentForRead` (`:705`) passes `{ persistCache: false }`.
Additionally pass `{ persistCache: false }` at the two non-`ForRead` call sites that are **provably pure reads**:
`Population/index.tsx:571` (orphan scan) and `powerbiExport/exportManager.ts:29` (CSV export). Leave
`XrayReferrals.tsx:762` and the five validate-before-write callers unchanged.
**Do not** implement this as a permission check — see §3.1's new rejected premise and §3.2 C-note on the axis.

**A6b — the write flows must persist explicitly. Blocking; A6a must not ship without it.** F18: today
`saveDistributionCurrent` has exactly one non-read caller (`useDistributionActions.ts:139`), so the cache and every
mirror (F19) for approvals, reopens, ad-hoc assignment and bulk reassignment are refreshed **only** by the next
reader's fire-and-forget write. Add a shared helper in `distributionStorage.ts`:

```ts
export async function refreshDistributionCacheAfterWrite(dir, month, sampleRows): Promise<void>
```

which awaits `loadOrDeriveDistributionCurrent(dir, month, sampleRows, { persistCache: true })`, and call it after
a **successful** event append in each of: `bulkAssignment.ts` (after the append that follows `:362`),
`approveReferral.ts` (after `executeReplacement` / the referral append near `:268-290`),
`adhocImportAssignment.ts:185`'s flow, and `reopenAnswer.ts:83`'s flow. Failures are logged via
`logError`, never thrown — these are cache refreshes, not correctness inputs, and a closed month legitimately
rejects them (F20).

**A6c — session-scoped derive memo.** As specified in §4.3(c): a module-level `Map` in `distributionStorage.ts`
keyed `` `${workspaceScopeId(dir)}|${month}|${workspaceEpoch(dir, month)}` `` (the same key shape as `:710`),
capped at 2 entries, holding the last derived `DistributionCurrentData`. This bounds the accepted regression to
once per session per month even when the on-disk cache is unusable (`DERIVE_VERSION` bump, late-event refold at
`:625-628`). **Correction to review B:** this is *not* needed for auto-locked months — the read-path write already
throws there today (F20, C1).

**A6d — H3 gate at function entry.** At the top of `loadOrDeriveDistributionCurrent` (`:610`), after loading the
cached snapshot and **before** `tryResumeFromCheckpoint` (`:625`):

```ts
if (sampleRows.length === 0) {
  const stamp = await readDistributionLogStamp(directoryHandle, monthFolderName);
  if (stamp.revision > 0) {
    logError("distribution:no-sample-rows", new Error(`${monthFolderName}: events exist but sample.master is empty/missing`));
    return null;
  }
}
```

Returning `null`, not `{entries: []}` — see §4.3 for why `null` is the shape every caller already tolerates.

**A6e — make the silent fold visible.** In `foldDistributionEvents` (`distributionDerivation.ts:~130`), once per
call: `if (rows.size === 0 && events.length > 0) logError("distribution:fold-no-rows", …)`. **Do not** convert the
per-event bare `continue` at `:140-141` into `recordDroppedEvent` — that would change `droppedEventIds`, which
feeds `deriveEmployeeQuotasWithFacts` (`distributionLog.ts:225, 300`), altering quota output on a
deterministic-by-contract surface.

**DONE criteria.**
- Memory-directory test with a `createWritable` spy: `loadOrDeriveDistributionCurrentForRead` on a month with a
  valid checkpoint performs **zero** writes.
- Memory-directory test: two consecutive `…ForRead` calls with `deriveVersion` forced stale perform zero event-
  segment reads on the second call — proving A6c's memo carried it, not the disk cache.
- **A6b contract test (this is H1(d), pulled forward):** after a reassignment away from employee A performed
  through *each* of the four write flows, A's `*.samples.json` mirror is rewritten to zero entries.
- H3 test: `loadOrDeriveDistributionCurrent` with `sampleRows: []` and a compat log at `revision > 0` returns
  `null`, performs **zero** writes, and leaves `foldCheckpoint.knownEventIds`/`segmentOffsets` on disk unchanged.
  (The `knownEventIds` assertion is the one r1's version would have missed.)
- H3 test: `sampleRows: []` on a month with **no** events (`revision === 0`) still returns normally — the gate
  must not break a fresh month.
- Snapshot `deriveCurrentDistributionWithFacts` output before and after (deterministic-by-contract surface).
- Gates: `lint`, `typecheck`, `test:run`, plus `check:complexity` (this item adds branches to the largest function
  in the module).

**Parallel-safety:** **A6 owns `distributionStorage.ts` exclusively and must be serialized against A7, A8 and A9,
all of which touch the same file.** Within A6, a–e are one commit — splitting a6a from a6b ships the regression.

---

#### A7 — Change-set sync tick (three commits)

**New file:** `src/data/workspace/SyncTick.tsx`.
**Edited:** `src/auth/AuthGate.tsx`, `src/data/workspace/dataRefreshSignal.ts`,
`src/data/distribution/distributionStorage.ts` (export `readDistributionLogStamp`),
`src/data/storage/directoryScan.ts` (add a sized listing helper),
`src/data/answers/answerStorage.ts` + `src/data/approvals/approvalStorage.ts` (export their private dir helpers),
`src/data/query/queryRefreshBridge.ts`, `src/data/query/monthFoldersQuery.ts`.

**Commit 1 — the gate.**

*Location.* The tick **cannot** stay in `AuthGate`: the interval is in AuthGate's own body (`:333-350`) and
`GlobalMonthProvider` is rendered *by* AuthGate at `:608` (F17), so AuthGate cannot call `useGlobalMonth()` to
learn which month to stamp. Extract the data half of the tick into a headless `<SyncTick />` rendered **inside**
`<GlobalMonthProvider>` (`AuthGate.tsx:608-618`, alongside `<AdminToolbar>`), calling `useGlobalMonth()` and
`useWorkspace()`. **Do not** read the `xray_global_month_v1` sessionStorage key directly — that creates a second
month-selection authority that diverges after a month switch.

`refreshPermissions()` stays in AuthGate on its own **ungated** interval.

*Behaviour.* Per tick, compute the §4.2 change set; store the previous probe values in a module-level map keyed
`${workspaceScopeId(root)}|${month}`; broadcast
`{ source: "periodic", changed }`. If `changed` is empty, broadcast nothing at all. Extend
`DataRefreshSource`/`dataRefreshSignal.ts` per the §4.2 contract, keeping the existing string-callback shape
working.

*Subscriber mapping — spec this, do not leave it to the implementer.* All eight current subscribers:

| # | Subscriber | Families it must react to |
|---|---|---|
| 1 | `NotificationBanner.tsx:64` | `notifications` |
| 2 | `NotificationManager.tsx:93` | `notifications` |
| 3 | `useApprovalData.ts:194` | `requests`, `answers`, `distribution`, `manifest` |
| 4 | `XrayInspectionResults.tsx:317` | `answers`, `distribution`, `manifest` |
| 5 | `XrayReferrals.tsx:597` | `answers`, `requests`, `distribution`, `manifest` |
| 6 | `useMonthLoad.ts:269` | `distribution`, `manifest` |
| 7 | `queryRefreshBridge.ts:20` | see commit 1b |
| 8 | `directoryScan.ts:372` | unchanged — already self-gates on `source === "manual"` |

*Commit 1b, same commit — H6.* Narrow `queryRefreshBridge.ts:20` from unscoped `invalidateQueries()` to: full
invalidate on `manual`; per-family keyed `invalidateQueries({ queryKey })` on the granular event. Re-key
`monthFoldersQuery.ts:29-30` from `directoryHandle?.name` to `workspaceScopeId(directoryHandle)` in the same
commit, or it falls outside the scoped invalidation and goes permanently stale. **Without 1b the entire A7 gate
is unmeasurable** (F16).

*Concurrency guard.* An `inFlightRef` makes a tick a no-op while the previous one is unresolved — mandatory, since
the callback becomes async and a ~29-round-trip probe can outlive its own interval on a slow share.

**Commit 2 — cadence.** `AUTO_REFRESH_INTERVAL_MS` (`AuthGate.tsx:337`) 3 min → `45_000`, meeting §2's constraint.
Land only after commit 1's round-trip budget is measured on the share.

**Commit 3 — focus.** A `visibilitychange` listener in `SyncTick` firing one gated tick on hidden→visible,
coalesced with the interval by a shared `lastCheckedAt` so focus-thrashing cannot issue more than one probe per
~10 s. Respects the same `inFlightRef`. This is the single cheapest change toward the owner's "unsynced"
complaint: staleness on return drops from up-to-one-interval to one probe depth.

**DONE criteria.**
- **The staleness test (the one that would catch a distribution-only gate):** memory-directory integration test —
  session A posts a notification **and** appends a referral request to an employee answers file with **no**
  distribution event; fire one gated tick in session B; assert `notifications` and `requests` are both in the
  change set, that `NotificationManager` and `useApprovalData` both re-read, and that **zero**
  distribution/sample/population reads occurred.
- Test: two consecutive ticks over an unchanged month report an **empty** change set and issue zero
  `invalidateQueries` calls. Run this with A6 already landed, so the absent read-path cache write cannot be
  mistaken for the change signal.
- Test: an appended request inside an **existing** `{user}.answers.json` (same filename, larger size) is detected
  — this is the case a name-only diff misses (F21).
- Round-trip budget test: an unchanged tick against an instrumented memory directory issues no more than
  `2 + 1 + 2 + N + M + 1` `getFileHandle`/`getFile` calls, and reads no file larger than the notifications file.
- Fake-timer test: with the probe resolving after 2× the interval, exactly one probe is in flight and no state is
  dropped.
- Test: `refreshPermissions()` still fires on a tick where the change set is empty.
- Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** **A7 must be serialized after A6** (same file, and its change-detection tests must be written
against a world where readers no longer write). It touches seven other files no other Slice A item touches. Its
three commits are strictly ordered.

---

#### A8 — Fix two stale doc comments (F9)

**File:** `src/data/distribution/distributionStorage.ts`

The "every entry embeds a full population row / 18.8 MB" claim exists in **two** places, not one:
`:561-575` (the `tryResumeFromCheckpoint` rationale) and `:671-678` (the full-refold sibling). Fixing only the
r1-cited site leaves the same falsehood one screen up. Both must restate F9 — entries carry a 17-field
`EmployeeMirrorRowStub` since B5 — and note that the 18.8 MB figure predates the stub and is therefore an upper
bound from the pre-B5 format, not a current measurement.

**DONE criteria.** Comment-only. Gates: `lint`, `typecheck`, and the affected test file (tier 1).

**Parallel-safety:** same file as A6/A7/A9 → **serialize**, but land it **first** (zero risk, and it removes a
misleading rationale the A6 implementer will otherwise read while editing the exact same lines).

---

#### A9 — Export `readDistributionLogStamp`

**File:** `src/data/distribution/distributionStorage.ts:240`

Currently module-private. Add `export`. Trivially small, but called out separately because it is A7's only
dependency in that file and can therefore land with A8 before A6 begins, unblocking A7's tests early.

**DONE criteria.** Existing tests pass; one new unit test asserting the stamp's revision does **not** change after
a `saveDistributionCurrent` and **does** change after `appendDistributionEvents` (this is F4's load-bearing
property, currently untested). Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** same file → land together with A8 in one commit.

---

#### A10 — Browse keeps prior rows during reload (adjunct, optional in Slice A)

**File:** `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx`

`LoadingState` replaces the whole table on every load-effect re-run (`:584-589`, `:1043`), including `refreshKey`
bumps after wizard mutations, despite previously rendered rows (F24). Keep the prior rows rendered under a dimmed
overlay; blank only when `loadGeneration === 0`. Pure perceived-latency win, zero I/O change.

**DONE criteria.** jsdom test: render with rows, bump `refreshKey`, assert the table's `<tbody>` node is never
unmounted. Gates: `lint`, `typecheck`, `test:run`.

**Parallel-safety:** **serialize with A1** (both are Population-tab landing behaviour and A1's reviewer will want
to see them together), disjoint from everything else. Defer without guilt if the slice is running long — A1's
condition means the personas who would notice are not landing on Browse.

---

### 7.1 Slice A commit order and parallel-execution map

**Commit order** (not table order — A1 needed an owner decision and A7 needed re-specification, so leading with
either would have blocked the slice):

```
A8 + A9  →  A2  →  A3  →  A4  →  A6 (a–e, one commit)  →  A7 (c1, c1b) → A7 (c2) → A7 (c3)
             ↘ A1 (independent, any time)      ↘ A10 (after A1, optional)
```

**Concurrent-agent map.** Three disjoint file territories; one agent per lane, no conflicts:

| Lane | Files owned | Items | Notes |
|---|---|---|---|
| **L1 — distribution data layer** | `distributionStorage.ts`, `distributionDerivation.ts`, the four write flows, `SyncTick.tsx`, `dataRefreshSignal.ts`, `directoryScan.ts`, `queryRefreshBridge.ts`, `monthFoldersQuery.ts`, `AuthGate.tsx` | A8, A9, A6, A7 | **Fully serialized internally.** Longest lane; start it first. |
| **L2 — approval / notification views** | `useApprovalData.ts`, `NotificationManager.tsx`, `referralStorage.ts` | A2, A3, A4 | A2 → A3 serialized (same file); A4's storage half is concurrent with both, its `useApprovalData` call-site edit lands after A3. |
| **L3 — Population tab UI** | `Population/index.tsx`, `BrowseDataView.tsx` | A1, A10 | A1 → A10 serialized. Fully disjoint from L1 and L2. |

The only cross-lane ordering constraint is that **L1's A7 tests must be written after A6 lands** (same lane, so
this is automatic) and that **L2's A2 must land before A7's subscriber-mapping commit** touches the same
subscription lines — coordinate at that one point, or have L1 rebase.

**Slice gate:** tier 2 per item as listed; **tier 3 for the slice as a whole before release** —
`check:complexity`, `check:hex-literals`, `check:release`, `check:vendor`, `build`, `check:bundle-size`.

---

### 7.2 Definition of done for the whole slice

Slice A is done when **all** of the following hold. Any one failing means the slice is not shippable, regardless
of how many individual items are green.

1. **Every item's own DONE criteria pass**, including the tests named as "the one that would catch X" — those are
   the regression the item exists to prevent, not optional extras.
2. **No view blanks on a periodic tick.** Manual verification in Chrome against a real (copied) workspace:
   sit on `ew/referral-approval`, `ew/notifications`, `ew/xray-referrals` and `ew/xray-results` across at least
   three consecutive ticks; nothing unmounts, no spinner appears.
3. **Nothing goes stale.** In a second browser profile against the same share: post a notification, submit a
   referral request, and submit an answer — **without** any distribution event — and confirm each surfaces in the
   first session within one tick. This is the acceptance test for the owner's "unsynced" complaint and the one
   that a distribution-only gate would fail silently.
4. **Permissions still propagate** on a tick with an empty change set (revoke a feature in profile B, observe it
   in profile A).
5. **The mirrors still refresh after every write path** — A6b's four-flow contract test is green, and one manual
   end-to-end: approve a referral in profile B, confirm the reassigned-away employee's `*.samples.json` shows
   zero entries on disk.
6. **Zero writes from a read.** With profile A parked on the employee workspace for 10 minutes, no new
   `distribution.current.json` or `*.samples.json` mtime on the share.
7. **Round-trip budget measured, not assumed.** One unchanged tick's `getFileHandle`/`getFile` count recorded
   from Milestone 0's instrumentation and written into the edit-log entry. If it exceeds ~40 for a typical month,
   stop and re-scope A7 commit 2 (the 45 s cadence) before shipping it.
8. **Full tier-3 gate sweep green**, per `docs/product/RELEASE_CHECKLIST.md`.
9. **An edit-log entry per item** generated with `npm run editlog` at the tier stated on that item, plus one
   tier-3 entry for the slice.
10. **The honest caveats survive into the code comments**: A6's accepted per-session re-derive, H2's remaining
    commit-to-verify window, and H1's one-interval mirror lag are each stated at the site that owns them. A future
    reader must not have to find this document to learn that these guards are not airtight.

---

### → STOP AND REASSESS

Two questions decide what follows:

1. Does a real distribution save still take hours? If yes, the **write path preempts Phases 1–3 outright** (§5).
2. After Slice A, does the app still feel like it refreshes? If no, Phases 1–3 are optional infrastructure and
   must justify themselves on their own merits, not on the original complaint.

Do **not** evaluate question 2 unless A7 commit 1b landed. Without the bridge narrowing, "the gate didn't help"
is a measurement artifact (H6), not a finding.

### Phase 1 — Boot progress inverted to query status

Alone, first, test-first, reviewed (§4.7), with the `(status, fetchStatus)` mapping specified there.
**User-visible payoff: none.** This is the price of admission for Phase 2 and the highest-probability regression
in the plan.

**Required tests, written before the migration:** (1) all queries disabled → overlay dismisses without hitting
the 8 s valve; (2) warm cache, all queries pre-seeded → overlay never renders and no `setLatch` loop occurs;
(3) one query rejects → its row shows `error`, `allLoaded` is still true, overlay dismisses.

### Phase 2 — Query becomes the view-facing authority

`workspaceKeys.ts`; `monthBundleQuery.ts`; migrate `XrayReferrals`, `XrayInspectionResults`, `useApprovalData`,
`NotificationManager` off `useState` + `useEffect` + `subscribeToDataRefresh`; `removeQueries` on heavy keys at
month switch; `safeWriteJson` returns its observed stamp (§4.4); write-through seeded only from that; delete
`monthRefreshKey`; the `DataTable`/`BrowseDataView`/`CertScanGrid` clamp-instead-of-reset pagination change
(§4.5); precompute the `suspicionRate` fact so `switchingRuleAdvisory` stops loading the prior month's entire
population for one ratio.

Month switches keep the previous month on screen via `placeholderData` — that is the mechanism that delivers it.
`startTransition` alone would be inert: there is no data-fetching Suspense boundary anywhere in `src/`, and the
loaders `setLoadState("loading")` from inside effects, outside any transition scope.

**Regression risk to preserve:** `XrayReferrals`'s local `setAnswers` merge on submit is what makes submits feel
instant today. Migrating without preserving that echo regresses them to waiting on a refetch.

**Ordering constraint:** the first heavy view must not migrate until keyed invalidation is in place (A7 commit 1b
delivers it). Otherwise the first migrated view refetches its multi-MB dataset on every tick, undoing A7 for
exactly the data that matters most.

**Candidate follow-on, measure first:** once the change set exists, `XrayReferrals`'s silent reload can reuse the
in-state `sampleMaster` when `!changed.distribution && !changed.manifest`, removing the largest recurring read on
the employee hot path (F6 — `sample.master.json` is loaded *solely* to feed the derivation). ~15 lines in
`loadData`. Do not do this in Slice A; it interacts with A6c's memo and both should be measured together.

**Gate:** tier 3.

### Phase 3 — Mirror-first employee reads

Only after H1's prerequisites (a)–(d) land individually — each is a shippable win on its own even if the
inversion is never taken. **(c) and (d) are already in Slice A as A6b**, because A6 forced them there (F19).
Remaining before inversion: (a) drop-to-zero empty-file emission, (b) quota carried in the mirror (F7).

### Phase 4 — Population paging; KPI residency policy

Only with Milestone 0 evidence and explicit approval. Overlaps Phase C of the existing performance proposal,
which is blocked on backup coordination.

---

## 8. Testing strategy

- **Deterministic-by-contract surfaces** — sampling, distribution folding, report/export builders: snapshot the
  current output *first*, change, then diff the snapshot. Never snapshot after.
- **Disk I/O tests** use `createMemoryDirectory()` from `src/data/storage/memoryDirectory.ts`.
- **Component tests** need `/* @vitest-environment jsdom */` as line 1 and explicit `vitest` imports
  (`globals: false`).
- **"Never blanks" must be asserted continuously**, not by a post-hoc snapshot — hold a node reference or use a
  MutationObserver. A snapshot taken after the refresh passes even when the view blanked and re-mounted, which is
  precisely the bug.
- **Round-trip counting** is a first-class assertion in this slice: instrument the memory directory's
  `getFileHandle`/`getFile`/`createWritable` and assert counts, not just results. Several items here (A4, A6, A7)
  have correct-output/unchanged-I/O as their silent failure mode.
- **New contract tests required:** the mirror drop-to-zero case across all four write flows (H1d / A6b); the
  write-through "read-back-proof" rule at all four `safeWriteJson` exit points (H2); the entry-level
  `sampleRows.length === 0` gate **including the untouched-checkpoint assertion** (H3); the no-distribution-event
  staleness test (A7); the empty-change-set no-invalidation test (A7 + H6).
- **Boot progress** is changed test-first, with review, per §4.7.

## 9. Rollback

Every Slice A item is independently revertable and **none changes an on-disk format** — with one explicit
exception that is *not* in Slice A: the `*.samples.rev` sidecar floated in §5 is the only on-disk format change
proposed anywhere in this document and must carry its own migration note if it is ever scheduled.

A6 is the item whose revert must be taken as a unit: reverting A6a alone while leaving A6b's explicit write-path
persists in place is harmless (a redundant save), but reverting A6b alone while keeping A6a re-introduces the
frozen-mirror regression (F18/F19). Revert A6 whole.

`safeWriteJson`'s Phase 2 signature change is additive: all 47 non-test call sites `await` it in a
value-discarding position, so callers ignoring the return keep compiling.

Nothing in this spec through Phase 3 migrates data; the only derived artifacts touched
(`distribution.current.json`, the mirrors) are rebuildable from the immutable event log.