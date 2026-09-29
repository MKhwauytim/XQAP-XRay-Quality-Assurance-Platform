// R2 (lane R): a distribution write rewrites only the employee mirrors whose
// entries or quota actually changed.
//
// Before, the staleness stamp was the global event-log revision, which every
// append bumps, so the skip guard in `syncSampleMirrors` never fired and ALL N
// mirrors (~22 share operations and ~230 KB each) were rewritten to move one row
// between two employees. Now an unchanged employee keeps its mirror FILE (bytes
// and all) and only its `_index.json` entry is restamped; the reader
// (`isMirrorTrustedForEvents`) accepts such a mirror only when the file's
// content hash equals the index entry's and the index stamp/scan is current.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  __clearDeriveMemoForTests,
  appendDistributionEvents,
  flushPendingDistributionPersist,
  flushPendingDistributionProjectionWrites,
  readDistributionLogStamp,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { buildAssignEvent, buildReassignEvent } from "../distribution/distributionLog";
import { invalidateMonthLockCache } from "../population/monthLock";
import { getPopulationMonthDir, getSampleEmployeeDir } from "../workspace/workspacePaths";
import {
  EMPLOYEE_MIRROR_INDEX_FILE,
  isMirrorTrustedForEvents,
  loadEmployeeSampleMirror,
  mirrorContentHash,
  readEmployeeMirrorIndex,
} from "./sampleMirrorStorage";
import type { EmployeeSamplesFile } from "./sampleMirrorStorage";

const MONTH = "5-may-2026";
const OWNERS = ["emp1", "emp2", "emp3", "emp4"];
const IDS = Array.from({ length: 8 }, (_, i) => `A${i + 1}`);

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
const ROWS = IDS.map(row);
const sample = {
  rngSeed: "seed",
  totalRequested: IDS.length,
  totalActual: IDS.length,
  certScanRequested: 0,
  nonCertScanRequested: 0,
  certScanActual: 0,
  nonCertScanActual: IDS.length,
  portAllocations: [],
  stageAllocations: [],
  drawnAt: "2026-05-05T08:00:00.000Z",
  drawnBy: "admin",
  rows: ROWS,
} as unknown as SampleMasterData;

async function persist(root: DirectoryHandleLike): Promise<void> {
  await flushPendingDistributionProjectionWrites();
  await refreshDistributionCacheAfterWrite(root, MONTH, ROWS);
  await flushPendingDistributionPersist();
}

/** emp1..emp4 own two rows each, mirrors written. */
async function seeded(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root", { trackOperations: true }) as DirectoryHandleLike;
  invalidateMonthLockCache();
  await getPopulationMonthDir(root, MONTH, true);
  await saveSampleMaster(root, MONTH, sample);
  await appendDistributionEvents(
    root,
    MONTH,
    IDS.map((id, i) => buildAssignEvent({ xrayImageId: id, assignedTo: OWNERS[i % OWNERS.length]!, eventBy: "admin" }))
  );
  await persist(root);
  return root;
}

async function mirrorText(root: DirectoryHandleLike, username: string): Promise<string> {
  const dir = await getSampleEmployeeDir(root, MONTH, false);
  const file = await (await dir.getFileHandle(`${username}.samples.json`)).getFile();
  return file.text();
}

function mirrorWrites(root: DirectoryHandleLike): string[] {
  return getOperationLog(root)
    .filter((op) => op.operation === "createWritable" && op.name.endsWith(".samples.json"))
    .map((op) => op.name);
}

beforeEach(() => {
  clearErrors();
  __clearDeriveMemoForTests();
});
afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  await flushPendingDistributionPersist();
});

