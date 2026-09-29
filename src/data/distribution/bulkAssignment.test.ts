import { expect, test, vi } from "vitest";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeeStageAllocation, EmployeePortRestriction } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import type { DistributionEntry } from "./distributionTypes";
import { calculateBulkAssignment } from "./bulkAssignment";
import { EVENT_SCHEMA_VERSION } from "./distributionLog";
import { makeUser, makeRow } from "./bulkAssignmentTestFixtures";

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

test("calculateBulkAssignment guarantees a trapped employee their only reachable port instead of splitting it 'fairly' by need", () => {
  // "b", "c", "d" at 25% each are only eligible for the 900-row port; "a" is
  // eligible for BOTH ports. Weighting each port purely by remaining need
  // (an earlier version of this fix) would split the 100-row port 25/25/25/25
  // between all four just because their remaining needs still look equal,
  // handing "a" a quarter of the one port "b"/"c"/"d" don't even reach,
  // while "a" has 900 other rows available. "a" has nowhere near as much
  // riding on this port as "b"/"c"/"d" do, so it must be guaranteed to them.
  const rows: PreparedPopulationRow[] = [
    ...Array.from({ length: 900 }, (_, i) => makeRow(`big-${i}`, "SECOND_STAGE", "NonCertscan", "port-big")),
    ...Array.from({ length: 100 }, (_, i) => makeRow(`small-${i}`, "SECOND_STAGE", "NonCertscan", "port-small")),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "b", restricted: true, enabledPorts: ["port-big"] },
    { username: "c", restricted: true, enabledPorts: ["port-big"] },
    { username: "d", restricted: true, enabledPorts: ["port-small"] },
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

  const smallTotals = new Map<string, number>();
  for (const e of result.events) {
    if (e.xrayImageId.startsWith("small-")) smallTotals.set(e.assignedTo, (smallTotals.get(e.assignedTo) ?? 0) + 1);
  }
  // "d" has no other port at all — it must get the whole 100-row port.
  expect(smallTotals.get("d")).toBe(100);
  expect(smallTotals.get("a") ?? 0).toBe(0);

  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  // With "d" capped at 100 (its only reachable capacity), the other 900 rows
  // split evenly three ways among a/b/c (25% each of the remaining pool).
  for (const username of ["a", "b", "c"]) {
    expect(totals.get(username)).toBe(300);
  }
});

test("calculateBulkAssignment respects unequal configured percentages, not just an equal split, when restrictions are active", () => {
  // "a" at 20% / "b" at 80% of 1000 rows → targets 200 / 800. "b" has an
  // exclusive 700-row port plus a shared 300-row port with "a"; "a" only
  // reaches the shared port. This is feasible (unlike a 50/50 split of the
  // shared port, which would overshoot "a"'s 200 target) and should land on
  // exactly the configured ratio, not default to equal shares anywhere.
  const rows: PreparedPopulationRow[] = [
    ...Array.from({ length: 300 }, (_, i) => makeRow(`shared-${i}`, "SECOND_STAGE", "NonCertscan", "port-shared")),
    ...Array.from({ length: 700 }, (_, i) => makeRow(`excl-${i}`, "SECOND_STAGE", "NonCertscan", "port-exclusive")),
  ];
  const allocations: EmployeeStageAllocation[] = [
    { username: "a", stageKey: "second", method: "percentage", value: 20, isActive: true },
    { username: "b", stageKey: "second", method: "percentage", value: 80, isActive: true },
  ];
  const employees = [makeUser("a", "employee"), makeUser("b", "employee")];
  const portRestrictions: EmployeePortRestriction[] = [
    { username: "a", restricted: true, enabledPorts: ["port-shared"] },
  ];

  const result = calculateBulkAssignment({
    rows,
    allocations,
    employees,
    operatorUsername: "test",
    portRestrictions,
  });

  expect(result.errors).toHaveLength(0);
  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  expect(totals.get("a")).toBe(200);
  expect(totals.get("b")).toBe(800);
});

