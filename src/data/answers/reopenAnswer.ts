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
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { ensureMonthWritable } from "../population/monthLock";
import { loadEmployeeAnswers, reopenItemAnswer } from "./answerStorage";
import {
  appendDistributionEvent,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../distribution/distributionStorage";
import { buildReopenedEvent } from "../distribution/distributionLog";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { appendWorkspaceAction } from "../audit/actionLog";

export type ReopenAnswerResult = { ok: true } | { ok: false; error: string };

export async function reopenSubmittedAnswer(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  employeeUsername: string;
  xrayImageId: string;
  reopenedBy: string;
  reopenedByRole: string;
  reason: string;
}): Promise<ReopenAnswerResult> {
  const {
    directoryHandle,
    monthFolderName,
    employeeUsername,
    xrayImageId,
    reopenedBy,
    reopenedByRole,
    reason,
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
  const lastHistory = item.history?.[item.history.length - 1];
  const previousSubmittedAt =
    item.status === "submitted" ? item.submittedAt : (lastHistory?.previousSubmittedAt ?? null);
  if (item.status !== "submitted" && !lastHistory) {
    // Draft with no reopen history: nothing to reopen — idempotent no-op.
    return { ok: true };
  }

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
        return { ok: false, error: eventResult.error };
      }
    }
  }

  // 4. Audit trail (best-effort, never throws).
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
