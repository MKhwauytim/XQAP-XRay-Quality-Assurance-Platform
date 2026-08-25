// src/data/reporting/executive/deck3/deck3.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV3 } from "./index";

// Same fixture pattern as deck2.test.ts (Task 9's exploration confirmed this
// shape) — a minimal but complete PreparedPopulationRow, overridden per test row.
function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني", xrayImageId: "XR-1", xrayEntryDate: null,
    portCode: "P1", portType: "منفذ بري", portName: "منفذ الاختبار",
    declarationNumber: null, declarationDate: null, plateOrContainerNumber: null, chassisNumber: null,
    xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: "بري",
    reportNumber: null, targetedByRiskEngine: null, riskMessage: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanStatus: "NonCertscan", certScanSnippet: null, originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided", biMatched: false, biFilledFields: [],
    sourceSheetName: "Sheet1", sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildExecutiveDeckV3", () => {
  it("renders exactly 21 slides in the handoff's fixed order", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const slideCount = (html.match(/class="slide v3/g) ?? []).length;
    expect(slideCount).toBe(21);
  });

  it("uses locked terminology verbatim", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain("نتائج الوسائل الآلية");
    expect(html).toContain("نسبة تحديد موقع الاشتباه");
    expect(html).toContain("دقة السليمة");
  });

  it("wires real population counts, not the handoff's placeholder 148326/7563", async () => {
    const html = await buildExecutiveDeckV3(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("148,326");
    expect(html).not.toContain("148326");
  });

  it("embeds the Somar font-face and handoff color tokens", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    expect(html).toContain('font-family:"Somar"');
    expect(html).toContain("#10304f");
  });

  it("footer page indicators are sequential 1..21", async () => {
    const html = await buildExecutiveDeckV3(input([popRow()]));
    for (let n = 1; n <= 21; n++) {
      expect(html).toContain(`>${n} / 21<`);
    }
  });
});