test("A3: an employee short in one stage because of a port restriction is made up in another stage", () => {
  const rowsFor = (prefix: string, count: number, stage: string, port: string) =>
    Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stage, "NonCertscan", port));
  const rows: PreparedPopulationRow[] = [
    ...rowsFor("s1a", 360, "FIRST_STAGE", "port-A"),
    ...rowsFor("s1b", 40, "FIRST_STAGE", "port-B"),
    ...rowsFor("s2b", 400, "SECOND_STAGE", "port-B"),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].flatMap((username) => [
    { username, stageKey: "first", method: "percentage", value: 25, isActive: true },
    { username, stageKey: "second", method: "percentage", value: 25, isActive: true },
  ]);
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(800);
  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  for (const username of ["a", "b", "c", "d"]) {
    expect(Math.abs((totals.get(username) ?? 0) - 200)).toBeLessThanOrEqual(1);
  }
  // "d" never receives a port-A row.
  expect(result.events.filter((e) => e.assignedTo === "d" && e.xrayImageId.startsWith("s1a-"))).toHaveLength(0);
});

// F9 (controller ruling): a restricted fixture that ALSO has CertScan rows and a
// mix of licensed/unlicensed employees. Equal totals must hold (±1 rounding)
// AND CertScan rows must still only ever land on a licensed employee, even
// after the cross-stage rebalance moves rows between employees.
test("A3 + F9: cross-stage rebalance keeps CertScan rows on licensed employees only, while equalizing totals", () => {
  const rowsFor = (prefix: string, count: number, stage: string, port: string, cert: "Certscan" | "NonCertscan" = "NonCertscan") =>
    Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stage, cert, port));
  const rows: PreparedPopulationRow[] = [
    ...rowsFor("s1a-cert", 40, "FIRST_STAGE", "port-A", "Certscan"),
    ...rowsFor("s1a", 320, "FIRST_STAGE", "port-A"),
    ...rowsFor("s1b", 40, "FIRST_STAGE", "port-B"),
    ...rowsFor("s2b", 400, "SECOND_STAGE", "port-B"),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].flatMap((username) => [
    { username, stageKey: "first", method: "percentage", value: 25, isActive: true },
    { username, stageKey: "second", method: "percentage", value: 25, isActive: true },
  ]);
  // Only "a" and "b" hold a CertScan license; "d" (the restricted employee) does not.
  const employees = [
    makeUser("a", "employee", true),
    makeUser("b", "employee", true),
    makeUser("c", "employee", false),
    makeUser("d", "employee", false),
  ];
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(800);

  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  for (const username of ["a", "b", "c", "d"]) {
    expect(Math.abs((totals.get(username) ?? 0) - 200)).toBeLessThanOrEqual(1);
  }

  const certRowIds = new Set(rows.filter((r) => r.certScanStatus === "Certscan").map((r) => r.xrayImageId));
  const licensed = new Set(["a", "b"]);
  for (const event of result.events) {
    if (certRowIds.has(event.xrayImageId)) {
      expect(licensed.has(event.assignedTo)).toBe(true);
    }
  }
  // "d" never receives a port-A row (unlicensed + port-restricted).
  expect(result.events.filter((e) => e.assignedTo === "d" && e.xrayImageId.startsWith("s1a"))).toHaveLength(0);
});

