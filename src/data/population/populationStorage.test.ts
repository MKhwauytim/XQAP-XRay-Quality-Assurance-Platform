import { expect, it, test } from "vitest";

import { createMemoryDirectory, getReadLog, clearReadLog } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveMonthRun, loadAllPopulationRows, loadAllSampleRows, loadAllRawRows, loadBrowseRows, updateMonthStatus, loadMonthForEditing, loadMonthPopulationFinalRawText } from "./populationStorage";
import { loadReplacementBucket, loadReplacementIndexManifest } from "./replacementIndexStorage";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvent } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import type { MonthManifestData, MonthRawData, PopulationFinalData, ProcessingSummaryData } from "./monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { closeMonth } from "./monthLock";

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

// Phase A (Large-Population Performance Proposal) regression lock: Reports/index.tsx's
// generate("sample"|"sample-xlsx"|"sample-deck") calls `loadMonthForEditing(directoryHandle,
// selectedMonth)` with NO scope argument, then falls back to `populationRows ?? []` -- a scope
// change that stopped loading population for this call site would silently degrade to an empty
// array, not throw, so a real regression here would only surface as a blank/empty exported
// report, not a test failure anywhere else. This pins the exact no-scope call shape that call
// site depends on: it must keep returning the full population for a processed+sampled month.
test("loadMonthForEditing with no scope argument returns non-empty populationRows for a processed+sampled month (Reports/index.tsx:382 contract)", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveSampleMaster(dir, "5-may-2026", makeSample());

  const { populationRows, sampleData } = await loadMonthForEditing(dir, "5-may-2026");

  expect(sampleData).not.toBeNull();
  expect(populationRows).not.toBeNull();
  expect(populationRows).toHaveLength(1);
  expect((populationRows ?? [])[0]?.xrayImageId).toBe("A001");
});

// MonthLoadScope (Phase A step 2): each requested piece reads exactly its own
// file(s) and nothing more, and an unrequested piece performs NO read at all --
// the property "an employee landing on a screen that only needs sample data
// never reads population.final.json/risk.raw.json/bi.raw.json" depends on.
test("MonthLoadScope: an empty scope reads nothing but the manifest", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveSampleMaster(dir, "5-may-2026", makeSample());
  // saveMonthRun/saveSampleMaster's own safeWriteJson verify-read-back leaves entries
  // here too -- clear so the log below reflects only loadMonthForEditing's own reads.
  clearReadLog(dir);

  const data = await loadMonthForEditing(dir, "5-may-2026", {});

  expect(data.populationRows).toBeNull();
  expect(data.processingSummary).toBeNull();
  expect(data.sampleData).toBeNull();
  expect(data.distributionCurrent).toBeNull();
  expect(data.riskRawRows).toEqual([]);
  expect(data.biRawRows).toEqual([]);
  expect(getReadLog(dir)).toEqual(["1-population/5-may-2026/month.manifest.json"]);
});

test("MonthLoadScope: { summary: true } reads only the manifest + processing.summary.json", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    processingSummary: {
      removedRows: [],
      duplicateRows: [],
      invalidResultRows: [],
      summary: { riskOriginalRows: 1, validRiskIdRows: 1, invalidRiskIdRows: 0, duplicateRiskIdRows: 0, rowsAfterDeduplication: 1, removedInvalidResultRows: 0, finalPreparedPopulationRows: 1, certScanRows: 0, nonCertScanRows: 1, certScanPercentage: 0, nonCertScanPercentage: 100, biProvided: false, biMatchedRows: 0, biUnmatchedRows: 0, biMatchPercentage: 0, totalBiFilledFields: 0, biFieldFillSummary: [] },
    },
  });
  clearReadLog(dir); // discard saveMonthRun's own verify-read-back entries

  const data = await loadMonthForEditing(dir, "5-may-2026", { summary: true });

  expect(data.processingSummary).not.toBeNull();
  expect(data.populationRows).toBeNull();
  expect(data.sampleData).toBeNull();
  expect(getReadLog(dir)).toEqual([
    "1-population/5-may-2026/month.manifest.json",
    "1-population/5-may-2026/2-processed/processing.summary.json",
  ]);
});

