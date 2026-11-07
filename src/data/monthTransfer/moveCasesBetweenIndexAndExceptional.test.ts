import { describe, expect, it } from "vitest";

import { upsertItemAnswer } from "../answers/answerStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { appendDistributionEvents, loadOrDeriveDistributionCurrent } from "../distribution/distributionStorage";
import { loadAdhocImportIndex, loadAdhocRecord } from "../adhocImport/adhocImportStorage";
import { adhocMonthFolder, namespacedXrayImageId } from "../adhocImport/adhocImportModel";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { moveExceptionalCasesToIndex, moveIndexCasesToExceptional } from "./moveCasesBetweenIndexAndExceptional";
import { executeSplitMonth, planSplitMonth } from "./splitMonthByIndexList";
import { ensureAdhocSampleMaster } from "../adhocImport/adhocDistributionBridge";

const JAN = "1-January-2026";
const EMP = "jalgahamdi";

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



async function seed(root: DirectoryHandleLike) {
  await seedMonth(root, JAN, ["S1", "S2", "S3"], ["S1", "S2", "S3"]);
  const events = ["S1", "S2", "S3"].map((id) =>
    buildAssignEvent({ xrayImageId: id, assignedTo: EMP, eventBy: "admin", eventAt: "2026-08-10T08:00:00.000Z" }));
  expect((await appendDistributionEvents(root, JAN, events)).ok).toBe(true);
  // S2 has a draft: studied work never moves.
  expect((await upsertItemAnswer(root, JAN, EMP, {
    xrayImageId: "S2", templateId: "t1", templateVersion: 1, answers: [], lastSavedAt: "2026-08-11T09:00:00.000Z",
    submittedAt: null, answeredBy: EMP, status: "draft",
  })).ok).toBe(true);
}

async function assignees(root: DirectoryHandleLike, folder: string) {
  const dist = await loadOrDeriveDistributionCurrent(root, folder, (await loadSampleMaster(root, folder))!.rows);
  return Object.fromEntries(dist!.entries.filter((e) => e.status !== "replaced").map((e) => [e.xrayImageId, e.assignedTo]));
}

describe("bulk move between the index and the exceptional cases", () => {
  it("moves only unstudied cases out, keeping the employee, and back again", async () => {
    const root = createMemoryDirectory();
    await seed(root);

    const out = await moveIndexCasesToExceptional(root, JAN, ["S2", "S3"], "admin");
    expect(out).toMatchObject({ ok: true, moved: 1, skippedStudied: 1 });
    expect((await loadSampleMaster(root, JAN))!.rows.map((r) => r.xrayImageId)).toEqual(["S1", "S2"]);
    const importId = (await loadAdhocImportIndex(root))![0].importId;
    const store = adhocMonthFolder(importId);
    const nsS3 = namespacedXrayImageId(importId, "S3", 0);
    expect(await assignees(root, store)).toEqual({ [nsS3]: EMP });

    const back = await moveExceptionalCasesToIndex(root, JAN, [{ importId, xrayImageId: nsS3, assignedTo: EMP }], "admin");
    expect(back).toMatchObject({ ok: true, moved: 1, skippedStudied: 0 });
    expect((await loadSampleMaster(root, JAN))!.rows.map((r) => r.xrayImageId).sort()).toEqual(["S1", "S2", "S3"]);
    expect((await assignees(root, JAN)).S3).toBe(EMP);
    expect((await loadSampleMaster(root, store))!.rows).toHaveLength(0);
    expect((await loadAdhocRecord(root, importId))!.rows[0]).toMatchObject({ validation: { valid: false }, assignments: [] });

    // And out once more: an excluded row does not block a later move.
    const again = await moveIndexCasesToExceptional(root, JAN, ["S3"], "admin");
    expect(again).toMatchObject({ ok: true, moved: 1 });
    expect((await loadSampleMaster(root, JAN))!.rows.map((r) => r.xrayImageId)).toEqual(["S1", "S2"]);
  });
});

describe("pre-merge review regressions (PR #231)", () => {
  async function movedOut(root: DirectoryHandleLike) {
    await seed(root);
    await moveIndexCasesToExceptional(root, JAN, ["S3"], "admin");
    const importId = (await loadAdhocImportIndex(root))![0].importId;
    return { importId, store: adhocMonthFolder(importId), ns: namespacedXrayImageId(importId, "S3", 0) };
  }

  it("a moved-back row is never re-projected into the store, by a save or by a restore", async () => {
    const root = createMemoryDirectory();
    const { importId, store, ns } = await movedOut(root);
    await moveExceptionalCasesToIndex(root, JAN, [{ importId, xrayImageId: ns, assignedTo: EMP }], "admin");
    await ensureAdhocSampleMaster(root, (await loadAdhocRecord(root, importId))!);
    expect((await loadSampleMaster(root, store))!.rows).toHaveLength(0);
    await executeSplitMonth(root, JAN, null, "admin"); // restore-only
    expect((await loadSampleMaster(root, store))!.rows).toHaveLength(0);
  });

  it("a fan-out copy is skipped, so one image gets one assignment in the month", async () => {
    const root = createMemoryDirectory();
    const { importId, store, ns } = await movedOut(root);
    const storeSample = (await loadSampleMaster(root, store))!;
    const replica = { ...storeSample.rows[0], xrayImageId: namespacedXrayImageId(importId, "S3", 1), adhocReplicaIndex: 1 };
    expect((await saveSampleMaster(root, store, { ...storeSample, rows: [...storeSample.rows, replica] })).ok).toBe(true);
    const result = await moveExceptionalCasesToIndex(root, JAN, [
      { importId, xrayImageId: ns, assignedTo: EMP },
      { importId, xrayImageId: replica.xrayImageId, assignedTo: "hihaloraini" },
    ], "admin");
    expect(result).toMatchObject({ ok: true, moved: 1, skipped: 1 });
    expect((await loadSampleMaster(root, JAN))!.rows.filter((r) => r.xrayImageId === "S3")).toHaveLength(1);
    expect((await assignees(root, JAN)).S3).toBe(EMP);
  });

  it("a split whose store write was lost repairs the store before removing rows from the month", async () => {
    const root = createMemoryDirectory();
    const { importId, store } = await movedOut(root);
    const storeSample = (await loadSampleMaster(root, store))!;
    expect((await saveSampleMaster(root, store, { ...storeSample, rows: [] })).ok).toBe(true);
    await executeSplitMonth(root, JAN, null, "admin");
    const stored = (await loadSampleMaster(root, store))!.rows.map((r) => r.xrayImageId);
    expect(stored).toEqual([namespacedXrayImageId(importId, "S3", 0)]);
  });

  it("an empty id list is refused instead of moving every unstudied case", async () => {
    const root = createMemoryDirectory();
    await seed(root);
    expect(await planSplitMonth(root, JAN, [])).toEqual({ ok: false, reason: "empty-list" });
    expect(await planSplitMonth(root, JAN, ["  "])).toEqual({ ok: false, reason: "empty-list" });
  });
});
