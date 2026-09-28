import { describe, expect, it } from "vitest";

import { answerDraftKey } from "../../../../../../data/answers/answerDraftStore";
import { adhocMonthFolder } from "../../../../../../data/adhocImport/adhocImportModel";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { answerFolderForEntry, panelDraftKey } from "./answerRouting";

const base: DistributionEntry = {
  xrayImageId: "IMG-1",
  assignedTo: "emp1",
  status: "pending",
  replacedById: null,
  lastEventAt: "2026-09-28T08:00:00.000Z",
  row: {
    stage: "1",
    portName: "ميناء جدة",
    xrayEntryDate: "2026-09-28",
    plateOrContainerNumber: "C-1",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    certScanStatus: "Certscan",
    declarationNumber: "D-1",
    declarationDate: "2026-09-28",
    chassisNumber: null,
    movementType: null,
    portCode: null,
    portType: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    biEnrichmentStatus: "BI Not Provided",
    reportNumber: null,
  },
};

describe("answer routing is derived from the row itself (A1)", () => {
  it("routes a real row to the selected month", () => {
    expect(answerFolderForEntry(base, "5-may-2026")).toBe("5-may-2026");
    expect(panelDraftKey(base, "5-may-2026")).toBe(answerDraftKey("5-may-2026", "IMG-1", "emp1"));
  });

  it("routes an ad-hoc row to its own store whatever month is selected", () => {
    const adhoc = { ...base, xrayImageId: "ADHOC-imp-1-XR-9", adhocImportId: "imp-1", adhocFileName: "f.xlsx" } as DistributionEntry;
    expect(answerFolderForEntry(adhoc, "5-may-2026")).toBe(adhocMonthFolder("imp-1"));
    expect(panelDraftKey(adhoc, "6-june-2026")).toBe(answerDraftKey(adhocMonthFolder("imp-1"), "ADHOC-imp-1-XR-9", "emp1"));
  });
});
