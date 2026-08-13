/**
 * Oversight bulk reassignment, as a request.
 *
 * The bulk-reassign bar never writes distribution events. It creates the very
 * same pending `ReferralRequest` records the per-row إحالة flow creates, which
 * appear in `ew/referral-approval` and are applied by `approveReferral` once
 * approved — exactly like استبدال (replacement) and إعادة الفتح (reopen).
 *
 * This holds regardless of the submitter's permissions. Whether they can then
 * approve their own request is a separate question answered by
 * `approve-referrals`; it is never allowed to decide whether a reviewable
 * record exists at all. In practice a supervisor often submits and approves
 * seconds apart — the record of who asked, when, for which samples, and who
 * decided is the deliverable, not the delay.
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
import { planReassignment, type ReassignSkip } from "./planReassignment";
import { loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { ensureMonthWritable } from "../population/monthLock";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { appendReferralRequest } from "./referralStorage";
import type { ReferralRequest } from "./referralTypes";

export type ReassignRequestGroup = {
  requestId: string;
  fromEmployee: string;
  xrayImageIds: string[];
};

export type ReassignRequestResult = {
  ok: boolean;
  /** One pending referral request per source employee. */
  createdRequests: ReassignRequestGroup[];
  skipped: ReassignSkip[];
  error?: string;
};

/** Stable per-owner request id — see the module docblock's idempotency note. */
export function reassignRequestId(sourceRequestId: string, fromEmployee: string): string {
  return `${sourceRequestId}--${fromEmployee}`;
}

export async function submitReassignmentRequests(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  xrayImageIds: string[];
  reassignedTo: string;
  requestedBy: string;
  reason?: string;
  sourceRequestId: string;
}): Promise<ReassignRequestResult> {
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

  // Fail fast on a closed month, before any group is written. The per-employee
  // write is month-locked individually anyway, but that would surface as a raw
  // error string mid-batch after some groups had already landed; letting
  // MonthClosedError propagate here keeps the caller's existing typed handling
  // (a friendly label) and guarantees an all-or-nothing submission.
  await ensureMonthWritable(directoryHandle, monthFolderName);

  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return {
      ok: false,
      createdRequests: [],
      skipped: [],
      error: "تعذر تحميل ملف العينة الرئيسية للشهر.",
    };
  }

  // Fresh derivation, never the caller's rendered snapshot: a stale read is
  // exactly what would route rows that have already moved.
  const current = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows);
  if (!current) {
    return {
      ok: false,
      createdRequests: [],
      skipped: [],
      error: "تعذر تحميل حالة التوزيع الحالية.",
    };
  }

  const plan = planReassignment(current.entries, xrayImageIds, reassignedTo);
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
  const createdRequests: ReassignRequestGroup[] = [];
  // Sorted so the generated ids do not depend on Map insertion order (which
  // follows the caller's selection order) — a retry must produce the same ids.
  for (const fromEmployee of [...byOwner.keys()].sort()) {
    const ids = byOwner.get(fromEmployee) ?? [];
    const requestId = reassignRequestId(sourceRequestId, fromEmployee);
    const request: ReferralRequest = {
      requestId,
      monthFolderName,
      fromEmployee,
      toEmployee: reassignedTo,
      xrayImageIds: ids,
      reason: reason?.trim()
        ? `إحالة بطلب من ${requestedBy} — ${reason.trim()}`
        : `إحالة بطلب من ${requestedBy}`,
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
