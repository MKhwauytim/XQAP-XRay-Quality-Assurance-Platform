import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import { buildExecutiveReport } from "./executiveReport";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";

function row(
  xrayImageId: string,
  overrides: Partial<PreparedPopulationRow> = {}
): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId,
    xrayEntryDate: null,
    portCode: null,
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
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
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

describe("executive report html", () => {
  it("uses Arabic report labels and PowerPoint slide sizing", () => {
    const html = buildExecutiveReport({
      monthFolderName: "6-June-2026",
      populationRows: [
        row("XR-1", { portType: "منفذ بري", portName: "جديدة عرعر" }),
        row("XR-2", {
          portType: "منفذ بحري",
          portName: "ميناء جدة الإسلامي",
          xrayLevelOneResult: "اشتباه",
          xrayLevelTwoResult: "اشتباه",
        }),
      ],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });

    expect(html).toContain("@page{size:A4 portrait;margin:0;}");
    expect(html).toContain("إجمالي الصور");
    expect(html).toContain("مستويات الدراسة");
    expect(html).toContain("المستوى الأول");
    expect(html).toContain("المستوى الثاني");
    expect(html).toContain("المستوى الثالث");
    expect(html).toContain("المستوى الرابع");
    expect(html).toContain("نتائج الفحص");
    expect(html).toContain("دقة نتائج الأشعة");
    expect(html).toContain("نسبة دقة الاشتباه");
    expect(html).not.toContain("إجمالي الصور\", \"سليمة\", \"اشتباه\", \"العينة\", \"المدروسة\", \"نسبة الدقة");
    expect(html).not.toContain("Xray IDs");
    expect(html).not.toContain("Inspection Workspace");
    expect(html).not.toContain("Page 1");
  });
});
