import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  DERIVE_VERSION,
  deriveCurrentDistributionIncremental,
  deriveCurrentDistributionWithFacts,
} from "./distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionFoldCheckpoint,
  DistributionLog,
  QuotaFacts
} from "./distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError, logRejection } from "../storage/errorLogger";
import { casLoop } from "../storage/casLoop";
import { codedMessage, logCodedError, resolveErrorCode } from "../storage/errorCodes";
import { listDirectoryEntries, readAppendOnlyDirectory, readNamedJsonFiles } from "../storage/directoryScan";
import { ensureMonthWritable } from "../population/monthLock";
import { syncSampleMirrors } from "../samples/sampleMirrorStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import {
  getPopulationMonthDir,
  getSampleMainDir,
  invalidateWorkspaceDirCache,
} from "../workspace/workspacePaths";
import {
  DISTRIBUTION_EVENTS_DIR,
  appendDistributionEventsDurably,
  distributionEventSetId,
  getDistributionDeviceId,
  getDistributionSessionId,
  distributionEventSetIdFromIds,
  mergeDistributionEvents,
  readDistributionEventSegmentDelta,
  sortDistributionEventsForFold,
} from "./distributionEventStore";
import { dedupeInFlight, workspaceScopeId, bumpWorkspaceEpoch, workspaceEpoch } from "../storage/inFlightReads";
import { isNotFoundError } from "../storage/transientFileErrors";

const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";
/**
 * Fold-checkpoint sidecar (v85). Lives beside `distribution.current.json` in
 * `2-samples/{month}/1-main`. Exported because the backup/restore layer must
 * classify it BY EXACT NAME: it is derived state that must never be restored,
 * and it must be deleted whenever a restore rewrites the event segments its
 * byte offsets point into (see backupStorage's `invalidateDistributionCaches`).
 */
export const DISTRIBUTION_CHECKPOINT_FILE = "distribution.checkpoint.json";

export type DistributionWriteProgress =
  | { phase: "events"; completed: number; total: number }
  | { phase: "projection" | "verification" | "complete"; completed: number; total: number };

type AppendDistributionEventsOptions = {
  onProgress?: (progress: DistributionWriteProgress) => void;
};

/**
 * Durably write a whole event batch in ONE segment append (see
 * appendDistributionEventSegment) instead of one file per event. This
 * collapses what used to be ~10 File System Access operations PER EVENT (a
 * pre-write existence check, safeWriteJson's stage/verify/commit cycle, and a
 * post-write read-back verify) into a small constant number of operations for
 * the entire batch — the whole point of the per-writer-session segment
 * layout (see distributionEventStore.ts's module docs).
 */
async function writeDistributionEventBatch(
  directory: DirectoryHandleLike,
  events: DistributionEvent[],
  scopeId: string,
  onProgress?: AppendDistributionEventsOptions["onProgress"],
  /** Root + month, so a failed write can retry against a freshly-resolved
   *  directory handle (see DurableAppendOptions.reopenDir). */
  reopen?: { root: DirectoryHandleLike; monthFolderName: string }
): Promise<"verified" | "unverified"> {
  onProgress?.({ phase: "events", completed: 0, total: events.length });
  // `scopeId` gives the "have I already written this segment" memo stable
  // workspace+month identity — without it a workspace switch mid-session leaves
  // a stale name-keyed hit that costs the whole retry ladder on the next append.
  const verification = await appendDistributionEventsDurably(directory, events, {
    writer: {
      deviceId: getDistributionDeviceId(),
      sessionId: getDistributionSessionId(),
      scopeId,
    },
    onChunk: (completed, total) => onProgress?.({ phase: "events", completed, total }),
    reopenDir: reopen
      ? async () => {
          // Purge first: `getSampleMainDir` answers from the workspace
          // directory-handle cache, so without this the "retry" would hand back
          // the very handle that just failed.
          //
          // WHAT THIS CAN AND CANNOT RECOVER — state it precisely, because the
          // difference decides whether the retry is worth anything.
          //
          // CAN: every handle BELOW the root. `invalidateWorkspaceDirCache(root)`
          // drops that root's whole cache entry — resolved root names included —
          // so the call below re-derives `2-samples`, the month folder and
          // `1-main` from the root handle, in that order. Each is a fresh
          // `getDirectoryHandle`, so a child that went stale (the share
          // re-created the folder, an idle SMB session invalidated a descriptor)
          // is replaced rather than reused. That is the whole of the cheap
          // refresh available here, and it already covers every intermediate
          // handle — there is no narrower subtree left to purge.
          //
          // CANNOT: the ROOT handle itself. `WorkspaceProvider` has held it
          // since mount and nothing here can re-acquire it — `showDirectoryPicker`
          // requires a user gesture, so a genuinely dead root can only be fixed
          // by the user re-picking the workspace folder (XQ-IO-030 says exactly
          // that). If the fault lives in the root, this retry re-resolves the
          // same broken chain and fails identically; the durable-append path
          // then degrades to per-event files, which is the actual recovery.
          invalidateWorkspaceDirCache(reopen.root);
          return getDistributionDir(reopen.root, reopen.monthFolderName);
        }
      : undefined,
  });
  // No closing tick here: `onChunk` already reported the last chunk, which IS
  // `events.length`. Emitting again produced a duplicate final update.
  return verification;
}

async function getDistributionDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  create = true
): Promise<DirectoryHandleLike> {
  return getSampleMainDir(directoryHandle, monthFolderName, create);
}

async function getLegacyDistributionDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getPopulationMonthDir(directoryHandle, monthFolderName, false);
}

type DistributionLogSources = {
  currentLog: DistributionLog | null;
  legacyLog: DistributionLog | null;
  immutableEvents: DistributionEvent[];
};

/**
 * Open a directory that is legitimately allowed not to exist yet, WITHOUT
 * laundering "I could not look" into "there is nothing there".
 *
 * This is the same contract the read below applies to files, and it has to be
 * applied here too. The previous bare `catch { return null }` swallowed every
 * failure — NotReadableError on a flaky share, NotAllowedError after a revoked
 * grant, an I/O fault opening `2-samples` or `1-main` — and turned each of them
 * into `{ events: [] }`. `loadDistributionLog` then reported ZERO events for a
 * month with a full assignment history, the re-draw hard block read that as
 * "nothing distributed yet", and `saveSampleMaster` overwrote sample.master.json,
 * orphaning every assignment and answer in the month.
 *
 * The earlier fix for this bug class was applied one level down (see the
 * `isNotFoundError` guard in the events read) and its regression test faulted
 * only the leaf `distribution.events` directory — so this parent-level path kept
 * the defect. Only a genuine NotFound may resolve to `null`.
 */
async function openOptionalDirectory(
  resolve: () => Promise<DirectoryHandleLike>
): Promise<DirectoryHandleLike | null> {
  try {
    return await resolve();
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return null;
  }
}

async function readCompatibilityLog(
  directory: DirectoryHandleLike | null,
  corruptMessage: string
): Promise<DistributionLog | null> {
  if (!directory) return null;
  const result = await safeReadJson<DistributionLog>(directory, LOG_FILE);
  if (result.ok) return result.value;
  if (result.reason === "corrupt") throw new Error(corruptMessage);
  return null;
}

type CheckpointScanMeta = {
  /** Byte size of every segment file seen in this scan (name -> current size). */
  segmentOffsets: Record<string, number>;
  /** Every legacy one-file-per-event *.json name seen in this scan. */
  legacyEventFileNames: string[];
};

