import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults, clearSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { __clearDeriveMemoForTests, appendDistributionEvents, flushPendingDistributionPersist, flushPendingDistributionProjectionWrites, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { getUserWorkspaceFootprint } from "../samples/sampleMirrorStorage";

const MONTH = "5-may-2026";
const rows = ["A1", "A2"].map((id) => ({ xrayImageId: id, portName: "p", certScanStatus: "NonCertscan", stage: null, movementType: "LAND",
  otherResults: { manual: { result: null, code: null, employeeId: null }, opposite: { result: null, code: null, employeeId: null }, liveMeans: { result: null, code: null, employeeId: null } },
  biFilledFields: [], sourceRowNumber: 1 }) as unknown as PreparedPopulationRow);
const sample = { rngSeed: "s", totalRequested: 2, totalActual: 2, certScanRequested: 0, nonCertScanRequested: 0, certScanActual: 0, nonCertScanActual: 2,
  portAllocations: [], stageAllocations: [], drawnAt: "2026-05-05T08:00:00.000Z", drawnBy: "admin", rows } as unknown as SampleMasterData;
afterEach(async () => { await flushPendingDistributionProjectionWrites(); await flushPendingDistributionPersist(); __clearDeriveMemoForTests(); });

async function seeded(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;
  invalidateMonthLockCache();
  await getPopulationMonthDir(root, MONTH, true);
  await saveSampleMaster(root, MONTH, sample);
  return root;
}
const blip = () => [{ operation: "readFile" as const, nameSuffix: ".ndjson", times: Number.POSITIVE_INFINITY, errorName: "NotReadableError" }];

describe("a FAILED fold must not read as zero", () => {
  it("falls back to the mirror's pending count when a mirror exists and the fold fails", async () => {
    const root = await seeded();
    await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })]);
    await flushPendingDistributionProjectionWrites();
    await refreshDistributionCacheAfterWrite(root, MONTH, rows);
    await flushPendingDistributionPersist();
    // A later event makes emp1's mirror untrusted, so the guard must fold.
    await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp2", eventBy: "admin" })]);
    await flushPendingDistributionProjectionWrites();
    __clearDeriveMemoForTests();
    setSimulatedFaults(root, blip());
    const fp = await getUserWorkspaceFootprint(root, "emp1");
    clearSimulatedFaults(root);
    expect(fp.activeAssignments).toEqual([{ monthFolderName: MONTH, pendingCount: 1 }]);
  });

  it("uses the fold when it succeeds", async () => {
    const root = await seeded();
    await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })]);
    await flushPendingDistributionProjectionWrites();
    __clearDeriveMemoForTests();
    expect((await getUserWorkspaceFootprint(root, "emp1")).activeAssignments).toEqual([{ monthFolderName: MONTH, pendingCount: 1 }]);
  });

  it("does not report 'no pending work' when the event store cannot be read and the mirror is absent", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await getPopulationMonthDir(root, MONTH, true);
    await saveSampleMaster(root, MONTH, sample);
    const r = await appendDistributionEvents(root, MONTH, [buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" })]);
    expect(r.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();
    __clearDeriveMemoForTests();
    // Share blip: the event segment cannot be read (permanent for this call).
    setSimulatedFaults(root, [{ operation: "readFile", nameSuffix: ".ndjson", times: Number.POSITIVE_INFINITY, errorName: "NotReadableError" }]);
    // No mirror and no readable events: the guard must FAIL SAFE (throw, so the delete is refused).
    await expect(getUserWorkspaceFootprint(root, "emp1")).rejects.toThrow();
    clearSimulatedFaults(root);
  });
});
