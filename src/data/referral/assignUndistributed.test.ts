import { describe, expect, it } from "vitest";

import { buildAssignEvent } from "../distribution/distributionLog";
import { appendDistributionEvents, loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { undistributedEntries } from "../../components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/undistributedEntries";
import { assignUndistributedCases } from "./assignUndistributed";

const JAN = "1-January-2026";

const row = (id: string): PreparedPopulationRow => ({
  xrayImageId: id, portName: "ميناء", certScanStatus: "NonCertscan", stage: null, xrayEntryDate: null,
  portCode: null, portType: null, declarationNumber: null, declarationDate: null, plateOrContainerNumber: null,
  chassisNumber: null, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: null,
  reportNumber: null, targetedByRiskEngine: null, riskMessage: null, levelOneEmployee: null, levelTwoEmployee: null,
  otherResults: {
    manual: { result: null, code: null, employeeId: null },
    opposite: { result: null, code: null, employeeId: null },
    liveMeans: { result: null, code: null, employeeId: null },
  },
  notes: null, certScanSnippet: null, originalCertScanSnippet: null, biEnrichmentStatus: "BI Not Provided",
  biMatched: false, biFilledFields: [], sourceSheetName: "s", sourceRowNumber: 1,
});

const sample = (rows: PreparedPopulationRow[]): SampleMasterData => ({
  rngSeed: "seed", totalRequested: rows.length, totalActual: rows.length, certScanRequested: 0,
  nonCertScanRequested: rows.length, certScanActual: 0, nonCertScanActual: rows.length,
  portAllocations: [], stageAllocations: [], drawnAt: "2026-01-01T00:00:00.000Z", drawnBy: "admin", rows,
});

async function seedMonth(root: DirectoryHandleLike, month: string, sampleIds: string[], populationIds: string[]) {
  const manifest: MonthManifestData = {
    monthFolderName: month, month: 1, year: 2026, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false, templateVersion: null, rngSeed: null,
    totalRawRows: 0, totalProcessedRows: populationIds.length, status: "distributed",
  };
  const monthDir = await getPopulationMonthDir(root, month, true);
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
  const final: PopulationFinalData = {
    sourceMonthFolder: month, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    totalRows: populationIds.length, certScanRows: 0, nonCertScanRows: populationIds.length,
    rows: populationIds.map(row) as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true }), "population.final.json", final);
  expect((await saveSampleMaster(root, month, sample(sampleIds.map(row)))).ok).toBe(true);
}



describe("bulk assign of undistributed cases", () => {
  // Regression (owner, 2026-11-04): 832 unstudied cases were filtered, but the
  // bulk «إسناد» offered 407. The other 425 were «غير موزعة» and could not be
  // routed as a referral, since a request needs a current owner.
  it("assigns every undistributed case directly and leaves an owned one to the request flow", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1", "S2", "S3"], ["S1", "S2", "S3"]);
    expect((await appendDistributionEvents(root, JAN, [buildAssignEvent({ xrayImageId: "S1", assignedTo: "emp1", eventBy: "admin" })])).ok).toBe(true);

    const before = await loadOrDeriveDistributionCurrent(root, JAN, (await loadSampleMaster(root, JAN))!.rows);
    expect(undistributedEntries(await loadSampleMaster(root, JAN), before!.entries).map((e) => e.xrayImageId)).toEqual(["S2", "S3"]);

    const result = await assignUndistributedCases(root, JAN, ["S1", "S2", "S3"], "jamila", "admin");
    expect(result).toEqual({ ok: true, assigned: 2, skipped: 1 });

    const after = await loadOrDeriveDistributionCurrent(root, JAN, (await loadSampleMaster(root, JAN))!.rows);
    expect(Object.fromEntries(after!.entries.map((e) => [e.xrayImageId, e.assignedTo]))).toEqual({ S1: "emp1", S2: "jamila", S3: "jamila" });
    // A second click assigns nothing twice.
    expect(await assignUndistributedCases(root, JAN, ["S2", "S3"], "other", "admin")).toEqual({ ok: true, assigned: 0, skipped: 2 });
  });
});
