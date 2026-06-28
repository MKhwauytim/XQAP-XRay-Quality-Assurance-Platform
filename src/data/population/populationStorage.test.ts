import { expect, it, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { saveMonthRun, loadAllSampleRows } from "./populationStorage";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "./monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";

const baseParams = {
  month: 5,
  year: 2026,
  username: "test-admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "A001", port: "بري" }],
  biRawRows: [],
  processedRows: [{ xrayImageId: "A001", certScanStatus: "NonCertscan" }],
  certScanRows: 0,
  nonCertScanRows: 1
};

test("saveMonthRun creates month folder and manifest", async () => {
  const dir = createMemoryDirectory();
  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.monthFolderName).toBe("5-May-2026");

  // Verify folder structure
  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-May-2026", { create: false });
  expect(monthDir.name).toBe("5-May-2026");
});

test("saveMonthRun writes month.manifest.json with correct metadata", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-May-2026", { create: false });

  const manifest = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;

  expect(manifest.value.month).toBe(5);
  expect(manifest.value.year).toBe(2026);
  expect(manifest.value.processedBy).toBe("test-admin");
  expect(manifest.value.status).toBe("processed-saved");
  expect(manifest.value.totalRawRows).toBe(1);
  expect(manifest.value.totalProcessedRows).toBe(1);
});

test("saveMonthRun writes risk.raw.json and population.final.json", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-May-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("raw", { create: false });
  const processedDir = await monthDir.getDirectoryHandle("processed", { create: false });

  const riskRaw = await safeReadJson<MonthRawData>(rawDir, "risk.raw.json");
  expect(riskRaw.ok).toBe(true);
  if (riskRaw.ok) {
    expect(riskRaw.value.rows).toHaveLength(1);
    expect(riskRaw.value.importedBy).toBe("test-admin");
  }

  const finalData = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
  expect(finalData.ok).toBe(true);
  if (finalData.ok) {
    expect(finalData.value.rows).toHaveLength(1);
    expect(finalData.value.nonCertScanRows).toBe(1);
  }
});

test("saveMonthRun does not write bi.raw.json when no BI rows", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams, biRawRows: [] });

  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-May-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("raw", { create: false });

  const biRaw = await safeReadJson(rawDir, "bi.raw.json");
  expect(biRaw.ok).toBe(false);
  expect((biRaw as { reason: string }).reason).toBe("missing");
});

it("loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws", async () => {
  // Arrange: create legacy directory structure (1-Population/{month}/sample/sample.master.json)
  // but no 2-Samples folder — so getSampleMainDir will throw
  const root = createMemoryDirectory("root");

  // Build: 1-Population/5-May-2026/month.manifest.json
  const populationDir = await root.getDirectoryHandle("1-Population", { create: true });
  const monthDir = await populationDir.getDirectoryHandle("5-May-2026", { create: true });

  // Write a minimal manifest so listMonthFolders picks it up
  await safeWriteJson(monthDir, "month.manifest.json", {
    monthFolderName: "5-May-2026",
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "test",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 0,
    totalProcessedRows: 1,
    status: "processed-saved",
  });

  // Write sample data in legacy location: 1-Population/5-May-2026/sample/sample.master.json
  const sampleDir = await monthDir.getDirectoryHandle("sample", { create: true });
  const sampleData: Partial<SampleMasterData> = {
    rngSeed: "test-seed",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "test",
    rows: [{ xrayImageId: "LEGACY001" } as never],
  };
  await safeWriteJson(sampleDir, "sample.master.json", sampleData);

  // Act: loadAllSampleRows should find rows via legacy path
  const rows = await loadAllSampleRows(root as never);

  // Assert
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].xrayImageId).toBe("LEGACY001");
});
