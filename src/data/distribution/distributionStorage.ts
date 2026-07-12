import type { PreparedPopulationRow } from "../population/populationTypes";
import { DERIVE_VERSION, deriveCurrentDistribution } from "./distributionLog";
import type {
  DistributionCurrentData,
  DistributionEvent,
  DistributionLog
} from "./distributionTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError, logRejection } from "../storage/errorLogger";
import { casLoop } from "../storage/casLoop";
import { ensureMonthWritable } from "../population/monthLock";
import { syncSampleMirrors } from "../samples/sampleMirrorStorage";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";

const LOG_FILE = "distribution.log.json";
const CURRENT_FILE = "distribution.current.json";

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

export async function loadDistributionLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DistributionLog> {
  try {
    const dir = await getDistributionDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<DistributionLog>(dir, LOG_FILE);
    if (result.ok) {
      // Backfill revision for legacy files that didn't have it
      return {
        ...result.value,
        revision: result.value.revision ?? 0
      };
    }
  } catch {
    // Fallback for workspaces created before the numbered samples layout.
  }

  try {
    const legacyDir = await getLegacyDistributionDir(directoryHandle, monthFolderName);
    const result = await safeReadJson<DistributionLog>(legacyDir, LOG_FILE);
    if (result.ok) {
      return { ...result.value, revision: result.value.revision ?? 0 };
    }
  } catch {
    // Missing legacy file is normal for new workspaces.
  }

  return { monthFolderName, revision: 0, events: [] };
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
  // Month lock gate — before the CAS loop so a closed month rejects loudly.
  await ensureMonthWritable(directoryHandle, monthFolderName);
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

    // Fast path: cache is valid only if it was produced by the current
    // derivation algorithm (deriveVersion) for this exact log revision.
    // Pre-DERIVE_VERSION caches (inflated totalAssigned / resurrected rows)
    // are treated as stale and re-derived below.
    if (
      cached &&
      cached.deriveVersion === DERIVE_VERSION &&
      cached.logRevision === log.revision &&
      hasQuotaForAssignedEmployees(cached, log)
    ) {
      return cached;
    }

    // Slow path: re-derive and update cache
    const derived = deriveCurrentDistribution(log, sampleRows);
    const withRevision: DistributionCurrentData = {
      ...derived,
      logRevision: log.revision
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
