/* @vitest-environment jsdom */
// W8: coverage for the dropped-rows drill-down that replaced the removed
// "تقرير المعالجة" button (PhaseTwoReportAndProcessing.tsx) — the per-row detail
// for rows excluded during processing must stay reachable from the Phase 2 UI
// itself, not only via the (still-present) full Excel export.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PopulationProcessingReport from "./PopulationProcessingReport";
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
