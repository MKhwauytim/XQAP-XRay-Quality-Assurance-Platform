/* @vitest-environment jsdom */
// T-14 — bulk distribution must not skip rows in silence.
//
// `calculateBulkAssignment` walks first/second/third/fourth only. A sample row
// whose stage label no longer resolves through the workspace-global stage
// mappings answers "unknown" and matches none of them, so it is never
// apportioned and never assigned. Nothing said so: the operator saw the run
// succeed and believed the month was fully distributed while those rows stayed
// unowned for the rest of the cycle. Reporting only — which rows get assigned
// is deliberately unchanged.
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PhaseFourDistribution from "./PhaseFourDistribution";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import type { PopulationConfig } from "../../../../../data/population/populationConfig";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";

vi.mock("../../../../../auth/userManagement", () => ({
  getManagedLoginUsers: () => [
    {
      id: "u1",
      username: "employee.one",
      displayName: "الموظف الأول",
      role: "employee",
      passwordHash: {},
      isActive: true,
      hasCertScanLicense: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  subscribeToUserManagementChanges: () => () => {},
}));

function makeRow(xrayImageId: string, stage: string): PreparedPopulationRow {
  return {
    stage,
    xrayImageId,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    portName: "ميناء تجريبي",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 2,
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-07-22T00:00:00.000Z",
    drawnBy: "admin",
    rows,
  };
}

const CONFIG_WITH_FIRST_STAGE_SHARE: PopulationConfig = {
  ...DEFAULT_POPULATION_CONFIG,
  employeeAllocations: [
    { username: "employee.one", stageKey: "first", method: "percentage", value: 100, isActive: true },
  ],
};

type Props = ComponentProps<typeof PhaseFourDistribution>;

function baseProps(rows: PreparedPopulationRow[], overrides: Partial<Props> = {}): Props {
  return {
    sampleDrawResult: makeSample(rows),
    distributionCurrent: null,
    distributionMessage: null,
    isDistributing: false,
    distributionProgress: null,
    canConfigure: true,
    canDistribute: true,
    canBulkAssign: true,
    config: CONFIG_WITH_FIRST_STAGE_SHARE,
    operatorUsername: "admin",
    saveMonth: 7,
    saveYear: 2026,
    onConfigChange: vi.fn(),
    onAssign: vi.fn(async () => {}),
    onReassign: vi.fn(async () => {}),
    onMarkComplete: vi.fn(async () => {}),
    onRequestReplacement: vi.fn(async () => {}),
    onApplyBulkAssignment: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PhaseFourDistribution — unmappable stage rows are reported (T-14)", () => {
  it("warns with the skipped count and the stage involved, and still assigns the mappable rows", async () => {
    const applied: Array<Array<{ xrayImageId: string }>> = [];
    const onApplyBulkAssignment = vi.fn(async (events: Array<{ xrayImageId: string }>) => {
      applied.push(events);
    });
    render(
      <PhaseFourDistribution
        {...baseProps(
          [makeRow("XR-1", "FIRST"), makeRow("XR-2", "مستوى مستحدث")],
          { onApplyBulkAssignment: onApplyBulkAssignment as unknown as Props["onApplyBulkAssignment"] }
        )}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "تطبيق وحفظ التوزيع" }));

    const alert = await screen.findByText(/لم يُوزَّع/);
    expect(alert.textContent).toContain("1");
    expect(alert.textContent).toContain("مستوى مستحدث");

    // Unchanged behaviour: the resolvable row is still assigned.
    expect(onApplyBulkAssignment).toHaveBeenCalledTimes(1);
    expect(applied[0]?.map((event) => event.xrayImageId)).toEqual(["XR-1"]);
  });

  it("shows no unmapped warning when every sample row's stage resolves", async () => {
    const onApplyBulkAssignment = vi.fn(async () => {});
    render(
      <PhaseFourDistribution
        {...baseProps([makeRow("XR-1", "FIRST"), makeRow("XR-2", "FIRST")], { onApplyBulkAssignment })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "تطبيق وحفظ التوزيع" }));

    expect(onApplyBulkAssignment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/لم يُوزَّع/)).toBeNull();
  });
});
