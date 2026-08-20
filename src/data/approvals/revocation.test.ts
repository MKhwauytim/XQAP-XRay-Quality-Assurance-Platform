import { describe, expect, it } from "vitest";
import { effectiveDecision, revokedDecisionKeys } from "./approvalStorage";
import type { DecisionEvent } from "./approvalTypes";

function decision(overrides: Partial<DecisionEvent> & Pick<DecisionEvent, "reviewedBy" | "reviewedAt">): DecisionEvent {
  return {
    requestId: "req-1",
    kind: "referral",
    status: "approved",
    ...overrides,
  };
}

/** mergeDecisionHistory hands `effectiveDecision` an oldest→newest list. */
function history(...events: DecisionEvent[]): DecisionEvent[] {
  return events.slice().sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

describe("effectiveDecision with revocations", () => {
  it("is still first-wins when nothing has been taken back", () => {
    const first = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:00:00.000Z" });
    const second = decision({ reviewedBy: "sup2", reviewedAt: "2026-05-01T11:00:00.000Z", status: "denied" });
    expect(effectiveDecision(history(second, first))).toBe(first);
  });

  it("returns undefined once the only decision is revoked — the request is pending again", () => {
    const first = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:00:00.000Z" });
    const revert = decision({
      reviewedBy: "sup1",
      reviewedAt: "2026-05-01T10:05:00.000Z",
      status: "reverted",
      revokesDecisionAt: first.reviewedAt,
    });
    expect(effectiveDecision(history(first, revert))).toBeUndefined();
  });

  it("hands ownership to the next standing decision when the earliest one is revoked", () => {
    const first = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:00:00.000Z" });
    const second = decision({ reviewedBy: "sup2", reviewedAt: "2026-05-01T11:00:00.000Z", status: "denied" });
    const revert = decision({
      reviewedBy: "sup1",
      reviewedAt: "2026-05-01T12:00:00.000Z",
      status: "reverted",
      revokesDecisionAt: first.reviewedAt,
    });
    expect(effectiveDecision(history(first, second, revert))).toBe(second);
  });

  it("only revokes a decision from the same reviewer — a revocation cannot reach another reviewer's file", () => {
    const first = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:00:00.000Z" });
    const foreignRevert = decision({
      reviewedBy: "sup2",
      reviewedAt: "2026-05-01T11:00:00.000Z",
      status: "reverted",
      revokesDecisionAt: first.reviewedAt,
    });
    expect(effectiveDecision(history(first, foreignRevert))).toBe(first);
    expect(revokedDecisionKeys(history(first, foreignRevert))).toEqual(new Set(["sup2|2026-05-01T10:00:00.000Z"]));
  });

  it("never returns a revocation marker as the outcome", () => {
    const revert = decision({
      reviewedBy: "sup1",
      reviewedAt: "2026-05-01T10:00:00.000Z",
      status: "reverted",
      revokesDecisionAt: "2026-04-30T10:00:00.000Z",
    });
    expect(effectiveDecision(history(revert))).toBeUndefined();
  });

  it("supports a decide → undo → decide cycle, the second decision standing", () => {
    const first = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:00:00.000Z" });
    const revert = decision({
      reviewedBy: "sup1",
      reviewedAt: "2026-05-01T10:05:00.000Z",
      status: "reverted",
      revokesDecisionAt: first.reviewedAt,
    });
    const again = decision({ reviewedBy: "sup1", reviewedAt: "2026-05-01T10:10:00.000Z", status: "denied" });
    expect(effectiveDecision(history(first, revert, again))).toBe(again);
  });
});
