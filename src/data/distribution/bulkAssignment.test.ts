import { beforeEach, describe, expect, it, test } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { DistributionEntry } from "./distributionTypes";
import { calculateBulkAssignment, executeBulkReassignment, planBulkReassignment } from "./bulkAssignment";
import { EVENT_SCHEMA_VERSION, buildAssignEvent, buildCompletedEvent } from "./distributionLog";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { appendDistributionEvents, loadDistributionLog } from "./distributionStorage";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import type { MonthManifestData } from "../population/monthTypes";
import { MonthClosedError, closeMonth, invalidateMonthLockCache } from "../population/monthLock";

function makeUser(
  username: string,
  role: ManagedLoginUser["role"] = "employee",
  hasCertScanLicense = false
): ManagedLoginUser {
  return {
    id: username,
    username,
    displayName: username,
    role,
    passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
    isActive: true,
    hasCertScanLicense,
    createdAt: "",
    updatedAt: ""
  };
}

function makeRow(id: string, stage: string, cert: "Certscan" | "NonCertscan"): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "المنفذ",
    certScanStatus: cert,
    stage,
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
    sourceSheetName: "ورقة",
    sourceRowNumber: 1
  };
}

test("calculateBulkAssignment fails if no employees assigned in active stage", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "NonCertscan")];
  const allocations: EmployeeStageAllocation[] = [];
  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees: [],
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(1);
  expect(result.events).toHaveLength(0);
});

test("calculateBulkAssignment ignores active allocations for non-employee and non-supervisor roles", () => {
  const rows = [
    makeRow("img-1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-2", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-3", "SECOND_STAGE", "NonCertscan")
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true },
    { username: "sup", stageKey: "second", method: "percentage", value: 100, isActive: true },
    { username: "manager", stageKey: "second", method: "percentage", value: 100, isActive: true },
    { username: "admin", stageKey: "second", method: "percentage", value: 100, isActive: true },
    { username: "guest", stageKey: "second", method: "percentage", value: 100, isActive: true }
  ];
  const employees: ManagedLoginUser[] = [
    makeUser("emp", "employee"),
    makeUser("sup", "supervisor"),
    makeUser("manager", "manager"),
    makeUser("admin", "admin"),
    makeUser("guest", "guest")
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(3);
  expect(new Set(result.events.map((event) => event.assignedTo))).toEqual(new Set(["emp", "sup"]));
});

test("calculateBulkAssignment fails for CertScan rows if no employee has CertScan license", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "Certscan")];
  const allocations: EmployeeStageAllocation[] = [
    { username: "user1", stageKey: "second", method: "percentage", value: 100, isActive: true }
  ];
  const employees: ManagedLoginUser[] = [
    {
      id: "u1",
      username: "user1",
      displayName: "User 1",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: false, // NOT LICENSED
      createdAt: "",
      updatedAt: ""
    }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("خطأ: توجد سجلات CertScan");
  expect(result.events).toHaveLength(0);
});

function makeEntry(id: string, status: DistributionEntry["status"], assignedTo = "emp"): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo,
    status,
    replacedById: null,
    lastEventAt: "",
    row: makeRow(id, "SECOND_STAGE", "NonCertscan"),
  };
}

test("re-running bulk assignment emits zero duplicate events for already-owned/completed rows", () => {
  const rows = [
    makeRow("img-1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-2", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-3", "SECOND_STAGE", "NonCertscan"),
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true },
  ];
  const employees = [makeUser("emp", "employee")];

  // img-1 completed, img-2 already assigned/pending — both must be skipped.
  const existingEntries: DistributionEntry[] = [
    makeEntry("img-1", "completed"),
    makeEntry("img-2", "pending"),
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    existingEntries,
  });

  expect(result.skipped).toBe(2);
  expect(result.events).toHaveLength(1);
  expect(result.events[0]!.xrayImageId).toBe("img-3");
});

test("re-running bulk assignment with all rows already owned emits nothing", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "NonCertscan")];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true },
  ];
  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test",
    existingEntries: [makeEntry("img-1", "completed")],
  });
  expect(result.events).toHaveLength(0);
  expect(result.skipped).toBe(1);
});

