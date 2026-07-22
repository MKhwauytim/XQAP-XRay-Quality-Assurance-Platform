/**
 * Referral / replacement approval domain logic (Tier-1 Item C).
 *
 * Extracted from ReferralApproval.tsx so the idempotency contract is testable;
 * the React handlers are thin wrappers that map result codes to labels.
 *
 * Contract for approvals:
 * 1. Re-load fresh request state — never trust the rendered list. A request
 *    that is no longer "pending" returns `already-reviewed`.
 * 2. Replay guard: compare request ids per sample against persisted reassignment
 *    events. A complete transfer skips re-emission; a partial immutable-file
 *    batch resumes only the missing ids. This runs BEFORE ownership checks because
 *    ownership has already moved for successfully persisted ids.
 * 3. Ownership check (only for events still to emit): every missing id must remain
 *    assigned to the requesting employee in an active state — otherwise abort
 *    without auto-denying the request.
 * 4. Missing events are appended in one appendDistributionEvents call. Each event
 *    is independently durable, so the post-append fold verifies the entire request
 *    before the decision is recorded. A decision-write failure remains retriable.
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
import { buildReassignEvent, deriveCurrentDistribution } from "../distribution/distributionLog";
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

  // 2. Replay guard (before ownership — see module docblock). Immutable event
  //    files are written individually, so an interrupted batch can be partial;
  //    track replay state per sample rather than treating one event as the
  //    completion of the whole request.
  const distLog = await loadDistributionLog(directoryHandle, monthFolderName);
  const appliedIds = new Set(
    distLog.events
      .filter(
        (event) =>
          event.sourceRequestId === fresh.requestId &&
          event.eventType === "reassigned" &&
          event.reassignedTo === fresh.toEmployee
      )
      .map((event) => event.xrayImageId)
  );
  const missingIds = fresh.xrayImageIds.filter((id) => !appliedIds.has(id));
  const alreadyApplied = missingIds.length === 0;
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  if (!sample) {
    return { ok: false, code: "invalid-request", error: "تعذر تحميل ملف العينة للتحقق من الإحالة." };
  }

  if (!alreadyApplied) {
    // 3. Ownership check — all-or-nothing.
    // Validate against the event log loaded above, which is the source of truth.
    // distribution.current.json is only a rebuildable cache and can be stale even
    // when its revision metadata happens to match (for example after a restored or
    // manually copied workspace). Trusting it here made approval fail while denial,
    // which does not inspect distribution state, continued to work.
    const current = deriveCurrentDistribution(distLog, sample.rows);
    const notOwned = missingIds.filter((id) => {
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

    // 4. Append the missing batch; every event carries the request id.
    const events = missingIds.map((id) =>
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

  // Do not record an approved decision unless replaying all persisted events
  // actually produces the complete requested ownership transfer. This also
  // verifies the no-append replay path after an earlier decision-write failure.
  const persistedLog = await loadDistributionLog(directoryHandle, monthFolderName);
  const persistedCurrent = deriveCurrentDistribution(persistedLog, sample.rows);
  const notTransferred = fresh.xrayImageIds.filter((id) => {
    const entry = persistedCurrent.entries.find((candidate) => candidate.xrayImageId === id);
    return !entry || entry.assignedTo !== fresh.toEmployee || entry.status !== "pending";
  });
  if (notTransferred.length > 0) {
    return {
      ok: false,
      code: "dist-failed",
      error: `تعذر التحقق من نقل العينات التالية: ${notTransferred.join("، ")}`,
    };
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
