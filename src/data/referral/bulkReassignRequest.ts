/**
 * Approval-routed variant of the oversight bulk reassignment.
 *
 * `executeBulkReassignment` (distribution/bulkAssignment.ts) applies the move
 * immediately — correct for a user who also holds `approve-referrals`, since
 * that is exactly the authority the approval step would ask for (same rule the
 * self-service reopen flow uses via `employee-reopen-instant`, and the same
 * shape as the Population tab's direct `handleReassign`).
 *
 * A user granted `bulk-reassign-referrals` WITHOUT `approve-referrals` must not
 * silently bypass oversight, so their action is turned into ordinary pending
 * referral requests instead: the very same `ReferralRequest` records the
 * per-row referral flow creates, appearing in `ew/referral-approval` and
 * applied by `approveReferral` on approval. Nothing is written to the
 * distribution event log here.
 *
 * A `ReferralRequest` carries exactly ONE `fromEmployee` (its record lives in
 * that employee's answers file, and `approveReferral`'s ownership check
 * validates every id against it), while a bulk selection can span many current
 * owners. The eligible rows are therefore grouped by current owner and one
 * request is created per group — each independently approvable, which also
 * matches how a supervisor reviews work: per employee.
 *
 * Idempotency: request ids are derived deterministically from the caller's
 * `sourceRequestId` plus the (sorted) owner username, and
 * `appendReferralRequest` de-duplicates by request id, so retrying a partially
 * failed submission re-creates nothing.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  planBulkReassignment,
  type BulkReassignSkip,
} from "../distribution/bulkAssignment";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { appendReferralRequest } from "./referralStorage";
import type { ReferralRequest } from "./referralTypes";

export type BulkReassignRequestGroup = {
  requestId: string;
  fromEmployee: string;
  xrayImageIds: string[];
};

export type BulkReassignRequestResult = {
  ok: boolean;
  /** One pending referral request per source employee. */
  createdRequests: BulkReassignRequestGroup[];
  skipped: BulkReassignSkip[];
  error?: string;
};

/** Stable per-owner request id — see the module docblock's idempotency note. */
export function bulkReassignRequestId(sourceRequestId: string, fromEmployee: string): string {
  return `${sourceRequestId}--${fromEmployee}`;
}

export async function submitBulkReassignmentRequests(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  xrayImageIds: string[];
  reassignedTo: string;
  requestedBy: string;
  reason?: string;
  sourceRequestId: string;
}): Promise<BulkReassignRequestResult> {
  const {
    directoryHandle,
    monthFolderName,
    xrayImageIds,
    reassignedTo,
    requestedBy,
    reason,
    sourceRequestId,
  } = params;

  if (xrayImageIds.length === 0) {
    return { ok: true, createdRequests: [], skipped: [] };
  }

  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return {
      ok: false,
      createdRequests: [],
      skipped: [],
      error: "تعذر تحميل ملف العينة الرئيسية للشهر.",
    };
  }

  // Fresh derivation, never the caller's rendered snapshot — same reasoning as
  // executeBulkReassignment: a stale read is exactly what would route rows that
  // have already moved.
  const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows);
  if (!current) {
    return {
      ok: false,
      createdRequests: [],
      skipped: [],
      error: "تعذر تحميل حالة التوزيع الحالية.",
    };
  }

  const plan = planBulkReassignment(current.entries, xrayImageIds, reassignedTo);
  if (plan.eligible.length === 0) {
    return { ok: true, createdRequests: [], skipped: plan.skipped };
  }

  const byOwner = new Map<string, string[]>();
  for (const row of plan.eligible) {
    const bucket = byOwner.get(row.assignedTo);
    if (bucket) bucket.push(row.xrayImageId);
    else byOwner.set(row.assignedTo, [row.xrayImageId]);
  }

  const requestedAt = new Date().toISOString();
  const createdRequests: BulkReassignRequestGroup[] = [];
  // Sorted so the generated ids do not depend on Map insertion order (which
  // follows the caller's selection order) — a retry must produce the same ids.
  for (const fromEmployee of [...byOwner.keys()].sort()) {
    const ids = byOwner.get(fromEmployee) ?? [];
    const requestId = bulkReassignRequestId(sourceRequestId, fromEmployee);
    const request: ReferralRequest = {
      requestId,
      monthFolderName,
      fromEmployee,
      toEmployee: reassignedTo,
      xrayImageIds: ids,
      reason: reason?.trim()
        ? `إعادة تعيين جماعية بطلب من ${requestedBy} — ${reason.trim()}`
        : `إعادة تعيين جماعية بطلب من ${requestedBy}`,
      requestedAt,
      requestedBy,
      status: "pending",
    };
    const result = await appendReferralRequest(directoryHandle, monthFolderName, request);
    if (!result.ok) {
      // Partial failure is retriable: already-written groups are de-duplicated
      // by request id on the next attempt, so the caller can simply re-confirm.
      return { ok: false, createdRequests, skipped: plan.skipped, error: result.error };
    }
    createdRequests.push({ requestId, fromEmployee, xrayImageIds: ids });
  }

  return { ok: true, createdRequests, skipped: plan.skipped };
}
