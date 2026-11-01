/**
 * Admin «تقسيم الشهر حسب مستهدف المؤشر» (owner, 2026-11-01): after several
 * months were merged into one, the month's index sample should hold only
 *  - every case already studied (completed, or with any answer — a draft too,
 *    so no reviewer's work is moved away), and
 *  - every not-yet-studied case whose xrayImageId is in the uploaded list
 *    (the «المتبقي لإنجاز المؤشر» sheet).
 * Every other not-yet-studied case MOVES to a new ad-hoc import
 * («الحالات الاستثنائية») bound to that same month only. Nothing is deleted:
 * the population is untouched, and the pre-split sample.master.json is
 * archived beside the live one before it is rewritten.
 *
 * Order makes a re-run safe after a partial failure: (1) the ad-hoc record and
 * its sample are written first, skipping ids an earlier split of this month
 * already moved; (2) the archive copy; (3) the month's sample is rewritten
 * without the moved rows (CAS); (4) the distribution cache is refreshed. Rows
 * moved while assigned lose that assignment (the fold reports the orphaned
 * events as absent); they are distributed again from the ad-hoc import.
 */
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { ensureAdhocSampleMaster } from "../adhocImport/adhocDistributionBridge";
import { EXCEL_FILLABLE_FIELDS, EXCEL_INTO_MONTH_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import type { AdhocMappedRow, AdhocRecord, AdhocRow, ImportMapping } from "../adhocImport/adhocImportModel";
import { createImportId, loadAdhocImportIndex, loadAdhocRecord, saveAdhocRecord } from "../adhocImport/adhocImportStorage";
import { loadOrDeriveDistributionCurrent, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { liveSampleRows, loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { casLoop } from "../storage/casLoop";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";

/** Marks a record this tool created, so a re-run can find what it already moved. */
export const SPLIT_FILE_PREFIX = "split-";

export type SplitPlan = {
  month: string;
  /** Studied (completed or answered) — stay in the index. */
  keptStudied: string[];
  /** Not studied, in the uploaded list — stay in the index. */
  keptListed: string[];
  /** Not studied, not in the list — move to the month's exceptional cases. */
  moved: PreparedPopulationRow[];
  /** Of `moved`, those currently assigned to someone (their assignment ends). */
  movedAssigned: number;
  /** Ids in the list that are not in this month's sample. */
  listNotInMonth: string[];
};

export type SplitPlanResult =
  | { ok: true; plan: SplitPlan }
  | { ok: false; reason: "month-closed" | "no-sample" };

export async function planSplitMonth(
  directoryHandle: DirectoryHandleLike,
  month: string,
  listIds: readonly string[]
): Promise<SplitPlanResult> {
  invalidateMonthLockCache();
  if (await isMonthClosed(directoryHandle, month).catch(() => false)) return { ok: false, reason: "month-closed" };
  const sample = await loadSampleMaster(directoryHandle, month);
  if (!sample) return { ok: false, reason: "no-sample" };
  const rows = liveSampleRows(sample);

  const studied = new Set<string>();
  const assigned = new Set<string>();
  const current = await loadOrDeriveDistributionCurrent(directoryHandle, month, rows);
  for (const entry of current?.entries ?? []) {
    if (entry.status === "completed") studied.add(entry.xrayImageId);
    if (entry.status !== "replaced") assigned.add(entry.xrayImageId);
  }
  for (const file of await loadAllEmployeeFiles(directoryHandle, month)) {
    for (const item of file.items) studied.add(item.xrayImageId);
  }

  const listed = new Set(listIds.map((id) => id.trim()).filter(Boolean));
  const plan: SplitPlan = { month, keptStudied: [], keptListed: [], moved: [], movedAssigned: 0, listNotInMonth: [] };
  const inMonth = new Set<string>();
  for (const row of rows) {
    inMonth.add(row.xrayImageId);
    if (studied.has(row.xrayImageId)) plan.keptStudied.push(row.xrayImageId);
    else if (listed.has(row.xrayImageId)) plan.keptListed.push(row.xrayImageId);
    else {
      plan.moved.push(row);
      if (assigned.has(row.xrayImageId)) plan.movedAssigned += 1;
    }
  }
  for (const id of listed) if (!inMonth.has(id)) plan.listNotInMonth.push(id);
  return { ok: true, plan };
}

const FIELDS = EXCEL_INTO_MONTH_FIELD_CATALOG.filter(
  (field) => field.key === "xrayImageId" || (EXCEL_FILLABLE_FIELDS as readonly string[]).includes(field.key)
);

function toAdhocRow(row: PreparedPopulationRow, index: number, sheetName: string): AdhocRow {
  const record = row as unknown as Record<string, unknown>;
  const mapped: AdhocMappedRow = {};
  for (const field of FIELDS) {
    const value = record[field.key];
    mapped[field.key] = value == null || value === "" ? null : String(value);
  }
  return { rowKey: `${sheetName}:${index + 2}`, mapped, validation: { valid: true }, excludedByAdmin: false, assignments: [] };
}

/** Ids an earlier split of this month already moved, so a re-run never moves one twice. */
async function alreadyMovedIds(directoryHandle: DirectoryHandleLike, month: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const index = await loadAdhocImportIndex(directoryHandle);
  for (const entry of index ?? []) {
    if (!entry.fileName.startsWith(`${SPLIT_FILE_PREFIX}${month}`)) continue;
    const record = await loadAdhocRecord(directoryHandle, entry.importId);
    for (const row of record?.rows ?? []) if (row.mapped.xrayImageId) ids.add(row.mapped.xrayImageId);
  }
  return ids;
}

export type SplitResult =
  | { ok: true; plan: SplitPlan; importId: string | null; moved: number }
  | { ok: false; reason: "month-closed" | "no-sample" }
  | { ok: false; reason: "write-failed"; error: string };

export async function executeSplitMonth(
  directoryHandle: DirectoryHandleLike,
  month: string,
  listIds: readonly string[],
  actor: string,
  now: Date = new Date()
): Promise<SplitResult> {
  const planned = await planSplitMonth(directoryHandle, month, listIds);
  if (!planned.ok) return planned;
  const { plan } = planned;
  if (plan.moved.length === 0) return { ok: true, plan, importId: null, moved: 0 };
  try {
    // 1. The exceptional cases, first — the month is only rewritten once they exist.
    const done = await alreadyMovedIds(directoryHandle, month);
    const fresh = plan.moved.filter((row) => !done.has(row.xrayImageId));
    let importId: string | null = null;
    if (fresh.length > 0) {
      const stamp = now.toISOString();
      const sheetName = "الحالات الاستثنائية";
      const mapping: ImportMapping = {
        fields: Object.fromEntries(FIELDS.map((field) => [field.key, { kind: "column" as const, header: field.labelAr }])),
        valueMappings: {},
      };
      const record: AdhocRecord = {
        importId: createImportId(),
        schemaVersion: 2,
        fileName: `${SPLIT_FILE_PREFIX}${month}-${stamp.slice(0, 10)}`,
        importedBy: actor,
        importedAt: stamp,
        status: "open",
        kind: "sample",
        sourceKind: "file",
        mapping,
        fieldCatalog: EXCEL_INTO_MONTH_FIELD_CATALOG,
        monthBinding: { kind: "month", monthFolderName: month },
        rows: fresh.map((row, i) => toAdhocRow(row, i, sheetName)),
      };
      const saved = await saveAdhocRecord(directoryHandle, record);
      await ensureAdhocSampleMaster(directoryHandle, saved);
      importId = saved.importId;
    }

    // 2–3. Archive the pre-split sample, then rewrite it without the moved rows.
    const movedIds = new Set(plan.moved.map((row) => row.xrayImageId));
    const sampleDir = await getSampleMainDir(directoryHandle, month, true);
    const result = await casLoop<{ ok: true; rows: PreparedPopulationRow[] }>(
      async (writeToken) => {
        const current = await loadSampleMaster(directoryHandle, month);
        if (!current) return { done: true, result: { ok: true as const, rows: [] } };
        await safeWriteJson(sampleDir, `sample.master.before-split-${now.getTime()}.json`, current);
        const rows = current.rows.filter((row) => !movedIds.has(row.xrayImageId));
        const next = { ...current, rows };
        const nextRevision = (current.revision ?? 0) + 1;
        const write = await saveSampleMaster(directoryHandle, month, {
          ...next, totalActual: liveSampleRows(next).length, revision: nextRevision, _writeToken: writeToken,
        });
        if (!write.ok) return { done: false };
        const verify = await loadSampleMaster(directoryHandle, month);
        if (verify?.revision === nextRevision && verify._writeToken === writeToken) {
          return { done: true, result: { ok: true as const, rows: liveSampleRows(verify) } };
        }
        return { done: false };
      },
      { context: "month:split-by-index-list", conflictError: "تعارض في الكتابة أثناء تحديث عينة الشهر." }
    );
    if (!result.ok) return { ok: false, reason: "write-failed", error: result.error };

    // 4. Refold so the moved rows leave every view of the month.
    await refreshDistributionCacheAfterWrite(directoryHandle, month, result.rows);
    bumpWorkspaceEpoch(directoryHandle, month);
    return { ok: true, plan, importId, moved: plan.moved.length };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: error instanceof Error ? error.message : String(error) };
  }
}
