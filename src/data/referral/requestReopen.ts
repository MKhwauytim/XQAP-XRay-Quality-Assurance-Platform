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
import { appendReopenRequest } from "./referralStorage";
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
