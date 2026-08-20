import { describe, expect, it } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
  saveDistributionCurrent,
} from "../distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  deriveCurrentDistribution,
} from "../distribution/distributionLog";
import { closeMonth, invalidateMonthLockCache } from "../population/monthLock";
import { upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { getPopulationMonthDir, getSampleEmployeeDir } from "../workspace/workspacePaths";
import type { DistributionCurrentData, DistributionEntry } from "../distribution/distributionTypes";
import type { NormalizedRiskRow } from "../../components/Sidebar/Tabs/Population/riskData/riskDataTypes";
import { adhocMonthFolderName, type AdhocImportRecord, type AdhocImportRow } from "../adhocImport/adhocImportTypes";
import {
  assignAdhocRowsToEmployee,
  ensureAdhocSampleMaster,
} from "../adhocImport/adhocImportAssignment";
import {
  getUserWorkspaceFootprint,
  loadEmployeeSampleMirror,
  readEmployeeMirrorIndex,
  syncSampleMirrors,
} from "./sampleMirrorStorage";

const MONTH_A = "5-may-2026";
const MONTH_B = "6-june-2026";
const EMP = "emp1";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
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
  };
}

async function seedManifest(root: DirectoryHandleLike, monthFolderName: string): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, monthFolderName, true);
  const manifest: MonthManifestData = {
    monthFolderName,
    month: 5,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: 0,
    totalProcessedRows: 0,
    status: "distributed",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
}

function makeAnswer(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    answeredBy: EMP,
    status: "submitted",
  };
}

/** Draws a sample, assigns rows, and persists the derived distribution + mirrors. */
/** listMonthFolders enumerates the population root — ensure the month folder exists there. */
async function ensurePopulationMonthFolder(root: DirectoryHandleLike, monthFolderName: string): Promise<void> {
  await getPopulationMonthDir(root, monthFolderName, true);
}

async function seedAssignments(
  root: DirectoryHandleLike,
  monthFolderName: string,
  rows: PreparedPopulationRow[],
  assignee: string
): Promise<void> {
  await ensurePopulationMonthFolder(root, monthFolderName);
  await saveSampleMaster(root, monthFolderName, makeSample(rows));
  await appendDistributionEvents(
    root,
    monthFolderName,
    rows.map((r) => buildAssignEvent({ xrayImageId: r.xrayImageId, assignedTo: assignee, eventBy: "admin" }))
  );
  const log = await loadDistributionLog(root, monthFolderName);
  const current = deriveCurrentDistribution(log, rows);
  await saveDistributionCurrent(root, monthFolderName, current);
}

function makeCurrent(
  monthFolderName: string,
  logRevision: number,
  entries: DistributionEntry[]
): DistributionCurrentData {
  return {
    monthFolderName,
    logRevision,
    deriveVersion: 2,
    derivedAt: new Date().toISOString(),
    totalAssigned: entries.length,
    totalCompleted: entries.filter((e) => e.status === "completed").length,
    totalReplaced: 0,
    totalPending: entries.filter((e) => e.status === "pending").length,
    entries,
  };
}

function makeMirrorEntry(id: string, status: DistributionEntry["status"]): DistributionEntry {
  return { xrayImageId: id, assignedTo: EMP, status, replacedById: null, lastEventAt: "", row: makeRow(id) };
}

describe("syncSampleMirrors monotonic guard", () => {
  it("skips writing a mirror when the existing file has a newer-or-equal sourceLogRevision", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    // Newer derivation (rev 5): A1 pending.
    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 5, [makeMirrorEntry("A1", "pending")]));

    // Older derivation (rev 3) arrives late with A1 completed — must be ignored.
    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 3, [makeMirrorEntry("A1", "completed")]));

    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.sourceLogRevision).toBe(5);
    expect(mirror?.entries[0]?.status).toBe("pending");
  });

  it("writes when the incoming sourceLogRevision is newer", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 3, [makeMirrorEntry("A1", "pending")]));
    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 5, [makeMirrorEntry("A1", "completed")]));

    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.sourceLogRevision).toBe(5);
    expect(mirror?.entries[0]?.status).toBe("completed");
  });
});

