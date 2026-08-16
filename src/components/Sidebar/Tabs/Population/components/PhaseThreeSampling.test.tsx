/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for
//  - task 2: CertScan quota fields (method select + value input) must respect both the
//    stage lock state AND the configure-sample permission, matching the sibling
//    "طريقة السحب" / "القيمة المطلوبة" fields' lock-only gating plus the missing permission
//    check; a rejected edit must be visible via the (newly threaded) processingMessage slot
//    instead of silently reverting.
//  - task 3: the "سحب العينات وحفظها" (draw sample) button must be render-time disabled by
//    canDrawSample (permission + closed-month + month-loading, already combined in index.tsx),
//    matching Phase 4's canDistribute pattern.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseThreeSampling from "./PhaseThreeSampling";
import type { PopulationConfig, StageSamplingRule } from "../../../../../data/population/populationConfig";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import type { PreparedPopulationRow } from "../../../../../data/population/populationTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";

// PhaseThreeSampling reads usePermissions() locally for "unlock-sampling-stage" (the admin
// unlock toggle). Mutable so the lock-toggle describe block below can flip canUnlock per
// test; defaults to granted so pre-existing tests (which never touch the toggle) keep their
// original assumptions.
const permissionsMock = vi.hoisted(() => ({ state: { canUnlock: true } }));
vi.mock("../../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ canMutate: (featureId: string) => featureId !== "unlock-sampling-stage" || permissionsMock.state.canUnlock }),
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

function makeRule(overrides: Partial<StageSamplingRule> = {}): StageSamplingRule {
  return {
    stageKey: "second",
    method: "percentage",
    value: 10,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 5,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
    ...overrides,
  };
}

function configWithRule(rule: StageSamplingRule): PopulationConfig {
  return { ...DEFAULT_POPULATION_CONFIG, samplingRules: [rule] };
}

type Props = ComponentProps<typeof PhaseThreeSampling>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    populationRows: [makeRow("XR-1", "SECOND")],
    sampleSeed: "seed",
    isDrawingSample: false,
    sampleDrawResult: null,
    sampleSaveMessage: null,
    config: configWithRule(makeRule()),
    userRole: "supervisor",
    currentUsername: "sup1",
    priorMonthAdvisory: null,
    canDrawSample: true,
    canConfigureSample: true,
    processingMessage: "",
    onConfigChange: vi.fn(),
    onDrawSample: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  permissionsMock.state.canUnlock = true;
});

describe("PhaseThreeSampling — CertScan quota fields lock+permission (B13 task 2)", () => {
  it("happy: unlocked stage with configure-sample permission leaves the CertScan fields editable", () => {
    render(<PhaseThreeSampling {...baseProps({ config: configWithRule(makeRule({ isLocked: false })), canConfigureSample: true })} />);
    const certScanSelect = screen.getByLabelText("نوع كوتا CertScan") as HTMLSelectElement;
    expect(certScanSelect).not.toBeDisabled();
    const certScanValue = screen.getByLabelText("القيمة") as HTMLInputElement;
    expect(certScanValue).not.toBeDisabled();
  });

  it("failure: unlocked stage WITHOUT configure-sample permission disables the CertScan fields (previously ignored permission entirely)", () => {
    render(<PhaseThreeSampling {...baseProps({ config: configWithRule(makeRule({ isLocked: false })), canConfigureSample: false })} />);
    const certScanValue = screen.getByLabelText("القيمة") as HTMLInputElement;
    expect(certScanValue).toBeDisabled();
    // Cluster A fix: the sibling "القيمة المطلوبة" / "طريقة السحب" fields previously
    // ignored canConfigureSample entirely (lock-only gating) even though this component's
    // own doc comment already promised "gates the stage-rule and CertScan-quota fields" --
    // a role with view-but-not-edit population access saw them rendered enabled while
    // handleConfigChange (index.tsx) silently rejected the edit. Now gated the same as the
    // CertScan fields.
    const siblingValue = screen.getByLabelText("القيمة المطلوبة") as HTMLInputElement;
    expect(siblingValue).toBeDisabled();
    const siblingMethod = screen.getByLabelText("طريقة السحب") as HTMLSelectElement;
    expect(siblingMethod).toBeDisabled();
  });

  it("failure: a locked stage disables the CertScan fields regardless of permission (matches sibling fields' lock gating)", () => {
    render(<PhaseThreeSampling {...baseProps({ config: configWithRule(makeRule({ isLocked: true })), canConfigureSample: true })} />);
    const certScanValue = screen.getByLabelText("القيمة") as HTMLInputElement;
    expect(certScanValue).toBeDisabled();
  });

  it("a rejected config edit becomes visible via processingMessage instead of silently reverting", () => {
    render(<PhaseThreeSampling {...baseProps({ processingMessage: "" })} />);
    expect(screen.queryByText("لا تملك صلاحية تعديل إعدادات المعالجة أو العينة.")).not.toBeInTheDocument();

    cleanup();
    render(<PhaseThreeSampling {...baseProps({ processingMessage: "لا تملك صلاحية تعديل إعدادات المعالجة أو العينة." })} />);
    const messageEl = screen.getByText("لا تملك صلاحية تعديل إعدادات المعالجة أو العينة.");
    expect(messageEl).toBeInTheDocument();
    expect(messageEl.getAttribute("role")).toBe("status");
  });
});

