/**
 * Reopen-for-correction orchestrator (Tier-1 Item D).
 *
 * Returns a submitted answer to "draft" so the employee can correct it, and —
 * when the distribution entry was marked completed — appends a "reopened"
 * event so derived state and quotas stay consistent.
 *
 * Idempotency: the answer flip is a no-op when not submitted, and the event
 * carries `sourceRequestId = "reopen-{xrayImageId}-{previousSubmittedAt}"`
 * which is replay-guarded against the distribution log, so a retry after a
 * partial failure cannot double-apply.
 *
 * Every reopen path funnels through here — the employee's own instant
 * self-service reopen, a supervisor's approval of a queued `ReopenRequest`
 * (`approveReopen`), AND a supervisor's DIRECT reopen from «صور الأشعة
 * المحالة» / «نتائج فحص الأشعة» (`ew.reopenAnswer`, no approval desk
 * involved). That third path used to leave any outstanding PENDING request
 * for the same case stranded forever: the case really was reopened, but
 * nothing ever recorded a decision on the request the employee filed for it,
 * so its wait-time badge kept climbing and the employee's own request
 * history never showed it as resolved — indistinguishable, from their side,
 * from the reopen never having happened at all. Step 4 below closes that gap
 * for every call site at once.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { ensureMonthWritable } from "../population/monthLock";
import { userFacingErrorText } from "../storage/writeErrorText";
import { logError } from "../storage/errorLogger";
import { loadEmployeeAnswers, reopenItemAnswer } from "./answerStorage";
import {
  appendDistributionEvent,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { buildReopenedEvent } from "../distribution/distributionLog";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { appendWorkspaceAction } from "../audit/actionLog";
import { loadReopenLog, updateReopenStatus } from "../referral/referralStorage";

export type ReopenAnswerResult = { ok: true } | { ok: false; error: string };

/**
 * Mark every OTHER pending `ReopenRequest` for this exact
 * (employee, xrayImageId) as approved — the case was just reopened by some
 * other route, so a request asking for exactly that is settled, not still
 * waiting. `excludeRequestId` is the request the caller is itself about to
 * record a decision for (`approveReopen` passes its own requestId) — never
 * double-decided here.
 *
 * Best-effort and non-blocking by design: a request that fails to resolve
 * here is a stale-wait-badge annoyance, not lost work — the answer itself
 * has already been flipped by the time this runs — so a failure is logged
 * and swallowed rather than turning a successful reopen into a reported one.
 */
async function autoResolveStalePendingReopenRequests(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  employeeUsername: string;
  xrayImageId: string;
  reviewedBy: string;
  excludeRequestId?: string;
}): Promise<void> {
  const { directoryHandle, monthFolderName, employeeUsername, xrayImageId, reviewedBy, excludeRequestId } = params;
  try {
    const log = await loadReopenLog(directoryHandle, monthFolderName);
    const stale = log.requests.filter(
      (r) =>
        r.status === "pending" &&
        r.employeeUsername === employeeUsername &&
        r.xrayImageId === xrayImageId &&
        r.requestId !== excludeRequestId
    );
    for (const request of stale) {
      const result = await updateReopenStatus(directoryHandle, monthFolderName, request.requestId, {
        status: "approved",
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        reviewNotes: "تمت الموافقة تلقائيًا — تم فتح الحالة مباشرة من قبل المشرف قبل مراجعة الطلب.",
      });
      if (!result.ok) {
        logError("reopenAnswer:auto-resolve-stale-request", new Error(result.error), {
          action: "auto-resolve-stale-request",
        });
      }
    }
  } catch (error) {
    logError("reopenAnswer:auto-resolve-stale-request", error);
  }
}