// F9 review fix (fix round 1): the F9 test above never actually exercises the
// license clause in `canTake` — its only under-target employee ("d") is
// port-restricted away from every CertScan-holding port, so the port check
// in `canTake` already returns false before the license check runs, and
// `return true || ...` there still passes all assertions (mutation-tested).
// This fixture instead makes "d" fully port-eligible for the ONE port that
// holds every CertScan row: SECOND_STAGE only has port-B, and "d" is
// restricted TO port-B. "a" (the sole licensed employee) is given a quota
// in that group that exactly matches the CertScan row count, so "a" has
// ZERO normal rows to donate there — its entire over-target surplus sits in
// CertScan rows. If the license check were removed, "d"'s shortfall would
// be filled from those CertScan rows (stage+port checks alone let it
// through); with the check, the rebalance correctly refuses and "d" is left
// short instead of receiving CertScan work it isn't licensed for.
test("A3 + F9 (fix round 1): rebalance never assigns a CertScan row to an unlicensed employee, even when that employee IS port-eligible for the group holding them", () => {
  const rowsFor = (prefix: string, count: number, stage: string, port: string, cert: "Certscan" | "NonCertscan" = "NonCertscan") =>
    Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stage, cert, port));
  const rows: PreparedPopulationRow[] = [
    ...rowsFor("s1a", 360, "FIRST_STAGE", "port-A"),
    ...rowsFor("s1b", 40, "FIRST_STAGE", "port-B"),
    ...rowsFor("s2cert", 100, "SECOND_STAGE", "port-B", "Certscan"),
    ...rowsFor("s2norm", 300, "SECOND_STAGE", "port-B"),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].flatMap((username) => [
    { username, stageKey: "first", method: "percentage", value: 25, isActive: true },
    { username, stageKey: "second", method: "percentage", value: 25, isActive: true },
  ]);
  // Only "a" holds a CertScan license.
  const employees = [
    makeUser("a", "employee", true),
    makeUser("b", "employee", false),
    makeUser("c", "employee", false),
    makeUser("d", "employee", false),
  ];
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.errors).toHaveLength(0);
  expect(result.events).toHaveLength(800);

  // The regression guard: no CertScan row is ever assigned to an unlicensed
  // employee. Every one of the 100 CertScan rows stays with "a".
  const certRowIds = new Set(rows.filter((r) => r.certScanStatus === "Certscan").map((r) => r.xrayImageId));
  for (const event of result.events) {
    if (certRowIds.has(event.xrayImageId)) expect(event.assignedTo).toBe("a");
  }
  expect(result.events.filter((e) => certRowIds.has(e.xrayImageId))).toHaveLength(100);
  expect(result.events.filter((e) => e.assignedTo === "d" && certRowIds.has(e.xrayImageId))).toHaveLength(0);

  // "d"'s FIRST_STAGE shortfall (60, port-A-locked exactly as in the A3 test
  // above) is made up entirely from "b" and "c"'s SECOND_STAGE normal
  // surplus (20 each = 40) plus what's left of "a"'s own over-target amount
  // — but "a" has ZERO normal rows in SECOND_STAGE to give (its whole quota
  // there is CertScan), so the license clause correctly refuses to hand
  // "d" any of "a"'s cert rows. "d" ends 20 short of the equal 200 target
  // as a result: this is the license rule winning over the equal-totals
  // rule, not a bug.
  const totals = new Map<string, number>();
  for (const e of result.events) totals.set(e.assignedTo, (totals.get(e.assignedTo) ?? 0) + 1);
  expect(totals.get("a")).toBe(220);
  expect(totals.get("b")).toBe(200);
  expect(totals.get("c")).toBe(200);
  expect(totals.get("d")).toBe(180);
});

// F10 review fix (fix round 1): prove `restampDailyQuota` is load-bearing.
// Removing it (returning `balanced` unrestamped from `calculateBulkAssignment`)
// still passes every other bulkAssignment test (mutation-tested) because none
// of them read `dailyQuota` after a cross-stage rebalance. This test does.
test("A3 + F10 (fix round 1): the stamped event's dailyQuota is restamped to each employee's post-rebalance group count", () => {
  const rowsFor = (prefix: string, count: number, stage: string, port: string) =>
    Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stage, "NonCertscan", port));
  const rows: PreparedPopulationRow[] = [
    ...rowsFor("s1a", 360, "FIRST_STAGE", "port-A"),
    ...rowsFor("s1b", 40, "FIRST_STAGE", "port-B"),
    ...rowsFor("s2b", 400, "SECOND_STAGE", "port-B"),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].flatMap((username) => [
    { username, stageKey: "first", method: "percentage", value: 25, isActive: true },
    { username, stageKey: "second", method: "percentage", value: 25, isActive: true },
  ]);
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];

  // daysRemaining comes from `new Date()` inside calculateBulkAssignment, so
  // the clock is pinned (Date only — async timers stay real). From
  // 2026-09-28 (Monday) to the October 2026 deadline (Wed 28 Oct) is 23
  // WORKING days (Sunday–Thursday, both ends inclusive; C3 — it was 31
  // calendar days before the stamp switched to the same working-day count the
  // derived quota uses). ceil(100/23)=5, ceil(160/23)=7, ceil(80/23)=4 are
  // all distinct, so a stale (unrestamped) quota can never coincide with the
  // restamped one. On the real clock this would drift into days where the
  // ceilings collapse or reach 0 (no stamp).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 28, 12));
  let result: ReturnType<typeof calculateBulkAssignment>;
  try {
    result = calculateBulkAssignment({
      rows, allocations, employees, operatorUsername: "test", portRestrictions, month: 10, year: 2026,
    });
  } finally {
    vi.useRealTimers();
  }

  expect(result.errors).toHaveLength(0);

  // "d"'s SECOND_STAGE/port-B group grows from its pre-rebalance stage
  // target (100) to 160 once the FIRST_STAGE shortfall is made up there
  // (same mechanics as the A3 test above). The one stamped event "d" was
  // given for that group at generation time never moves during rebalance
  // (`rebalanceTowardMonthTargets` skips stamped events), so if
  // `restampDailyQuota` did not run, that event's `dailyQuota` would still
  // reflect the stale pre-rebalance count of 100.
  const dSecondStageEvents = result.events.filter((e) => e.assignedTo === "d" && e.xrayImageId.startsWith("s2b-"));
  expect(dSecondStageEvents).toHaveLength(160);
  const dStamped = dSecondStageEvents.filter((e) => e.dailyQuota !== undefined);
  expect(dStamped).toHaveLength(1);
  const daysRemaining = dStamped[0]!.daysRemainingAtAssignment!;
  expect(daysRemaining).toBe(23);
  expect(dStamped[0]!.dailyQuota).toBe(Math.ceil(160 / daysRemaining));
  expect(dStamped[0]!.dailyQuota).not.toBe(Math.ceil(100 / daysRemaining));

  // "a" donated 20 of its 100 SECOND_STAGE/port-B rows to "d" (its share of
  // the 60 moved); its own surviving stamped event in that same group must
  // likewise drop to the new count (80), not stay at the stale 100.
  const aSecondStageEvents = result.events.filter((e) => e.assignedTo === "a" && e.xrayImageId.startsWith("s2b-"));
  expect(aSecondStageEvents).toHaveLength(80);
  const aStamped = aSecondStageEvents.filter((e) => e.dailyQuota !== undefined);
  expect(aStamped).toHaveLength(1);
  expect(aStamped[0]!.dailyQuota).toBe(Math.ceil(80 / daysRemaining));
  expect(aStamped[0]!.dailyQuota).not.toBe(Math.ceil(100 / daysRemaining));
});

