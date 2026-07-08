import { describe, it, expect } from "vitest";
import { assertRequestPending, assertSamplesOwnedBy } from "./approvalGuards";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";

const stubRow = {} as unknown as PreparedPopulationRow;

const distribution: DistributionCurrentData = {
  monthFolderName: "5-may-2026",
  derivedAt: "2026-07-01T00:00:00.000Z",
  totalAssigned: 2,
  totalCompleted: 0,
  totalReplaced: 0,
  totalPending: 2,
  entries: [
    { xrayImageId: "img-1", assignedTo: "alice", status: "pending", replacedById: null, lastEventAt: "2026-07-01T00:00:00.000Z", row: stubRow },
    { xrayImageId: "img-2", assignedTo: "bob",   status: "pending", replacedById: null, lastEventAt: "2026-07-01T00:00:00.000Z", row: stubRow },
  ],
};

describe("assertRequestPending", () => {
  it("passes when the request is still pending", () => {
    expect(assertRequestPending("pending")).toEqual({ ok: true });
  });

  it("rejects when the request was already approved", () => {
    expect(assertRequestPending("approved").ok).toBe(false);
  });

  it("rejects when the request was already denied", () => {
    expect(assertRequestPending("denied").ok).toBe(false);
  });
});

describe("assertSamplesOwnedBy", () => {
  it("passes when every sample is currently owned by the expected employee", () => {
    expect(assertSamplesOwnedBy(distribution, ["img-1"], "alice")).toEqual({ ok: true });
  });

  it("rejects when a sample has moved to a different employee", () => {
    const result = assertSamplesOwnedBy(distribution, ["img-1", "img-2"], "alice");
    expect(result.ok).toBe(false);
  });

  it("rejects when distribution data is missing", () => {
    expect(assertSamplesOwnedBy(null, ["img-1"], "alice").ok).toBe(false);
  });
});
