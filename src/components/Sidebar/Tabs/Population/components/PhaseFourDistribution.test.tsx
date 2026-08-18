/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for the bulk-assignment
// wrong-flag gate. Shipped supervisor defaults grant bulk-assign=true but
// distribute-samples=false — before this fix, the "تطبيق وحفظ التوزيع التلقائي" button
// was wired to canDistribute (the per-row permission), so a supervisor who explicitly has
// bulk-assign permission still saw the bulk button disabled. canBulkAssign must gate the
// bulk button independently of canDistribute, while per-row manual actions stay on
// canDistribute.

import { useState, type ComponentProps } from "react";
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
  // Audit finding 6: the live-roster fix subscribes to roster-change events;
  // this component-level test never mutates the roster, so a no-op unsubscribe
  // is all it needs.
  subscribeToUserManagementChanges: () => () => {},
}));

function makeRow(xrayImageId: string): PreparedPopulationRow {
  return {
    stage: "FIRST",
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

function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: "2026-07-22T00:00:00.000Z",
    drawnBy: "admin",
    rows: [makeRow("XR-1")],
  };
}

type Props = ComponentProps<typeof PhaseFourDistribution>;

function baseProps(overrides: Partial<Props> = {}): Props {
  const config: PopulationConfig = DEFAULT_POPULATION_CONFIG;
  return {
    sampleDrawResult: makeSample(),
    distributionCurrent: null,
    distributionMessage: null,
    isDistributing: false,
    distributionProgress: null,
    canConfigure: true,
    canDistribute: false,
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

describe("PhaseFourDistribution — bulk-assignment permission gate (B13 task 1)", () => {
  it("happy: bulk button stays enabled under supervisor defaults (bulk-assign=true, distribute-samples=false)", () => {
    render(<PhaseFourDistribution {...baseProps({ canBulkAssign: true, canDistribute: false })} />);
    const bulkButton = screen.getByRole("button", { name: "تطبيق وحفظ التوزيع" });
    expect(bulkButton).not.toBeDisabled();
    expect(bulkButton.getAttribute("title")).toBeNull();
  });

  it("failure: bulk button is disabled and carries a denial title when canBulkAssign is false, even if canDistribute is true", () => {
    render(<PhaseFourDistribution {...baseProps({ canBulkAssign: false, canDistribute: true })} />);
    const bulkButton = screen.getByRole("button", { name: "تطبيق وحفظ التوزيع" });
    expect(bulkButton).toBeDisabled();
    expect(bulkButton.getAttribute("title")).toBe(
      "لا تملك صلاحية التوزيع الجماعي، أو أن مساحة العمل للقراءة فقط."
    );
  });

  it("per-row manual actions keep using canDistribute independently of canBulkAssign", () => {
    const { container } = render(
      <PhaseFourDistribution {...baseProps({ canBulkAssign: true, canDistribute: false })} />
    );
    fireEvent.click(screen.getByRole("button", { name: "المراجعة اليدوية" }));
    const employeeSelect = container.querySelector(".dist-employee-select");
    expect(employeeSelect).not.toBeNull();
    expect((employeeSelect as HTMLSelectElement).disabled).toBe(true);
  });

  it("per-row manual actions are enabled when canDistribute is true even if canBulkAssign is false", () => {
    const { container } = render(
      <PhaseFourDistribution {...baseProps({ canBulkAssign: false, canDistribute: true })} />
    );
    fireEvent.click(screen.getByRole("button", { name: "المراجعة اليدوية" }));
    const employeeSelect = container.querySelector(".dist-employee-select");
    expect(employeeSelect).not.toBeNull();
    expect((employeeSelect as HTMLSelectElement).disabled).toBe(false);
  });
});

// ── 2026-08 redesign (design handoff panel `5c`) ────────────────────────────
// The per-stage tabs + the separate preview table collapsed into ONE
// employees × stages matrix, and المراجعة اليدوية became an in-place section
// that starts collapsed.
describe("PhaseFourDistribution — حصص الخبراء matrix (5c)", () => {
  function MatrixHarness({ initialConfig }: { initialConfig: PopulationConfig }) {
    const [config, setConfig] = useState(initialConfig);
    return <PhaseFourDistribution {...baseProps({ config, onConfigChange: setConfig })} />;
  }

  it("editing a matrix cell recomputes the الجديد preview and the totals row", () => {
    const { container } = render(<MatrixHarness initialConfig={DEFAULT_POPULATION_CONFIG} />);

    // No share anywhere yet — the expert row is muted and reads مستبعدة.
    expect(container.querySelector(".p4-matrix-row.excluded")).not.toBeNull();
    expect(screen.getByText("مستبعدة")).toBeInTheDocument();

    const cell = screen.getByLabelText("حصة الموظف الأول في المستوى الأول") as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "100" } });

    // The single sample row is level one, so a 100 share yields exactly one new assignment.
    expect((screen.getByLabelText("حصة الموظف الأول في المستوى الأول") as HTMLInputElement).value).toBe("100");
    expect(container.querySelector(".p4-matrix-row.excluded")).toBeNull();
    expect(container.querySelector(".p4-matrix-new")?.textContent).toBe("1");

    const totals = container.querySelector(".p4-matrix-totals");
    expect(totals?.querySelector("strong")?.textContent).toBe("1");
  });

  it("the totals row flags a per-stage share that does not add up to 100", () => {
    const { container } = render(<MatrixHarness initialConfig={DEFAULT_POPULATION_CONFIG} />);
    const shares = () => Array.from(container.querySelectorAll(".p4-total-share"));

    // Every stage starts at 0 — all four flagged.
    expect(shares()).toHaveLength(4);
    expect(shares().every((el) => el.className.includes("warn"))).toBe(true);

    fireEvent.change(screen.getByLabelText("حصة الموظف الأول في المستوى الأول"), {
      target: { value: "100" },
    });

    expect(shares()[0].className).toContain("ok");
    expect(shares()[0].textContent).toBe("100");
    expect(shares()[1].className).toContain("warn");
  });

  it("matrix inputs are DISABLED (not hidden) when the role cannot configure", () => {
    render(<PhaseFourDistribution {...baseProps({ canConfigure: false })} />);
    const cell = screen.getByLabelText("حصة الموظف الأول في المستوى الأول");
    expect(cell).toBeInTheDocument();
    expect(cell).toBeDisabled();
  });
});

describe("PhaseFourDistribution — المراجعة اليدوية in-place section (5c)", () => {
  it("starts collapsed: no manual rows or filters are rendered until it is opened", () => {
    const { container } = render(<PhaseFourDistribution {...baseProps()} />);
    expect(container.querySelector("#p4-manual-section")).toBeNull();
    expect(screen.queryByLabelText("بحث بمعرف الأشعة")).not.toBeInTheDocument();
    expect(container.querySelector(".dist-employee-select")).toBeNull();

    const toggle = screen.getByRole("button", { name: "المراجعة اليدوية" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(container.querySelector("#p4-manual-section")).not.toBeNull();
    expect(screen.getByLabelText("بحث بمعرف الأشعة")).toBeInTheDocument();
  });

  it("an unassigned row offers only the expert select + تعيين", () => {
    render(<PhaseFourDistribution {...baseProps({ canDistribute: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "المراجعة اليدوية" }));

    expect(screen.getByRole("button", { name: "تعيين" })).toBeInTheDocument();
    for (const forbidden of ["إعادة تعيين", "مكتمل", "استبدال", "اعتماد الاستبدال", "رفض"]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });
});
