/**
 * Taking a referral / replacement / reopen decision back.
 *
 * The اعتماد الطلبات redesign decides in-page (no confirm modal) and offers an
 * "تراجع" affordance on the result toast. That undo is NOT a delete: the decision
 * event stays in the reviewer's decisions file exactly as written — B5 chain hash
 * included — and a `status: "reverted"` event naming it is APPENDED. The request
 * falls back to pending because `effectiveDecision` skips revoked decisions, not
 * because anything was rewritten.
 *
 * Two separate questions decide whether undo is offered:
 *
 * 1. Is the decision reversible in principle (`undoAvailability`)? A denial always
 *    is — denying has no side effects beyond the decision event. An approval only
 *    is for referrals, whose effect is a reassignment that a counter-reassignment
 *    undoes cleanly. An approved replacement has appended a row to the month's
 *    sample and retired the original, and an approved reopen has flipped a
 *    submitted answer back to draft that the employee may already be editing —
 *    the distribution fold has no legal transition back for either, so undo is
 *    not offered rather than silently corrupting the month.
 * 2. Is it still reversible right now (`undoDecision`'s ownership re-check)? A
 *    referral approval stops being reversible the moment the new owner starts
 *    working the samples.
 */

import { buildReassignEvent, deriveCurrentDistribution } from "../distribution/distributionLog";
import {
  appendDistributionEvents,
  loadDistributionLog,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { loadSampleMaster } from "../sampling/sampleStorage";
import {
  appendDecisionEvent,
  effectiveDecision,
  loadAllSupervisorDecisions,
  mergeDecisionHistory,
} from "../approvals/approvalStorage";
import type { DecisionEventKind, DecisionOutcome } from "../approvals/approvalTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadReferralLog, loadReopenLog, loadReplacementLog } from "./referralStorage";

/** Source-request id stamped on the counter-events an undo emits. Distinct from
 *  the approval's own `sourceRequestId` so the approval replay guard can tell a
 *  reversed transfer from an applied one. */
export function undoSourceRequestId(requestId: string): string {
  return `undo:${requestId}`;
}

export type UndoAvailability = { undoable: true } | { undoable: false; reason: string };

export type UndoResult =
  | { ok: true }
  | { ok: false; code: "not-undoable"; error: string }
  | { ok: false; code: "not-decided"; error: string }
  | { ok: false; code: "not-owner"; error: string }
  | { ok: false; code: "dist-failed"; error: string }
  | { ok: false; code: "decision-failed"; error: string };

/**
 * Whether a decision of this kind/outcome can be taken back at all. Pure — the UI
 * calls it to decide whether the toast carries an "تراجع" button, and
 * `undoDecision` re-applies it as its own first gate.
 */
export function undoAvailability(kind: DecisionEventKind, outcome: DecisionOutcome): UndoAvailability {
  if (outcome === "denied") return { undoable: true };
  if (kind === "referral") return { undoable: true };
  if (kind === "replacement") {
    return {
      undoable: false,
      reason: "لا يمكن التراجع عن استبدال معتمد — أُدرجت العينة البديلة في عينة الشهر.",
    };
  }
  return {
    undoable: false,
    reason: "لا يمكن التراجع عن إعادة فتح معتمدة — عادت الإجابة إلى المسودة وقد يكون الموظف بدأ تعديلها.",
  };
}

/** Distribution events belonging to one referral request, forward and undo alike,
 *  in fold order. */
function requestReassignEvents(events: DistributionEvent[], requestId: string): DistributionEvent[] {
  const undoId = undoSourceRequestId(requestId);
  return events
    .filter(
      (event) =>
        event.eventType === "reassigned" &&
        (event.sourceRequestId === requestId || event.sourceRequestId === undoId)
    )
    .sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId));
}

/**
 * The ids of `xrayImageIds` whose LAST reassignment for this request is the
 * forward transfer — i.e. the transfer is currently in effect. Shared with
 * `approveReferral`'s replay guard so that re-approving a request that was
 * approved, undone, and left pending again re-emits the transfer instead of
 * assuming the original events still stand.
 */
export function idsWithTransferApplied(params: {
  events: DistributionEvent[];
  requestId: string;
  xrayImageIds: string[];
  toEmployee: string;
}): Set<string> {
  const lastForId = new Map<string, DistributionEvent>();
  for (const event of requestReassignEvents(params.events, params.requestId)) {
    lastForId.set(event.xrayImageId, event);
  }
  const applied = new Set<string>();
  for (const id of params.xrayImageIds) {
    const last = lastForId.get(id);
    if (last && last.sourceRequestId === params.requestId && last.reassignedTo === params.toEmployee) {
      applied.add(id);
    }
  }
  return applied;
}

