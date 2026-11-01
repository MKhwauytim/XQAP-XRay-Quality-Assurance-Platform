import { describe, expect, it } from "vitest";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { displayXrayImageId } from "./adhocImportEmployeeView";

const entry = (xrayImageId: string): DistributionEntry =>
  ({ xrayImageId, assignedTo: "e", status: "pending", replacedById: null, lastEventAt: "" }) as unknown as DistributionEntry;

describe("displayXrayImageId", () => {
  it("shows the operator's id for a row merged from an ad-hoc import into a real month", () => {
    expect(displayXrayImageId(entry("ADHOC-adh-3f8a1b2c-1111-4222-8333-944455556666-66B4202601060043"))).toBe("66B4202601060043");
  });

  it("leaves a real month id as it is", () => {
    expect(displayXrayImageId(entry("202601120020080070"))).toBe("202601120020080070");
  });
});
