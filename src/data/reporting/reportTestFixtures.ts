// Shared test fixtures for the Wave 3 report-builder tests (sample / distribution
// / management). Pure data + factory functions — NO test-framework imports — so
// it type-checks under `tsc -b` and is only ever imported by *.test.ts files
// (tree-shaken out of the app bundle, like xssPayloads.ts).

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionCurrentData, DistributionStatus } from "../distribution/distributionTypes";
import type { MonthManifestData } from "../population/monthTypes";

/** A minimal valid `PreparedPopulationRow`; override any field per test. */
export function makeRow(
  id: string,
  portName: string,
  overrides: Partial<PreparedPopulationRow> = {},
): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: id,
    xrayEntryDate: null,
    portCode: null,
    portType: "منفذ بري",
    portName,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "اشتباه",
    xrayLevelTwoResult: "اشتباه",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

export function makeManifest(overrides: Partial<MonthManifestData> = {}): MonthManifestData {
  return {
    monthFolderName: "6-June-2026",
    month: 6,
    year: 2026,
    processedAt: "2026-07-01T00:00:00.000Z",
    processedBy: "admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: true,
    templateVersion: null,
    rngSeed: "seed-1",
    totalRawRows: 5,
    totalProcessedRows: 3,
    status: "sampled",
    ...overrides,
  };
}

export function makeSampleMaster(
  rows: PreparedPopulationRow[],
  overrides: Partial<SampleMasterData> = {},
): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 4,
    totalActual: rows.length,
    certScanRequested: 2,
    nonCertScanRequested: 2,
    certScanActual: rows.filter((r) => r.certScanStatus === "Certscan").length,
    nonCertScanActual: rows.filter((r) => r.certScanStatus !== "Certscan").length,
    portAllocations: [],
    stageAllocations: [
      { stageKey: "second", stageLabel: "المستوى الثاني", populationSize: 3, targetQuota: 4, actualDrawn: rows.length, certScanDrawn: 1, nonCertScanDrawn: rows.length - 1 },
    ],
    drawnAt: "2026-07-02T00:00:00.000Z",
    drawnBy: "admin",
    rows,
    ...overrides,
  };
}

export function makeDistribution(
  entries: Array<{ id: string; assignedTo: string; status: DistributionStatus; row: PreparedPopulationRow; replacedById?: string | null }>,
  overrides: Partial<DistributionCurrentData> = {},
): DistributionCurrentData {
  const list = entries.map((e) => ({
    xrayImageId: e.id,
    assignedTo: e.assignedTo,
    status: e.status,
    replacedById: e.replacedById ?? null,
    lastEventAt: "2026-07-05T00:00:00.000Z",
    row: e.row,
  }));
  return {
    monthFolderName: "6-June-2026",
    derivedAt: "2026-07-05T00:00:00.000Z",
    totalAssigned: list.length,
    totalCompleted: list.filter((e) => e.status === "completed").length,
    totalReplaced: list.filter((e) => e.status === "replaced").length,
    totalPending: list.filter((e) => e.status === "pending").length,
    entries: list,
    ...overrides,
  };
}
