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
import type { SupervisorDecisionFile } from "../approvals/approvalTypes";
import { dedupeInFlight, workspaceScopeId, workspaceEpoch } from "../storage/inFlightReads";
import type {
  ReferralLog,
  ReferralRequest,
  ReferralStatus,
  ReopenLog,
  ReopenRequest,
  ReplacementLog,
  ReplacementRequest,
} from "./referralTypes";
import type { EmployeeAnswerFile } from "../answers/answerTypes";

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
 * One shared scan backing all three request logs (referral, replacement,
 * reopen) for a month — A4. Previously each of `loadReferralLog` /
 * `loadReplacementLog` / `loadReopenLog` independently re-scanned both the
 * per-employee answers directory and the per-supervisor decisions directory
 * (six directory scans for three concurrent callers instead of two). This
 * performs the two underlying scans exactly once and folds all three kinds
 * from that single pair of results.
 *
 * Wrapped in `dedupeInFlight` (mirroring `loadDistributionLogForRead` in
 * `distributionStorage.ts`) so concurrent per-kind callers within one load
 * pass — e.g. `Promise.all([loadReferralLog, loadReplacementLog,
 * loadReopenLog])` — share a single underlying scan rather than each
 * delegating export independently awaiting its own copy.
 *
 * Failure-domain note: `loadAllEmployeeFiles` and `loadAllSupervisorDecisions`
 * already degrade independently to `[]` on their own read/list failure, and
 * each uses `onUnreadable: "skip"` internally so one corrupt file only drops
 * that file. Calling them once here and reusing the result for all three
 * kinds does not collapse that — the per-file skip behaviour lives inside
 * `readJsonDirectory`, not in how many times the caller invokes these
 * functions.
 */
export async function loadRequestLogs(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<{ referrals: ReferralLog; replacements: ReplacementLog; reopens: ReopenLog }> {
  const key = `${workspaceScopeId(directoryHandle)}|${monthFolderName}|${workspaceEpoch(directoryHandle, monthFolderName)}|request-logs`;
  return dedupeInFlight(key, async () => {
    const [empFiles, allDecisions] = await Promise.all([
      loadAllEmployeeFiles(directoryHandle, monthFolderName),
      loadAllSupervisorDecisions(directoryHandle, monthFolderName),
    ]);

    return {
      referrals: buildLog(monthFolderName, empFiles, allDecisions, "referral", (f) => f.referralRequests ?? []),
      replacements: buildLog(monthFolderName, empFiles, allDecisions, "replacement", (f) => f.replacementRequests ?? []),
      reopens: buildLog(monthFolderName, empFiles, allDecisions, "reopen", (f) => f.reopenRequests ?? []),
    };
  });
}

function buildLog<TRequest extends { requestId: string }>(
  monthFolderName: string,
  empFiles: EmployeeAnswerFile[],
  allDecisions: SupervisorDecisionFile[],
  kind: "referral" | "replacement" | "reopen",
  pick: (f: EmployeeAnswerFile) => TRequest[]
): { monthFolderName: string; revision: number; requests: TRequest[] } {
  const allRequests = empFiles.flatMap(pick);

  const requests = allRequests.map((r) => {
    const history = mergeDecisionHistory(allDecisions, kind, r.requestId);
    const latest = effectiveDecision(history);
    // Cast is safe: TRequest is instantiated per-call-site to the concrete
    // request type matching `kind` (referral/replacement/reopen), all of
    // which share `status`/`reviewedBy`/`reviewedAt`/`reviewNotes`/`history`
    // as (optional) fields — the generic bound just can't express that.
    return (latest
      ? { ...r, status: latest.status, reviewedBy: latest.reviewedBy, reviewedAt: latest.reviewedAt, reviewNotes: latest.reviewNotes, history }
      : { ...r, history }) as TRequest;
  });

  return { monthFolderName, revision: 0, requests };
}

/**
 * Aggregate all employee files and supervisor decision files into a single ReferralLog.
 * Requests are joined with supervisor decisions to produce the effective status.
 *
 * Thin delegating wrapper over `loadRequestLogs` (A4) — kept for callers that
 * only need one kind; error handling and return shape are unchanged.
 */
export async function loadReferralLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReferralLog> {
  const { referrals } = await loadRequestLogs(directoryHandle, monthFolderName);
  return referrals;
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

/** Returns the set of xrayImageIds (the ORIGINAL, being-replaced id) that are
 *  currently in a pending replacement request from the given employee. */
export function getPendingReplacementIds(log: ReplacementLog, employeeUsername: string): Set<string> {
  const ids = new Set<string>();
  for (const req of log.requests) {
    if (req.employeeUsername === employeeUsername && req.status === "pending") {
      ids.add(req.originalXrayImageId);
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
 *
 * Thin delegating wrapper over `loadRequestLogs` (A4) — error handling and
 * return shape are unchanged.
 */
export async function loadReplacementLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReplacementLog> {
  const { replacements } = await loadRequestLogs(directoryHandle, monthFolderName);
  return replacements;
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
 *
 * Thin delegating wrapper over `loadRequestLogs` (A4) — error handling and
 * return shape are unchanged.
 */
export async function loadReopenLog(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<ReopenLog> {
  const { reopens } = await loadRequestLogs(directoryHandle, monthFolderName);
  return reopens;
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