// Cluster A (filed twice: as a permission finding "renders enabled" and as a UX finding
// "uses alert()") -- the lock-toggle button previously always rendered enabled regardless
// of canUnlock and only rejected via a blocking native alert() on click.
describe("PhaseThreeSampling — lock-toggle render-time permission gate, no alert() (cluster A)", () => {
  it("renders the lock-toggle disabled when the role cannot unlock sampling stages", async () => {
    const { fireEvent } = await import("@testing-library/react");
    permissionsMock.state.canUnlock = false;
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<PhaseThreeSampling {...baseProps({ config: configWithRule(makeRule({ isLocked: true })) })} />);

    const lockButton = screen.getByRole("button", { name: /مغلق/ });
    expect(lockButton).toBeDisabled();
    expect(lockButton).toHaveAttribute("title", "لا تملك صلاحية إلغاء قفل مراحل العينة.");

    fireEvent.click(lockButton);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("renders the lock-toggle enabled and toggleable when the role can unlock sampling stages", () => {
    permissionsMock.state.canUnlock = true;
    render(<PhaseThreeSampling {...baseProps({ config: configWithRule(makeRule({ isLocked: true })) })} />);

    const lockButton = screen.getByRole("button", { name: /مغلق/ });
    expect(lockButton).not.toBeDisabled();
  });
});

describe("PhaseThreeSampling — draw-sample button render-time permission gate (B13 task 3)", () => {
  it("happy: draw button is enabled when canDrawSample is true and population rows exist", () => {
    render(<PhaseThreeSampling {...baseProps({ canDrawSample: true })} />);
    const drawButton = screen.getByRole("button", { name: "سحب العينات وحفظها" });
    expect(drawButton).not.toBeDisabled();
    expect(drawButton.getAttribute("title")).toBeNull();
  });

  it("failure: draw button is disabled with a denial title when canDrawSample is false (no permission, closed month, or month still loading)", () => {
    render(<PhaseThreeSampling {...baseProps({ canDrawSample: false })} />);
    const drawButton = screen.getByRole("button", { name: "سحب العينات وحفظها" });
    expect(drawButton).toBeDisabled();
    expect(drawButton.getAttribute("title")).toBe(
      "لا تملك صلاحية سحب العينة، أو أن الشهر مغلق، أو أن بيانات الشهر قيد التحميل."
    );
  });
});

describe("PhaseThreeSampling — running total shown before the draw (B task 1)", () => {
  function makeRows(stageText: string, count: number, prefix: string): PreparedPopulationRow[] {
    return Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, stageText));
  }

  it("sums the EFFECTIVE (post-floor) targets across stages, not the raw entered values", () => {
    // Second stage: entered value (10, exact) is below its floor (50) — the
    // effective/drawn count is 50, not 10. Third stage: no floor, effective = entered (20).
    const secondRule = makeRule({
      stageKey: "second",
      method: "exact",
      value: 10,
      minRequiredCount: 50,
    });
    const thirdRule = makeRule({
      stageKey: "third",
      method: "exact",
      value: 20,
      minRequiredCount: 0,
    });
    const rows = [
      ...makeRows("SECOND", 100, "S"),
      ...makeRows("THIRD", 100, "T"),
    ];
    render(
      <PhaseThreeSampling
        {...baseProps({
          populationRows: rows,
          config: { ...DEFAULT_POPULATION_CONFIG, samplingRules: [secondRule, thirdRule] },
        })}
      />
    );

    // Running total = 50 (floored second stage) + 20 (third stage) = 70, not 10 + 20 = 30.
    expect(screen.getByText((_, node) => node?.textContent === "إجمالي العينة المتوقع (كل المستويات): 70")).toBeInTheDocument();
  });

  it("shows an explicit override warning naming the stage, entered value, and effective value", () => {
    const secondRule = makeRule({
      stageKey: "second",
      method: "exact",
      value: 10,
      minRequiredCount: 50,
    });
    const rows = makeRows("SECOND", 100, "S");
    render(
      <PhaseThreeSampling
        {...baseProps({
          populationRows: rows,
          config: { ...DEFAULT_POPULATION_CONFIG, samplingRules: [secondRule] },
        })}
      />
    );

    const alerts = screen.getAllByRole("alert");
    const overrideAlert = alerts.find((el) => el.textContent?.includes("المستوى الثاني"));
    expect(overrideAlert).toBeDefined();
    expect(overrideAlert?.textContent).toContain("10");
    expect(overrideAlert?.textContent).toContain("50");
  });

  it("does not show an override warning when no stage's minRequiredCount overrides its entered value", () => {
    const secondRule = makeRule({
      stageKey: "second",
      method: "exact",
      value: 60,
      minRequiredCount: 50,
      // All rows in this fixture are NonCertscan (see makeRow) — a nonzero
      // certScanPercentage here would correctly trigger the (unrelated)
      // CertScan-shortfall pre-draw warning and defeat this test's "no alert
      // at all" assertion below. Zero it out to isolate the floor-override
      // behaviour this test actually targets.
      certScanPercentage: 0,
    });
    const rows = makeRows("SECOND", 100, "S");
    render(
      <PhaseThreeSampling
        {...baseProps({
          populationRows: rows,
          config: { ...DEFAULT_POPULATION_CONFIG, samplingRules: [secondRule] },
        })}
      />
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "إجمالي العينة المتوقع (كل المستويات): 60")).toBeInTheDocument();
  });
});

