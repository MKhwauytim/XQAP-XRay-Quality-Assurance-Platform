import { describe, expect, it } from "vitest";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
describe("sheetXml", () => {
  const ss = parseSharedStrings('<sst><si><t>الاكتمال</t></si><si><t>مكتمل</t></si><si><t>a &amp; b</t></si></sst>');
  it("decodes shared strings", () => expect(ss).toEqual(["الاكتمال", "مكتمل", "a & b"]));
  it("reads rows by header", () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>n</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>46023</v></c></row></sheetData></worksheet>';
    expect(rowsByHeader(parseSheetRows(xml, ss))).toEqual([{ "الاكتمال": "مكتمل", n: "46023" }]);
  });
  const hdr = '<row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c><c r="B1" t="inlineStr"><is><t>k</t></is></c></row>';
  it("skips self-closing rows and cells", () => {
    const xml = `<sheetData>${hdr}<row r="2" spans="1:2"/><row r="3"><c r="A3"><v>7</v></c><c r="B3"/></row><row r="4"><c r="A4"><v>8</v></c></row></sheetData>`;
    expect(rowsByHeader(parseSheetRows(xml, []))).toEqual([{ h: "7" }, { h: "8" }]);
  });
  it("reads rich-text shared strings", () => {
    expect(parseSharedStrings('<sst><si><r><t>ab</t></r><r><t xml:space="preserve"> c</t></r></si></sst>')).toEqual(["ab c"]);
  });
  it("does not throw on malformed numeric entity", () => {
    expect(parseSharedStrings("<sst><si><t>x&#99999999;y</t></si></sst>")).toEqual(["x&#99999999;y"]);
  });
  it("leaves out-of-range shared index absent", () => {
    expect(parseSheetRows('<row r="1"><c r="A1" t="s"><v>9</v></c></row>', [])).toEqual([{}]);
  });
  it("never lets a __proto__ header set the prototype", () => {
    const rows = [{ A: "__proto__", B: "k" }, { A: "x", B: "y" }];
    const out = rowsByHeader(rows);
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype);
    expect(out).toEqual([{ k: "y" }]);
  });
});
