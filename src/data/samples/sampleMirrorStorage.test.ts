import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
} from "../distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  deriveCurrentDistribution,
} from "../distribution/distributionLog";
import { closeMonth, invalidateMonthLockCache } from "../population/monthLock";
import { upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { getUserWorkspaceFootprint } from "./sampleMirrorStorage";

const MONTH_A = "5-may-2026";
const MONTH_B = "6-june-2026";
const EMP = "emp1";

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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
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
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

async function seedManifest(root: DirectoryHandleLike, monthFolderName: string): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, monthFolderName, true);
  const manifest: MonthManifestData = {
    monthFolderName,
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 0,
    totalProcessedRows: 0,
    status: "distributed",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

function makeAnswer(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    answeredBy: EMP,
    status: "submitted",
  };
}

/** Draws a sample, assigns rows, and persists the derived distribution + mirrors. */
/** listMonthFolders enumerates the population root — ensure the month folder exists there. */
async function ensurePopulationMonthFolder(root: DirectoryHandleLike, monthFolderName: string): Promise<void> {
  await getPopulationMonthDir(root, monthFolderName, true);
}

async function seedAssignments(
  root: DirectoryHandleLike,
  monthFolderName: string,
  rows: PreparedPopulationRow[],
  assignee: string
): Promise<void> {
  await ensurePopulationMonthFolder(root, monthFolderName);
  await saveSampleMaster(root, monthFolderName, makeSample(rows));
  await appendDistributionEvents(
    root,
    monthFolderName,
    rows.map((r) => buildAssignEvent({ xrayImageId: r.xrayImageId, assignedTo: assignee, eventBy: "admin" }))
  );
  const log = await loadDistributionLog(root, monthFolderName);
  const current = deriveCurrentDistribution(log, rows);
  await saveDistributionCurrent(root, monthFolderName, current);
}

describe("getUserWorkspaceFootprint", () => {
  it("lists only months with pending mirror entries; completed-only months are excluded", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    // Month A: pending assignment for emp1.
    await seedAssignments(root, MONTH_A, [makeRow("A1"), makeRow("A2")], EMP);

    // Month B: assigned then completed — mirror shows "completed", not pending.
    await seedAssignments(root, MONTH_B, [makeRow("B1")], EMP);
    await appendDistributionEvents(root, MONTH_B, [
      buildCompletedEvent({ xrayImageId: "B1", assignedTo: EMP, eventBy: EMP }),
    ]);
    const logB = await loadDistributionLog(root, MONTH_B);
    const currentB = deriveCurrentDistribution(logB, [makeRow("B1")]);
    await saveDistributionCurrent(root, MONTH_B, currentB);

    const footprint = await getUserWorkspaceFootprint(root, EMP);

    expect(footprint.activeAssignments).toHaveLength(1);
    expect(footprint.activeAssignments[0]).toEqual({ monthFolderName: MONTH_A, pendingCount: 2 });
  });

  it("excludes closed months from activeAssignments even with pending entries", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    await seedAssignments(root, MONTH_A, [makeRow("A1")], EMP);
    await seedManifest(root, MONTH_A);
    await closeMonth(root, MONTH_A, "admin");

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.activeAssignments).toHaveLength(0);
  });

  it("reports answerFileMonths from a saved answer file with no active mirror assignment", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    // A month folder must exist for listMonthFolders to enumerate it.
    await ensurePopulationMonthFolder(root, MONTH_A);
    await saveSampleMaster(root, MONTH_A, makeSample([makeRow("A1")]));
    await upsertItemAnswer(root, MONTH_A, EMP, makeAnswer("A1"));

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.answerFileMonths).toEqual([MONTH_A]);
    expect(footprint.activeAssignments).toHaveLength(0);
  });

  it("returns empty footprint when the user has no files anywhere", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    await ensurePopulationMonthFolder(root, MONTH_A);
    await saveSampleMaster(root, MONTH_A, makeSample([makeRow("A1")]));

    const footprint = await getUserWorkspaceFootprint(root, "ghost-user");
    expect(footprint.activeAssignments).toHaveLength(0);
    expect(footprint.answerFileMonths).toHaveLength(0);
  });
});
