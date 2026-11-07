import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { FIXTURE_DATASET as def, FIXTURE_FILES as files } from "../__fixtures__/twoSlide";
import { parseCell, suggestTypes, typeDataset, typedRowSources } from "./typing";
import type { ColumnType } from "./types";

describe("parseCell", () => {
  it.each<[unknown, ColumnType, unknown]>([
    ["48,250", "number", 48250],
    ["85.5", "number", 85.5],
    ["٤٨٢٥٠", "number", 48250],
    ["2026-05-01", "date", "2026-05-01"],
    [45778, "date", "2025-05-01"],
    ["نعم", "boolean", true],
    ["لا", "boolean", false],
    ["1", "boolean", true],
    ["", "number", null],
    [null, "text", null],
  ])("parseCell(%s as %s) = %s", (raw, t, v) => {
    expect(parseCell(raw, t)).toEqual({ value: v });
  });

  it.each<[unknown, ColumnType]>([
    ["غير متوفر", "number"],
    ["12,5", "number"],
    ["31/02/2026", "date"],
    ["2026-02-31", "date"],
    ["ربما", "boolean"],
  ])("parseCell(%s as %s) is an explicit error, not zero", (raw, t) => {
    const c = parseCell(raw, t);
    expect(c.value).toBeNull();
    expect(c.error).toBeTruthy();
  });

  it("Arabic-Indic digits work in a date and extended digits in a number", () => {
    expect(parseCell("٢٠٢٦-٠٥-٠١", "date")).toEqual({ value: "2026-05-01" });
    expect(parseCell("١", "boolean")).toEqual({ value: true });
    expect(parseCell("۴۸۲۵۰", "number")).toEqual({ value: 48250 });
  });

  it("Arabic decimal and thousands separators parse in a number but not in text", () => {
    expect(parseCell("٤٨٬٢٥٠٫٥", "number")).toEqual({ value: 48250.5 });
    expect(parseCell("١٬٢", "text")).toEqual({ value: "1٬2" });
  });

  it("whitespace-only is null, a boolean given 2 is an error, beyond safe integer is an error", () => {
    expect(parseCell("   ", "number")).toEqual({ value: null });
    expect(parseCell(2, "boolean").error).toBeTruthy();
    expect(parseCell("9007199254740993", "number").error).toBeTruthy();
  });

  it("converts Arabic-Indic digits inside text to Latin", () => {
    expect(parseCell("١٢٣", "text")).toEqual({ value: "123" });
  });
});

describe("typeDataset", () => {
  it("types all 12 fixture rows and records the two number errors", () => {
    const { data, issues } = typeDataset(def, files);
    expect(issues).toEqual([]);
    expect(data.rows).toHaveLength(12);
    expect(data.errors).toEqual([
      { columnId: "count", row: 5, raw: "غير متوفر" },
      { columnId: "count", row: 6, raw: "12,5" },
    ]);
    expect(data.rows[0].count).toBe(100);
  });

  it("unknown header in a ColumnDecl is an issue with its path", () => {
    const d = structuredClone(def);
    d.columns[0].source.header = "غير موجود";
    expect(typeDataset(d, files).issues).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "datasets[0].columns[0].source.header" }),
    );
  });

  it("a listed file that was not uploaded is an issue with its path", () => {
    const d = structuredClone(def);
    d.files = ["missing.xlsx"];
    expect(typeDataset(d, files).issues).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "datasets[0].files[0]", detail: "missing.xlsx" }),
    );
  });

  it("a malformed bytesSha256 is rejected", () => {
    const f = structuredClone(files);
    f[0].bytesSha256 = "abc";
    expect(typeDataset(def, f).issues[0]).toMatchObject({
      rule: "schema.invalid",
      path: "datasets[0].files[0].bytesSha256",
    });
  });

  it("duplicate header names in one sheet are rejected with the sheet name", () => {
    const f = structuredClone(files);
    f[0].sheets[0].headers[1] = f[0].sheets[0].headers[0];
    const i = typeDataset(def, f).issues;
    expect(i[0].rule).toBe("schema.invalid");
    expect(i[0].detail).toContain("نتائج الدراسة");
  });

  it("rows over the limit give limit.rows, not a crash", () => {
    const f = structuredClone(files);
    f[0].sheets[0].rows.length = LIMITS.maxRowsPerDataset + 1;
    expect(typeDataset(def, f).issues.map((x) => x.rule)).toEqual(["limit.rows"]);
  });

  it("a virtual calc column (empty header) is not looked up and stays null", () => {
    const d = structuredClone(def);
    d.columns.push({
      source: { file: "studies.xlsx", sheet: "x", header: "" },
      id: "calc1", label: "c", type: "number", role: "measure", level: "quantitative",
    });
    const { data, issues } = typeDataset(d, files);
    expect(issues).toEqual([]);
    expect(data.rows[0].calc1).toBeNull();
  });
});

describe("typeDataset input scope and guards", () => {
  it("an unreferenced sheet with duplicate headers adds no rows and no issues", () => {
    const f = structuredClone(files);
    f[0].sheets.push({ sheetName: "notes", headers: ["a", "a"], rows: [["1", "2"], ["3", "4"]] });
    const { data, issues } = typeDataset(def, f);
    expect(issues).toEqual([]);
    expect(data.rows).toHaveLength(12);
  });

  it("leaves the input files untouched", () => {
    const before = structuredClone(files);
    typeDataset(def, files);
    expect(files).toEqual(before);
  });

  it("a duplicate uploaded fileName is an issue", () => {
    const f = [...structuredClone(files), ...structuredClone(files)];
    expect(typeDataset(def, f).issues).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "files[studies.xlsx]" }),
    );
  });
});

describe("suggestTypes", () => {
  it("picks number for a mostly numeric column", () => {
    const s = suggestTypes(files[0].sheets[0]);
    expect(s.find((x) => x.header === "العدد")).toMatchObject({
      type: "number", role: "measure", level: "quantitative",
    });
  });

  it("picks text for a text column and date for ISO dates", () => {
    const s = suggestTypes({
      sheetName: "s", headers: ["a", "b"],
      rows: [["x", "2026-05-01"], ["y", "2026-05-02"], ["z", ""]],
    });
    expect(s[0].type).toBe("text");
    expect(s[1]).toMatchObject({ type: "date", level: "temporal", role: "dimension" });
  });
});

describe("typedRowSources", () => {
  it("lists only the listed files' sheets some column reads", () => {
    const withNotes = [{ ...files[0], sheets: [...files[0].sheets, { sheetName: "notes", headers: ["n"], rows: [["x"]] }] }];
    expect(typedRowSources(def, withNotes)).toEqual([{ fileName: "studies.xlsx", sheetName: "نتائج الدراسة" }]);
    expect(typedRowSources({ ...def, files: [] }, withNotes)).toEqual([]);
  });
});