test("A3: a re-run with prior ownership balances the unassigned rows toward equal totals", () => {
  const rows: PreparedPopulationRow[] = Array.from({ length: 400 }, (_, i) =>
    makeRow(`r-${i}`, "SECOND_STAGE", "NonCertscan", "port-P")
  );
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  // A restriction that excludes nothing still switches on restricted mode.
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-P"] }];
  const existingEntries: DistributionEntry[] = rows.slice(0, 100).map((r) => ({
    xrayImageId: r.xrayImageId,
    assignedTo: "a",
    assignedBy: "test",
    assignedAt: "2026-09-01T00:00:00.000Z",
    status: "assigned",
    row: r,
  } as unknown as DistributionEntry));

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions, existingEntries });

  expect(result.skipped).toBe(100);
  const fresh = new Map<string, number>();
  for (const e of result.events) fresh.set(e.assignedTo, (fresh.get(e.assignedTo) ?? 0) + 1);
  expect(fresh.get("a") ?? 0).toBe(0);
  for (const username of ["b", "c", "d"]) expect(fresh.get(username)).toBe(100);
});

test("A3: reports an employee whose allowed rows cannot reach their target", () => {
  const rows: PreparedPopulationRow[] = [
    ...Array.from({ length: 900 }, (_, i) => makeRow(`big-${i}`, "SECOND_STAGE", "NonCertscan", "port-big")),
    ...Array.from({ length: 100 }, (_, i) => makeRow(`small-${i}`, "SECOND_STAGE", "NonCertscan", "port-small")),
  ];
  const allocations: EmployeeStageAllocation[] = ["a", "b", "c", "d"].map((username) => ({
    username,
    stageKey: "second",
    method: "percentage",
    value: 25,
    isActive: true,
  }));
  const employees = ["a", "b", "c", "d"].map((username) => makeUser(username, "employee"));
  const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-small"] }];

  const result = calculateBulkAssignment({ rows, allocations, employees, operatorUsername: "test", portRestrictions });

  expect(result.targetShortfalls).toEqual([{ username: "d", target: 250, allowed: 100 }]);
});

test("A3: no shortfall report without port restrictions", () => {
  const rows = [makeRow("img-1", "SECOND_STAGE", "NonCertscan")];
  const result = calculateBulkAssignment({
    rows,
    allocations: [{ username: "emp", stageKey: "second", method: "percentage", value: 100, isActive: true }],
    employees: [makeUser("emp", "employee")],
    operatorUsername: "test",
  });
  expect(result.targetShortfalls).toEqual([]);
});
