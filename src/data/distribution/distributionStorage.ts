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
  onProgress?: AppendDistributionEventsOptions["onProgress"]
): Promise<void> {
  onProgress?.({ phase: "events", completed: 0, total: events.length });
  await appendDistributionEventSegment(directory, events);
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
 */
async function readDistributionLogStamp(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLogStamp> {
  const currentDir = await openOptionalDirectory(() =>
    getDistributionDir(directoryHandle, monthFolderName, false)
  );
  const legacyDir = await openOptionalDirectory(() =>
    getLegacyDistributionDir(directoryHandle, monthFolderName)
  );
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
    await writeDistributionEventBatch(eventDir, events, options?.onProgress);
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
  sampleRows: PreparedPopulationRow[]
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

  // Awaited (not fire-and-forget): this write is ONE small JSON file — never
  // proportional to event count, so it's never the O(events) bottleneck this
  // task targets — and awaiting it removes a real race where a second,
  // near-simultaneous loadOrDeriveDistributionCurrent call could read a
  // not-yet-persisted cache and redundantly recompute (still correct, but
  // wastefully, and with a fresh derivedAt that no longer matches the
  // in-flight sibling call's result). A write failure still must not prevent
  // returning the freshly-derived in-memory result to the caller.
  await saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
    logRejection("distribution:cache-write")
  );
  return withRevision;
}

/**
 * Load or derive the current distribution state.
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
  sampleRows: PreparedPopulationRow[]
): Promise<DistributionCurrentData | null> {
  try {
    const cached = await loadDistributionCurrent(directoryHandle, monthFolderName);
    const checkpoint = cached?.foldCheckpoint;
    const canResume =
      !!cached &&
      cached.deriveVersion === DERIVE_VERSION &&
      !!checkpoint &&
      checkpoint.deriveVersion === DERIVE_VERSION;

    if (canResume) {
      const resumed = await tryResumeFromCheckpoint(directoryHandle, monthFolderName, cached, checkpoint!, sampleRows);
      if (resumed) return resumed;
      // null => a late event was found; fall through to a full, safe refold.
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

    // Awaited (not fire-and-forget) — see the identical rationale on
    // tryResumeFromCheckpoint's save above: this is one small JSON file, not
    // proportional to event count, and awaiting it avoids a near-simultaneous
    // caller reading a not-yet-persisted cache and needlessly recomputing.
    await saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
      logRejection("distribution:cache-write")
    );

    return withRevision;
  } catch (error) {
    // Unexpected failure (corrupt log, permission loss, …) — expected
    // missing-file cases are handled quietly inside the loaders above.
    logError("distribution:load-or-derive", error);
    return null;
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
 *  cheaply discriminates by row count, not full content identity. */
export function loadOrDeriveDistributionCurrentForRead(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<DistributionCurrentData | null> {
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|dist-current|${sampleRows.length}`;
  return dedupeInFlight(key, () => loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sampleRows));
}
