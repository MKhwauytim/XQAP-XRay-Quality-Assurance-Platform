export type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

export async function readZipDirectory(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailLen = Math.min(file.size, 66_000);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("XQ-WB-ZIP: not a zip/xlsx file");
  const count = u16(tail, eocd + 10);
  const dirSize = u32(tail, eocd + 12);
  const dirOffset = u32(tail, eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error("XQ-WB-ZIP: zip64 not supported");
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) throw new Error("XQ-WB-ZIP: corrupt central directory");
    const nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    out.set(name, { name, method: u16(dir, p + 10), compressedSize: u32(dir, p + 20), localOffset: u32(dir, p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function readZipEntryText(file: Blob, entry: ZipEntry): Promise<string> {
  const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (u32(head, 0) !== 0x04034b50) throw new Error("XQ-WB-ZIP: bad local header");
  const start = entry.localOffset + 30 + u16(head, 26) + u16(head, 28);
  const body = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return body.text();
  if (entry.method !== 8) throw new Error(`XQ-WB-ZIP: unsupported method ${entry.method}`);
  const stream = body.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
