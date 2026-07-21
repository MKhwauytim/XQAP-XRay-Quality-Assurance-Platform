import type { PreparedPopulationRow } from "../population/populationTypes";
import { DERIVE_VERSION, deriveCurrentDistribution } from "./distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "./distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readEnvelopeRevision, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError, logRejection } from "../storage/errorLogger";
import { casLoop } from "../storage/casLoop";
import { ensureMonthWritable } from "../population/monthLock";
import { syncSampleMirrors } from "../samples/sampleMirrorStorage";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import {
  distributionEventSetId,
  loadImmutableDistributionEvents,
  mergeDistributionEvents,
  writeImmutableDistributionEvent,
} from "./distributionEventStore";

const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";
const IMMUTABLE_EVENT_WRITE_CONCURRENCY = 4;

export type DistributionWriteProgress =
  | { phase: "events"; completed: number; total: number }
  | { phase: "projection" | "verification" | "complete"; completed: number; total: number };

type AppendDistributionEventsOptions = {
  onProgress?: (progress: DistributionWriteProgress) => void;
};

async function writeImmutableEventBatch(
  directory: DirectoryHandleLike,
  events: DistributionEvent[],
  onProgress?: AppendDistributionEventsOptions["onProgress"]
): Promise<void> {
  let nextIndex = 0;
  let completed = 0;
  onProgress?.({ phase: "events", completed, total: events.length });

  async function worker(): Promise<void> {
    while (nextIndex < events.length) {
      const event = events[nextIndex];
      nextIndex += 1;
      if (!event) return;
      await writeImmutableDistributionEvent(directory, event);
      completed += 1;
      onProgress?.({ phase: "events", completed, total: events.length });
    }
  }

  const workerCount = Math.min(IMMUTABLE_EVENT_WRITE_CONCURRENCY, events.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
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
  const immutableEvents = directory
    ? await loadImmutableDistributionEvents(directory)
    : [];
  return { currentLog, immutableEvents };
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

export async function appendDistributionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  event: DistributionEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDistributionEvents(directoryHandle, monthFolderName, [event]);
}

/** Append events to the distribution log using a CAS retry loop. */
export async function appendDistributionEvents(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  events: DistributionEvent[],
  options?: AppendDistributionEventsOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
  if (events.length === 0) return { ok: true };
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
    // These files are independent, so a small bounded pool reduces large-batch
    // save time without creating an unbounded burst against the workspace disk.
    await writeImmutableEventBatch(eventDir, events, options?.onProgress);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  options?.onProgress?.({ phase: "projection", completed: events.length, total: events.length });
  const result = await casLoop<{ ok: true } | { ok: false; error: string }>(
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
      const verify = await loadDistributionLog(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        return {
          done: true,
          result: { ok: true as const },
          // Delayed re-read guards against a concurrent machine that read the
          // same base revision and clobbered our commit after this read-back.
          verify: async () => {
            options?.onProgress?.({ phase: "verification", completed: events.length, total: events.length });
            const recheck = await loadDistributionLog(directoryHandle, monthFolderName);
            return recheck.revision === nextRevision && recheck._writeToken === writeToken;
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ الأحداث بعد عدة محاولات." }
  );
  if (result.ok) {
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
 * Load or derive the current distribution state.
 *
 * Strategy:
 * - Merge the legacy compatibility log with immutable event files (source of
 *   truth for events written by current clients).
 * - Load the cached current snapshot.
 * - If the cache's `logRevision` matches the log's `revision`, the cache is
 *   fresh and is returned as-is (fast path).
 * - If stale or absent, re-derive from the log, persist the new cache, and
 *   return the derived result.
 *
 * `eventSetId` invalidates a cache when a concurrent immutable file appears
 * without a matching compatibility-log revision. This prevents silent event
 * omission; it does not claim a distributed ordering/transaction guarantee.
 */
export async function loadOrDeriveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  sampleRows: PreparedPopulationRow[]
): Promise<DistributionCurrentData | null> {
  try {
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
    if (log.events.length === 0) {
      return null;
    }

    const cached = await loadDistributionCurrent(directoryHandle, monthFolderName);

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

    // Slow path: re-derive and update cache
    const derived = deriveCurrentDistribution(log, sampleRows);
    const withRevision: DistributionCurrentData = {
      ...derived,
      logRevision: log.revision,
      eventSetId: log.eventSetId
    };

    // Best-effort cache write — don't block on errors, but log for observability.
    void saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
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
