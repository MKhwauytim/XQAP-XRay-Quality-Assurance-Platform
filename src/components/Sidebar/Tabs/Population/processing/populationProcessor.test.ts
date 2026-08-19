import { describe, expect, test, it } from "vitest";
import * as XLSX from "xlsx";
import { processPopulation, normalizeDate, normalizeResultValue } from "./populationProcessor";
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
        transitDeclarationNumber: "TR1",
        declarationDate: "2026-06-16",
        declarationHijriDate: "1447-12-01",
        manifestNumber: "MN1",
        manifestType: "MT1",
        manifestDate: "2026-06-16",
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
        movementNumber: "BI-M1",
        movementDate: "2026-06-16",
        movementHijriDate: "1447-12-01",
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
    unmatchedSheetNames: [],
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

  test("summary.certScanProvided is false and certScanRows is 0 when no CertScan reference text is supplied (owner report 2026-08-12: bare 0 must be distinguishable from 'matched none')", async () => {
    const input: PopulationProcessingInput = {
      riskWorkbookResult: mockRiskResult,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.summary.certScanProvided).toBe(false);
    expect(result.summary.certScanRows).toBe(0);
  });

  test("summary.certScanProvided is true once a parseable CertScan paste is supplied, independent of whether it actually matches this row's port/serial", async () => {
    const input: PopulationProcessingInput = {
      riskWorkbookResult: mockRiskResult,
      biWorkbookResult: mockBiResult,
      certScanPasteText: "Port Name\tSystem S/N\nمنفذ آخر\tXYZ98765"
    };

    const result = await processPopulation(input);

    expect(result.summary.certScanProvided).toBe(true);
    // This row's port ("البطحاء") doesn't align with the pasted port ("منفذ آخر"),
    // so it still ends up NonCertScan -- certScanProvided being true is about
    // whether a usable reference list existed, not whether this row matched it.
    expect(result.summary.certScanRows).toBe(0);
  });

  test("carries previously-dropped risk fields (manifest, movement, transit declaration, hijri dates, destination, entry/exit) through to the final prepared row", async () => {
    const input: PopulationProcessingInput = {
      riskWorkbookResult: mockRiskResult,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);
    const row = result.preparedRows[0];

    expect(row).toBeDefined();
    expect(row.transitDeclarationNumber).toBe("TR1");
    expect(row.declarationHijriDate).toBe("1447-12-01");
    expect(row.manifestNumber).toBe("MN1");
    expect(row.manifestType).toBe("MT1");
    expect(row.manifestDate).toBe("2026-06-16");
    expect(row.finalDestination).toBe("Riyadh");
    expect(row.entryDate).toBe("2026-06-16");
    expect(row.exitDate).toBe("2026-06-16");
    // Risk side already has its own movement fields — BI's should not override them.
    expect(row.movementNumber).toBe("M1");
    expect(row.movementDate).toBe("2026-06-16");
    expect(row.movementHijriDate).toBe("1447-12-01");
  });

  test("fills movementNumber/movementDate/movementHijriDate/declarationHijriDate from BI when the risk side is blank", async () => {
    const riskBlankMovement: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          movementNumber: null,
          movementDate: null,
          movementHijriDate: null,
          declarationHijriDate: null
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskBlankMovement,
      biWorkbookResult: mockBiResult,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);
    const row = result.preparedRows[0];

    expect(row).toBeDefined();
    expect(row.movementNumber).toBe("BI-M1");
    expect(row.movementDate).toBe("2026-06-16");
    expect(row.movementHijriDate).toBe("1447-12-01");
    expect(row.declarationHijriDate).toBe("1447-12-01");
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

  // B7 (OOM fix, 2026-08-12): pins the memory-relevant structure behind the
  // rawRow lazy-merge. A 130k-risk + 247k-BI month legitimately holds both
  // full row sets in memory simultaneously (see 301e84d4's BI truthiness-bug
  // fix) — copying the full raw row again for every prepared row doubled the
  // dominant cost and caused a browser-tab OOM. These tests would fail if a
  // future change reintroduces an eager `{ ...rawRow }` copy on this path.
  describe("rawRow memory structure (B7)", () => {
    test("a row provided but not matched by BI has a prepared rawRow that is the SAME object reference as the source risk row's rawRow (no copy)", async () => {
      const biUnrelatedRow: BiWorkbookResult = {
        ...mockBiResult,
        rows: [
          {
            ...mockBiResult.rows[0],
            xrayImageId: "SOME-OTHER-ID",
            rawRow: { "اسم الشركة الناقلة": "شركة أخرى" }
          }
        ]
      };

      const input: PopulationProcessingInput = {
        riskWorkbookResult: mockRiskResult,
        biWorkbookResult: biUnrelatedRow,
        certScanPasteText: ""
      };

      const result = await processPopulation(input);
      const preparedRow = result.preparedRows[0];

      expect(preparedRow).toBeDefined();
      expect(preparedRow.biMatched).toBe(false);
      // Identity, not just deep equality -- proves no `{ ...rawRow }` copy happened.
      expect(preparedRow.rawRow).toBe(mockRiskResult.rows[0].rawRow);
    });

    test("a row with no BI provided at all has a prepared rawRow that is the SAME object reference as the source risk row's rawRow (no copy)", async () => {
      const input: PopulationProcessingInput = {
        riskWorkbookResult: mockRiskResult,
        biWorkbookResult: null,
        certScanPasteText: ""
      };

      const result = await processPopulation(input);
      const preparedRow = result.preparedRows[0];

      expect(preparedRow).toBeDefined();
      expect(preparedRow.biMatched).toBe(false);
      expect(preparedRow.rawRow).toBe(mockRiskResult.rows[0].rawRow);
    });

    test("a BI-matched row's prepared rawRow does not mutate the source risk row's own rawRow object", async () => {
      const input: PopulationProcessingInput = {
        riskWorkbookResult: mockRiskResult,
        biWorkbookResult: mockBiResult,
        certScanPasteText: ""
      };

      const result = await processPopulation(input);
      const preparedRow = result.preparedRows[0];

      expect(preparedRow.biMatched).toBe(true);
      // The merged view sees the BI-only column...
      expect(preparedRow.rawRow!["اسم الشركة الناقلة"]).toBe("الشركة السريعة");
      // ...but the original risk row object handed in by the caller must stay
      // untouched -- if this ever fails, some code path started merging BI
      // data into the base object in place instead of via a separate delta.
      expect(mockRiskResult.rows[0].rawRow).not.toHaveProperty("اسم الشركة الناقلة");
      expect(Object.keys(mockRiskResult.rows[0].rawRow!)).toEqual([
        "معرف الأشعة",
        "اسم المنفذ",
        "رقم لوحة الشاحنة",
        "اسم السائق"
      ]);
    });
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

  test("a row with a valid level 2 and an absent level 1 is still excluded, per the documented 'population entry requires valid L1 and L2' invariant (decisionFactTable.ts, and the 'other teams do not rescue it' test above) — this is NOT the bug to fix on a guess", async () => {
    const riskAbsentL1: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          xrayLevelOneResult: null,
          xrayLevelTwoResult: "اشتباه"
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskAbsentL1,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.preparedRows.length).toBe(0);
    expect(result.invalidResultRows.length).toBe(1);
    // Diagnostic: the dropped-row reason must identify WHICH field failed
    // (level 1, not level 2) and record the raw offending value so a
    // 100%-drop report is self-diagnosing instead of a bare count.
    expect(result.invalidResultRows[0].reason).toMatch(/^Invalid level result \[L1\]:/);
    expect(result.invalidResultRows[0].reason).toContain("xrayLevelOneResult=");
    expect(result.invalidResultRows[0].reason).not.toContain("xrayLevelTwoResult=");
  });

  test("stops building per-row diagnostic strings past the cap, so a wholesale-drop month cannot exhaust the heap (OOM regression guard)", async () => {
    // The tagged reason is a UNIQUE string per row; the reason it replaced was
    // one interned literal. On a real 500k-row month where the level columns
    // fail wholesale, building one fresh string per dropped row exhausted the
    // heap — an OOM caused by the very diagnostic meant to explain the drop.
    const DROPPED = 120; // > DIAGNOSTIC_DETAILED_ROW_LIMIT (50)
    const riskManyInvalid: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: Array.from({ length: DROPPED }, (_, i) => ({
        ...mockRiskResult.rows[0],
        xrayImageId: `X-OOM-${i}`,
        xrayLevelOneResult: null,
        xrayLevelTwoResult: "اشتباه"
      }))
    };

    const result = await processPopulation({
      riskWorkbookResult: riskManyInvalid,
      biWorkbookResult: null,
      certScanPasteText: ""
    });

    // Every dropped row is still counted — summary totals derive from .length.
    expect(result.invalidResultRows.length).toBe(DROPPED);

    // The first rows keep full detail (what the report's examples render).
    expect(result.invalidResultRows[0].reason).toMatch(/^Invalid level result \[L1\]:/);

    // Past the cap the reason is the SHARED constant — asserted by reference
    // identity, which is the property that actually bounds allocation.
    const tail = result.invalidResultRows.slice(60).map((r) => r.reason);
    const distinctTailReasons = new Set(tail);
    expect(distinctTailReasons.size).toBe(1);
    expect(tail[0]).not.toMatch(/^Invalid level result \[L1\]:/);
    expect(tail.every((reason) => reason === tail[0])).toBe(true);
  });

  test("diagnostic reason carries the raw unrecognized value (truncated) for a garbled level 2 cell, tagged [L2]", async () => {
    const longGarbledValue = "قيمة غير معروفة تماماً ولا تطابق أي نمط معروف على الإطلاق مهما طالت";
    const riskGarbledL2: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          xrayLevelOneResult: "سليمة",
          xrayLevelTwoResult: longGarbledValue
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskGarbledL2,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.invalidResultRows.length).toBe(1);
    const reason = result.invalidResultRows[0].reason;
    expect(reason).toMatch(/^Invalid level result \[L2\]:/);
    expect(reason).toContain("xrayLevelTwoResult=");
    // Truncated, not the full raw string, and not "empty/missing".
    expect(reason).not.toContain(longGarbledValue);
    expect(reason).not.toContain("فارغ/غير موجود");
  });

  test("diagnostic reason is tagged [L1+L2] when both levels fail", async () => {
    const riskBothInvalid: RiskWorkbookResult = {
      ...mockRiskResult,
      rows: [
        {
          ...mockRiskResult.rows[0],
          xrayLevelOneResult: null,
          xrayLevelTwoResult: null
        }
      ]
    };

    const input: PopulationProcessingInput = {
      riskWorkbookResult: riskBothInvalid,
      biWorkbookResult: null,
      certScanPasteText: ""
    };

    const result = await processPopulation(input);

    expect(result.invalidResultRows.length).toBe(1);
    const reason = result.invalidResultRows[0].reason;
    expect(reason).toMatch(/^Invalid level result \[L1\+L2\]:/);
    expect(reason).toContain("xrayLevelOneResult=");
    expect(reason).toContain("xrayLevelTwoResult=");
  });
});

