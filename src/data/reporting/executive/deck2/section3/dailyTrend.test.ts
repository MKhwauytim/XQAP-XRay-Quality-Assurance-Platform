import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../population/populationTypes";
import { buildReportModel } from "../../model/reportModel";
import { DAILY_TREND_CSS, dailyTrendSlide } from "./dailyTrend";

// Copied verbatim from entryDay.test.ts Step 8 (per the brief — do not import
// fixtures across test files).
function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: "2026-05-14",
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function modelWith(rows: PreparedPopulationRow[]) {
  const input: ExecutiveReportInput = {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
  return buildReportModel(input);
}

describe("dailyTrendSlide", () => {
  it("renders the slide shell with its own id and section", () => {
    const html = dailyTrendSlide(modelWith([popRow()]), 5, 20, false);
    expect(html).toContain('id="slide-s3-daily-trend"');
    expect(html).toContain('data-section="section3"');
  });

  it("states the dated share and the غير مؤرخ count as a headline, not a footnote", () => {
    const html = dailyTrendSlide(
      modelWith([
        popRow({ xrayImageId: "A", xrayEntryDate: "2026-05-01" }),
        popRow({ xrayImageId: "B", xrayEntryDate: "غير معروف" }),
      ]),
      5,
      20,
      false,
    );
    expect(html).toContain("غير مؤرخ");
    expect(html).toContain("v2-dt-share");
  });

  it("renders an honest empty state when no decision carries a date", () => {
    const html = dailyTrendSlide(
      modelWith([popRow({ xrayEntryDate: "غير معروف" })]),
      5,
      20,
      false,
    );
    expect(html).toContain("v2-dt-empty");
  });

  it("exposes four variant panels in preview mode and one in production", () => {
    const model = modelWith([popRow()]);
    expect((dailyTrendSlide(model, 5, 20, true).match(/v2-variant-panel/g) ?? [])).toHaveLength(4);
    expect(dailyTrendSlide(model, 5, 20, false)).not.toContain("v2-variant-panel");
  });

  it("is deterministic", () => {
    const model = modelWith([popRow()]);
    expect(dailyTrendSlide(model, 5, 20, false)).toBe(dailyTrendSlide(model, 5, 20, false));
  });

  it("ships CSS scoped to its own class prefix", () => {
    expect(DAILY_TREND_CSS).toContain(".v2-dt-");
  });
});