/**
 * Tie-order between the two immutable event layouts: NDJSON segments first,
 * legacy one-file-per-event `{eventId}.json` second.
 *
 * `sortDistributionEventsForFold` is a stable sort by `eventAt` alone, so for a
 * batch that shares ONE `eventAt` (which every bulk distribution does — see
 * that function's doc) the fold order is exactly the order this concatenation
 * produces. Two things follow.
 *
 * PURE LAYOUTS ARE UNCHANGED, BY CONSTRUCTION. A workspace whose events all
 * live in segments passes an empty legacy array, and one whose events all live
 * in per-event files passes an empty segment array; in both cases the
 * concatenation is the identity on the non-empty side, whichever side that is.
 * The deterministic-by-contract fold output for a pure layout is therefore
 * byte-identical to what the previous `[...legacy, ...segments]` order gave —
 * this only ever reorders a tie group that draws from BOTH layouts.
 *
 * MIXED LAYOUTS NOW FOLD IN BATCH ORDER. A mixed tie group is reachable in
 * exactly one way in practice: `appendDistributionEventsDurably` writes chunks
 * 1..k of a batch as segment appends, then a chunk fails and every remaining
 * chunk degrades to per-event files (`segmentPathUnusable` latches for the rest
 * of the save). The segment chunks are the EARLIER half of the batch, so
 * putting segments first restores the batch's chunk order. The old order put
 * the later, fallback half in front of it.
 *
 * RESIDUAL LIMITATION, deliberately not fixed here: within the fallback half,
 * per-event files carry no sequence — they are discovered in file-NAME order,
 * i.e. by random event UUID — so that half is still internally scrambled
 * relative to how it was written. Fixing that needs an ordering key inside the
 * event envelope (a batch sequence number), which is an on-disk contract change
 * and is out of scope for this repair. The pure-legacy layout has always had
 * this property; nothing here makes it worse.
 *
 * A genuinely historical mix (an old client's per-event files alongside a new
 * client's segments) is unaffected in practice: those events differ in
 * `eventAt`, so the primary comparison orders them and this tie-break never
 * runs. Where it did run there is no causal truth to preserve anyway — two
 * machines cannot be ordered by a timestamp they share.
 */
function orderImmutableSources(
  segmentEvents: DistributionEvent[],
  legacyPerEventFiles: DistributionEvent[]
): DistributionEvent[] {
  return [...segmentEvents, ...legacyPerEventFiles];
}

