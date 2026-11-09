import { describe, expect, it } from "vitest";
import { buildPortWorkloads, pooledMean } from "./portWorkloadModel";
import { employeeMinStudied } from "./portReportModel";

const month = (m: string, l1: Record<string, number>, l2: Record<string, number>) => {
  const images = Math.max(...Object.values(l1), 0) + 1000;
  return { port: "ميناء أ", type: "منفذ بحري", month: m, images, suspicion: 0, coded: images, days: ["d1"], l1, l2 };
};

describe("portWorkloadModel", () => {
  it("pools the employees far below the month's average into equivalent employees", () => {
    const p = pooledMean([100, 100, 2]);
    expect(p.mean).toBe(100);
    expect(p.equivalent).toBeCloseTo(2.02);
  });

  it("measures cases per employee as examinations over equivalent employees for the whole period", () => {
    // Two months whose level-1 and level-2 staff differ: a mean of monthly means would let the
    // overall figure fall below both levels; the ratio of sums keeps it consistent.
    const [p] = buildPortWorkloads([
      month("2025-01", { a: 100, b: 100 }, { c: 300 }),
      month("2025-02", { a: 50, b: 50, d: 50, e: 50 }, { c: 100, f: 100 }),
    ]);
    expect(p.l1PerMonth).toBeCloseTo(400 / 6);
    expect(p.l2PerMonth).toBeCloseTo(500 / 3);
    expect(p.perEmployeeMonth).toBeCloseTo(900 / 9);
    expect(p.perEmployeeMonth as number).toBeGreaterThanOrEqual(Math.min(p.l1PerMonth as number, p.l2PerMonth as number));
  });

  it("rates employees whose studied images reach 10% of the average employee's", () => {
    expect(employeeMinStudied([{ studied: 900 }, { studied: 100 }, { studied: 5 }])).toBe(34);
    expect(employeeMinStudied([])).toBe(1);
  });
});
