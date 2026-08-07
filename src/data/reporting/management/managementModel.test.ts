// Data-correctness tests for the management report model (R3 restructure).

import { describe, expect, it } from "vitest";

import { computeManagementModel } from "./managementModel";
import { makeRow, makeDistribution } from "../reportTestFixtures";
import type { DistributionEvent } from "../../distribution/distributionTypes";

function data() {
  return makeDistribution([
    { id: "IMG-1", assignedTo: "u1", status: "completed", row: makeRow("IMG-1", "منفذ أ", { stage: "المستوى الأول" }) },
    { id: "IMG-2", assignedTo: "u1", status: "pending", row: makeRow("IMG-2", "منفذ أ", { stage: "المستوى الأول" }) },
    { id: "IMG-3", assignedTo: "u2", status: "replacement-requested", row: makeRow("IMG-3", "منفذ ب", { stage: "المستوى الثاني" }) },
    { id: "IMG-4", assignedTo: "u2", status: "replaced", row: makeRow("IMG-4", "منفذ ب", { stage: "المستوى الثاني" }), replacedById: "IMG-9" },
  ], {
    totalAssigned: 4, totalCompleted: 1, totalPending: 1, totalReplaced: 1,
  });
}

describe("computeManagementModel", () => {
  it("computes headline totals", () => {
    const m = computeManagementModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(m.totals).toEqual({
      assigned: 4, completed: 1, pending: 1, replaced: 1, requested: 1, completionRate: 25,
    });
  });

  it("groups per-stage/level progress (section 1), excluding replaced images", () => {
    const m = computeManagementModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(m.byStage.map((b) => b.key).sort()).toEqual(["المستوى الأول", "المستوى الثاني"]);
    const lvl1 = m.byStage.find((b) => b.key === "المستوى الأول")!;
    expect(lvl1.employees).toEqual([
      { username: "u1", displayName: "أحمد", assigned: 2, completed: 1, completionRate: 50 },
    ]);
    const lvl2 = m.byStage.find((b) => b.key === "المستوى الثاني")!;
    // IMG-4 (replaced) is excluded — only IMG-3 (replacement-requested) counts.
    expect(lvl2.totalAssigned).toBe(1);
    expect(lvl2.employees[0]!.username).toBe("u2");
  });

  it("groups per-port progress (section 2), excluding replaced images", () => {
    const m = computeManagementModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    const portA = m.byPort.find((b) => b.key === "منفذ أ")!;
    expect(portA.totalAssigned).toBe(2);
    expect(portA.completionRate).toBe(50);
    const portB = m.byPort.find((b) => b.key === "منفذ ب")!;
    expect(portB.totalAssigned).toBe(1); // only the replacement-requested one
  });

  it("surfaces replacement records with reasons resolved from the replacement/referral store", () => {
    const m = computeManagementModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" }, [], {
      "IMG-4": "جودة صورة رديئة",
    });
    expect(m.replacements.total).toBe(1);
    expect(m.replacements.records[0]).toMatchObject({
      xrayImageId: "IMG-4", displayName: "سارة", portName: "منفذ ب",
      reason: "جودة صورة رديئة", replacedById: "IMG-9",
    });
    expect(m.replacements.byReason).toEqual([{ reason: "جودة صورة رديئة", count: 1 }]);
  });

  it("reports a replacement with no matched reason as null, not a crash", () => {
    const m = computeManagementModel(data(), "6-June-2026", {}, [], {});
    expect(m.replacements.records[0]!.reason).toBeNull();
    expect(m.replacements.byReason).toEqual([]);
  });

  it("counts reassignment events from the raw event history, defaulting to zero when omitted", () => {
    const withoutEvents = computeManagementModel(data(), "6-June-2026");
    expect(withoutEvents.reassignments.total).toBe(0);

    const events: DistributionEvent[] = [
      { eventId: "e1", eventType: "reassigned", xrayImageId: "IMG-1", assignedTo: "u2", reassignedTo: "u1", eventAt: "2026-07-01T00:00:00.000Z", eventBy: "admin" },
      { eventId: "e2", eventType: "reassigned", xrayImageId: "IMG-2", assignedTo: "u2", reassignedTo: "u1", eventAt: "2026-07-02T00:00:00.000Z", eventBy: "admin" },
      { eventId: "e3", eventType: "assigned", xrayImageId: "IMG-3", assignedTo: "u2", eventAt: "2026-07-01T00:00:00.000Z", eventBy: "admin" },
    ];
    const withEvents = computeManagementModel(data(), "6-June-2026", {}, events);
    expect(withEvents.reassignments.total).toBe(2);
  });

  it("returns empty buckets/replacements when nothing is assigned", () => {
    const m = computeManagementModel(makeDistribution([], { totalAssigned: 0 }), "6-June-2026");
    expect(m.byStage).toEqual([]);
    expect(m.byPort).toEqual([]);
    expect(m.replacements).toEqual({ total: 0, records: [], byReason: [] });
    expect(m.totals.completionRate).toBeNull();
  });
});
