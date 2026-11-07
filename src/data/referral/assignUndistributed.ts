/**
 * Bulk «إسناد» of undistributed sample rows (owner, 2026-11-04): since v159.11
 * the oversight queue lists sample rows nobody has been given («غير موزعة»),
 * but bulk reassign only routes rows that already have an owner (a referral
 * request needs a `fromEmployee`), so «إسناد كل المطابق للتصفية» offered 407 of
 * the 832 unstudied cases the owner filtered. A row with no owner has no one
 * to ask, so it is a first assignment: an `assigned` event, exactly as the
 * distribution screen writes, with no request to approve.
 *
 * Re-derived from disk: an id that has an entry by now (another admin
 * distributed it meanwhile) is skipped. That check is read-then-append with no
 * cross-machine lock: two admins assigning the SAME undistributed ids at the
 * same moment could both write, and the fold keeps the later event. The tool
 * is admin-only (one admin in practice), the same exposure the distribution
 * screen's own bulk assign has.
 */
import { buildAssignEvent } from "../distribution/distributionLog";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { ensureMonthWritable } from "../population/monthLock";
import { readUserManagementState } from "../../auth/userManagement";
import { findAssignableEmployee } from "../distribution/bulkAssignment";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";

export type AssignUndistributedResult =
  | { ok: true; assigned: number; skipped: number }
  | { ok: false; error: string };

export async function assignUndistributedCases(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  xrayImageIds: readonly string[],
  assignedTo: string,
  eventBy: string,
  now: Date = new Date()
): Promise<AssignUndistributedResult> {
  if (xrayImageIds.length === 0) return { ok: true, assigned: 0, skipped: 0 };
  if (!findAssignableEmployee(assignedTo, readUserManagementState().users)) {
    return { ok: false, error: "الموظف المحدد غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات." };
  }
  await ensureMonthWritable(directoryHandle, monthFolderName);
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) return { ok: false, error: "تعذر تحميل ملف العينة الرئيسية للشهر." };
  const live = liveSampleRows(sample);
  const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, live);
  const covered = new Set((current?.entries ?? []).map((entry) => entry.xrayImageId));
  const inSample = new Set(live.map((row) => row.xrayImageId));
  const ids = [...new Set(xrayImageIds)].filter((id) => inSample.has(id) && !covered.has(id));
  if (ids.length > 0) {
    const eventAt = now.toISOString();
    const events = ids.map((xrayImageId) => buildAssignEvent({ xrayImageId, assignedTo, eventBy, eventAt }));
    const written = await appendDistributionEvents(directoryHandle, monthFolderName, events);
    if (!written.ok) return { ok: false, error: written.error };
    await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, live);
    bumpWorkspaceEpoch(directoryHandle, monthFolderName);
  }
  return { ok: true, assigned: ids.length, skipped: xrayImageIds.length - ids.length };
}
