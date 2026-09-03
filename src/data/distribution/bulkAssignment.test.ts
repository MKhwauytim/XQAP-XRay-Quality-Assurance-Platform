import { expect, test } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation, EmployeePortRestriction } from "../population/populationConfig";
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

function makeRow(
  id: string,
  stage: string,
  cert: "Certscan" | "NonCertscan",
  portName = "المنفذ"
): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
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

// ── Port eligibility ─────────────────────────────────────────────────────
//
// An employee can be restricted to a subset of ports. When NO employee has any
// restriction configured, behavior must be byte-for-byte identical to before
// this feature existed (every test above this section proves that, since none
// of them pass `portRestrictions`). These tests cover what changes once a
// restriction is actually in play.

test("calculateBulkAssignment only assigns a port's rows to employees eligible for that port", () => {
  const rows = [
    makeRow("img-jed-1", "SECOND_STAGE", "NonCertscan", "ميناء جدة"),
    makeRow("img-jed-2", "SECOND_STAGE", "NonCertscan", "ميناء جدة"),
    makeRow("img-dam-1", "SECOND_STAGE", "NonCertscan", "ميناء الدمام"),
    makeRow("img-dam-2", "SECOND_STAGE", "NonCertscan", "ميناء الدمام"),
  ];
  const allocations: EmployeeStageAllocation[] = [
    // "open" listed first: with no port filtering, the assignment loop would
    // hand "open" the first two rows in array order (Jeddah) and "restricted"
    // the rest (Dammam) — the opposite of what this test checks for — so a
    // regression that drops port filtering cannot pass by row-order coincidence.
    { username: "open", stageKey: "second", method: "percentage", value: 50, isActive: true },
    { username: "restricted", stageKey: "second", method: "percentage", value: 50, isActive: true },
  ];
  const employees = [makeUser("restricted", "employee"), makeUser("open", "employee")];
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "restricted", restricted: true, enabledPorts: ["ميناء جدة"] },
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions,
  });

  expect(result.errors).toHaveLength(0);
  const damEvents = result.events.filter((e) => e.xrayImageId.startsWith("img-dam"));
  expect(damEvents.every((e) => e.assignedTo === "open")).toBe(true);
  // The restricted employee may still receive Jeddah rows.
  const jedEvents = result.events.filter((e) => e.xrayImageId.startsWith("img-jed"));
  expect(jedEvents.length).toBeGreaterThan(0);
});

test("calculateBulkAssignment reports an error and leaves a port's rows unassigned when nobody is eligible for it", () => {
  const rows = [
    makeRow("img-jed-1", "SECOND_STAGE", "NonCertscan", "ميناء جدة"),
    makeRow("img-dam-1", "SECOND_STAGE", "NonCertscan", "ميناء الدمام"),
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "restricted", stageKey: "second", method: "percentage", value: 100, isActive: true },
  ];
  const employees = [makeUser("restricted", "employee")];
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "restricted", restricted: true, enabledPorts: ["ميناء جدة"] },
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions,
  });

  expect(result.events.map((e) => e.xrayImageId)).toEqual(["img-jed-1"]);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("ميناء الدمام");
});

test("calculateBulkAssignment applies the CertScan-license rule within each port's eligible group", () => {
  const rows = [makeRow("img-dam-c1", "SECOND_STAGE", "Certscan", "ميناء الدمام")];
  const allocations: EmployeeStageAllocation[] = [
    { username: "licensed-elsewhere", stageKey: "second", method: "percentage", value: 100, isActive: true },
  ];
  // Licensed for CertScan, but restricted to a different port than the CertScan row.
  const employees = [makeUser("licensed-elsewhere", "employee", true)];
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "licensed-elsewhere", restricted: true, enabledPorts: ["ميناء جدة"] },
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions,
  });

  expect(result.events).toHaveLength(0);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("ميناء الدمام");
});

test("calculateBulkAssignment with an empty portRestrictions list behaves exactly like omitting it", () => {
  const rows = [
    makeRow("img-1", "SECOND_STAGE", "NonCertscan", "ميناء جدة"),
    makeRow("img-2", "SECOND_STAGE", "NonCertscan", "ميناء الدمام"),
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true },
  ];
  const employees = [makeUser("emp", "employee")];

  const withoutParam = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test" });
  const withEmptyList = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions: [],
  });

  // eventId is a fresh random UUID per call, so compare the meaningful shape
  // rather than raw event objects.
  const projection = (events: typeof withoutParam.events) =>
    events.map((e) => ({ xrayImageId: e.xrayImageId, assignedTo: e.assignedTo, notes: e.notes }));
  expect(projection(withEmptyList.events)).toEqual(projection(withoutParam.events));
  expect(withEmptyList.errors).toEqual(withoutParam.errors);
});

test("calculateBulkAssignment keeps every employee's total near their equal percentage even when one is port-restricted", () => {
  // Four employees at an equal 25% each, four ports of very different sizes.
  // Employee "d" can only work one (the smallest) port. Before the fix, each
  // port re-apportioned itself at 100% among only its eligible employees —
  // "d" then drew a full 25%-of-port share from every port it could reach
  // while its excluded share from the other ports was never made up
  // elsewhere, so totals drifted far from 25% each (the bug report: employees
  // ending up with 1800/2000/2500/1400 instead of equal shares). The fix
  // tracks one shared remaining-need pool per employee across ports so the
  // final totals stay anchored to the configured percentage.
  const ports = [
    { name: "port-huge", count: 400 },
    { name: "port-big", count: 300 },
    { name: "port-medium", count: 200 },
    { name: "port-small", count: 100 },
  ];
  const rows: PreparedPopulationRow[] = ports.flatMap(({ name, count }) =>
    Array.from({ length: count }, (_, i) => makeRow(`${name}-${i}`, "SECOND_STAGE", "NonCertscan", name))
  );
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "d", restricted: true, enabledPorts: ["port-big", "port-medium", "port-small"] },
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions,
  });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(1000);

  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);

  // Equal 25% shares of 1000 rows is 250 each. Every employee's total —
  // including the restricted one — must land close to that, not the wildly
  // uneven totals the old per-port renormalization produced.
  for (const username of ["a", "b", "c", "d"]) {
    expect(totals.get(username) ?? 0).toBeGreaterThanOrEqual(240);
    expect(totals.get(username) ?? 0).toBeLessThanOrEqual(260);
  }
});
