import type { PreparedPopulationRow } from "../population/populationTypes";
import { deriveCurrentDistribution } from "./distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "./distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";

const POPULATION_FOLDER = "Population";
const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";

async function getDistributionDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const population = await directoryHandle.getDirectoryHandle(
    POPULATION_FOLDER,
    { create: true }
  );
  return population.getDirectoryHandle(monthFolderName, { create: true });
}

export async function loadDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionLog>(dir, LOG_FILE);
    if (result.ok) {
      // Backfill revision for legacy files that didn't have it
      return {
        ...result.value,
        revision: result.value.revision ?? 0
      };
    }
    return { monthFolderName, revision: 0, events: [] };
  } catch {
    return { monthFolderName, revision: 0, events: [] };
  }
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
  events: DistributionEvent[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  return casLoop<{ ok: true } | { ok: false; error: string }>(
    async (writeToken) => {
      const dir = await getDistributionDir(directoryHandle, monthFolderName);
      const existing = await loadDistributionLog(directoryHandle, monthFolderName);
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: DistributionLog = {
        monthFolderName,
        revision: nextRevision,
        _writeToken: writeToken,
        events: [...existing.events, ...events],
      };
      await safeWriteJson(dir, LOG_FILE, updated);
      const verify = await loadDistributionLog(directoryHandle, monthFolderName);
      if (verify.revision === nextRevision && verify._writeToken === writeToken) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ الأحداث بعد عدة محاولات." }
  );
}

export async function saveDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  current: DistributionCurrentData
): Promise<void> {
  const dir = await getDistributionDir(directoryHandle, monthFolderName);
  await safeWriteJson(dir, CURRENT_FILE, current);
}

export async function loadDistributionCurrent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionCurrentData | null> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionCurrentData>(
      dir,
      CURRENT_FILE
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * Load or derive the current distribution state.
 *
 * Strategy:
 * - Load the distribution log (source of truth).
 * - Load the cached current snapshot.
 * - If the cache's `logRevision` matches the log's `revision`, the cache is
 *   fresh and is returned as-is (fast path).
 * - If stale or absent, re-derive from the log, persist the new cache, and
 *   return the derived result.
 *
 * This ensures every reader always sees a consistent view, even if two
 * machines wrote to the log concurrently.
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

    // Fast path: cache is still valid for this log revision
    if (cached && cached.logRevision === log.revision) {
      return cached;
    }

    // Slow path: re-derive and update cache
    const derived = deriveCurrentDistribution(log, sampleRows);
    const withRevision: DistributionCurrentData = {
      ...derived,
      logRevision: log.revision
    };

    // Best-effort cache write — don't block on errors
    void saveDistributionCurrent(directoryHandle, monthFolderName, withRevision).catch(
      () => undefined
    );

    return withRevision;
  } catch {
    return null;
  }
}
