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

export type SizedDirectoryEntry = {
  name: string;
  size: number;
  /**
   * `File.lastModified` (epoch ms). Carried alongside `size` purely as a second
   * change-detection axis -- never compared across machines, never used for
   * ordering, so the clock-skew objection that rules `lastModified` out as a
   * *timestamp* does not apply. See `listDirectoryEntriesWithSize`.
   */
  lastModified: number;
};

/**
 * Run `work(index)` for every index in `[0, count)` with at most `concurrency`
 * in flight. Rejections propagate (every worker promise is awaited, so no
 * sibling rejection is left unhandled) -- deliberately fail-fast, no retry.
 */
async function forEachBounded(
  count: number,
  concurrency: number,
  work: (index: number) => Promise<void>
): Promise<void> {
  const state = { nextIndex: 0 };
  async function worker(): Promise<void> {
    for (;;) {
      const index = state.nextIndex;
      if (index >= count) return;
      state.nextIndex += 1;
      await work(index);
    }
  }
  // Clamp to >= 1 for the same reason readNamedJsonFiles does: zero workers
  // would silently return "nothing" rather than reading anything.
  const workerCount = Math.max(1, Math.min(concurrency, count || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/**
 * Sized listing (§4.2 of the perf/sync spec, F21): for every file matching
 * `suffix`, return its name, byte size AND mtime -- `listDirectoryEntries`
 * alone (`{name, kind}` only) can detect a NEW file appearing, but cannot
 * detect a request appended into an EXISTING file (e.g. a new referral request
 * landing inside an already-present `{user}.answers.json`).
 *
 * WHY BOTH size AND lastModified. Size alone is blind to any edit that
 * preserves byte length, which on a `JsonEnvelope` is not a corner case: the
 * envelope's own `revision` going 9 -> 10, its `writtenAt` moving, its
 * `contentHash` changing, or any same-width field edit all keep the file
 * exactly as long. Such a tick's signature would be byte-identical to the
 * previous one and the change would stay invisible until someone pressed the
 * manual refresh button.
 *
 * The obvious fix -- read the envelope's `metadata.revision` per file -- was
 * costed and rejected for this call site: `getFile()` yields a `File` WITHOUT
 * transferring content, so `size`/`lastModified` are free, whereas reading even
 * a bounded slice of the file is a second round trip per file, on every tick,
 * on every client (~30 here), for every employee's answers file. That doubles
 * the tick's dominant term on the UNC/SMB share this app is deployed on. And it
 * buys nothing measurable: `revision` differs from `(size, lastModified)` only
 * for two writes to one file that land in the same filesystem timestamp tick --
 * a safe-write is several round trips long, so that window is not reachable in
 * practice. `revision` IS still the signal for the single-file probes
 * (`month.manifest.json`, `notifications.json`), where it costs one read total
 * rather than one per employee.
 *
 * Costs ONE `getFile()` per matched file on the success path -- the handle comes
 * from the enumeration itself (`listMatchingFileEntries`), so the second
 * `getFileHandle()` round trip this used to pay per file is gone. It is still
 * NOT a free listing: callers budgeting the unchanged-tick round trips (the
 * sync tick) must count one operation per matched file.
 *
 * Those per-file opens are issued with bounded CONCURRENCY, not one after
 * another. The count is unchanged -- what changes is that a workspace with N
 * employees no longer serializes N share round trips into the tick's critical
 * path (N x RTT becomes ceil(N / DIRECTORY_READ_CONCURRENCY) x RTT). Ordering
 * is unaffected: results are placed by listing index, not settle order.
 */
export async function listDirectoryEntriesWithSize(
  dir: DirectoryHandleLike,
  suffix: string
): Promise<SizedDirectoryEntry[]> {
  const matched = await listMatchingFileEntries(dir, suffix);
  const slots: (SizedDirectoryEntry | null)[] = new Array(matched.length).fill(null);

  await forEachBounded(matched.length, DIRECTORY_READ_CONCURRENCY, async (index) => {
    const entry = matched[index]!;
    // No retry budget here (`null`), unlike readSegmentTails. This runs on every
    // sync tick over every answers/decisions file in the workspace, and the
    // value it produces is a change-detection signature, not data: dropping one
    // entry makes this tick's signature differ from the last, which at worst
    // reports the family as "changed" and triggers one extra refresh. Paying a
    // retry ladder per entry to avoid that would let one flaky share stall
    // every tick in proportion to the number of employees. A tick that fails
    // fails fast and is retried by the NEXT tick -- retries must never stack.
    const stat = await readListedEntry(
      dir,
      entry,
      async (file) => ({ size: file.size, lastModified: file.lastModified }),
      null
    );
    if (stat === null) return; // slot stays null -> reported as vanished below
    slots[index] = { name: entry.name, size: stat.size, lastModified: stat.lastModified };
  });

  // Both lists are built from the listing order, so neither the returned
  // entries nor the logged vanished names depend on which open settled first.
  const out: SizedDirectoryEntry[] = [];
  const vanished: string[] = [];
  for (let index = 0; index < matched.length; index += 1) {
    const slot = slots[index];
    if (slot === null) {
      vanished.push(matched[index]!.name);
      continue;
    }
    out.push(slot);
  }
  logVanishedEntries("directoryScan:sized-listing", dir, vanished);
  return out;
}

/**
 * Stat budget for `boundedSizeSignature`. Every stat is a network round trip on
 * the UNC/SMB share, paid by every client on every sync tick, so the cost of a
 * probe built on this must not grow without bound with the size of the
 * directory: past the budget, a new or removed entry is still detected by NAME
 * alone, which the listing gives away for free.
 *
 * 64 is sized against the largest current caller, the distribution event
 * segments: at 128 KB per segment (MAX_OPEN_SEGMENT_BYTES) that already covers
 * ~8 MB of event log. The per-employee ack files are far below it.
 */
export const DEFAULT_SIZE_SIGNATURE_STAT_BUDGET = 64;

/**
 * A bounded change signature for a directory whose per-file CONTENT is not worth
 * reading on a sync tick. Two callers today, both in `workspaceSync.ts`:
 *
 *  - the distribution event segments. They are already covered by
 *    `distribution.log.json`'s CAS stamp — but only while the two move
 *    TOGETHER. A restore merges events into the segments and deliberately does
 *    not rewrite the projection (backupStorage's `restore-if-absent`), and a
 *    partly-failed append can leave events durable in a segment whose projection
 *    write never landed. In both cases the durable event data moved and the
 *    stamp did not, so no other machine on the share ever learns. This signature
 *    is the independent second signal.
 *  - the per-employee notification ack files. `notifications.json`'s revision
 *    covers broadcasts only, so an ack moves nothing that probe can see.
 *
 * BOUNDED, deliberately: one directory listing, no file content is read, and at
 * most `maxStats` `getFile()` size probes — taken from the tail of the
 * name-sorted listing, so which entries are probed is stable across ticks (a
 * signature that reshuffled its own sample would report a change on an untouched
 * directory). Every matched NAME is in the signature whether or not it was
 * probed, so a new or removed file is always detected; on a directory with more
 * files than the budget, GROWTH of an unprobed file is not — for the segments
 * that growth is picked up anyway once the segment rotates into a new name.
 *
 * An entry that vanishes mid-scan is dropped from the signature exactly as
 * `listDirectoryEntriesWithSize` drops it — worst case one extra refresh, never
 * a missed one.
 */
export async function boundedSizeSignature(
  dir: DirectoryHandleLike,
  suffix: string,
  maxStats: number = DEFAULT_SIZE_SIGNATURE_STAT_BUDGET
): Promise<string> {
  const matched = await listMatchingFileEntries(dir, suffix);
  const names = matched.map((entry) => entry.name);
  const probed = matched.slice(Math.max(0, matched.length - Math.max(0, maxStats)));
  const sizes: (number | null)[] = new Array(probed.length).fill(null);

  await forEachBounded(probed.length, DIRECTORY_READ_CONCURRENCY, async (index) => {
    // Same "no retry budget" reasoning as listDirectoryEntriesWithSize: this is
    // a change-detection signature, not data, and it runs on every tick.
    sizes[index] = await readListedEntry(dir, probed[index]!, async (file) => file.size, null);
  });

  const sized: [string, number][] = [];
  const vanished: string[] = [];
  for (let index = 0; index < probed.length; index += 1) {
    const size = sizes[index];
    if (size === null) {
      vanished.push(probed[index]!.name);
      continue;
    }
    sized.push([probed[index]!.name, size]);
  }
  logVanishedEntries("directoryScan:bounded-signature", dir, vanished);
  return JSON.stringify([names, sized]);
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
