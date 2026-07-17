import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BiWorkbookResult, NormalizedBiRow } from "../biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { ExportColumnSetting } from "../../../../../data/population/populationConfig";
import type { PopulationProcessingResult, PreparedPopulationRow } from "./populationProcessingTypes";

const xlsx = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: Record<string, unknown>[]) => ({ rows })),
  appendSheet: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("xlsx", () => ({
  utils: {
    book_new: () => ({}),
    json_to_sheet: xlsx.jsonToSheet,
    book_append_sheet: xlsx.appendSheet
  },
  writeFile: xlsx.writeFile
}));

import { exportPopulationProcessingResult } from "./populationExporter";

const preparedRow = {
  stage: "FIRST_STAGE",
  xrayImageId: "XR-1",
  xrayEntryDate: "2026-01-01",
  portCode: "P1",
  portType: "بري",
  portName: "المنفذ",
  declarationNumber: "D1",
  declarationDate: "2026-01-02",
  plateOrContainerNumber: "PLATE",
  chassisNumber: "CHASSIS",
  xrayLevelOneResult: "سليمة",
  xrayLevelTwoResult: "اشتباه",
  movementType: "وارد",
  reportNumber: "R1",
  targetedByRiskEngine: "نعم",
  riskMessage: "رسالة",
  certScanStatus: "Certscan",
  certScanSnippet: "snippet",
  originalCertScanSnippet: "original",
  levelOneEmployee: "one",
  levelTwoEmployee: "two",
  otherResults: {
    manual: { result: "سليمة", code: "M", employeeId: null },
    opposite: { result: "اشتباه", code: "O", employeeId: "opposite" },
    liveMeans: { result: null, code: null, employeeId: "live" }
  },
  notes: "ملاحظة",
  biEnrichmentStatus: "BI Matched",
  biMatched: true,
  biFilledFields: ["portCode", "notes"],
  rawRow: { "حقل إضافي": "قيمة", disabledRaw: "يبقى" },
  sourceSheetName: "Risk",
  sourceRowNumber: 7
} satisfies PreparedPopulationRow;

const riskRow = {
  ...preparedRow,
  movementNumber: null,
  movementDate: null,
  movementHijriDate: null,
  declarationHijriDate: null,
  manifestNumber: null,
  manifestType: null,
  finalDestination: null,
  entryDate: null,
  exitDate: null,
  hasReport: false,
  inspectorResult: null,
  oppositeInspectorResult: null,
  liveMeansResult: null
} as unknown as NormalizedRiskRow;

const biRow = {
  source: "BI",
  xrayImageId: "XR-1",
  xrayEntryDate: "2026-01-01",
  portType: "بري",
  portCode: "P1",
  portName: "المنفذ",
  declarationNumber: "D1",
  declarationDate: "2026-01-02",
  plateOrContainerNumber: "PLATE",
  chassisNumber: "CHASSIS",
  levelOneResult: "سليمة",
  levelTwoResult: "اشتباه",
  sourceSheetName: "BI",
  sourceRowNumber: 3
} as NormalizedBiRow;

function processingResult(): PopulationProcessingResult {
  return {
    preparedRows: [preparedRow],
    removedRows: [],
    duplicateRows: [],
    invalidResultRows: [],
    summary: {
      riskOriginalRows: 1,
      validRiskIdRows: 1,
      invalidRiskIdRows: 0,
      duplicateRiskIdRows: 0,
      rowsAfterDeduplication: 1,
      removedInvalidResultRows: 0,
      finalPreparedPopulationRows: 1,
      certScanRows: 1,
      nonCertScanRows: 0,
      certScanPercentage: 100,
      nonCertScanPercentage: 0,
      biProvided: true,
      biMatchedRows: 1,
      biUnmatchedRows: 0,
      biMatchPercentage: 100,
      totalBiFilledFields: 2,
      biFieldFillSummary: []
    }
  };
}

function riskWorkbook(): RiskWorkbookResult {
  return {
    rows: [riskRow],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: 1,
    totalNormalizedRows: 1,
    totalExcludedMissingXrayIdCount: 0
  };
}

function biWorkbook(): BiWorkbookResult {
  return {
    rows: [biRow],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: 1,
    totalNormalizedRows: 1,
    totalExcludedMissingXrayIdCount: 0
  };
}

describe("population exporter characterization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves sheet order, default prepared columns, and comparison values", () => {
    exportPopulationProcessingResult(processingResult(), riskWorkbook(), biWorkbook());

    expect(xlsx.appendSheet.mock.calls.map((call) => call[2])).toEqual([
      "Risk Raw Data", "BI Raw Data", "Prepared Population", "Duplicates",
      "Not Used - Other Issues", "Risk BI Comparison", "Processing Summary", "BI Fill Summary"
    ]);
    const prepared = xlsx.jsonToSheet.mock.calls[2]![0][0]!;
    expect(Object.keys(prepared).slice(0, 8)).toEqual([
      "Source Row Number", "Source Sheet", "المستوى", "معرف الأشعة",
      "تاريخ دخول الأشعة", "رمز المنفذ", "نوع المنفذ", "اسم المنفذ"
    ]);
    expect(prepared).toMatchObject({
      "نتيجة المعاين": "سليمة",
      "موظف التفتيش المعاكس": "opposite",
      "BI Matched": "Yes",
      "BI Filled Fields": "portCode | notes",
      "حقل إضافي": "قيمة"
    });
    expect(xlsx.jsonToSheet.mock.calls[5]![0][0]).toMatchObject({
      "Comparison Status": "Matched",
      "Risk Row Count": 1,
      "BI Row Count": 1,
      "Risk معرف الأشعة": "XR-1",
      "BI معرف الأشعة": "XR-1"
    });
  });

  it("preserves configured order and appends only unconfigured raw fields", () => {
    const columns: ExportColumnSetting[] = [
      { fieldKey: "xrayImageId", exportHeader: "ID", isEnabled: true, order: 2 },
      { fieldKey: "portName", exportHeader: "PORT", isEnabled: true, order: 1 },
      { fieldKey: "disabledRaw", exportHeader: "DISABLED", isEnabled: false, order: 3 }
    ];
    exportPopulationProcessingResult(processingResult(), riskWorkbook(), null, columns);
    const prepared = xlsx.jsonToSheet.mock.calls[2]![0][0]!;
    expect(Object.keys(prepared)).toEqual(["PORT", "ID", "حقل إضافي"]);
    expect(prepared).toEqual({ PORT: "المنفذ", ID: "XR-1", "حقل إضافي": "قيمة" });
  });
});
