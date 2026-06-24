import { expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson } from "../storage/safeWrite";
import { saveMonthRun } from "./populationStorage";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "./monthTypes";

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
  expect(manifest.value.runnedBy).toBe("test-admin");
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
