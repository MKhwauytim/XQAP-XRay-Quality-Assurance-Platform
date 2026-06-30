import { describe, expect, test } from "vitest";
import { processPopulation } from "./populationProcessor";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingInput } from "./populationProcessingTypes";

describe("processPopulation async processing and column preservation", () => {
  const mockRiskResult: RiskWorkbookResult = {
    rows: [
      {
        stage: "FIRST_STAGE",
        xrayImageId: "IMG12345",
        xrayEntryDate: "2026-06-16",
        portCode: "P1",
        portName: "البطحاء",
        portType: "Land Port",
        movementNumber: "M1",
        movementDate: "2026-06-16",
        movementHijriDate: "1447-12-01",
        declarationNumber: "D1",
        declarationDate: "2026-06-16",
        declarationHijriDate: "1447-12-01",
        manifestNumber: "MN1",
        manifestType: "MT1",
        plateOrContainerNumber: "PLATE123",
        finalDestination: "Riyadh",
        entryDate: "2026-06-16",
        exitDate: "2026-06-16",
        chassisNumber: "CH1",
        reportNumber: "RN1",
        hasReport: true,
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: "سليمة",
        inspectorResult: "Clear",
        oppositeInspectorResult: "Clear",
        liveMeansResult: "Clear",
        movementType: "Type A",
        targetedByRiskEngine: "No",
        riskMessage: "None",
        sourceSheetName: "بري",
        sourceRowNumber: 2,
        rawRow: {
          "معرف الأشعة": "IMG12345",
          "اسم المنفذ": "البطحاء",
          "رقم لوحة الشاحنة": "PLATE123", // Custom column to preserve!
          "اسم السائق": "احمد حسن" // Custom column to preserve!
        }
      }
    ],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: 1,
    totalNormalizedRows: 1,
    totalExcludedMissingXrayIdCount: 0
  };

  const mockBiResult: BiWorkbookResult = {
    rows: [
      {
        source: "بري وارد",
        xrayImageId: "IMG12345",
        xrayEntryDate: "2026-06-16",
        portType: "Land Port",
        portCode: "P1",
        portName: "البطحاء",
        declarationNumber: "D1",
        preliminaryDeclarationNumber: "PD1",
        declarationDate: "2026-06-16",
        declarationHijriDate: "1447-12-01",
        inboundOutboundType: "وارد",
        declarationType: "Type A",
        declarationStatus: "Done",
        plateOrContainerNumber: "PLATE123",
        chassisNumber: "CH1",
        governance: "Gov A",
        levelOneEmployee: "Emp 1",
        levelTwoEmployee: "Emp 2",
        levelOneResultCode: "C1",
        levelTwoResultCode: "C2",
        levelOneResult: "سليمة",
        levelTwoResult: "سليمة",
        manualInspectionResultCode: "M1",
        manualInspectionResult: "OK",
        oppositeInspectionEmployee: "Emp 3",
        oppositeInspectionResultCode: "C3",
        oppositeInspectionResult: "OK",
        liveMeansEmployee: "Emp 4",
        liveMeansResultCode: "C4",
        liveMeansResult: "OK",
        notes: "None",
        sourceSheetName: "بري وارد",
        sourceRowNumber: 5,
        rawRow: {
          "معرف الأشعة": "IMG12345",
          "اسم المنفذ": "البطحاء",
          "رقم لوحة الشاحنة": "PLATE123",
          "اسم السائق": "احمد حسن",
          "اسم الشركة الناقلة": "الشركة السريعة" // Custom column to merge!
        }
      }
    ],
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: 1,
    totalNormalizedRows: 1,
    totalExcludedMissingXrayIdCount: 0
  };

  test("runs asynchronously and reports progress steps", async () => {
    const progressSteps: Array<{ stage: string; percent: number }> = [];
    const input: PopulationProcessingInput = {
      riskWorkbookResult: mockRiskResult,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input, (stage, percent) => {
      progressSteps.push({ stage, percent });
    });

    expect(result.preparedRows.length).toBe(1);
    expect(progressSteps.length).toBeGreaterThan(0);
    // Verifies progress goes to 100%
    expect(progressSteps[progressSteps.length - 1].percent).toBe(100);
  });

  test("preserves rawRow custom columns and merges BI rawRow columns", async () => {
    const input: PopulationProcessingInput = {
      riskWorkbookResult: mockRiskResult,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    const preparedRow = result.preparedRows[0];
    expect(preparedRow).toBeDefined();

    // Check original risk custom columns are preserved
    expect(preparedRow.rawRow!["رقم لوحة الشاحنة"]).toBe("PLATE123");
    expect(preparedRow.rawRow!["اسم السائق"]).toBe("احمد حسن");

    // Check BI custom column was merged
    expect(preparedRow.rawRow!["اسم الشركة الناقلة"]).toBe("الشركة السريعة");
  });

  test("carries the three other-team risk results into otherResults (normalized)", async () => {
    const riskOnly: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          inspectorResult: "اشتباه",
          oppositeInspectorResult: "سليمة",
          liveMeansResult: "Alert"
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskOnly,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);
    const row = result.preparedRows[0];

    expect(row).toBeDefined();
    expect(row.otherResults.manual.result).toBe("اشتباه");
    expect(row.otherResults.opposite.result).toBe("سليمة");
    expect(row.otherResults.liveMeans.result).toBe("اشتباه");
    // No BI → codes/employees stay null
    expect(row.otherResults.manual.code).toBeNull();
    expect(row.otherResults.manual.employeeId).toBeNull();
    expect(row.otherResults.opposite.employeeId).toBeNull();
    expect(row.otherResults.liveMeans.employeeId).toBeNull();
    expect(row.notes).toBeNull();
  });

  test("BI enrichment fills otherResults (result/code/employee) when risk values are blank", async () => {
    const riskBlankOthers: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          inspectorResult: null,
          oppositeInspectorResult: null,
          liveMeansResult: null
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskBlankOthers,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);
    const row = result.preparedRows[0];

    expect(row).toBeDefined();

    // manual: result from BI "OK" → سليمة, code from BI, no employee field
    expect(row.otherResults.manual.result).toBe("سليمة");
    expect(row.otherResults.manual.code).toBe("M1");
    expect(row.otherResults.manual.employeeId).toBeNull();

    // opposite: result + code + employee from BI
    expect(row.otherResults.opposite.result).toBe("سليمة");
    expect(row.otherResults.opposite.code).toBe("C3");
    expect(row.otherResults.opposite.employeeId).toBe("Emp 3");

    // liveMeans: result + code + employee from BI
    expect(row.otherResults.liveMeans.result).toBe("سليمة");
    expect(row.otherResults.liveMeans.code).toBe("C4");
    expect(row.otherResults.liveMeans.employeeId).toBe("Emp 4");

    // notes carried from BI
    expect(row.notes).toBe("None");
  });

  test("a row with all other-team results blank is still included when L1/L2 are valid", async () => {
    const riskBlankOthers: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          inspectorResult: null,
          oppositeInspectorResult: null,
          liveMeansResult: null
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskBlankOthers,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.preparedRows.length).toBe(1);
    const row = result.preparedRows[0];
    expect(row.otherResults.manual.result).toBeNull();
    expect(row.otherResults.opposite.result).toBeNull();
    expect(row.otherResults.liveMeans.result).toBeNull();
    expect(row.notes).toBeNull();
  });

  test("a row missing valid L1 or L2 is still excluded (other teams do not rescue it)", async () => {
    const riskInvalidL2: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          xrayLevelTwoResult: null,
          inspectorResult: "سليمة",
          oppositeInspectorResult: "سليمة",
          liveMeansResult: "سليمة"
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskInvalidL2,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.preparedRows.length).toBe(0);
    expect(result.invalidResultRows.length).toBe(1);
  });
});
