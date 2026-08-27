import { describe, it, expect } from "vitest";
import {
  groupRowsByStage,
  groupRowsByPort,
  sumCounts,
  groupEntriesByEmployeeStage,
  groupEntriesByEmployeePort,
  groupEntriesByEmployeeCertScan,
} from "./fold";
import type { PreparedPopulationRow } from "../../population/populationTypes";
import type { DistributionEntry } from "../../distribution/distributionTypes";

function row(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "1",
    xrayImageId: "IMG-1",
    xrayEntryDate: null,
    portCode: null,
    portType: "بري",
    portName: "منفذ اختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
      opposite: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
      liveMeans: { xrayLevelOneResult: null, xrayLevelTwoResult: null },
    },
    notes: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  } as PreparedPopulationRow;
}

function entry(overrides: Partial<DistributionEntry> = {}): DistributionEntry {
  return {
    xrayImageId: "IMG-1",
    assignedTo: "user1",
    status: "completed",
    replacedById: null,
    lastEventAt: "2026-08-01T00:00:00.000Z",
    row: {
      stage: "1",
      portName: "منفذ اختبار",
      xrayEntryDate: null,
      plateOrContainerNumber: null,
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
      certScanStatus: "NonCertscan",
      declarationNumber: null,
      declarationDate: null,
      chassisNumber: null,
      movementType: null,
      portCode: null,
      portType: "بري",
      targetedByRiskEngine: null,
      riskMessage: null,
      biEnrichmentStatus: "BI Not Provided",
      reportNumber: null,
    },
    ...overrides,
  } as DistributionEntry;
}

describe("groupRowsByStage", () => {
  it("counts سليمة/اشتباه/total per stage and orders stages first→fourth→unknown", () => {
    const rows = [
      row({ stage: "1", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
      row({ stage: "1", xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "سليمة" }),
      row({ stage: "2", xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
    ];
    const buckets = groupRowsByStage(rows);
    expect(buckets.map((b) => b.stageKey)).toEqual(["first", "second"]);
    const first = buckets.find((b) => b.stageKey === "first")!;
    expect(first.counts).toEqual({ سليمة: 1, اشتباه: 1, total: 2 });
  });

  it("returns an empty array for no rows", () => {
    expect(groupRowsByStage([])).toEqual([]);
  });
});

describe("groupRowsByPort", () => {
  it("splits ports into land/sea by the بحري substring rule", () => {
    const rows = [
      row({ portName: "ميناء جدة", portType: "منفذ بحري" }),
      row({ portName: "منفذ الحديثة", portType: "منفذ بري" }),
    ];
    const { land, sea } = groupRowsByPort(rows);
    expect(sea.map((p) => p.portName)).toEqual(["ميناء جدة"]);
    expect(land.map((p) => p.portName)).toEqual(["منفذ الحديثة"]);
  });

  it("sorts ports within each column by total descending", () => {
    const rows = [
      row({ portName: "أ", portType: "بري" }),
      row({ portName: "ب", portType: "بري" }),
      row({ portName: "ب", portType: "بري" }),
    ];
    const { land } = groupRowsByPort(rows);
    expect(land.map((p) => p.portName)).toEqual(["ب", "أ"]);
  });
});

describe("sumCounts", () => {
  it("sums سليمة/اشتباه/total across buckets", () => {
    const total = sumCounts([
      { counts: { سليمة: 2, اشتباه: 1, total: 3 } },
      { counts: { سليمة: 5, اشتباه: 0, total: 5 } },
    ]);
    expect(total).toEqual({ سليمة: 7, اشتباه: 1, total: 8 });
  });
});

describe("groupEntriesByEmployeeStage", () => {
  it("groups by assignedTo, then by stage, and resolves display names", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, stage: "1", xrayLevelOneResult: "اشتباه" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, stage: "2" } }),
      entry({ assignedTo: "user2", row: { ...entry().row, stage: "1" } }),
    ];
    const { rows, stageKeysPresent } = groupEntriesByEmployeeStage(entries, { user1: "أحمد" });
    expect(stageKeysPresent).toEqual(["first", "second"]);
    const ahmed = rows.find((r) => r.username === "user1")!;
    expect(ahmed.displayName).toBe("أحمد");
    expect(ahmed.stages.first).toEqual({ سليمة: 0, اشتباه: 1, total: 1 });
    expect(ahmed.total).toEqual({ سليمة: 1, اشتباه: 1, total: 2 });
    const other = rows.find((r) => r.username === "user2")!;
    expect(other.displayName).toBe("user2"); // falls back to username when no display name mapping
  });
});

describe("groupEntriesByEmployeePort", () => {
  it("groups by assignedTo, then land/sea", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, portType: "بحري" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, portType: "بري" } }),
    ];
    const [row1] = groupEntriesByEmployeePort(entries, {});
    expect(row1.ports.sea.total).toBe(1);
    expect(row1.ports.land.total).toBe(1);
    expect(row1.total.total).toBe(2);
  });
});

describe("groupEntriesByEmployeeCertScan", () => {
  it("counts CertScan vs NonCertScan per employee, degrading unknown status to neither bucket", () => {
    const entries = [
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: "Certscan" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: "NonCertscan" } }),
      entry({ assignedTo: "user1", row: { ...entry().row, certScanStatus: undefined as never } }),
    ];
    const [row1] = groupEntriesByEmployeeCertScan(entries, {});
    expect(row1.certScanCount).toBe(1);
    expect(row1.nonCertScanCount).toBe(1);
    expect(row1.total).toBe(3); // total counts every assignment even when status is missing
  });
});
