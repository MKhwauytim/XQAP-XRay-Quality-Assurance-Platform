/**
 * Employee self-service reopen-case orchestrator (Batch B).
 *
 * Branches on the caller-supplied `instant` flag, which the UI derives from the
 * per-role `employee-reopen-instant` feature (Batch C):
 *
 *  - instant === true  → apply the reopen immediately by reusing the existing,
 *    idempotent `reopenSubmittedAnswer` path (no request/approval step).
 *  - instant === false → create a pending, CAS-safe `ReopenRequest` in the
 *    employee's own file and emit a best-effort `reopen-requested` audit event
 *    into the distribution log. A supervisor later approves/denies it from the
 *    unified اعتماد الطلبات page.
 *
 * This is distinct from `ew.reopenAnswer` (supervisor/manager/admin direct
 * reopen of ANY answer), which is untouched.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import { reopenSubmittedAnswer } from "../answers/reopenAnswer";
import { appendDistributionEvent } from "../distribution/distributionStorage";
import { buildReopenRequestedEvent } from "../distribution/distributionLog";
import { appendReopenRequest, loadReopenLog } from "./referralStorage";
import type { ReopenRequest } from "./referralTypes";

export type SubmitReopenResult =
  | { ok: true; mode: "instant" | "requested" }
  | { ok: false; error: string };

export async function submitReopenRequest(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  /** Owner of the submitted answer (== requestedBy for self-service). */
  employeeUsername: string;
  xrayImageId: string;
  /** Current distribution assignee of the case (for the audit event). */
  assignedTo: string;
  requestedBy: string;
  requestedByRole: string;
  reason: string;
  /** From the requesting role's `employee-reopen-instant` feature flag. */
  instant: boolean;
}): Promise<SubmitReopenResult> {
  const {
    directoryHandle,
    monthFolderName,
    employeeUsername,
    xrayImageId,
    assignedTo,
    requestedBy,
    requestedByRole,
    reason,
    instant,
  } = params;

  if (instant) {
    const result = await reopenSubmittedAnswer({
      directoryHandle,
      monthFolderName,
      employeeUsername,
      xrayImageId,
      reopenedBy: requestedBy,
      reopenedByRole: requestedByRole,
      reason,
    });
    return result.ok ? { ok: true, mode: "instant" } : { ok: false, error: result.error };
  }

  const request: ReopenRequest = {
    requestId: `reo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    monthFolderName,
    employeeUsername,
    xrayImageId,
    reason,
    requestedAt: new Date().toISOString(),
    requestedBy,
    status: "pending",
  };

  const appended = await appendReopenRequest(directoryHandle, monthFolderName, request);
  if (!appended.ok) {
    return { ok: false, error: appended.error };
  }

  // Best-effort audit marker in the distribution log — the ReopenRequest is the
  // source of truth for the approval queue, so a failure here must not fail the
  // request the employee already saw succeed.
  try {
    const eventResult = await appendDistributionEvent(
      directoryHandle,
      monthFolderName,
      buildReopenRequestedEvent({
        xrayImageId,
        assignedTo,
        eventBy: requestedBy,
        notes: reason,
        sourceRequestId: request.requestId,
      })
    );
    if (!eventResult.ok) {
      logError("reopen:request-event", new Error(eventResult.error));
    }
  } catch (error) {
    logError("reopen:request-event", error);
  }

  return { ok: true, mode: "requested" };
}

export type BulkReopenCase = { monthFolderName: string; xrayImageId: string; assignedTo: string };

export type BulkReopenResult = {
  /** Pending requests filed for a supervisor to decide. */
  requested: number;
  /** Cases reopened at once (instant mode). */
  reopened: number;
  /** Cases left alone because they already have a pending request. */
  skippedPending: number;
  failed: number;
  firstError?: string;
};

/**
 * `submitReopenRequest` for every case the queue filter matches (owner,
 * 2026-11-25): one request per case, written one after another so each lands
 * through the same CAS path as a single request. A case that already has a
 * pending request is skipped, so a second click files nothing twice. A failure
 * on one case does not stop the rest; it is counted and the first error kept.
 */
export async function submitReopenRequests(params: {
  directoryHandle: DirectoryHandleLike;
  cases: readonly BulkReopenCase[];
  requestedBy: string;
  requestedByRole: string;
  reason: string;
  instant: boolean;
}): Promise<BulkReopenResult> {
  const { directoryHandle, cases, requestedBy, requestedByRole, reason, instant } = params;
  const result: BulkReopenResult = { requested: 0, reopened: 0, skippedPending: 0, failed: 0 };
  const pendingByMonth = new Map<string, Set<string>>();
  for (const item of cases) {
    let pending = pendingByMonth.get(item.monthFolderName);
    if (!pending) {
      const log = await loadReopenLog(directoryHandle, item.monthFolderName);
      pending = new Set(log.requests.filter((r) => r.status === "pending").map((r) => `${r.employeeUsername}::${r.xrayImageId}`));
      pendingByMonth.set(item.monthFolderName, pending);
    }
    const key = `${item.assignedTo}::${item.xrayImageId}`;
    if (!instant && pending.has(key)) {
      result.skippedPending += 1;
      continue;
    }
    const outcome = await submitReopenRequest({
      directoryHandle,
      monthFolderName: item.monthFolderName,
      employeeUsername: item.assignedTo,
      xrayImageId: item.xrayImageId,
      assignedTo: item.assignedTo,
      requestedBy,
      requestedByRole,
      reason,
      instant,
    });
    if (!outcome.ok) {
      result.failed += 1;
      result.firstError ??= outcome.error;
    } else if (outcome.mode === "instant") {
      result.reopened += 1;
    } else {
      result.requested += 1;
      pending.add(key);
    }
  }
  return result;
}

