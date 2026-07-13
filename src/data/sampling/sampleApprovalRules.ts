/**
 * Four-eyes sample-release rules (B1). Pure decision helpers extracted from the
 * Population Phase 3 UI so the gate logic is unit-testable:
 *
 *  - who may approve a drawn sample (supervisor/manager/admin, not the drawer —
 *    except admin, who may self-approve with a recorded warning note),
 *  - how the `SampleApproval` record is built, and
 *  - whether distribution (Phase 3 → Phase 4) is allowed for a given sample.
 *
 * Legacy/previous-session samples (no `approval` field, and `needsApproval` false
 * because they were not drawn in the current session) are treated as
 * approved-by-legacy so existing months are never bricked.
 */

import type { SampleApproval } from "./sampleTypes";

/** Roles permitted to release a drawn sample. */
const APPROVER_ROLES = new Set(["supervisor", "manager", "admin"]);

export function isSelfApproval(username: string, drawnBy: string): boolean {
  return username === drawnBy;
}

export type ApprovalEligibility =
  | { allowed: true; selfApproval: boolean }
  | { allowed: false; reason: "insufficient-role" | "self-approval-blocked" };

/**
 * May `username` (with `role`) approve a sample drawn by `drawnBy`?
 * - Non-approver roles: never.
 * - Approver role that is the drawer: only `admin` (self-approval), flagged so a
 *   warning note is recorded; supervisor/manager self-approval is blocked.
 */
export function evaluateApprovalEligibility(
  role: string,
  username: string,
  drawnBy: string
): ApprovalEligibility {
  if (!APPROVER_ROLES.has(role)) {
    return { allowed: false, reason: "insufficient-role" };
  }
  const self = isSelfApproval(username, drawnBy);
  if (self && role !== "admin") {
    return { allowed: false, reason: "self-approval-blocked" };
  }
  return { allowed: true, selfApproval: self };
}

/** Convenience boolean wrapper around {@link evaluateApprovalEligibility}. */
export function canApproveSample(role: string, username: string, drawnBy: string): boolean {
  return evaluateApprovalEligibility(role, username, drawnBy).allowed;
}

/**
 * Build the `SampleApproval` record. When it is an admin self-approval, `selfNote`
 * is recorded on the approval (9-person team reality — an explicit warning that the
 * drawer approved their own sample).
 */
export function buildSampleApproval(params: {
  approvedBy: string;
  role: string;
  drawnBy: string;
  approvedAt: string;
  selfApprovalNote: string;
}): SampleApproval {
  const self = isSelfApproval(params.approvedBy, params.drawnBy);
  return {
    approvedBy: params.approvedBy,
    approvedAt: params.approvedAt,
    role: params.role,
    ...(self ? { note: params.selfApprovalNote } : {}),
  };
}

/**
 * Persistent counterpart of the in-session `needsApproval` flag: every sample
 * drawn since the four-eyes gate shipped carries the `samplingAlgorithmVersion`
 * stamp (A2), so an unapproved new-era draw stays gated even after a reload —
 * without it, closing and reopening the tab would make a fresh draw look
 * "legacy" and bypass the gate. Legacy samples (no stamp) still pass.
 */
export function sampleRequiresApproval(sample: {
  samplingAlgorithmVersion?: string;
  approval?: SampleApproval;
}): boolean {
  return Boolean(sample.samplingAlgorithmVersion) && !sample.approval;
}

/**
 * Is the Phase 3 → Phase 4 (distribution) transition allowed for this sample?
 * - An approved sample: yes.
 * - A this-session draw awaiting approval (`needsApproval` true, no approval): no.
 * - A legacy/previous-session sample (`needsApproval` false): yes (approved-by-legacy).
 */
export function isDistributionAllowed(params: {
  approval: SampleApproval | undefined;
  needsApproval: boolean;
}): boolean {
  if (params.approval) return true;
  return !params.needsApproval;
}
