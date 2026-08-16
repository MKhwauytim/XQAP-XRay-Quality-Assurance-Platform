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
  DistributionLog
} from "./distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError, logRejection } from "../storage/errorLogger";
import { casLoop } from "../storage/casLoop";
import { codedMessage, logCodedError } from "../storage/errorCodes";
import { listDirectoryEntries, readAppendOnlyDirectory, readNamedJsonFiles } from "../storage/directoryScan";
import { ensureMonthWritable } from "../population/monthLock";
import { syncSampleMirrors } from "../samples/sampleMirrorStorage";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import {
  DISTRIBUTION_EVENTS_DIR,
  appendDistributionEventSegment,
  distributionEventSetId,
  getDistributionDeviceId,
  getDistributionSessionId,
  distributionEventSetIdFromIds,
  mergeDistributionEvents,
  readDistributionEventSegmentDelta,
  sortDistributionEventsForFold,
} from "./distributionEventStore";
import { dedupeInFlight, workspaceScopeId, bumpWorkspaceEpoch, workspaceEpoch } from "../storage/inFlightReads";

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
  onProgress?: AppendDistributionEventsOptions["onProgress"]
): Promise<void> {
  onProgress?.({ phase: "events", completed: 0, total: events.length });
  // `scopeId` gives the "have I already written this segment" memo stable
  // workspace+month identity — without it a workspace switch mid-session leaves
  // a stale name-keyed hit that costs the whole retry ladder on the next append.
  await appendDistributionEventSegment(directory, events, {
    deviceId: getDistributionDeviceId(),
    sessionId: getDistributionSessionId(),
    scopeId,
  });
  onProgress?.({ phase: "events", completed: events.length, total: events.length });
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

async function openOptionalDirectory(
  resolve: () => Promise<DirectoryHandleLike>
): Promise<DirectoryHandleLike | null> {
  try {
    return await resolve();
  } catch {
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
  let legacyValues: DistributionEvent[];
  let legacyEventFileNames: string[];
  try {
    eventsDir = await directory.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
    const { values } = await readAppendOnlyDirectory<DistributionEvent>(eventsDir, {
      suffix: ".json",
      onUnreadable: "throw",
      unreadableError: (name) => `Cannot read immutable distribution event: ${name}`,
      scope: { root: directoryHandle, path: `${monthFolderName}/1-main/${DISTRIBUTION_EVENTS_DIR}` },
    });
    legacyValues = values;
    legacyEventFileNames = (await listDirectoryEntries(eventsDir))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return { currentLog, immutableEvents: [], segmentOffsets: {}, legacyEventFileNames: [] };
  }
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
  // supplied (name-sorted files, append-ordered lines) order — see
  // sortDistributionEventsForFold for why that tie-break is load-bearing.
  const immutableEvents = sortDistributionEventsForFold([...legacyValues, ...segmentDelta.events]);
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
    await writeDistributionEventBatch(
      eventDir,
      events,
      `${workspaceScopeId(directoryHandle)}|${monthFolderName}`,
      options?.onProgress
    );
  } catch (error) {
    logCodedError("distribution:append-events", "XQ-DIST-003", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
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
  const newCompatEvents = compatEvents.filter((event) => !knownIds.has(event.eventId));

  let legacyEventFileNames = checkpoint.legacyEventFileNames;
  let newLegacyImmutable: DistributionEvent[] = [];
  try {
    const eventsDir = await directory.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
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
  } catch {
    // No events directory yet — nothing legacy to read.
  }

  const segmentDelta = await readDistributionEventSegmentDelta(directory, checkpoint.segmentOffsets);

  const dedupedById = new Map<string, DistributionEvent>();
  for (const event of [...newCompatEvents, ...newLegacyImmutable, ...segmentDelta.events]) {
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
    const { current: derived, quotaFacts } = deriveCurrentDistributionWithFacts(log, sampleRows);
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
    setDeriveMemo(memoKey, withRevision);

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
    if (persistCache) {
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
