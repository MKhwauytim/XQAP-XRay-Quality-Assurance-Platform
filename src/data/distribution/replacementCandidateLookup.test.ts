import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "./distributionTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getReplacementCandidates } from "./replacement";
import { getReplacementCandidatesIndexed } from "./replacementCandidateLookup";
import {
  loadReplacementIndexManifest,
  rebuildReplacementIndex,
} from "../population/replacementIndexStorage";

const MONTH = "5-may-2026";

const makeRow = (
  id: string,
  stage: string,
  port: string,
  certScan: "Certscan" | "NonCertscan" = "Certscan"
): PreparedPopulationRow => ({
  xrayImageId: id,
  stage,
  portName: port,
  certScanStatus: certScan,
  xrayEntryDate: null,
  portCode: null,
  portType: null,
  declarationNumber: null,
  declarationDate: null,
  plateOrContainerNumber: null,
  chassisNumber: null,
  xrayLevelOneResult: "سليمة",
  xrayLevelTwoResult: "سليمة",
  movementType: null,
  reportNumber: null,
  targetedByRiskEngine: null,
  riskMessage: null,
  levelOneEmployee: null,
  levelTwoEmployee: null,
  otherResults: {
    manual: { result: null, code: null, employeeId: null },
    opposite: { result: null, code: null, employeeId: null },
    liveMeans: { result: null, code: null, employeeId: null },
  },
  notes: null,
  certScanSnippet: null,
  originalCertScanSnippet: null,
  biEnrichmentStatus: "BI Not Provided",
  biMatched: false,
  biFilledFields: [],
  sourceSheetName: "Sheet1",
  sourceRowNumber: 1,
});

function makeEntry(row: PreparedPopulationRow, assignedTo = "expert1"): DistributionEntry {
  return {
    xrayImageId: row.xrayImageId,
    assignedTo,
    status: "pending",
    replacedById: null,
    row,
    lastEventAt: new Date().toISOString(),
  };
}

function makeSampleMaster(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed-xyz",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: 0,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

/** Directly stages population.final.json + a matching index at revision 1,
 *  bypassing saveMonthRun so tests can control the two independently. */
async function seedFreshMonth(
  root: DirectoryHandleLike,
  rows: PreparedPopulationRow[]
): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
  await safeWriteJson(processedDir, "population.final.json", {
    sourceMonthFolder: MONTH,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    totalRows: rows.length,
    certScanRows: rows.filter((r) => r.certScanStatus === "Certscan").length,
    nonCertScanRows: rows.filter((r) => r.certScanStatus === "NonCertscan").length,
    rows,
  });
  const outcome = await rebuildReplacementIndex(root, MONTH, rows, undefined, 1, "test");
  expect(outcome.ok).toBe(true);
}

