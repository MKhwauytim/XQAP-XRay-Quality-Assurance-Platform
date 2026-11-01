import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { ADHOC_FIELD_CATALOG, EXCEL_INTO_MONTH_FIELD_CATALOG } from "../adhocImport/adhocFieldCatalog";
import { projectTable } from "../adhocImport/adhocRowProjection";
import type { ImportMapping, SourceTable } from "../adhocImport/adhocImportModel";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { buildIncompleteCasesSheet, executeExcelRowsIntoMonth, planExcelRowsIntoMonth } from "./excelRowsIntoMonth";
import { autoDetectMapping } from "../adhocImport/adhocMappingModel";

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
      ["A1", JAN], ["B1", JAN], ["C1", FEB], ["D1", "adhoc-adh-1700000000000-abc123"],
    ]);
    // P1 is in January's population but in no sample: it is drawn into the sample (v159.7).
    expect(planned.plan.fromPopulation.map((r) => r.xrayImageId)).toEqual(["P1"]);
    expect(planned.plan.repeatedInFile).toEqual(["E1"]);

    const result = await executeExcelRowsIntoMonth(root, rows, JAN, "admin");
    expect(result).toMatchObject({ ok: true, addedToSample: 1, addedToPopulation: 1, drawnFromPopulation: 1 });
    expect((await loadSampleMaster(root, JAN))?.rows.map((r) => r.xrayImageId)).toContain("E1");
    expect((await loadMonthPopulationFinal(root, JAN))?.totalRows).toBe(4);

    const again = await planExcelRowsIntoMonth(root, rows, JAN);
    expect(again.ok && again.plan.added).toEqual([]);
    expect(again.ok && again.plan.fromPopulation).toEqual([]);
  });
});

/** Rows read the way the settings section reads them: results may be blank. */
function excelRowsWithResults(spec: Array<[string, string, string]>) {
  const table: SourceTable = {
    sheetName: "الحالات المتبقية",
    headers: ["id", "l1", "l2"],
    rows: spec.map(([id, l1, l2], i) => ({ sourceRowNumber: i + 2, values: { id, l1, l2 } })),
  };
  const mapping: ImportMapping = {
    fields: {
      xrayImageId: { kind: "column", header: "id" },
      xrayLevelOneResult: { kind: "column", header: "l1" },
      xrayLevelTwoResult: { kind: "column", header: "l2" },
    },
    valueMappings: {},
  };
  return projectTable({ table, mapping, catalog: EXCEL_INTO_MONTH_FIELD_CATALOG, binding: { kind: "isolated" } });
}

describe("excel rows with blank L1/L2 results", () => {
  it("adds a case with no results as blank, then fills the blanks when the file comes back filled", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1"], ["S1"]);

    const first = await executeExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "", ""], ["N2", "سليمة", ""]]), JAN, "admin");
    expect(first).toMatchObject({ ok: true, addedToSample: 2, filledResults: 0 });
    if (!first.ok) return;
    expect(first.plan.invalid).toHaveLength(0);
    const added = (await loadSampleMaster(root, JAN))!.rows.find((r) => r.xrayImageId === "N1")!;
    expect(added.xrayLevelOneResult).toBe("");
    expect(added.xrayLevelTwoResult).toBe("");

    const again = await planExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "اشتباه", "سليمة"], ["N2", "اشتباه", "اشتباه"], ["S1", "اشتباه", "اشتباه"]]), JAN);
    if (!again.ok) throw new Error("plan failed");
    // N2's recorded L1 is never overwritten; S1 has results, so it is just "existing".
    expect(again.plan.filled.map((c) => [c.xrayImageId, c.field, c.newValue])).toEqual([
      ["N1", "xrayLevelOneResult", "اشتباه"],
      ["N1", "xrayLevelTwoResult", "سليمة"],
      ["N2", "xrayLevelTwoResult", "اشتباه"],
    ]);
    expect(again.plan.existing.map((e) => e.xrayImageId)).toEqual(["S1"]);
    expect(again.plan.added).toHaveLength(0);

    const second = await executeExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "اشتباه", "سليمة"], ["N2", "اشتباه", "اشتباه"]]), JAN, "admin");
    expect(second).toMatchObject({ ok: true, addedToSample: 0, filledResults: 3 });
    const sampleRows = (await loadSampleMaster(root, JAN))!.rows;
    expect(sampleRows.find((r) => r.xrayImageId === "N1")).toMatchObject({ xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "سليمة" });
    expect(sampleRows.find((r) => r.xrayImageId === "N2")).toMatchObject({ xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه" });
    const population = (await loadMonthPopulationFinal(root, JAN))!.rows;
    expect(population.find((r) => r.xrayImageId === "N1")).toMatchObject({ xrayLevelOneResult: "اشتباه" });
    expect(sampleRows.filter((r) => r.xrayImageId === "N1")).toHaveLength(1);
  });

  it("does not fill a blank result of a case that lives in another month", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1"], ["S1"]);
    await seedMonth(root, FEB, ["F1"], ["F1"]);
    await executeExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "", ""]]), FEB, "admin");
    const plan = await planExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "سليمة", "سليمة"]]), JAN);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.plan.filled).toHaveLength(0);
    expect(plan.plan.existing.map((e) => e.location.folder)).toEqual([FEB]);
  });
});

