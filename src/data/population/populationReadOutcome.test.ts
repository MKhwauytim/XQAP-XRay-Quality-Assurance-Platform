import { expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import {
  PopulationUnreadableError,
  readMonthPopulationFinal,
  readMonthPopulationFinalRawText,
  saveMonthRun,
} from "./populationStorage";
import { findPopulationRowById } from "./populationRowLookup";
import { getReplacementCandidatesIndexed } from "../distribution/replacementCandidateLookup";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { PreparedPopulationRow } from "./populationTypes";

/**
 * T-08 — "could not read" must never be reported as "does not exist".
 *
 * A month whose `population.final.json` is present but unreadable (the ordinary
 * transient SMB failure this app runs on) used to reach every consumer as the
 * same `null` a never-processed month produces. Downstream that rendered the
 * empty state, whose own copy invites the user to re-process the month — the
 * one click that destroys the data that is in fact still on disk.
 */

const MONTH = "5-may-2026";

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
  nonCertScanRows: 1,
};

async function processedDirOf(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(dir, MONTH, false);
  return monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
}

/** Every rung of the live -> .bak -> .tmp ladder becomes permanently unreadable. */
function breakEveryRead(dir: DirectoryHandleLike): void {
  setSimulatedFaults(dir, [
    {
      operation: "getFile",
      errorName: "NotReadableError",
      times: Number.POSITIVE_INFINITY,
    },
  ]);
}

async function seedMonth(): Promise<DirectoryHandleLike> {
  const dir = createMemoryDirectory();
  const saved = await saveMonthRun({ directoryHandle: dir, ...baseParams });
  expect(saved.ok).toBe(true);
  return dir;
}

test("readMonthPopulationFinalRawText reports an unreadable month as unreadable, not absent", async () => {
  const dir = await seedMonth();
  breakEveryRead(dir);

  const outcome = await readMonthPopulationFinalRawText(dir, MONTH);
  expect(outcome.status).toBe("unreadable");
});

test("readMonthPopulationFinalRawText reports a month with no saved file as absent", async () => {
  const dir = await seedMonth();
  const processedDir = await processedDirOf(dir);
  await processedDir.removeEntry?.("population.final.json");

  const outcome = await readMonthPopulationFinalRawText(dir, MONTH);
  expect(outcome.status).toBe("absent");
});

test("readMonthPopulationFinal separates an unreadable month from an unprocessed one", async () => {
  const dir = await seedMonth();
  breakEveryRead(dir);
  expect((await readMonthPopulationFinal(dir, MONTH)).status).toBe("unreadable");

  const clean = await seedMonth();
  const processedDir = await processedDirOf(clean);
  await processedDir.removeEntry?.("population.final.json");
  expect((await readMonthPopulationFinal(clean, MONTH)).status).toBe("absent");
});

test("findPopulationRowById distinguishes an unreadable population from an absent one", async () => {
  const dir = await seedMonth();
  breakEveryRead(dir);

  const unreadable = await findPopulationRowById(dir, MONTH, "A001");
  expect(unreadable.ok).toBe(false);
  if (!unreadable.ok) expect(unreadable.reason).toBe("unreadable");

  const clean = await seedMonth();
  const processedDir = await processedDirOf(clean);
  await processedDir.removeEntry?.("population.final.json");
  const absent = await findPopulationRowById(clean, MONTH, "A001");
  expect(absent.ok).toBe(false);
  if (!absent.ok) expect(absent.reason).toBe("absent");
});

test("the replacement flow refuses an unreadable month instead of reporting zero candidates", async () => {
  const dir = await seedMonth();
  breakEveryRead(dir);

  const deadRow = {
    xrayImageId: "A001",
    certScanStatus: "NonCertscan",
    portName: "بري",
    stage: "المرحلة الأولى",
  } as unknown as PreparedPopulationRow;
  const entry = {
    xrayImageId: "A001",
    assignedTo: "emp1",
    status: "assigned",
    row: deadRow,
  } as unknown as DistributionEntry;
  const sampleMaster = {
    rngSeed: 12345,
    rows: [deadRow],
  } as unknown as SampleMasterData;

  await expect(
    getReplacementCandidatesIndexed(dir, MONTH, entry, sampleMaster, [entry])
  ).rejects.toBeInstanceOf(PopulationUnreadableError);
});
