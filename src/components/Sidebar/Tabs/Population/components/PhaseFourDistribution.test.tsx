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
import type {
  DistributionCurrentData,
  DistributionStatus,
} from "../../../../../data/distribution/distributionTypes";

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

  it("an unconfigured level defaults to an EVEN split, so nobody starts excluded", () => {
    // Owner requirement (2026-08-19): distribution defaults to an equal share
    // per employee at every level — four employees get 25% each. This mock
    // roster holds one employee, so the sole even share is 100. Before that
    // rule every unsaved share defaulted to 0, the row rendered مستبعدة, and
    // the level distributed nothing until an admin typed each share by hand.
    const { container } = render(<MatrixHarness initialConfig={DEFAULT_POPULATION_CONFIG} />);

    expect(container.querySelector(".p4-matrix-row.excluded")).toBeNull();
    expect(screen.queryByText("مستبعدة")).not.toBeInTheDocument();
    expect(
      (screen.getByLabelText("حصة الموظف الأول في المستوى الأول") as HTMLInputElement).value
    ).toBe("100");
    // The single sample row is level one, so the default share already yields
    // exactly one new assignment with no configuration at all.
    expect(container.querySelector(".p4-matrix-new")?.textContent).toBe("1");
  });

  it("editing a matrix cell recomputes the الجديد preview and the totals row", () => {
    const { container } = render(<MatrixHarness initialConfig={DEFAULT_POPULATION_CONFIG} />);

    // Zero every level — مستبعدة means no share ANYWHERE, not just here, so an
    // admin has to knock out all four to exclude an employee outright.
    const cell = screen.getByLabelText("حصة الموظف الأول في المستوى الأول") as HTMLInputElement;
    for (const level of ["الأول", "الثاني", "الثالث", "الرابع"]) {
      fireEvent.change(screen.getByLabelText(`حصة الموظف الأول في المستوى ${level}`), {
        target: { value: "0" },
      });
    }

    expect(container.querySelector(".p4-matrix-row.excluded")).not.toBeNull();
    // The مستبعدة tag REPLACES the الجديد count cell, so the count is absent
    // rather than zero while the employee is excluded.
    expect(screen.getByText("مستبعدة")).toBeInTheDocument();
    expect(container.querySelector(".p4-matrix-new")).toBeNull();

    // ...and back up to a full share on level one.
    fireEvent.change(cell, { target: { value: "100" } });
    expect((screen.getByLabelText("حصة الموظف الأول في المستوى الأول") as HTMLInputElement).value).toBe("100");
    expect(container.querySelector(".p4-matrix-row.excluded")).toBeNull();
    expect(container.querySelector(".p4-matrix-new")?.textContent).toBe("1");

    const totals = container.querySelector(".p4-matrix-totals");
    expect(totals?.querySelector("strong")?.textContent).toBe("1");
  });

  it("the totals row flags a per-stage share that does not add up to 100", () => {
    const { container } = render(<MatrixHarness initialConfig={DEFAULT_POPULATION_CONFIG} />);
    const shares = () => Array.from(container.querySelectorAll(".p4-total-share"));

    // Every stage now starts on the even-split default, so all four total 100
    // and none is flagged — the warn verdict is reserved for a level an admin
    // has actually knocked off 100.
    expect(shares()).toHaveLength(4);
    expect(shares().every((el) => el.className.includes("ok"))).toBe(true);
    expect(shares()[0].textContent).toBe("100");

    // Knock level one down to 40 — only that level is flagged.
    fireEvent.change(screen.getByLabelText("حصة الموظف الأول في المستوى الأول"), {
      target: { value: "40" },
    });

    expect(shares()[0].className).toContain("warn");
    expect(shares()[0].textContent).toBe("40");
    expect(shares()[1].className).toContain("ok");
  });

  it("matrix inputs are DISABLED (not hidden) when the role cannot configure", () => {
    render(<PhaseFourDistribution {...baseProps({ canConfigure: false })} />);
    const cell = screen.getByLabelText("حصة الموظف الأول في المستوى الأول");
    expect(cell).toBeInTheDocument();
    expect(cell).toBeDisabled();
  });
});

// ── Fix (distribution, 2026-08-20) ──────────────────────────────────────────
// Owner report: after a month was fully distributed, the حصص الخبراء matrix
// showed 0 عادية / 0 CertScan / 0 الجديد for EVERY expert while the حالة التوزيع
// card above read 100٪. Cause: all three columns were fed from the bulk-assign
// PREVIEW, which is empty by design once every row is already owned. عادية and
// CertScan are plain count columns and must include what is already assigned.
describe("PhaseFourDistribution — matrix counts after the month is distributed", () => {
  function currentWith(
    entries: Array<{ xrayImageId: string; assignedTo: string; status: DistributionStatus }>
  ): DistributionCurrentData {
    return {
      monthFolderName: "7-July-2026",
      derivedAt: "2026-07-22T00:00:00.000Z",
      totalAssigned: entries.length,
      totalCompleted: 0,
      totalReplaced: 0,
      totalPending: entries.length,
      entries: entries.map((e) => ({
        ...e,
        replacedById: null,
        lastEventAt: "2026-07-22T00:00:00.000Z",
        // PreparedPopulationRow is a superset of the persisted stub.
        row: makeRow(e.xrayImageId),
      })),
    };
  }

  /** [عادية, CertScan] for the first (and only) expert row. */
  function rowCounts(container: HTMLElement): string[] {
    const row = container.querySelectorAll(".p4-matrix-row")[1];
    return Array.from(row.querySelectorAll("span.num")).map((el) => el.textContent ?? "");
  }

  it("an already-assigned row still counts under عادية, while الجديد correctly reads 0", () => {
    const { container } = render(
      <PhaseFourDistribution
        {...baseProps({
          distributionCurrent: currentWith([
            { xrayImageId: "XR-1", assignedTo: "employee.one", status: "pending" },
          ]),
        })}
      />
    );

    expect(rowCounts(container)).toEqual(["1", "0"]);
    // الجديد is preview-only and SHOULD be zero — there is nothing left to distribute.
    expect(container.querySelector(".p4-matrix-new")?.textContent).toBe("0");

    const totals = container.querySelector(".p4-matrix-totals") as HTMLElement;
    expect(Array.from(totals.querySelectorAll("span.num:not(.p4-total-share)")).map((el) => el.textContent))
      .toEqual(["1", "0"]);
    expect(totals.querySelector("strong.num")?.textContent).toBe("0");
  });

  it("a replaced row is not billed to the expert who handed it back", () => {
    const { container } = render(
      <PhaseFourDistribution
        {...baseProps({
          distributionCurrent: currentWith([
            { xrayImageId: "XR-1", assignedTo: "employee.one", status: "replaced" },
          ]),
        })}
      />
    );

    // Nothing owned (the row moved on) and nothing previewed either — the row
    // still carries an entry, so calculateBulkAssignment skips it.
    expect(rowCounts(container)).toEqual(["0", "0"]);
  });

  it("undistributed month is unchanged: the preview alone drives all three columns", () => {
    const { container } = render(<PhaseFourDistribution {...baseProps({ distributionCurrent: null })} />);
    expect(rowCounts(container)).toEqual(["1", "0"]);
    expect(container.querySelector(".p4-matrix-new")?.textContent).toBe("1");
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
