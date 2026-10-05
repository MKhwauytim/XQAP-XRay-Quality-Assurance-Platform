export type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

/** V8's max string length is ~512 MiB and real sample sheets are ~30 MB. */
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;

/** Reject an entry whose declared decompressed size is over the cap, before inflating. */
export function assertEntrySize(entry: Pick<ZipEntry, "uncompressedSize">): void {
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) throw new Error("XQ-WB-ZIP: entry too large");
}

/** Pass-through stream that errors once more than `cap` bytes have flowed (guards a lying header). */
export function createSizeCapStream(cap: number = MAX_ENTRY_UNCOMPRESSED_BYTES): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > cap) throw new Error("XQ-WB-ZIP: entry too large");
      controller.enqueue(chunk);
    },
  });
}

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
  if (count === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) throw new Error("XQ-WB-ZIP: zip64 not supported");
  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  if (dir.byteLength !== dirSize) throw new Error("XQ-WB-ZIP: truncated central directory");
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) throw new Error("XQ-WB-ZIP: corrupt central directory");
    const nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32);
    if (p + 46 + nameLen + extraLen + commentLen > dir.byteLength) throw new Error("XQ-WB-ZIP: central directory shorter than declared");
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    const compressedSize = u32(dir, p + 20);
    const uncompressedSize = u32(dir, p + 24);
    const localOffset = u32(dir, p + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("XQ-WB-ZIP: zip64 not supported");
    out.set(name, { name, method: u16(dir, p + 10), compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (out.size !== count) throw new Error("XQ-WB-ZIP: central directory shorter than declared");
  return out;
}

export async function readZipEntryText(file: Blob, entry: ZipEntry): Promise<string> {
  assertEntrySize(entry);
  const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (head.byteLength !== 30) throw new Error("XQ-WB-ZIP: truncated entry");
  if (u32(head, 0) !== 0x04034b50) throw new Error("XQ-WB-ZIP: bad local header");
  const start = entry.localOffset + 30 + u16(head, 26) + u16(head, 28);
  const body = file.slice(start, start + entry.compressedSize);
  if (body.size !== entry.compressedSize) throw new Error("XQ-WB-ZIP: truncated entry");
  if (entry.method === 0) return body.text();
  if (entry.method !== 8) throw new Error(`XQ-WB-ZIP: unsupported method ${entry.method}`);
  try {
    const stream = body
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .pipeThrough(createSizeCapStream());
    return await new Response(stream).text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("XQ-WB-ZIP: entry too large")) throw err;
    throw new Error(
      `XQ-WB-ZIP: inflate failed (${err instanceof Error ? err.message : String(err)})`,
      { cause: err }
    );
  }
}