async function readCurrentDistributionSource(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<Pick<DistributionLogSources, "currentLog" | "immutableEvents"> & CheckpointScanMeta> {
  const directory = await openOptionalDirectory(() =>
    getDistributionDir(directoryHandle, monthFolderName, false)
  );
  const currentLog = await readCompatibilityLog(
    directory,
    `Corrupt distribution compatibility log: ${LOG_FILE}`
  );
  // Existing immutable event directories are strict: corrupt/unreadable files
  // propagate so no caller can derive a silently incomplete snapshot.
  if (!directory) {
    return { currentLog, immutableEvents: [], segmentOffsets: {}, legacyEventFileNames: [] };
  }
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await directory.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch (error) {
    // ONLY a genuine absence means "this month has no immutable events". The
    // catch that used to sit around the reads below swallowed every other
    // failure too, so one unreadable legacy event file — or one transient
    // NotReadableError — made loadDistributionLog report ZERO events for a
    // month with a full assignment history. The re-draw hard block reads that
    // as "nothing distributed yet" and overwrites sample.master.json, orphaning
    // every assignment and answer in the month.
    if (!isNotFoundError(error)) throw error;
    return { currentLog, immutableEvents: [], segmentOffsets: {}, legacyEventFileNames: [] };
  }
  // Deliberately unguarded: `onUnreadable: "throw"` above is the whole point,
  // and a listing failure is equally inconclusive. Both propagate.
  const { values: legacyValues } = await readAppendOnlyDirectory<DistributionEvent>(eventsDir, {
    suffix: ".json",
    onUnreadable: "throw",
    unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
    scope: { root: directoryHandle, path: `${monthFolderName}/1-main/${DISTRIBUTION_EVENTS_DIR}` },
  });
  const legacyEventFileNames = (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  // Legacy one-file-per-event immutable files are still read and merged in —
  // never rewritten or deleted, since another machine on an older build may
  // still be writing them (see distributionEventStore.ts). New writes go to
  // per-writer-session NDJSON segments instead; a full cold read here is the
  // simplest correct thing for this "give me every event" API — callers that
  // care about avoiding a full re-read on every load use the fold-checkpoint
  // path in loadOrDeriveDistributionCurrent instead.
  const segmentDelta = await readDistributionEventSegmentDelta(directory, {});
  // Re-sort: the fold is order-sensitive, and a new event with an earlier
  // eventAt than a cached one must still land in the right place -- the
  // cache's own internal order is by-filename, not by-eventAt. Ties keep the
  // supplied (append-ordered segment lines, then name-sorted per-event files)
  // order — see sortDistributionEventsForFold for why that tie-break is
  // load-bearing, and see `orderImmutableSources` for why segments go first.
  const immutableEvents = sortDistributionEventsForFold(
    orderImmutableSources(segmentDelta.events, legacyValues)
  );
  return { currentLog, immutableEvents, segmentOffsets: segmentDelta.offsets, legacyEventFileNames };
}

async function readLegacyDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog | null> {
  const directory = await openOptionalDirectory(() =>
    getLegacyDistributionDir(directoryHandle, monthFolderName)
  );
  return readCompatibilityLog(
    directory,
    `Corrupt legacy distribution log: ${LOG_FILE}`
  );
}

function normalizeCompatibilityLog(log: DistributionLog | null): DistributionLog {
  if (log) return log;
  return { monthFolderName: "", revision: 0, events: [] };
}

function selectWriteToken(
  currentLog: DistributionLog,
  legacyLog: DistributionLog
): string | undefined {
  if (currentLog._writeToken) return currentLog._writeToken;
  return legacyLog._writeToken;
}

function mergeDistributionLogSources(
  monthFolderName: string,
  sources: DistributionLogSources
): DistributionLog {
  const currentLog = normalizeCompatibilityLog(sources.currentLog);
  const legacyLog = normalizeCompatibilityLog(sources.legacyLog);
  let compatibilityBase = legacyLog.events;
  let otherCompatibility = currentLog.events;
  if (currentLog.events.length > 0) {
    compatibilityBase = currentLog.events;
    otherCompatibility = legacyLog.events;
  }
  const compatibilityEvents = mergeDistributionEvents(compatibilityBase, otherCompatibility);
  const events = mergeDistributionEvents(compatibilityEvents, sources.immutableEvents);
  return {
    monthFolderName,
    revision: Math.max(currentLog.revision, legacyLog.revision),
    _writeToken: selectWriteToken(currentLog, legacyLog),
    eventSetId: distributionEventSetId(events),
    events,
  };
}

function preserveAppendedBatchOrder(
  existingEvents: DistributionEvent[],
  appendedEvents: DistributionEvent[],
  appendedIds: Set<string>,
  projectedIds: Set<string>
): DistributionEvent[] {
  if (appendedEvents.every((event) => projectedIds.has(event.eventId))) return existingEvents;
  return [
    ...existingEvents.filter((event) => !appendedIds.has(event.eventId)),
    ...appendedEvents,
  ];
}

/**
 * What the compatibility projection must still carry in its body (item 2.6).
 *
 * `distribution.log.json` is kept for its CAS stamp and as the mirror-staleness
 * authority, but its full `events` array was a second copy of data that is
 * already durable — and immutable — in `distribution.events/`. Every append
 * re-read and re-wrote all of it: ~800 KB on a 4,000-event month, growing
 * without bound, on a UNC/SMB share, once per append per client.
 *
 * So the body is dropped — but only for events this function can PROVE are
 * durable elsewhere. A workspace old enough to predate the immutable event
 * store can hold events that exist ONLY in this projection; blindly writing an
 * empty body there would destroy them, and nothing in this codebase migrates
 * data in place. Anything not present in the immutable id set is therefore
 * carried forward verbatim, forever. On a modern workspace that set is empty
 * and the body goes to `[]` on the first append.
 *
 * Conservative in the degenerate direction too: when the event-directory scan
 * fails, `immutableEventIds` comes back empty, and this keeps the whole body
 * rather than treating "I could not look" as "it is durable".
 */
function residualProjectionEvents(
  currentProjectionEvents: DistributionEvent[],
  immutableEventIds: ReadonlySet<string>
): DistributionEvent[] {
  return currentProjectionEvents.filter((event) => !immutableEventIds.has(event.eventId));
}

type DistributionLogStamp = { revision: number; writeToken: string | undefined };

/**
 * Cheap alternative to loadDistributionLog for callers that only need to
 * compare revision/writeToken (both live entirely in the compatibility log
 * files, never in the immutable event directory -- see
 * mergeDistributionLogSources). Skips the full event-directory scan.
 *
 * Exported (A9) so the sync tick (SyncTick.tsx) can use it as the cheap
 * `distribution` family change probe (§4.2 of the perf/sync spec) without
 * paying for a full event-directory scan every tick. Its load-bearing
 * property: `revision` is bumped only by appendDistributionEvents, never by
 * saveDistributionCurrent (a cache write) -- see the "readDistributionLogStamp
 * agrees ..." test below for the read/write split this depends on, and the
 * "revision only advances on an event append" test that guards it directly.
 */
export type DistributionStampDirs = {
  /** `2-samples/{month}/1-main`, or null when it does not exist. */
  currentDir: DirectoryHandleLike | null;
  /** The legacy `1-population/{month}` location, or null. */
  legacyDir: DirectoryHandleLike | null;
};

export async function readDistributionLogStamp(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  /**
   * Pre-resolved directories, for callers that have ALREADY opened them — the
   * sync probe opens both for its other families, and on a UNC/SMB share
   * re-resolving each one costs 3 and 2 `getDirectoryHandle` round trips
   * respectively, every tick, on every client. Omit to resolve normally.
   */
  resolved?: DistributionStampDirs
): Promise<DistributionLogStamp> {
  const currentDir =
    resolved !== undefined
      ? resolved.currentDir
      : await openOptionalDirectory(() => getDistributionDir(directoryHandle, monthFolderName, false));
  const legacyDir =
    resolved !== undefined
      ? resolved.legacyDir
      : await openOptionalDirectory(() => getLegacyDistributionDir(directoryHandle, monthFolderName));
  const currentLog = normalizeCompatibilityLog(
    await readCompatibilityLog(currentDir, `Corrupt distribution compatibility log: ${LOG_FILE}`)
  );
  const legacyLog = normalizeCompatibilityLog(
    await readCompatibilityLog(legacyDir, `Corrupt legacy distribution log: ${LOG_FILE}`)
  );
  return {
    revision: Math.max(currentLog.revision, legacyLog.revision),
    writeToken: selectWriteToken(currentLog, legacyLog),
  };
}

/**
 * Move `distribution.log.json`'s CAS stamp WITHOUT changing anything it records.
 *
 * The sync probe (`workspaceSync.probeMonth`) decides whether the `distribution`
 * family changed by comparing exactly the two fields `readDistributionLogStamp`
 * returns: `revision` and `_writeToken`. A RESTORE, however, deliberately leaves
 * this file alone — `distribution.log.json` is classified `restore-if-absent`
 * (see backupStorage's `restoreActionFor`), because writing a backup's older
 * revision over a newer live one would roll the revision backwards. So a restore
 * that merges real events back into `distribution.events/` moves durable data
 * while leaving the one stamp every other machine watches untouched, and those
 * machines keep serving pre-restore state until someone presses the manual
 * refresh button. This function is how the restore path moves that stamp.
 *
 * `revision` is deliberately NOT bumped: it is the mirror-staleness authority
 * (`sourceLogRevision`) and advances only on an event append. Only the
 * `_writeToken` is re-minted, which the probe compares just as strictly and
 * nothing else treats as ordering.
 *
 * Returns true when the stamp was moved, false when there is no projection file
 * to stamp (a month whose events live only in `distribution.events/`) or when
 * every CAS attempt lost. Never throws — a restore must not fail because a
 * change-detection stamp could not be refreshed; the bounded segment signature
 * in the sync probe covers the same restore independently.
 */
export async function refreshDistributionLogWriteToken(
  distributionDir: DirectoryHandleLike
): Promise<boolean> {
  const corruptMessage = `Corrupt distribution compatibility log: ${LOG_FILE}`;
  try {
    const outcome = await casLoop<{ touched: boolean }>(
      async (writeToken) => {
        const existing = await readCompatibilityLog(distributionDir, corruptMessage);
        // No projection file at all: nothing to stamp, and writing one here
        // would invent a revision-0 log for a month that never had one.
        if (!existing) return { done: true, result: { touched: false } };
        await safeWriteJson(distributionDir, LOG_FILE, { ...existing, _writeToken: writeToken });
        const readBack = await readCompatibilityLog(distributionDir, corruptMessage);
        if (
          !readBack ||
          readBack._writeToken !== writeToken ||
          readBack.revision !== existing.revision
        ) {
          // Someone appended (or clobbered) between our read and read-back.
          // Their write moved the stamp too, so the probe fires either way —
          // retry anyway so the file is left with a coherent token.
          return { done: false };
        }
        return { done: true, result: { touched: true } };
      },
      {
        maxRetries: 3,
        conflictError: "تعارض في الكتابة: تعذّر تحديث علامة سجل التوزيع بعد الاستعادة.",
      }
    );
    return "touched" in outcome && outcome.touched;
  } catch (error) {
    logError("distribution:refresh-log-write-token", error);
    return false;
  }
}

/** Envelope revision of `distribution.current.json` for report-to-revision linkage (B2). */
export async function loadDistributionCurrentRevision(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<number | null> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName, false);
    const rev = await readEnvelopeRevision(dir, CURRENT_FILE);
    if (rev !== null) return rev;
  } catch { /* fall through to legacy layout */ }
  try {
    const legacyDir = await getLegacyDistributionDir(directoryHandle, monthFolderName);
    return await readEnvelopeRevision(legacyDir, CURRENT_FILE);
  } catch {
    return null;
  }
}

type DistributionLogLoad = {
  log: DistributionLog;
  /**
   * The events the CURRENT-location `distribution.log.json` actually holds on
   * disk right now. Normally empty since v85 (see DistributionLog.events); a
   * legacy full-body projection still yields its full list here.
   */
  currentProjectionEvents: DistributionEvent[];
  /** Ids durable in `distribution.events/` (segments + legacy per-event files). */
  immutableEventIds: Set<string>;
} & CheckpointScanMeta;

/**
 * The one full read. Surfaces, alongside the merged log, both the raw scan
 * metadata a fresh fold-checkpoint needs (segment byte offsets, legacy file
 * names) and the provenance the append path needs to shrink the compatibility
 * projection safely — so neither costs a second directory scan on top of the
 * one this already does.
 */
async function loadDistributionLogDetailed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLogLoad> {
  const current = await readCurrentDistributionSource(directoryHandle, monthFolderName);
  const legacyLog = await readLegacyDistributionLog(directoryHandle, monthFolderName);
  const log = mergeDistributionLogSources(monthFolderName, { ...current, legacyLog });
  return {
    log,
    currentProjectionEvents: current.currentLog?.events ?? [],
    immutableEventIds: new Set(current.immutableEvents.map((event) => event.eventId)),
    segmentOffsets: current.segmentOffsets,
    legacyEventFileNames: current.legacyEventFileNames,
  };
}

export async function loadDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  return (await loadDistributionLogDetailed(directoryHandle, monthFolderName)).log;
}

export async function appendDistributionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  event: DistributionEvent
): Promise<{ ok: true; log: DistributionLog } | { ok: false; error: string }> {
  return appendDistributionEvents(directoryHandle, monthFolderName, [event]);
}

