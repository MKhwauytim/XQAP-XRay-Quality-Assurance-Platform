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

// PhaseThreeSampling reads usePermissions() locally only for "unlock-sampling-stage" (the
// admin unlock toggle, out of this bucket's scope) — grant it so the lock-toggle button
// doesn't alert() during unrelated assertions.
vi.mock("../../../../../auth/usePermissions", () => ({
  usePermissions: () => ({ canMutate: () => true }),
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
    sampleNeedsApproval: false,
    isApprovingSample: false,
    canDrawSample: true,
    canConfigureSample: true,
    processingMessage: "",
    onApproveSample: vi.fn(),
    onConfigChange: vi.fn(),
    onSampleSeedChange: vi.fn(),
    onDrawSample: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

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
    // The sibling "القيمة المطلوبة" field is lock-only (out of this bucket's scope) and
    // stays enabled here — demonstrating the fix is scoped to the CertScan fields only.
    const siblingValue = screen.getByLabelText("القيمة المطلوبة") as HTMLInputElement;
    expect(siblingValue).not.toBeDisabled();
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
