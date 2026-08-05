import type { DirectoryHandleLike } from "./fileSystemAccess";
import { safeReadJson } from "./safeWrite";
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";

/**
 * Bounded read fan-out for directory scans. The write side
 * (distributionStorage.ts's IMMUTABLE_EVENT_WRITE_CONCURRENCY) uses 4; reads
 * are cheaper per-call than the write side's stage/verify/commit cycle, so a
 * higher default is used here. Single exported constant so it stays a
 * one-line change if a real workspace (e.g. a network-backed folder) measures
 * better with a lower value.
 */
export const DIRECTORY_READ_CONCURRENCY = 8;

export type JsonDirectoryEntryLike = { name: string; kind: "file" | "directory" };

type RawEntry = { kind: "file" | "directory"; name: string };

function rawEntries(dir: DirectoryHandleLike): AsyncIterable<RawEntry> | null {
  const candidate = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<RawEntry>;
    entries?: () => AsyncIterable<[string, RawEntry]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<RawEntry>;
  };
  if (candidate.values) return candidate.values();
  if (candidate.entries) {
    const entries = candidate.entries();
    return (async function* () {
      for await (const [, entry] of entries) yield entry;
    })();
  }
  if (candidate[Symbol.asyncIterator]) return candidate as AsyncIterable<RawEntry>;
  return null;
}

/**
 * Materialized directory listing (names + kind only -- no file content is
 * read). Materializing before any content read starts enables stable,
 * deterministic ordering in readJsonDirectory independent of concurrent-read
 * settlement order or the underlying directory API's unspecified iteration
 * order. Not a new cost versus sequential loops, which already walk the
 * listing.
 */
export async function listDirectoryEntries(dir: DirectoryHandleLike): Promise<JsonDirectoryEntryLike[]> {
  const iterable = rawEntries(dir);
  if (!iterable) return [];
  const out: JsonDirectoryEntryLike[] = [];
  for await (const entry of iterable) {
    out.push({ name: entry.name, kind: entry.kind });
  }
  return out;
}

export type ReadJsonDirectoryOptions = {
  suffix: string;
  /** "throw" reproduces a strict "no caller derives a silently incomplete
   *  snapshot" policy; "skip" reproduces a best-effort aggregation policy. */
  onUnreadable: "throw" | "skip";
  /** Required when onUnreadable === "throw". */
  unreadableError?: (fileName: string) => string;
  concurrency?: number;
};

export type ReadJsonDirectoryResult<T> = {
  /** Name-sorted order (ascending, by filename), unreadable entries removed
   *  (or all present when onUnreadable === "throw", since any failure aborts
   *  the whole read). Sorted for deterministic ordering independent of
   *  concurrent-read completion order or underlying directory API iteration
   *  order. */
  values: T[];
  /** Names of the entries that produced `values`, index-aligned with it. */
  fileNames: string[];
  /** Every matching name in the listing (also name-sorted), including ones
   *  that failed to read. */
  matchedNames: string[];
};

/**
 * Bounded-concurrency read of an explicit, already-known list of file names
 * (no directory listing) -- the shared core of readJsonDirectory (which reads
 * every matching name in `dir`) and readAppendOnlyDirectory (which reads only
 * the names not already cached). Order of `names` is preserved in the
 * returned index-aligned values/fileNames, so callers that need name-sorted
 * output must pass a pre-sorted `names` array (both current callers do).
 */
async function readNamedJsonFiles<T>(
  dir: DirectoryHandleLike,
  names: string[],
  options: Pick<ReadJsonDirectoryOptions, "onUnreadable" | "unreadableError" | "concurrency">
): Promise<{ values: T[]; fileNames: string[] }> {
  const slots: (T | undefined)[] = new Array(names.length);
  const present: boolean[] = new Array(names.length).fill(false);

  const state = { nextIndex: 0, stop: false, firstFailure: null as { index: number; name: string } | null };

  async function worker(): Promise<void> {
    while (!state.stop) {
      const index = state.nextIndex;
      if (index >= names.length) return;
      state.nextIndex += 1;
      const name = names[index]!;
      const result = await safeReadJson<T>(dir, name);
      if (result.ok) {
        slots[index] = result.value;
        present[index] = true;
        continue;
      }
      if (options.onUnreadable === "skip") continue;
      // "throw" policy: record only the LOWEST index seen so far, so the
      // reported failure is deterministic regardless of which worker/await
      // settles first, then stop starting new work (existing in-flight reads
      // are still awaited via the outer Promise.all).
      if (state.firstFailure === null || index < state.firstFailure.index) {
        state.firstFailure = { index, name };
      }
      state.stop = true;
    }
  }

  // Clamp to >= 1: a zero/negative concurrency would otherwise start no
  // workers, silently returning an empty result indistinguishable from "the
  // directory is empty" instead of reading anything.
  const workerCount = Math.max(1, Math.min(options.concurrency ?? DIRECTORY_READ_CONCURRENCY, names.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (state.firstFailure) {
    const buildMessage = options.unreadableError ?? ((fileName: string) => `Cannot read JSON file: ${fileName}`);
    throw new Error(buildMessage(state.firstFailure.name));
  }

  const values: T[] = [];
  const fileNames: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if (present[i]) {
      values.push(slots[i] as T);
      fileNames.push(names[i]!);
    }
  }
  return { values, fileNames };
}

/**
 * Read every JSON file in `dir` matching `suffix`, with bounded concurrency.
 * Results are sorted by filename (ascending) for deterministic ordering
 * regardless of which worker finishes first or the underlying directory
 * API's iteration order. Matching entry names in matchedNames are also
 * sorted to enable deterministic failure reporting.
 */
export async function readJsonDirectory<T>(
  dir: DirectoryHandleLike,
  options: ReadJsonDirectoryOptions
): Promise<ReadJsonDirectoryResult<T>> {
  const entries = await listDirectoryEntries(dir);
  const matched = entries
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(options.suffix))
    .sort((a, b) => a.name.localeCompare(b.name));
  const matchedNames = matched.map((entry) => entry.name);

  const { values, fileNames } = await readNamedJsonFiles<T>(dir, matchedNames, options);
  return { values, fileNames, matchedNames };
}

