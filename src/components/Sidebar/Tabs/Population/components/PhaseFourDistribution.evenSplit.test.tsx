/* @vitest-environment jsdom */
// Owner requirement (2026-08-19): "when distributing sample by default for all
// levels make it equal — 4 employees for example, 25% per employee". The single
// employee in the sibling suite's mock cannot tell an even split from a blanket
// 100, so this file carries the real rosters: four employees (25/25/25/25) and
// three (34/33/33, Hamilton, summing to exactly 100 rather than leaving 1% dark).
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const ROSTER = vi.hoisted(() => ({ count: 4 }));

vi.mock("../../../../../auth/userManagement", () => ({
  getManagedLoginUsers: () =>
    Array.from({ length: ROSTER.count }, (_u, i) => ({
      id: `u${i + 1}`,
      username: `employee.${i + 1}`,
      displayName: `الموظف ${i + 1}`,
      role: "employee",
      passwordHash: {},
      isActive: true,
      hasCertScanLicense: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
  subscribeToUserManagementChanges: () => () => {},
}));

import PhaseFourDistribution from "./PhaseFourDistribution";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import type { PopulationConfig } from "../../../../../data/population/populationConfig";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";

function props(config: PopulationConfig) {
  return {
    sampleDrawResult: { rows: [], drawnAt: "2026-08-01T00:00:00.000Z" } as unknown as SampleMasterData,
    distributionCurrent: null, distributionMessage: null, isDistributing: false,
    distributionProgress: null, canConfigure: true, canDistribute: true, canBulkAssign: true,
    config, operatorUsername: "admin", saveMonth: 7, saveYear: 2026,
    onConfigChange: vi.fn(), onAssign: vi.fn(async () => {}), onReassign: vi.fn(async () => {}),
    onMarkComplete: vi.fn(async () => {}), onRequestReplacement: vi.fn(async () => {}),
    onApplyBulkAssignment: vi.fn(async () => {}),
  } as unknown as React.ComponentProps<typeof PhaseFourDistribution>;
}

function sharesFor(level: string, n: number) {
  return Array.from({ length: n }, (_u, i) =>
    (screen.getByLabelText(`حصة الموظف ${i + 1} في المستوى ${level}`) as HTMLInputElement).value
  );
}

afterEach(cleanup);

describe("PhaseFourDistribution — even-split default across employees", () => {
  it("four employees default to 25% each, at every level", () => {
    ROSTER.count = 4;
    const { container } = render(<PhaseFourDistribution {...props(DEFAULT_POPULATION_CONFIG)} />);
    for (const level of ["الأول", "الثاني", "الثالث", "الرابع"]) {
      expect(sharesFor(level, 4)).toEqual(["25", "25", "25", "25"]);
    }
    // Every level totals exactly 100, so none is flagged.
    const shares = Array.from(container.querySelectorAll(".p4-total-share"));
    expect(shares).toHaveLength(4);
    expect(shares.every((el) => el.className.includes("ok"))).toBe(true);
    // Nobody starts excluded.
    expect(container.querySelector(".p4-matrix-row.excluded")).toBeNull();
  });

  it("three employees split 34/33/33 so the level still totals exactly 100", () => {
    ROSTER.count = 3;
    render(<PhaseFourDistribution {...props(DEFAULT_POPULATION_CONFIG)} />);
    const first = sharesFor("الأول", 3).map(Number);
    expect(first.reduce((a, b) => a + b, 0)).toBe(100);
    expect(first.sort((a, b) => b - a)).toEqual([34, 33, 33]);
  });

  it("does NOT override a level an admin has already configured", () => {
    ROSTER.count = 4;
    // Admin gave employee.1 a 70% share of level one and left the rest unset:
    // the unset three stay at 0 rather than having 25s invented under the 70,
    // which would silently push the level to 145%.
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      employeeAllocations: [
        { username: "employee.1", stageKey: "first", method: "percentage", value: 70, isActive: true },
      ],
    };
    render(<PhaseFourDistribution {...props(config)} />);
    expect(sharesFor("الأول", 4)).toEqual(["70", "0", "0", "0"]);
    // Untouched levels keep the even default.
    expect(sharesFor("الثاني", 4)).toEqual(["25", "25", "25", "25"]);
  });
});
