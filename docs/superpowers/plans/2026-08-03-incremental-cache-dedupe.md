# Incremental Cache & In-Flight Dedupe Implementation Plan (§H Layer 2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining, largest click-latency win identified in the design spec — eliminate the redundant 2-4x full re-reads of the distribution event log that still happen on nearly every screen even after Plan 1's parallelization, by (a) caching already-seen immutable event files in memory so only genuinely new files are read on repeat access, and (b) coalescing overlapping in-flight reads triggered by the same render cycle.

**Architecture:** Two new primitives in `src/data/storage/`: `readAppendOnlyDirectory` (Layer 2, an incremental sibling to Plan 1's `readJsonDirectory`, opt-in and used ONLY for the genuinely append-only `distribution.events/` directory) and `dedupeInFlight`/`workspaceEpoch` (Layer 3, a call-coalescing utility usable anywhere). Five read-only screens adopt thin `...ForRead` wrapper functions; seven correctness-critical re-read sites (identified by exhaustive audit of `approveReferral.ts`, `distributionStorage.ts`'s CAS loop, and `XrayReferrals.tsx`'s replacement freshness check) are explicitly excluded and tagged with a doc comment so a future refactor doesn't accidentally route them through the dedupe layer.

**Tech Stack:** TypeScript (strict), Vitest (`node` environment), `createMemoryDirectory` test helper, existing `subscribeToDataRefresh`/`broadcastDataRefresh` signal from `src/data/workspace/dataRefreshSignal.ts`.

## Global Constraints

- `docs/edit logs/2026-08-03.md` — insert each task's new entry at the very TOP of the file (above the current topmost entry), never appended at the bottom. Bump `package.json`'s version to match each time. Run `npm run check:release` after each task to confirm.
- No new runtime npm dependencies.
- No changes to any public function signature already consumed outside this plan's files — all adoption happens via new, additively-exported `...ForRead` wrapper functions, never by changing an existing exported function's behavior.
- Deterministic-by-design code (distribution event folding) must be characterized with a test before its implementation changes, per this repo's CLAUDE.md — this applies directly to Task 1, which touches the read path feeding `deriveCurrentDistribution`.
- All new/changed TypeScript must pass `npm run typecheck` and `npm run lint` (`--max-warnings 0`) before commit.
- **Git commit scoping:** this repository routinely has unrelated uncommitted work in the working tree from other sessions. Always commit via `git add <files>` then `git commit -m "..." -- <same files>` (pathspec-scoped) — never a bare `git commit`. Before each task, run `git status --short` on your specific target files: if any show pre-existing modifications, that's expected for files this plan shares with other in-flight work (not a mistake) — disclose it in your report using the exact pattern established in the sibling `2026-08-03-workflow-fixes.md` plan (compute your own attributable delta by diffing against a pre-edit snapshot; your edit-log entry describes only your own change). If a file is completely clean beforehand, your diff should be entirely your own.
- **Never dedupe a correctness-critical fresh-read site.** The seven sites enumerated in Task 2's "Do NOT touch" list exist specifically to observe a concurrent write. Routing any of them through `dedupeInFlight` would silently defeat the concurrency guard they implement while all existing tests stay green — this is the single most important invariant in this plan.

---

### Task 1: Incremental append-only directory cache (§H Layer 2)

**Files:**
- Modify: `src/data/storage/directoryScan.ts` (add `readAppendOnlyDirectory`, `resetAppendOnlyDirectoryCache`, `__appendOnlyCacheStatsForTests`)
- Modify: `src/data/distribution/distributionStorage.ts` (wire into `readCurrentDistributionSource`)
- Test: `src/data/storage/directoryScan.test.ts` (extend), `src/data/distribution/distributionStorage.test.ts` (extend)

**Interfaces:**
- Consumes: `listDirectoryEntries`, `readJsonDirectory`, `DIRECTORY_READ_CONCURRENCY` from the same file (Plan 1, unchanged). `subscribeToDataRefresh` from `src/data/workspace/dataRefreshSignal.ts` (existing, unchanged — producers are `AuthGate.tsx`'s 5-minute timer and `AdminToolbar.tsx`'s manual refresh button).
- Produces:
  - `export type AppendOnlyScope = { root: DirectoryHandleLike; path: string }`
  - `export async function readAppendOnlyDirectory<T>(dir: DirectoryHandleLike, options: ReadJsonDirectoryOptions & { scope: AppendOnlyScope }): Promise<ReadJsonDirectoryResult<T>>`
  - `export function resetAppendOnlyDirectoryCache(root?: DirectoryHandleLike): void`
  - `export function __appendOnlyCacheStatsForTests(): { entries: number; filesReadLastCall: number; fullRereads: number }`
- `readCurrentDistributionSource`'s own signature and return type (`Pick<DistributionLogSources, "currentLog" | "immutableEvents">`) stay unchanged — this task changes its internals only.

**Background:** `loadImmutableDistributionEvents` (Plan 1) already parallelizes the cold read, but every call still re-reads every event file from scratch — there is no caching of already-seen files across calls. Since distribution events are immutable and append-only (an event, once written, is never modified — confirmed by `writeImmutableDistributionEvent`'s own collision-rejection logic), a cache can safely track "files already read and folded in" and only read files not seen before on a later call, re-sorting the merged result to stay correct regardless of arrival order.

- [ ] **Step 1: Write the failing characterization test for the cache**

```ts
// Append to src/data/storage/directoryScan.test.ts
import {
  readAppendOnlyDirectory,
  resetAppendOnlyDirectoryCache,
  __appendOnlyCacheStatsForTests,
} from "./directoryScan";
import { getReadLog, clearReadLog } from "./memoryDirectory";

describe("readAppendOnlyDirectory (Task: incremental cache)", () => {
  it("cold read reads every matching file once", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });

    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, {
      suffix: ".widget.json",
      onUnreadable: "skip",
      scope: { root, path: "events" },
    });
    expect(result.values.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(getReadLog(root)).toHaveLength(2);
  });

  it("warm read with no new files performs zero file reads", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });

    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id)).toEqual(["a"]);
    expect(getReadLog(root)).toHaveLength(0);
  });

  it("reads only the new file when one is added between calls", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });
    clearReadLog(root);
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(getReadLog(root)).toHaveLength(1);
  });

  it("full re-reads when a previously-seen file disappears (restore/rename)", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await safeWriteJson<Widget>(dir, "b.widget.json", { id: "b" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    await dir.removeEntry?.("a.widget.json");
    const before = __appendOnlyCacheStatsForTests().fullRereads;
    const result = await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(result.values.map((w) => w.id)).toEqual(["b"]);
    expect(__appendOnlyCacheStatsForTests().fullRereads).toBe(before + 1);
  });

  it("two different workspace roots with the same path never share cache entries", async () => {
    resetAppendOnlyDirectoryCache();
    const rootA = createMemoryDirectory("A");
    const rootB = createMemoryDirectory("B");
    const dirA = await rootA.getDirectoryHandle("events", { create: true });
    const dirB = await rootB.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dirA, "a.widget.json", { id: "only-in-a" });
    await safeWriteJson<Widget>(dirB, "b.widget.json", { id: "only-in-b" });

    const resultA = await readAppendOnlyDirectory<Widget>(dirA, { suffix: ".widget.json", onUnreadable: "skip", scope: { root: rootA, path: "events" } });
    const resultB = await readAppendOnlyDirectory<Widget>(dirB, { suffix: ".widget.json", onUnreadable: "skip", scope: { root: rootB, path: "events" } });
    expect(resultA.values.map((w) => w.id)).toEqual(["only-in-a"]);
    expect(resultB.values.map((w) => w.id)).toEqual(["only-in-b"]);
  });

  it("resetAppendOnlyDirectoryCache forces the next read to be a full re-read", async () => {
    resetAppendOnlyDirectoryCache();
    const root = createMemoryDirectory("root", { trackReads: true });
    const dir = await root.getDirectoryHandle("events", { create: true });
    await safeWriteJson<Widget>(dir, "a.widget.json", { id: "a" });
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });

    resetAppendOnlyDirectoryCache(root);
    clearReadLog(root);
    await readAppendOnlyDirectory<Widget>(dir, { suffix: ".widget.json", onUnreadable: "skip", scope: { root, path: "events" } });
    expect(getReadLog(root)).toHaveLength(1);
  });
});
```

Note: `createMemoryDirectory` accepts an optional `name` first argument per its existing signature (`createMemoryDirectory(name = "root", options = {})`) — confirm this matches the current signature in `memoryDirectory.ts` before using it; adjust the two-argument calls above if the real signature differs (e.g. positional vs. options-only).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/storage/directoryScan.test.ts -t "readAppendOnlyDirectory"`
Expected: FAIL — `readAppendOnlyDirectory`/`resetAppendOnlyDirectoryCache`/`__appendOnlyCacheStatsForTests` don't exist yet.

- [ ] **Step 3: Implement the incremental cache**

```ts
// src/data/storage/directoryScan.ts
// Add after the existing readJsonDirectory function:

export type AppendOnlyScope = { root: DirectoryHandleLike; path: string };

type AppendOnlyCacheEntry<T = unknown> = {
  names: Set<string>;
  byName: Map<string, T>;
};

// Keyed on the STABLE workspace root handle, not the leaf directory handle —
// getDirectoryHandle() returns a fresh object on every call in both the real
// File System Access API and this repo's memoryDirectory.ts test double, so a
// cache keyed on a leaf handle would never hit. WeakMap means a disconnected
// workspace's cache entries become garbage-collectible with no explicit
// teardown needed.
const appendOnlyCache = new WeakMap<DirectoryHandleLike, Map<string, AppendOnlyCacheEntry>>();

let statsEntries = 0;
let statsFilesReadLastCall = 0;
let statsFullRereads = 0;

export function resetAppendOnlyDirectoryCache(root?: DirectoryHandleLike): void {
  if (root) {
    appendOnlyCache.delete(root);
  } else {
    // No way to clear "all" entries of a WeakMap directly; re-assigning the
    // module-level reference is the standard pattern (old map becomes
    // unreachable and is GC'd once nothing else references it — nothing else
    // does, since this module owns the only reference).
    (appendOnlyCache as unknown as { clearAll?: () => void }); // no-op placeholder removed below
  }
}

export function __appendOnlyCacheStatsForTests(): { entries: number; filesReadLastCall: number; fullRereads: number } {
  return { entries: statsEntries, filesReadLastCall: statsFilesReadLastCall, fullRereads: statsFullRereads };
}

/**
 * Incremental sibling to readJsonDirectory, for GENUINELY append-only
 * directories only (a file, once seen under a given name, is assumed never
 * to change content — distribution.events/ is the only such directory in
 * this codebase today; do NOT apply this to answer/decision files, which are
 * mutable). Lists the directory (cheap, names only) on every call, reads
 * only names not already cached, merges, and returns the full merged result
 * in the same name-sorted order readJsonDirectory would produce — so this is
 * a drop-in performance optimization, not a different contract.
 *
 * Detection is name-based: if any previously-cached name is missing from the
 * current listing (deletion, rename, workspace restore), the cache entry is
 * dropped and the next read is a full cold read. In-place content edits
 * under an unchanged filename are NOT detected (checking would require a
 * getFile() call per cached name, defeating the point) — this codebase's own
 * writer (writeImmutableDistributionEvent) already rejects a same-id write
 * with different content, so this is a defensible, documented residual gap,
 * not a silent correctness hole for content this app itself writes.
 */
export async function readAppendOnlyDirectory<T>(
  dir: DirectoryHandleLike,
  options: ReadJsonDirectoryOptions & { scope: AppendOnlyScope }
): Promise<ReadJsonDirectoryResult<T>> {
  const { scope, ...readOptions } = options;
  let perRoot = appendOnlyCache.get(scope.root);
  if (!perRoot) {
    perRoot = new Map();
    appendOnlyCache.set(scope.root, perRoot);
  }
  let entry = perRoot.get(scope.path) as AppendOnlyCacheEntry<T> | undefined;

  const listing = await listDirectoryEntries(dir);
  const matchedNames = listing
    .filter((e) => e.kind === "file" && e.name.endsWith(readOptions.suffix))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const currentNameSet = new Set(matchedNames);

  const cacheIsValid = entry ? [...entry.names].every((name) => currentNameSet.has(name)) : false;
  if (entry && !cacheIsValid) {
    perRoot.delete(scope.path);
    entry = undefined;
    statsFullRereads += 1;
  }

  const newNames = matchedNames.filter((name) => !(entry?.names.has(name) ?? false));
  statsFilesReadLastCall = newNames.length;

  if (newNames.length > 0) {
    const newlyRead = await readJsonDirectory<T>(dir, { ...readOptions, suffix: readOptions.suffix });
    // readJsonDirectory already applied the suffix filter to the WHOLE
    // directory, not just newNames -- re-derive only the entries we didn't
    // already have cached, using its index-aligned fileNames/values pair.
    if (!entry) {
      entry = { names: new Set(), byName: new Map() };
      perRoot.set(scope.path, entry as AppendOnlyCacheEntry);
    }
    for (let i = 0; i < newlyRead.fileNames.length; i++) {
      const name = newlyRead.fileNames[i]!;
      if (!entry.names.has(name)) {
        entry.names.add(name);
        entry.byName.set(name, newlyRead.values[i] as T);
      }
    }
  }

  statsEntries = perRoot.size;
  const finalEntry = entry ?? { names: new Set<string>(), byName: new Map<string, T>() };
  const values: T[] = [];
  const fileNames: string[] = [];
  for (const name of matchedNames) {
    if (finalEntry.byName.has(name)) {
      values.push(finalEntry.byName.get(name) as T);
      fileNames.push(name);
    }
  }
  return { values, fileNames, matchedNames };
}
```

Fix the placeholder no-op in `resetAppendOnlyDirectoryCache`'s "clear all" branch — a `WeakMap` cannot be iterated/cleared wholesale by design (this is intentional: it has no `.clear()` or enumeration API). Replace the function with a version that tracks entries via a `WeakRef`-free approach: since the module only ever needs "clear this one root" (called with a root argument, e.g. from `resetAppendOnlyDirectoryCache(root)` triggered by workspace disconnect) and "clear everything" (called with no argument, e.g. from the data-refresh signal), and a `WeakMap` genuinely cannot support the latter directly, restructure to also keep a `Set<WeakRef<DirectoryHandleLike>>` of known roots ONLY if a real "clear all" caller needs it — but check first whether the actual invalidation wiring in Step 4 below only ever needs "clear all" via a full module reset. If so, the simplest correct implementation is: keep the map as a **plain** `Map<DirectoryHandleLike, Map<string, AppendOnlyCacheEntry>>` reassigned to a fresh empty `Map` for "clear all", accepting that entries for disconnected workspaces persist until the next full-app reload or explicit workspace-level reset (`resetAppendOnlyDirectoryCache(root)` on disconnect, wired in Step 4) rather than being individually garbage-collected. Use your judgment on `WeakMap` vs. plain `Map` given this constraint — document whichever you choose and why in the module comment, and adjust `resetAppendOnlyDirectoryCache()`'s no-argument branch accordingly (`Map`: reassign to `new Map()`; if you find a way to make `WeakMap` work for both cases, e.g. by only ever calling reset with an explicit root from the refresh-signal wiring in Step 4 too, prefer that instead and remove the no-argument case entirely if it turns out to be unused — check Step 4's actual invalidation call before deciding).

- [ ] **Step 4: Wire in cache invalidation via the data-refresh signal, and into `readCurrentDistributionSource`**

```ts
// src/data/storage/directoryScan.ts — near the top of the module, after imports:
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

// Module-init side effect: purge the whole cache on manual refresh / the
// 5-minute auto-refresh. This makes "refresh" mean what users expect --
// nothing stays stale past an explicit or periodic refresh.
if (typeof window !== "undefined") {
  subscribeToDataRefresh(() => resetAppendOnlyDirectoryCache());
}
```

Verify `subscribeToDataRefresh`'s actual signature against `src/data/workspace/dataRefreshSignal.ts` before writing this — confirm it accepts a plain callback and returns an unsubscribe function (or nothing), and confirm calling it at module scope (not inside a component) is safe given how `AuthGate.tsx`/`AdminToolbar.tsx` already produce this signal. If `subscribeToDataRefresh` is designed to be called only from within a React effect (not at module scope), adapt: export `resetAppendOnlyDirectoryCache` and wire the subscription from a suitable existing top-level effect location instead (e.g. alongside where `AuthGate.tsx` already fires the signal) — check the file's real usage pattern first rather than guessing.

```ts
// src/data/distribution/distributionStorage.ts
// Update the import block to add:
import { readAppendOnlyDirectory } from "../storage/directoryScan";
```

```ts
// Replace readCurrentDistributionSource (lines 100-117):
async function readCurrentDistributionSource(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<Pick<DistributionLogSources, "currentLog" | "immutableEvents">> {
  const directory = await openOptionalDirectory(() =>
    getDistributionDir(directoryHandle, monthFolderName, false)
  );
  const currentLog = await readCompatibilityLog(
    directory,
    `Corrupt distribution compatibility log: ${LOG_FILE}`
  );
  // Existing immutable event directories are strict: corrupt/unreadable files
  // propagate so no caller can derive a silently incomplete snapshot.
  if (!directory) return { currentLog, immutableEvents: [] };
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await directory.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch {
    return { currentLog, immutableEvents: [] };
  }
  const { values } = await readAppendOnlyDirectory<DistributionEvent>(eventsDir, {
    suffix: ".json",
    onUnreadable: "throw",
    unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
    scope: { root: directoryHandle, path: `${monthFolderName}/1-main/${DISTRIBUTION_EVENTS_DIR}` },
  });
  // Re-sort: the fold is order-sensitive, and a new event with an earlier
  // eventAt than a cached one must still land in the right place -- the
  // cache's own internal order is by-filename, not by-eventAt.
  const immutableEvents = [...values].sort(
    (a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId)
  );
  return { currentLog, immutableEvents };
}
```

Note `DISTRIBUTION_EVENTS_DIR` is exported from `distributionEventStore.ts` (confirmed in Plan 1's work) — add it to this file's existing import from that module if not already imported.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/storage/directoryScan.test.ts`
Expected: PASS, all cases including the 7 new ones.

- [ ] **Step 6: Characterize distribution fold output BEFORE trusting the new read path, then confirm unchanged**

Per CLAUDE.md's determinism rule: add (if not already covered by existing tests) a golden test asserting `loadDistributionLog`'s output for a representative multi-event month is unchanged by this refactor.

```ts
// Append to src/data/distribution/distributionStorage.test.ts
describe("readCurrentDistributionSource via incremental cache (Task: §H Layer 2)", () => {
  it("produces the same merged, sorted event list on a warm cache as a cold read", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    const dir = await getSampleMainDir(root, month, true);
    const e1 = { ...buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }), eventAt: "2026-05-01T09:00:00.000Z" };
    const e2 = { ...buildAssignEvent({ xrayImageId: "A2", assignedTo: "bob", eventBy: "admin" }), eventAt: "2026-05-01T10:00:00.000Z" };
    await writeImmutableDistributionEvent(dir, e1);
    await writeImmutableDistributionEvent(dir, e2);

    const cold = await loadDistributionLog(root, month);
    // Second call is a warm-cache hit for e1/e2 -- add a third event first so
    // this call also exercises the "only new files read" incremental path.
    const e3 = { ...buildAssignEvent({ xrayImageId: "A3", assignedTo: "carol", eventBy: "admin" }), eventAt: "2026-05-01T08:00:00.000Z" }; // earlier than e1/e2
    await writeImmutableDistributionEvent(dir, e3);
    const warm = await loadDistributionLog(root, month);

    expect(warm.events.map((e) => e.eventId)).toEqual(
      [e3, e1, e2].map((e) => e.eventId) // sorted by eventAt: e3 (08:00) < e1 (09:00) < e2 (10:00)
    );
    expect(cold.events.map((e) => e.eventId).sort()).toEqual([e1.eventId, e2.eventId].sort());
  });
});
```

Adjust imports (`createMemoryDirectory`, `getSampleMainDir`, `buildAssignEvent`, `writeImmutableDistributionEvent`, `loadDistributionLog`) to match this test file's existing import block — merge, don't duplicate.

- [ ] **Step 7: Run the full distribution suite**

Run: `npx vitest run src/data/distribution src/data/storage/directoryScan.test.ts`
Expected: PASS, all files, including every pre-existing `distributionStorage.test.ts`/`distributionEventStore.test.ts`/`distributionLog.test.ts`/`bulkAssignment.test.ts`/`replacement.test.ts` case unmodified.

- [ ] **Step 8: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

- [ ] **Step 9: Edit log + version bump + commit**

Category: `Add:` (new caching capability). Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/storage/directoryScan.ts src/data/storage/directoryScan.test.ts src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(distribution): add incremental append-only cache for immutable event reads" -- src/data/storage/directoryScan.ts src/data/storage/directoryScan.test.ts src/data/distribution/distributionStorage.ts src/data/distribution/distributionStorage.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 2: In-flight read deduplication primitive (§H Layer 3)

**Files:**
- Create: `src/data/storage/inFlightReads.ts`
- Test: `src/data/storage/inFlightReads.test.ts`
- Modify: `src/data/distribution/distributionStorage.ts` (add `loadDistributionLogForRead`, `loadOrDeriveDistributionCurrentForRead`, wire `bumpWorkspaceEpoch` into `appendDistributionEvents`)
- Modify: `src/data/answers/answerStorage.ts` (wire `bumpWorkspaceEpoch` into `updateEmployeeAnswerFile`)
- Modify: `src/data/approvals/approvalStorage.ts` (wire `bumpWorkspaceEpoch` into `appendDecisionEvent`)

**Interfaces:**
- Produces:
  - `export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T>`
  - `export function workspaceScopeId(root: DirectoryHandleLike): string`
  - `export function bumpWorkspaceEpoch(root: DirectoryHandleLike, month: string): void`
  - `export function workspaceEpoch(root: DirectoryHandleLike, month: string): number`
  - `export function __clearInFlightForTests(): void`
  - `export async function loadDistributionLogForRead(directoryHandle, monthFolderName): Promise<DistributionLog>` — thin deduped wrapper around the existing `loadDistributionLog`.
  - `export async function loadOrDeriveDistributionCurrentForRead(directoryHandle, monthFolderName, sampleRows): Promise<DistributionCurrentData | null>` — thin deduped wrapper around `loadOrDeriveDistributionCurrent`.
- All existing exports of the three modified files are UNCHANGED — this task only adds new exports and inserts one `bumpWorkspaceEpoch(...)` call at the success point of three existing write functions.

**Background:** Even with Task 1's incremental cache, several screens still trigger the SAME logical read multiple times within one render cycle or one user action (e.g. React StrictMode double-invoking an effect, or two sibling components both loading month data independently). `dedupeInFlight` coalesces calls that are genuinely concurrent (same key, still-pending promise) without introducing any time-based staleness window — a call made after the previous one has already settled always does fresh work. `bumpWorkspaceEpoch` is defense-in-depth: even if a future refactor accidentally routes a should-be-fresh read through a deduped wrapper, the epoch bump on every successful write forces that read to miss the dedupe cache rather than silently reusing a pre-write result.

**CRITICAL — do NOT create deduped wrappers for, or otherwise touch the read behavior of, these 7 correctness-critical sites** (verified exhaustively against the current codebase; each exists specifically to observe a concurrent write and must always do a fresh read):
1. `src/data/referral/approveReferral.ts:73` — `loadReferralLog` in `approveReferral`, step 1 (fresh request state, "already-reviewed" check).
2. `src/data/referral/approveReferral.ts:83` — `loadDistributionLog` in `approveReferral`, step 2 (replay guard).
3. `src/data/referral/approveReferral.ts:142` — `loadDistributionLog` in `approveReferral`, post-append verification.
4. `src/data/referral/approveReferral.ts:161` — `loadAllSupervisorDecisions` in `approveReferral`, cross-reviewer guard (step 5a).
5. `src/data/referral/approveReferral.ts:186` — `loadAllSupervisorDecisions` in `approveReferral`, first-wins reconciliation (step 5c).
6. `src/data/referral/approveReferral.ts:239` — `loadDistributionLog` in `approveReplacement`, replay guard.
7. `src/data/referral/approveReferral.ts:268-272` — `loadOrDeriveDistributionCurrent` in `approveReplacement`, ownership check.
8. `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:610` — `freshDist` in `handleReplace`'s recommended-candidate path (freshness re-check before committing a replacement).
9. `src/data/distribution/distributionStorage.ts:258, 271, 280` — the three `loadDistributionLog` calls inside `appendDistributionEvents`'s `casLoop` callback.

(That's 9 sites, not 7 — the brief's own earlier estimate undercounted; use this list, not the summary count.) None of these files are modified by THIS task except `distributionStorage.ts`, and even there, only to ADD the new `...ForRead` wrapper functions plus the `bumpWorkspaceEpoch` call at the write success point — the 3 CAS-loop call sites (#9) are read verbatim, untouched.

- [ ] **Step 1: Write the failing tests**

```ts
// src/data/storage/inFlightReads.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import {
  dedupeInFlight,
  workspaceScopeId,
  bumpWorkspaceEpoch,
  workspaceEpoch,
  __clearInFlightForTests,
} from "./inFlightReads";

describe("dedupeInFlight", () => {
  beforeEach(() => __clearInFlightForTests());

  it("coalesces overlapping calls with the same key into one execution", async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 10));
    };
    const [a, b] = await Promise.all([
      dedupeInFlight("k", run),
      dedupeInFlight("k", run),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it("a call started after the previous one settled performs fresh work", async () => {
    let calls = 0;
    const run = () => { calls += 1; return Promise.resolve(calls); };
    const first = await dedupeInFlight("k2", run);
    const second = await dedupeInFlight("k2", run);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("a rejection is shared by overlapping callers, and the entry is removed so the next call retries", async () => {
    let attempt = 0;
    const run = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
    };
    await expect(Promise.all([dedupeInFlight("k3", run), dedupeInFlight("k3", run)])).rejects.toThrow("boom");
    const retried = await dedupeInFlight("k3", run);
    expect(retried).toBe("ok");
  });

  it("different keys never coalesce", async () => {
    let calls = 0;
    const run = () => { calls += 1; return Promise.resolve(calls); };
    await Promise.all([dedupeInFlight("x", run), dedupeInFlight("y", run)]);
    expect(calls).toBe(2);
  });
});

describe("workspaceScopeId", () => {
  it("returns a stable id for the same root across repeated calls", () => {
    const root = createMemoryDirectory();
    expect(workspaceScopeId(root)).toBe(workspaceScopeId(root));
  });

  it("returns different ids for two different roots", () => {
    const rootA = createMemoryDirectory("A");
    const rootB = createMemoryDirectory("B");
    expect(workspaceScopeId(rootA)).not.toBe(workspaceScopeId(rootB));
  });
});

describe("workspaceEpoch / bumpWorkspaceEpoch", () => {
  it("starts at 0 for an unbumped (root, month) pair and increments on bump", () => {
    const root = createMemoryDirectory();
    expect(workspaceEpoch(root, "5-May-2026")).toBe(0);
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "5-May-2026")).toBe(1);
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "5-May-2026")).toBe(2);
  });

  it("bumping one month does not affect another month's epoch on the same root", () => {
    const root = createMemoryDirectory();
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "6-June-2026")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/storage/inFlightReads.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the primitive**

```ts
// src/data/storage/inFlightReads.ts
import type { DirectoryHandleLike } from "./fileSystemAccess";

/**
 * Coalesce OVERLAPPING calls sharing the same key: while the promise for
 * `key` is unsettled, subsequent callers share it. The entry is removed the
 * instant it settles (resolve OR reject), so this is deliberately NOT a TTL
 * cache -- there is no staleness window. A call started after the previous
 * one finished always performs fresh work.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function __clearInFlightForTests(): void {
  inFlight.clear();
  scopeIds = new WeakMap();
  nextScopeId = 1;
  epochs.clear();
}

let scopeIds = new WeakMap<DirectoryHandleLike, string>();
let nextScopeId = 1;

/** Stable per-workspace-root id, so two workspaces open in one session never
 *  collide on a dedupe/epoch key even if they share a month folder name. */
export function workspaceScopeId(root: DirectoryHandleLike): string {
  let id = scopeIds.get(root);
  if (!id) {
    id = `ws${nextScopeId++}`;
    scopeIds.set(root, id);
  }
  return id;
}

const epochs = new Map<string, number>();

function epochKey(root: DirectoryHandleLike, month: string): string {
  return `${workspaceScopeId(root)}|${month}`;
}

/** Bumped on every successful write to a (root, month) pair. Included in
 *  dedupeInFlight keys so a post-write read can never coalesce with a
 *  pre-write read that happened to still be in flight -- defence-in-depth
 *  even if a future write path is mistakenly migrated to a deduped read.
 *  Per-tab only: it is sufficient to invalidate, never necessary for
 *  cross-machine freshness, which continues to come from each domain's own
 *  revision/_writeToken/contentHash mechanisms exactly as today. */
export function bumpWorkspaceEpoch(root: DirectoryHandleLike, month: string): void {
  const key = epochKey(root, month);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
}

export function workspaceEpoch(root: DirectoryHandleLike, month: string): number {
  return epochs.get(epochKey(root, month)) ?? 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/storage/inFlightReads.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Add the deduped wrapper functions and wire `bumpWorkspaceEpoch` into the three write paths**

```ts
// src/data/distribution/distributionStorage.ts
// Add to the import block:
import { dedupeInFlight, workspaceScopeId, bumpWorkspaceEpoch, workspaceEpoch } from "../storage/inFlightReads";
```

```ts
// Add near the bottom of the file, after loadOrDeriveDistributionCurrent:

/** Deduped sibling of loadDistributionLog for READ-ONLY call sites only.
 *  Never use this for a fresh-read-before-write correctness check -- see the
 *  exclusion list in this task's plan doc / the parent implementation plan. */
export function loadDistributionLogForRead(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|dist-log`;
  return dedupeInFlight(key, () => loadDistributionLog(directoryHandle, monthFolderName));
}

/** Deduped sibling of loadOrDeriveDistributionCurrent for READ-ONLY call
 *  sites only. Never use this for a fresh-read-before-write correctness
 *  check. */
export function loadOrDeriveDistributionCurrentForRead(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<DistributionCurrentData | null> {
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|dist-current`;
  return dedupeInFlight(key, () => loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows));
}
```

```ts
// In appendDistributionEvents, immediately after the line
//   if (result.ok) {
//     options?.onProgress?.({ phase: "complete", completed: events.length, total: events.length });
//   }
//   return result;
// add the epoch bump inside the same if-block, before the existing onProgress call or right after it:
  if (result.ok) {
    bumpWorkspaceEpoch(directoryHandle, monthFolderName);
    options?.onProgress?.({ phase: "complete", completed: events.length, total: events.length });
  }
  return result;
```

```ts
// src/data/answers/answerStorage.ts
// Add to the import block:
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
```

```ts
// Inside updateEmployeeAnswerFile's casLoop callback, find the block that
// returns { done: true, result: { ok: true as const }, verify: ... } after a
// successful verify — bump the epoch right before returning done:true. Locate
// the exact success-return point in the current file (it mirrors
// distributionStorage.ts's own casLoop shape) and add:
        bumpWorkspaceEpoch(directoryHandle, monthFolderName);
// immediately before that return statement.
```

```ts
// src/data/approvals/approvalStorage.ts
// Add to the import block:
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
```

```ts
// Inside appendDecisionEvent's casLoop callback, find the equivalent
// successful-verify return point and add the same bumpWorkspaceEpoch(...)
// call immediately before it, using this function's own directoryHandle/
// monthFolderName parameters.
```

For both `answerStorage.ts` and `approvalStorage.ts`, if the exact success-return shape differs from what's described (e.g. the `verify` callback structure), find the correct insertion point by locating where each function's `casLoop` callback returns `{ done: true, result: { ok: true }, ... }` and place the bump call immediately before that return — do not guess at line numbers, read the current file first.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/storage/inFlightReads.test.ts src/data/distribution src/data/answers src/data/approvals`
Expected: PASS, full suites, no regressions.

- [ ] **Step 7: Write the critical regression test — dedupe must never defeat a correctness-critical re-read**

This is the single most important test in this plan.

```ts
// Append to src/data/referral/approveReferral.test.ts (or wherever this
// file's existing cross-reviewer-conflict test already lives — search for
// "already-reviewed" first and extend that describe block if found, rather
// than creating a parallel one)
it("still detects a competing decision written between load and persist, after Task 2's dedupe primitives exist (regression guard)", async () => {
  // Reuse this file's EXISTING setup for the cross-reviewer race (two
  // supervisors, one referral request, one writes a decision after the
  // other's initial load but before its persist step) -- this test must
  // continue to return { ok: false, code: "already-reviewed" } exactly as
  // it did before this plan's changes. If this exact scenario isn't already
  // covered by an existing test in this file, build it using the same
  // pattern the existing "already-reviewed" tests use for seeding two
  // supervisor decision files.
});
```

If an existing test in `approveReferral.test.ts` already exercises this exact scenario (competing decision race), do NOT duplicate it — instead, just re-run that existing test as part of Step 8 and cite it by name in your report as the regression guard, rather than writing a redundant new one.

- [ ] **Step 8: Run the full referral/approval suite**

Run: `npx vitest run src/data/referral src/data/approvals`
Expected: PASS, including the cross-reviewer race test — this is the test that would fail loudly if any of the 9 excluded sites were accidentally routed through `dedupeInFlight`.

- [ ] **Step 9: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

- [ ] **Step 10: Edit log + version bump + commit**

Category: `Add:`. Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/data/storage/inFlightReads.ts src/data/storage/inFlightReads.test.ts src/data/distribution/distributionStorage.ts src/data/answers/answerStorage.ts src/data/approvals/approvalStorage.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(storage): add in-flight read dedupe primitive, wire epoch invalidation into write paths" -- src/data/storage/inFlightReads.ts src/data/storage/inFlightReads.test.ts src/data/distribution/distributionStorage.ts src/data/answers/answerStorage.ts src/data/approvals/approvalStorage.ts "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 3: Adopt deduped reads in Reports tab

**Files:**
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx`
- Test: existing test file covering this component (search for it first — check for `Reports/index.test.tsx` or similar; if none exists, this task needs no new test file, just confirm the existing suite this file is exercised by, e.g. any snapshot or integration test referencing Reports, still passes)

**Interfaces:**
- Consumes: `loadOrDeriveDistributionCurrentForRead` from `src/data/distribution/distributionStorage.ts` (Task 2).
- No exported interface changes to this file.

**Background:** Three call sites in this file (§ research: lines 246, 257, 410 as of this plan's writing — re-verify against current file, which may have shifted since Task 1/2 landed) are read-only display/export paths calling `loadOrDeriveDistributionCurrent` directly. Route them through the deduped wrapper.

- [ ] **Step 1: Locate the current exact line numbers**

Run: `grep -n "loadOrDeriveDistributionCurrent" src/components/Sidebar/Tabs/Reports/index.tsx`

Confirm there are exactly the 2 call sites this plan expects (the month-meta effect does NOT call this function per the research — only `loadAllEmployeeFiles`; only `loadExecInput` and the distribution-export handler call `loadOrDeriveDistributionCurrent`). If the count or context differs from what's described here, stop and report NEEDS_CONTEXT rather than guessing.

- [ ] **Step 2: Swap the import and both call sites**

```ts
// Change the import from:
//   import { loadOrDeriveDistributionCurrent, ... } from "../../../../data/distribution/distributionStorage";
// to import loadOrDeriveDistributionCurrentForRead instead (keep any other
// named imports from this module unchanged, just swap this one name):
import { loadOrDeriveDistributionCurrentForRead, ... } from "../../../../data/distribution/distributionStorage";
```

Replace both call sites (inside `loadExecInput` and inside the distribution-export handler) from `loadOrDeriveDistributionCurrent(...)` to `loadOrDeriveDistributionCurrentForRead(...)`, same arguments, no other changes.

- [ ] **Step 3: Run this file's test coverage**

Run whatever test command exercises this component (find it via Step 1's search). If none exists specifically for this file, run: `npm run typecheck && npm run lint` and the broader `npx vitest run src/components/Sidebar/Tabs/Reports` if any test files exist under that directory.
Expected: PASS/clean.

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

- [ ] **Step 5: Edit log + version bump + commit**

Category: `Refactor:`. Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/components/Sidebar/Tabs/Reports/index.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(reports): route read-only distribution loads through the deduped wrapper" -- src/components/Sidebar/Tabs/Reports/index.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 4: Adopt deduped reads in XrayInspectionResults and XrayReferrals' loadData

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx`
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`
- Test: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.test.tsx`, `.../XrayReferrals.test.tsx` (existing suites — run them, don't necessarily need new cases unless something specific needs pinning)

**Interfaces:**
- Consumes: `loadOrDeriveDistributionCurrentForRead`, `loadDistributionLogForRead` (Task 2).
- No exported interface changes.

**Background:** `XrayInspectionResults.tsx`'s `loadData` calls both `loadOrDeriveDistributionCurrent` (research: lines 236-240) and a separate `loadDistributionLog` (line 241) — both read-only, safe to dedupe. `XrayReferrals.tsx`'s `loadData` calls `loadOrDeriveDistributionCurrent` at line 381 — safe to dedupe. **`XrayReferrals.tsx`'s `handleReplace` `freshDist` call at line 610 is explicitly excluded (Task 2's list, item 8) — do NOT touch it.**

- [ ] **Step 1: Locate current exact line numbers in both files**

Run: `grep -n "loadOrDeriveDistributionCurrent\|loadDistributionLog" src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

Confirm: `XrayInspectionResults.tsx` has exactly 2 matches (both inside `loadData`). `XrayReferrals.tsx` has exactly 2 matches — one inside `loadData` (to be swapped) and one inside `handleReplace` as `freshDist` (to be LEFT UNTOUCHED — verify by reading the surrounding context that this second match is indeed the freshness re-check, not something else, before deciding not to touch it).

- [ ] **Step 2: Swap `XrayInspectionResults.tsx`'s two calls**

```ts
// Update the import from distributionStorage to use the ForRead variants:
import { loadOrDeriveDistributionCurrentForRead, loadDistributionLogForRead, ... } from "../../../../../data/distribution/distributionStorage";
```

Replace both calls inside `loadData` with their `ForRead` equivalents, same arguments, no other changes.

- [ ] **Step 3: Swap ONLY `XrayReferrals.tsx`'s `loadData` call**

```ts
// Update the import (add loadOrDeriveDistributionCurrentForRead alongside
// the existing loadOrDeriveDistributionCurrent import -- KEEP the original
// import too, since handleReplace's freshDist call still needs it):
import { loadOrDeriveDistributionCurrent, loadOrDeriveDistributionCurrentForRead, ... } from "../../../../../data/distribution/distributionStorage";
```

Replace ONLY the call inside `loadData` (the one feeding `dist`/`all`/`visible`) with `loadOrDeriveDistributionCurrentForRead(...)`. Do NOT touch the `freshDist` call inside `handleReplace` — it must remain `loadOrDeriveDistributionCurrent(...)` (the raw, non-deduped function), exactly as it is today.

- [ ] **Step 4: Self-verify the exclusion**

Run: `grep -n "loadOrDeriveDistributionCurrent(" src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx`

Expected: exactly ONE remaining match — the `freshDist` line inside `handleReplace`. If there are zero matches (meaning you accidentally swapped it too) or more than one, fix before proceeding — this is the plan's single most important correctness boundary.

- [ ] **Step 5: Run both files' test suites**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.test.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.test.tsx`
Expected: PASS, unmodified — behavior is identical, only the read path's caching/dedup characteristics changed.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

- [ ] **Step 7: Edit log + version bump + commit**

Category: `Refactor:`. Insert at the top of the edit log — explicitly call out in the entry body that `handleReplace`'s `freshDist` correctness-critical re-read was deliberately left unchanged. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(employee-workspace): route read-only distribution loads through the deduped wrapper" -- src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 5: Adopt deduped reads in the supervisor approve/deny screen

**Files:**
- Modify: `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`
- Test: existing test file for this hook if one exists (search first — `useApprovalData.test.ts` or similar); otherwise rely on the broader `ReferralApproval` component suite.

**Interfaces:**
- Consumes: `loadOrDeriveDistributionCurrentForRead` (Task 2). `loadSampleMaster` is unaffected (not a distribution-log read, out of this plan's scope — leave it as the raw function).

**Background:** This is the screen the original investigation identified as slow because it joins pending requests against full distribution state on every load (research: `loadSampleMaster` at line 112, `loadOrDeriveDistributionCurrent` at line 115, both inside `loadData`). Both feed a read-only `sampleDetails` display map — safe to dedupe the distribution call.

- [ ] **Step 1: Locate the current exact line number**

Run: `grep -n "loadOrDeriveDistributionCurrent" src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts`

Confirm exactly one match, inside `loadData`.

- [ ] **Step 2: Swap the call**

```ts
// Update the import to include the ForRead variant:
import { loadOrDeriveDistributionCurrentForRead } from "../../../../../data/distribution/distributionStorage";
```

Replace the single call site inside `loadData` with `loadOrDeriveDistributionCurrentForRead(...)`, same arguments.

- [ ] **Step 3: Run the relevant test suite**

Run: `npx vitest run src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval`
Expected: PASS, unmodified, including any existing tests covering `useApprovalData`.

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

- [ ] **Step 5: Edit log + version bump + commit**

Category: `Refactor:`. Insert at the top of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "perf(referral-approval): route read-only distribution load through the deduped wrapper" -- src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts "docs/edit logs/2026-08-03.md" package.json
```

---

## What this plan does NOT include

- `loadAllSupervisorDecisionsForRead`/`loadAllEmployeeFilesForRead` deduped wrappers — no call site was found in this plan's research that both (a) needs deduping and (b) isn't already one of the 9 excluded correctness-critical sites. If a future audit finds a genuine read-only call site for these, add the wrapper then (YAGNI — don't add unused exports now).
- Any further sections of the design spec (§I report-model cache, §K export yielding, §L-R startup/bundle/backup/search/font/cleanup) — separate plans.
