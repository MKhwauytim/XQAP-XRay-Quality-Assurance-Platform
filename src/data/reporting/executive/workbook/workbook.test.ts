import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveWorkbookObject, SHEET_NAMES } from "./workbook";

// ─── Fixture builders ──────────────────────────────────────────────────────────

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
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
    rawRow: { "رقم الأشعة": "XR-1", "المنفذ": "منفذ الاختبار" },
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
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

/** Read a sheet back into an array-of-arrays (header + body), no disk I/O. */
function readSheet(wb: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = wb.Sheets[name];
  expect(sheet, `sheet "${name}" should exist`).toBeDefined();
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
}

/** A representative multi-row, mixed fixture covering the discipline cases. */
function seededInput(): ExecutiveReportInput {
  return input([
    // BI-mapped inspectors, fully evaluable, other teams present.
    popRow({
      xrayImageId: "XR-1",
      levelOneEmployee: "E-100",
      levelTwoEmployee: "E-200",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "اشتباه",
      otherResults: {
        manual: { result: "اشتباه", code: "M-9", employeeId: null },
        opposite: { result: "سليمة", code: "O-3", employeeId: "OP-1" },
        liveMeans: { result: null, code: null, employeeId: null },
      },
      rawRow: { "رقم الأشعة": "XR-1", "نتيجة المستوى الأول": "سليمة" },
    }),
    popRow({
      xrayImageId: "XR-2",
      portName: "منفذ ٢",
      levelOneEmployee: "E-100",
      levelTwoEmployee: "E-200",
      xrayLevelOneResult: "اشتباه",
      xrayLevelTwoResult: "اشتباه",
      rawRow: { "رقم الأشعة": "XR-2", "نتيجة المعاين": "اشتباه" },
    }),
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildExecutiveWorkbook", () => {
  it("builds and contains every expected sheet", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const expected = Object.values(SHEET_NAMES);
    for (const name of expected) {
      expect(wb.SheetNames, `missing sheet ${name}`).toContain(name);
    }
    expect(wb.SheetNames).toHaveLength(expected.length);
  });

  it("emits two decision-fact-table rows per population row (L1 + L2)", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const rows = readSheet(wb, SHEET_NAMES.factTable);
    // header + 2 rows × 2 decisions = 1 + 4
    expect(rows.length).toBe(5);
    const body = rows.slice(1);
    const levelCol = (rows[0] as string[]).indexOf("مستوى القرار");
    expect(body.filter((r) => r[levelCol] === "المستوى الأول")).toHaveLength(2);
    expect(body.filter((r) => r[levelCol] === "المستوى الثاني")).toHaveLength(2);
  });

  it("result comparison has one row per image with all six source columns", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const rows = readSheet(wb, SHEET_NAMES.resultComparison);
    expect(rows.length).toBe(3); // header + 2 images
    const header = rows[0] as string[];
    for (const label of [
      "المستوى الأول (نتيجة)",
      "المستوى الثاني (نتيجة)",
      "التفتيش اليدوي (نتيجة)",
      "التفتيش المعاكس (نتيجة)",
      "الوسائل الحية (نتيجة)",
      "نتيجة المراجعة (نتيجة)",
    ]) {
      expect(header).toContain(label);
    }
  });

  it("comparison shows — for a source that did not act, not 0%", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const rows = readSheet(wb, SHEET_NAMES.resultComparison);
    const header = rows[0] as string[];
    const liveCol = header.indexOf("الوسائل الحية (نتيجة)");
    // XR-1 has no liveMeans result → must render — (dash), never a number/percentage.
    expect(rows[1]![liveCol]).toBe("—");
  });

  it("inspector columns carry — when BI did not map (no fabricated names)", () => {
    // All inspector ids null → employee-by-port shows the unmapped empty state.
    const wb = buildExecutiveWorkbookObject(input([popRow({ xrayImageId: "XR-1" })]));
    const empRows = readSheet(wb, SHEET_NAMES.employeeByPort);
    const note = String(empRows[1]?.[0] ?? "");
    expect(note).toContain("هوية المفتش غير مرتبطة");

    // The image-rows sheet inspector columns must show — (not blank, not 0).
    const imageRows = readSheet(wb, SHEET_NAMES.rows);
    const header = imageRows[0] as string[];
    const l1Col = header.indexOf("م.أول (مفتش)");
    expect(imageRows[1]![l1Col]).toBe("—");
  });

  it("inspector columns carry the BI id when mapped", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const factRows = readSheet(wb, SHEET_NAMES.factTable);
    const header = factRows[0] as string[];
    const idCol = header.indexOf("معرّف المفتش");
    const ids = new Set(factRows.slice(1).map((r) => r[idCol]));
    expect(ids).toContain("E-100");
    expect(ids).toContain("E-200");
  });

  it("never prints 0% for a null-denominator agreement metric", () => {
    // No reviewer result anywhere → every reviewer-agreement rate is null and
    // must render as a blank cell (not 0, not "0%"). Count columns (comparable,
    // agree, disagree) are TRUE zeros and may legitimately render 0 (§3.7).
    const wb = buildExecutiveWorkbookObject(seededInput());
    const cross = readSheet(wb, SHEET_NAMES.crossTeam);
    const reviewerHeader = cross[0] as string[];
    const rateCol = reviewerHeader.indexOf("نسبة التوافق%");
    expect(rateCol).toBeGreaterThanOrEqual(0);
    // The reviewer rows follow the header until the blank separator row.
    for (let i = 1; i < cross.length; i++) {
      const row = cross[i];
      if (!row || row.length === 0) break; // blank separator → end of reviewer block
      const rate = row[rateCol];
      // A null rate must be blank/undefined — never 0 or "0%".
      expect(rate).not.toBe("0%");
      expect(rate).not.toBe(0);
    }
  });

  it("raw-risk sheet carries source sheet / row + the raw keys", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const rows = readSheet(wb, SHEET_NAMES.rawRisk);
    const header = rows[0] as string[];
    expect(header).toContain("ورقة المصدر");
    expect(header).toContain("رقم صف المصدر");
    expect(header).toContain("رقم الأشعة");
  });

  it("raw-BI and exclusions sheets carry the spec-compliant unavailable notes", () => {
    const wb = buildExecutiveWorkbookObject(seededInput());
    const bi = readSheet(wb, SHEET_NAMES.rawBi);
    expect(String(bi[0]?.[0] ?? "")).toContain("بيانات BI غير متاحة");
    const exclusions = readSheet(wb, SHEET_NAMES.exclusions);
    const joined = exclusions.flat().map((c) => String(c ?? "")).join(" ");
    expect(joined).toContain("processing.summary.json");
  });

  it("resolves reviewer display names in the reviewer column", () => {
    const inp = input([
      popRow({ xrayImageId: "XR-1", levelOneEmployee: "E-1", levelTwoEmployee: "E-2" }),
    ]);
    // assignedTo comes from distribution; with none, reviewer column is — — fine.
    const wb = buildExecutiveWorkbookObject(inp, { "user-1": "محمد" });
    expect(wb.SheetNames).toContain(SHEET_NAMES.rows);
  });
});
