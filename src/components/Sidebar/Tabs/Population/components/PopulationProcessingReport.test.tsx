/* @vitest-environment jsdom */
// W8: coverage for the dropped-rows drill-down that replaced the removed
// "تقرير المعالجة" button (PhaseTwoReportAndProcessing.tsx) — the per-row detail
// for rows excluded during processing must stay reachable from the Phase 2 UI
// itself, not only via the (still-present) full Excel export.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PopulationProcessingReport, { type PopulationReportPreviewRow } from "./PopulationProcessingReport";
import type { ProcessingSummary, RemovedPopulationRow } from "../processing/populationProcessingTypes";

function makeSummary(): ProcessingSummary {
  return {
    riskOriginalRows: 10,
    validRiskIdRows: 9,
    invalidRiskIdRows: 1,
    duplicateRiskIdRows: 1,
    rowsAfterDeduplication: 8,
    removedInvalidResultRows: 1,
    finalPreparedPopulationRows: 7,
    certScanRows: 3,
    nonCertScanRows: 4,
    certScanPercentage: 43,
    nonCertScanPercentage: 57,
    biProvided: false,
    biMatchedRows: 0,
    biUnmatchedRows: 0,
    biMatchPercentage: 0,
    totalBiFilledFields: 0,
    biFieldFillSummary: [],
  };
}

function makeRemovedRow(overrides: Partial<RemovedPopulationRow> = {}): RemovedPopulationRow {
  return {
    reason: "نتيجة مستوى غير صالحة",
    xrayImageId: "XR-1",
    portName: "ميناء جدة",
    sourceSheetName: "بري",
    sourceRowNumber: 12,
    ...overrides,
  };
}

function makePreviewRows(count: number): PopulationReportPreviewRow[] {
  return Array.from({ length: count }, (_, i) => ({
    xrayImageId: `XR-${i + 1}`,
    sourceRowNumber: i + 1,
    portName: "ميناء جدة",
    stage: "first",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    certScanStatus: "Certscan",
  }));
}

afterEach(cleanup);

describe("PopulationProcessingReport — dropped-rows drill-down (W8)", () => {
  it("happy: an excluded-rows category is collapsed by default and expands to show per-row detail", () => {
    render(
      <PopulationProcessingReport
        summary={makeSummary()}
        previewRows={[]}
        invalidResultRows={[makeRemovedRow()]}
      />,
    );

    expect(screen.getByText("تفاصيل الصفوف المستبعدة")).toBeInTheDocument();
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /نتائج مستوى غير صالحة/ }));
    expect(screen.getByText("XR-1")).toBeInTheDocument();
    expect(screen.getByText("نتيجة مستوى غير صالحة")).toBeInTheDocument();
  });

  it("failure: renders no drill-down section at all when nothing was excluded", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={[]} />);
    expect(screen.queryByText("تفاصيل الصفوف المستبعدة")).not.toBeInTheDocument();
  });
});

describe("PopulationProcessingReport — final-population preview (2026-08-12)", () => {
  it("happy: shows only 10 example rows per page even when more rows are available, and pagination advances to the next 10", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(25)} />);

    expect(screen.getByText("معاينة المجتمع النهائي")).toBeInTheDocument();
    // Page 1: XR-1..XR-10 shown, XR-11 not yet.
    expect(screen.getByText("XR-1")).toBeInTheDocument();
    expect(screen.getByText("XR-10")).toBeInTheDocument();
    expect(screen.queryByText("XR-11")).not.toBeInTheDocument();
    expect(screen.getByText(/عرض 1 إلى 10 من 25/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "الصفحة التالية" }));

    // Page 2: XR-11..XR-20 shown, XR-1 and XR-21 not.
    expect(screen.getByText("XR-11")).toBeInTheDocument();
    expect(screen.getByText("XR-20")).toBeInTheDocument();
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();
    expect(screen.queryByText("XR-21")).not.toBeInTheDocument();
  });

  it("failure: renders nothing when there are no preview rows", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={[]} />);
    expect(screen.queryByText("معاينة المجتمع النهائي")).not.toBeInTheDocument();
  });

  it("does not add new statistics -- the preview summary strip reuses existing ProcessingSummary fields only", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(1)} />);
    // finalPreparedPopulationRows/certScanRows/nonCertScanRows from makeSummary(): 7/3/4.
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });
});
