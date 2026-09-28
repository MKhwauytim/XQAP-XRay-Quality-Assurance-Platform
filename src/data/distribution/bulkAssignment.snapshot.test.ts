import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeePortRestriction, EmployeeStageAllocation } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { PasswordHashRecord } from "../../auth/passwordCrypto";
import type { DistributionEntry } from "./distributionTypes";
import { makePopulationRow } from "../population/populationTestFixtures";
import { calculateBulkAssignment, type BulkAssignmentResult } from "./bulkAssignment";

// Titles carry a "[no-restriction]" or "[port-restricted]" tag so a later task
// can update ONLY the restricted snapshots with `-t "port-restricted" -u`.

function user(username: string, licensed = false): ManagedLoginUser {
  return {
    id: username,
    username,
    displayName: username,
    role: "employee",
    passwordHash: { algorithm: "PBKDF2-SHA256", saltBase64: "s", hashBase64: "h", iterations: 600000 } as PasswordHashRecord,
    isActive: true,
    hasCertScanLicense: licensed,
    createdAt: "",
    updatedAt: "",
  };
}

function row(id: string, stage: string, port: string, cert: "Certscan" | "NonCertscan" = "NonCertscan"): PreparedPopulationRow {
  return { ...makePopulationRow(id, port), stage, certScanStatus: cert };
}

function rows(prefix: string, count: number, stage: string, port: string): PreparedPopulationRow[] {
  return Array.from({ length: count }, (_, i) => row(`${prefix}-${String(i).padStart(4, "0")}`, stage, port));
}

function alloc(username: string, stageKey: EmployeeStageAllocation["stageKey"], value: number, method: EmployeeStageAllocation["method"] = "percentage"): EmployeeStageAllocation {
  return { username, stageKey, method, value, isActive: true };
}

/** Everything deterministic about a result (event ids / timestamps excluded). */
function fullProjection(result: BulkAssignmentResult) {
  return {
    events: result.events.map((e) => [e.xrayImageId, e.assignedTo, e.notes ?? null, e.dailyQuota ?? null]),
    errors: result.errors,
    skipped: result.skipped,
    unmapped: result.unmapped,
  };
}

/** Per-employee, per-port totals — for large fixtures. */
function totalsProjection(result: BulkAssignmentResult, source: PreparedPopulationRow[]) {
  const portById = new Map(source.map((r) => [r.xrayImageId, r.portName ?? ""]));
  const totals: Record<string, Record<string, number>> = {};
  for (const e of result.events) {
    const port = portById.get(e.xrayImageId) ?? "";
    totals[e.assignedTo] ??= {};
    totals[e.assignedTo]![port] = (totals[e.assignedTo]![port] ?? 0) + 1;
  }
  return { totals, errors: result.errors, skipped: result.skipped, eventCount: result.events.length };
}

const EMPLOYEES = ["a", "b", "c", "d"].map((name) => user(name, name === "a"));

describe("calculateBulkAssignment snapshots", () => {
  it("[no-restriction] two stages with CertScan rows", () => {
    const source = [
      row("c1", "FIRST_STAGE", "P1", "Certscan"),
      row("c2", "FIRST_STAGE", "P1", "Certscan"),
      ...rows("f", 8, "FIRST_STAGE", "P1"),
      ...rows("s", 9, "SECOND_STAGE", "P2"),
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("a", "first", 50), alloc("b", "first", 50), alloc("b", "second", 40), alloc("c", "second", 60)],
      employees: EMPLOYEES,
      operatorUsername: "op",
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[no-restriction] re-run skips owned rows", () => {
    const source = rows("r", 6, "SECOND_STAGE", "P1");
    const owned: DistributionEntry[] = ["r-0000", "r-0001"].map((id) => ({
      xrayImageId: id,
      assignedTo: "b",
      status: "pending",
      replacedById: null,
      lastEventAt: "",
      row: row(id, "SECOND_STAGE", "P1"),
    }));
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("b", "second", 50), alloc("c", "second", 50)],
      employees: EMPLOYEES,
      operatorUsername: "op",
      existingEntries: owned,
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[no-restriction] exact-count allocations", () => {
    const source = rows("x", 7, "THIRD_STAGE", "P1");
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("b", "third", 5, "exact"), alloc("c", "third", 2, "exact")],
      employees: EMPLOYEES,
      operatorUsername: "op",
    });
    expect(fullProjection(result)).toMatchSnapshot();
  });

  it("[port-restricted] four ports, one employee restricted", () => {
    const source = [
      ...rows("huge", 400, "SECOND_STAGE", "port-huge"),
      ...rows("big", 300, "SECOND_STAGE", "port-big"),
      ...rows("medium", 200, "SECOND_STAGE", "port-medium"),
      ...rows("small", 100, "SECOND_STAGE", "port-small"),
    ];
    const portRestrictions: EmployeePortRestriction[] = [
      { username: "d", restricted: true, enabledPorts: ["port-big", "port-medium", "port-small"] },
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].map((u) => alloc(u, "second", 25)),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });

  it("[port-restricted] trapped employee", () => {
    const source = [...rows("big", 900, "SECOND_STAGE", "port-big"), ...rows("small", 100, "SECOND_STAGE", "port-small")];
    const portRestrictions: EmployeePortRestriction[] = [
      { username: "b", restricted: true, enabledPorts: ["port-big"] },
      { username: "c", restricted: true, enabledPorts: ["port-big"] },
      { username: "d", restricted: true, enabledPorts: ["port-small"] },
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].map((u) => alloc(u, "second", 25)),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });

  it("[port-restricted] cross-stage shortfall", () => {
    const source = [
      ...rows("s1a", 360, "FIRST_STAGE", "port-A"),
      ...rows("s1b", 40, "FIRST_STAGE", "port-B"),
      ...rows("s2b", 400, "SECOND_STAGE", "port-B"),
    ];
    const portRestrictions: EmployeePortRestriction[] = [{ username: "d", restricted: true, enabledPorts: ["port-B"] }];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: ["a", "b", "c", "d"].flatMap((u) => [alloc(u, "first", 25), alloc(u, "second", 25)]),
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });
});