test("MonthLoadScope: { sample: true, distribution: true } reads manifest + sample, never population/raw", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await saveSampleMaster(dir, "5-may-2026", makeSample());
  // loadOrDeriveDistributionCurrent returns null for zero events (nothing assigned yet) --
  // append one so this test exercises a genuinely non-null distribution, not just the
  // no-assignments-yet null case (which the empty-scope test above already covers).
  await appendDistributionEvent(
    dir,
    "5-may-2026",
    buildAssignEvent({ xrayImageId: "A001", assignedTo: "employee-1", eventBy: "admin" }),
  );
  clearReadLog(dir); // discard the setup calls' own verify-read-back entries

  const data = await loadMonthForEditing(dir, "5-may-2026", { sample: true, distribution: true });

  expect(data.sampleData?.rows).toEqual([{ xrayImageId: "A001" }]);
  expect(data.distributionCurrent).not.toBeNull();
  expect(data.populationRows).toBeNull();
  expect(data.riskRawRows).toEqual([]);
  const readLog = getReadLog(dir);
  expect(readLog).toContain("1-population/5-may-2026/month.manifest.json");
  expect(readLog.some((path) => path.includes("population.final.json"))).toBe(false);
  expect(readLog.some((path) => path.includes("risk.raw.json") || path.includes("bi.raw.json"))).toBe(false);
});

test("MonthLoadScope: { raw: true } still honors the manifest-status gate (A1) -- no read once processed", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  await saveMonthRun({ directoryHandle: dir, ...baseParams }); // leaves status "processed-saved"
  clearReadLog(dir); // discard saveMonthRun's own verify-read-back entries

  const data = await loadMonthForEditing(dir, "5-may-2026", { raw: true });

  expect(data.riskRawRows).toEqual([]);
  expect(data.biRawRows).toEqual([]);
  const readLog = getReadLog(dir);
  expect(readLog.some((path) => path.includes("raw.json"))).toBe(false);
});

// Owner requirement (2026-08-07): "إدارة بيانات الأشعة once data is processed
// and finished ... it never load the population or raw it read the static the
// final output ... since its already done and sit in stone" -- once a month is
// LOCKED, loadMonthForEditing must perform ZERO reads of population.final.json/
// risk.raw.json/bi.raw.json even when the caller's scope explicitly asks for
// them, and must instead read the persisted aggregate.
test("Locked month: { population: true, raw: true } reads manifest + aggregate only, never population/raw files", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  const summary: ProcessingSummaryData["summary"] = {
    riskOriginalRows: 1, validRiskIdRows: 1, invalidRiskIdRows: 0, duplicateRiskIdRows: 0,
    rowsAfterDeduplication: 1, removedInvalidResultRows: 0, finalPreparedPopulationRows: 1,
    certScanRows: 0, nonCertScanRows: 1, certScanPercentage: 0, nonCertScanPercentage: 100,
    biProvided: false, biMatchedRows: 0, biUnmatchedRows: 0, biMatchPercentage: 0,
    totalBiFilledFields: 0, biFieldFillSummary: [],
  };
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    processingSummary: { removedRows: [], duplicateRows: [], invalidResultRows: [], summary },
  });
  const closeResult = await closeMonth(dir, "5-may-2026", "test-admin");
  expect(closeResult.ok).toBe(true);
  clearReadLog(dir); // discard setup's own writes/verify-reads

  const data = await loadMonthForEditing(dir, "5-may-2026", { population: true, raw: true, summary: true });

  expect(data.populationLocked).toBe(true);
  expect(data.populationRows).toBeNull();
  expect(data.riskRawRows).toEqual([]);
  expect(data.biRawRows).toEqual([]);
  expect(data.populationAggregate?.status).toBe("ok");
  if (data.populationAggregate?.status === "ok") {
    expect(data.populationAggregate.aggregate.summary.finalPreparedPopulationRows).toBe(1);
  }

  const readLog = getReadLog(dir);
  expect(readLog.some((path) => path.includes("population.final.json"))).toBe(false);
  expect(readLog.some((path) => path.includes("risk.raw.json") || path.includes("bi.raw.json"))).toBe(false);
  expect(readLog.some((path) => path.includes("population.aggregate.json"))).toBe(true);
});

