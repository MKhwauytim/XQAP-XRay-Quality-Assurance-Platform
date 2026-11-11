/**
 * A minimal ZIP reader/writer for one job: rewriting a few parts of a large
 * `.xlsx` while every other part is copied byte for byte.
 *
 * Why not SheetJS: it re-serializes the workbook and drops what it does not
 * model (styles, charts, tables, the query table), so the exported file would
 * not be the owner's workbook any more. Here an untouched part keeps its
 * original compressed bytes, and only a replaced part is deflated again.
 *
 * Inflate and deflate use the browser's native `DecompressionStream` /
 * `CompressionStream` ("deflate-raw"; Chromium, and Node 22 for tests). The
 * source is a `Blob`, read by slices, so an 86 MB workbook on disk is never
 * loaded whole.
 *
 * Not supported, and refused with an error rather than mis-read: ZIP64,
 * encryption, and any compression method other than stored (0) or deflate (8).
 */

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  time: number;
  date: number;
  externalAttrs: number;
};

export type ZipArchive = {
  source: Blob;
  entries: ZipEntry[];
  byName: Map<string, ZipEntry>;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_UINT32 = 0xffffffff;

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export async function openZip(source: Blob): Promise<ZipArchive> {
  // The end-of-central-directory record is the last 22 bytes plus an optional comment (max 65535).
  const tailStart = Math.max(0, source.size - (22 + 0xffff));
  const tail = await readBytes(source, tailStart, source.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = tail.length - 22;
  while (eocd >= 0 && tailView.getUint32(eocd, true) !== EOCD_SIGNATURE) eocd -= 1;
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const count = tailView.getUint16(eocd + 10, true);
  const directorySize = tailView.getUint32(eocd + 12, true);
  const directoryOffset = tailView.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === MAX_UINT32) throw new Error("zip: ZIP64 is not supported");

  const directory = await readBytes(source, directoryOffset, directoryOffset + directorySize);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error("zip: bad central directory record");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    if (flags & 0x1) throw new Error("zip: encrypted entries are not supported");
    if (method !== 0 && method !== 8) throw new Error(`zip: unsupported compression method ${method}`);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      name: decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)),
      method,
      flags,
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      externalAttrs: view.getUint32(at + 38, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { source, entries, byName: new Map(entries.map((entry) => [entry.name, entry])) };
}

/** The entry's compressed bytes, as a lazy slice of the source. */
async function compressedData(archive: ZipArchive, entry: ZipEntry): Promise<Blob> {
  const header = await readBytes(archive.source, entry.localOffset, entry.localOffset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(`zip: bad local header for ${entry.name}`);
  const start = entry.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  return archive.source.slice(start, start + entry.compressedSize);
}

function requireEntry(archive: ZipArchive, name: string): ZipEntry {
  const entry = archive.byName.get(name);
  if (!entry) throw new Error(`zip: missing part ${name}`);
  return entry;
}

/** The entry's content as a stream of inflated bytes. */
export async function entryStream(archive: ZipArchive, name: string): Promise<ReadableStream<Uint8Array>> {
  const entry = requireEntry(archive, name);
  const data = await compressedData(archive, entry);
  const raw = data.stream() as ReadableStream<Uint8Array>;
  if (entry.method === 0) return raw;
  return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export async function entryBytes(archive: ZipArchive, name: string): Promise<Uint8Array> {
  return new Uint8Array(await new Response(await entryStream(archive, name)).arrayBuffer());
}

export async function entryText(archive: ZipArchive, name: string): Promise<string> {
  return new TextDecoder("utf-8").decode(await entryBytes(archive, name));
}

let crcTable: Uint32Array | null = null;

function crc32(chunks: readonly Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  const table = crcTable;
  let crc = MAX_UINT32;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ MAX_UINT32) >>> 0;
}

async function deflate(chunks: readonly Uint8Array[]): Promise<Blob> {
  const stream = (new Blob(chunks as unknown as BlobPart[]).stream() as ReadableStream<Uint8Array>).pipeThrough(
    new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  );
  return new Response(stream).blob();
}

function header(signature: number, length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

/**
 * A new archive with the same parts in the same order. A part named in
 * `replacements` gets the given content (as chunks, so a large sheet need not be
 * joined into one buffer first); every other part keeps its compressed bytes.
 */
export async function rebuildZip(
  archive: ZipArchive,
  replacements: ReadonlyMap<string, readonly Uint8Array[]>,
  type = "application/zip"
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of archive.entries) {
    const replacement = replacements.get(entry.name);
    let data: Blob;
    let crc = entry.crc;
    let size = entry.size;
    let method = entry.method;
    if (replacement) {
      data = await deflate(replacement);
      crc = crc32(replacement);
      size = replacement.reduce((sum, chunk) => sum + chunk.length, 0);
      method = 8;
    } else {
      data = await compressedData(archive, entry);
    }
    if (size >= MAX_UINT32 || data.size >= MAX_UINT32 || offset >= MAX_UINT32) {
      throw new Error("zip: the workbook is too large to write without ZIP64");
    }
    const name = encoder.encode(entry.name);
    // Keep only the UTF-8 name bit: sizes are in the header (no data descriptor).
    const flags = entry.flags & 0x800;

    const local = header(LOCAL_SIGNATURE, 30);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, flags, true);
    local.view.setUint16(8, method, true);
    local.view.setUint16(10, entry.time, true);
    local.view.setUint16(12, entry.date, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.size, true);
    local.view.setUint32(22, size, true);
    local.view.setUint16(26, name.length, true);

    const record = header(CENTRAL_SIGNATURE, 46);
    record.view.setUint16(4, 20, true);
    record.view.setUint16(6, 20, true);
    record.view.setUint16(8, flags, true);
    record.view.setUint16(10, method, true);
    record.view.setUint16(12, entry.time, true);
    record.view.setUint16(14, entry.date, true);
    record.view.setUint32(16, crc, true);
    record.view.setUint32(20, data.size, true);
    record.view.setUint32(24, size, true);
    record.view.setUint16(28, name.length, true);
    record.view.setUint32(38, entry.externalAttrs, true);
    record.view.setUint32(42, offset, true);
    central.push(record.bytes, name);

    parts.push(local.bytes as BlobPart, name as BlobPart, data);
    offset += 30 + name.length + data.size;
  }

  const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(EOCD_SIGNATURE, 22);
  end.view.setUint16(8, archive.entries.length, true);
  end.view.setUint16(10, archive.entries.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.bytes as BlobPart], { type });
}
