import { expect, it, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveMonthRun, loadAllSampleRows, loadBrowseRows, updateMonthStatus, loadMonthForEditing } from "./populationStorage";
import { loadReplacementBucket, loadReplacementIndexManifest } from "./replacementIndexStorage";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "./monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";

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

  expect(result.monthFolderName).toBe("5-may-2026");

  // Verify folder structure
  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  expect(monthDir.name).toBe("5-may-2026");
});

test("saveMonthRun writes month.manifest.json with correct metadata", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });

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

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("1-raw", { create: false });
  const processedDir = await monthDir.getDirectoryHandle("2-processed", { create: false });

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

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  const rawDir = await monthDir.getDirectoryHandle("1-raw", { create: false });

  const biRaw = await safeReadJson(rawDir, "bi.raw.json");
  expect(biRaw.ok).toBe(false);
  expect((biRaw as { reason: string }).reason).toBe("missing");
});

test("loadMonthForEditing skips reading risk.raw.json/bi.raw.json once a month is processed (A1 perf: avoids the two largest per-row files for every already-processed month view)", async () => {
  const dir = createMemoryDirectory();
  // saveMonthRun always leaves status "processed-saved" and writes risk.raw.json
  // alongside population.final.json -- the exact real-world shape this optimization
  // targets: raw files still exist on disk, but are no longer needed for display.
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const data = await loadMonthForEditing(dir, "5-may-2026");

  // Proves this is a smart skip based on manifest.status, not "file missing":
  // the file genuinely exists (verified by the earlier "writes risk.raw.json" test
  // against the same saveMonthRun fixture) yet riskRawRows comes back empty.
  expect(data.riskRawRows).toEqual([]);
  expect(data.biRawRows).toEqual([]);
  // Everything actually needed for phase/browse/sample display is unaffected.
  expect(data.populationRows).toHaveLength(1);
  expect(data.manifest?.status).toBe("processed-saved");
});

test("loadMonthForEditing still reads risk.raw.json/bi.raw.json for a month whose manifest is still at raw-saved (Phase 1/2 genuinely needs it)", async () => {
  const dir = createMemoryDirectory();
  const monthDir = await getPopulationMonthDir(dir, "5-may-2026", true);
  const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: true });

  const manifest: MonthManifestData = {
    monthFolderName: "5-may-2026",
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "test-admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 1,
    totalProcessedRows: 0,
    status: "raw-saved",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);

  const riskRaw: MonthRawData = {
    importedAt: new Date().toISOString(),
    importedBy: "test-admin",
    sourceFileName: "risk.xlsx",
    rows: [{ id: "A001", port: "بري" }],
  };
  await safeWriteJson(rawDir, "risk.raw.json", riskRaw);

  const data = await loadMonthForEditing(dir, "5-may-2026");

  expect(data.riskRawRows).toHaveLength(1);
  expect(data.populationRows).toBeNull(); // not processed yet -- no population.final.json
  expect(data.manifest?.status).toBe("raw-saved");
});

test("loadMonthForEditing still attempts raw reads when the manifest itself is missing/unreadable (safe fallback, unchanged from before this optimization)", async () => {
  const dir = createMemoryDirectory();
  const monthDir = await getPopulationMonthDir(dir, "5-may-2026", true);
  const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: true });
  const riskRaw: MonthRawData = {
    importedAt: new Date().toISOString(),
    importedBy: "test-admin",
    sourceFileName: "risk.xlsx",
    rows: [{ id: "A001", port: "بري" }],
  };
  await safeWriteJson(rawDir, "risk.raw.json", riskRaw);
  // Deliberately no month.manifest.json written.

  const data = await loadMonthForEditing(dir, "5-may-2026");

  expect(data.manifest).toBeNull();
  expect(data.riskRawRows).toHaveLength(1);
});

test("loadBrowseRows reads only the selected month unless all months are requested", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    month: 6,
    processedRows: [{ xrayImageId: "B001", certScanStatus: "NonCertscan" }],
  });

  const selectedMonthRows = await loadBrowseRows(dir, "population", "5-may-2026");
  expect(selectedMonthRows.map((row) => row.xrayImageId)).toEqual(["A001"]);
  expect(selectedMonthRows[0]?._monthFolder).toBe("5-may-2026");

  const allMonthRows = await loadBrowseRows(dir, "population");
  expect(allMonthRows.map((row) => row.xrayImageId).sort()).toEqual(["A001", "B001"]);
});

function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows: [{ xrayImageId: "A001" } as never],
  };
}