describe("PhaseThreeSampling — unmapped-stage exclusion warning (P4)", () => {
  function baseResult(overrides: Partial<SampleMasterData> = {}): SampleMasterData {
    return {
      rngSeed: "seed",
      samplingAlgorithmVersion: "1.1",
      totalRequested: 5,
      totalActual: 5,
      certScanRequested: 0,
      nonCertScanRequested: 5,
      certScanActual: 0,
      nonCertScanActual: 5,
      portAllocations: [],
      stageAllocations: [],
      certScanShortfalls: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "tester",
      rows: [],
      ...overrides,
    };
  }

  it("shows the warning with the exclusion count and sample raw values when rows were excluded", () => {
    render(
      <PhaseThreeSampling
        {...baseProps({
          sampleDrawResult: baseResult({
            unmappedStageRowCount: 3,
            unmappedStageRawValues: ["SOME_BAD_VALUE", "ANOTHER_BAD_VALUE"],
          }),
        })}
      />
    );
    const alerts = screen.getAllByRole("alert");
    const warning = alerts.find((el) => el.textContent?.includes("تم استبعاد"));
    expect(warning).toBeDefined();
    expect(warning?.textContent).toContain("3");
    expect(warning?.textContent).toContain("SOME_BAD_VALUE");
    expect(warning?.textContent).toContain("ANOTHER_BAD_VALUE");
  });

  it("shows nothing when unmappedStageRowCount is 0", () => {
    render(<PhaseThreeSampling {...baseProps({ sampleDrawResult: baseResult({ unmappedStageRowCount: 0 }) })} />);
    expect(screen.queryByText((_, node) => node?.textContent?.includes("تم استبعاد") ?? false)).not.toBeInTheDocument();
  });

  it("shows nothing when unmappedStageRowCount is absent (legacy draw / legacy sample master)", () => {
    render(<PhaseThreeSampling {...baseProps({ sampleDrawResult: baseResult() })} />);
    expect(screen.queryByText((_, node) => node?.textContent?.includes("تم استبعاد") ?? false)).not.toBeInTheDocument();
  });
});
