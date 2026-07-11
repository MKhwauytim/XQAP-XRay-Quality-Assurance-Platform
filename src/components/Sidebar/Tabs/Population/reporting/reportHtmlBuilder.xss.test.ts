// D2 (Batch 3) — XSS regression tests for the Population processing report builder
// (`buildPopulationReportHtml`, which escapes via its local `escapeHtml`). Injects the
// shared payload corpus through every user-controlled field (title, status message, port
// names / xray-ids / differing-field lists in the BI↔Risk comparison, sheet names, BI-fill
// field names) and asserts nothing renders as live markup.
//
// This tests the pure HTML builder directly. It does NOT exercise the Excel import worker
// (src/workers/workbookWorker.ts) — that boundary is covered by the D1 parse/mapping tests.

import { describe, expect, it } from "vitest";

import { buildPopulationReportHtml } from "./reportHtmlBuilder";
import type {
  PopulationReportData,
  WorkbookReceiptReport,
} from "./reportTypes";
import {
  XSS_COMBINED,
  XSS_MARKER,
  XSS_PAYLOADS,
  findLiveInjection,
} from "../../../../../data/reporting/xssPayloads";

function maliciousReceipt(): WorkbookReceiptReport {
  return {
    title: XSS_PAYLOADS.attrBreak,
    provided: true,
    totalOriginalRows: 10,
    totalNormalizedRows: 9,
    totalExcludedRows: 1,
    sheetCount: 1,
    unknownSheetNames: [XSS_PAYLOADS.svgOnload],
    sheets: [
      {
        sheetName: XSS_PAYLOADS.scriptTag,
        originalRowCount: 10,
        normalizedRowCount: 9,
        excludedMissingXrayIdCount: 1,
      },
    ],
  };
}

function maliciousReportData(): PopulationReportData {
  return {
    title: XSS_COMBINED,
    scope: "phase-4",
    generatedDate: "2026-07-11",
    generatedTime: "12:00",
    generatedMonth: XSS_PAYLOADS.imgOnerror,
    phaseLabel: XSS_PAYLOADS.attrBreak,
    status: "ready-for-next-phase",
    statusLabel: XSS_PAYLOADS.attrBreak,
    statusMessage: XSS_PAYLOADS.scriptTag,
    riskReceipt: maliciousReceipt(),
    biReceipt: maliciousReceipt(),
    riskStageDistribution: [
      {
        sheetName: XSS_PAYLOADS.imgOnerror,
        first: 1,
        second: 2,
        third: 0,
        fourth: 0,
        unknown: 0,
        totalAccepted: 3,
      },
    ],
    riskStageDistributionTotals: {
      sheetName: "المجموع",
      first: 1,
      second: 2,
      third: 0,
      fourth: 0,
      unknown: 0,
      totalAccepted: 3,
    },
    processing: {
      riskOriginalRows: 10,
      validRiskIdRows: 10,
      invalidRiskIdRows: 0,
      duplicateRiskIdRows: 1,
      rowsAfterDeduplication: 9,
      removedInvalidResultRows: 0,
      finalPreparedPopulationRows: 9,
      certScanRows: 0,
      nonCertScanRows: 9,
      certScanPercentage: 0,
      nonCertScanPercentage: 100,
      biProvided: true,
      biMatchedRows: 8,
      biUnmatchedRows: 1,
      biMatchPercentage: 88.8,
      totalBiFilledFields: 5,
      reconciliationExpectedFinalRows: 9,
      reconciliationDifference: 0,
    },
    biFillSummary: [
      {
        fieldName: XSS_PAYLOADS.svgOnload,
        riskEmptyBefore: 5,
        filledFromBi: 3,
        stillEmptyAfter: 2,
        fillPercentage: 60,
      },
    ],
    biRiskComparison: {
      totalMatchedRecords: 8,
      matchedWithoutDifferences: 6,
      matchedWithDifferences: 2,
      overallMatchPercentage: 75,
      fieldComparisons: [
        {
          fieldName: XSS_PAYLOADS.attrBreak,
          matchedCount: 6,
          differentCount: 2,
          totalComparedCount: 8,
          matchPercentage: 75,
        },
      ],
      sampleDifferentRows: [
        {
          xrayImageId: XSS_PAYLOADS.svgOnload,
          portName: XSS_PAYLOADS.imgOnerror,
          differentFields: [XSS_PAYLOADS.structureBreak, XSS_PAYLOADS.scriptTag],
        },
      ],
    },
    hasRiskData: true,
    hasBiData: true,
    hasProcessingData: true,
  };
}

describe("buildPopulationReportHtml — XSS escaping", () => {
  it("never renders injected markup as live HTML", () => {
    const html = buildPopulationReportHtml(maliciousReportData());
    expect(findLiveInjection(html)).toBeNull();
  });

  it("renders the injected fields, escaped (marker + escaped <script> present)", () => {
    const html = buildPopulationReportHtml(maliciousReportData());
    // The payloads reached the output (fields were rendered, not silently dropped)…
    expect(html).toContain(XSS_MARKER);
    // …but the <script> payload survives only in escaped form.
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("does not break out of attributes via quote-breaking payloads", () => {
    const html = buildPopulationReportHtml(maliciousReportData());
    // The attr-break payload's leading quote must be entity-encoded, never a live handler.
    expect(html).not.toContain('"><b onmouseover');
    expect(html).toContain("&quot;");
  });
});
