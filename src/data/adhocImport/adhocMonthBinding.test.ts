import { describe, expect, it } from "vitest";

import type { AdhocMonthBinding, AdhocRow } from "./adhocImportModel";
import { linkedMonthsOf, parseStudyMonth, resolveRowMonth } from "./adhocMonthBinding";

function rowWithMonth(rowKey: string, studyMonth: string | null): AdhocRow {
  return {
    rowKey,
    mapped: { studyMonth },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

describe("parseStudyMonth — accepted forms", () => {
  it("round-trips an existing folder name, in either case", () => {
    expect(parseStudyMonth("5-may-2026")).toBe("5-may-2026");
    expect(parseStudyMonth("5-May-2026")).toBe("5-may-2026");
    expect(parseStudyMonth("12-December-2025")).toBe("12-december-2025");
  });

  it("accepts year-first numeric pairs", () => {
    expect(parseStudyMonth("2026-05")).toBe("5-may-2026");
    expect(parseStudyMonth("2026/05")).toBe("5-may-2026");
    expect(parseStudyMonth("2026-5")).toBe("5-may-2026");
  });

  it("accepts month-first numeric pairs", () => {
    expect(parseStudyMonth("05/2026")).toBe("5-may-2026");
    expect(parseStudyMonth("5-2026")).toBe("5-may-2026");
    expect(parseStudyMonth("05.2026")).toBe("5-may-2026");
  });

  it("takes the month and year out of a full date", () => {
    expect(parseStudyMonth("2026-05-17")).toBe("5-may-2026");
    expect(parseStudyMonth("17/05/2026")).toBe("5-may-2026");
    // Day > 12 in the middle position can only be month-first.
    expect(parseStudyMonth("05/17/2026")).toBe("5-may-2026");
    // Day and month equal: both readings agree on the month, so it resolves.
    expect(parseStudyMonth("05/05/2026")).toBe("5-may-2026");
  });

  it("accepts Arabic month names, MSA and Levantine alike", () => {
    expect(parseStudyMonth("مايو 2026")).toBe("5-may-2026");
    expect(parseStudyMonth("أيار 2026")).toBe("5-may-2026");
    expect(parseStudyMonth("ايار 2026")).toBe("5-may-2026");
    expect(parseStudyMonth("كانون الأول 2025")).toBe("12-december-2025");
    expect(parseStudyMonth("2026 يونيه")).toBe("6-june-2026");
  });

  it("accepts English month names and abbreviations", () => {
    expect(parseStudyMonth("May 2026")).toBe("5-may-2026");
    expect(parseStudyMonth("may-2026")).toBe("5-may-2026");
    expect(parseStudyMonth("Oct 2026")).toBe("10-october-2026");
    expect(parseStudyMonth("SEPTEMBER/2026")).toBe("9-september-2026");
  });

  it("folds Arabic-Indic digits before parsing", () => {
    expect(parseStudyMonth("٢٠٢٦-٠٥")).toBe("5-may-2026");
    expect(parseStudyMonth("مايو ٢٠٢٦")).toBe("5-may-2026");
    expect(parseStudyMonth("۰۵/۲۰۲۶")).toBe("5-may-2026");
  });

  it("converts an Excel date serial through the 1899-12-30 epoch", () => {
    expect(parseStudyMonth("46143")).toBe("5-may-2026");
    expect(parseStudyMonth("46159")).toBe("5-may-2026");
    expect(parseStudyMonth("45292")).toBe("1-january-2024");
    // A serial carrying a time-of-day fraction resolves to the same month.
    expect(parseStudyMonth("46159.75")).toBe("5-may-2026");
  });

  it("trims surrounding whitespace", () => {
    expect(parseStudyMonth("  2026-05  ")).toBe("5-may-2026");
  });
});

describe("parseStudyMonth — refusals", () => {
  it("refuses an ambiguous numeric pair with no 4-digit year", () => {
    // May 2006? June 2005? The 6th of May? Filing a study under a guessed
    // month is worse than making the admin map the column explicitly.
    expect(parseStudyMonth("05/06")).toBeNull();
    expect(parseStudyMonth("5-6")).toBeNull();
    expect(parseStudyMonth("05/26")).toBeNull();
  });

  it("refuses a full date whose day and month readings disagree", () => {
    expect(parseStudyMonth("05/06/2026")).toBeNull();
    expect(parseStudyMonth("06-05-2026")).toBeNull();
  });

  it("refuses a bare month or a bare year", () => {
    expect(parseStudyMonth("5")).toBeNull();
    expect(parseStudyMonth("2026")).toBeNull();
  });

  it("refuses a number outside the plausible Excel serial window", () => {
    expect(parseStudyMonth("19999")).toBeNull();
    expect(parseStudyMonth("800001")).toBeNull();
  });

  it("refuses an out-of-range month or year", () => {
    expect(parseStudyMonth("13/2026")).toBeNull();
    expect(parseStudyMonth("2026-13")).toBeNull();
    expect(parseStudyMonth("05/1800")).toBeNull();
  });

  it("refuses a month name with no year, and a year with an unknown name", () => {
    expect(parseStudyMonth("مايو")).toBeNull();
    expect(parseStudyMonth("May")).toBeNull();
    expect(parseStudyMonth("رمضان 2026")).toBeNull();
    expect(parseStudyMonth("Mayo 2026")).toBeNull();
  });

  it("refuses garbage, blanks and nullish input", () => {
    expect(parseStudyMonth("لا يوجد")).toBeNull();
    expect(parseStudyMonth("???")).toBeNull();
    expect(parseStudyMonth("")).toBeNull();
    expect(parseStudyMonth("   ")).toBeNull();
    expect(parseStudyMonth(null)).toBeNull();
    expect(parseStudyMonth(undefined)).toBeNull();
  });
});

describe("resolveRowMonth", () => {
  it("returns undefined for an isolated import", () => {
    expect(resolveRowMonth({ kind: "isolated" }, { studyMonth: "2026-05" })).toBeUndefined();
  });

  it("returns the fixed month for a month-bound import", () => {
    const binding: AdhocMonthBinding = { kind: "month", monthFolderName: "5-may-2026" };

    expect(resolveRowMonth(binding, {})).toBe("5-may-2026");
  });

  it("parses the bound column for a column-bound import", () => {
    const binding: AdhocMonthBinding = { kind: "column", fieldKey: "studyMonth" };

    expect(resolveRowMonth(binding, { studyMonth: "مايو 2026" })).toBe("5-may-2026");
  });

  it("returns undefined when the bound column is blank or unparseable", () => {
    const binding: AdhocMonthBinding = { kind: "column", fieldKey: "studyMonth" };

    expect(resolveRowMonth(binding, { studyMonth: null })).toBeUndefined();
    expect(resolveRowMonth(binding, { studyMonth: "05/06" })).toBeUndefined();
    expect(resolveRowMonth(binding, {})).toBeUndefined();
  });
});

describe("linkedMonthsOf", () => {
  it("is empty for an isolated import", () => {
    expect(linkedMonthsOf({ kind: "isolated" }, [rowWithMonth("s:2", "2026-05")])).toEqual([]);
  });

  it("reports a month binding's month even with no rows", () => {
    expect(linkedMonthsOf({ kind: "month", monthFolderName: "5-may-2026" }, [])).toEqual([
      "5-may-2026",
    ]);
  });

  it("sorts chronologically, not lexicographically", () => {
    const rows = [
      rowWithMonth("s:2", "2026-10"),
      rowWithMonth("s:3", "2026-05"),
      rowWithMonth("s:4", "2025-12"),
    ];

    expect(linkedMonthsOf({ kind: "column", fieldKey: "studyMonth" }, rows)).toEqual([
      "12-december-2025",
      "5-may-2026",
      "10-october-2026",
    ]);
  });

  it("de-duplicates months and skips rows whose month did not resolve", () => {
    const rows = [
      rowWithMonth("s:2", "2026-05"),
      rowWithMonth("s:3", "مايو 2026"),
      rowWithMonth("s:4", "05/06"),
      rowWithMonth("s:5", null),
    ];

    expect(linkedMonthsOf({ kind: "column", fieldKey: "studyMonth" }, rows)).toEqual([
      "5-may-2026",
    ]);
  });
});
