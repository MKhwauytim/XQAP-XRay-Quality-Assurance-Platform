import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { ADHOC_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import { projectTable } from "../adhocImport/adhocRowProjection";
import type { ImportMapping, SourceTable } from "../adhocImport/adhocImportModel";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { executeExcelRowsIntoMonth, planExcelRowsIntoMonth } from "./excelRowsIntoMonth";

const JAN = "1-January-2026";
const FEB = "2-February-2026";
const MERGED_ADHOC_ID = "ADHOC-adh-3f8a1b2c-1111-4222-8333-944455556666-B1";

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

function excelRows(ids: string[]) {
  const table: SourceTable = {
    sheetName: "الحالات المتبقية",
    headers: ["id", "l1", "l2"],
    rows: ids.map((id, i) => ({ sourceRowNumber: i + 2, values: { id, l1: "سليمة", l2: "اشتباه" } })),
  };
  const mapping: ImportMapping = {
    fields: {
      xrayImageId: { kind: "column", header: "id" },
      xrayLevelOneResult: { kind: "column", header: "l1" },
      xrayLevelTwoResult: { kind: "column", header: "l2" },
    },
    valueMappings: {},
  };
  // Duplicate ids within the file are flagged invalid by the projection; feed
  // each id through on its own so the engine's own repeat check is exercised.
  return ids.flatMap((_, i) =>
    projectTable({ table: { ...table, rows: [table.rows[i]] }, mapping, catalog: ADHOC_FIELD_CATALOG, binding: { kind: "isolated" } })
  );
}

describe("excel rows into a month", () => {
  it("adds only images found nowhere in the workspace, under their original id", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, JAN, ["A1", MERGED_ADHOC_ID], ["A1", MERGED_ADHOC_ID, "P1"]);
    await seedMonth(root, FEB, [], ["C1"]);
    expect((await saveSampleMaster(root, "adhoc-adh-1700000000000-abc123", sample([row("ADHOC-adh-1700000000000-abc123-D1")]))).ok).toBe(true);

    const rows = excelRows(["A1", "B1", "C1", "D1", "P1", "E1", "E1"]);
    const planned = await planExcelRowsIntoMonth(root, rows, JAN);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.added.map((r) => r.xrayImageId)).toEqual(["E1"]);
    expect(planned.plan.existing.map((e) => [e.xrayImageId, e.location.folder])).toEqual([
      ["A1", JAN], ["B1", JAN], ["C1", FEB], ["D1", "adhoc-adh-1700000000000-abc123"], ["P1", JAN],
    ]);
    expect(planned.plan.repeatedInFile).toEqual(["E1"]);

    const result = await executeExcelRowsIntoMonth(root, rows, JAN, "admin");
    expect(result).toMatchObject({ ok: true, addedToSample: 1, addedToPopulation: 1 });
    expect((await loadSampleMaster(root, JAN))?.rows.map((r) => r.xrayImageId)).toContain("E1");
    expect((await loadMonthPopulationFinal(root, JAN))?.totalRows).toBe(4);

    const again = await planExcelRowsIntoMonth(root, rows, JAN);
    expect(again.ok && again.plan.added).toEqual([]);
  });
});