/**
 * Append events to the distribution log using a CAS retry loop.
 *
 * The returned `log` reflects exactly what THIS call durably wrote. This app
 * is backend-free (see CLAUDE.md) and provides no strict multi-device event
 * ordering guarantee: another machine's event file written in the narrow
 * window between this call's own pre-write read and its verify step won't be
 * reflected in the returned `log` — though it will be picked up on the next
 * fresh read, since `distribution.current.json` is a rebuildable cache, not
 * a source of truth.
 */
export async function appendDistributionEvents(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  events: DistributionEvent[],
  options?: AppendDistributionEventsOptions
): Promise<{ ok: true; log: DistributionLog } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  if (events.length === 0) {
    return { ok: true, log: await loadDistributionLog(directoryHandle, monthFolderName) };
  }
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId)) {
      return {
        ok: false,
        error: codedMessage("XQ-DIST-002", { eventId: event.eventId })
      };
    }
    ids.add(event.eventId);
  }

  // Each event is durable in its own file before the mutable compatibility
  // projection is updated. Distinct writers therefore do not share a target.
  const eventDir = await getDistributionDir(directoryHandle, monthFolderName);
  try {
    // "unverified" means the bytes are committed but the share could not show
    // them back yet. That must NOT abort: the projection below is what makes
    // the assignment visible to its assignee, and skipping it while the events
    // sit durably on disk is the worst of both worlds.
    await writeDistributionEventBatch(
      eventDir,
      events,
      `${workspaceScopeId(directoryHandle)}|${monthFolderName}`,
      options?.onProgress,
      { root: directoryHandle, monthFolderName }
    );
  } catch (error) {
    // The raw `.message` used to be returned here, which meant the identifying
    // code was logged and then thrown away: the string reaching the UI was
    // English, `userFacingErrorText` had no error object left to classify, and
    // the user was shown the catch-all XQ-IO-028 for a failure we had already
    // named. Resolve the code once and put it in BOTH places.
    //
    // `resolveErrorCode` first, so a specifically classified failure keeps its
    // own code — XQ-IO-017 revoked permission, XQ-IO-020 disk full, XQ-IO-027
    // a vanished path, XQ-DIST-006 a handle with no createWritable — and only a
    // genuinely unrecognized throw falls back to the generic XQ-DIST-003.
    const code = resolveErrorCode(error) ?? "XQ-DIST-003";
    logCodedError("distribution:append-events", code, error);
    return {
      // `codedMessage`, NOT `formatUserError`: the latter appends the raw
      // exception detail, which is untranslated Chromium wording, and putting
      // that on an Arabic screen is the exact bug replacement.notFound.test.ts
      // was written to prevent. The detail is already in the error log above —
      // the screen gets the Arabic sentence and the quotable code, nothing else.
      //
      // The Arabic also matters mechanically: `userFacingErrorText` passes an
      // Arabic string through verbatim, so this survives to the user instead of
      // being swapped for the generic message.
      ok: false,
      error: codedMessage(code)
    };
  }

  options?.onProgress?.({ phase: "projection", completed: events.length, total: events.length });
  const result = await casLoop<{ ok: true; log: DistributionLog } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getDistributionDir(directoryHandle, monthFolderName);
      const {
        log: existing,
        currentProjectionEvents,
        immutableEventIds,
      } = await loadDistributionLogDetailed(directoryHandle, monthFolderName);
      // Same set the separate readProjectedEventIds read used to fetch — now
      // taken from the load above instead of re-reading the same file.
      const projectedIds = new Set(currentProjectionEvents.map((event) => event.eventId));
      const nextRevision = (existing.revision ?? 0) + 1;
      // The loader already includes this immutable batch. Overlay the caller's
      // batch order, because two events built in the same millisecond cannot be
      // ordered by timestamp. This is the list RETURNED to the caller (see the
      // result below); it is no longer what gets written.
      const mergedEvents = preserveAppendedBatchOrder(existing.events, events, ids, projectedIds);
      const updated: DistributionLog = {
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        eventSetId: existing.eventSetId,
        events: residualProjectionEvents(currentProjectionEvents, immutableEventIds),
      };
      await safeWriteJson(dir, LOG_FILE, updated);
      const verify = await readDistributionLogStamp(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify.writeToken === writeToken) {
        return {
          done: true,
          // `updated` (written to disk above) intentionally keeps the PRE-append
          // eventSetId for on-disk consistency at write time, and since v85 no
          // longer carries the event body at all — but callers of THIS return
          // value reasonably expect `log` to be the complete, up-to-date log
          // (useDistributionActions.refreshDistribution derives the whole month
          // straight from it), so the full merged list is returned here rather
          // than mutating `updated` itself.
          result: {
            ok: true as const,
            log: { ...updated, events: mergedEvents, eventSetId: distributionEventSetId(mergedEvents) },
          },
          // Delayed re-read guards against a concurrent machine that read the
          // same base revision and clobbered our commit after this read-back.
          verify: async () => {
            options?.onProgress?.({ phase: "verification", completed: events.length, total: events.length });
            const recheck = await readDistributionLogStamp(directoryHandle, monthFolderName);
            return recheck.revision === nextRevision && recheck.writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ الأحداث بعد عدة محاولات." }
  );
  if (result.ok) {
    bumpWorkspaceEpoch(directoryHandle, monthFolderName);
    options?.onProgress?.({ phase: "complete", completed: events.length, total: events.length });
  }
  return result;
}

/**
 * Persist the derived cache — and, when the caller produced one, its
 * fold-checkpoint SIDECAR (v85).
 *
 * The checkpoint used to be a field of `current` and therefore of
 * `distribution.current.json`, which is the largest, most widely read file in
 * the month (every archive tile, every backup XLSX export, every employee-facing
 * load reads it whole). On a 4,000-event month the embedded checkpoint plus the
 * old concatenated `eventSetId` accounted for ~347 KB of it, none of which any
 * of those consumers wants. Splitting it out costs the resume path one extra
 * small file read and buys every other reader that ~347 KB back.
 *
 * ORDER MATTERS: cache first, sidecar second. If the sidecar write fails, the
 * cache stands on its own and the next load simply refolds. If the cache write
 * failed and this still wrote a sidecar, the sidecar would describe a cache
 * that is not on disk — which is exactly what `eventSetId` guards, and why the
 * write is skipped entirely when the cache write threw.
 */
export async function saveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  // Month lock gate — also covers syncSampleMirrors (only called from here).
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const dir = await getDistributionDir(directoryHandle, monthFolderName);
  const { foldCheckpoint, ...cacheWithoutCheckpoint } = current;
  await safeWriteJson(dir, CURRENT_FILE, cacheWithoutCheckpoint);
  if (foldCheckpoint) {
    await safeWriteJson(dir, DISTRIBUTION_CHECKPOINT_FILE, foldCheckpoint);
  }
  await syncSampleMirrors(directoryHandle, monthFolderName, current);
}

/**
 * Read the fold-checkpoint for `cached`, from the sidecar when present and from
 * a legacy inline `foldCheckpoint` otherwise (dual-read: workspaces written
 * before v85 still have it inside `distribution.current.json`, and nothing
 * migrates them).
 *
 * A sidecar is accepted ONLY when its `eventSetId` matches the cache's. The two
 * files can now legitimately disagree — an older client that still writes the
 * cache inline, a restore that removed one and not the other, a half-landed
 * pair of writes — and a checkpoint whose `segmentOffsets` are ahead of the
 * entries it is being folded onto silently swallows every event in between.
 * Rejecting costs one full refold; accepting loses data. A mismatch is recorded
 * rather than swallowed, since it is not expected on a healthy workspace.
 */
