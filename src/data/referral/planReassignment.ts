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
 * Target-independent half of the eligibility rule: can this row move at all?
 *
 * Split out of `planReassignment` so the selection bar can count exactly what
 * a click will request *before* a target employee has been chosen. The bar
 * shows these counts on its buttons, so any drift between this predicate and
 * the loop below would put a number on screen that the submit path then
 * quietly reduces — which is precisely the "the buttons don't work great"
 * complaint. `planReassignment` calls it rather than repeating the checks.
 *
 * `already-assigned-to-target` is deliberately NOT here: it needs a target, so
 * it can only be reported once one is picked (the dialog does that).
 */
export function reassignBlockedReason(
  entry: Pick<DistributionEntry, "status">
): Extract<ReassignSkipReason, "terminal-completed" | "terminal-replaced"> | null {
  if (entry.status === "completed") return "terminal-completed";
  if (entry.status === "replaced") return "terminal-replaced";
  return null;
}

/** Convenience wrapper for the counting call sites. */
export function isReassignEligible(entry: Pick<DistributionEntry, "status">): boolean {
  return reassignBlockedReason(entry) === null;
}

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
    const blocked = reassignBlockedReason(entry);
    if (blocked) {
      skipped.push({ xrayImageId, reason: blocked });
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