/**
 * Take back the caller's own decision on a request.
 *
 * Only the reviewer whose decision is currently authoritative may undo it — a
 * revocation written by anyone else would name a decision in a file they do not
 * own and would revoke nothing (see `revokedDecisionKeys`), so it is rejected up
 * front rather than written as a silent no-op.
 */
export async function undoDecision(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  kind: DecisionEventKind;
  requestId: string;
  reviewedBy: string;
}): Promise<UndoResult> {
  const { directoryHandle, monthFolderName, kind, requestId, reviewedBy } = params;

  const decisions = await loadAllSupervisorDecisions(directoryHandle, monthFolderName);
  const winner = effectiveDecision(mergeDecisionHistory(decisions, kind, requestId));
  if (!winner) {
    return { ok: false, code: "not-decided", error: "لم يعد هناك قرار قائم على هذا الطلب." };
  }
  if (winner.reviewedBy !== reviewedBy) {
    return { ok: false, code: "not-owner", error: "لا يمكن التراجع عن قرار سجّله مراجع آخر." };
  }

  const availability = undoAvailability(kind, winner.status);
  if (!availability.undoable) {
    return { ok: false, code: "not-undoable", error: availability.reason };
  }

  // An approved referral moved samples; put them back before revoking the
  // decision. Order matters: if the revocation write fails the transfer is
  // already reversed, and a retry finds nothing left to reverse and proceeds
  // straight to the revocation.
  if (kind === "referral" && winner.status === "approved") {
    const reversal = await reverseReferralTransfer({
      directoryHandle,
      monthFolderName,
      requestId,
      reviewedBy,
    });
    if (!reversal.ok) return reversal;
  }

  const appended = await appendDecisionEvent(directoryHandle, monthFolderName, reviewedBy, {
    requestId,
    kind,
    status: "reverted",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    revokesDecisionAt: winner.reviewedAt,
  });
  return appended.ok ? { ok: true } : { ok: false, code: "decision-failed", error: appended.error };
}

async function reverseReferralTransfer(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
}): Promise<{ ok: true } | Extract<UndoResult, { ok: false }>> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy } = params;

  const log = await loadReferralLog(directoryHandle, monthFolderName);
  const request = log.requests.find((r) => r.requestId === requestId);
  if (!request) {
    return { ok: false, code: "not-decided", error: "تعذر إيجاد الطلب في سجل الشهر." };
  }
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return { ok: false, code: "dist-failed", error: "تعذر تحميل ملف العينة للتراجع عن الإحالة." };
  }

  const distLog = await loadDistributionLog(directoryHandle, monthFolderName);
  const applied = idsWithTransferApplied({
    events: distLog.events,
    requestId,
    xrayImageIds: request.xrayImageIds,
    toEmployee: request.toEmployee,
  });
  if (applied.size === 0) return { ok: true }; // already reversed by an earlier attempt

  // The transfer is only reversible while the new owner has not started working:
  // a submitted / replaced / reopened sample carries state the counter-reassignment
  // would strand with the wrong employee.
  const current = deriveCurrentDistribution(distLog, sample.rows);
  const notReversible = [...applied].filter((id) => {
    const entry = current.entries.find((candidate) => candidate.xrayImageId === id);
    return !entry || entry.assignedTo !== request.toEmployee || entry.status !== "pending";
  });
  if (notReversible.length > 0) {
    return {
      ok: false,
      code: "dist-failed",
      error: `تعذر التراجع: بدأ العمل على العينات التالية بعد الإحالة — ${notReversible.join("، ")}`,
    };
  }

  const events = [...applied].map((id) =>
    buildReassignEvent({
      xrayImageId: id,
      assignedTo: request.toEmployee,
      reassignedTo: request.fromEmployee,
      eventBy: reviewedBy,
      notes: `تراجع عن اعتماد الإحالة — ${request.reason}`,
      sourceRequestId: undoSourceRequestId(requestId),
    })
  );
  const appended = await appendDistributionEvents(directoryHandle, monthFolderName, events);
  if (!appended.ok) return { ok: false, code: "dist-failed", error: appended.error };

  await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, sample.rows);
  return { ok: true };
}

/** Kind-agnostic freshness probe: the effective status a request currently
 *  carries, or undefined when it is not in the month's logs at all. */
export async function loadDecidedRequestStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  kind: DecisionEventKind,
  requestId: string
): Promise<"pending" | "approved" | "denied" | undefined> {
  const log =
    kind === "referral"
      ? await loadReferralLog(directoryHandle, monthFolderName)
      : kind === "replacement"
        ? await loadReplacementLog(directoryHandle, monthFolderName)
        : await loadReopenLog(directoryHandle, monthFolderName);
  return log.requests.find((r) => r.requestId === requestId)?.status;
}
