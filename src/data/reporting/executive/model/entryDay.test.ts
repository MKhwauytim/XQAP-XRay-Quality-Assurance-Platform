import { describe, expect, it } from "vitest";
import { entryDayOf } from "./entryDay";
import { buildExecutiveReportRows } from "../../executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";

describe("entryDayOf", () => {
  it("reads the day from a plain ISO date", () => {
    expect(entryDayOf("2026-05-14")).toBe(14);
  });

  it("reads the day from an ISO date carrying a time component", () => {
    expect(entryDayOf("2026-05-01 18:04:11")).toBe(1);
    expect(entryDayOf("2026-05-16T09:14:30.000Z")).toBe(16);
  });

  it("returns null for a value normalizeDate could not parse and passed through", () => {
    // normalizeDate falls back to returning its input unchanged, so a non-ISO
    // value can legitimately reach this helper. It must never be guessed at.
    expect(entryDayOf("14/05/2026")).toBeNull();
    expect(entryDayOf("not a date")).toBeNull();
    expect(entryDayOf("45123")).toBeNull();
  });

  it("returns null for null, undefined, and empty input", () => {
    expect(entryDayOf(null)).toBeNull();
    expect(entryDayOf(undefined)).toBeNull();
    expect(entryDayOf("")).toBeNull();
  });

  it("returns null for a syntactically ISO value with an impossible day", () => {
    expect(entryDayOf("2026-05-00")).toBeNull();
    expect(entryDayOf("2026-05-32")).toBeNull();
  });

  it("accepts the first and last day of a month", () => {
    expect(entryDayOf("2026-05-01")).toBe(1);
    expect(entryDayOf("2026-05-31")).toBe(31);
  });
});

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الأول",
    xrayImageId: "XR-1",
    xrayEntryDate: "2026-05-14",
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
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function inputWith(rows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-may-2026",
    populationRows: rows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("report-row bridging", () => {
  it("carries the entry day onto the report row", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ xrayEntryDate: "2026-05-14" })]));
    expect(row.entryDay).toBe(14);
  });

  it("leaves entryDay null when the date is unusable", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ xrayEntryDate: "غير معروف" })]));
    expect(row.entryDay).toBeNull();
  });

  it("treats a blank or whitespace-only محضر number as absent", () => {
    const [blank] = buildExecutiveReportRows(inputWith([popRow({ reportNumber: "   " })]));
    expect(blank.hasReport).toBe(false);
    const [present] = buildExecutiveReportRows(inputWith([popRow({ reportNumber: "M-42" })]));
    expect(present.hasReport).toBe(true);
  });

  it("carries the risk-engine value through RAW, without interpreting it", () => {
    const [row] = buildExecutiveReportRows(inputWith([popRow({ targetedByRiskEngine: "نعم" })]));
    expect(row.targetedByRiskEngine).toBe("نعم");
  });
});
