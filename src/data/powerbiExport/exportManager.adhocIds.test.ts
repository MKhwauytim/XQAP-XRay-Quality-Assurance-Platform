import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { saveMonthRun } from "../population/populationStorage";
import { formatMonthFolderName } from "../population/monthFolder";
import { invalidateMonthLockCache } from "../population/monthLock";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { runPowerBiExportDetailed } from "./exportManager";

const MONTH = formatMonthFolderName(1, 2026);
const STORED = "ADHOC-adh-3f8a1b2c-1111-4222-8333-944455556666-66B4202601060043";

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("runPowerBiExport — exceptional cases merged into a month", () => {
  it("writes the operator's id in both files, never the ADHOC storage key", async () => {
    const root = createMemoryDirectory("root");
    const rows = [makePopulationRow("P1"), makePopulationRow(STORED)];
    const saved = await saveMonthRun({
      directoryHandle: root,
      month: 1,
      year: 2026,
      username: "admin",
      riskFileName: "risk.xlsx",
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [{ id: "raw-1" }],
      biRawRows: [],
      processedRows: rows.map((row) => row as unknown as Record<string, unknown>),
      certScanRows: 0,
      nonCertScanRows: 2,
    });
    expect(saved.ok).toBe(true);
    expect((await saveSampleMaster(root, MONTH, makeSampleMaster(rows))).ok).toBe(true);

    await runPowerBiExportDetailed(root, MONTH);

    const sys = await getSystemRoot(root, false);
    const exportDir = await (await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: false })).getDirectoryHandle(MONTH, { create: false });
    for (const fileName of ["population.csv", "sample.csv"]) {
      const csv = await (await (await exportDir.getFileHandle(fileName, { create: false })).getFile()).text();
      expect(csv).not.toContain("ADHOC-");
      expect(csv).toContain("66B4202601060043,");
    }
  });
});
