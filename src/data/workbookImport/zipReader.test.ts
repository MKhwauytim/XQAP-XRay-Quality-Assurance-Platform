import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { MAX_ENTRY_UNCOMPRESSED_BYTES, assertEntrySize, createSizeCapStream, readZipDirectory, readZipEntryText } from "./zipReader";

function xlsxBlob(compression = false): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], ["1", "2"]]), "S");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", compression }) as ArrayBuffer;
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
  it("rejects truncated file (last 30 bytes cut)", async () => {
    const full = xlsxBlob();
    const truncated = full.slice(0, full.size - 30);
    await expect(readZipDirectory(truncated)).rejects.toThrow("XQ-WB-ZIP");
  });
  it("rejects truncated central directory", async () => {
    const full = xlsxBlob();
    const truncated = full.slice(0, full.size - 100);
    await expect(readZipDirectory(truncated)).rejects.toThrow("XQ-WB-ZIP");
  });
  it("rejects entry with truncated body", async () => {
    const full = xlsxBlob();
    const dir = await readZipDirectory(full);
    const entry = dir.get("xl/workbook.xml")!;
    const truncatedFile = full.slice(0, entry.localOffset + 40 + entry.compressedSize - 10);
    await expect(readZipEntryText(truncatedFile, entry)).rejects.toThrow("XQ-WB-ZIP");
  });
  it("rejects zip64 sentinel in entry compressedSize", async () => {
    const full = xlsxBlob();
    const buf = await full.arrayBuffer();
    const view = new Uint8Array(buf);
    const arr = Array.from(view);
    const zip64Buf = new Blob([new Uint8Array(arr)]);
    const dir = await readZipDirectory(zip64Buf);
    const entries = Array.from(dir.values());
    if (entries.length > 0) {
      const entry = entries[0];
      const fakeZip64Entry = { ...entry, compressedSize: 0xffffffff };
      await expect(readZipEntryText(full, fakeZip64Entry)).rejects.toThrow("XQ-WB-ZIP");
    }
  });
  it("assertEntrySize rejects a declared size over the cap and accepts the cap itself", () => {
    expect(() => assertEntrySize({ uncompressedSize: MAX_ENTRY_UNCOMPRESSED_BYTES + 1 })).toThrow("XQ-WB-ZIP: entry too large");
    expect(() => assertEntrySize({ uncompressedSize: MAX_ENTRY_UNCOMPRESSED_BYTES })).not.toThrow();
  });
  it("readZipEntryText rejects an entry declaring an oversize payload before inflating", async () => {
    const f = xlsxBlob();
    const entry = (await readZipDirectory(f)).get("xl/workbook.xml")!;
    expect(entry.uncompressedSize).toBeGreaterThan(0);
    await expect(
      readZipEntryText(f, { ...entry, uncompressedSize: MAX_ENTRY_UNCOMPRESSED_BYTES + 1 }),
    ).rejects.toThrow("XQ-WB-ZIP: entry too large");
  });
  it("surfaces corrupted deflate data as XQ-WB-ZIP: inflate failed", async () => {
    const f = xlsxBlob(true);
    const entry = (await readZipDirectory(f)).get("xl/workbook.xml")!;
    expect(entry.method).toBe(8);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const head = new DataView(bytes.buffer);
    const start = entry.localOffset + 30 + head.getUint16(entry.localOffset + 26, true) + head.getUint16(entry.localOffset + 28, true);
    bytes.fill(0xff, start, start + entry.compressedSize);
    await expect(readZipEntryText(new Blob([bytes]), entry)).rejects.toThrow("XQ-WB-ZIP: inflate failed");
  });
  it("size-cap stream errors once the actual bytes exceed the cap (lying header)", async () => {
    const src = new Blob([new Uint8Array(100)]).stream().pipeThrough(createSizeCapStream(50));
    await expect(new Response(src).text()).rejects.toThrow("XQ-WB-ZIP: entry too large");
    const ok = new Blob([new Uint8Array(50)]).stream().pipeThrough(createSizeCapStream(50));
    expect((await new Response(ok).text()).length).toBe(50);
  });
});
