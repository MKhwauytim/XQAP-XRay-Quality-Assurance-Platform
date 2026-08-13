// Regression test: sourceRowNumber must be the row's TRUE worksheet row number.
//
// worksheetToSourceRows used to pass blankrows: false to sheet_to_json, which
// drops fully blank rows from the returned array before this code ever sees
// them -- so `index + 1` numbered a compacted array and every interior blank
// row shifted the reported number of everything below it down by one.
//
// That number is user-facing: createRemovedRow threads it into every dropped-row
// diagnostic ("Invalid X-ray ID", "Duplicate X-ray ID", ...), and
// PopulationProcessingReport renders it as "رقم الصف المصدر" -- the pointer a
// user follows back into their spreadsheet to fix the offending row. Blank
// spacer rows are common in hand-maintained agency exports, so a user chasing a
// diagnostic would land on the wrong line, or on a blank one.

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { worksheetToSourceRows } from "./worksheetRows";

type Row = Record<string, unknown>;

function rowsFrom(aoa: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  return worksheetToSourceRows<Row>(XLSX.utils, worksheet);
}

describe("worksheetToSourceRows sourceRowNumber", () => {
  test("reports true worksheet row numbers across an interior blank row", () => {
    // Worksheet rows:  1 header | 2 data | 3 BLANK | 4 data
    const result = rowsFrom([
      ["معرف الأشعة", "الميناء"],
      ["A1", "بري"],
      [],
      ["A2", "بري"],
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].row["معرف الأشعة"]).toBe("A1");
    expect(result[0].sourceRowNumber).toBe(2);
    // The one that used to be mis-numbered 3.
    expect(result[1].row["معرف الأشعة"]).toBe("A2");
    expect(result[1].sourceRowNumber).toBe(4);
  });

  test("accumulates the offset across several blank rows", () => {
    // Worksheet rows: 1 header | 2 data | 3,4 BLANK | 5 data | 6 BLANK | 7 data
    const result = rowsFrom([
      ["معرف الأشعة"],
      ["A1"],
      [],
      [],
      ["A2"],
      [],
      ["A3"],
    ]);

    expect(result.map((r) => r.sourceRowNumber)).toEqual([2, 5, 7]);
  });

  test("is unchanged for a clean sheet with no blank rows", () => {
    const result = rowsFrom([
      ["معرف الأشعة"],
      ["A1"],
      ["A2"],
      ["A3"],
    ]);

    expect(result.map((r) => r.sourceRowNumber)).toEqual([2, 3, 4]);
  });

  test("a blank row above the header does not corrupt header derivation", () => {
    // Worksheet rows: 1 BLANK | 2 header | 3 data
    const result = rowsFrom([
      [],
      ["معرف الأشعة", "الميناء"],
      ["A1", "بري"],
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].row["معرف الأشعة"]).toBe("A1");
    expect(result[0].row["الميناء"]).toBe("بري");
    expect(result[0].sourceRowNumber).toBe(3);
  });

  test("a row of empty strings still counts as present, not as a data row", () => {
    // Distinguishes a truly blank row from one whose cells are empty strings:
    // both are filtered out of the output by isNonEmptyRow, but each still
    // occupies its worksheet row for numbering purposes.
    const result = rowsFrom([
      ["معرف الأشعة"],
      ["A1"],
      ["", ""],
      ["A2"],
    ]);

    expect(result.map((r) => r.row["معرف الأشعة"])).toEqual(["A1", "A2"]);
    expect(result.map((r) => r.sourceRowNumber)).toEqual([2, 4]);
  });
});
