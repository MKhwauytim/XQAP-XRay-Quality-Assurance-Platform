/* @vitest-environment jsdom */
// Regression coverage for B12 task 2: the exported processing report's
// BI/risk comparison must join rows on the same (xrayImageId, portName) key
// that the rest of the app uses (makeBiMatchKey) — see populationProcessor.ts
// and DataAccuracyReport.tsx. The pre-fix `makeComparisonKey` joined on a
// bare xrayImageId, so two rows sharing an ID across different ports
// silently collapsed into a single comparison entry in the Map (whichever
// row was inserted last "won"), under-counting `totalMatchedRecords`.
//
// This test builds a fixture where the SAME xrayImageId appears attached to
// two different ports on both the risk and BI sides, and cross-checks the
// exported `totalMatchedRecords` against the live DataAccuracyReport
// component (which already used makeBiMatchKey), rendered from the exact
// same fixture — both must agree, and both must count 2 distinct matches,
// not 1.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPopulationReportData } from "./reportDataBuilder";
import DataAccuracyReport from "../components/DataAccuracyReport";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { NormalizedBiRow } from "../biData/biDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";

afterEach(() => {
  cleanup();
});

function riskRow(overrides: Partial<NormalizedRiskRow>): NormalizedRiskRow {
  return {
    movementType: "بري",
    portCode: null,
    portName: null,
    portType: null,
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: null,
    xrayLevelTwoResult: null,
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    xrayImageId: null,
    xrayEntryDate: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    stage: null,
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides
  };
}

function biRow(overrides: Partial<NormalizedBiRow>): NormalizedBiRow {
  return {
    source: "bi-workbook",
    xrayImageId: null,
    xrayEntryDate: null,
    portType: null,
    portCode: null,
    portName: null,
    declarationNumber: null,
    preliminaryDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    inboundOutboundType: null,
    declarationType: null,
    declarationStatus: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    governance: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    levelOneResultCode: null,
    levelTwoResultCode: null,
    levelOneResult: null,
    levelTwoResult: null,
    manualInspectionResultCode: null,
    manualInspectionResult: null,
    oppositeInspectionEmployee: null,
    oppositeInspectionResultCode: null,
    oppositeInspectionResult: null,
    liveMeansEmployee: null,
    liveMeansResultCode: null,
    liveMeansResult: null,
    notes: null,
    sourceSheetName: "SheetA",
    sourceRowNumber: 1,
    ...overrides
  };
}

/** Reads a KPI card's value from the rendered DataAccuracyReport, matched by its Arabic label. */
function kpiValue(container: HTMLElement, label: string): string | null {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".dar-kpi"));
  const card = cards.find((el) => el.querySelector(".dar-kpi-label")?.textContent === label);
  return card?.querySelector(".dar-kpi-value")?.textContent?.trim() ?? null;
}

describe("buildPopulationReportData — BI/risk comparison join key (B12 task 2)", () => {
  it("counts a duplicate xrayImageId across two different ports as two distinct matches, matching the live DataAccuracyReport", () => {
    // "X-100" appears twice on both sides, once per port — under the old
    // bare-ID key this pair collapsed into one Map entry per side.
    const riskRows: NormalizedRiskRow[] = [
      riskRow({ xrayImageId: "X-100", portName: "الميناء الاول", portType: "بري" }),
      riskRow({ xrayImageId: "X-100", portName: "الميناء الثاني", portType: "بحري" }),
      // Distinct ID, only on the risk side — must NOT be counted as matched.
      riskRow({ xrayImageId: "X-200", portName: "الميناء الاول", portType: "بري" })
    ];
    const biRows: NormalizedBiRow[] = [
      biRow({ xrayImageId: "X-100", portName: "الميناء الاول", portType: "بري" }),
      biRow({ xrayImageId: "X-100", portName: "الميناء الثاني", portType: "بحري" })
    ];

    const riskWorkbookResult: RiskWorkbookResult = {
      rows: riskRows,
      sheetSummaries: [],
      unknownSheetNames: [],
      totalOriginalRows: riskRows.length,
      totalNormalizedRows: riskRows.length,
      totalExcludedMissingXrayIdCount: 0
    };
    const biWorkbookResult: BiWorkbookResult = {
      rows: biRows,
      sheetSummaries: [],
      unknownSheetNames: [],
      totalOriginalRows: biRows.length,
      totalNormalizedRows: biRows.length,
      totalExcludedMissingXrayIdCount: 0
    };

    const reportData = buildPopulationReportData({
      scope: "phase-2",
      riskWorkbookResult,
      biWorkbookResult,
      populationProcessingResult: null
    });

    expect(reportData.biRiskComparison.totalMatchedRecords).toBe(2);
    expect(reportData.biRiskComparison.matchedWithoutDifferences).toBe(2);
    expect(reportData.biRiskComparison.matchedWithDifferences).toBe(0);
    expect(reportData.biRiskComparison.overallMatchPercentage).toBe(100);

    const { container } = render(<DataAccuracyReport riskRows={riskRows} biRows={biRows} />);

    expect(kpiValue(container, "معرّفات المقارنة")).toBe("2");
    expect(kpiValue(container, "فقط في المخاطر")).toBe("1"); // X-200
    expect(kpiValue(container, "سجلات بها اختلاف")).toBe("0");

    // The exported report and the live on-screen report must agree exactly.
    expect(String(reportData.biRiskComparison.totalMatchedRecords)).toBe(
      kpiValue(container, "معرّفات المقارنة")
    );
  });
});
