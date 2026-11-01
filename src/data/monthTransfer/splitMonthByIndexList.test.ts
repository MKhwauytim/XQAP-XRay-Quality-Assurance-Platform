import { describe, expect, it } from "vitest";

import { upsertItemAnswer } from "../answers/answerStorage";
import { loadAdhocImportIndex, loadAdhocRecord } from "../adhocImport/adhocImportStorage";
import { adhocMonthFolder } from "../adhocImport/adhocImportModel";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, getSampleMainDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { executeSplitMonth, planSplitMonth } from "./splitMonthByIndexList";

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


describe("split a month by the index list", () => {
  it("keeps studied and listed cases, moves the rest to the month's exceptional cases", async () => {
    const root = createMemoryDirectory();
    const ids = ["S1", "S2", "S3", "S4"];
    await seedMonth(root, JAN, ids, ids);
    // S1 has a reviewer's draft: studied work never moves, even if not in the list.
    expect((await upsertItemAnswer(root, JAN, "emp1", {
      xrayImageId: "S1", templateId: "t1", templateVersion: 1, answers: [], lastSavedAt: "2026-08-10T09:00:00.000Z",
      submittedAt: null, answeredBy: "emp1", status: "draft",
    })).ok).toBe(true);

    const planned = await planSplitMonth(root, JAN, ["S2", " X9 "]);
    if (!planned.ok) throw new Error("plan failed");
    expect(planned.plan.keptStudied).toEqual(["S1"]);
    expect(planned.plan.keptListed).toEqual(["S2"]);
    expect(planned.plan.moved.map((r) => r.xrayImageId)).toEqual(["S3", "S4"]);
    expect(planned.plan.listNotInMonth).toEqual(["X9"]);

    const result = await executeSplitMonth(root, JAN, ["S2"], "admin", new Date("2026-11-01T10:00:00Z"));
    expect(result).toMatchObject({ ok: true, moved: 2 });
    if (!result.ok || !result.importId) throw new Error("split failed");

    expect((await loadSampleMaster(root, JAN))!.rows.map((r) => r.xrayImageId)).toEqual(["S1", "S2"]);
    // The population is untouched.
    expect((await loadMonthPopulationFinal(root, JAN))!.rows).toHaveLength(4);
    // The exceptional cases are an ad-hoc import bound to January only.
    const record = await loadAdhocRecord(root, result.importId);
    expect(record?.monthBinding).toEqual({ kind: "month", monthFolderName: JAN });
    expect(record?.rows.map((r) => r.mapped.xrayImageId)).toEqual(["S3", "S4"]);
    expect(record?.rows[0].mapped.portName).toBe("ميناء");
    expect(await loadSampleMaster(root, adhocMonthFolder(result.importId))).not.toBeNull();
    expect((await loadAdhocImportIndex(root)) ?? []).toHaveLength(1);
    expect((await loadAdhocImportIndex(root))![0].linkedMonths).toEqual([JAN]);
    // The pre-split sample is archived, never lost.
    const archived = await (await getSampleMainDir(root, JAN, false)).getFileHandle(`sample.master.before-split-${new Date("2026-11-01T10:00:00Z").getTime()}.json`);
    expect(archived).toBeTruthy();

    // A second run has nothing left to move and creates no second import.
    const again = await executeSplitMonth(root, JAN, ["S2"], "admin");
    expect(again).toMatchObject({ ok: true, moved: 0, importId: null });
    expect((await loadAdhocImportIndex(root)) ?? []).toHaveLength(1);
  });
});