describe("R2: selective mirror rewrite", () => {
  it("moving one row emp1 -> emp2 rewrites only emp1 and emp2; emp3 and emp4 keep their bytes", async () => {
    const root = await seeded();
    const before = { emp3: await mirrorText(root, "emp3"), emp4: await mirrorText(root, "emp4") };
    clearOperationLog(root);

    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" }),
    ]);
    await persist(root);

    expect([...new Set(mirrorWrites(root))].sort()).toEqual(["emp1.samples.json", "emp2.samples.json"]);
    expect(await mirrorText(root, "emp3")).toBe(before.emp3);
    expect(await mirrorText(root, "emp4")).toBe(before.emp4);
    expect((await loadEmployeeSampleMirror(root, MONTH, "emp2"))?.entries.map((e) => e.xrayImageId).sort()).toEqual([
      "A1",
      "A2",
      "A6",
    ]);
    expect((await loadEmployeeSampleMirror(root, MONTH, "emp1"))?.entries.map((e) => e.xrayImageId)).toEqual(["A5"]);
  });

  it("restamps the untouched employees' _index.json entries (revision, event set, scan, content hash)", async () => {
    const root = await seeded();
    const indexBefore = await readEmployeeMirrorIndex(root, MONTH);
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" }),
    ]);
    await persist(root);

    const index = await readEmployeeMirrorIndex(root, MONTH);
    const stamp = await readDistributionLogStamp(root, MONTH);
    const e3 = index!.mirrors["emp3.samples.json"]!;
    expect(e3.sourceLogRevision).toBe(stamp.revision);
    expect(e3.sourceLogRevision).toBeGreaterThan(indexBefore!.mirrors["emp3.samples.json"]!.sourceLogRevision!);
    expect(e3.eventSetId).not.toBe(indexBefore!.mirrors["emp3.samples.json"]!.eventSetId);
    expect(e3.scan).toBeDefined();
    expect(typeof e3.contentHash).toBe("string");
    // Content unchanged => same hash; changed employees get a new one.
    expect(e3.contentHash).toBe(indexBefore!.mirrors["emp3.samples.json"]!.contentHash);
    expect(index!.mirrors["emp2.samples.json"]!.contentHash).not.toBe(indexBefore!.mirrors["emp2.samples.json"]!.contentHash);
    expect(index!.pendingRevision).toBeNull();
  });

  it("trusts an unchanged, index-restamped mirror, and refuses it on any hash or stamp mismatch", async () => {
    const root = await seeded();
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" }),
    ]);
    await persist(root);
    const stamp = await readDistributionLogStamp(root, MONTH);
    const mirror = (await loadEmployeeSampleMirror(root, MONTH, "emp3")) as EmployeeSamplesFile;
    // The file itself is older than the stamp: only the index restamp makes it current.
    expect(mirror.sourceLogRevision).toBeLessThan(stamp.revision);
    expect(await isMirrorTrustedForEvents(root, MONTH, mirror, stamp.revision)).toBe(true);

    // Hash mismatch: the file's content is not what the index vouched for.
    expect(
      await isMirrorTrustedForEvents(root, MONTH, { ...mirror, entries: mirror.entries.slice(1) }, stamp.revision)
    ).toBe(false);

    // Stamp mismatch: a NEW event makes the index scan stale -> fold.
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A2", assignedTo: "emp2", reassignedTo: "emp4", eventBy: "admin" }),
    ]);
    await flushPendingDistributionProjectionWrites();
    const stamp2 = await readDistributionLogStamp(root, MONTH);
    expect(await isMirrorTrustedForEvents(root, MONTH, mirror, stamp2.revision)).toBe(false);
  });

  it("does not trust a restamped mirror while the index is mid-flight (pendingRevision set)", async () => {
    const root = await seeded();
    await appendDistributionEvents(root, MONTH, [
      buildReassignEvent({ xrayImageId: "A1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" }),
    ]);
    await persist(root);
    const stamp = await readDistributionLogStamp(root, MONTH);
    const mirror = (await loadEmployeeSampleMirror(root, MONTH, "emp3")) as EmployeeSamplesFile;
    const dir = await getSampleEmployeeDir(root, MONTH, false);
    const index = await safeReadJson<Record<string, unknown>>(dir, EMPLOYEE_MIRROR_INDEX_FILE);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    await safeWriteJson(dir, EMPLOYEE_MIRROR_INDEX_FILE, { ...index.value, pendingRevision: stamp.revision });
    expect(await isMirrorTrustedForEvents(root, MONTH, mirror, stamp.revision)).toBe(false);
  });

  it("the content hash ignores entry order (two folds of one set disagree on tie order) but not content", async () => {
    const root = await seeded();
    const mirror = (await loadEmployeeSampleMirror(root, MONTH, "emp1")) as EmployeeSamplesFile;
    expect(mirror.entries.length).toBeGreaterThan(1);
    const base = await mirrorContentHash(mirror);
    expect(base).toBeDefined();
    expect(await mirrorContentHash({ ...mirror, entries: [...mirror.entries].reverse() })).toBe(base);
    const changed = mirror.entries.map((e, i) => (i === 0 ? { ...e, assignedTo: "someone-else" } : e));
    expect(await mirrorContentHash({ ...mirror, entries: changed })).not.toBe(base);
    expect(await mirrorContentHash({ ...mirror, quota: undefined })).not.toBe(base);
  });

  it("re-persisting the same derivation rewrites no mirror", async () => {
    const root = await seeded();
    clearOperationLog(root);
    await persist(root);
    expect(mirrorWrites(root)).toEqual([]);
  });
});
