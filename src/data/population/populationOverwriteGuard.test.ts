import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvents, __clearDeriveMemoForTests } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { __clearAnswerEventsCacheForTests, upsertItemAnswer } from "../answers/answerStorage";
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
  __clearAnswerEventsCacheForTests();
}

async function populationIds(root: DirectoryHandleLike): Promise<string[]> {
  const final = await loadMonthPopulationFinal(root, MONTH);
  return (final?.rows ?? []).map((row) => String(row["xrayImageId"]));
}

// F21 targeted fault sets. Broadly faulting every readFile/getFile (as an
// earlier version of this test did) makes `loadSampleMaster` — read BEFORE
// the distribution/answers reads this is meant to exercise — fail first, so
// the distribution/answers strict-read path is never actually reached (a
// swap back to the lenient reader would still pass 8/8). These instead fault
// only the files the read under test actually touches: current writes go to
// per-writer-session NDJSON segments (`DISTRIBUTION_EVENT_SEGMENT_SUFFIX` /
// `ANSWER_EVENT_SEGMENT_SUFFIX`, both ".ndjson"), and the distribution
// compatibility files by exact name.
const DISTRIBUTION_READ_FAULTS = [
  { operation: "readFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "readFile" as const, name: "distribution.current.json", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, name: "distribution.current.json", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "readFile" as const, name: "distribution.log.json", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, name: "distribution.log.json", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
];

// The answer event segment READ (readSegmentTails/readListedEntry) treats a
// persistent NotReadableError on an individual `.ndjson` FILE as a vanished
// listing entry — retried a few times, then silently excluded with no throw
// (a deliberate share-flakiness tolerance shared with distribution's own
// segment reads). Faulting only per-file reads therefore can never reproduce
// the incident. The `answers.events/` DIRECTORY OPEN has no such leniency —
// `readEventSegmentDelta` only excuses `NotFoundError` there and rethrows
// anything else — so THAT is what the real fault surfaces as: a share/
// permission failure serving the directory listing itself, not one segment
// file going missing.
const ANSWER_EVENT_READ_FAULTS = [
  { operation: "getDirectoryHandle" as const, name: "answers.events", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "readFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
];

beforeEach(() => {
  invalidateMonthLockCache();
  __clearDeriveMemoForTests();
  __clearAnswerEventsCacheForTests();
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
  // The fault is TARGETED (see DISTRIBUTION_READ_FAULTS' comment above) so
  // this actually exercises the distribution read, not an earlier read
  // failing first — verified by temporarily swapping the guard's distribution
  // read back to the lenient `loadOrDeriveDistributionCurrentForRead` while
  // developing this fix, which made this test fail (see the fix report in
  // task-3-report.md for the exact before/after run).
  test("refuses, even with confirmedOverwrite, when the distribution cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });
    setSimulatedFaults(root, DISTRIBUTION_READ_FAULTS);

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "B9"]),
      confirmedOverwrite: true,
    });
    setSimulatedFaults(root, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Refused via the dedicated XQ-POP-008 coded path (the guard's read
    // failure propagates out of loadPopulationOverwriteImpact and is caught
    // by saveMonthRunLocked's own try/catch around that call), not via
    // overwriteBlocked — either way the population must be left untouched.
    expect(result.overwriteBlocked).toBeUndefined();
    expect(await populationIds(root)).toEqual(["A1", "A2", "A3"]);
  });

  // F21, second read site: an unreadable ANSWERS scan (no distribution at
  // all) must refuse just the same — this is the exact incident the reviewer
  // reproduced: `loadAllEmployeeFiles`' lenient default folded a failed event
  // segment read into "answered nothing", so `answerCount` came back 0 and
  // the guard waved the save through.
  test("refuses, even with confirmedOverwrite, when the answers cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });
    setSimulatedFaults(root, ANSWER_EVENT_READ_FAULTS);

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["Z1"]),
      confirmedOverwrite: true,
    });
    setSimulatedFaults(root, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked).toBeUndefined();
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
    setSimulatedFaults(root, DISTRIBUTION_READ_FAULTS);

    await expect(loadPopulationOverwriteImpact(root, MONTH)).rejects.toBeTruthy();
    setSimulatedFaults(root, []);
  });

  // F21, second read site, unit level.
  test("loadPopulationOverwriteImpact throws when the answers cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });
    setSimulatedFaults(root, ANSWER_EVENT_READ_FAULTS);

    await expect(loadPopulationOverwriteImpact(root, MONTH)).rejects.toBeTruthy();
    setSimulatedFaults(root, []);
  });
});