async function loadFoldCheckpoint(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  cached: DistributionCurrentData
): Promise<DistributionFoldCheckpoint | undefined> {
  let sidecar: DistributionFoldCheckpoint | null = null;
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<DistributionFoldCheckpoint>(dir, DISTRIBUTION_CHECKPOINT_FILE);
    if (result.ok) sidecar = result.value;
  } catch {
    // No distribution directory / no sidecar — fall through to the legacy field.
  }
  if (sidecar) {
    if (sidecar.eventSetId !== undefined && sidecar.eventSetId === cached.eventSetId) return sidecar;
    logError(
      "distribution:checkpoint-mismatch",
      new Error(
        `${monthFolderName}: ${DISTRIBUTION_CHECKPOINT_FILE} eventSetId ${sidecar.eventSetId ?? "<absent>"} does not match ${CURRENT_FILE} ${cached.eventSetId ?? "<absent>"} — refolding`
      )
    );
  }
  return cached.foldCheckpoint;
}

async function loadDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionCurrentData | null> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<DistributionCurrentData>(
      dir,
      CURRENT_FILE
    );
    if (result.ok) return result.value;
  } catch {
    // Fallback below.
  }

  try {
    const legacyDir = await getLegacyDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionCurrentData>(legacyDir, CURRENT_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

function hasQuotaForAssignedEmployees(
  current: DistributionCurrentData,
  log: DistributionLog
): boolean {
  const assignedEmployees = new Set(
    log.events
      .filter((event) => event.eventType === "assigned")
      .map((event) => event.assignedTo)
  );
  if (assignedEmployees.size === 0) return true;
  // v3 (P2): a quota row exists only for an employee who still OWNS live rows,
  // because sampleCount is live ownership now. Someone who reassigned every row
  // away — or whose rows were all replaced — legitimately has no quota row, and
  // demanding one would reject a perfectly good cache on every single load.
  const owners = new Set(
    current.entries.filter((entry) => entry.status !== "replaced").map((entry) => entry.assignedTo)
  );
  const expected = [...assignedEmployees].filter((username) => owners.has(username));
  if (expected.length === 0) return true;
  if (!current.quotas) return false;
  return expected.every((username) => current.quotas?.[username]);
}

/**
 * Read only what changed since `checkpoint` was recorded (perf: fold-
 * checkpoint) — the small compatibility-log file(s) in full (cheap
 * regardless of event count, since they're always ONE file read each), plus
 * only the NEW legacy per-event files (name-diff) and NEW segment tail bytes
 * (byte-offset diff, never lastModified — see readSegmentTails). Returns
 * `null` when the distribution directory doesn't exist yet at all.
 */
async function readNewEventsSinceCheckpoint(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  checkpoint: DistributionFoldCheckpoint
): Promise<{ newEvents: DistributionEvent[]; segmentOffsets: Record<string, number>; legacyEventFileNames: string[] } | null> {
  const directory = await openOptionalDirectory(() => getDistributionDir(directoryHandle, monthFolderName, false));
  if (!directory) return null;

  const legacyDir = await openOptionalDirectory(() => getLegacyDistributionDir(directoryHandle, monthFolderName));
  const currentCompatLog = normalizeCompatibilityLog(
    await readCompatibilityLog(directory, `Corrupt distribution compatibility log: ${LOG_FILE}`)
  );
  const legacyCompatLog = normalizeCompatibilityLog(
    await readCompatibilityLog(legacyDir, `Corrupt legacy distribution log: ${LOG_FILE}`)
  );
  const compatEvents =
    currentCompatLog.events.length > 0
      ? mergeDistributionEvents(currentCompatLog.events, legacyCompatLog.events)
      : mergeDistributionEvents(legacyCompatLog.events, currentCompatLog.events);

  const knownIds = new Set(checkpoint.knownEventIds);

  let legacyEventFileNames = checkpoint.legacyEventFileNames;
  let newLegacyImmutable: DistributionEvent[] = [];
  let eventsDir: DirectoryHandleLike | null = null;
  try {
    eventsDir = await directory.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  } catch (error) {
    // No events directory yet — nothing legacy to read. Anything other than a
    // genuine absence propagates: this delta feeds a checkpoint that ADVANCES,
    // so an event silently missed here is missed permanently.
    if (!isNotFoundError(error)) throw error;
  }
  if (eventsDir) {
    const listing = await listDirectoryEntries(eventsDir);
    legacyEventFileNames = listing
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    const knownNames = new Set(checkpoint.legacyEventFileNames);
    const newNames = legacyEventFileNames.filter((name) => !knownNames.has(name));
    if (newNames.length > 0) {
      const { values } = await readNamedJsonFiles<DistributionEvent>(eventsDir, newNames, {
        onUnreadable: "throw",
        unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
      });
      newLegacyImmutable = values;
    }
  }

  const segmentDelta = await readDistributionEventSegmentDelta(directory, checkpoint.segmentOffsets);

  // ONE filter, applied to EVERY source (F-2). `knownEventIds` is the set this
  // checkpoint has already folded into `cached`, and the fold is not idempotent
  // — re-absorbing an event double-counts it. Only the compatibility log used to
  // be filtered here; the other two sources relied on this call's own
  // `dedupedById` map, which dedupes a batch against ITSELF and cannot see
  // across the checkpoint boundary at all.
  //
  // Both of the other sources can genuinely re-present a known event. The
  // durable-append path retries a chunk against a re-resolved handle and then
  // degrades to per-event files, so one event can legitimately be written twice
  // — once into a segment, once as `{eventId}.json` — and a client that
  // checkpointed between the two writes then meets the second copy as brand-new
  // bytes past its offset / a brand-new file name. `findLateEvent` does not
  // catch it either: a duplicate has the same `eventAt` AND the same `eventId`
  // as the entry it produced, so `isEventEarlierThanEntry` reports "not late"
  // and the resume path folds it a second time.
  //
  // Filtering here is safe because a known id contributes nothing a re-read
  // could add: its content is immutable (`mergeDistributionEvents` throws on
  // conflicting content for a repeated id), so the copy being skipped is
  // byte-equal to the one already folded.
  const dedupedById = new Map<string, DistributionEvent>();
  // Segments before legacy per-event files, for the reason `orderImmutableSources`
  // documents; the compatibility log stays first, as it always has.
  for (const event of [...compatEvents, ...orderImmutableSources(segmentDelta.events, newLegacyImmutable)]) {
    if (knownIds.has(event.eventId)) continue;
    dedupedById.set(event.eventId, event);
  }
  const newEvents = sortDistributionEventsForFold([...dedupedById.values()]);

  return { newEvents, segmentOffsets: segmentDelta.offsets, legacyEventFileNames };
}

/**
 * Attempt the fast, incremental fold-checkpoint path (perf): read only what
 * changed since `checkpoint`, fold just those new events on top of `cached`,
 * and persist the extended checkpoint. Returns `null` when the checkpoint
 * can't be trusted (a late/out-of-order event was found) — the caller must
 * fall back to a full refold using the complete event list in that case;
 * never patch a checkpoint in place on a late event (see findLateEvent).
 */
async function tryResumeFromCheckpoint(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  cached: DistributionCurrentData,
  checkpoint: DistributionFoldCheckpoint,
  sampleRows: PreparedPopulationRow[],
  persistCache: boolean,
  awaitCachePersist: boolean
): Promise<DistributionCurrentData | null> {
  const delta = await readNewEventsSinceCheckpoint(directoryHandle, monthFolderName, checkpoint);
  if (!delta) return cached; // no distribution directory at all — cache stands as-is.
  if (delta.newEvents.length === 0) return cached; // nothing changed since the checkpoint.

  const incremental = deriveCurrentDistributionIncremental(
    cached,
    checkpoint.quotaFacts,
    delta.newEvents,
    sampleRows
  );
  if (incremental.requiresFullRefold) return null;
  // Absorbed an event whose row is not in OUR sampleRows — almost certainly a
  // stale snapshot rather than a real orphan. Fall back to the full path rather
  // than writing a checkpoint that has advanced past it: a checkpoint written
  // here is accepted forever after, so the event would never be re-read and the
  // assignment would vanish permanently and silently. See
  // DistributionIncrementalResult.absorbedAbsentRows.
  if (incremental.absorbedAbsentRows) return null;

  const knownEventIds = [...new Set([...checkpoint.knownEventIds, ...delta.newEvents.map((event) => event.eventId)])].sort();
  const stamp = await readDistributionLogStamp(directoryHandle, monthFolderName);
  const eventSetId = distributionEventSetIdFromIds(knownEventIds);

  const withRevision: DistributionCurrentData = {
    ...incremental.current,
    logRevision: stamp.revision,
    eventSetId,
    foldCheckpoint: {
      segmentOffsets: delta.segmentOffsets,
      legacyEventFileNames: delta.legacyEventFileNames,
      knownEventIds,
      quotaFacts: incremental.quotaFacts,
      deriveVersion: DERIVE_VERSION,
      // Binds this sidecar to the cache written in the same call — see
      // loadFoldCheckpoint for what a mismatch means and why it is refused.
      eventSetId,
    },
  };

  // NOT awaited (when persistCache is true — see loadOrDeriveDistributionCurrent's
  // opts parameter, A6a). An earlier revision of this code awaited the write,
  // on the assumption that it is "ONE small JSON file, never proportional to
  // event count". Benchmarking against a real 8,000-event month disproved
  // that at the time: `distribution.current.json` measured **18.8 MB**. That
  // figure predates B5 (see populationTypes.ts's EmployeeMirrorRowStub):
  // entries used to embed a full population row each; since B5 they embed
  // only a 17-field stub. 18.8 MB is therefore an upper bound from the
  // pre-B5 format, not a current measurement — awaiting was never
  // re-benchmarked after B5 landed, so the fire-and-forget write stays the
  // conservative choice below rather than being reverted on an unverified
  // assumption that the file is now small.
  //
  // Fire-and-forget is safe here because the cache and its checkpoint are a
  // pure optimization, never a correctness input: a stale or missing cache
  // only costs a fuller fold on the next read, and `tryResumeFromCheckpoint`
  // already validates revision/eventSetId/offsets before trusting anything.
  // The race this previously guarded against (a sibling call recomputing
  // against a not-yet-persisted cache) is wasteful, not incorrect.
  //
  // Failures are surfaced through the error ring buffer rather than swallowed.
  //
  // A6a: this call only fires when the caller opted into persisting (the
  // default). Read-only callers (loadOrDeriveDistributionCurrentForRead, and
  // any caller that explicitly passes { persistCache: false }) never reach
  // this line — see the persistCache guard around this call site.
  // Design B: `awaitCachePersist` is set ONLY by
  // `refreshDistributionCacheAfterWrite` (see its docblock). It does not change
  // *what* is written, only whether this function returns before or after the
  // write settles — so no caller that does not opt in becomes newly blocking.
  if (persistCache) {
    const write = saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
      logRejection("distribution:cache-write")
    );
    if (awaitCachePersist) await write;
  }
  return withRevision;
}

export type LoadOrDeriveDistributionCurrentOptions = {
  /**
   * Whether a successful derive may write `distribution.current.json` /
   * sample mirrors back to disk. Defaults to `true`. A6 (perf/sync spec):
   * `loadOrDeriveDistributionCurrentForRead` and other provably pure-read
   * call sites pass `false` so opening a month to *read* it stops generating
   * N peers' worth of byte-identical multi-MB writes (F3). Write flows that
   * need the cache/mirrors refreshed after a real mutation must call
   * `refreshDistributionCacheAfterWrite` explicitly instead of relying on
   * this function's own persist — see that helper's doc comment (A6b, F18).
   */
  persistCache?: boolean;
  /**
   * Whether this call must not resolve until the cache + per-employee sample
   * mirror writes have actually settled. Defaults to `false`, i.e. the
   * historical fire-and-forget behaviour, so no existing caller becomes newly
   * blocking. Only meaningful together with `persistCache: true`.
   *
   * Design B (step 1): `refreshDistributionCacheAfterWrite` opts in. The
   * mirror `{username}.samples.json` is about to become the PRIMARY read for
   * an employee's own queue, so "eventually correct" is not good enough for
   * the four write flows that refresh through that helper — a view that
   * re-reads immediately after a reopen / referral approval / replacement
   * would otherwise paint the pre-refresh mirror.
   *
   * Awaiting is safe here specifically because `saveDistributionCurrent` is a
   * leaf: it takes no lock this call already holds (its `safeWriteJson` /
   * `syncSampleMirrors` locks are per-file and per-mirror, and every caller of
   * `refreshDistributionCacheAfterWrite` has already finished its own
   * `appendDistributionEvents` casLoop before calling it), and it never
   * re-enters `loadOrDeriveDistributionCurrent`. The original fire-and-forget
   * rationale was cost, not re-entrancy — see the measured note at the call
   * sites — and cost is exactly what a write flow can afford to pay, unlike a
   * read.
   */
  awaitCachePersist?: boolean;
};

/** Same key shape the dedupeInFlight callers below use (workspaceScopeId |
 *  month | epoch — see loadOrDeriveDistributionCurrentForRead's key), plus
 *  the same `sampleRows.length` discriminator that key already appends.
 *  Required for the same reason it's required there (see the "final-review
 *  Fix 3" regression test in distributionStorage.test.ts): two concurrent
 *  callers for the same (root, month, epoch) can legitimately pass
 *  differently-shaped sampleRows (e.g. one caller's sample-master read
 *  transiently fell back to `[]`), and must never share a memoized result
 *  derived from the OTHER caller's rows. */
function deriveMemoKey(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): string {
  return `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|${sampleRows.length}`;
}

/**
 * Session-scoped derive memo (A6c). Bounds the accepted regression from A6a:
 * once readers stop persisting the cache, a month whose ON-DISK cache is
 * unusable (a DERIVE_VERSION bump, or a late-event full refold —
 * tryResumeFromCheckpoint returning null below) would otherwise pay a full,
 * expensive re-fold on EVERY component mount within a session, not just
 * once. This in-memory map makes that once per (workspace, month, epoch).
 *
 * Honest caveat (spec §7.2 item 10 / H1-adjacent): the memo is keyed on
 * `workspaceEpoch`, which only advances on a WRITE performed by *this tab*
 * (see inFlightReads.ts). A change committed by another machine/tab between
 * this memo being populated and read back is NOT reflected until something
 * bumps the epoch — normally the sync tick (SyncTick.tsx), which calls
 * `bumpWorkspaceEpoch` when its distribution-family probe detects a revision
 * change. Within one sync interval, a session can therefore read a
 * memoized-stale derivation on a month whose on-disk cache was never usable
 * to begin with. This mirrors the file's own long-standing comment that the
 * cache/checkpoint are "an optimization, never a correctness input" — the
 * memo inherits that same guarantee, not a stronger one. Capped at 2 entries
 * (current + previously viewed month) so a long session touching many
 * months doesn't grow this unboundedly.
 */
const DERIVE_MEMO_CAP = 2;
const deriveMemo: { key: string; value: DistributionCurrentData }[] = [];

function getDeriveMemo(key: string): DistributionCurrentData | undefined {
  return deriveMemo.find((entry) => entry.key === key)?.value;
}

function setDeriveMemo(key: string, value: DistributionCurrentData): void {
  const existingIndex = deriveMemo.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) deriveMemo.splice(existingIndex, 1);
  deriveMemo.push({ key, value });
  while (deriveMemo.length > DERIVE_MEMO_CAP) deriveMemo.shift();
}

