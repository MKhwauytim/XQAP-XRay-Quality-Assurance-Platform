import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleApproval, SampleMasterData } from "./sampleTypes";
import { approveSampleMaster, loadSampleMaster, saveSampleMaster } from "./sampleStorage";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
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

function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "drawer",
    rows: [makeRow("A1")],
  };
}

const approval: SampleApproval = {
  approvedBy: "supervisor",
  approvedAt: "2026-07-14T10:00:00.000Z",
  role: "supervisor",
  note: "reviewed",
};

describe("approveSampleMaster", () => {
  test("records the approval and bumps the revision (CAS write-back verified)", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, "5-may-2026", makeSample());

    const result = await approveSampleMaster(dir, "5-may-2026", approval);
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, "5-may-2026");
    expect(reloaded?.approval).toEqual(approval);
    expect(reloaded?.revision).toBe(1);
    expect(reloaded?._writeToken).toBeTruthy();
  });

  test("is idempotent — first approval wins, never overwritten", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, "5-may-2026", makeSample());
    await approveSampleMaster(dir, "5-may-2026", approval);

    const second: SampleApproval = {
      approvedBy: "manager",
      approvedAt: "2026-07-15T10:00:00.000Z",
      role: "manager",
    };
    const result = await approveSampleMaster(dir, "5-may-2026", second);
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, "5-may-2026");
    expect(reloaded?.approval).toEqual(approval); // unchanged
  });

  test("fails cleanly when there is no sample master for the month", async () => {
    const dir = createMemoryDirectory();
    const result = await approveSampleMaster(dir, "5-may-2026", approval);
    expect(result.ok).toBe(false);
  });
});
