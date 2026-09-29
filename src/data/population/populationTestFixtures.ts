/**
 * Test-only builders shared by the population overwrite / archive / recovery
 * and report-fallback suites. Never imported by app code.
 */
import type { PreparedPopulationRow } from "./populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";

export function makePopulationRow(xrayImageId: string, portName = "بري"): PreparedPopulationRow {
  return {
    xrayImageId,
    portName,
    certScanStatus: "NonCertscan",
    stage: "FIRST_STAGE",
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
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
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

export function makeSampleMaster(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-05-01T08:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}