describe("syncSampleMirrors derive-version guard (v88 quota refold)", () => {
  /** `makeCurrent` with the derive version and quotas under test. */
  function makeCurrentAt(
    logRevision: number,
    deriveVersion: number,
    entries: DistributionEntry[],
    dailyQuota?: number
  ): DistributionCurrentData {
    return {
      ...makeCurrent(MONTH_A, logRevision, entries),
      deriveVersion,
      ...(dailyQuota === undefined
        ? {}
        : {
            quotas: {
              [EMP]: {
                username: EMP,
                sampleCount: 12,
                dailyQuota,
                daysRemainingAtAssignment: 3,
                assignedAt: "2026-05-02T00:00:00.000Z",
              },
            },
          }),
    };
  }

  it("REGRESSION: a mirror at the SAME revision but an OLDER deriveVersion is rewritten with the corrected quota", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    // The pre-v88 derivation: same log revision, wrong (inflated) daily quota.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 2, [makeMirrorEntry("A1", "pending")], 9));
    expect((await loadEmployeeSampleMirror(root, MONTH_A, EMP))?.quota?.dailyQuota).toBe(9);

    // v88 bumped DERIVE_VERSION, which refolds `distribution.current.json` —
    // but the LOG has not moved, so the revision is still 5. Before the guard
    // considered the derive version this write was skipped and the employee
    // kept reading the wrong quota forever.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 3, [makeMirrorEntry("A1", "pending")], 4));

    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.quota?.dailyQuota).toBe(4);
    expect(mirror?.deriveVersion).toBe(3);
    expect(mirror?.sourceLogRevision).toBe(5);
  });

  it("the index carries deriveVersion, so the fast path can evaluate the rule at all", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 2, [makeMirrorEntry("A1", "pending")], 9));
    const index = await readEmployeeMirrorIndex(root, MONTH_A);
    expect(index?.mirrors["emp1.samples.json"]?.deriveVersion).toBe(2);
    expect(index?.pendingDeriveVersion).toBeNull();
  });

  it("DANGEROUS DIRECTION: a HIGHER existing revision is never overwritten, even by a newer deriveVersion", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    // Another machine derived revision 7 (A1 completed) on an older build.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(7, 2, [makeMirrorEntry("A1", "completed")], 9));

    // We hold only revision 5 — older DATA — but a newer derivation. Writing it
    // would resurrect a pending entry the employee has already finished.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 3, [makeMirrorEntry("A1", "pending")], 4));

    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.sourceLogRevision).toBe(7);
    expect(mirror?.entries[0]?.status).toBe("completed");
    expect(mirror?.quota?.dailyQuota).toBe(9);
  });

  it("a legacy mirror with NO deriveVersion is rewritten exactly once", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    // Hand-write the pre-field shape: no `deriveVersion`, and no index at all
    // (both predate this change), so the guard reads the mirror itself.
    const dir = await getSampleEmployeeDir(root, MONTH_A, true);
    await safeWriteJson(dir, "emp1.samples.json", {
      monthFolderName: MONTH_A,
      username: EMP,
      updatedAt: "2026-05-06T00:00:00.000Z",
      sourceLogRevision: 5,
      quota: { dailyQuota: 9, daysRemainingAtAssignment: 3, sampleCount: 12 },
      entries: [makeMirrorEntry("A1", "pending")],
    });

    // Absent deriveVersion reads as 0 < 3 → rewritten once.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 3, [makeMirrorEntry("A1", "pending")], 4));
    expect((await loadEmployeeSampleMirror(root, MONTH_A, EMP))?.quota?.dailyQuota).toBe(4);

    // …and NOT again: same revision, same version now on disk. A third payload
    // that differs would land only if the guard had stopped holding.
    await syncSampleMirrors(root, MONTH_A, makeCurrentAt(5, 3, [makeMirrorEntry("A1", "completed")], 1));
    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.quota?.dailyQuota).toBe(4);
    expect(mirror?.entries[0]?.status).toBe("pending");
  });
});

