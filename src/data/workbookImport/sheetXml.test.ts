import { describe, expect, it } from "vitest";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
describe("sheetXml", () => {
  const ss = parseSharedStrings('<sst><si><t>الاكتمال</t></si><si><t>مكتمل</t></si><si><t>a &amp; b</t></si></sst>');
  it("decodes shared strings", () => expect(ss).toEqual(["الاكتمال", "مكتمل", "a & b"]));
  it("reads rows by header", () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>n</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>46023</v></c></row></sheetData></worksheet>';
    expect(rowsByHeader(parseSheetRows(xml, ss))).toEqual([{ "الاكتمال": "مكتمل", n: "46023" }]);
  });
});
