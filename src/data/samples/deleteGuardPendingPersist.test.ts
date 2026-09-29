// R1: the derived-cache persist is off the click path, so for a while after a
// write the on-disk mirrors lag the durable events. The delete-user guard's wrong
// answer is irreversible, so while THIS tab has a persist in flight it must fold
// from the events -- in particular for a first-time assignee who has NO mirror
// yet, which would otherwise read as "zero pending, safe to delete".
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { directoryResourceKey, withResourceLock } from "../storage/webLocks";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  __clearDeriveMemoForTests,
  appendDistributionEvents,
  flushPendingDistributionPersist,
  flushPendingDistributionProjectionWrites,
  isDistributionPersistPending,
  queueDistributionCurrentPersist,
} from "../distribution/distributionStorage";
import { buildAssignEvent, deriveCurrentDistribution } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { getUserWorkspaceFootprint } from "./sampleMirrorStorage";

const MONTH = "5-may-2026";
const EMP = "emp1";
const rows = ["A1", "A2"].map(
  (id) =>
    ({
      xrayImageId: id,
      portName: "بري",
      certScanStatus: "NonCertscan",
      stage: null,
      movementType: "LAND",
      otherResults: {
        manual: { result: null, code: null, employeeId: null },
        opposite: { result: null, code: null, employeeId: null },
        liveMeans: { result: null, code: null, employeeId: null },
      },
      biFilledFields: [],
      sourceRowNumber: 1,
    }) as unknown as PreparedPopulationRow
);
const sample = {
  rngSeed: "seed",
  totalRequested: 2,
  totalActual: 2,
  certScanRequested: 0,
  nonCertScanRequested: 0,
  certScanActual: 0,
  nonCertScanActual: 2,
  portAllocations: [],
  stageAllocations: [],
  drawnAt: "2026-05-05T08:00:00.000Z",
  drawnBy: "admin",
  rows,
} as unknown as SampleMasterData;

afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  await flushPendingDistributionPersist();
  __clearDeriveMemoForTests();
});

describe("delete-user guard while a derived-cache persist is pending", () => {
  it("folds from the events for a first-time assignee with no mirror yet, instead of reporting zero", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await getPopulationMonthDir(root, MONTH, true);
    await saveSampleMaster(root, MONTH, sample);
    const appended = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: EMP, eventBy: "admin" }),
    ]);
    expect(appended.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();
    // No mirror exists (nothing persisted yet), and no persist is pending: this is
    // the pre-existing behaviour the guard has always had for an absent mirror.
    expect((await getUserWorkspaceFootprint(root, EMP)).activeAssignments).toEqual([]);

    // Now hold the cache file's lock so a queued persist cannot complete.
    const main = await getSampleMainDir(root, MONTH, true);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const lockAcquired = new Promise<void>((resolve) => {
      void withResourceLock(directoryResourceKey(main, "distribution.current.json"), async () => {
        resolve();
        await held;
      });
    });
    await lockAcquired;
    const log = appended.ok ? appended.log : null;
    const current = { ...deriveCurrentDistribution(log!, rows), logRevision: log!.revision };
    void queueDistributionCurrentPersist(root, MONTH, current);
    expect(isDistributionPersistPending(root, MONTH)).toBe(true);

    try {
      const footprint = await getUserWorkspaceFootprint(root, EMP);
      expect(footprint.activeAssignments).toEqual([{ monthFolderName: MONTH, pendingCount: 1 }]);
    } finally {
      release();
    }
    await flushPendingDistributionPersist();
    expect(isDistributionPersistPending(root, MONTH)).toBe(false);
  });
});