describe("getReplacementCandidatesIndexed", () => {
  it("uses only the matching bucket file — result is wrong unless the index (not the mismatched population.final.json) was read", async () => {
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "المستوى الأول", "PortA");
    const entry = makeEntry(deadRow);
    const indexedRows = [deadRow, makeRow("from-index", "المستوى الأول", "PortA")];
    await seedFreshMonth(root, indexedRows);

    // Overwrite population.final.json (bumping its revision) WITHOUT rebuilding
    // the index, with deliberately different content — if the lookup wrongly
    // fell back to the full scan, "from-index" would be absent from the result.
    const monthDir = await getPopulationMonthDir(root, MONTH, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    await safeWriteJson(processedDir, "population.final.json", {
      sourceMonthFolder: MONTH,
      processedAt: new Date().toISOString(),
      processedBy: "admin",
      totalRows: 1,
      certScanRows: 1,
      nonCertScanRows: 0,
      rows: [deadRow],
    });
    // Restore the index to match this new revision (2) so the lookup sees it as fresh.
    await rebuildReplacementIndex(root, MONTH, indexedRows, undefined, 2, "test");

    const sampleMaster = makeSampleMaster([deadRow]);
    const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    expect(result.recommended.map((r) => r.xrayImageId)).toEqual(["from-index"]);
  });

  it("handles a dead row whose own stage text is unmapped (\"unknown\")", async () => {
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "نص غير معروف", "PortA");
    const entry = makeEntry(deadRow);
    const rows = [deadRow, makeRow("candidate", "نص غير معروف", "PortA")];
    await seedFreshMonth(root, rows);

    const sampleMaster = makeSampleMaster([deadRow]);
    const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    expect(result.recommended.map((r) => r.xrayImageId)).toEqual(["candidate"]);
  });

  it("falls back to the full scan (not silent under-counting) when the manifest lists a bucket that fails to read", async () => {
    // A bucket the manifest claims exists but is actually missing/corrupt must
    // never be silently treated as "this bucket legitimately has zero rows" —
    // that would under-report candidates instead of safely falling back.
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "المستوى الأول", "PortA");
    const entry = makeEntry(deadRow);
    const rows = [deadRow, makeRow("candidate", "المستوى الأول", "PortA")];
    await seedFreshMonth(root, rows);

    const monthDir = await getPopulationMonthDir(root, MONTH, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    const indexDir = await processedDir.getDirectoryHandle("replacement-index", { create: false });
    // Delete the primary bucket file directly, WITHOUT updating the manifest —
    // the manifest still lists it as present.
    await indexDir.removeEntry?.("certscan.first.json");

    const sampleMaster = makeSampleMaster([deadRow]);
    const expected = getReplacementCandidates(entry, rows, sampleMaster, [entry]);
    const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    expect(result).toEqual(expected);
    expect(result.recommended.map((r) => r.xrayImageId)).toEqual(["candidate"]); // not silently empty
  });

  it("cascade compares POST-DEDUP supply, not the manifest's raw rowCount", async () => {
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "المستوى الأول", "PortA");
    const entry = makeEntry(deadRow);
    // Stage "first" has 5 raw rows but all 5 are pre-sampled (excluded) -> 0 supply.
    const firstStageRows = Array.from({ length: 5 }, (_, i) => makeRow(`first-${i}`, "المستوى الأول", "PortA"));
    // Stage "second" has only 2 raw rows, none sampled -> 2 supply (the real winner).
    const secondStageRows = [
      makeRow("second-1", "المستوى الثاني", "PortA"),
      makeRow("second-2", "المستوى الثاني", "PortA"),
    ];
    const allRows = [deadRow, ...firstStageRows, ...secondStageRows];
    await seedFreshMonth(root, allRows);

    const sampleMaster = makeSampleMaster([deadRow, ...firstStageRows]); // all of "first" excluded
    const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    expect(result.recommended).toEqual([]);
    expect(result.all.map((r) => r.xrayImageId).sort()).toEqual(["second-1", "second-2"]);
  });

  it("falls back to the full-population read and matches getReplacementCandidates exactly when the index is missing", async () => {
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "المستوى الأول", "PortA");
    const entry = makeEntry(deadRow);
    const rows = [deadRow, makeRow("c1", "المستوى الأول", "PortA"), makeRow("c2", "المستوى الأول", "PortB")];
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
    await safeWriteJson(processedDir, "population.final.json", {
      sourceMonthFolder: MONTH, processedAt: new Date().toISOString(), processedBy: "admin",
      totalRows: rows.length, certScanRows: rows.length, nonCertScanRows: 0, rows,
    });
    // Deliberately no index built — simulates a legacy month.

    const sampleMaster = makeSampleMaster([deadRow]);
    const expected = getReplacementCandidates(entry, rows, sampleMaster, [entry]);
    const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    expect(result).toEqual(expected);
    expect(await loadReplacementIndexManifest(root, MONTH)).toBeNull();
  });

  it("a missing-index fallback triggers a non-blocking background rebuild", async () => {
    const root = createMemoryDirectory();
    const deadRow = makeRow("dead", "المستوى الأول", "PortA");
    const entry = makeEntry(deadRow);
    const rows = [deadRow, makeRow("c1", "المستوى الأول", "PortA")];
    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
    await safeWriteJson(processedDir, "population.final.json", {
      sourceMonthFolder: MONTH, processedAt: new Date().toISOString(), processedBy: "admin",
      totalRows: rows.length, certScanRows: rows.length, nonCertScanRows: 0, rows,
    });

    const sampleMaster = makeSampleMaster([deadRow]);
    await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

    // The rebuild is fire-and-forget; give its microtasks a turn to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const manifest = await loadReplacementIndexManifest(root, MONTH);
    expect(manifest).not.toBeNull();
  });

  describe("equivalence with the full-scan path (identical ids, identical order)", () => {
    it("normal same-stage case", async () => {
      const root = createMemoryDirectory();
      const deadRow = makeRow("dead", "المستوى الأول", "PortA");
      const entry = makeEntry(deadRow);
      const rows = [
        deadRow,
        makeRow("c1", "المستوى الأول", "PortA"),
        makeRow("c2", "المستوى الأول", "PortB"),
        makeRow("c3", "المستوى الثاني", "PortA"),
      ];
      await seedFreshMonth(root, rows);

      const sampleMaster = makeSampleMaster([deadRow]);
      const expected = getReplacementCandidates(entry, rows, sampleMaster, [entry]);
      const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

      expect(result).toEqual(expected);
    });

    it("cascade case", async () => {
      const root = createMemoryDirectory();
      const deadRow = makeRow("dead", "المستوى الأول", "PortA");
      const entry = makeEntry(deadRow);
      const rows = [
        deadRow,
        makeRow("c1", "المستوى الثاني", "PortA"),
        makeRow("c2", "المستوى الثالث", "PortB"),
        makeRow("c3", "المستوى الثالث", "PortA"),
      ];
      await seedFreshMonth(root, rows);

      const sampleMaster = makeSampleMaster([deadRow]);
      const expected = getReplacementCandidates(entry, rows, sampleMaster, [entry]);
      const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

      expect(result.recommended).toEqual(expected.recommended);
      expect(result.all.map((r) => r.xrayImageId).sort()).toEqual(expected.all.map((r) => r.xrayImageId).sort());
    });

    it("oversized pool (>100) capping case — exercises Fisher-Yates order-sensitivity", async () => {
      const root = createMemoryDirectory();
      const deadRow = makeRow("dead", "المستوى الأول", "PortA");
      const entry = makeEntry(deadRow);
      const rows = [
        deadRow,
        ...Array.from({ length: 150 }, (_, i) => makeRow(`c${i + 1}`, "المستوى الأول", "PortA")),
      ];
      await seedFreshMonth(root, rows);

      const sampleMaster = makeSampleMaster([deadRow]);
      const expected = getReplacementCandidates(entry, rows, sampleMaster, [entry]);
      const result = await getReplacementCandidatesIndexed(root, MONTH, entry, sampleMaster, [entry]);

      expect(result.recommended.map((r) => r.xrayImageId)).toEqual(expected.recommended.map((r) => r.xrayImageId));
      expect(result.all.map((r) => r.xrayImageId)).toEqual(expected.all.map((r) => r.xrayImageId));
      expect(result.all).toHaveLength(100);
    });
  });
});
