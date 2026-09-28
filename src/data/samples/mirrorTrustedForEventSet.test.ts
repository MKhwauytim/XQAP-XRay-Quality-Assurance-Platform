// P4 fix round — a mirror is trusted only for the event set it was derived from.
//
// `distribution.log.json`'s revision used to be the only staleness authority for
// an employee mirror. With the projection update off the click path, a pending
// append whose background job then FAILS (or whose tab closes) leaves the stamp
// at R while the events have moved on; a mirror written at (R) before the
// append then looks current to every machine — including the delete-user
// footprint check, whose wrong answer is irreversible. So the mirror also
// carries the `eventSetId` it was derived from, and a reader trusts it only
// when that matches the CURRENT log's eventSetId. A mirror without the field
// (written by an older build) is simply not trusted and is re-derived: the
// mirror is a rebuildable derived cache, so this needs no migration.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  __dropProjectionChainsForTests,
  __setProjectionTimingForTests,
  appendDistributionEvents,
  flushPendingDistributionProjectionWrites,
  loadDistributionLog,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import {
  getUserWorkspaceFootprint,
  isMirrorTrustedForEvents,
  loadEmployeeSampleMirror,
  syncSampleMirrors,
} from "./sampleMirrorStorage";

const MONTH = "5-may-2026";
const EMP = "emp1";

const row = (id: string): PreparedPopulationRow =>
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
  }) as unknown as PreparedPopulationRow;

const sample = (rows: PreparedPopulationRow[]): SampleMasterData =>
  ({
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  }) as unknown as SampleMasterData;

const assign = (id: string) => buildAssignEvent({ xrayImageId: id, assignedTo: EMP, eventBy: "admin" });

const FAIL_PROJECTION = [
  { operation: "createWritable" as const, name: "distribution.log.json", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
];

/** A month with A1 assigned, projection healthy, mirror + cache written from the full log. */
async function seededRoot(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;
  invalidateMonthLockCache();
  await getPopulationMonthDir(root, MONTH, true);
  await saveSampleMaster(root, MONTH, sample([row("A1"), row("A2")]));
  await appendDistributionEvents(root, MONTH, [assign("A1")]);
  await refreshDistributionCacheAfterWrite(root, MONTH, [row("A1"), row("A2")]);
  return root;
}

beforeEach(() => {
  clearErrors();
  __setProjectionTimingForTests({ graceMs: 100, deadlineMs: 1_500 });
});
afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  __setProjectionTimingForTests(null);
});

describe("a pending append whose projection job fails", () => {
  it("baseline: a healthy mirror is trusted for its own event set", async () => {
    const root = await seededRoot();
    const mirror = await loadEmployeeSampleMirror(root, MONTH, EMP);
    expect(mirror).not.toBeNull();
    const log = await loadDistributionLog(root, MONTH);
    expect(mirror!.eventSetId).toBe(log.eventSetId);
    expect(mirror!.scan).toBeDefined();
    expect(await isMirrorTrustedForEvents(root, MONTH, mirror!, log.revision)).toBe(true);
    expect((await getUserWorkspaceFootprint(root, EMP)).activeAssignments[0]?.pendingCount).toBe(1);
  });

  it("the write flow's mirror sync is NOT skipped just because the revision did not move", async () => {
    const root = await seededRoot();
    setSimulatedFaults(root, FAIL_PROJECTION);
    const result = await appendDistributionEvents(root, MONTH, [assign("A2")]);
    expect(result.ok && result.projectionPending).toBe(true);

    // What every write flow does right after the append.
    await refreshDistributionCacheAfterWrite(root, MONTH, [row("A1"), row("A2")]);

    const mirror = await loadEmployeeSampleMirror(root, MONTH, EMP);
    expect(mirror!.entries.map((e) => e.xrayImageId).sort()).toEqual(["A1", "A2"]);
  });

  it("a stale mirror is NOT trusted after the job fails: the next reader re-derives and the footprint sees the new assignment", async () => {
    const root = await seededRoot();
    setSimulatedFaults(root, FAIL_PROJECTION);
    // The tab appends and is then closed before any refresh could re-sync the mirror.
    await appendDistributionEvents(root, MONTH, [assign("A2")]);
    await flushPendingDistributionProjectionWrites(); // the background job failed: stamp stays put
    setSimulatedFaults(root, []);

    const mirror = await loadEmployeeSampleMirror(root, MONTH, EMP);
    const log = await loadDistributionLog(root, MONTH);
    expect(mirror!.entries).toHaveLength(1); // the mirror really is stale
    expect(await isMirrorTrustedForEvents(root, MONTH, mirror!, log.revision)).toBe(false);

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.activeAssignments[0]?.pendingCount).toBe(2);
  });

  it("same with a simulated tab close: the chain is dropped while the job is still pending", async () => {
    const root = await seededRoot();
    setSimulatedFaults(root, FAIL_PROJECTION);
    const result = await appendDistributionEvents(root, MONTH, [assign("A2")]);
    expect(result.ok && result.projectionPending).toBe(true);
    __dropProjectionChainsForTests(); // the tab is gone: no pending marker, no later bump
    setSimulatedFaults(root, []);

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.activeAssignments[0]?.pendingCount).toBe(2);
  });
});

