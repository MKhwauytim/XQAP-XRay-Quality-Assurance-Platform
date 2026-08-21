/**
 * v1 ASSIGNMENT API, kept as a thin adapter while the Ad-hoc Import tab is
 * rebuilt against the v2 model.
 *
 * All the real work — the projection onto `PreparedPopulationRow`, the sample
 * master, the event append, the roster revalidation, the stale-record defence —
 * now lives in `adhocDistributionBridge.ts`, which is the module allowed to
 * touch sampling/distribution/answers. This file only translates: a v1 record
 * plus a list of row keys becomes an explicit one-employee `PlannedAssignment[]`,
 * and the bridge's `AdhocRecord` result becomes the v1 view again.
 *
 * Every safety property the v1 implementation documented is preserved, and the
 * comments explaining WHY they exist have moved to the bridge alongside the code
 * that enforces them. `adhocImportAssignment.test.ts` still exercises them
 * through this entry point, which is what proves the translation is faithful.
 *
 * Delete this file once nothing imports it.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { namespacedXrayImageId } from "./adhocImportModel";
import type { AdhocRecord, PlannedAssignment } from "./adhocImportModel";
import type { AdhocImportRecord } from "./adhocImportTypes";
import { normalizeAdhocRecord, toLegacyRecord } from "./adhocRecordMigration";
import { assignAdhocPlan, ensureAdhocSampleMaster as ensureSampleMaster } from "./adhocDistributionBridge";
import { loadAdhocRecord } from "./adhocImportStorage";

const INVALID_RECORD = "تعذّر قراءة سجل الاستيراد اليدوي.";

function normalizeOrThrow(record: AdhocImportRecord): AdhocRecord {
  const normalized = normalizeAdhocRecord(record);
  if (normalized === null) {
    throw new Error(INVALID_RECORD);
  }
  return normalized;
}

/** v1 signature over the bridge's `ensureAdhocSampleMaster`. */
export async function ensureAdhocSampleMaster(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord
): Promise<PreparedPopulationRow[]> {
  return ensureSampleMaster(directoryHandle, normalizeOrThrow(record));
}

export type AssignAdhocRowsResult =
  | { ok: true; assignedCount: number; skippedCount: number; record: AdhocImportRecord }
  | { ok: false; error: string };

/**
 * Assigns the given rows of an ad-hoc import to ONE employee — v1's only mode,
 * which the planner now calls `explicit`.
 *
 * The plan is built from the record as it is ON DISK, never from the caller's
 * (possibly hours-old) copy: a row the caller still thinks is free may have been
 * excluded or assigned by another machine since, and planning from the stale
 * copy would name row keys the bridge then has to reject one by one. Rows that
 * already carry an assignment are left out here for the same reason v1 filtered
 * on `!assigned` — re-running an assignment must not hand a taken row to a
 * second employee. The bridge's `ownedIds` guard still backs this up against the
 * distribution log itself.
 */
export async function assignAdhocRowsToEmployee(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord,
  rowKeys: string[],
  assignedTo: string,
  eventBy: string
): Promise<AssignAdhocRowsResult> {
  const fresh = (await loadAdhocRecord(directoryHandle, record.importId)) ?? normalizeOrThrow(record);
  const requested = new Set(rowKeys);

  const plan: PlannedAssignment[] = fresh.rows
    .filter(
      (row) =>
        requested.has(row.rowKey) &&
        row.validation.valid &&
        !row.excludedByAdmin &&
        row.assignments.length === 0 &&
        row.mapped.xrayImageId
    )
    .map((row) => ({
      rowKey: row.rowKey,
      username: assignedTo,
      replicaIndex: 0,
      xrayImageId: namespacedXrayImageId(fresh.importId, row.mapped.xrayImageId as string, 0),
    }));

  const result = await assignAdhocPlan(directoryHandle, fresh, plan, eventBy);
  return result.ok ? { ...result, record: toLegacyRecord(result.record) } : result;
}
