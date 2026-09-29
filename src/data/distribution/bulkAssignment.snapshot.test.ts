import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeePortRestriction } from "../population/populationConfig";
import type { ManagedLoginUser } from "../../auth/userManagement";
import type { DistributionEntry } from "./distributionTypes";
import { calculateBulkAssignment, type BulkAssignmentResult } from "./bulkAssignment";
import { makeUser, row, rows, alloc } from "./bulkAssignmentTestFixtures";

// Titles carry a "[no-restriction]" or "[port-restricted]" tag so a later task
// can update ONLY the restricted snapshots with `-t "port-restricted" -u`.

/** Local shorthand over the shared `makeUser` — this file only ever needs "employee". */
function user(username: string, licensed = false): ManagedLoginUser {
  return makeUser(username, "employee", licensed);
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

/**
 * Per-employee, per-stage-and-port totals — for large fixtures. Keyed by
 * "STAGE/port" (not port alone) so a cross-stage make-up shows up in the
 * diff as a change to the specific stage/port group the row moved out of and
 * the one it moved into, not just a same-port count shift.
 */
function totalsProjection(result: BulkAssignmentResult, source: PreparedPopulationRow[]) {
  const groupById = new Map(source.map((r) => [r.xrayImageId, `${r.stage}/${r.portName ?? ""}`]));
  const totals: Record<string, Record<string, number>> = {};
  for (const e of result.events) {
    const group = groupById.get(e.xrayImageId) ?? "";
    totals[e.assignedTo] ??= {};
    totals[e.assignedTo]![group] = (totals[e.assignedTo]![group] ?? 0) + 1;
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

  it("[no-restriction] CertScan Case B pushes the licensed employee over their month target", () => {
    // FIRST_STAGE: 80 CertScan + 20 NonCertscan rows split 50/50 between "a"
    // (licensed) and "b" (unlicensed). CertScan Case B (certRows > licensed
    // quota, bulkAssignment.ts ~170-173) gives ALL 80 cert rows to "a" alone,
    // leaving "b" to take the 20 normal rows — "a" ends up well over their
    // 50-row share of the stage and "b" well under it, by design (not a
    // bug). SECOND_STAGE gives both an even, unrelated 20/20 split so the
    // fixture genuinely spans two stages. With no restriction active, A3's
    // rebalance must never run: this snapshot has to stay byte-identical
    // after that change lands, proving the over/under split here is left as
    // CertScan Case B produces it.
    const source = [
      ...Array.from({ length: 80 }, (_, i) => row(`cert-${String(i).padStart(4, "0")}`, "FIRST_STAGE", "P1", "Certscan")),
      ...rows("norm", 20, "FIRST_STAGE", "P1"),
      ...rows("s2", 40, "SECOND_STAGE", "P2"),
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("a", "first", 50), alloc("b", "first", 50), alloc("a", "second", 50), alloc("b", "second", 50)],
      employees: EMPLOYEES,
      operatorUsername: "op",
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
  });

  it("[no-restriction] CertScan Case B, all entries restricted:false", () => {
    // Same shape as the fixture above, but with a portRestrictions array
    // present where every entry is restricted:false. hasAnyPortRestriction
    // must still read this as "no restriction active" — the restricted
    // branch (and A3's rebalance) never runs, so this must match the
    // unrestricted fixture above group-for-group.
    const source = [
      ...Array.from({ length: 80 }, (_, i) => row(`cert-${String(i).padStart(4, "0")}`, "FIRST_STAGE", "P1", "Certscan")),
      ...rows("norm", 20, "FIRST_STAGE", "P1"),
      ...rows("s2", 40, "SECOND_STAGE", "P2"),
    ];
    const portRestrictions: EmployeePortRestriction[] = [
      { username: "d", restricted: false, enabledPorts: [] },
    ];
    const result = calculateBulkAssignment({
      rows: source,
      allocations: [alloc("a", "first", 50), alloc("b", "first", 50), alloc("a", "second", 50), alloc("b", "second", 50)],
      employees: EMPLOYEES,
      operatorUsername: "op",
      portRestrictions,
    });
    expect(totalsProjection(result, source)).toMatchSnapshot();
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