describe("incomplete cases export and fill-back", () => {
  it("exports cases with blanks, and the filled sheet uploaded back fills only the blanks", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1"], ["S1"]);
    await executeExcelRowsIntoMonth(root, excelRowsWithResults([["N1", "", ""]]), JAN, "admin");

    const sheet = buildIncompleteCasesSheet((await loadSampleMaster(root, JAN))!.rows);
    // The seeded S1 also lacks port type and entry date, so both cases are exported.
    const header = sheet[0];
    const idCol = header.indexOf("معرف الأشعة");
    const l1Col = header.indexOf("نتيجة المستوى الأول");
    const l2Col = header.indexOf("نتيجة المستوى الثاني");
    const portCol = header.indexOf("اسم المنفذ");
    const n1 = sheet.find((r) => r[idCol] === "N1")!;
    expect(n1[l1Col]).toBe("");

    // The admin fills N1's results and a port name, and changes S1's recorded port name.
    const filled = sheet.slice(1).map((r) => {
      const next = [...r];
      if (next[idCol] === "N1") { next[l1Col] = "اشتباه"; next[l2Col] = "سليمة"; next[portCol] = "البطحاء"; }
      if (next[idCol] === "S1") next[portCol] = "مكان آخر";
      return next;
    });
    const table: SourceTable = {
      sheetName: "الحالات الناقصة",
      headers: header,
      rows: filled.map((r, i) => ({ sourceRowNumber: i + 2, values: Object.fromEntries(header.map((h, k) => [h, r[k]])) })),
    };
    const mapping = autoDetectMapping(table.headers, EXCEL_INTO_MONTH_FIELD_CATALOG);
    const rows = projectTable({ table, mapping, catalog: EXCEL_INTO_MONTH_FIELD_CATALOG, binding: { kind: "isolated" } });
    const done = await executeExcelRowsIntoMonth(root, rows, JAN, "admin");
    expect(done).toMatchObject({ ok: true, addedToSample: 0 });
    const after = (await loadSampleMaster(root, JAN))!.rows;
    expect(after.find((r) => r.xrayImageId === "N1")).toMatchObject({
      xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "سليمة", portName: "البطحاء",
    });
    // A recorded value is never overwritten.
    expect(after.find((r) => r.xrayImageId === "S1")!.portName).toBe("ميناء");
    expect(after).toHaveLength(2);
  });
});

describe("cases in the month's population but in no sample", () => {
  it("are drawn into the target month's sample instead of being skipped as existing", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1"], ["S1", "P1"]);
    const plan = await planExcelRowsIntoMonth(root, excelRowsWithResults([["P1", "", ""], ["S1", "سليمة", "سليمة"]]), JAN);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.plan.fromPopulation.map((r) => r.xrayImageId)).toEqual(["P1"]);
    expect(plan.plan.existing.map((e) => e.xrayImageId)).toEqual(["S1"]);

    const done = await executeExcelRowsIntoMonth(root, excelRowsWithResults([["P1", "", ""]]), JAN, "admin");
    expect(done).toMatchObject({ ok: true, drawnFromPopulation: 1, addedToSample: 0, addedToPopulation: 0 });
    const sampleIds = (await loadSampleMaster(root, JAN))!.rows.map((r) => r.xrayImageId);
    expect(sampleIds).toEqual(["S1", "P1"]);
    expect((await loadMonthPopulationFinal(root, JAN))!.rows).toHaveLength(2);
  });

  it("a population-only case in ANOTHER month is still reported as existing", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, JAN, ["S1"], ["S1"]);
    await seedMonth(root, FEB, ["F1"], ["F1", "P2"]);
    const plan = await planExcelRowsIntoMonth(root, excelRowsWithResults([["P2", "", ""]]), JAN);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.plan.fromPopulation).toHaveLength(0);
    expect(plan.plan.existing).toEqual([{ xrayImageId: "P2", location: { folder: FEB, where: "population" } }]);
  });
});
