import { describe, expect, it } from "vitest";

import { adhocMonthFolder } from "../adhocImport/adhocImportModel";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import { makePopulationRow, makeSampleMaster } from "../population/populationTestFixtures";
import { liveSampleRows, loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { addPopulationRowsToSample, planPopulationRowsIntoSample } from "./addPopulationRowsToSample";
import { loadOrDeriveDistributionCurrent } from "./distributionStorage";

const JAN = "1-January-2026";
const EMP_A = "jalgahamdi";
const EMP_B = "hihaloraini";
const NOW = new Date("2026-01-15T08:00:00.000Z");

async function seedMonth(root: DirectoryHandleLike, sampleIds: string[], population: Array<[id: string, port?: string]>) {
  const manifest: MonthManifestData = {
    monthFolderName: JAN, month: 1, year: 2026, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false, templateVersion: null, rngSeed: null,
    totalRawRows: 0, totalProcessedRows: population.length, status: "distributed",
  };
  const monthDir = await getPopulationMonthDir(root, JAN, true);
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
  const final: PopulationFinalData = {
    sourceMonthFolder: JAN, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    totalRows: population.length, certScanRows: 0, nonCertScanRows: population.length,
    rows: population.map(([id, port]) => makePopulationRow(id, port)) as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true }), "population.final.json", final);
  expect((await saveSampleMaster(root, JAN, makeSampleMaster(sampleIds.map((id) => makePopulationRow(id))))).ok).toBe(true);
}

async function owners(root: DirectoryHandleLike): Promise<Record<string, string>> {
  const sample = await loadSampleMaster(root, JAN);
  const current = await loadOrDeriveDistributionCurrent(root, JAN, liveSampleRows(sample));
  return Object.fromEntries((current?.entries ?? []).map((entry) => [entry.xrayImageId, entry.assignedTo]));
}

describe("adding filtered population rows to the month's sample", () => {
  it("plans only the rows that are in the population and not yet in any sample", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, ["S1"], [["S1"], ["P1"], ["P2"], ["X1"]]);
    // X1 is already an exceptional case, stored under its ADHOC key.
    const importId = "adh-3f8a1b2c-1111-4222-8333-944455556666";
    await saveSampleMaster(root, adhocMonthFolder(importId), makeSampleMaster([makePopulationRow(`ADHOC-${importId}-X1`)]));

    expect(await planPopulationRowsIntoSample(root, JAN, ["S1", "P1", "P2", "X1", "GONE"])).toEqual({
      ok: true, fresh: ["P1", "P2"], alreadyInSample: 2, notInPopulation: 1,
    });
  });

  it("adds the fresh rows to the sample and splits them evenly between the chosen employees", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, ["S1"], [["S1"], ["P1"], ["P2"], ["P3"], ["P4"]]);

    const result = await addPopulationRowsToSample(root, JAN, ["S1", "P1", "P2", "P3", "P4"], [EMP_A, EMP_B], [], "admin", NOW);

    expect(result).toEqual({ ok: true, added: 4, assigned: 4, unassigned: 0, skipped: 1 });
    const sample = await loadSampleMaster(root, JAN);
    expect(liveSampleRows(sample).map((row) => row.xrayImageId)).toEqual(["S1", "P1", "P2", "P3", "P4"]);
    expect(sample?.totalActual).toBe(5);
    expect(await owners(root)).toEqual({ P1: EMP_A, P2: EMP_B, P3: EMP_A, P4: EMP_B });
    // A second click adds nothing twice.
    expect(await addPopulationRowsToSample(root, JAN, ["P1", "P2"], [EMP_A], [], "admin", NOW))
      .toEqual({ ok: true, added: 0, assigned: 0, unassigned: 0, skipped: 2 });
  });

  it("respects port restrictions and leaves a row nobody may take in the sample unassigned", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, [], [["P1", "جدة"], ["P2", "الدمام"], ["P3", "جدة"]]);
    const restrictions = [
      { username: EMP_A, restricted: true, enabledPorts: ["جدة"] },
      { username: EMP_B, restricted: true, enabledPorts: ["جدة"] },
    ];

    const result = await addPopulationRowsToSample(root, JAN, ["P1", "P2", "P3"], [EMP_A, EMP_B], restrictions, "admin", NOW);

    expect(result).toEqual({ ok: true, added: 3, assigned: 2, unassigned: 1, skipped: 0 });
    expect(await owners(root)).toEqual({ P1: EMP_A, P3: EMP_B });
  });

  it("refuses when no employee is chosen or one is not on the roster, and writes nothing", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root, [], [["P1"]]);
    expect(await addPopulationRowsToSample(root, JAN, ["P1"], [], [], "admin", NOW)).toMatchObject({ ok: false });
    expect(await addPopulationRowsToSample(root, JAN, ["P1"], [EMP_A, "nobody"], [], "admin", NOW)).toMatchObject({ ok: false });
    expect((await loadSampleMaster(root, JAN))?.rows).toEqual([]);
  });
});