test("saveMonthRun aborts (sampleExists) when a sample was drawn and overwrite is not confirmed", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  // A sample is drawn (e.g. by another machine) after the population was saved.
  await saveSampleMaster(dir, "5-may-2026", makeSample());

  // Re-processing without explicit confirmation must abort under the lock.
  const blocked = await saveMonthRun({ directoryHandle: dir, ...baseParams });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.sampleExists).toBe(true);
  }

  // With confirmedOverwrite the save proceeds.
  const forced = await saveMonthRun({ directoryHandle: dir, ...baseParams, confirmedOverwrite: true });
  expect(forced.ok).toBe(true);
});

test("saveMonthRun requests write permission before creating folders, on a freshly-restored read-only workspace", async () => {
  // A remembered workspace (PR #36) opens with read permission only; the first
  // save must request write access itself rather than assuming it already holds it.
  const dir = createMemoryDirectory("root", {
    initialWritePermission: "prompt",
    writePermissionRequestOutcome: "granted",
  });

  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  expect(monthDir.name).toBe("5-may-2026");
});

test("saveMonthRun fails with the Arabic permission message, not a raw browser error, when the user declines write access", async () => {
  const dir = createMemoryDirectory("root", {
    initialWritePermission: "prompt",
    writePermissionRequestOutcome: "denied",
  });

  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(new WorkspacePermissionError().message);

  // Nothing should have been left behind — the whole operation was declined before writing.
  await expect(
    dir.getDirectoryHandle("1-population", { create: false })
  ).rejects.toThrow();
});

function withDeniedFolder(dir: DirectoryHandleLike, deniedName: string): DirectoryHandleLike {
  return {
    ...dir,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      if (name === deniedName) {
        throw new Error(`Simulated failure creating "${deniedName}"`);
      }
      const child = await dir.getDirectoryHandle(name, options);
      return withDeniedFolder(child, deniedName);
    },
  };
}

test("saveMonthRun writes a fresh replacement-candidate index alongside population.final.json", async () => {
  const dir = createMemoryDirectory();
  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });
  expect(result.ok).toBe(true);

  const manifest = await loadReplacementIndexManifest(dir, "5-may-2026");
  expect(manifest).not.toBeNull();
  expect(manifest?.totalIndexedRows).toBe(1);

  // baseParams' one row is NonCertScan, stage unset -> "unknown".
  const bucket = await loadReplacementBucket(dir, "5-may-2026", "NonCertscan", "unknown");
  expect(bucket?.map((r) => r.xrayImageId)).toEqual(["A001"]);
});

test("reprocessing a month advances the index's sourceRevision and rebuilds bucket contents", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  const first = await loadReplacementIndexManifest(dir, "5-may-2026");

  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    confirmedOverwrite: true,
    processedRows: [{ xrayImageId: "B002", certScanStatus: "NonCertscan" }],
  });
  const second = await loadReplacementIndexManifest(dir, "5-may-2026");

  expect(second!.sourceRevision).toBeGreaterThan(first!.sourceRevision);
  const bucket = await loadReplacementBucket(dir, "5-may-2026", "NonCertscan", "unknown");
  expect(bucket?.map((r) => r.xrayImageId)).toEqual(["B002"]);
});

test("saveMonthRun still succeeds (ok:true) even when the replacement index fails to build", async () => {
  const dir = withDeniedFolder(createMemoryDirectory(), "replacement-index");
  const result = await saveMonthRun({ directoryHandle: dir, ...baseParams });

  expect(result.ok).toBe(true);
  // Confirms the simulated failure actually happened (not a vacuous pass).
  const manifest = await loadReplacementIndexManifest(dir, "5-may-2026");
  expect(manifest).toBeNull();
});

test("updateMonthStatus survives concurrent advances without losing the higher status (cross-machine CAS)", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  // Two PCs advance the same month at once: one to "sampled", one to
  // "distributed". The monotonic CAS read-modify-write must converge on the
  // higher rank ("distributed") with neither write throwing or corrupting the
  // manifest — no lost advance regardless of which runs first.
  await Promise.all([
    updateMonthStatus(dir, "5-may-2026", "sampled"),
    updateMonthStatus(dir, "5-may-2026", "distributed"),
  ]);

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  const manifest = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  expect(manifest.value.status).toBe("distributed");
});

it("loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws", async () => {
  // Arrange: create legacy directory structure (1-population/{month}/sample/sample.master.json)
  // but no 2-samples folder — so getSampleMainDir will throw
  const root = createMemoryDirectory("root");

  // Build: 1-population/5-may-2026/month.manifest.json
  const populationDir = await root.getDirectoryHandle("1-population", { create: true });
  const monthDir = await populationDir.getDirectoryHandle("5-may-2026", { create: true });

  // Write a minimal manifest so listMonthFolders picks it up
  await safeWriteJson(monthDir, "month.manifest.json", {
    monthFolderName: "5-may-2026",
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

  // Write sample data in legacy location: 1-population/5-may-2026/sample/sample.master.json
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
