import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  appendReferralToEmployee,
  appendReopenToEmployee,
  appendReplacementToEmployee,
  loadAllEmployeeFiles,
} from "../answers/answerStorage";
import {
  appendDecisionEvent,
  effectiveDecision,
  loadAllSupervisorDecisions,
  mergeDecisionHistory,
} from "../approvals/approvalStorage";
import type {
  ReferralLog,
  ReferralRequest,
  ReferralStatus,
  ReopenLog,
  ReopenRequest,
  ReplacementLog,
  ReplacementRequest,
} from "./referralTypes";

// ── Referral requests ─────────────────────────────────────────────────────────

/** Append a referral request to the originating employee's personal file (no shared file, no conflicts). */
export async function appendReferralRequest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReferralRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendReferralToEmployee(directoryHandle, monthFolderName, request);
}

/**
 * Aggregate all employee files and supervisor decision files into a single ReferralLog.
 * Requests are joined with supervisor decisions to produce the effective status.
 */
export async function loadReferralLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReferralLog> {
  const [empFiles, allDecisions] = await Promise.all([
    loadAllEmployeeFiles(directoryHandle, monthFolderName),
    loadAllSupervisorDecisions(directoryHandle, monthFolderName),
  ]);

  const allRequests = empFiles.flatMap((f) => f.referralRequests ?? []);

  const requests = allRequests.map((r) => {
    const history = mergeDecisionHistory(allDecisions, "referral", r.requestId);
    const latest = effectiveDecision(history);
    return latest
      ? { ...r, status: latest.status, reviewedBy: latest.reviewedBy, reviewedAt: latest.reviewedAt, reviewNotes: latest.reviewNotes, history }
      : { ...r, history };
  });

  return { monthFolderName, revision: 0, requests };
}

/** Write a supervisor approval/denial to the supervisor's own decisions file. */
export async function updateReferralStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  requestId: string,
  updates: { status: ReferralStatus; reviewedBy: string; reviewedAt: string; reviewNotes?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDecisionEvent(directoryHandle, monthFolderName, updates.reviewedBy, {
    requestId,
    kind: "referral",
    status: updates.status as "approved" | "denied",
    reviewedBy: updates.reviewedBy,
    reviewedAt: updates.reviewedAt,
    reviewNotes: updates.reviewNotes,
  });
}

/** Returns the set of xrayImageIds that are currently in a pending referral from the given employee. */
export function getPendingReferralIds(log: ReferralLog, fromEmployee: string): Set<string> {
  const ids = new Set<string>();
  for (const req of log.requests) {
    if (req.fromEmployee === fromEmployee && req.status === "pending") {
      for (const id of req.xrayImageIds) ids.add(id);
    }
  }
  return ids;
}

// ── Replacement requests ──────────────────────────────────────────────────────

/** Append a replacement request to the requesting employee's personal file (no shared file, no conflicts). */
export async function appendReplacementRequest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReplacementRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendReplacementToEmployee(directoryHandle, monthFolderName, request);
}

/**
 * Aggregate all employee files and supervisor decision files into a single ReplacementLog.
 * Requests are joined with supervisor decisions to produce the effective status.
 */
export async function loadReplacementLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReplacementLog> {
  const [empFiles, allDecisions] = await Promise.all([
    loadAllEmployeeFiles(directoryHandle, monthFolderName),
    loadAllSupervisorDecisions(directoryHandle, monthFolderName),
  ]);

  const allRequests = empFiles.flatMap((f) => f.replacementRequests ?? []);

  const requests = allRequests.map((r) => {
    const history = mergeDecisionHistory(allDecisions, "replacement", r.requestId);
    const latest = effectiveDecision(history);
    return latest
      ? { ...r, status: latest.status, reviewedBy: latest.reviewedBy, reviewedAt: latest.reviewedAt, reviewNotes: latest.reviewNotes, history }
      : { ...r, history };
  });

  return { monthFolderName, revision: 0, requests };
}

/** Write a supervisor approval/denial to the supervisor's own decisions file. */
export async function updateReplacementStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  requestId: string,
  updates: { status: ReferralStatus; reviewedBy: string; reviewedAt: string; reviewNotes?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDecisionEvent(directoryHandle, monthFolderName, updates.reviewedBy, {
    requestId,
    kind: "replacement",
    status: updates.status as "approved" | "denied",
    reviewedBy: updates.reviewedBy,
    reviewedAt: updates.reviewedAt,
    reviewNotes: updates.reviewNotes,
  });
}

// ── Reopen-case requests ──────────────────────────────────────────────────────

/** Append a reopen-case request to the requesting employee's personal file (no shared file, no conflicts). */
export async function appendReopenRequest(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  request: ReopenRequest
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendReopenToEmployee(directoryHandle, monthFolderName, request);
}

/**
 * Aggregate all employee files and supervisor decision files into a single ReopenLog.
 * Requests are joined with supervisor decisions to produce the effective status.
 */
export async function loadReopenLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReopenLog> {
  const [empFiles, allDecisions] = await Promise.all([
    loadAllEmployeeFiles(directoryHandle, monthFolderName),
    loadAllSupervisorDecisions(directoryHandle, monthFolderName),
  ]);

  const allRequests = empFiles.flatMap((f) => f.reopenRequests ?? []);

  const requests = allRequests.map((r) => {
    const history = mergeDecisionHistory(allDecisions, "reopen", r.requestId);
    const latest = effectiveDecision(history);
    return latest
      ? { ...r, status: latest.status, reviewedBy: latest.reviewedBy, reviewedAt: latest.reviewedAt, reviewNotes: latest.reviewNotes, history }
      : { ...r, history };
  });

  return { monthFolderName, revision: 0, requests };
}

/** Write a supervisor approval/denial to the supervisor's own decisions file. */
export async function updateReopenStatus(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  requestId: string,
  updates: { status: ReferralStatus; reviewedBy: string; reviewedAt: string; reviewNotes?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return appendDecisionEvent(directoryHandle, monthFolderName, updates.reviewedBy, {
    requestId,
    kind: "reopen",
    status: updates.status as "approved" | "denied",
    reviewedBy: updates.reviewedBy,
    reviewedAt: updates.reviewedAt,
    reviewNotes: updates.reviewNotes,
  });
}