describe("2-employees/_index.json accelerator (Design B step 2)", () => {
  /** All entries assigned to distinct employees, so the fan-out is N files. */
  function manyEmployees(revision: number, count: number): DistributionCurrentData {
    const entries = Array.from({ length: count }, (_, i) => ({
      ...makeMirrorEntry(`A${i}`, "pending" as const),
      assignedTo: `emp-${i}`,
    }));
    return makeCurrent(MONTH_A, revision, entries);
  }

  it("replaces the N mirror parses with ONE index read on the guard's read path", async () => {
    const root = createMemoryDirectory("root", { trackReads: true }) as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    // First run: no index exists yet, so the mirrors are read (there are none).
    await syncSampleMirrors(root, MONTH_A, manyEmployees(1, 6));

    clearReadLog(root);
    // Second run at the SAME revision: six mirrors are now on disk and the
    // guard skips every one of them, so no mirror is written either. Every
    // `{username}.samples.json` read left in the log would therefore be the
    // guard's own — safeWriteJson's stage/commit read-backs cannot muddy it.
    await syncSampleMirrors(root, MONTH_A, manyEmployees(1, 6));

    const readsInEmployeesDir = getReadLog(root).filter((path) => path.includes("2-employees"));
    expect(readsInEmployeesDir.filter((path) => path.endsWith("_index.json")).length).toBeGreaterThan(0);
    // The load-bearing assertion: not one of the six mirrors was opened to
    // decide the guard — one index read answered for all of them.
    expect(readsInEmployeesDir.filter((path) => path.endsWith(".samples.json"))).toEqual([]);
  });

  it("falls back to reading the mirrors when the index is missing, and still guards correctly", async () => {
    const root = createMemoryDirectory("root", { trackReads: true }) as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);

    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 5, [makeMirrorEntry("A1", "pending")]));

    // Simulate a workspace written before the index existed: blank it out so it
    // no longer parses as an index at all.
    const dir = await getSampleEmployeeDir(root, MONTH_A, false);
    await safeWriteJson(dir, "_index.json", { nonsense: true });

    clearReadLog(root);
    // An OLDER derivation must still be rejected — via the mirror itself.
    await syncSampleMirrors(root, MONTH_A, makeCurrent(MONTH_A, 3, [makeMirrorEntry("A1", "completed")]));

    expect(
      getReadLog(root).some((path) => path.includes("2-employees") && path.endsWith(".samples.json"))
    ).toBe(true);
    const mirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirror?.sourceLogRevision).toBe(5);
    expect(mirror?.entries[0]?.status).toBe("pending");
  });
});

