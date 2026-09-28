import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { saveMonthRun } from "../population/populationStorage";
import { formatMonthFolderName } from "../population/monthFolder";
import { invalidateMonthLockCache } from "../population/monthLock";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { runPowerBiExportDetailed } from "./exportManager";

const MONTH = formatMonthFolderName(5, 2026);

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("runPowerBiExport — sampled ids missing from the population (A2)", () => {
  it("keeps orphaned sample rows out of population.csv, in sample.csv, and reports their count", async () => {
    const root = createMemoryDirectory("root");
    const saved = await saveMonthRun({
      directoryHandle: root,
      month: 5,
      year: 2026,
      username: "admin",
      riskFileName: "risk.xlsx",
      biFileName: null,
      certScanUsed: false,
      riskRawRows: [{ id: "raw-1" }],
      biRawRows: [],
      processedRows: ["P1", "P2"].map((id) => makePopulationRow(id) as unknown as Record<string, unknown>),
      certScanRows: 0,
      nonCertScanRows: 2,
    });
    expect(saved.ok).toBe(true);
    const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("P1"), makePopulationRow("S9")]));
    expect(sampled.ok).toBe(true);

    const { manifest, snapshotRowCount } = await runPowerBiExportDetailed(root, MONTH);

    expect(snapshotRowCount).toBe(1);
    expect(manifest.files.find((file) => file.fileName === "population.csv")?.rowCount).toBe(2);
    expect(manifest.files.find((file) => file.fileName === "sample.csv")?.rowCount).toBe(2);

    // The flag is an explicit true/false in the LAST sample.csv column, never blank.
    const { getSystemRoot, SYSTEM_FOLDER_NAMES } = await import("../workspace/workspacePaths");
    const sys = await getSystemRoot(root, false);
    const exportDir = await (await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: false })).getDirectoryHandle(MONTH, { create: false });
    const csv = await (await (await exportDir.getFileHandle("sample.csv", { create: false })).getFile()).text();
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\n").map((line) => line.trim());
    const header = lines[0]!.split(",");
    expect(header[header.length - 1]).toBe("fromSampleSnapshot");
    const flagOf = (id: string): string | undefined => lines.find((line) => line.startsWith(`${id},`))?.split(",").pop();
    expect(flagOf("P1")).toBe("false");
    expect(flagOf("S9")).toBe("true");
  });
});