export function __clearDeriveMemoForTests(): void {
  deriveMemo.length = 0;
}

/**
 * Load or derive the current distribution state.
 *
 * Entry gate (A6d / H3): when `sampleRows` is empty but events already exist
 * for this month (compat-log revision > 0), returns `null` immediately
 * instead of resuming or refolding. `sampleRows: []` most often means
 * `sample.master.json` failed to load or hasn't been drawn yet — folding
 * real events against it would silently drop every one of them (the bare
 * `continue` in foldDistributionEvents, before recordDroppedEvent — see
 * distributionDerivation.ts), and on the fold-checkpoint resume path that
 * loss gets baked permanently into an advancing checkpoint. Gating here,
 * before `tryResumeFromCheckpoint` can run at all, is what keeps that
 * absorption from ever reaching disk. `null` is the safe shape every caller
 * already tolerates (XrayReferrals.tsx, useApprovalData.ts,
 * adhocImportEmployeeView.ts all already fall back to it).
 *
 * Fast path (fold-checkpoint, perf): when the cached snapshot carries a
 * `foldCheckpoint` from this derive algorithm version, read only what
 * changed since it was recorded (small compat-log files in full, plus only
 * NEW legacy event files / NEW segment bytes — see
 * readNewEventsSinceCheckpoint) and fold just the delta on top of the cached
 * entries. This is what turns a fresh page load from O(every event ever
 * written) file reads into O(events written since the last checkpoint).
 *
 * That fast path is skipped (falls through to the full path below) when: no
 * usable checkpoint exists yet, the derive algorithm version changed, or an
 * out-of-order ("late") event is detected relative to the checkpoint — the
 * fold is not commutative, so a late event can only be handled correctly by
 * discarding the checkpoint and refolding from scratch (see findLateEvent).
 * When there was NO on-disk checkpoint to resume from at all, the
 * session-scoped derive memo (A6c, above) is checked before paying for a
 * full log read — see its own doc comment for the staleness this accepts. A
 * late event detected ON this call is, by construction, fresher information
 * than the memo could hold, so that specific fallthrough bypasses the memo
 * and always does a real full refold.
 *
 * Full path (unchanged in spirit from before this task):
 * - Merge the legacy compatibility log with every immutable event file and
 *   segment (full read).
 * - If the cache's `logRevision`/`eventSetId` already match, return it as-is.
 * - Otherwise re-derive from the full log, persist a fresh checkpoint
 *   alongside the new cache, and return the derived result.
 */
