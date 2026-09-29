// C1: the base "stage" column of the employee queue is also what the referral
// preview, exports and filter options read — it must never surface the raw
// file alias (SECOND_STAG / FORTH_STAGE).
import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { makeRow } from "../../../../../../data/reporting/reportTestFixtures";
import { buildXrayColumns } from "./subComponents";

function entry(stage: string | null): DistributionEntry {
  return {
    xrayImageId: "IMG-1",
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-04T09:00:00.000Z",
    row: makeRow("IMG-1", "منفذ أ", { stage }),
  };
}

describe("buildXrayColumns — stage cell (C1)", () => {
  it("renders the Arabic level label, not the raw file alias", () => {
    const stageColumn = buildXrayColumns(DEFAULT_LABELS).find((column) => column.id === "stage")!;
    expect(stageColumn.accessor(entry("SECOND_STAG"))).toBe("المستوى الثاني");
    expect(stageColumn.accessor(entry("FORTH_STAGE"))).toBe("المستوى الرابع");
  });
});