describe("the trust check is a sizes-only comparison against the recorded scan", () => {
  async function eventsDirOf(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
    const main = await getSampleMainDir(root, MONTH, true);
    return main.getDirectoryHandle("distribution.events", { create: true });
  }
  const trustedNow = async (root: DirectoryHandleLike) => {
    const mirror = (await loadEmployeeSampleMirror(root, MONTH, EMP))!;
    // Hold the revision condition fixed so only the scan comparison decides.
    return isMirrorTrustedForEvents(root, MONTH, mirror, mirror.sourceLogRevision);
  };

  it("trusted while the listing is unchanged", async () => {
    expect(await trustedNow(await seededRoot())).toBe(true);
  });

  it("a segment that GREW is not trusted", async () => {
    const root = await seededRoot();
    __setProjectionTimingForTests({ graceMs: 5_000, deadlineMs: 5_000 });
    await appendDistributionEvents(root, MONTH, [assign("A2")]); // same writer chain: the open segment grows
    expect(await trustedNow(root)).toBe(false);
  });

  it("a NEW segment is not trusted", async () => {
    const root = await seededRoot();
    const w = await (await (await eventsDirOf(root)).getFileHandle("other-device-x.ndjson", { create: true })).createWritable!();
    await w.write("");
    await w.close();
    expect(await trustedNow(root)).toBe(false);
  });

  it("a NEW legacy per-event file is not trusted", async () => {
    const root = await seededRoot();
    const w = await (await (await eventsDirOf(root)).getFileHandle("legacy-evt.json", { create: true })).createWritable!();
    await w.write("{}");
    await w.close();
    expect(await trustedNow(root)).toBe(false);
  });

  it("a trusted check reads NO event content", async () => {
    const root = await seededRoot();
    setSimulatedFaults(root, [
      { operation: "readFile", nameSuffix: ".ndjson", errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);
    expect(await trustedNow(root)).toBe(true);
  });
});

describe("mirror stamping and legacy mirrors", () => {
  const current = (eventSetId: string | undefined, entries: DistributionCurrentData["entries"]): DistributionCurrentData =>
    ({
      monthFolderName: MONTH,
      logRevision: 3,
      deriveVersion: 99,
      derivedAt: new Date().toISOString(),
      totalAssigned: entries.length,
      totalCompleted: 0,
      totalReplaced: 0,
      entries,
      ...(eventSetId ? { eventSetId } : {}),
    }) as unknown as DistributionCurrentData;
  const entry = (id: string) => ({ xrayImageId: id, assignedTo: EMP, status: "pending" }) as never;

  it("writes when the revision is equal but the eventSetId differs; skips when both match", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await syncSampleMirrors(root, MONTH, current("set-1", [entry("A1")]));
    await syncSampleMirrors(root, MONTH, current("set-2", [entry("A1"), entry("A2")]));
    expect((await loadEmployeeSampleMirror(root, MONTH, EMP))!.entries).toHaveLength(2);
    expect((await loadEmployeeSampleMirror(root, MONTH, EMP))!.eventSetId).toBe("set-2");

    // Same revision AND same set: the monotonic skip still holds.
    await syncSampleMirrors(root, MONTH, current("set-2", [entry("A9")]));
    expect((await loadEmployeeSampleMirror(root, MONTH, EMP))!.entries).toHaveLength(2);
  });

  it("a legacy mirror without eventSetId is never trusted (re-derived, no migration needed)", async () => {
    // (an older build's mirror has no `scan`, even if it carries an eventSetId)
    const legacy = { monthFolderName: MONTH, username: EMP, updatedAt: "", sourceLogRevision: 9, eventSetId: "x", entries: [] };
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    expect(await isMirrorTrustedForEvents(root, MONTH, legacy as never, 1)).toBe(false);
  });
});