test("Locked month with no aggregate on disk (pre-feature month): populationAggregate reports 'missing', never falls back to reading rows", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  await saveMonthRun({ directoryHandle: dir, ...baseParams }); // no processingSummary -> no aggregate written
  const closeResult = await closeMonth(dir, "5-may-2026", "test-admin");
  expect(closeResult.ok).toBe(true);
  clearReadLog(dir);

  const data = await loadMonthForEditing(dir, "5-may-2026", { population: true });

  expect(data.populationLocked).toBe(true);
  expect(data.populationRows).toBeNull();
  expect(data.populationAggregate?.status).toBe("missing");
  const readLog = getReadLog(dir);
  expect(readLog.some((path) => path.includes("population.final.json"))).toBe(false);
});

// Regression guard (2026-08-01 architect review, Phase A): corruption must stay
// explicit under a partial MonthLoadScope -- a corrupt population.final.json that a
// scope never asked to read must not be silently reinterpreted as "not yet
// processed", and a corrupt file that WAS requested must still resolve to null
// (the existing missing-vs-corrupt safe fallback), never throw or return `[]`
// masquerading as a genuinely empty population.
async function corruptPopulationFinalJson(dir: DirectoryHandleLike): Promise<void> {
  const monthDir = await getPopulationMonthDir(dir, "5-may-2026", true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
  const handle = await processedDir.getFileHandle("population.final.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ this is not valid json");
  await writable.close();
}

test("a corrupt population.final.json that scope never requested does not misrepresent the month as unprocessed", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams }); // leaves status "processed-saved"
  await corruptPopulationFinalJson(dir);

  const data = await loadMonthForEditing(dir, "5-may-2026", { summary: true });

  expect(data.populationRows).toBeNull();
  expect(data.manifest?.status).toBe("processed-saved"); // manifest itself is untouched, still readable
});

test("a corrupt population.final.json that scope DOES request resolves to null, not [] or a throw", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });
  await corruptPopulationFinalJson(dir);

  const data = await loadMonthForEditing(dir, "5-may-2026", { population: true });

  expect(data.populationRows).toBeNull();
  expect(data.certScanRows).toBe(0);
  expect(data.nonCertScanRows).toBe(0);
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

// Phase B Task 5 (parallelize the "all months" browse-aggregation loop with
// mapWithConcurrency): wraps every file read inside `monthFolderName`'s subtree
// with an artificial delay, so that month's read is guaranteed to be the LAST
// one to actually resolve even though it is earlier in listMonthFolders'
// chronological order (and therefore earlier in the `months` array these
// functions iterate). Used below to prove loadAllPopulationRows /
// loadAllSampleRows / loadAllRawRows merge by month-list INDEX, not by
// whichever month's read happens to finish first once parallelized.
function delayReadsForMonth(
  dir: DirectoryHandleLike,
  monthFolderName: string,
  delayMs: number
): DirectoryHandleLike {
  function wrap(handle: DirectoryHandleLike, insideTarget: boolean): DirectoryHandleLike {
    return {
      ...handle,
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        const child = await handle.getDirectoryHandle(name, options);
        return wrap(child, insideTarget || name === monthFolderName);
      },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const fh = await handle.getFileHandle(name, options);
        if (!insideTarget) return fh;
        return {
          ...fh,
          getFile: async () => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return fh.getFile();
          },
        };
      },
    };
  }
  return wrap(dir, false);
}

