/**
 * Month close-out / lock (Tier-1 Item A).
 *
 * A closed month is frozen history: every month-scoped write path calls
 * `ensureMonthWritable` and throws `MonthClosedError` when the month's
 * manifest carries `status: "closed"`.
 *
 * Deliberate design decisions:
 * - FAIL-OPEN on a missing or unreadable manifest: a broken manifest must not
 *   brick all writes. The close state is governance, not security.
 * - 30 s TTL cache per month: another machine's close becomes effective here
 *   within 30 s; every write path re-checks at write time. Acceptable for
 *   governance semantics.
 * - Demo/viewer read-only mode never throws (writes are no-ops anyway).
 * - `closeMonth`/`reopenMonth` bypass `updateMonthStatus` (whose monotonic rank
 *   guard would refuse the "closed" state and the reopen downgrade), but they
 *   still write the manifest inside the SAME casLoop protocol `updateMonthStatus`
 *   uses — identical lock key (`population-manifest/${month}:rmw`), revision bump
 *   and `_writeToken` stamp — so all three writers participate in one protocol and
 *   detect each other's concurrent writes (finding S3). A plain, non-participating
 *   write here would be invisible to `updateMonthStatus`'s conflict check and could
 *   let an automated status-advance silently un-close a frozen month.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { isReadOnlyMode } from "../storage/readOnlyMode";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import type { MonthManifestData } from "./monthTypes";

/** Lock key shared with populationStorage.updateMonthStatus so same-tab writers to
 *  month.manifest.json serialize and cross-machine writers share one casLoop protocol. */
export function manifestLockKey(monthFolderName: string): string {
  return `population-manifest/${monthFolderName}:rmw`;
}

const MANIFEST_FILE = "month.manifest.json";
const DEFAULT_CACHE_TTL_MS = 30_000;

export class MonthClosedError extends Error {
  readonly monthFolderName: string;
  constructor(monthFolderName: string) {
    super(`الشهر ${monthFolderName} مُقفل — لا يمكن التعديل بعد إقفال الشهر.`);
    this.name = "MonthClosedError";
    this.monthFolderName = monthFolderName;
  }
}

let cacheTtlMs = DEFAULT_CACHE_TTL_MS;
const cache = new Map<string, { closed: boolean; at: number }>();

/** @internal — test-only. Override the closed-state cache TTL. */
export function __setMonthLockTtlForTests(ms: number): void {
  cacheTtlMs = ms;
}

/** @internal — test-only. Restore the production TTL. */
export function __resetMonthLockTtlForTests(): void {
  cacheTtlMs = DEFAULT_CACHE_TTL_MS;
}

/** Drop the cached closed-state for one month (or all months when omitted). */
export function invalidateMonthLockCache(monthFolderName?: string): void {
  if (monthFolderName === undefined) {
    cache.clear();
  } else {
    cache.delete(monthFolderName);
  }
}

async function readManifest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<MonthManifestData | null> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const result = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
    return result.ok ? result.value : null;
  } catch {
    // Missing month folder / unreadable manifest — fail-open by design.
    return null;
  }
}

/** True when the month's manifest says "closed". TTL-cached; fail-open. */
export async function isMonthClosed(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(monthFolderName);
  if (hit && now - hit.at < cacheTtlMs) {
    return hit.closed;
  }
  const manifest = await readManifest(directoryHandle, monthFolderName);
  const closed = manifest?.status === "closed";
  cache.set(monthFolderName, { closed, at: now });
  return closed;
}

/**
 * Write gate: resolves when the month accepts writes, throws MonthClosedError
 * when it is closed. Demo read-only mode always resolves (writes are no-ops).
 */
export async function ensureMonthWritable(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<void> {
  if (isReadOnlyMode()) return;
  if (await isMonthClosed(directoryHandle, monthFolderName)) {
    throw new MonthClosedError(monthFolderName);
  }
}

export async function closeMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  closedBy: string,
  note?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Same casLoop protocol (lock key + revision + _writeToken) as
    // updateMonthStatus so a concurrent automated status-advance on the same
    // manifest is detected instead of silently un-closing the month (finding S3).
    const outcome = await withResourceLock(manifestLockKey(monthFolderName), () =>
      casLoop<{ ok: true } | { ok: false; error: string }>(
        async (writeToken) => {
          let monthDir: DirectoryHandleLike;
          try {
            monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
          } catch {
            // Missing month folder — terminal (not a write conflict), don't retry.
            return {
              done: true,
              result: { ok: false, error: `لا يوجد ملف بيان للشهر ${monthFolderName}.` },
            };
          }
          const manifestResult = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
          if (!manifestResult.ok) {
            return {
              done: true,
              result: { ok: false, error: `لا يوجد ملف بيان للشهر ${monthFolderName}.` },
            };
          }
          const manifest = manifestResult.value;
          if (manifest.status === "closed") {
            return { done: true, result: { ok: true as const } }; // idempotent
          }
          const now = new Date().toISOString();
          const nextRevision = (manifest.revision ?? 0) + 1;
          const updated: MonthManifestData = {
            ...manifest,
            status: "closed",
            statusBeforeClose: manifest.status,
            closedAt: now,
            closedBy,
            closeNote: note ?? null,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(monthDir, MANIFEST_FILE, updated);
          const verify = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return { done: true, result: { ok: true as const } };
          }
          return { done: false };
        },
        { conflictError: "تعذّر إقفال الشهر: تعارض في الكتابة بعد عدة محاولات." }
      )
    );
    invalidateMonthLockCache(monthFolderName);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "خطأ غير معروف أثناء إقفال الشهر.",
    };
  }
}

export async function reopenMonth(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  reopenedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Same casLoop protocol as closeMonth / updateMonthStatus (finding S3).
    const outcome = await withResourceLock(manifestLockKey(monthFolderName), () =>
      casLoop<{ ok: true } | { ok: false; error: string }>(
        async (writeToken) => {
          let monthDir: DirectoryHandleLike;
          try {
            monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
          } catch {
            return {
              done: true,
              result: { ok: false, error: `لا يوجد ملف بيان للشهر ${monthFolderName}.` },
            };
          }
          const manifestResult = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
          if (!manifestResult.ok) {
            return {
              done: true,
              result: { ok: false, error: `لا يوجد ملف بيان للشهر ${monthFolderName}.` },
            };
          }
          const manifest = manifestResult.value;
          if (manifest.status !== "closed") {
            return { done: true, result: { ok: true as const } }; // idempotent
          }
          const now = new Date().toISOString();
          const nextRevision = (manifest.revision ?? 0) + 1;
          const updated: MonthManifestData = {
            ...manifest,
            status: manifest.statusBeforeClose ?? "distributed",
            reopenedAt: now,
            reopenedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(monthDir, MANIFEST_FILE, updated);
          const verify = await safeReadJson<MonthManifestData>(monthDir, MANIFEST_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return { done: true, result: { ok: true as const } };
          }
          return { done: false };
        },
        { conflictError: "تعذّر إعادة فتح الشهر: تعارض في الكتابة بعد عدة محاولات." }
      )
    );
    invalidateMonthLockCache(monthFolderName);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "خطأ غير معروف أثناء إعادة فتح الشهر.",
    };
  }
}
