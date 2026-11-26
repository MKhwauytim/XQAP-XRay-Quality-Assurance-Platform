import { describe, expect, it } from "vitest";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import { isCompletedOnShare } from "./subComponents";

const entry = (status: DistributionEntry["status"] = "pending") =>
  ({ xrayImageId: "X1", assignedTo: "emp1", status }) as DistributionEntry;

const answers = (status: ItemAnswer["status"]) =>
  new Map([["X1::emp1", { xrayImageId: "X1", answeredBy: "emp1", status } as ItemAnswer]]);

describe("isCompletedOnShare", () => {
  it("paints a submitted answer that reached the shared folder completed", () => {
    expect(isCompletedOnShare(entry(), answers("submitted"), new Set())).toBe(true);
  });

  it("does not paint a submission still queued on this device completed", () => {
    expect(isCompletedOnShare(entry(), answers("submitted"), new Set(["X1::emp1"]))).toBe(false);
  });

  it("keeps a supervisor-completed row completed whatever this device holds", () => {
    expect(isCompletedOnShare(entry("completed"), answers("draft"), new Set(["X1::emp1"]))).toBe(true);
  });

  it("does not paint a draft completed", () => {
    expect(isCompletedOnShare(entry(), answers("draft"), new Set())).toBe(false);
  });
});