export async function reopenSubmittedAnswer(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  employeeUsername: string;
  xrayImageId: string;
  reopenedBy: string;
  reopenedByRole: string;
  reason: string;
  /** The `ReopenRequest` this call is itself satisfying, when there is one —
   *  `approveReopen` passes its own requestId so step 4's auto-resolve sweep
   *  skips it (the caller records that exact decision right after this
   *  returns) and only mops up any OTHER stray pending request for the same
   *  case. Omitted by every other caller (instant self-service, a
   *  supervisor's direct reopen), which have no single request to name. */
  sourceRequestId?: string;
}): Promise<ReopenAnswerResult> {
  const {
    directoryHandle,
    monthFolderName,
    employeeUsername,
    xrayImageId,
    reopenedBy,
    reopenedByRole,
    reason,
    sourceRequestId: excludeRequestId,
  } = params;

  // 1. Closed month blocks reopen — reopen the month first (throws MonthClosedError).
  await ensureMonthWritable(directoryHandle, monthFolderName);

  // Capture previousSubmittedAt BEFORE the flip: it keys the event's
  // idempotency id. On a retry the item is already "draft" — take it from the
  // last history entry instead.
  const file = await loadEmployeeAnswers(directoryHandle, monthFolderName, employeeUsername);
  const item = file.items.find((i) => i.xrayImageId === xrayImageId);
  if (!item) {
    return { ok: false, error: "لا توجد إجابة محفوظة لهذه العينة." };
  }
  // `history` is a shared oversight trail — it also carries
  // "answered-on-behalf" entries — so "the last reopen" must be selected by
  // action, not by position. Taking the last element would read an on-behalf
  // entry's previousSubmittedAt into the reopen event's idempotency key, and
  // would make a never-reopened draft look reopenable.
  const lastHistory = [...(item.history ?? [])].reverse().find((h) => h.action === "reopened");
  const previousSubmittedAt =
    item.status === "submitted" ? item.submittedAt : (lastHistory?.previousSubmittedAt ?? null);
  if (item.status !== "submitted" && !lastHistory) {
    // Draft with no reopen history: nothing to reopen — idempotent no-op.
    // Still sweep for a pending request left stranded by an earlier direct
    // reopen this orchestrator was never told about, so a duplicate direct
    // reopen (or a request filed after the fact) closes it out too.
    await autoResolveStalePendingReopenRequests({
      directoryHandle, monthFolderName, employeeUsername, xrayImageId,
      reviewedBy: reopenedBy, excludeRequestId,
    });
    return { ok: true };
  }
  // item.status !== "submitted" with lastHistory present falls through here
  // deliberately: this is the "answer already flipped but the distribution
  // event failed" retry state (see reopenAnswer.test.ts), and steps 2-3 below
  // are exactly what still need to run — reopenItemAnswer no-ops on the
  // already-draft item, and the distribution "reopened" event append below is
  // itself idempotent (replay-guarded by sourceRequestId).

  // 2. Flip the answer (idempotent).
  const flip = await reopenItemAnswer(
    directoryHandle,
    monthFolderName,
    employeeUsername,
    xrayImageId,
    reopenedBy,
    reason
  );
  if (!flip.ok) {
    return { ok: false, error: flip.error };
  }

  // 3. If the distribution entry was completed, return it to "pending" via a
  //    replay-guarded "reopened" event. Entries whose answers were submitted
  //    without a completed event (XrayReferrals.handleSave path) skip this.
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  const current = await loadOrDeriveDistributionCurrent(
    directoryHandle,
    monthFolderName,
    sample?.rows ?? []
  );
  const entry = current?.entries.find((e) => e.xrayImageId === xrayImageId);
  if (entry?.status === "completed") {
    const sourceRequestId = `reopen-${xrayImageId}-${previousSubmittedAt ?? "unknown"}`;
    const log = await loadDistributionLog(directoryHandle, monthFolderName);
    const alreadyApplied = log.events.some((e) => e.sourceRequestId === sourceRequestId);
    if (!alreadyApplied) {
      const eventResult = await appendDistributionEvent(
        directoryHandle,
        monthFolderName,
        buildReopenedEvent({
          xrayImageId,
          assignedTo: entry.assignedTo,
          eventBy: reopenedBy,
          notes: reason,
          sourceRequestId,
        })
      );
      if (!eventResult.ok) {
        return {
          ok: false,
          error: userFacingErrorText(eventResult.error, "reopenAnswer:append-event"),
        };
      }

      // A6b: refresh the derived cache + employee sample mirrors after the
      // append, now that pure reads no longer persist them. Swallows its own
      // failure by contract.
      await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, sample?.rows ?? []);
    }
  }

  // 4. Auto-resolve any OTHER stray pending request for this exact case —
  //    see the module doc and autoResolveStalePendingReopenRequests above.
  await autoResolveStalePendingReopenRequests({
    directoryHandle, monthFolderName, employeeUsername, xrayImageId,
    reviewedBy: reopenedBy, excludeRequestId,
  });

  // 5. Audit trail (best-effort, never throws).
  void appendWorkspaceAction(directoryHandle, {
    actor: reopenedBy,
    actorRole: reopenedByRole,
    action: "answer-reopened",
    monthFolderName,
    target: xrayImageId,
    details: { employee: employeeUsername, reason },
  });

  return { ok: true };
}