test("calculateBulkAssignment assigns CertScan records and normal records correctly", () => {
  const rows = [
    makeRow("img-c1", "SECOND_STAGE", "Certscan"),
    makeRow("img-n1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-n2", "SECOND_STAGE", "NonCertscan")
  ];

  const allocations: EmployeeStageAllocation[] = [
    { username: "user1", stageKey: "second", method: "percentage", value: 50, isActive: true },
    { username: "user2", stageKey: "second", method: "percentage", value: 50, isActive: true }
  ];

  const employees: ManagedLoginUser[] = [
    {
      id: "u1",
      username: "user1",
      displayName: "User 1",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: true, // CertScan licensed
      createdAt: "",
      updatedAt: ""
    },
    {
      id: "u2",
      username: "user2",
      displayName: "User 2",
      role: "employee",
      passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
      isActive: true,
      hasCertScanLicense: false, // Normal employee
      createdAt: "",
      updatedAt: ""
    }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(3);

  // CertScan record img-c1 should ONLY go to user1
  const certEvent = result.events.find(e => e.xrayImageId === "img-c1");
  expect(certEvent?.assignedTo).toBe("user1");

  // Normal records should be distributed proportionately
  const user1Events = result.events.filter(e => e.assignedTo === "user1");
  const user2Events = result.events.filter(e => e.assignedTo === "user2");
  expect(user1Events.length).toBeGreaterThanOrEqual(1);
  expect(user2Events.length).toBeGreaterThanOrEqual(1);
});

test("calculateBulkAssignment stamps every generated event with the current event schema version", () => {
  const rows = [
    makeRow("img-c1", "SECOND_STAGE", "Certscan"),
    makeRow("img-n1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-n2", "SECOND_STAGE", "NonCertscan")
  ];

  const allocations: EmployeeStageAllocation[] = [
    { username: "user1", stageKey: "second", method: "percentage", value: 50, isActive: true },
    { username: "user2", stageKey: "second", method: "percentage", value: 50, isActive: true }
  ];

  const employees: ManagedLoginUser[] = [
    makeUser("user1", "employee", true),
    makeUser("user2", "employee", false)
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test"
  });

  expect(result.events.length).toBeGreaterThan(0);
  for (const event of result.events) {
    expect(event.eventSchemaVersion).toBe(EVENT_SCHEMA_VERSION);
  }
});

// ── planBulkReassignment / executeBulkReassignment ──────────────────────────
// Oversight-role bulk reassignment: an already-distributed selection (manual
// or "everything matching the current filter") moved to a single employee in
// one action, through the same append-only distribution event log.

describe("planBulkReassignment", () => {
  it("categorizes every row: eligible, or skipped with the specific reason", () => {
    const entries: DistributionEntry[] = [
      makeEntry("img-pending", "pending", "emp1"),
      makeEntry("img-completed", "completed", "emp1"),
      makeEntry("img-replaced", "replaced", "emp1"),
      makeEntry("img-already-target", "pending", "emp2"),
    ];

    const plan = planBulkReassignment(
      entries,
      ["img-pending", "img-completed", "img-replaced", "img-already-target", "img-missing"],
      "emp2"
    );

    expect(plan.eligible).toEqual([{ xrayImageId: "img-pending", assignedTo: "emp1" }]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { xrayImageId: "img-completed", reason: "terminal-completed" },
        { xrayImageId: "img-replaced", reason: "terminal-replaced" },
        { xrayImageId: "img-already-target", reason: "already-assigned-to-target" },
        { xrayImageId: "img-missing", reason: "not-found" },
      ])
    );
    expect(plan.skipped).toHaveLength(4);
  });

  it("treats a replacement-requested row as still eligible for reassignment", () => {
    const entries: DistributionEntry[] = [makeEntry("img-1", "replacement-requested", "emp1")];
    const plan = planBulkReassignment(entries, ["img-1"], "emp2");
    expect(plan.eligible).toEqual([{ xrayImageId: "img-1", assignedTo: "emp1" }]);
    expect(plan.skipped).toHaveLength(0);
  });
});

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

const MONTH = "5-May-2026";