describe("getUserWorkspaceFootprint", () => {
  it("lists only months with pending mirror entries; completed-only months are excluded", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    // Month A: pending assignment for emp1.
    await seedAssignments(root, MONTH_A, [makeRow("A1"), makeRow("A2")], EMP);

    // Month B: assigned then completed — mirror shows "completed", not pending.
    await seedAssignments(root, MONTH_B, [makeRow("B1")], EMP);
    await appendDistributionEvents(root, MONTH_B, [
      buildCompletedEvent({ xrayImageId: "B1", assignedTo: EMP, eventBy: EMP }),
    ]);
    const logB = await loadDistributionLog(root, MONTH_B);
    const currentB = deriveCurrentDistribution(logB, [makeRow("B1")]);
    await saveDistributionCurrent(root, MONTH_B, currentB);

    const footprint = await getUserWorkspaceFootprint(root, EMP);

    expect(footprint.activeAssignments).toHaveLength(1);
    expect(footprint.activeAssignments[0]).toEqual({ monthFolderName: MONTH_A, pendingCount: 2 });
  });

  it("excludes closed months from activeAssignments even with pending entries", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    await seedAssignments(root, MONTH_A, [makeRow("A1")], EMP);
    await seedManifest(root, MONTH_A);
    await closeMonth(root, MONTH_A, "admin");

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.activeAssignments).toHaveLength(0);
  });

  it("reports answerFileMonths from a saved answer file with no active mirror assignment", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    // A month folder must exist for listMonthFolders to enumerate it.
    await ensurePopulationMonthFolder(root, MONTH_A);
    await saveSampleMaster(root, MONTH_A, makeSample([makeRow("A1")]));
    await upsertItemAnswer(root, MONTH_A, EMP, makeAnswer("A1"));

    const footprint = await getUserWorkspaceFootprint(root, EMP);
    expect(footprint.answerFileMonths).toEqual([MONTH_A]);
    expect(footprint.activeAssignments).toHaveLength(0);
  });

  it("returns empty footprint when the user has no files anywhere", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    await ensurePopulationMonthFolder(root, MONTH_A);
    await saveSampleMaster(root, MONTH_A, makeSample([makeRow("A1")]));

    const footprint = await getUserWorkspaceFootprint(root, "ghost-user");
    expect(footprint.activeAssignments).toHaveLength(0);
    expect(footprint.answerFileMonths).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // P6 (2026-08): a mirror reverted to older bytes than the live event log —
  // exactly what a naive restore of a derived per-employee mirror produces —
  // must not be trusted blindly. The dangerous direction: an assignment made
  // AFTER the mirror was frozen reads as "no pending work" and a deletion
  // that should be blocked silently proceeds.
  // -------------------------------------------------------------------------
  it("REGRESSION (P6): a mirror older than the live event log is not trusted — the real (newer) pending assignment is still counted", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    await ensurePopulationMonthFolder(root, MONTH_A);
    await saveSampleMaster(root, MONTH_A, makeSample([makeRow("A1"), makeRow("A2")]));

    // Revision 1: A1 assigned + mirror synced (pending).
    await appendDistributionEvents(root, MONTH_A, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: EMP, eventBy: "admin" }),
    ]);
    let log = await loadDistributionLog(root, MONTH_A);
    await saveDistributionCurrent(root, MONTH_A, deriveCurrentDistribution(log, [makeRow("A1"), makeRow("A2")]));

    // Revision 2: A1 completed + mirror re-synced — mirror now correctly shows 0 pending.
    await appendDistributionEvents(root, MONTH_A, [
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: EMP, eventBy: EMP }),
    ]);
    log = await loadDistributionLog(root, MONTH_A);
    await saveDistributionCurrent(root, MONTH_A, deriveCurrentDistribution(log, [makeRow("A1"), makeRow("A2")]));

    const mirrorBeforeStaleness = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(mirrorBeforeStaleness?.entries.every((e) => e.status === "completed")).toBe(true);

    // Revision 3: A2 assigned — the live event log moves on, but the mirror is
    // deliberately left un-synced (simulating a restore that put back the
    // revision-2 mirror bytes while distribution.events/ — restored via
    // merge-events — carries the newer assignment).
    await appendDistributionEvents(root, MONTH_A, [
      buildAssignEvent({ xrayImageId: "A2", assignedTo: EMP, eventBy: "admin" }),
    ]);

    // Sanity: the mirror on disk is indeed stale relative to the live log.
    const staleMirror = await loadEmployeeSampleMirror(root, MONTH_A, EMP);
    expect(staleMirror?.entries.some((e) => e.xrayImageId === "A2")).toBe(false);

    const footprint = await getUserWorkspaceFootprint(root, EMP);

    // Before the fix: the stale mirror shows 0 pending (A1 completed, A2
    // absent) so MONTH_A is silently dropped from activeAssignments — a
    // deletion would proceed despite the real, newer A2 assignment.
    expect(footprint.activeAssignments).toHaveLength(1);
    expect(footprint.activeAssignments[0]).toEqual({ monthFolderName: MONTH_A, pendingCount: 1 });
  });
});


// ---------------------------------------------------------------------------
// T-10 (2026-08-19): the footprint scan is the pre-deletion safety check, and
// it used to walk ONLY `listMonthFolders` — which enumerates `1-population/`
// and structurally cannot return an ad-hoc store's synthetic
// `adhoc-{importId}` folder. A user whose entire live workload came from
// ad-hoc imports therefore reported an EMPTY footprint and deleting them
// silently orphaned every assignment and answer they owned.
// ---------------------------------------------------------------------------