/**
 * Outcome of re-checking an absorbing fold against a FRESH `sample.master.json`.
 *
 * - `authoritative` — every absorbed image is either genuinely unknown to the
 *   master or is a row the caller deliberately left out (a replacement-retired
 *   row: `liveSampleRows` filters those, and reporting/export call sites pass
 *   the filtered set on purpose). Nothing to heal.
 * - `healed` — the master holds live rows the caller's set did not, so the row
 *   set the fold was handed was NOT authoritative. Carries the re-fold against
 *   caller-rows ∪ the recovered rows.
 * - `unverifiable` — the master could not be read (or is missing) so the
 *   absorption cannot be judged at all.
 */
type AbsentRowRecheck =
  | { outcome: "authoritative" }
  | {
      outcome: "healed";
      current: DistributionCurrentData;
      quotaFacts: QuotaFacts;
      stillAbsent: ReadonlySet<string>;
    }
  | { outcome: "unverifiable" };

/**
 * Re-read `sample.master.json` and, if it holds rows the caller's set was
 * missing, re-fold the SAME event log against caller-rows ∪ those rows.
 *
 * Why the union rather than the master's rows outright: two call sites
 * (`runPowerBiExport`, the executive report data builder) pass
 * `liveSampleRows(sample)` — the master minus replacement-retired rows — on
 * purpose. Folding the master whole there would resurrect retired rows and
 * change an export's output, which is forbidden. Adding back only the rows that
 * are (a) referenced by an absorbed event, (b) present in the master and (c)
 * NOT retired preserves every deliberate filter while recovering exactly what a
 * stale or partial read lost.
 */
async function recheckAbsentRowsAgainstMaster(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  log: DistributionLog,
  callerRows: PreparedPopulationRow[],
  absentImageIds: ReadonlySet<string>
): Promise<AbsentRowRecheck> {
  let master;
  try {
    // Deliberately NOT a deduped/memoized read: the whole point is to get the
    // file as it is on disk right now, not whatever this session last saw.
    master = await loadSampleMaster(directoryHandle, monthFolderName);
  } catch (error) {
    // loadSampleMaster throws when the file exists but could not be read — the
    // one case where "no rows" must never be inferred. Unverifiable.
    logError("distribution:absent-row-recheck", error);
    return { outcome: "unverifiable" };
  }
  if (!master) return { outcome: "unverifiable" };

  const retired = new Set(master.replacedRowIds ?? []);
  const recovered: PreparedPopulationRow[] = [];
  for (const row of master.rows) {
    if (!absentImageIds.has(row.xrayImageId)) continue;
    if (retired.has(row.xrayImageId)) continue;
    recovered.push(row);
  }
  if (recovered.length === 0) return { outcome: "authoritative" };

  const healed = deriveCurrentDistributionWithFacts(log, [...callerRows, ...recovered]);
  return {
    outcome: "healed",
    current: healed.current,
    quotaFacts: healed.quotaFacts,
    stillAbsent: healed.absentRowImageIds,
  };
}

