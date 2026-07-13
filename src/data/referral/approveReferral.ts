/**
 * Referral / replacement approval domain logic (Tier-1 Item C).
 *
 * Extracted from ReferralApproval.tsx so the idempotency contract is testable;
 * the React handlers are thin wrappers that map result codes to labels.
 *
 * Contract for approvals:
 * 1. Re-load fresh request state — never trust the rendered list. A request
 *    that is no longer "pending" returns `already-reviewed`.
 * 2. Replay guard: if the distribution log already contains events stamped
 *    with this request's `sourceRequestId`, the transfer ALREADY happened —
 *    skip re-emission and go straight to recording the decision. (This must
 *    run BEFORE the ownership check: after the events apply, ownership has
 *    moved, and a retry following a decision-write failure would otherwise
 *    abort forever.)
 * 3. Ownership check (only when events are about to be emitted): every id
 *    must still be assigned to the requesting employee in an active state —
 *    otherwise abort ALL (atomic semantics), no auto-deny.
 * 4. Events are appended in ONE call (atomic within the log). A decision-write
 *    failure afterwards is retriable: the replay guard prevents double-apply.
 *
 * MonthClosedError from the storage gates propagates to the caller.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
  loadOrDeriveDistributionCurrent,
} from "../distribution/distributionStorage";
import { buildReassignEvent } from "../distribution/distributionLog";
import { executeReplacement } from "../distribution/replacement";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { reopenSubmittedAnswer } from "../answers/reopenAnswer";
import {
  effectiveDecision,
  loadAllSupervisorDecisions,
  mergeDecisionHistory,
} from "../approvals/approvalStorage";
import {
  loadReferralLog,
  loadReopenLog,
  loadReplacementLog,
  updateReferralStatus,
  updateReopenStatus,
  updateReplacementStatus,
} from "./referralStorage";

export type ApprovalResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; code: "already-reviewed" }
  | { ok: false; code: "stale-ownership"; staleIds: string[] }
  | { ok: false; code: "dist-failed"; error: string }
  | { ok: false; code: "decision-failed"; error: string }
  | { ok: false; code: "invalid-request"; error: string };

export type DenyResult =
  | { ok: true }
  | { ok: false; code: "already-reviewed" }
  | { ok: false; code: "decision-failed"; error: string };

export async function approveReferral(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewNotes?: string;
}): Promise<ApprovalResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewNotes } = params;

  // 1. Fresh state — never trust the rendered list.
  const freshLog = await loadReferralLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  // 2. Replay guard (before ownership — see module docblock).
  const distLog = await loadDistributionLog(directoryHandle, monthFolderName);
  const alreadyApplied = distLog.events.some((e) => e.sourceRequestId === fresh.requestId);

  if (!alreadyApplied) {
    // 3. Ownership check — all-or-nothing.
    const sample = await loadSampleMaster(directoryHandle, monthFolderName);
    const current = await loadOrDeriveDistributionCurrent(
      directoryHandle,
      monthFolderName,
      sample?.rows ?? []
    );
    const notOwned = fresh.xrayImageIds.filter((id) => {
      const entry = current?.entries.find((e) => e.xrayImageId === id);
      return (
        !entry ||
        entry.assignedTo !== fresh.fromEmployee ||
        (entry.status !== "pending" && entry.status !== "replacement-requested")
      );
    });
    if (notOwned.length > 0) {
      return { ok: false, code: "stale-ownership", staleIds: notOwned };
    }

    // 4. One append = atomic within the log; every event carries the request id.
    const events = fresh.xrayImageIds.map((id) =>
      buildReassignEvent({
        xrayImageId: id,
        assignedTo: fresh.fromEmployee,
        reassignedTo: fresh.toEmployee,
        eventBy: reviewedBy,
        notes: `إحالة من ${fresh.fromEmployee} — ${fresh.reason}`,
        sourceRequestId: fresh.requestId,
      })
    );
    const distResult = await appendDistributionEvents(directoryHandle, monthFolderName, events);
    if (!distResult.ok) {
      return { ok: false, code: "dist-failed", error: distResult.error };
    }
  }

  // 5a. Cross-reviewer guard. Decisions live in per-supervisor files, so step 1's
  //     merged view can miss a decision another reviewer wrote on a different
  //     machine between our load and now. Re-scan EVERY reviewer's file right
  //     before persisting; if any decision for this request already exists, abort.
  const priorDecisions = mergeDecisionHistory(
    await loadAllSupervisorDecisions(directoryHandle, monthFolderName),
    "referral",
    requestId
  );
  if (priorDecisions.length > 0) {
    return { ok: false, code: "already-reviewed" };
  }

  // 5b. Record the decision. On failure the caller retries; step 2 skips re-emission.
  const updateResult = await updateReferralStatus(directoryHandle, monthFolderName, requestId, {
    status: "approved",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  if (!updateResult.ok) {
    return { ok: false, code: "decision-failed", error: updateResult.error };
  }

  // 5c. First-wins reconciliation. Another reviewer's earlier decision may have
  //     landed concurrently (each writes its own file, so 5a can still miss it).
  //     Re-scan; if the authoritative (earliest) decision is not ours, surface a
  //     conflict instead of reporting our write as the outcome.
  const winner = effectiveDecision(
    mergeDecisionHistory(
      await loadAllSupervisorDecisions(directoryHandle, monthFolderName),
      "referral",
      requestId
    )
  );
  if (winner && winner.reviewedBy !== reviewedBy) {
    return { ok: false, code: "already-reviewed" };
  }

  return { ok: true, alreadyApplied };
}

export async function denyReferral(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewNotes?: string;
}): Promise<DenyResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewNotes } = params;

  const freshLog = await loadReferralLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  const result = await updateReferralStatus(directoryHandle, monthFolderName, requestId, {
    status: "denied",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  return result.ok ? { ok: true } : { ok: false, code: "decision-failed", error: result.error };
}

export async function approveReplacement(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewNotes?: string;
}): Promise<ApprovalResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewNotes } = params;

  // 1. Fresh state.
  const freshLog = await loadReplacementLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  // 2. Replay guard (before ownership — the original is "replaced" after apply).
  const distLog = await loadDistributionLog(directoryHandle, fresh.monthFolderName);
  const alreadyApplied = distLog.events.some((e) => e.sourceRequestId === fresh.requestId);

  if (!alreadyApplied) {
    // Resolve the replacement row from the population (reference, not copy);
    // legacy requests fall back to the stored row data.
    let replacementRow: PreparedPopulationRow | null = null;
    try {
      const population = await loadMonthPopulationFinal(directoryHandle, fresh.monthFolderName);
      replacementRow =
        ((population?.rows ?? []).find(
          (r) => (r as PreparedPopulationRow).xrayImageId === fresh.replacementXrayImageId
        ) as PreparedPopulationRow | undefined) ?? null;
    } catch {
      // Fall through to the legacy path below.
    }
    if (!replacementRow && fresh.replacementRowData) {
      replacementRow = fresh.replacementRowData as unknown as PreparedPopulationRow;
    }
    if (!replacementRow) {
      return { ok: false, code: "invalid-request", error: "تعذر إيجاد بيانات سطر البديل في مجتمع الشهر." };
    }

    const sample = await loadSampleMaster(directoryHandle, fresh.monthFolderName);
    if (!sample) {
      return { ok: false, code: "invalid-request", error: "تعذر تحميل ملف العينة للتحقق من الاستبدال." };
    }

    // 3. Ownership check on the original sample.
    const current = await loadOrDeriveDistributionCurrent(
      directoryHandle,
      fresh.monthFolderName,
      sample.rows
    );
    const deadEntry = current?.entries.find(
      (entry) =>
        entry.xrayImageId === fresh.originalXrayImageId &&
        entry.assignedTo === fresh.employeeUsername &&
        (entry.status === "pending" || entry.status === "replacement-requested")
    );
    if (!deadEntry) {
      return { ok: false, code: "stale-ownership", staleIds: [fresh.originalXrayImageId] };
    }

    // 4. Execute (sample append is idempotent; events carry the request id).
    const result = await executeReplacement({
      directoryHandle,
      monthFolderName: fresh.monthFolderName,
      deadEntry,
      replacementRow,
      reason: `استبدال معتمد — ${fresh.reason}`,
      eventBy: reviewedBy,
      sourceRequestId: fresh.requestId,
    });
    if (!result.ok) {
      return { ok: false, code: "dist-failed", error: result.error };
    }
  }

  // 5. Record the decision (retriable — see approveReferral).
  const updateResult = await updateReplacementStatus(directoryHandle, monthFolderName, requestId, {
    status: "approved",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  if (!updateResult.ok) {
    return { ok: false, code: "decision-failed", error: updateResult.error };
  }

  return { ok: true, alreadyApplied };
}

export async function denyReplacement(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewNotes?: string;
}): Promise<DenyResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewNotes } = params;

  const freshLog = await loadReplacementLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  const result = await updateReplacementStatus(directoryHandle, monthFolderName, requestId, {
    status: "denied",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  return result.ok ? { ok: true } : { ok: false, code: "decision-failed", error: result.error };
}

export async function approveReopen(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewedByRole: string;
  reviewNotes?: string;
}): Promise<ApprovalResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewedByRole, reviewNotes } = params;

  // 1. Fresh state — never trust the rendered list.
  const freshLog = await loadReopenLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  // 2. Apply the reopen. reopenSubmittedAnswer is idempotent (answer flip no-ops
  //    once draft) and replay-guards its own "reopened" distribution event, so a
  //    retry after a decision-write failure never double-applies.
  const applied = await reopenSubmittedAnswer({
    directoryHandle,
    monthFolderName: fresh.monthFolderName,
    employeeUsername: fresh.employeeUsername,
    xrayImageId: fresh.xrayImageId,
    reopenedBy: reviewedBy,
    reopenedByRole: reviewedByRole,
    reason: fresh.reason,
  });
  if (!applied.ok) {
    return { ok: false, code: "dist-failed", error: applied.error };
  }

  // 3. Record the decision. On failure the caller retries; step 2 is idempotent.
  const updateResult = await updateReopenStatus(directoryHandle, monthFolderName, requestId, {
    status: "approved",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  if (!updateResult.ok) {
    return { ok: false, code: "decision-failed", error: updateResult.error };
  }

  return { ok: true, alreadyApplied: false };
}

export async function denyReopen(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  requestId: string;
  reviewedBy: string;
  reviewNotes?: string;
}): Promise<DenyResult> {
  const { directoryHandle, monthFolderName, requestId, reviewedBy, reviewNotes } = params;

  const freshLog = await loadReopenLog(directoryHandle, monthFolderName);
  const fresh = freshLog.requests.find((r) => r.requestId === requestId);
  if (!fresh || fresh.status !== "pending") {
    return { ok: false, code: "already-reviewed" };
  }

  const result = await updateReopenStatus(directoryHandle, monthFolderName, requestId, {
    status: "denied",
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reviewNotes?.trim() || undefined,
  });
  return result.ok ? { ok: true } : { ok: false, code: "decision-failed", error: result.error };
}
