import { describe, expect, test } from "vitest";

import {
  buildSampleApproval,
  canApproveSample,
  evaluateApprovalEligibility,
  isDistributionAllowed,
  isSelfApproval,
  sampleRequiresApproval,
} from "./sampleApprovalRules";

describe("sampleApprovalRules (B1 four-eyes gate)", () => {
  describe("sampleRequiresApproval — reload-safe persistent gate", () => {
    const approval = { approvedBy: "sara", approvedAt: "2026-07-14T00:00:00Z", role: "supervisor" };

    test("a new-era sample (algorithm version stamped) without approval requires one", () => {
      expect(sampleRequiresApproval({ samplingAlgorithmVersion: "1.0" })).toBe(true);
    });

    test("a new-era sample WITH approval does not", () => {
      expect(sampleRequiresApproval({ samplingAlgorithmVersion: "1.0", approval })).toBe(false);
    });

    test("a legacy sample (no version stamp) never requires approval", () => {
      expect(sampleRequiresApproval({})).toBe(false);
      expect(sampleRequiresApproval({ approval })).toBe(false);
    });
  });

  describe("evaluateApprovalEligibility — non-drawer rule", () => {
    test("a supervisor who is NOT the drawer may approve", () => {
      const r = evaluateApprovalEligibility("supervisor", "sara", "omar");
      expect(r).toEqual({ allowed: true, selfApproval: false });
    });

    test("a manager who is NOT the drawer may approve", () => {
      expect(canApproveSample("manager", "sara", "omar")).toBe(true);
    });

    test("a supervisor who IS the drawer is blocked (needs a second person)", () => {
      const r = evaluateApprovalEligibility("supervisor", "omar", "omar");
      expect(r).toEqual({ allowed: false, reason: "self-approval-blocked" });
      expect(canApproveSample("supervisor", "omar", "omar")).toBe(false);
    });

    test("a manager who IS the drawer is blocked", () => {
      expect(evaluateApprovalEligibility("manager", "omar", "omar")).toEqual({
        allowed: false,
        reason: "self-approval-blocked",
      });
    });

    test("an employee/guest may never approve", () => {
      expect(evaluateApprovalEligibility("employee", "sara", "omar")).toEqual({
        allowed: false,
        reason: "insufficient-role",
      });
      expect(canApproveSample("guest", "sara", "omar")).toBe(false);
    });

    test("admin MAY self-approve, flagged as a self-approval", () => {
      const r = evaluateApprovalEligibility("admin", "omar", "omar");
      expect(r).toEqual({ allowed: true, selfApproval: true });
    });

    test("admin approving someone else's sample is allowed and not self", () => {
      expect(evaluateApprovalEligibility("admin", "admin", "omar")).toEqual({
        allowed: true,
        selfApproval: false,
      });
    });
  });

  describe("buildSampleApproval — self-approve note", () => {
    test("records a warning note ONLY on an admin self-approval", () => {
      const approval = buildSampleApproval({
        approvedBy: "admin",
        role: "admin",
        drawnBy: "admin",
        approvedAt: "2026-07-14T10:00:00.000Z",
        selfApprovalNote: "self-approve-warning",
      });
      expect(approval).toEqual({
        approvedBy: "admin",
        role: "admin",
        approvedAt: "2026-07-14T10:00:00.000Z",
        note: "self-approve-warning",
      });
    });

    test("no note when a different person approves", () => {
      const approval = buildSampleApproval({
        approvedBy: "sara",
        role: "supervisor",
        drawnBy: "omar",
        approvedAt: "2026-07-14T10:00:00.000Z",
        selfApprovalNote: "unused",
      });
      expect(approval.note).toBeUndefined();
      expect(isSelfApproval(approval.approvedBy, "omar")).toBe(false);
    });
  });

  describe("isDistributionAllowed — legacy-approved & gate", () => {
    test("legacy/previous-session sample (needsApproval=false, no approval) is distributable", () => {
      expect(isDistributionAllowed({ approval: undefined, needsApproval: false })).toBe(true);
    });

    test("this-session draw awaiting approval is blocked", () => {
      expect(isDistributionAllowed({ approval: undefined, needsApproval: true })).toBe(false);
    });

    test("an approved sample is always distributable", () => {
      const approval = {
        approvedBy: "sara",
        approvedAt: "2026-07-14T10:00:00.000Z",
        role: "supervisor",
      };
      expect(isDistributionAllowed({ approval, needsApproval: true })).toBe(true);
      expect(isDistributionAllowed({ approval, needsApproval: false })).toBe(true);
    });
  });
});
