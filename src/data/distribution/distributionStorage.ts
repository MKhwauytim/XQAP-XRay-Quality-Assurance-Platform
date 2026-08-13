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
} from "./distributionEventStore";
import { dedupeInFlight, workspaceScopeId, bumpWorkspaceEpoch, workspaceEpoch } from "../storage/inFlightReads";

const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";

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
  // cache's own internal order is by-filename, not by-eventAt.
  const immutableEvents = [...legacyValues, ...segmentDelta.events].sort(
    (a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId)
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

async function readProjectedEventIds(directory: DirectoryHandleLike): Promise<Set<string>> {
  const projected = await readCompatibilityLog(
    directory,
    `Corrupt distribution compatibility log: ${LOG_FILE}`
  );
  return new Set(projected?.events.map((event) => event.eventId) ?? []);
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

export async function loadDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  const current = await readCurrentDistributionSource(directoryHandle, monthFolderName);
  const legacyLog = await readLegacyDistributionLog(directoryHandle, monthFolderName);
  return mergeDistributionLogSources(monthFolderName, { ...current, legacyLog });
}

/**
 * Sibling of loadDistributionLog that also surfaces the raw scan metadata
 * (segment byte offsets, legacy file names) needed to build a fresh
 * fold-checkpoint (perf) — used only by loadOrDeriveDistributionCurrent's
 * cold/full-refold path, so building that checkpoint doesn't require a
 * SECOND, redundant directory scan on top of the one this function already
 * does.
 */
async function loadDistributionLogWithCheckpointMeta(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<{ log: DistributionLog } & CheckpointScanMeta> {
  const current = await readCurrentDistributionSource(directoryHandle, monthFolderName);
  const legacyLog = await readLegacyDistributionLog(directoryHandle, monthFolderName);
  const log = mergeDistributionLogSources(monthFolderName, { ...current, legacyLog });
  return { log, segmentOffsets: current.segmentOffsets, legacyEventFileNames: current.legacyEventFileNames };
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
      return { ok: false, error: `معرّف حدث مكرر: ${event.eventId}` };
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
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  options?.onProgress?.({ phase: "projection", completed: events.length, total: events.length });
  const result = await casLoop<{ ok: true; log: DistributionLog } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getDistributionDir(directoryHandle, monthFolderName);
      const projectedIds = await readProjectedEventIds(dir);
      const existing = await loadDistributionLog(directoryHandle, monthFolderName);
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: DistributionLog = {
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        eventSetId: existing.eventSetId,
        // The loader already includes this immutable batch. Overlay the caller's
        // batch order before writing the compatibility projection, because two
        // events built in the same millisecond cannot be ordered by timestamp.
        events: preserveAppendedBatchOrder(existing.events, events, ids, projectedIds),
      };
      await safeWriteJson(dir, LOG_FILE, updated);
      const verify = await readDistributionLogStamp(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify.writeToken === writeToken) {
        return {
          done: true,
          // `updated` (written to disk above) intentionally keeps the PRE-append
          // eventSetId for on-disk consistency at write time (see the field's
          // write site above) — but callers of THIS return value reasonably
          // expect `log` to reflect the just-appended events, so return a
          // corrected copy here rather than mutating `updated` itself.
          result: { ok: true as const, log: { ...updated, eventSetId: distributionEventSetId(updated.events) } },
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

export async function saveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  // Month lock gate — also covers syncSampleMirrors (only called from here).
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const dir = await getDistributionDir(directoryHandle, monthFolderName);
  await safeWriteJson(dir, CURRENT_FILE, current);
  await syncSampleMirrors(directoryHandle, monthFolderName, current);
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
  if (!current.quotas) return false;
  return [...assignedEmployees].every((username) => current.quotas?.[username]);
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
  const newEvents = [...dedupedById.values()].sort(
    (a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId)
  );

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
  persistCache: boolean
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

  const withRevision: DistributionCurrentData = {
    ...incremental.current,
    logRevision: stamp.revision,
    eventSetId: distributionEventSetIdFromIds(knownEventIds),
    foldCheckpoint: {
      segmentOffsets: delta.segmentOffsets,
      legacyEventFileNames: delta.legacyEventFileNames,
      knownEventIds,
      quotaFacts: incremental.quotaFacts,
      deriveVersion: DERIVE_VERSION,
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
  if (persistCache) {
    void saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
      logRejection("distribution:cache-write")
    );
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
    const checkpoint = cached?.foldCheckpoint;
    const canResume =
      !!cached &&
      cached.deriveVersion === DERIVE_VERSION &&
      !!checkpoint &&
      checkpoint.deriveVersion === DERIVE_VERSION;
    const memoKey = deriveMemoKey(directoryHandle, monthFolderName, sampleRows);

    if (canResume) {
      const resumed = await tryResumeFromCheckpoint(
        directoryHandle, monthFolderName, cached, checkpoint!, sampleRows, persistCache
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

    const { log, segmentOffsets, legacyEventFileNames } = await loadDistributionLogWithCheckpointMeta(
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
    if (persistCache) {
      void saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
        logRejection("distribution:cache-write")
      );
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
 */
export async function refreshDistributionCacheAfterWrite(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<void> {
  try {
    await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows, { persistCache: true });
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
