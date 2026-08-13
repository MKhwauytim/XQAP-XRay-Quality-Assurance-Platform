import { describe, expect, it } from "vitest";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { planReassignment } from "./planReassignment";

/** Minimal entry — planReassignment only reads status/assignedTo/xrayImageId. */
function makeEntry(id: string, status: DistributionEntry["status"], assignedTo = "emp"): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo,
    status,
    replacedById: null,
    lastEventAt: "",
    row: { xrayImageId: id } as unknown as DistributionEntry["row"],
  };
}

// Shared eligibility planning for "إسناد لموظف آخر" — one sample, a manual
// selection, or everything matching the current filter all plan identically.

describe("planReassignment", () => {
  it("categorizes every row: eligible, or skipped with the specific reason", () => {
    const entries: DistributionEntry[] = [
      makeEntry("img-pending", "pending", "emp1"),
      makeEntry("img-completed", "completed", "emp1"),
      makeEntry("img-replaced", "replaced", "emp1"),
      makeEntry("img-already-target", "pending", "emp2"),
    ];

    const plan = planReassignment(
      entries,
      ["img-pending", "img-completed", "img-replaced", "img-already-target", "img-missing"],
      "emp2"
    );

    expect(plan.eligible).toEqual([{ xrayImageId: "img-pending", assignedTo: "emp1" }]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { xrayImageId: "img-completed", reason: "terminal-completed" },
        { xrayImageId: "img-replaced", reason: "terminal-replaced" },
        { xrayImageId: "img-already-target", reason: "already-assigned-to-target" },
        { xrayImageId: "img-missing", reason: "not-found" },
      ])
    );
    expect(plan.skipped).toHaveLength(4);
  });

  it("treats a replacement-requested row as still eligible for reassignment", () => {
    const entries: DistributionEntry[] = [makeEntry("img-1", "replacement-requested", "emp1")];
    const plan = planReassignment(entries, ["img-1"], "emp2");
    expect(plan.eligible).toEqual([{ xrayImageId: "img-1", assignedTo: "emp1" }]);
    expect(plan.skipped).toHaveLength(0);
  });
});