// Characterization test (write BEFORE parallelizing, per the plan): proves the
// dedup semantics loadAllPopulationRows must preserve once its sequential loop
// becomes a mapWithConcurrency fan-out -- for the same xrayImageId appearing in
// two different months, the chronologically LATER month's row always wins the
// Map merge, regardless of which month's underlying file read actually
// resolves first. The 5-may-2026 read is deliberately delayed past the
// 6-june-2026 read to force the "wrong" completion order a naive
// (non-index-addressed) concurrent rewrite could get wrong.
test("loadAllPopulationRows: the chronologically later month wins a duplicate xrayImageId, even when its read resolves before the earlier month's (index-addressed merge order)", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams }); // 5-may-2026, A001 / NonCertscan
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    month: 6,
    processedRows: [{ xrayImageId: "A001", certScanStatus: "CertScan" }],
  }); // 6-june-2026, same id, different data

  const delayed = delayReadsForMonth(dir, "5-may-2026", 30);

  const rows = await loadAllPopulationRows(delayed);
  const merged = rows.filter((row) => row.xrayImageId === "A001");

  expect(merged).toHaveLength(1); // deduped, not two entries
  expect(merged[0]?._monthFolder).toBe("6-june-2026");
  expect(merged[0]?.certScanStatus).toBe("CertScan");
});

// Same index-addressed-order property, but for the flat-concatenation shape
// shared by loadAllSampleRows/loadAllRawRows (no dedup -- every month's rows
// are appended, in month-list order). Delaying the earlier month's read must
// not let its rows land after the later month's in the final array.
test("loadAllSampleRows: rows stay in month-chronological order even when the earlier month's read resolves last", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams }); // 5-may-2026
  await saveSampleMaster(dir, "5-may-2026", { ...makeSample(), rows: [{ xrayImageId: "A001" } as never] });
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    month: 6,
    processedRows: [{ xrayImageId: "B001", certScanStatus: "NonCertscan" }],
  }); // 6-june-2026
  await saveSampleMaster(dir, "6-june-2026", { ...makeSample(), rows: [{ xrayImageId: "B001" } as never] });

  const delayed = delayReadsForMonth(dir, "5-may-2026", 30);

  const rows = await loadAllSampleRows(delayed);
  expect(rows.map((row) => row.xrayImageId)).toEqual(["A001", "B001"]);
});

test("loadAllRawRows: rows stay in month-chronological order even when the earlier month's read resolves last", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams, riskRawRows: [{ id: "R-MAY" }] }); // 5-may-2026
  await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    month: 6,
    riskRawRows: [{ id: "R-JUNE" }],
    processedRows: [{ xrayImageId: "B001", certScanStatus: "NonCertscan" }],
  }); // 6-june-2026

  const delayed = delayReadsForMonth(dir, "5-may-2026", 30);

  const rows = await loadAllRawRows(delayed, "risk");
  expect(rows.map((row) => row.id)).toEqual(["R-MAY", "R-JUNE"]);
});