async function makeRoot() {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

describe("executeBulkReassignment", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("reassigns exactly the requested (eligible) rows and reports none skipped", async () => {
    const root = await makeRoot();
    const rows = [makeRow("A1", "SECOND_STAGE", "NonCertscan"), makeRow("A2", "SECOND_STAGE", "NonCertscan")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin" }),
    ]);

    const result = await executeBulkReassignment({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2"],
      reassignedTo: "emp2",
      eventBy: "sup1",
      reason: "إعادة توزيع العمل",
      sourceRequestId: "batch-1",
    });

    expect(result.ok).toBe(true);
    expect(result.appliedIds.sort()).toEqual(["A1", "A2"]);
    expect(result.alreadyAppliedIds).toEqual([]);
    expect(result.skipped).toEqual([]);

    const log = await loadDistributionLog(root, MONTH);
    const reassigns = log.events.filter((e) => e.eventType === "reassigned");
    expect(reassigns).toHaveLength(2);
    expect(reassigns.every((e) => e.reassignedTo === "emp2" && e.sourceRequestId === "batch-1")).toBe(true);
  });

  it("reassigns only the eligible subset of a mixed selection and reports the rest as skipped with reasons (partial-failure reporting)", async () => {
    const root = await makeRoot();
    const rows = [makeRow("A1", "SECOND_STAGE", "NonCertscan"), makeRow("A2", "SECOND_STAGE", "NonCertscan")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin" }),
    ]);
    // A1 is completed — terminal, must not be reassigned (would orphan its answer).
    await appendDistributionEvents(root, MONTH, [
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
    ]);

    const result = await executeBulkReassignment({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2", "does-not-exist"],
      reassignedTo: "emp2",
      eventBy: "sup1",
      sourceRequestId: "batch-2",
    });

    expect(result.ok).toBe(true);
    expect(result.appliedIds).toEqual(["A2"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { xrayImageId: "A1", reason: "terminal-completed" },
        { xrayImageId: "does-not-exist", reason: "not-found" },
      ])
    );

    const log = await loadDistributionLog(root, MONTH);
    const reassigns = log.events.filter((e) => e.eventType === "reassigned");
    expect(reassigns).toHaveLength(1);
    expect(reassigns[0]!.xrayImageId).toBe("A2");
  });

  it("is idempotent on retry: a repeated call with the same sourceRequestId re-emits nothing for ids already durably reassigned", async () => {
    const root = await makeRoot();
    const rows = [makeRow("A1", "SECOND_STAGE", "NonCertscan"), makeRow("A2", "SECOND_STAGE", "NonCertscan")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin" }),
    ]);

    const first = await executeBulkReassignment({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2"],
      reassignedTo: "emp2",
      eventBy: "sup1",
      sourceRequestId: "batch-retry",
    });
    expect(first.ok).toBe(true);
    expect(first.appliedIds.sort()).toEqual(["A1", "A2"]);

    const before = (await loadDistributionLog(root, MONTH)).events.length;

    // Simulated retry after a UI-level failure/re-click — same batch id.
    const second = await executeBulkReassignment({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: ["A1", "A2"],
      reassignedTo: "emp2",
      eventBy: "sup1",
      sourceRequestId: "batch-retry",
    });

    expect(second.ok).toBe(true);
    expect(second.appliedIds).toEqual([]);
    expect(second.alreadyAppliedIds.sort()).toEqual(["A1", "A2"]);
    // No new events written — replay guard recognized both ids as already applied.
    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(before);
  });

  it("rejects with MonthClosedError and writes nothing when the month is closed (month-lock rejection)", async () => {
    const root = await makeRoot();
    const rows = [makeRow("A1", "SECOND_STAGE", "NonCertscan")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    ]);

    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const manifest: MonthManifestData = {
      monthFolderName: MONTH, month: 5, year: 2026,
      processedAt: new Date().toISOString(), processedBy: "admin",
      riskFileName: null, biFileName: null, certScanUsed: false,
      templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 1,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, MONTH, "admin");

    const before = (await loadDistributionLog(root, MONTH)).events.length;
    await expect(
      executeBulkReassignment({
        directoryHandle: root,
        monthFolderName: MONTH,
        xrayImageIds: ["A1"],
        reassignedTo: "emp2",
        eventBy: "sup1",
        sourceRequestId: "batch-closed",
      })
    ).rejects.toThrow(MonthClosedError);

    expect((await loadDistributionLog(root, MONTH)).events).toHaveLength(before);
  });

  it("no-ops cleanly when xrayImageIds is empty", async () => {
    const root = await makeRoot();
    const result = await executeBulkReassignment({
      directoryHandle: root,
      monthFolderName: MONTH,
      xrayImageIds: [],
      reassignedTo: "emp2",
      eventBy: "sup1",
      sourceRequestId: "batch-empty",
    });
    expect(result).toEqual({ ok: true, appliedIds: [], alreadyAppliedIds: [], skipped: [] });
  });
});
