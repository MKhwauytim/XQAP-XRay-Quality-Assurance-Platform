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
  it("renders the A4 executive document in Arabic with SVG icons, not emoji", () => {
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

    // A4-portrait print sizing + theme tokens present
    expect(html).toContain("size:A4 portrait");
    expect(html).toContain("--navy:#062846");
    expect(html).toContain("--gold:#f4b400");
    // Cover page
    expect(html).toContain("التقرير التنفيذي لضمان جودة الأشعة");
    // Level definitions (glossary page)
    expect(html).toContain("المستوى الأول");
    expect(html).toContain("المستوى الثاني");
    expect(html).toContain("المستوى الثالث");
    expect(html).toContain("المستوى الرابع");
    // Part 2 — inspection-quality accuracy section
    expect(html).toContain("الدقة حسب المنفذ");
    // Uses inline SVG icons, never emoji (design spec §4.2)
    expect(html).toContain("<svg");
    expect(html).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u
    );
    // No English debug strings
    expect(html).not.toContain("Xray IDs");
    expect(html).not.toContain("Inspection Workspace");
    expect(html).not.toContain("Page 1");
  });
});
