// switchingRuleAdvisory had no colocated tests. Phase 1.8 changed how it sources
// the prior-month suspicion rate, so the behaviour is pinned here first:
// the cheap path must be used when available, the fallback must still be
// correct for months that predate it, and — the point of the change — the
// prior month's population.final.json must not be read on the common path.

import { expect, test } from "vitest";

import { createMemoryDirectory, getReadLog, clearReadLog } from "../storage/memoryDirectory";
import { saveMonthRun } from "../population/populationStorage";
import {
  buildPopulationAggregate,
  loadPopulationAggregate,
  savePopulationAggregate,
} from "../population/populationAggregate";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow, ProcessingSummary } from "../population/populationTypes";
import { loadPriorMonthAdvisory, findPriorMonthFolder } from "./switchingRuleAdvisory";
import { SUSPICION_TIGHTEN_THRESHOLD } from "./samplingPlanStorage";

/** `n` rows of which `suspicious` carry an affirmative level-two result. */
function rows(n: number, suspicious: number): PreparedPopulationRow[] {
  return Array.from({ length: n }, (_, i) => ({
    xrayImageId: `A${i}`,
    certScanStatus: "NonCertscan",
    xrayLevelTwoResult: i < suspicious ? "اشتباه" : "مطابق",
  })) as unknown as PreparedPopulationRow[];
}

const summary = {} as ProcessingSummary;

/** Saves a processed month whose population carries the given rows. */
async function seedMonth(
  dir: DirectoryHandleLike,
  month: number,
  year: number,
  populationRows: PreparedPopulationRow[]
): Promise<string> {
  const result = await saveMonthRun({
    directoryHandle: dir,
    month,
    year,
    username: "test-admin",
    riskFileName: "risk.xlsx",
    biFileName: null,
    certScanUsed: false,
    riskRawRows: [{ id: "A0", port: "بري" }],
    biRawRows: [],
    processedRows: populationRows as unknown as Record<string, unknown>[],
    certScanRows: 0,
    nonCertScanRows: populationRows.length,
  });
  if (!result.ok) throw new Error("seedMonth failed");
  return result.monthFolderName;
}

test("1.8: uses the aggregate's stored rate and never reads the prior month's population", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  // 10% suspicion — above the tighten threshold, so the recommendation is
  // distinguishable from the "no signal" result.
  const priorRows = rows(100, 10);
  const priorFolder = await seedMonth(dir, 4, 2026, priorRows);
  await seedMonth(dir, 5, 2026, rows(10, 0));

  await savePopulationAggregate(
    dir,
    priorFolder,
    buildPopulationAggregate({
      monthFolderName: priorFolder,
      computedBy: "test-admin",
      summary,
      preparedRows: priorRows,
    })
  );

  clearReadLog(dir);
  const advisory = await loadPriorMonthAdvisory(dir, "5-may-2026");

  expect(advisory.priorMonthFolderName).toBe(priorFolder);
  expect(advisory.priorMonthSuspicionRate).toBeCloseTo(0.1);
  expect(advisory.inspectionRecommendation).toBe("tightened-review");

  // The whole point of 1.8: the largest file in the month is not opened.
  const readLog = getReadLog(dir);
  expect(readLog.some((p) => p.includes("population.final.json"))).toBe(false);
  expect(readLog.some((p) => p.includes("population.aggregate.json"))).toBe(true);
});

test("1.8: buildPopulationAggregate persists the rate it computed", async () => {
  const dir = createMemoryDirectory();
  const priorRows = rows(200, 4); // 2%
  const folder = await seedMonth(dir, 4, 2026, priorRows);

  await savePopulationAggregate(
    dir,
    folder,
    buildPopulationAggregate({
      monthFolderName: folder,
      computedBy: "test-admin",
      summary,
      preparedRows: priorRows,
    })
  );

  const loaded = await loadPopulationAggregate(dir, folder);
  expect(loaded.status).toBe("ok");
  if (loaded.status !== "ok") return;
  expect(loaded.aggregate.suspicionRate).toBeCloseTo(0.02);
  // Below the threshold -> the advisory must not recommend tightening.
  expect(0.02).toBeLessThan(SUSPICION_TIGHTEN_THRESHOLD);
});

test("1.8: falls back to the population when the aggregate predates the field", async () => {
  const dir = createMemoryDirectory();
  const priorRows = rows(100, 20); // 20%
  const priorFolder = await seedMonth(dir, 4, 2026, priorRows);
  await seedMonth(dir, 5, 2026, rows(10, 0));

  // An aggregate written before 1.8: structurally valid, no suspicionRate.
  const legacy = buildPopulationAggregate({
    monthFolderName: priorFolder,
    computedBy: "test-admin",
    summary,
    preparedRows: priorRows,
  });
  delete (legacy as { suspicionRate?: number | null }).suspicionRate;
  const monthDir = await getPopulationMonthDir(dir, priorFolder, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
    create: true,
  });
  await safeWriteJson(processedDir, "population.aggregate.json", legacy);

  const advisory = await loadPriorMonthAdvisory(dir, "5-may-2026");

  // Correct rate, recovered the expensive way rather than reported wrong.
  expect(advisory.priorMonthSuspicionRate).toBeCloseTo(0.2);
  expect(advisory.inspectionRecommendation).toBe("tightened-review");
});

test("1.8: falls back when no aggregate exists at all", async () => {
  const dir = createMemoryDirectory();
  const priorFolder = await seedMonth(dir, 4, 2026, rows(50, 5)); // 10%
  await seedMonth(dir, 5, 2026, rows(10, 0));
  expect(priorFolder).toBe("4-april-2026");

  const advisory = await loadPriorMonthAdvisory(dir, "5-may-2026");
  expect(advisory.priorMonthSuspicionRate).toBeCloseTo(0.1);
});

test("a stored rate of zero is a real signal, not a missing one", async () => {
  const dir = createMemoryDirectory();
  const priorRows = rows(80, 0);
  const priorFolder = await seedMonth(dir, 4, 2026, priorRows);
  await seedMonth(dir, 5, 2026, rows(10, 0));

  await savePopulationAggregate(
    dir,
    priorFolder,
    buildPopulationAggregate({
      monthFolderName: priorFolder,
      computedBy: "test-admin",
      summary,
      preparedRows: priorRows,
    })
  );

  const advisory = await loadPriorMonthAdvisory(dir, "5-may-2026");
  expect(advisory.priorMonthSuspicionRate).toBe(0);
  expect(advisory.inspectionRecommendation).toBe("normal");
});

test("findPriorMonthFolder skips gaps and ignores later months", async () => {
  const dir = createMemoryDirectory();
  await seedMonth(dir, 1, 2026, rows(1, 0));
  await seedMonth(dir, 4, 2026, rows(1, 0)); // most recent earlier month
  await seedMonth(dir, 9, 2026, rows(1, 0)); // later — must be ignored

  expect(await findPriorMonthFolder(dir, "5-may-2026")).toBe("4-april-2026");
  expect(await findPriorMonthFolder(dir, "1-january-2026")).toBeNull();
});
