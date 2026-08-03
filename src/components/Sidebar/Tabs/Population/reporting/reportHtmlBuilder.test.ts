// Characterization test for buildPopulationReportHtml's font embedding (§Q bonus fix).
// buildCss() sets body{font-family:"Somar","Somar Sans","Segoe UI",Tahoma,Arial,sans-serif}
// but this file historically embedded NO @font-face rule for either family name.
// exportPopulationReport (reportExporter.ts) saves this HTML as a standalone file the
// user opens outside the app -- with no @font-face, it silently fell back past both
// named families straight to Segoe UI/Tahoma. This file did not have a golden/snapshot
// test prior to this fix (only reportHtmlBuilder.xss.test.ts, which is escaping-focused),
// so this pins the target (fixed) behavior directly per CLAUDE.md's determinism rule.

import { describe, it, expect } from "vitest";
import { buildPopulationReportHtml } from "./reportHtmlBuilder";
import type { PopulationReportData, WorkbookReceiptReport } from "./reportTypes";

function minimalReceipt(): WorkbookReceiptReport {
  return {
    title: "استلام",
    provided: false,
    totalOriginalRows: 0,
    totalNormalizedRows: 0,
    totalExcludedRows: 0,
    sheetCount: 0,
    unknownSheetNames: [],
    sheets: [],
  };
}

function minimalReportData(): PopulationReportData {
  return {
    title: "تقرير اختبار",
    scope: "phase-2",

    generatedDate: "2026-08-03",
    generatedTime: "12:00",
    generatedMonth: "أغسطس 2026",

    phaseLabel: "المرحلة الثانية",

    status: "receipt-only",
    statusLabel: "استلام فقط",
    statusMessage: "لم تتم المعالجة بعد.",

    riskReceipt: null,
    biReceipt: minimalReceipt(),

    riskStageDistribution: [],
    riskStageDistributionTotals: null,

    processing: null,
    biFillSummary: [],

    biRiskComparison: {
      totalMatchedRecords: 0,
      matchedWithoutDifferences: 0,
      matchedWithDifferences: 0,
      overallMatchPercentage: 0,
      fieldComparisons: [],
      sampleDifferentRows: [],
    },

    hasRiskData: false,
    hasBiData: false,
    hasProcessingData: false,
  };
}

describe("buildPopulationReportHtml — font embedding (§Q bonus fix)", () => {
  it("embeds a @font-face rule for the Somar font family referenced by body{font-family}", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    expect(html).toContain("@font-face");
    expect(html).toMatch(/@font-face\{font-family:"Somar"/);
  });

  it("the embedded font-face src is a real data: URI, not an empty/broken value", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    const match = html.match(/@font-face\{font-family:"Somar"[^}]*src:url\(([^)]+)\)/);
    expect(match).not.toBeNull();
    // The url() value is quoted (matches the theme.ts/EXEC_CSS convention:
    // src:url("data:font/woff;base64,...")), so tolerate an optional leading quote.
    expect(match?.[1]).toMatch(/^"?data:font\/woff/);
  });

  it("embeds all 4 weights (regular/bold/medium/light), each with a distinct weight", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    expect(html).toMatch(/@font-face\{font-family:"Somar";[^}]*font-weight:400;/);
    expect(html).toMatch(/@font-face\{font-family:"Somar";[^}]*font-weight:700;/);
    expect(html).toMatch(/@font-face\{font-family:"Somar";[^}]*font-weight:500;/);
    expect(html).toMatch(/@font-face\{font-family:"Somar";[^}]*font-weight:300;/);
  });

  it("still renders the body font-family declaration referencing the same family name", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    expect(html).toContain(
      'font-family: "Somar", "Somar Sans", "Segoe UI", Tahoma, Arial, sans-serif;'
    );
  });
});
