/**
 * Eligibility planning for a reassignment request ("إسناد لموظف آخر").
 *
 * Distinct from `calculateBulkAssignment` in distribution/bulkAssignment.ts:
 * that performs the initial Phase-4 quota-based distribution of an unassigned
 * population. This decides which ALREADY-assigned rows may move to a chosen
 * employee, and why the rest may not.
 *
 * Shared by the dialog's preview and by `submitReassignmentRequests`, so what
 * the user is shown and what actually gets requested cannot disagree.
 */

import type { DistributionEntry } from "../distribution/distributionTypes";

export type ReassignSkipReason =
  | "not-found"
  | "terminal-completed"
  | "terminal-replaced"
  | "already-assigned-to-target";

export type ReassignSkip = { xrayImageId: string; reason: ReassignSkipReason };

export type ReassignEligibleRow = { xrayImageId: string; assignedTo: string };

export type ReassignPlan = {
  eligible: ReassignEligibleRow[];
  skipped: ReassignSkip[];
};

/**
 * Pure planning step, shared by the confirmation-dialog preview and the
 * executor below so both always agree on what will actually happen. Uses a
 * single Map lookup per id (O(n)) instead of Array#find per id (O(n×m)) —
 * this is the same category of fix applied to the per-selected-id `find()`
 * loop that used to build the referral-preview list in XrayReferrals.tsx.
 *
 * Mirrors the single-row reassignment guard in
 * `Population/useDistributionActions.ts`'s `handleReassign`: a "completed" row
 * is terminal for reassignment (the answer would be orphaned; the caller must
 * reopen it first). "replaced" is likewise terminal. A row already assigned to
 * the requested target is a no-op, reported rather than silently re-emitted.
 */
export function planReassignment(
  entries: DistributionEntry[],
  xrayImageIds: string[],
  reassignedTo: string
): ReassignPlan {
  const byId = new Map(entries.map((entry) => [entry.xrayImageId, entry]));
  const eligible: ReassignEligibleRow[] = [];
  const skipped: ReassignSkip[] = [];

  for (const xrayImageId of xrayImageIds) {
    const entry = byId.get(xrayImageId);
    if (!entry) {
      skipped.push({ xrayImageId, reason: "not-found" });
      continue;
    }
    if (entry.status === "completed") {
      skipped.push({ xrayImageId, reason: "terminal-completed" });
      continue;
    }
    if (entry.status === "replaced") {
      skipped.push({ xrayImageId, reason: "terminal-replaced" });
      continue;
    }
    if (entry.assignedTo === reassignedTo) {
      skipped.push({ xrayImageId, reason: "already-assigned-to-target" });
      continue;
    }
    eligible.push({ xrayImageId, assignedTo: entry.assignedTo });
  }

  return { eligible, skipped };
}
