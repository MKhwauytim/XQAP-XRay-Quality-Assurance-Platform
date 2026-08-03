import type { DirectoryHandleLike } from "./fileSystemAccess";
import { safeReadJson } from "./safeWrite";

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
 * read). Materializing before any content read starts is what makes
 * readJsonDirectory's index-assigned result ordering possible; it is not a
 * new cost versus the sequential loops it replaces, which already walk the
 * same listing.
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
  /** Listing order, unreadable entries removed (or all present when
   *  onUnreadable === "throw", since any failure aborts the whole read). */
  values: T[];
  /** Names of the entries that produced `values`, index-aligned with it. */
  fileNames: string[];
  /** Every matching name in the listing, including ones that failed to read. */
  matchedNames: string[];
};

/**
 * Read every JSON file in `dir` matching `suffix`, with bounded concurrency,
 * preserving directory-listing order in the result regardless of which
 * worker finishes first.
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

  const slots: (T | undefined)[] = new Array(matched.length);
  const present: boolean[] = new Array(matched.length).fill(false);

  const state = { nextIndex: 0, stop: false, firstFailure: null as { index: number; name: string } | null };

  async function worker(): Promise<void> {
    while (!state.stop) {
      const index = state.nextIndex;
      if (index >= matched.length) return;
      state.nextIndex += 1;
      const entry = matched[index]!;
      const result = await safeReadJson<T>(dir, entry.name);
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
        state.firstFailure = { index, name: entry.name };
      }
      state.stop = true;
    }
  }

  const workerCount = Math.min(options.concurrency ?? DIRECTORY_READ_CONCURRENCY, matched.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (state.firstFailure) {
    const buildMessage = options.unreadableError ?? ((fileName: string) => `Cannot read JSON file: ${fileName}`);
    throw new Error(buildMessage(state.firstFailure.name));
  }

  const values: T[] = [];
  const fileNames: string[] = [];
  for (let i = 0; i < matched.length; i++) {
    if (present[i]) {
      values.push(slots[i] as T);
      fileNames.push(matched[i]!.name);
    }
  }
  return { values, fileNames, matchedNames };
}