describe("normalizeDate", () => {
  it("keeps day-first parsing for values where both readings would be valid (the documented ambiguous policy — do not change)", () => {
    // 3 April 2026 under the existing day-first assumption. This is the
    // genuinely ambiguous case (a US-locale author might have meant 4 March);
    // the policy decision stays out of scope — this test is a regression
    // guard that the fix below does NOT alter this behavior.
    expect(normalizeDate("03/04/2026")).toBe("2026-04-03");
  });

  it("keeps unambiguous day-first values unchanged", () => {
    expect(normalizeDate("25/12/2025")).toBe("2025-12-25");
  });

  it("rescues values where day-first is syntactically impossible but month-first is valid", () => {
    // "12/25/2025" — day-first would need month=25, which is invalid; the
    // only valid reading is month-first: December 25, 2025.
    expect(normalizeDate("12/25/2025")).toBe("2025-12-25");
  });

  it("rescues another month>12 case", () => {
    // "06/15/2025" — day-first needs month=15 (invalid); month-first: June 15, 2025.
    expect(normalizeDate("06/15/2025")).toBe("2025-06-15");
  });

  it("rescues a case where the day-first day slot would also be invalid on its own reading", () => {
    // "01/31/2025" — day-first needs month=31 (invalid); month-first: January 31, 2025.
    expect(normalizeDate("01/31/2025")).toBe("2025-01-31");
  });

  it("still returns raw when NEITHER reading is valid", () => {
    // Both components exceed 12: "13/25/2025" — day-first month=25 invalid,
    // month-first would read this as month=13 (invalid) day=25. Neither reading works, so it must stay un-normalized.
    expect(normalizeDate("13/25/2025")).toBe("13/25/2025");
  });

  it("returns null for empty/null input, unchanged", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });

  // Table-driven coverage for every shape the owner reported seeing in real
  // BI/risk imports: Excel serials (string and numeric-typed), datetime
  // strings with and without fractional seconds, JS Date objects (in case a
  // future/alternate workbook reader hands one back), the existing
  // slash/dash/Arabic-month formats, and a value that must pass through
  // untouched.
  const cases: Array<[string, string | number | Date | null, string | null]> = [
    // Excel serial numbers, as strings (how they arrive today via
    // riskDataNormalizer's String(value) conversion of a raw numeric cell).
    ["excel serial string, mid-range (45814 -> 2025-06-06)", "45814", "2025-06-06"],
    ["excel serial string, lower boundary (25000)", "25000", "1968-06-11"],
    ["excel serial string, upper boundary (60000)", "60000", "2064-04-08"],
    ["excel serial string with fractional time-of-day part", "45814.6136", "2025-06-06"],
    // Excel serial numbers, as an actual JS number (not pre-stringified).
    ["excel serial as JS number", 45814, "2025-06-06"],
    ["excel serial as JS number with fractional time-of-day part", 45814.25, "2025-06-06"],
    // A number outside the plausible serial range must not be reinterpreted —
    // it is presumably a genuine numeric ID, not a date.
    ["out-of-range number is left as its string form, not treated as a serial", 99999999, "99999999"],
    // A 5-digit string outside the plausible range: same guard, string form.
    ["out-of-range 5-digit numeric string is returned raw, not a serial", "99999", "99999"],
    // Datetime strings: keep the date, drop the time.
    ["datetime string with seconds", "2026-05-01 18:04:11", "2026-05-01"],
    ["datetime string with fractional seconds", "2026-05-16 09:14:30.000000", "2026-05-16"],
    // JS Date object input (defensive: some SheetJS configurations return these).
    ["JS Date object", new Date(2026, 4, 16), "2026-05-16"],
    // Formats the existing helper already handled, kept as a regression net.
    ["slash-separated day-first", "25/12/2025", "2025-12-25"],
    ["dash-separated day-first", "25-12-2025", "2025-12-25"],
    ["dot-separated day-first", "25.12.2025", "2025-12-25"],
    ["mixed DDMmmYYYY", "12Dec2025", "2025-12-12"],
    ["Arabic month name", "12 ديسمبر 2025", "2025-12-12"],
    ["already ISO, no time", "2026-05-01", "2026-05-01"],
    // A value that must still pass through untouched: no recognizable format.
    ["unrecognized free text passes through unchanged", "N/A", "N/A"],
    ["null input", null, null]
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

// Regression net for the serial-date off-by-one fixed on 2026-08-18: the app's
// own serial->ISO conversion double-applied Excel's 1900 leap-year correction
// (the 25569 constant already absorbs it), so every imported date landed one day
// early and any 1st-of-month row was filed under the previous month.
//
// Rather than re-pin a handful of hand-computed dates, this asserts agreement
// with the vendored SheetJS's own `SSF.parse_date_code` — the very code that
// read the cell in the first place. The app and its workbook reader disagreeing
// about what a serial means is the actual defect class, so that is what is
// pinned, across the whole range `normalizeDate` routes into the converter.
describe("normalizeDate: Excel serials agree with the vendored SheetJS reader", () => {
  function sheetJsIso(serial: number): string {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (!parsed) throw new Error(`SheetJS could not parse serial ${serial}`);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  }

  // The exact serial the regression was found on: 1 May 2025. Under the old
  // double correction this returned "2025-04-30" — a May row filed as April.
  it("serial 45778 is 2025-05-01, not the previous day", () => {
    expect(normalizeDate(45778)).toBe("2025-05-01");
    expect(normalizeDate("45778")).toBe("2025-05-01");
    expect(sheetJsIso(45778)).toBe("2025-05-01");
  });

  it("matches SheetJS across the whole 25000-60000 guarded range", () => {
    const serials = [25000, 25001, 30000, 36526, 40000, 44927, 45778, 45814, 50000, 59999, 60000];
    for (const serial of serials) {
      expect([serial, normalizeDate(serial)]).toEqual([serial, sheetJsIso(serial)]);
      expect([serial, normalizeDate(String(serial))]).toEqual([serial, sheetJsIso(serial)]);
    }
  });

  it("a fractional time-of-day part is dropped, not rounded into the next day", () => {
    expect(normalizeDate(45778.99)).toBe("2025-05-01");
    expect(normalizeDate("45778.99")).toBe("2025-05-01");
  });
});

describe("normalizeResultValue", () => {
  const cases: Array<[string, string | null, "سليمة" | "اشتباه" | null]> = [
    // Plain numeric codes.
    ["numeric code 1 -> سليمة", "1", "سليمة"],
    ["numeric code 2 -> اشتباه", "2", "اشتباه"],
    // Leading numeric code with a parenthesised label — the agency's own
    // numeric code is authoritative, checked ahead of the text.
    ["numeric-code form '1 (سليمة)'", "1 (سليمة)", "سليمة"],
    ["numeric-code form '2 (اشتباه)'", "2 (اشتباه)", "اشتباه"],
    ["numeric-code form with English label", "2 (Suspect)", "اشتباه"],
    // English codes.
    ["English CLEAR", "CLEAR", "سليمة"],
    ["English OK", "ok", "سليمة"],
    ["English PASS", "Pass", "سليمة"],
    ["English ALERT", "ALERT", "اشتباه"],
    ["English FAIL", "fail", "اشتباه"],
    ["English SUSPECT", "Suspect", "اشتباه"],
    // Plain Arabic text.
    ["plain سليمة", "سليمة", "سليمة"],
    ["plain اشتباه", "اشتباه", "اشتباه"],
    ["سليمة with trailing code", "سليمة - 123", "سليمة"],
    ["نظيف synonym", "نظيف", "سليمة"],
    ["مقبول synonym", "مقبول", "سليمة"],
    ["مريب synonym", "مريب", "اشتباه"],
    ["مشبوه synonym", "مشبوه", "اشتباه"],
    // THE precedence-bug case: a compound value containing BOTH tokens must
    // resolve to اشتباه (the safe audit reading — never silently downgrade a
    // recorded suspicion to "clear"), not سليمة.
    ["compound value with BOTH tokens resolves to اشتباه (regression guard for the precedence bug)", "نتيجة اشتباه -مبدئي (سليمة)", "اشتباه"],
    // Values that must not match anything.
    ["unrecognized text returns null", "غير معروف", null],
    ["empty string returns null", "", null],
    ["null input returns null", null, null]
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(normalizeResultValue(input)).toBe(expected);
  });
});
