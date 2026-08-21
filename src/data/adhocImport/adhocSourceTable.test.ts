import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { PASTE_SHEET_NAME } from "./adhocImportModel";
import {
  parsePastedTable,
  readWorkbookTablesFromBuffer,
} from "./adhocSourceTable";

function workbookBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parsePastedTable", () => {
  it("parses a CRLF paste and numbers the first data row 2", () => {
    const table = parsePastedTable("معرف\tالميناء\r\nA1\tبري\r\nA2\tبحري");

    expect(table.sheetName).toBe(PASTE_SHEET_NAME);
    expect(table.headers).toEqual(["معرف", "الميناء"]);
    expect(table.rows).toHaveLength(2);
    // Consistent with the workbook path, where the header occupies row 1.
    expect(table.rows.map((row) => row.sourceRowNumber)).toEqual([2, 3]);
    expect(table.rows[0].values).toEqual({ معرف: "A1", الميناء: "بري" });
  });

  it("handles lone CR line endings", () => {
    const table = parsePastedTable("h1\th2\rv1\tv2");

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].values).toEqual({ h1: "v1", h2: "v2" });
  });

  it("drops a trailing blank line without emitting a row for it", () => {
    const table = parsePastedTable("h1\th2\nA\tB\n");

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].sourceRowNumber).toBe(2);
  });

  it("skips an interior blank line but keeps line numbering intact", () => {
    const table = parsePastedTable("h1\nA\n\nB");

    expect(table.rows.map((row) => row.values.h1)).toEqual(["A", "B"]);
    // The blank line still occupies line 3 of the pasted text.
    expect(table.rows.map((row) => row.sourceRowNumber)).toEqual([2, 4]);
  });

  it("fills a ragged row's missing keys with null", () => {
    const table = parsePastedTable("h1\th2\th3\nA\tB");

    expect(table.rows[0].values).toEqual({ h1: "A", h2: "B", h3: null });
  });

  it("uniquifies duplicate headers the same way the workbook path does", () => {
    const table = parsePastedTable("id\tid\tid\n1\t2\t3");

    expect(table.headers).toEqual(["id", "id_2", "id_3"]);
    expect(table.rows[0].values).toEqual({ id: "1", id_2: "2", id_3: "3" });
  });

  it("parses a single-column paste", () => {
    const table = parsePastedTable("id\nA1\nA2\nA3");

    expect(table.headers).toEqual(["id"]);
    expect(table.rows.map((row) => row.values.id)).toEqual(["A1", "A2", "A3"]);
  });

  it("turns whitespace-only cells into null", () => {
    const table = parsePastedTable("h1\th2\nA\t   ");

    expect(table.rows[0].values).toEqual({ h1: "A", h2: null });
  });

  it("trims header names", () => {
    const table = parsePastedTable("  h1  \t h2\nA\tB");

    expect(table.headers).toEqual(["h1", "h2"]);
  });

  it("returns an empty table rather than throwing on blank input", () => {
    for (const input of ["", "   ", "\r\n\r\n"]) {
      const table = parsePastedTable(input);
      expect(table.headers).toEqual([]);
      expect(table.rows).toEqual([]);
    }
  });

  it("honors an explicit sheet name", () => {
    expect(parsePastedTable("h1\nA", "ورقة").sheetName).toBe("ورقة");
  });
});

describe("readWorkbookTablesFromBuffer", () => {
  it("reads headers and rows from every worksheet", () => {
    const tables = readWorkbookTablesFromBuffer(
      workbookBuffer({
        أول: [
          ["معرف", "الميناء"],
          ["A1", "بري"],
          ["A2", "بحري"],
        ],
        ثاني: [["x"], ["1"]],
      })
    );

    expect(tables.map((table) => table.sheetName)).toEqual(["أول", "ثاني"]);
    expect(tables[0].headers).toEqual(["معرف", "الميناء"]);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0].sourceRowNumber).toBe(2);
    expect(tables[0].rows[1].values.الميناء).toBe("بحري");
  });

  it("skips a worksheet that yields no rows", () => {
    const tables = readWorkbookTablesFromBuffer(
      workbookBuffer({
        فارغة: [["h1", "h2"]],
        بيانات: [["h1"], ["A"]],
      })
    );

    expect(tables.map((table) => table.sheetName)).toEqual(["بيانات"]);
  });

  it("omits a column that is blank in every data row", () => {
    const tables = readWorkbookTablesFromBuffer(
      workbookBuffer({
        Sheet1: [
          ["h1", "empty", "h3"],
          ["A", null, "C"],
          ["D", null, "F"],
        ],
      })
    );

    // Documented trade-off: an all-blank column is not offerable for mapping.
    expect(tables[0].headers).toEqual(["h1", "h3"]);
    expect(tables[0].rows[0].values).toEqual({ h1: "A", h3: "C" });
  });

  it("preserves a 16-digit numeric ID as a full digit string", () => {
    // Both exceed Number.MAX_SAFE_INTEGER, so SheetJS holds them as floats and
    // a naive String() would give exponential notation — silent ID corruption.
    const tables = readWorkbookTablesFromBuffer(
      workbookBuffer({
        Sheet1: [["معرف"], [9876543210123456], [12345678901234568]],
      })
    );

    for (const row of tables[0].rows) {
      const id = row.values["معرف"];
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^\d{16,}$/);
      expect(String(id)).not.toContain("e+");
    }
  });
});
