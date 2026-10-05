import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readZipDirectory, readZipEntryText } from "./zipReader";

function xlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], ["1", "2"]]), "S");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([buf]);
}
describe("zipReader", () => {
  it("lists and inflates entries", async () => {
    const f = xlsxBlob();
    const dir = await readZipDirectory(f);
    expect(dir.has("xl/workbook.xml")).toBe(true);
    const xml = await readZipEntryText(f, dir.get("xl/workbook.xml")!);
    expect(xml).toContain('name="S"');
  });
  it("rejects non-zip", async () => {
    await expect(readZipDirectory(new Blob(["nope"]))).rejects.toThrow("XQ-WB-ZIP");
  });
});
