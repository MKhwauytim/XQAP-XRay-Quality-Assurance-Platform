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

const ANSWER_EVENT_READ_FAULTS = [
  { operation: "getDirectoryHandle" as const, name: "answers.events", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "readFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
];

// F21 fix round 2. The two sets above were themselves under-tested: a
// re-review on a clean copy of the round-1 commit showed the `.ndjson`
// portion of each set was INERT — with only an individual segment FILE
// faulted (no directory-open or compatibility-log fault), the guard's
// distribution/answers read came back with an empty (but not thrown) result,
// and `saveMonthRun` happily overwrote a worked month. The cause: the
// underlying segment-tail read (`readSegmentTails`/`readListedEntry` in
// `directoryScan.ts`) treats a persistent per-file `NotReadableError` as a
// "vanished" listing entry — retried a bounded number of times, then
// silently excluded, by design, for ordinary share flakiness. That tolerance
// sat BELOW where round 1's `strict` flag on `loadAllEmployeeFiles` could see
// it: the flag only stopped catching an already-thrown error, but this read
// never threw one in the first place.
//
// Fixed at the source: `readEventSegmentDelta` (`appendOnlyEventLog.ts`) now
// takes `{ strict: true }` and throws `EventSegmentUnreadableError` when a
// segment it listed could not be read, and that option is threaded all the
// way from `loadAllEmployeeFiles({ strict: true })` and
// `loadOrDeriveDistributionCurrentStrictForRead` down to this exact call.
// These two sets below are the faithful regression case: ONLY the `.ndjson`
// segment files are faulted, nothing else — the directory-open /
// compatibility-log faults above are no longer load-bearing for a throw
// (each set here is sufficient on its own), and are kept above only because
// they exercise a genuinely different failure surface (a share/permission
// failure opening the events directory itself, or a corrupt/unreadable
// `distribution.log.json`), not as a crutch for this one.
const DISTRIBUTION_NDJSON_SEGMENT_ONLY_FAULTS = [
  { operation: "readFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
  { operation: "getFile" as const, nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
];

const ANSWER_NDJSON_SEGMENT_ONLY_FAULTS = [
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
  // all) must refuse just the same. `loadAllEmployeeFiles`' lenient default
  // folded a failed event segment read into "answered nothing", so
  // `answerCount` came back 0 and the guard waved the save through — the
  // ORIGINAL field incident's proximate cause. This particular test's fault
  // (ANSWER_EVENT_READ_FAULTS, a directory-open fault) is what the round-1
  // reviewer exchange actually reproduced; the MORE LITERAL reproduction of a
  // single unreadable `.ndjson` segment, with no directory-open fault, is the
  // "answer segment (only) is unreadable" test below (finding A, fix round 2).
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

  // F21 fix round 2: the FAITHFUL regression case for finding B — ONLY the
  // distribution's `.ndjson` segment file is unreadable (no directory-open or
  // distribution.log.json fault). Before the readEventSegmentDelta strict fix
  // this test failed: distributionCount came back 0 (the segment silently
  // "vanished") and the overwrite went through. See the fix report for the
  // exact swap/revert run that proves it.
  //
  // Fix round 3 (controller ruling): the guard's own read
  // (`loadOrDeriveDistributionCurrentStrictForRead(..., { strictSegments: true })`)
  // is the ONLY caller that treats this as a throw — see
  // `distributionUnreadable.test.ts`'s "strictSegments stays opt-in per
  // caller" suite for the sibling proof that a view-path read (no
  // `strictSegments`) tolerates the very same fault.
  test("refuses, even with confirmedOverwrite, when a distribution segment (only) is unreadable", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });
    setSimulatedFaults(root, DISTRIBUTION_NDJSON_SEGMENT_ONLY_FAULTS);

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "B9"]),
      confirmedOverwrite: true,
    });
    setSimulatedFaults(root, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.overwriteBlocked).toBeUndefined();
    expect(await populationIds(root)).toEqual(["A1", "A2", "A3"]);
  });

  // F21 fix round 2: the FAITHFUL regression case for finding A — ONLY the
  // answer's `.ndjson` segment file is unreadable (no `answers.events/`
  // directory-open fault). Before the fix, this is EXACTLY the reviewer's
  // original repro: answerCount came back 0 and the save went through.
  test("refuses, even with confirmedOverwrite, when an answer segment (only) is unreadable", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });
    setSimulatedFaults(root, ANSWER_NDJSON_SEGMENT_ONLY_FAULTS);

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

  test("reports how many sampled ids a permitted overwrite leaves behind", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: false });

    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: rowsFor(["A1", "Z1"]),
      confirmedOverwrite: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sampleOrphanCount).toBe(1);
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

  // F21 fix round 2, unit level: the faithful ndjson-segment-only regression
  // case (see the saveMonthRun-level tests above for the full explanation).
  test("loadPopulationOverwriteImpact throws when a distribution segment (only) is unreadable", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: true, answered: false });
    setSimulatedFaults(root, DISTRIBUTION_NDJSON_SEGMENT_ONLY_FAULTS);

    await expect(loadPopulationOverwriteImpact(root, MONTH)).rejects.toBeTruthy();
    setSimulatedFaults(root, []);
  });

  test("loadPopulationOverwriteImpact throws when an answer segment (only) is unreadable", async () => {
    const root = createMemoryDirectory("root");
    await seedMonth(root, { distributed: false, answered: true });
    setSimulatedFaults(root, ANSWER_NDJSON_SEGMENT_ONLY_FAULTS);

    await expect(loadPopulationOverwriteImpact(root, MONTH)).rejects.toBeTruthy();
    setSimulatedFaults(root, []);
  });
});