// Task 3 (parallelize saveMonthRunLocked's independent writes): end-state
// characterization -- exercises every write saveMonthRunLocked now fires
// concurrently (risk.raw.json + bi.raw.json in the first Promise.all group,
// the replacement-index rebuild + processing.summary.json in the second) and
// confirms each one's *content* landed correctly. Passes against both the
// pre-refactor sequential code and the post-refactor concurrent code -- it
// asserts only on final on-disk state, never on write ordering.
test("saveMonthRun writes all expected files and the manifest reflects the final state, regardless of write ordering", async () => {
  const dir = createMemoryDirectory();
  const result = await saveMonthRun({
    directoryHandle: dir,
    ...baseParams,
    biRawRows: [{ id: "B001", port: "بحري" }],
    processingSummary: {
      removedRows: [],
      duplicateRows: [],
      invalidResultRows: [],
      summary: { riskOriginalRows: 1, validRiskIdRows: 1, invalidRiskIdRows: 0, duplicateRiskIdRows: 0, rowsAfterDeduplication: 1, removedInvalidResultRows: 0, finalPreparedPopulationRows: 1, certScanRows: 0, nonCertScanRows: 1, certScanPercentage: 0, nonCertScanPercentage: 100, biProvided: false, biMatchedRows: 0, biUnmatchedRows: 0, biMatchPercentage: 0, totalBiFilledFields: 0, biFieldFillSummary: [] },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const monthDir = await getPopulationMonthDir(dir, "5-may-2026", false);
  const manifestResult = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
  expect(manifestResult.ok).toBe(true);
  if (!manifestResult.ok) return;
  expect(manifestResult.value.totalProcessedRows).toBe(1);
  expect(manifestResult.value.totalRawRows).toBe(1);
  expect(manifestResult.value.processingSummaryFile).toBe(`${POPULATION_SUBFOLDERS.processed}/processing.summary.json`);

  const rawDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.raw, { create: false });
  const riskRaw = await safeReadJson<MonthRawData>(rawDir, "risk.raw.json");
  const biRaw = await safeReadJson<MonthRawData>(rawDir, "bi.raw.json");
  expect(riskRaw.ok).toBe(true);
  expect(biRaw.ok).toBe(true);
  if (riskRaw.ok) expect(riskRaw.value.rows).toHaveLength(1);
  if (biRaw.ok) expect(biRaw.value.rows).toHaveLength(1);

  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
  const finalData = await safeReadJson<PopulationFinalData>(processedDir, "population.final.json");
  expect(finalData.ok).toBe(true);
  if (finalData.ok) {
    expect(finalData.value.rows).toHaveLength(1);
    expect(finalData.value.nonCertScanRows).toBe(1);
  }

  const summaryResult = await safeReadJson<ProcessingSummaryData>(processedDir, "processing.summary.json");
  expect(summaryResult.ok).toBe(true);
  if (summaryResult.ok) {
    expect(summaryResult.value.summary.finalPreparedPopulationRows).toBe(1);
  }

  const indexManifest = await loadReplacementIndexManifest(dir, "5-may-2026");
  expect(indexManifest).not.toBeNull();
  expect(indexManifest?.totalIndexedRows).toBe(1);
});

// I1: loadMonthPopulationFinalRawText deliberately bypasses safeReadJson (it exists
// precisely to avoid safeReadJson's main-thread JSON.parse of a 200k-400k row file),
// which also bypassed safeReadJson's live -> .bak -> .tmp recovery ladder. These
// characterize the raw-text-level ladder that restores it.
async function processedDirOf(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(dir, "5-may-2026", false);
  return monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
}

test("loadMonthPopulationFinalRawText returns the live population.final.json text", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const rawText = await loadMonthPopulationFinalRawText(dir, "5-may-2026");
  expect(rawText).not.toBeNull();
  expect(JSON.parse(rawText as string)).toBeTruthy();
});

test("loadMonthPopulationFinalRawText falls back to the .bak snapshot when the live file is gone", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const processedDir = await processedDirOf(dir);
  // Seed a .bak the way a previous safe write would have left one, then lose the
  // live file (the exact scenario safeReadJson's ladder exists for).
  const liveText = (await loadMonthPopulationFinalRawText(dir, "5-may-2026")) as string;
  const bakHandle = await processedDir.getFileHandle("population.final.json.bak", { create: true });
  const writable = await bakHandle.createWritable!();
  await writable.write(liveText);
  await writable.close();
  await processedDir.removeEntry?.("population.final.json");

  const recovered = await loadMonthPopulationFinalRawText(dir, "5-may-2026");
  expect(recovered).toBe(liveText);
});

test("loadMonthPopulationFinalRawText still returns null when neither the live file nor any snapshot exists", async () => {
  const dir = createMemoryDirectory();
  await saveMonthRun({ directoryHandle: dir, ...baseParams });

  const processedDir = await processedDirOf(dir);
  await processedDir.removeEntry?.("population.final.json");

  expect(await loadMonthPopulationFinalRawText(dir, "5-may-2026")).toBeNull();
});
