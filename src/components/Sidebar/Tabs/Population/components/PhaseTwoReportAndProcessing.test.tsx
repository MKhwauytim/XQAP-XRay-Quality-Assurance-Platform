/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for task 3's Phase-2 half —
// the "process" and "export" buttons had no permission-aware disabled state at all before
// this fix (only isProcessingPopulation/loadedFromDisk gated the process button; the export
// buttons had no disabled prop whatsoever). canProcess/canExport must now render-time-disable
// them, matching Phase 4's canDistribute pattern.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseTwoReportAndProcessing from "./PhaseTwoReportAndProcessing";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";

function makeRiskResult(): RiskWorkbookResult {
  return {
    rows: [],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: 0,
    totalNormalizedRows: 0,
    totalExcludedMissingXrayIdCount: 0,
  };
}

function makeProcessingResult(): PopulationProcessingResult {
  return {
    preparedRows: [],
    removedRows: [],
    duplicateRows: [],
    invalidResultRows: [],
    summary: {
      riskOriginalRows: 0,
      validRiskIdRows: 0,
      invalidRiskIdRows: 0,
      duplicateRiskIdRows: 0,
      rowsAfterDeduplication: 0,
      removedInvalidResultRows: 0,
      finalPreparedPopulationRows: 0,
      certScanRows: 0,
      nonCertScanRows: 0,
      certScanPercentage: 0,
      nonCertScanPercentage: 0,
      biProvided: false,
      biMatchedRows: 0,
      biUnmatchedRows: 0,
      biMatchPercentage: 0,
      totalBiFilledFields: 0,
      biFieldFillSummary: [],
    },
  };
}

type Props = ComponentProps<typeof PhaseTwoReportAndProcessing>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    riskWorkbookResult: makeRiskResult(),
    biWorkbookResult: null,
    processingMessage: "",
    certScanPasteText: "",
    populationProcessingResult: makeProcessingResult(),
    isProcessingPopulation: false,
    monthLabel: "يوليو 2026",
    isSavingToDisk: false,
    saveToDiskMessage: null,
    hasDiskWorkspace: true,
    orphanScan: null,
    canProcess: true,
    canExport: true,
    onProcessPopulation: vi.fn(),
    onExportPopulation: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PhaseTwoReportAndProcessing — render-time permission gate (B13 task 3)", () => {
  it("happy: process and export buttons are enabled when canProcess/canExport are true", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    const processButton = screen.getByRole("button", { name: /إعادة معالجة المجتمع/ });
    expect(processButton).not.toBeDisabled();

    const exportExcelButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportExcelButton).not.toBeDisabled();
    expect(exportExcelButton.getAttribute("title")).toBe("تصدير المجتمع النهائي Excel");
  });

  it("failure: process button is disabled with a denial title when canProcess is false", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps({ canProcess: false })} />);
    const processButton = screen.getByRole("button", { name: /إعادة معالجة المجتمع/ });
    expect(processButton).toBeDisabled();
    expect(processButton.getAttribute("title")).toBe(
      "لا تملك صلاحية معالجة المجتمع، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل."
    );
  });

  it("failure: export buttons are disabled with a denial title when canExport is false, independent of canProcess", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps({ canExport: false, canProcess: true })} />);
    const processButton = screen.getByRole("button", { name: /إعادة معالجة المجتمع/ });
    expect(processButton).not.toBeDisabled();

    const exportExcelButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportExcelButton).toBeDisabled();
    expect(exportExcelButton.getAttribute("title")).toBe("لا تملك صلاحية تصدير التقارير.");
  });

  it("W3/W8: no longer renders the CertScan grid or the removed تقرير المعالجة button in the Phase 2 flow", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "تقرير المعالجة" })).toBeNull();
    expect(screen.queryByLabelText("منطقة لصق بيانات CertScan")).toBeNull();
  });
});
