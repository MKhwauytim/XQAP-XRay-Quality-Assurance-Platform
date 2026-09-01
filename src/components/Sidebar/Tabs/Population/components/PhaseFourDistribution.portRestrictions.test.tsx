/* @vitest-environment jsdom */
// Coverage for the port-restriction feature wired into Phase 4's screen:
// clicking an expert's name in the matrix opens PortRestrictionsModal, a
// badge next to the name reflects the saved restriction, and the manual
// assign dropdown only offers experts eligible for that row's port.
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    {
      id: "u2",
      username: "employee.two",
      displayName: "الموظف الثاني",
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

function makeRow(xrayImageId: string, portName: string): PreparedPopulationRow {
  return {
    stage: "FIRST",
    xrayImageId,
    xrayEntryDate: null,
    portCode: null,
    portType: "بحري",
    portName,
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

function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: 2,
    totalActual: 2,
    certScanRequested: 0,
    nonCertScanRequested: 2,
    certScanActual: 0,
    nonCertScanActual: 2,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-07-22T00:00:00.000Z",
    drawnBy: "admin",
    rows: [makeRow("XR-1", "ميناء جدة"), makeRow("XR-2", "ميناء الدمام")],
  };
}

type Props = ComponentProps<typeof PhaseFourDistribution>;

function baseProps(overrides: Partial<Props> = {}): Props {
  const config: PopulationConfig = overrides.config ?? DEFAULT_POPULATION_CONFIG;
  return {
    sampleDrawResult: makeSample(),
    distributionCurrent: null,
    distributionMessage: null,
    isDistributing: false,
    distributionProgress: null,
    canConfigure: true,
    canDistribute: true,
    canBulkAssign: true,
    config,
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

describe("PhaseFourDistribution — port restrictions", () => {
  it("clicking an expert's name opens the port restrictions modal", () => {
    render(<PhaseFourDistribution {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /الموظف الأول/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/الموظف الأول/)).toBeInTheDocument();
  });

  it("shows a restriction badge reflecting config.employeePortRestrictions", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      employeePortRestrictions: [
        { username: "employee.one", restricted: true, enabledPorts: ["ميناء جدة"] },
      ],
    };
    render(<PhaseFourDistribution {...baseProps({ config })} />);
    expect(screen.getByText(/1 من 2 منفذ/)).toBeInTheDocument();
  });

  it("saving the modal calls onConfigChange with the updated port restriction", () => {
    const onConfigChange = vi.fn();
    render(<PhaseFourDistribution {...baseProps({ onConfigChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /الموظف الأول/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "ميناء الدمام" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ القيود" }));

    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        employeePortRestrictions: [
          expect.objectContaining({ username: "employee.one", restricted: true, enabledPorts: ["ميناء جدة"] }),
        ],
      })
    );
  });

  it("the manual assign dropdown excludes an expert restricted away from that row's port", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      employeePortRestrictions: [
        { username: "employee.one", restricted: true, enabledPorts: ["ميناء جدة"] },
      ],
    };
    render(<PhaseFourDistribution {...baseProps({ config })} />);
    fireEvent.click(screen.getByRole("button", { name: "المراجعة اليدوية" }));

    const rows = screen.getAllByRole("row").filter((r) => r.className.includes("distribution-row"));
    const damRow = rows.find((r) => within(r).queryByText("ميناء الدمام"));
    expect(damRow).toBeTruthy();
    const select = within(damRow as HTMLElement).getByRole("combobox");
    expect(within(select).queryByText("الموظف الأول")).not.toBeInTheDocument();
    expect(within(select).getByText("الموظف الثاني")).toBeInTheDocument();

    const jedRow = rows.find((r) => within(r).queryByText("ميناء جدة"));
    const jedSelect = within(jedRow as HTMLElement).getByRole("combobox");
    expect(within(jedSelect).getByText("الموظف الأول")).toBeInTheDocument();
  });
});
