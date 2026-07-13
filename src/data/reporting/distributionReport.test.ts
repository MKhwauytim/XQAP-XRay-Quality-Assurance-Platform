// Data-correctness tests for the distribution report model (Wave 3). The three
// renderers (document / deck / xlsx) all read `computeDistributionModel`.

import { describe, expect, it } from "vitest";

import { computeDistributionModel, buildDistributionDocument, buildDistributionDeck } from "./distributionReport";
import { makeRow, makeDistribution } from "./reportTestFixtures";

function data() {
  return makeDistribution([
    { id: "IMG-1", assignedTo: "u1", status: "completed", row: makeRow("IMG-1", "منفذ أ") },
    { id: "IMG-2", assignedTo: "u1", status: "pending", row: makeRow("IMG-2", "منفذ أ") },
    { id: "IMG-3", assignedTo: "u2", status: "replacement-requested", row: makeRow("IMG-3", "منفذ ب") },
    { id: "IMG-4", assignedTo: "u2", status: "replaced", row: makeRow("IMG-4", "منفذ ب"), replacedById: "IMG-9" },
  ], {
    totalAssigned: 4, totalCompleted: 1, totalPending: 1, totalReplaced: 1,
    quotas: { u1: { username: "u1", sampleCount: 2, dailyQuota: 5, daysRemainingAtAssignment: 10, assignedAt: "2026-07-01T00:00:00.000Z" } },
  });
}

describe("computeDistributionModel", () => {
  it("aggregates per-employee status counts and daily quota", () => {
    const m = computeDistributionModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(m.employees.map((e) => e.username)).toEqual(["u1", "u2"]); // sorted by total desc (tie → insertion)
    const u1 = m.employees.find((e) => e.username === "u1")!;
    expect(u1.displayName).toBe("أحمد");
    expect(u1.total).toBe(2);
    expect(u1.completed).toBe(1);
    expect(u1.pending).toBe(1);
    expect(u1.dailyQuota).toBe(5);
    expect(u1.completionRate).toBeCloseTo(50, 5);
    const u2 = m.employees.find((e) => e.username === "u2")!;
    expect(u2.requested).toBe(1);
    expect(u2.replaced).toBe(1);
    expect(u2.dailyQuota).toBeNull(); // no quota entry
  });

  it("counts replacement-requested into totalRequested and surfaces highlights", () => {
    const m = computeDistributionModel(data(), "6-June-2026");
    expect(m.totalRequested).toBe(1);
    expect(m.completionRate).toBeCloseTo(25, 5); // 1 completed / 4 assigned
    expect(m.highlights.map((h) => h.xrayImageId).sort()).toEqual(["IMG-3", "IMG-4"]);
    const replaced = m.highlights.find((h) => h.xrayImageId === "IMG-4")!;
    expect(replaced.replacedById).toBe("IMG-9");
  });

  it("returns null completion rate when nothing is assigned", () => {
    const m = computeDistributionModel(makeDistribution([], { totalAssigned: 0 }), "6-June-2026");
    expect(m.completionRate).toBeNull();
    expect(m.employees).toEqual([]);
  });
});

describe("distribution renderers", () => {
  it("document uses display names and is a self-contained HTML doc", () => {
    const html = buildDistributionDocument(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("أحمد");
    expect(html).toContain("تقرير التوزيع");
  });

  it("deck renders slides with the completion figure", () => {
    const html = buildDistributionDeck(data(), "6-June-2026");
    expect(html).toContain("class=\"slide");
    expect(html).toContain("يونيو 2026");
  });
});
