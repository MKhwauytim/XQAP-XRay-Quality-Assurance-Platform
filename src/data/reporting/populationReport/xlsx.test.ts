import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildPopulationXlsx } from "./xlsx";
import { makeRow, makeManifest, makeProcessingSummary, makeSampleMaster, makeDistribution } from "../reportTestFixtures";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

describe("buildPopulationXlsx", () => {
  it("writes one sheet per section with a filename matching the report convention", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    });
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), "تقرير_المجتمع_8-August-2026.xlsx");
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls[0][0] as XLSX.WorkBook;
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining([
        "الاستلام",
        "المخاطر - قبل وبعد",
        "BI - قبل وبعد",
        "المجتمع - المرحلة",
        "المجتمع - المنفذ",
        "العينة - المرحلة",
        "العينة - المنفذ",
        "التوزيع - الموظف والمرحلة",
        "التوزيع - الموظف والمنفذ",
        "التوزيع - CertScan",
      ])
    );
  });

  it("adds the source-revisions sheet when sourceRevisions is populated", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
      sourceRevisions: { "population.final.json": 2 },
    });
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    expect(wb.SheetNames).toContain("مراجعات المصادر");
  });

  it("omits the source-revisions sheet when sourceRevisions is absent", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    expect(wb.SheetNames).not.toContain("مراجعات المصادر");
  });

  it("never includes workflow-status columns", async () => {
    const populationRows = [makeRow("1", "x")];
    await buildPopulationXlsx({
      monthFolderName: "8-August-2026",
      manifest: null,
      processingSummary: null,
      riskRawRowCount: 1,
      biRawRowCount: null,
      populationRows,
      sampleRows: [],
      distributionEntries: [],
      employeeDisplayNames: {},
    });
    const wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    const anySheetJson = wb.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(wb.Sheets[name]));
    const serialized = JSON.stringify(anySheetJson);
    expect(serialized).not.toContain("قيد الانتظار");
    expect(serialized).not.toContain("مستبدل");
  });

  it("respects scope: population-only produces 5 sheets, sample-only produces 5, both produces 10", async () => {
    const populationRows = [makeRow("1", "ميناء جدة", { portType: "بحري" })];
    const sample = makeSampleMaster(populationRows);
    const distribution = makeDistribution([{ id: "1", assignedTo: "user1", status: "completed", row: { ...populationRows[0] } }]);
    const input = {
      monthFolderName: "8-August-2026",
      manifest: makeManifest(),
      processingSummary: makeProcessingSummary(),
      riskRawRowCount: 10,
      biRawRowCount: 8,
      populationRows,
      sampleRows: sample.rows,
      distributionEntries: distribution.entries,
      employeeDisplayNames: { user1: "أحمد" },
    };

    await buildPopulationXlsx(input, "population");
    let wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    expect(wb.SheetNames).toHaveLength(5);

    await buildPopulationXlsx(input, "sample");
    wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    expect(wb.SheetNames).toHaveLength(5);

    await buildPopulationXlsx(input, "both");
    wb = (XLSX.writeFile as unknown as { mock: { calls: [unknown][] } }).mock.calls.at(-1)![0] as XLSX.WorkBook;
    expect(wb.SheetNames).toHaveLength(10);
  });
});
