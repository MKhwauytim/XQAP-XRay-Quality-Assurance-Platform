/**
 * Worksheet XML helpers for the strategic-indicator workbook: scan rows from a
 * streamed sheet without building a DOM, and build rows to append.
 *
 * The sheets involved are large (one is 228 MB of XML), so rows are cut out of
 * the stream by their `</row>` terminator and inspected with regular
 * expressions. Excel writes these sheets in one regular shape (`<row>` holding
 * `<c r=".." s=".." t="..">` cells), which is what this relies on.
 */

export type ParsedCell = {
  /** Column letters, e.g. "A", "AB". */
  column: string;
  /** Style index (`s`), kept as text. */
  style: string | null;
  /** Cell type (`t`): "s" shared string, "str" formula string, "inlineStr", … or null for a number. */
  type: string | null;
  /** Raw `<v>` text. For `t="s"` this is the shared-string index. */
  value: string | null;
  /** Formula text, XML-unescaped. */
  formula: string | null;
};

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

export function unescapeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (match, dec: string, hex: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return XML_ENTITIES[match] ?? match;
  });
}

export function escapeXml(text: string): string {
  // Control characters other than tab/newline are not legal in XML 1.0.
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetters(index: number): string {
  let out = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/** "A" → 0, "AA" → 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type CellRange = { startColumn: number; startRow: number; endColumn: number; endRow: number };

export function parseRange(ref: string): CellRange {
  const match = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  if (!match) throw new Error(`sheet: unsupported range ${ref}`);
  return {
    startColumn: columnIndex(match[1]),
    startRow: Number(match[2]),
    endColumn: columnIndex(match[3]),
    endRow: Number(match[4]),
  };
}

export function formatRange(range: CellRange): string {
  return `${columnLetters(range.startColumn)}${range.startRow}:${columnLetters(range.endColumn)}${range.endRow}`;
}

const CELL_PATTERN = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

export function parseRowCells(rowXml: string): ParsedCell[] {
  const cells: ParsedCell[] = [];
  for (const match of rowXml.matchAll(CELL_PATTERN)) {
    const attrs = match[2];
    const body = match[3] ?? "";
    const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
    const value = /<v>([\s\S]*?)<\/v>/.exec(body);
    const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
    cells.push({
      column: match[1],
      style: /\bs="(\d+)"/.exec(attrs)?.[1] ?? null,
      type: /\bt="([^"]+)"/.exec(attrs)?.[1] ?? null,
      value: value ? unescapeXml(value[1]) : inline ? unescapeXml(inline[1]) : null,
      formula: formula ? unescapeXml(formula[1]) : null,
    });
  }
  return cells;
}

/**
 * Calls `onRow` for every `<row>` in a streamed worksheet, in order.
 * `rowXml` is the whole element, `<row …>` to `</row>`.
 */
export async function scanSheetRows(
  stream: ReadableStream<Uint8Array>,
  onRow: (rowNumber: number, rowXml: string) => void
): Promise<void> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let buffer = "";
  const drain = () => {
    let from = 0;
    for (;;) {
      const end = buffer.indexOf("</row>", from);
      if (end < 0) break;
      const start = buffer.indexOf("<row ", from);
      if (start >= 0 && start < end) {
        const rowXml = buffer.slice(start, end + 6);
        const number = /^<row [^>]*?\br="(\d+)"/.exec(rowXml);
        if (number) onRow(Number(number[1]), rowXml);
      }
      from = end + 6;
    }
    buffer = buffer.slice(from);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }
  buffer += decoder.decode();
  drain();
}

/**
 * The strings at the given shared-string indexes. One pass over
 * `sharedStrings.xml`; strings that were not asked for are skipped, because the
 * table holds every distinct id in the workbook (about 1.9 million entries).
 */
export async function readSharedStrings(
  stream: ReadableStream<Uint8Array>,
  wanted: ReadonlySet<number>
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  const item = /<si\/>|<si>([\s\S]*?)<\/si>/g;
  let buffer = "";
  let index = 0;
  const drain = () => {
    item.lastIndex = 0;
    let consumed = 0;
    for (let match = item.exec(buffer); match; match = item.exec(buffer)) {
      if (wanted.has(index)) {
        let text = "";
        for (const piece of (match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += piece[1];
        out.set(index, unescapeXml(text));
      }
      index += 1;
      consumed = item.lastIndex;
    }
    buffer = buffer.slice(consumed);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }
  buffer += decoder.decode();
  drain();
  return out;
}

/** A value for one appended cell. `null` writes an empty, styled cell. */
export type CellInput =
  | null
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  /** `cached` is the value Excel shows until it recalculates; omit it when unknown. */
  | { kind: "formula"; formula: string; cached?: string | number };

/**
 * One `<row>` for appending under a table. Each cell takes its style from the
 * same column of `templateCells` (the table's last existing row), so the new
 * row is formatted like the rows above it.
 */
export function buildRowXml(
  rowNumber: number,
  startColumn: number,
  cells: readonly CellInput[],
  templateCells: readonly ParsedCell[]
): string {
  const styleByColumn = new Map(templateCells.map((cell) => [cell.column, cell.style]));
  let xml = `<row r="${rowNumber}">`;
  cells.forEach((cell, offset) => {
    const column = columnLetters(startColumn + offset);
    const style = styleByColumn.get(column);
    const head = `<c r="${column}${rowNumber}"${style ? ` s="${style}"` : ""}`;
    if (cell === null || (cell.kind === "text" && cell.value === "")) {
      xml += `${head}/>`;
    } else if (cell.kind === "number") {
      xml += `${head}><v>${cell.value}</v></c>`;
    } else if (cell.kind === "text") {
      xml += `${head} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
    } else {
      const formula = `<f>${escapeXml(cell.formula)}</f>`;
      if (cell.cached === undefined) xml += `${head}>${formula}</c>`;
      else if (typeof cell.cached === "number") xml += `${head}>${formula}<v>${cell.cached}</v></c>`;
      else xml += `${head} t="str">${formula}<v>${escapeXml(cell.cached)}</v></c>`;
    }
  });
  return `${xml}</row>`;
}

/** First index of `needle` in `haystack` at or after `from`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = Math.max(0, from); i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Last index of `needle` in `haystack`, or -1. */
export function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = haystack.length - needle.length; i >= 0; i -= 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * The sheet with `rows` (encoded `<row>` elements) appended to its `<sheetData>`
 * and its `<dimension>` grown to `lastRow`, returned as chunks so the (possibly
 * 200 MB) sheet is not copied into one new buffer.
 */
export function appendRowsToSheet(sheet: Uint8Array, rows: readonly Uint8Array[], lastRow: number): Uint8Array[] {
  const encoder = new TextEncoder();
  const close = lastIndexOfBytes(sheet, encoder.encode("</sheetData>"));
  if (close < 0) throw new Error("sheet: </sheetData> not found");

  const chunks: Uint8Array[] = [];
  let bodyStart = 0;
  const dimensionStart = indexOfBytes(sheet.subarray(0, Math.min(sheet.length, 8192)), encoder.encode("<dimension ref=\""));
  if (dimensionStart >= 0) {
    const valueStart = dimensionStart + 16;
    const valueEnd = sheet.indexOf(0x22, valueStart);
    const ref = new TextDecoder().decode(sheet.subarray(valueStart, valueEnd));
    const range = parseRange(ref.includes(":") ? ref : `${ref}:${ref}`);
    range.endRow = Math.max(range.endRow, lastRow);
    chunks.push(sheet.subarray(0, valueStart), encoder.encode(formatRange(range)));
    bodyStart = valueEnd;
  }
  chunks.push(sheet.subarray(bodyStart, close), ...rows, sheet.subarray(close));
  return chunks;
}

/** Excel serial date (1900 system) for a local wall-clock time. */
export function excelSerial(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const days = Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
  return days + (hour * 3600 + minute * 60 + second) / 86_400;
}
