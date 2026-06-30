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
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null }
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

    // CSS theme tokens present
    expect(html).toContain("@page{size:A4 portrait;margin:0;}");
    expect(html).toContain("--navy:#062846");
    expect(html).toContain("--gold:#f4b400");
    // Cover page
    expect(html).toContain("التقرير التنفيذي لضمان جودة الأشعة");
    // Level definitions (glossary page)
    expect(html).toContain("المستوى الأول");
    expect(html).toContain("المستوى الثاني");
    expect(html).toContain("المستوى الثالث");
    expect(html).toContain("المستوى الرابع");
    // Part 2 divider title
    expect(html).toContain("نتائج الفحص");
    // Accuracy page content
    expect(html).toContain("نتائج الدقة حسب المنفذ");
    expect(html).toContain("دقة الاشتباه الكلية");
    // Population page
    expect(html).toContain("إجمالي المجتمع");
    // Sample page
    expect(html).toContain("العينة حسب المستويات");
    // No English debug strings
    expect(html).not.toContain("Xray IDs");
    expect(html).not.toContain("Inspection Workspace");
    expect(html).not.toContain("Page 1");
  });
});
