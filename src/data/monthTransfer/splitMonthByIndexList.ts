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
 * without the moved rows (CAS); (4) the distribution cache is refreshed;
 * (5) every moved row that was assigned in the month is assigned again, in the
 * ad-hoc import, to the same employee (v159.6), so it stays in that
 * employee's queue, now under «حالات استثنائية». Step 5 also repairs a split
 * run by v159.5, which left those rows unassigned: the month's distribution
 * events are immutable files, so the last assignee of each moved id is still
 * known. Unassigned ad-hoc rows appear in no queue, which is how ~2,000 cases
 * vanished from view after the owner's first split.
 */
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { assignAdhocPlan, ensureAdhocSampleMaster } from "../adhocImport/adhocDistributionBridge";
import { EXCEL_FILLABLE_FIELDS, EXCEL_INTO_MONTH_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import {
  namespacedXrayImageId,
  type AdhocMappedRow,
  type AdhocRecord,
  type AdhocRow,
  type ImportMapping,
  type PlannedAssignment,
} from "../adhocImport/adhocImportModel";
import { createImportId, loadAdhocImportIndex, loadAdhocRecord, saveAdhocRecord } from "../adhocImport/adhocImportStorage";
import { loadDistributionLog, loadOrDeriveDistributionCurrent, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
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
  /** Rows an earlier split moved that lost their employee and can be given back. */
  restorable: number;
};

export type SplitPlanResult =
  | { ok: true; plan: SplitPlan }
  | { ok: false; reason: "month-closed" | "no-sample" };

/**
 * `listIds: null` is restore-only: no file, nothing moves, and only the
 * earlier split's cases are given back to their employees. The owner has no
 * Excel to re-upload for that, since the cases came from the system itself.
 */
export async function planSplitMonth(
  directoryHandle: DirectoryHandleLike,
  month: string,
  listIds: readonly string[] | null
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

  const listed = new Set((listIds ?? []).map((id) => id.trim()).filter(Boolean));
  const plan: SplitPlan = { month, keptStudied: [], keptListed: [], moved: [], movedAssigned: 0, listNotInMonth: [], restorable: 0 };
  const inMonth = new Set<string>();
  for (const row of rows) {
    inMonth.add(row.xrayImageId);
    if (studied.has(row.xrayImageId)) plan.keptStudied.push(row.xrayImageId);
    else if (listIds === null || listed.has(row.xrayImageId)) plan.keptListed.push(row.xrayImageId);
    else {
      plan.moved.push(row);
      if (assigned.has(row.xrayImageId)) plan.movedAssigned += 1;
    }
  }
  for (const id of listed) if (!inMonth.has(id)) plan.listNotInMonth.push(id);
  const assignees = await lastAssignees(directoryHandle, month);
  for (const record of await splitRecords(directoryHandle, month)) {
    plan.restorable += restorePlan(record, assignees).length;
  }
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

/** Every ad-hoc record an earlier split of this month created. */
async function splitRecords(directoryHandle: DirectoryHandleLike, month: string): Promise<AdhocRecord[]> {
  const out: AdhocRecord[] = [];
  for (const entry of (await loadAdhocImportIndex(directoryHandle)) ?? []) {
    if (!entry.fileName.startsWith(`${SPLIT_FILE_PREFIX}${month}`)) continue;
    const record = await loadAdhocRecord(directoryHandle, entry.importId);
    if (record) out.push(record);
  }
  return out;
}

/** Ids an earlier split of this month already moved, so a re-run never moves one twice. */
async function alreadyMovedIds(directoryHandle: DirectoryHandleLike, month: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const record of await splitRecords(directoryHandle, month)) {
    for (const row of record.rows) if (row.mapped.xrayImageId) ids.add(row.mapped.xrayImageId);
  }
  return ids;
}

/** xrayImageId → the employee its latest assign/reassign event in the month names. */
async function lastAssignees(directoryHandle: DirectoryHandleLike, month: string): Promise<Map<string, string>> {
  const latest = new Map<string, { at: string; user: string }>();
  const log = await loadDistributionLog(directoryHandle, month);
  for (const event of log?.events ?? []) {
    if (event.eventType !== "assigned" && event.eventType !== "reassigned") continue;
    const user = event.reassignedTo ?? event.assignedTo;
    if (!user) continue;
    const prev = latest.get(event.xrayImageId);
    if (!prev || event.eventAt >= prev.at) latest.set(event.xrayImageId, { at: event.eventAt, user });
  }
  return new Map([...latest].map(([id, value]) => [id, value.user]));
}

/** Unassigned rows of a split record whose month assignee is known. */
function restorePlan(record: AdhocRecord, assignees: ReadonlyMap<string, string>): PlannedAssignment[] {
  if (record.status === "closed") return [];
  const plan: PlannedAssignment[] = [];
  for (const row of record.rows) {
    const id = row.mapped.xrayImageId;
    const user = id ? assignees.get(id) : undefined;
    if (!id || !user || row.assignments.length > 0 || row.excludedByAdmin) continue;
    plan.push({ rowKey: row.rowKey, username: user, replicaIndex: 0, xrayImageId: namespacedXrayImageId(record.importId, id, 0) });
  }
  return plan;
}

/**
 * Step 5: give each moved row back to the employee it had in the month, one
 * employee at a time, so an employee who can no longer receive cases (inactive,
 * removed) leaves only their rows unassigned instead of failing the rest.
 */
async function restoreAssignments(
  directoryHandle: DirectoryHandleLike,
  month: string,
  actor: string
): Promise<{ restored: number; unrestored: number }> {
  const assignees = await lastAssignees(directoryHandle, month);
  let restored = 0;
  let unrestored = 0;
  for (const record of await splitRecords(directoryHandle, month)) {
    const byUser = new Map<string, PlannedAssignment[]>();
    for (const item of restorePlan(record, assignees)) {
      byUser.set(item.username, [...(byUser.get(item.username) ?? []), item]);
    }
    for (const plan of byUser.values()) {
      const result = await assignAdhocPlan(directoryHandle, record, plan, actor);
      if (result.ok) restored += plan.length;
      else unrestored += plan.length;
    }
  }
  return { restored, unrestored };
}

export type SplitResult =
  | { ok: true; plan: SplitPlan; importId: string | null; moved: number; restored: number; unrestored: number }
  | { ok: false; reason: "month-closed" | "no-sample" }
  | { ok: false; reason: "write-failed"; error: string };

export async function executeSplitMonth(
  directoryHandle: DirectoryHandleLike,
  month: string,
  listIds: readonly string[] | null,
  actor: string,
  now: Date = new Date()
): Promise<SplitResult> {
  const planned = await planSplitMonth(directoryHandle, month, listIds);
  if (!planned.ok) return planned;
  const { plan } = planned;
  try {
    if (plan.moved.length === 0) {
      const back = plan.restorable > 0
        ? await restoreAssignments(directoryHandle, month, actor)
        : { restored: 0, unrestored: 0 };
      if (back.restored > 0) bumpWorkspaceEpoch(directoryHandle, month);
      return { ok: true, plan, importId: null, moved: 0, ...back };
    }
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
    // 5. Same employee, now as an exceptional case.
    const back = await restoreAssignments(directoryHandle, month, actor);
    bumpWorkspaceEpoch(directoryHandle, month);
    return { ok: true, plan, importId, moved: plan.moved.length, ...back };
  } catch (error) {
    return { ok: false, reason: "write-failed", error: error instanceof Error ? error.message : String(error) };
  }
}
