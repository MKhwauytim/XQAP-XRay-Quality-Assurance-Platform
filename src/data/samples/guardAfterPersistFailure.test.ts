import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults, clearSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  __clearDeriveMemoForTests, appendDistributionEvents, flushPendingDistributionPersist,
  flushPendingDistributionProjectionWrites, isDistributionPersistPending, queueDistributionCacheRebuild,
  loadOrDeriveDistributionCurrent,
} from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { getUserWorkspaceFootprint, loadEmployeeSampleMirror } from "../samples/sampleMirrorStorage";

const MONTH = "5-may-2026";
const rows = ["A1", "A2"].map((id) => ({ xrayImageId: id, portName: "p", certScanStatus: "NonCertscan", stage: null, movementType: "LAND",
  otherResults: { manual: { result: null, code: null, employeeId: null }, opposite: { result: null, code: null, employeeId: null }, liveMeans: { result: null, code: null, employeeId: null } },
  biFilledFields: [], sourceRowNumber: 1 }) as unknown as PreparedPopulationRow);
const sample = { rngSeed: "s", totalRequested: 2, totalActual: 2, certScanRequested: 0, nonCertScanRequested: 0, certScanActual: 0, nonCertScanActual: 2,
  portAllocations: [], stageAllocations: [], drawnAt: "2026-05-05T08:00:00.000Z", drawnBy: "admin", rows } as unknown as SampleMasterData;

afterEach(async () => { await flushPendingDistributionProjectionWrites(); await flushPendingDistributionPersist(); __clearDeriveMemoForTests(); });

describe("delete guard when the derived files are missing or stale (review repro)", () => {
  async function distributedThenAssign(): Promise<DirectoryHandleLike> {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await getPopulationMonthDir(root, MONTH, true);
    await saveSampleMaster(root, MONTH, sample);
    await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp0", eventBy: "admin" })]);
    await flushPendingDistributionProjectionWrites();
    await loadOrDeriveDistributionCurrent(root, MONTH, rows, { persistCache: true, awaitCachePersist: true });
    await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })], { interactive: true });
    await flushPendingDistributionProjectionWrites();
    return root;
  }

  it("tab closed before any persist ran (or a check from another machine in the tail): no mirror, nothing pending in this tab, still reports the row", async () => {
    const root = await distributedThenAssign();
    expect(isDistributionPersistPending(root, MONTH)).toBe(false);
    expect(await loadEmployeeSampleMirror(root, MONTH, "emp1")).toBeNull();
    expect((await getUserWorkspaceFootprint(root, "emp1")).activeAssignments).toEqual([{ monthFolderName: MONTH, pendingCount: 1 }]);
  });

  it("a user who never held a row still reports nothing", async () => {
    const root = await distributedThenAssign();
    expect((await getUserWorkspaceFootprint(root, "nobody")).activeAssignments).toEqual([]);
  });

  it("reports the first-time assignee's pending work once the background persist has failed", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await getPopulationMonthDir(root, MONTH, true);
    await saveSampleMaster(root, MONTH, sample);
    // emp0 already has a mirror (month was distributed before).
    const first = await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp0", eventBy: "admin" })]);
    expect(first.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();
    await loadOrDeriveDistributionCurrent(root, MONTH, rows, { persistCache: true, awaitCachePersist: true });
    expect(await loadEmployeeSampleMirror(root, MONTH, "emp0")).not.toBeNull();

    // The click: emp1 gets their first row; events are durable before return.
    const r = await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })], { interactive: true });
    expect(r.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();
    // The background persist fails (share refuses the derived-cache writes).
    setSimulatedFaults(root, [{ operation: "createWritable", name: "distribution.current.json", times: Number.POSITIVE_INFINITY, errorName: "NotAllowedError" }]);
    void queueDistributionCacheRebuild(root, MONTH, rows);
    await flushPendingDistributionPersist();
    await flushPendingDistributionProjectionWrites();
    clearSimulatedFaults(root);
    expect(isDistributionPersistPending(root, MONTH)).toBe(false);
    expect(await loadEmployeeSampleMirror(root, MONTH, "emp1")).toBeNull();

    // Guard (this tab, or any other machine): emp1 has 1 pending row.
    const fp = await getUserWorkspaceFootprint(root, "emp1");
    expect(fp.activeAssignments).toEqual([{ monthFolderName: MONTH, pendingCount: 1 }]);
  });
});
