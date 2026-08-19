import { expect, test } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import type { DistributionEntry } from "./distributionTypes";
import { calculateBulkAssignment } from "./bulkAssignment";
import { EVENT_SCHEMA_VERSION } from "./distributionLog";

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

// ── T-14: rows dropped for an unresolvable stage are reported, not silent ───
//
// The stage loop only walks first/second/third/fourth. A row whose stage label
// no longer resolves through the workspace-global mappings (an admin edited
// them after the draw, an import spelled the level differently) answers
// "unknown" from getStageKey and matches none of them — it was never assigned
// and never mentioned, so the operator believed the month was fully covered.

test("calculateBulkAssignment reports rows skipped because their stage does not resolve", () => {
  const rows = [
    makeRow("img-1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-2", "المستوى المستحدث", "NonCertscan"),
    makeRow("img-3", "المستوى المستحدث", "NonCertscan"),
    makeRow("img-4", "STAGE_X", "NonCertscan")
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test"
  });

  // Behaviour is unchanged: exactly the one resolvable row is assigned.
  expect(result.events.map((event) => event.xrayImageId)).toEqual(["img-1"]);
  // What is new: the three dropped rows are now counted and named.
  expect(result.unmapped.count).toBe(3);
  expect(new Set(result.unmapped.stages)).toEqual(new Set(["المستوى المستحدث", "STAGE_X"]));
});

test("calculateBulkAssignment reports no unmapped rows when every stage resolves", () => {
  const rows = [
    makeRow("img-1", "SECOND_STAGE", "NonCertscan"),
    makeRow("img-2", "SECOND_STAGE", "NonCertscan")
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true }
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test"
  });

  expect(result.events).toHaveLength(2);
  expect(result.unmapped.count).toBe(0);
  expect(result.unmapped.stages).toEqual([]);
});

test("calculateBulkAssignment counts an already-assigned unmappable row as skipped, not unmapped", () => {
  const rows = [makeRow("img-1", "STAGE_X", "NonCertscan")];
  const existingEntries: DistributionEntry[] = [
    {
      xrayImageId: "img-1",
      assignedTo: "emp",
      assignedBy: "test",
      assignedAt: new Date().toISOString(),
      status: "assigned",
      row: rows[0]
    } as unknown as DistributionEntry
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations: [
      { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true }
    ],
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test",
    existingEntries
  });

  expect(result.skipped).toBe(1);
  // Already owned — it is not waiting to be distributed, so warning about it
  // would send the operator chasing a row that is fine.
  expect(result.unmapped.count).toBe(0);
});
