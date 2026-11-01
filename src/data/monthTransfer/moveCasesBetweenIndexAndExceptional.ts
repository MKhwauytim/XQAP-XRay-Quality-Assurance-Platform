/**
 * Admin bulk move from the referrals queue (owner, 2026-11-01): the cases the
 * queue currently shows (case chip + column filters) move between the month's
 * index sample («مستهدف المؤشر») and its exceptional cases («حالات استثنائية»).
 * Only NOT-studied cases move (owner's choice): completed or answered cases (a
 * draft too) are skipped and counted. Each moved case keeps its employee.
 *
 * Index → exceptional reuses the split's steps (`moveRowsToExceptional`).
 * Exceptional → index, per ad-hoc import:
 *  1. the rows join the month's population (deduplicated) and sample under
 *     their ORIGINAL id, then an `assigned` event gives each back to its
 *     employee in the month;
 *  2. only then do they leave the ad-hoc store: the pre-move sample.master is
 *     archived, the store's sample is rewritten without them, and the record's
 *     rows are marked excluded with no assignment (so no later save recreates
 *     them, and a later split may move them out again).
 * Nothing is deleted; the ad-hoc store's assignment events stay on disk and
 * fold as absent.
 */
import { buildAssignEvent } from "../distribution/distributionLog";
import { appendDistributionEvents, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import type { AdhocPreparedRow } from "../adhocImport/adhocDistributionBridge";
import { adhocMonthFolder, originalXrayImageIdAnyImport } from "../adhocImport/adhocImportModel";
import { loadAdhocRecord, saveAdhocRecord } from "../adhocImport/adhocImportStorage";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import { appendPopulationFinalRows } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { appendSampleRows, liveSampleRows, loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { casLoop } from "../storage/casLoop";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { moveRowsToExceptional, studiedAndAssigned } from "./splitMonthByIndexList";

export type MoveResult =
  | { ok: true; moved: number; skippedStudied: number; unrestored: number }
  | { ok: false; reason: "month-closed" | "no-sample" }
  | { ok: false; reason: "write-failed"; error: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Index → exceptional: `ids` are the month's own xrayImageIds. */
export async function moveIndexCasesToExceptional(
  directoryHandle: DirectoryHandleLike,
  month: string,
  ids: readonly string[],
  actor: string
): Promise<MoveResult> {
  invalidateMonthLockCache();
  if (await isMonthClosed(directoryHandle, month).catch(() => false)) return { ok: false, reason: "month-closed" };
  const sample = await loadSampleMaster(directoryHandle, month);
  if (!sample) return { ok: false, reason: "no-sample" };
  try {
    const wanted = new Set(ids);
    const live = liveSampleRows(sample);
    const rows = live.filter((row) => wanted.has(row.xrayImageId));
    const { studied } = await studiedAndAssigned(directoryHandle, month, live);
    const movable = rows.filter((row) => !studied.has(row.xrayImageId));
    if (movable.length === 0) return { ok: true, moved: 0, skippedStudied: rows.length, unrestored: 0 };
    const result = await moveRowsToExceptional(directoryHandle, month, movable, actor);
    return { ok: true, moved: movable.length, skippedStudied: rows.length - movable.length, unrestored: result.unrestored };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: errorText(error) };
  }
}

export type ExceptionalCase = { importId: string; xrayImageId: string; assignedTo: string };

function toMonthRow(row: AdhocPreparedRow): PreparedPopulationRow {
  const { adhocSourceRowKey: _key, adhocReplicaIndex: _replica, ...rest } = row;
  void _key;
  void _replica;
  return { ...rest, xrayImageId: originalXrayImageIdAnyImport(row.xrayImageId) };
}

/** Exceptional → index: `cases` are ad-hoc queue entries (namespaced ids). */
export async function moveExceptionalCasesToIndex(
  directoryHandle: DirectoryHandleLike,
  month: string,
  cases: readonly ExceptionalCase[],
  actor: string,
  now: Date = new Date()
): Promise<MoveResult> {
  invalidateMonthLockCache();
  if (await isMonthClosed(directoryHandle, month).catch(() => false)) return { ok: false, reason: "month-closed" };
  if (!(await loadSampleMaster(directoryHandle, month))) return { ok: false, reason: "no-sample" };
  const byImport = new Map<string, ExceptionalCase[]>();
  for (const item of cases) byImport.set(item.importId, [...(byImport.get(item.importId) ?? []), item]);

  let moved = 0;
  let skippedStudied = 0;
  try {
    for (const [importId, items] of byImport) {
      const store = adhocMonthFolder(importId);
      const storeSample = await loadSampleMaster(directoryHandle, store);
      const record = await loadAdhocRecord(directoryHandle, importId);
      if (!storeSample || !record) continue;
      const { studied } = await studiedAndAssigned(directoryHandle, store, storeSample.rows);
      const wanted = new Map(items.map((item) => [item.xrayImageId, item.assignedTo]));
      const rows = (storeSample.rows as AdhocPreparedRow[]).filter((row) => wanted.has(row.xrayImageId));
      const movable = rows.filter((row) => !studied.has(row.xrayImageId));
      skippedStudied += rows.length - movable.length;
      if (movable.length === 0) continue;

      // 1. Into the month, each with its employee.
      const monthRows = movable.map(toMonthRow);
      await appendPopulationFinalRows(directoryHandle, month, monthRows as unknown as Array<Record<string, unknown>>, actor);
      const appended = await appendSampleRows(directoryHandle, month, monthRows);
      if (!appended.ok) throw new Error(appended.error);
      const eventAt = now.toISOString();
      const events = movable.map((row) => buildAssignEvent({
        xrayImageId: originalXrayImageIdAnyImport(row.xrayImageId), assignedTo: wanted.get(row.xrayImageId) as string,
        eventBy: actor, eventAt,
      }));
      const written = await appendDistributionEvents(directoryHandle, month, events);
      if (!written.ok) throw new Error("تعذّر تسجيل توزيع الحالات في الشهر.");
      await refreshDistributionCacheAfterWrite(directoryHandle, month, liveSampleRows(appended.data));

      // 2. Out of the ad-hoc store — archived first, never deleted.
      const movedIds = new Set(movable.map((row) => row.xrayImageId));
      const storeDir = await getSampleMainDir(directoryHandle, store, true);
      await safeWriteJson(storeDir, `sample.master.before-move-${now.getTime()}.json`, storeSample);
      const rewritten = await casLoop<{ ok: true; rows: PreparedPopulationRow[] }>(
        async (writeToken) => {
          const current = await loadSampleMaster(directoryHandle, store);
          if (!current) return { done: true, result: { ok: true as const, rows: [] } };
          const nextRevision = (current.revision ?? 0) + 1;
          const keep = current.rows.filter((row) => !movedIds.has(row.xrayImageId));
          const write = await saveSampleMaster(directoryHandle, store, {
            ...current, rows: keep, totalActual: keep.length, revision: nextRevision, _writeToken: writeToken,
          });
          if (!write.ok) return { done: false };
          const verify = await loadSampleMaster(directoryHandle, store);
          return verify?.revision === nextRevision && verify._writeToken === writeToken
            ? { done: true, result: { ok: true as const, rows: verify.rows } }
            : { done: false };
        },
        { context: "month:move-exceptional-to-index", conflictError: "تعارض في الكتابة أثناء تحديث الحالات الاستثنائية." }
      );
      if (!rewritten.ok) throw new Error(rewritten.error);
      const movedKeys = new Set(movable.map((row) => row.adhocSourceRowKey));
      await saveAdhocRecord(directoryHandle, {
        ...record,
        rows: record.rows.map((row) => (movedKeys.has(row.rowKey) ? { ...row, excludedByAdmin: true, assignments: [] } : row)),
      });
      await refreshDistributionCacheAfterWrite(directoryHandle, store, rewritten.rows);
      bumpWorkspaceEpoch(directoryHandle, store);
      moved += movable.length;
    }
    bumpWorkspaceEpoch(directoryHandle, month);
    return { ok: true, moved, skippedStudied, unrestored: 0 };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: errorText(error) };
  }
}
