import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { safeReadJson } from "./safeWrite";
import { subscribeToDataRefresh } from "../workspace/dataRefreshSignal";
import { logError } from "./errorLogger";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  isNotFoundError,
  isNotReadableError,
  waitFor,
} from "./transientFileErrors";

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

/**
 * The entries yielded by `FileSystemDirectoryHandle.values()` ARE handles --
 * the enumeration already materialized them, so a file entry can be read
 * without a second `getFileHandle()` lookup. `RawEntry` is deliberately typed
 * as the narrow `{name, kind}` shape the listing consumers need, so this is
 * the one place that widens it again.
 */
function asFileHandle(entry: RawEntry): FileHandleLike | null {
  if (entry.kind !== "file") return null;
  const candidate = entry as RawEntry & Partial<FileHandleLike>;
  return typeof candidate.getFile === "function" ? (candidate as FileHandleLike) : null;
}

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
export async function readNamedJsonFiles<T>(
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
// (AdminToolbar.tsx's refresh button only -- the automatic 45s sync run in
// SyncTick.tsx deliberately does NOT trigger this, see the subscription
// below) needs a genuine "clear every cached root" operation,
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

/* ------------------------------------------------------------------ *
 * Enumerate-then-open tolerance (UNC/SMB)
 * ------------------------------------------------------------------ */

/**
 * Every "list the directory, then re-open each entry by name" loop below has a
 * gap between the two steps. On a shared folder another machine can rename,
 * remove, or finish writing an entry inside that gap, and this client's
 * directory view can also simply lag behind the server's. Either way the open
 * raises `NotFoundError` (or `NotReadableError`) for a name the listing just
 * reported.
 *
 * That is a NORMAL condition on a share, not a failure of the enumeration. It
 * previously propagated as a bare Chromium DOMException — the un-Arabic
 * "A requested file or directory could not be found at the time an operation was
 * processed." users reported — and aborted the remaining entries with it.
 *
 * Retry policy is deliberately NOT uniform across the two call sites, because
 * the cost of a wrong answer is not uniform either. See each function.
 */
const VANISHED_ENTRY_RETRY_DELAYS_MS = TRANSIENT_WRITE_RETRY_DELAYS_MS.slice(
  0,
  2
) as readonly number[];

export { VANISHED_ENTRY_RETRY_DELAYS_MS };

/**
 * Retries left for ONE call of `readSegmentTails`, shared across every entry it
 * opens rather than granted per entry. A per-entry ladder would multiply the
 * worst-case wait by the segment count (one segment per writer device-session,
 * so it grows with the number of machines using the workspace); a per-call
 * budget bounds a whole-directory outage at ~80 ms of added latency no matter
 * how many segments are listed.
 */
export const SEGMENT_TAIL_VANISH_RETRY_BUDGET = 2;

type VanishRetryBudget = { remaining: number };

/** A matched listing entry, carrying the handle the enumeration already produced. */
type MatchedFileEntry = { name: string; handle: FileHandleLike | null };

/**
 * Name-sorted listing of the files matching `suffix`, each paired with the
 * handle its enumeration yielded.
 *
 * UNC/SMB COST (the reason this exists): every "list, then re-open each entry by
 * name" loop paid TWO round trips per matched file — `getFileHandle(name)` and
 * then `getFile()`. The `getFileHandle` half is pure waste: `values()` already
 * handed back the handle. Reusing it halves the per-file cost of the sync
 * tick's sized listing (run every tick by every client, over every employee's
 * answers/decisions file) and of the distribution segment-tail read. Directory
 * APIs that yield bare `{name, kind}` records (older shims, hand-written test
 * doubles) still work — `handle` is simply `null` and the by-name open is used.
 */
async function listMatchingFileEntries(
  dir: DirectoryHandleLike,
  suffix: string
): Promise<MatchedFileEntry[]> {
  const iterable = rawEntries(dir);
  if (!iterable) return [];
  const matched: MatchedFileEntry[] = [];
  for await (const entry of iterable) {
    if (entry.kind !== "file" || !entry.name.endsWith(suffix)) continue;
    matched.push({ name: entry.name, handle: asFileHandle(entry) });
  }
  return matched.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads a listed entry via `read`. Resolves to `null` — never throws — when the
 * entry has vanished (or stayed invisible for the whole budget). Any other
 * failure (permission denied, quota, a genuinely corrupt handle) still
 * propagates: those are not "the share moved on", and silently dropping them
 * would hand callers a short listing that looks like real data.
 *
 * The first attempt uses the handle the enumeration already produced (one round
 * trip). Only a RETRY re-opens by name — deliberately, because the point of
 * retrying is to get the share to re-resolve the entry, which a handle that has
 * already failed will not do.
 */
async function readListedEntry<T>(
  dir: DirectoryHandleLike,
  entry: MatchedFileEntry,
  read: (file: File) => Promise<T>,
  budget: VanishRetryBudget | null
): Promise<T | null> {
  let handle = entry.handle;
  for (let attempt = 0; ; attempt += 1) {
    try {
      handle ??= await dir.getFileHandle(entry.name, { create: false });
      return await read(await handle.getFile());
    } catch (error) {
      if (!isNotFoundError(error) && !isNotReadableError(error)) throw error;
      const canRetry =
        budget !== null &&
        budget.remaining > 0 &&
        attempt < VANISHED_ENTRY_RETRY_DELAYS_MS.length;
      if (!canRetry) return null;
      budget.remaining -= 1;
      handle = null;
      await waitFor(VANISHED_ENTRY_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/**
 * One log line per call, not per entry: a share that loses sight of a directory
 * loses sight of every name in it at once, and 200 identical entries would
 * evict the whole 50-entry error ring buffer (errorLogger.ts) that the admin
 * error view reads.
 */
function logVanishedEntries(context: string, dir: DirectoryHandleLike, names: string[]): void {
  if (names.length === 0) return;
  logError(
    context,
    new Error(
      `Skipped ${names.length} listed entr${names.length === 1 ? "y" : "ies"} that could not be ` +
        `opened in "${dir.name}" (present in the listing, NotFound/NotReadable on open — ` +
        `renamed, removed, or not yet visible on a shared folder): ${names.join(", ")}`
    )
  );
}

export type SizedDirectoryEntry = { name: string; size: number };

/**
 * Sized listing (§4.2 of the perf/sync spec, F21): for every file matching
 * `suffix`, return its name AND byte size -- `listDirectoryEntries` alone
 * (`{name, kind}` only) can detect a NEW file appearing, but cannot detect a
 * request appended into an EXISTING, larger file (e.g. a new referral
 * request landing inside an already-present `{user}.answers.json`). It prefers
 * `size` over `lastModified` because `File.size` is obtained without reading
 * file content, and is clock-skew-immune, unlike wall-clock `lastModified` on
 * an unsynchronized network share.
 *
 * Costs ONE `getFile()` per matched file on the success path -- the handle comes
 * from the enumeration itself (`listMatchingFileEntries`), so the second
 * `getFileHandle()` round trip this used to pay per file is gone. It is still
 * NOT a free listing: callers budgeting the unchanged-tick round trips (the
 * sync tick) must count one operation per matched file.
 */
export async function listDirectoryEntriesWithSize(
  dir: DirectoryHandleLike,
  suffix: string
): Promise<SizedDirectoryEntry[]> {
  const matched = await listMatchingFileEntries(dir, suffix);

  const out: SizedDirectoryEntry[] = [];
  const vanished: string[] = [];
  for (const entry of matched) {
    // No retry budget here (`null`), unlike readSegmentTails. This runs on every
    // sync tick over every answers/decisions file in the workspace, and the
    // value it produces is a change-detection signature, not data: dropping one
    // entry makes this tick's signature differ from the last, which at worst
    // reports the family as "changed" and triggers one extra refresh. Paying a
    // retry ladder per entry to avoid that would let one flaky share stall
    // every tick in proportion to the number of employees.
    const size = await readListedEntry(dir, entry, async (file) => file.size, null);
    if (size === null) {
      vanished.push(entry.name);
      continue;
    }
    out.push({ name: entry.name, size });
  }
  logVanishedEntries("directoryScan:sized-listing", dir, vanished);
  return out;
}

export type SegmentTailOptions = {
  suffix: string;
  /** Byte offset already consumed per file name; a name missing from this map defaults to 0 (read from the start). */
  knownOffsets: Record<string, number>;
};

export type SegmentTailResult = {
  /** New tail text per file name that grew past its known offset. A file with
   *  no new bytes (unchanged size, or shrunk -- treated as no-op, never
   *  negative-length-read) is simply absent from this map. */
  tailTextByName: Map<string, string>;
  /** Current byte size for every matched file, whether or not it grew --
   *  callers persist this verbatim as the new knownOffsets for next time. */
  sizeByName: Map<string, number>;
  /** Every matching file name in the current listing, name-sorted. */
  matchedNames: string[];
};

/**
 * Read only the bytes appended past each file's previously-known offset, for
 * GENUINELY append-only, monotonically-growing files (distribution event
 * segments -- see distributionEventStore.ts). This is the size-diff sibling
 * of readAppendOnlyDirectory's name-diff: a name-diff is wrong here because a
 * segment file's CONTENT keeps growing under an unchanged name, so a bare
 * "have I seen this name before" check would silently miss every line
 * appended after the first sighting.
 *
 * `File.size` (byte length) is obtained from getFile() without reading file
 * content, and is monotonic and clock-skew-immune for an append-only file --
 * unlike `lastModified`, which is wall-clock and unsynchronized across
 * machines on a network share. `Blob.slice(offset)` then reads only the tail
 * bytes. Both are used here for exactly that reason: change detection and
 * partial reads must not depend on any clock.
 */
export async function readSegmentTails(
  dir: DirectoryHandleLike,
  options: SegmentTailOptions
): Promise<SegmentTailResult> {
  const matched = await listMatchingFileEntries(dir, options.suffix);
  const matchedNames = matched.map((entry) => entry.name);

  const tailTextByName = new Map<string, string>();
  const sizeByName = new Map<string, number>();

  // Shared across every segment in this call — see
  // SEGMENT_TAIL_VANISH_RETRY_BUDGET. A short retry IS warranted here (unlike
  // the sized listing above) because this feeds distribution event folding, and
  // is reached from inside appendDistributionEvents' casLoop: silently folding
  // without a segment that is merely invisible for a few milliseconds would let
  // an append decide against state that is missing real events.
  const budget: VanishRetryBudget = { remaining: SEGMENT_TAIL_VANISH_RETRY_BUDGET };
  const vanished: string[] = [];

  for (const entry of matched) {
    const name = entry.name;
    const knownOffset = options.knownOffsets[name] ?? 0;
    const read = await readListedEntry(
      dir,
      entry,
      async (file) => ({
        size: file.size,
        // A shrunk or unchanged file yields no tail — never a negative-length read.
        tail: file.size > knownOffset ? await file.slice(knownOffset).text() : null,
      }),
      budget
    );
    if (read === null) {
      // Deliberately no sizeByName entry: callers persist sizeByName as the
      // next call's knownOffsets, and recording a size for a segment whose
      // bytes were never read would mark unread events as already consumed.
      // Leaving it out keeps the caller's existing offset for this name, so the
      // next read picks the segment up exactly where it left off.
      vanished.push(name);
      continue;
    }
    sizeByName.set(name, read.size);
    if (read.tail !== null) tailTextByName.set(name, read.tail);
  }

  logVanishedEntries("directoryScan:segment-tails", dir, vanished);

  return { tailTextByName, sizeByName, matchedNames };
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
  // Only the manual admin refresh wholesale-resets this cache. The automatic
  // 45s sync run (SyncTick.tsx -> runSync in workspaceSync.ts) does NOT --
  // this cache's own per-file name-diff invalidation (see
  // readAppendOnlyDirectory above) is already correct, so an automatic
  // wholesale reset only pays full re-read cost every 45s with no
  // correctness benefit.
  subscribeToDataRefresh((source) => {
    if (source === "manual") resetAppendOnlyDirectoryCache();
  });
}