export async function loadOrDeriveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[],
  opts?: LoadOrDeriveDistributionCurrentOptions
): Promise<DistributionCurrentData | null> {
  const persistCache = opts?.persistCache ?? true;
  const awaitCachePersist = opts?.awaitCachePersist ?? false;
  try {
    if (sampleRows.length === 0) {
      const stamp = await readDistributionLogStamp(directoryHandle, monthFolderName);
      if (stamp.revision > 0) {
        logError(
          "distribution:no-sample-rows",
          new Error(`${monthFolderName}: events exist but sample.master is empty/missing`)
        );
        return null;
      }
    }

    const cached = await loadDistributionCurrent(directoryHandle, monthFolderName);
    // The sidecar read is gated on the cache already being usable, so a month
    // with no/stale cache does not pay an extra round trip for a checkpoint it
    // could not resume from anyway.
    const checkpoint =
      cached && cached.deriveVersion === DERIVE_VERSION
        ? await loadFoldCheckpoint(directoryHandle, monthFolderName, cached)
        : undefined;
    const canResume =
      !!cached &&
      cached.deriveVersion === DERIVE_VERSION &&
      !!checkpoint &&
      checkpoint.deriveVersion === DERIVE_VERSION;
    const memoKey = deriveMemoKey(directoryHandle, monthFolderName, sampleRows);

    if (canResume) {
      const resumed = await tryResumeFromCheckpoint(
        directoryHandle, monthFolderName, cached, checkpoint!, sampleRows, persistCache, awaitCachePersist
      );
      if (resumed) {
        setDeriveMemo(memoKey, resumed);
        return resumed;
      }
      // null => a late event was found on THIS read, straight from disk --
      // strictly fresher information than anything the memo could hold, so
      // fall through to a full, safe refold WITHOUT consulting the memo
      // (see the branch below, which only checks it when there was no
      // checkpoint to resume from in the first place).
    } else {
      // A6c: no usable on-disk cache at all (fresh month, or a
      // DERIVE_VERSION bump). Before paying for a full log read, check
      // whether this exact (workspace, month, epoch, row-shape) was already
      // derived earlier in this session.
      const memoHit = getDeriveMemo(memoKey);
      if (memoHit) return memoHit;
    }

    const { log, segmentOffsets, legacyEventFileNames } = await loadDistributionLogDetailed(
      directoryHandle,
      monthFolderName
    );
    if (log.events.length === 0) {
      return null;
    }

    // Fast path: cache is valid only if it was produced by the current
    // derivation algorithm (deriveVersion) for this exact log revision.
    // Pre-DERIVE_VERSION caches (inflated totalAssigned / resurrected rows)
    // are treated as stale and re-derived below.
    if (
      cached &&
      cached.deriveVersion === DERIVE_VERSION &&
      cached.logRevision === log.revision &&
      cached.eventSetId === log.eventSetId &&
      hasQuotaForAssignedEmployees(cached, log)
    ) {
      setDeriveMemo(memoKey, cached);
      return cached;
    }

    // Slow path: re-derive and update cache. segmentOffsets/legacyEventFileNames
    // come from the SAME scan loadDistributionLogWithCheckpointMeta already did
    // above -- no second directory re-scan needed to seed the fresh checkpoint.
    const folded = deriveCurrentDistributionWithFacts(log, sampleRows);
    let derived = folded.current;
    let quotaFacts = folded.quotaFacts;
    // ── Absent-row persistence guard ─────────────────────────────────────────
    // The fold ABSORBS every event whose xrayImageId is not in `sampleRows`
    // (distributionDerivation.ts's `continue` on a missing row). That is the
    // right thing for a genuine orphan and a catastrophe for a row set that was
    // merely stale or partially read: the assignments those events carry are
    // simply not in the result, and the result is what gets written to
    // `distribution.current.json` + its fold-checkpoint sidecar. Once written,
    // every machine trusts the cache and the checkpoint is accepted forever —
    // so a one-off bad read of `sample.master.json` becomes the permanent,
    // silent deletion of assignments from an audit month.
    //
    // The empty-row case is already gated at the top of this function (A6d) and
    // the incremental path already refuses to advance its checkpoint
    // (`absorbedAbsentRows`); this closes the remaining hole, the FULL refold
    // against a partial row set.
    //
    // Order matters: heal first, refuse second. A fresh re-read of the master
    // recovers the common case outright; only when the absorption survives that
    // (or the master cannot be read at all) does the result become
    // display-only — served in memory, never written to the cache, the
    // checkpoint or the session memo.
    let mayPersist = true;
    if (folded.absentRowImageIds.size > 0) {
      const recheck = await recheckAbsentRowsAgainstMaster(
        directoryHandle, monthFolderName, log, sampleRows, folded.absentRowImageIds
      );
      if (recheck.outcome === "healed") {
        derived = recheck.current;
        quotaFacts = recheck.quotaFacts;
        mayPersist = recheck.stillAbsent.size === 0;
        logError(
          "distribution:absent-row-healed",
          new Error(
            `${monthFolderName}: refolded against a fresh sample.master.json after ${folded.absentRowImageIds.size} absorbed image id(s); ${recheck.stillAbsent.size} still absent${mayPersist ? "" : " — cache/checkpoint left untouched"}`
          )
        );
      } else if (recheck.outcome === "unverifiable") {
        mayPersist = false;
        logError(
          "distribution:absent-row-unverifiable",
          new Error(
            `${monthFolderName}: ${folded.absentRowImageIds.size} absorbed image id(s) could not be checked against sample.master.json — serving the fold in memory only`
          )
        );
      }
      // "authoritative": the master agrees the rows are gone (a true orphan, or
      // a retired row the caller filtered out on purpose). Nothing was lost by
      // this read, so the cache stays as trustworthy as it was before.
    }
    const knownEventIds = [...new Set(log.events.map((event) => event.eventId))].sort();
    const foldCheckpoint: DistributionFoldCheckpoint = {
      segmentOffsets,
      legacyEventFileNames,
      knownEventIds,
      quotaFacts,
      deriveVersion: DERIVE_VERSION,
      // Same set as `log.eventSetId` below (both are the digest of exactly
      // these ids) — stated explicitly so the sidecar carries its own binding.
      eventSetId: distributionEventSetIdFromIds(knownEventIds),
    };
    const withRevision: DistributionCurrentData = {
      ...derived,
      logRevision: log.revision,
      eventSetId: log.eventSetId,
      foldCheckpoint,
    };
    // Not memoized when the fold absorbed events it could not verify: the memo
    // is read back by every subsequent mount in this session, so caching a
    // known-incomplete fold spreads the same loss to every view for as long as
    // the workspace epoch holds.
    if (mayPersist) setDeriveMemo(memoKey, withRevision);

    // NOT awaited (when persistCache) — see the measured rationale on the
    // sibling save above. `distribution.current.json` measured ~18.8 MB for
    // an 8,000-event month under the PRE-B5 format, where entries embedded
    // full rows; since B5 entries embed only a 17-field
    // EmployeeMirrorRowStub, so that figure is an upper bound, not a current
    // measurement (see the sibling comment above tryResumeFromCheckpoint's
    // save for the full note). The cache and checkpoint remain an
    // optimization, never a correctness input.
    // `awaitCachePersist` (Design B, step 1): only the write-path helper opts
    // in — see LoadOrDeriveDistributionCurrentOptions. Same write either way.
    if (persistCache && mayPersist) {
      const write = saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
        logRejection("distribution:cache-write")
      );
      if (awaitCachePersist) await write;
    }

    return withRevision;
  } catch (error) {
    // Unexpected failure (corrupt log, permission loss, …) — expected
    // missing-file cases are handled quietly inside the loaders above.
    logError("distribution:load-or-derive", error);
    return null;
  }
}

/**
 * Write-path helper (A6b, F18). `saveDistributionCurrent` has exactly one
 * non-read caller in the whole tree (useDistributionActions.ts) — every other
 * write flow that appends distribution events (bulk assignment, referral
 * approval/replacement, ad-hoc import assignment, reopen) historically relied
 * on the NEXT reader's fire-and-forget cache write (tryResumeFromCheckpoint /
 * loadOrDeriveDistributionCurrent above) to refresh both the cache and every
 * employee's sample mirror (syncSampleMirrors is only reachable from
 * saveDistributionCurrent — see distributionStorage.ts's own import). Now
 * that reads default to not persisting for *pure* read call sites, any write
 * flow that does NOT call this explicitly after a successful event append
 * would freeze its own cache and mirrors indefinitely.
 *
 * Deliberately swallows its own failure (logged, never thrown): this is a
 * cache/mirror refresh, not a correctness input, and a closed month
 * legitimately rejects it today via `ensureMonthWritable` inside
 * `saveDistributionCurrent` (ensureMonthWritable → MonthClosedError) — that
 * is expected, not a bug this helper needs to work around.
 *
 * SYNCHRONOUS BY CONTRACT (Design B, step 1). This helper awaits the cache +
 * mirror write (`awaitCachePersist`), so when it resolves every
 * `{username}.samples.json` for this month has been rewritten — or the failure
 * has been logged. Previously the inner `saveDistributionCurrent` was
 * fire-and-forget on both the checkpoint-resume and full-refold paths, making
 * the guarantee through reopen / referral approval / replacement *eventual*:
 * a view re-reading immediately after one of those flows could paint the
 * pre-refresh mirror. That is not tolerable now that the mirror is the
 * employee's primary read. Only this helper opts in; every read path keeps the
 * old non-blocking behaviour.
 *
 * One residual gap, deliberately not closed here: if a concurrent writer has
 * ALREADY persisted a cache carrying this exact log revision, the inner derive
 * returns that cached snapshot without re-writing, so this helper can resolve
 * while the other writer's own (fire-and-forget) mirror write is still in
 * flight. Cross-machine write/write ordering needs a backend, which this app
 * does not have.
 */
export async function refreshDistributionCacheAfterWrite(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<void> {
  try {
    await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows, {
      persistCache: true,
      awaitCachePersist: true,
    });
  } catch (error) {
    logError("distribution:refresh-after-write", error);
  }
}

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
 *  check. All callers should pass sampleRows sourced from the same
 *  sample.master.json for a given month -- the dedupe key below only
 *  cheaply discriminates by row count, not full content identity.
 *
 *  A6a: always passes `{ persistCache: false }` — a read must never write
 *  `distribution.current.json` / sample mirrors back to disk (F3). Write
 *  flows must call `refreshDistributionCacheAfterWrite` explicitly instead
 *  (A6b). */
export function loadOrDeriveDistributionCurrentForRead(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<DistributionCurrentData | null> {
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|dist-current|${sampleRows.length}`;
  return dedupeInFlight(key, () =>
    loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows, { persistCache: false })
  );
}
