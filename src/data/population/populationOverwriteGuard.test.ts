import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvents, __clearDeriveMemoForTests } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { upsertItemAnswer } from "../answers/answerStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun } from "./populationStorage";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";
import {
  OVERWRITE_MISSING_EXAMPLE_LIMIT,
  assessPopulationOverwrite,
  loadPopulationOverwriteImpact,
} from "./populationOverwriteGuard";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

function rowsFor(ids: string[]): Array<Record<string, unknown>> {
  return ids.map((id) => makePopulationRow(id) as unknown as Record<string, unknown>);
}

async function seedMonth(
  root: DirectoryHandleLike,
  options: { distributed: boolean; answered: boolean }
): Promise<void> {
  const first = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["A1", "A2", "A3"]) });
  if (!first.ok) throw new Error(`seed population failed: ${first.error}`);
  const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster([makePopulationRow("A1"), makePopulationRow("A2")]));
  if (!sampled.ok) throw new Error(`seed sample failed: ${sampled.error}`);
  if (options.distributed) {
    const assigned = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    ]);
    if (!assigned.ok) throw new Error(`seed distribution failed: ${assigned.error}`);
  }
  if (options.answered) {
    const saved = await upsertItemAnswer(root, MONTH, "emp1", {
      xrayImageId: "A1",
      templateId: "tpl",
      templateVersion: 1,
      answers: [],
      lastSavedAt: "2026-05-02T08:00:00.000Z",
      submittedAt: "2026-05-02T08:00:00.000Z",
      answeredBy: "emp1",
      status: "submitted",
    });
    if (!saved.ok) throw new Error(`seed answer failed: ${saved.error}`);
  }
  __clearDeriveMemoForTests();
}

async function populationIds(root: DirectoryHandleLike): Promise<string[]> {
  const final = await loadMonthPopulationFinal(root, MONTH);
  return (final?.rows ?? []).map((row) => String(row["xrayImageId"]));
}

beforeEach(() => {
  invalidateMonthLockCache();
  __clearDeriveMemoForTests();
});

describe("saveMonthRun — overwrite guard (A2)", () => {
  test("refuses, even with confirmedOverwrite, when a distributed month would lose a sampled id", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "B9"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked).toEqual({
      missingCount: 1,
      missingExamples: ["A2"],
      distributionCount: 1,
      answerCount: 0,
    });
    expect(await populationIds(root)).toEqual(["A1", "A2", "A3"]);
  });

  test("refuses when the month has answers even without a distribution", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["Z1"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked?.missingCount).toBe(2);
    expect(result.overwriteBlocked?.answerCount).toBe(1);
  });

  test("allows a confirmed overwrite whose ids are a superset of the sample", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: true });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "A2", "A9"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(true);
    expect(await populationIds(root)).toEqual(["A1", "A2", "A9"]);
  });

  test("keeps today's confirm for a month with a sample but no distribution or answers", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });

    const unconfirmed = await saveMonthRun({ directoryHandle: root, ...baseParams, processedRows: rowsFor(["Z1"]) });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.sampleExists).toBe(true);
      expect(unconfirmed.overwriteBlocked).toBeUndefined();
    }

    const confirmed = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["Z1"]),
      confirmedOverwrite: true,
    });
    expect(confirmed.ok).toBe(true);
  });

  // F21: a strict read of distribution/answers. A read failure must refuse the
  // save as if the month had work — never silently fold into "no answers".
  test("refuses, even with confirmedOverwrite, when the distribution cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });
    setSimulatedFaults(root, [
      { operation: "readFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "B9"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Refused via the coded-error path (the guard's read failure propagates out
    // of saveMonthRunLocked's try/catch), not via overwriteBlocked — either way
    // the population must be left untouched. Clear the simulated fault before
    // reading it back, since it was injected for every file, not just the
    // distribution.
    setSimulatedFaults(root, []);
    expect(await populationIds(root)).toEqual(["A1", "A2", "A3"]);
  });
});

describe("assessPopulationOverwrite", () => {
  test("caps the example ids and reports the full missing count", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `S${String(i).padStart(2, "0")}`);
    const assessment = assessPopulationOverwrite(
      { sampleExists: true, liveSampledIds: ids, distributionCount: 25, answerCount: 0 },
      rowsFor(["S00"])
    );
    expect(assessment.missingCount).toBe(24);
    expect(assessment.missingExamples).toHaveLength(OVERWRITE_MISSING_EXAMPLE_LIMIT);
    expect(assessment.missingExamples[0]).toBe("S01");
    expect(assessment.blocked).toBe(true);
  });

  test("never blocks a month with no distribution and no answers", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });
    const impact = await loadPopulationOverwriteImpact(root, MONTH);
    expect(impact).toEqual({ sampleExists: true, liveSampledIds: ["A1", "A2"], distributionCount: 0, answerCount: 0 });
    expect(assessPopulationOverwrite(impact, rowsFor(["Z1"])).blocked).toBe(false);
  });

  // F21: loadPopulationOverwriteImpact itself must throw (not fold to "no
  // work") when the distribution read fails while the month has one.
  test("loadPopulationOverwriteImpact throws when the distribution cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });
    setSimulatedFaults(root, [
      { operation: "readFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "getFile", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    await expect(loadPopulationOverwriteImpact(root, MONTH)).rejects.toBeTruthy();
  });
});