const ADHOC_EMP = "jalgahamdi";

function adhocMappedRow(xrayImageId: string, sourceRowNumber: number): NormalizedRiskRow {
  return {
    movementType: "s1",
    portCode: null, portName: "ميناء جدة", portType: "بحري",
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: "DEC-1", transitDeclarationNumber: null, declarationDate: null, declarationHijriDate: null,
    manifestNumber: null, manifestType: null, manifestDate: null,
    plateOrContainerNumber: null, finalDestination: null,
    entryDate: null, exitDate: null,
    chassisNumber: null, reportNumber: null, hasReport: false,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه",
    inspectorResult: null, oppositeInspectorResult: null, liveMeansResult: null,
    xrayImageId, xrayEntryDate: null,
    targetedByRiskEngine: null, riskMessage: null, stage: "المستوى الأول",
    sourceSheetName: "s1", sourceRowNumber,
  };
}

function adhocImportRow(xrayImageId: string, sourceRowNumber: number): AdhocImportRow {
  return {
    rowKey: `s1:${sourceRowNumber}`,
    mapped: adhocMappedRow(xrayImageId, sourceRowNumber),
    validation: { valid: true },
    excludedByAdmin: false,
    assigned: false,
    assignedTo: null,
    assignedAt: null,
    namespacedXrayImageId: null,
  };
}

function adhocRecord(importId: string, rows: AdhocImportRow[]): AdhocImportRecord {
  return {
    importId,
    fileName: `${importId}.xlsx`,
    importedBy: "admin",
    importedAt: "2026-08-07T10:00:00.000Z",
    status: "open",
    rows,
  };
}

describe("getUserWorkspaceFootprint — ad-hoc import stores", () => {
  it("REGRESSION (T-10): a user whose ONLY work is an ad-hoc assignment has a non-empty footprint", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    const record = adhocRecord("adh-fp-1", [adhocImportRow("XR-1", 2), adhocImportRow("XR-2", 3)]);
    await ensureAdhocSampleMaster(root, record);
    const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2", "s1:3"], ADHOC_EMP, "admin");
    expect(assigned.ok).toBe(true);

    const footprint = await getUserWorkspaceFootprint(root, ADHOC_EMP);

    // Before the fix: [] — the ad-hoc folder is invisible to listMonthFolders,
    // so UserManagement read "no active assignments, safe to delete".
    expect(footprint.activeAssignments).toEqual([
      { monthFolderName: adhocMonthFolderName("adh-fp-1"), pendingCount: 2 },
    ]);
  });

  it("REGRESSION (T-10): an answer saved into an ad-hoc store is reported in answerFileMonths", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    const record = adhocRecord("adh-fp-2", [adhocImportRow("XR-9", 2)]);
    await ensureAdhocSampleMaster(root, record);
    const assigned = await assignAdhocRowsToEmployee(root, record, ["s1:2"], ADHOC_EMP, "admin");
    expect(assigned.ok).toBe(true);

    const folder = adhocMonthFolderName("adh-fp-2");
    await upsertItemAnswer(root, folder, ADHOC_EMP, {
      ...makeAnswer("ADHOC-adh-fp-2-XR-9"),
      answeredBy: ADHOC_EMP,
    });

    const footprint = await getUserWorkspaceFootprint(root, ADHOC_EMP);
    expect(footprint.answerFileMonths).toContain(folder);
  });

  it("leaves a user with no ad-hoc work unchanged (empty footprint)", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();

    const record = adhocRecord("adh-fp-3", [adhocImportRow("XR-1", 2)]);
    await ensureAdhocSampleMaster(root, record);
    await assignAdhocRowsToEmployee(root, record, ["s1:2"], ADHOC_EMP, "admin");

    const footprint = await getUserWorkspaceFootprint(root, "ghost-user");
    expect(footprint.activeAssignments).toHaveLength(0);
    expect(footprint.answerFileMonths).toHaveLength(0);
  });
});