export type AppendOnlyScope = { root: DirectoryHandleLike; path: string };

type AppendOnlyCacheEntry<T = unknown> = {
  names: Set<string>;
  byName: Map<string, T>;
};

// Keyed on the STABLE workspace root handle, not the leaf directory handle --
// getDirectoryHandle() returns a fresh object on every call in both the real
// File System Access API and this repo's memoryDirectory.ts test double, so a
// cache keyed on a leaf handle would never hit.
//
// Plain Map, not WeakMap: the manual-refresh data-refresh signal below
// (AdminToolbar.tsx's refresh button only -- the periodic 5-minute
// auto-refresh in AuthGate.tsx deliberately does NOT trigger this, see the
// subscription below) needs a genuine "clear every cached root" operation,
// and a WeakMap cannot be enumerated or cleared wholesale by design -- there
// is no placeholder-free way to implement that with a WeakMap. Trade-off: a
// disconnected workspace's cache entries are not individually
// garbage-collected -- they persist until the next no-argument "clear all"
// (which now only happens on an explicit manual refresh, not periodically)
// or an explicit resetAppendOnlyDirectoryCache(root) call, rather than
// becoming automatically collectible. Acceptable because this app has
// exactly one active workspace root at a time, and switching roots is rare.
let appendOnlyCache = new Map<DirectoryHandleLike, Map<string, AppendOnlyCacheEntry>>();

let statsEntries = 0;
let statsFilesReadLastCall = 0;
let statsFullRereads = 0;

/**
 * Clear the incremental cache for a single workspace root, or (no argument)
 * the entire cache across every root. Called with a root on a targeted
 * invalidation; called with no argument from the app-wide data-refresh
 * signal so "refresh" always means "nothing stays stale past this point".
 */
export function resetAppendOnlyDirectoryCache(root?: DirectoryHandleLike): void {
  if (root) {
    appendOnlyCache.delete(root);
  } else {
    appendOnlyCache = new Map();
  }
}

export function __appendOnlyCacheStatsForTests(): { entries: number; filesReadLastCall: number; fullRereads: number } {
  return { entries: statsEntries, filesReadLastCall: statsFilesReadLastCall, fullRereads: statsFullRereads };
}

/**
 * Incremental sibling to readJsonDirectory, for GENUINELY append-only
 * directories only (a file, once seen under a given name, is assumed never
 * to change content -- distribution.events/ is the only such directory in
 * this codebase today; do NOT apply this to answer/decision files, which are
 * mutable). Lists the directory (cheap, names only) on every call, reads
 * only names not already cached, merges, and returns the full merged result
 * in the same name-sorted order readJsonDirectory would produce -- so this is
 * a drop-in performance optimization, not a different contract.
 *
 * Detection is name-based: if any previously-cached name is missing from the
 * current listing (deletion, rename, workspace restore), the cache entry is
 * dropped and the next read is a full cold read. In-place content edits
 * under an unchanged filename are NOT detected (checking would require a
 * getFile() call per cached name, defeating the point) -- this codebase's own
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
    // Read ONLY newNames via the shared readNamedJsonFiles core -- calling
    // readJsonDirectory here would re-scan-and-re-read the WHOLE directory
    // (including files already cached), which would silently defeat the
    // entire point of this cache while still LOOKING like an incremental
    // read from the merged result alone.
    const newlyRead = await readNamedJsonFiles<T>(dir, newNames, readOptions);
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

// Module-init side effect: purge the whole cache on manual refresh
// (AdminToolbar.tsx) only -- see the source check below for why the
// periodic auto-refresh (AuthGate.tsx) is deliberately excluded.
// subscribeToDataRefresh is a plain
// window.addEventListener wrapper (see dataRefreshSignal.ts) with no React
// dependency, so calling it here at module scope -- rather than from inside
// a component effect -- is safe. The `typeof window` guard idiom itself is
// precedented elsewhere in this directory (workspaceWriteAccess.ts,
// fileSystemAccess.ts, safeWrite.ts) -- but only inside function bodies,
// invoked on demand; this is the first case of it gating an unconditional
// module-init side effect here. That's intentional: the cache needs to
// start listening as soon as the module loads, not on first call, and the
// guard keeps this module importable from a non-browser context (e.g.
// Vitest's "node" test environment) without throwing.
if (typeof window !== "undefined") {
  // Only the manual admin refresh wholesale-resets this cache. The periodic
  // 5-minute auto-refresh (AuthGate.tsx) does NOT -- this cache's own
  // per-file name-diff invalidation (see readAppendOnlyDirectory above) is
  // already correct, so a periodic wholesale reset only pays full re-read
  // cost every 5 minutes with no correctness benefit.
  subscribeToDataRefresh((source) => {
    if (source === "manual") resetAppendOnlyDirectoryCache();
  });
}
