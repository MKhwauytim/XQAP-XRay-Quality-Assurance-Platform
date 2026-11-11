/**
 * The strategic-indicator workbook («مؤشر معدل التغطية لتدقيق صور الأشعة»): read
 * what the owner's file already holds, and write the same file back with new
 * rows appended.
 *
 * The workbook is the owner's own model. `بطاقة العمل` is all formulas
 * (`COUNTIFS` over the tables below), so nothing here computes or rewrites the
 * card: rows are appended under the tables, the table ranges are grown, and
 * Excel recalculates on open. Styles, the chart, the query table and every
 * other part are copied unchanged (see `zipContainer.ts`).
 *
 * Tables this relies on, by name:
 *  - `Q1_` … `Q4_` (sheets Q1 … Q4): the population, one row per image, with
 *    `STAGE` and `Month` columns. Quarters start in December: Q1 holds months
 *    12, 1, 2; Q2 holds 3–5; Q3 holds 6–8; Q4 holds 9–11.
 *  - `Samples` (sheet «العينة»): one row per studied case.
 */
import {
  appendRowsToSheet,
  buildRowXml,
  columnLetters,
  formatRange,
  parseRange,
  parseRowCells,
  readSharedStrings,
  scanSheetRows,
  unescapeXml,
  type CellInput,
  type CellRange,
  type ParsedCell,
} from "./sheetXml";
import { entryBytes, entryStream, entryText, openZip, rebuildZip, type ZipArchive } from "./zipContainer";

export const INDICATOR_CARD_SHEET = "بطاقة العمل";
export const INDICATOR_SAMPLES_TABLE = "Samples";
export const INDICATOR_XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Column headers of the population tables. */
export const POPULATION_COLUMNS = {
  stage: "STAGE",
  imageId: "رقم صورة الاشعة",
  entryDate: "تاريخ دخول الاشعة",
  portType: "نوع المنفذ",
  portName: "اسم المنفذ",
  month: "Month",
  declarationNumber: "رقم البيان",
  declarationDate: "تاريخ البيان",
  plate: "رقم اللوحة \\ الحاوية",
  levelOne: "نتيجة المستوى الأول للاشعة",
  levelTwo: "نتيجة المستوى الثاني للاشعة",
} as const;

/** Column headers of the `Samples` table. */
export const SAMPLE_COLUMNS = {
  stage: "المستوى",
  imageId: "رقم صورة الاشعة",
  portType: "نوع المنفذ",
  portName: "اسم المنفذ",
  entryDate: "تاريخ ووقت دخول للاشعة",
  levelOne: "نتيجة المستوى الاول",
  levelTwo: "نتيجة المستوى الثاني",
  plate: "رقم اللوحة \\ الحاوية",
  completion: "الاكتمال",
  expert: "خبير الجودة",
  studiedAt: "تاريخ رصد الخبير",
  hasImage: "هل يوجد صورة ؟",
  hasMarking: "هل يوجد تحديد ؟",
  imageQuality: "مستوى جودة الصورة",
  lowQualityReason: "أسباب انخفاض الجودة",
  resultValidity: "صحة النتيجة",
  suspicionLevel: "تقييم الاشتباه",
  suspectedTypes: "الاصناف المشبوهة",
  smuggleMethod: "الية التهريب المحتملة",
  notes: "الملاحظات العامة",
  inIndicator: "هل مضمن في المؤشر؟",
  captureYear: "سنة التقاط الصورة",
  captureMonth: "شهر التقاط الصورة",
  studyMonth: "شهر دراسة الصورة",
} as const;

/** stage code → count. */
export type StageCounts = Record<string, number>;
/** month number (as text) → stage counts. */
export type MonthStageCounts = Record<string, StageCounts>;

export type IndicatorTable = {
  tableName: string;
  tablePath: string;
  sheetName: string;
  sheetPath: string;
  /** Header row is `range.startRow`; data ends at `range.endRow`. */
  range: CellRange;
  columns: string[];
  /** Cells of the last data row: the style and formula source for appended rows. */
  lastRowCells: ParsedCell[];
};

export type IndicatorBaseline = {
  fileName: string;
  sizeBytes: number;
  scannedAt: string;
  /** Index 0 = Q1 … index 3 = Q4. */
  populationTables: IndicatorTable[];
  samplesTable: IndicatorTable;
  population: MonthStageCounts;
  samples: MonthStageCounts;
  /** Image ids already in `Samples`, so a studied case is never appended twice. */
  sampleIds: string[];
  /** Fixed monthly targets read from the card (F7:F9): second, third, fourth level. */
  targets: { second: number; third: number; fourth: number };
  /** Data months that have a column block on the card. */
  cardMonths: number[];
};

export class IndicatorTemplateError extends Error {}

/** The population table (0-based quarter index) a data month belongs to. */
export function quarterIndexForMonth(month: number): number {
  return month === 12 ? 0 : Math.floor(month / 3);
}

function attr(xml: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? unescapeXml(match[1]) : null;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function relsPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

type SheetRef = { name: string; path: string };

async function listSheets(archive: ZipArchive): Promise<SheetRef[]> {
  const workbook = await entryText(archive, "xl/workbook.xml");
  const rels = await entryText(archive, "xl/_rels/workbook.xml.rels");
  const targetById = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (id && target) targetById.set(id, resolvePath("xl/workbook.xml", target));
  }
  const sheets: SheetRef[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(match[0], "name");
    const path = targetById.get(attr(match[0], "r:id") ?? "");
    if (name && path) sheets.push({ name, path });
  }
  return sheets;
}

type TableShell = Omit<IndicatorTable, "lastRowCells">;

async function listTables(archive: ZipArchive, sheets: readonly SheetRef[]): Promise<TableShell[]> {
  const tables: TableShell[] = [];
  for (const sheet of sheets) {
    const rels = relsPath(sheet.path);
    if (!archive.byName.has(rels)) continue;
    for (const match of (await entryText(archive, rels)).matchAll(/<Relationship\b[^>]*>/g)) {
      if (!(attr(match[0], "Type") ?? "").endsWith("/table")) continue;
      const tablePath = resolvePath(sheet.path, attr(match[0], "Target") ?? "");
      const xml = await entryText(archive, tablePath);
      const open = /<table\b[^>]*>/.exec(xml)?.[0] ?? "";
      const tableName = attr(open, "name");
      const ref = attr(open, "ref");
      if (!tableName || !ref) continue;
      const columns = [...xml.matchAll(/<tableColumn\b[^>]*>/g)].map((column) => attr(column[0], "name") ?? "");
      tables.push({ tableName, tablePath, sheetName: sheet.name, sheetPath: sheet.path, range: parseRange(ref), columns });
    }
  }
  return tables;
}

function requireColumns(table: TableShell, names: readonly string[]): void {
  const missing = names.filter((name) => !table.columns.includes(name));
  if (missing.length > 0) {
    throw new IndicatorTemplateError(`الجدول ${table.tableName} ينقصه الأعمدة: ${missing.join("، ")}`);
  }
}

function columnOf(table: TableShell, name: string): string {
  return columnLetters(table.range.startColumn + table.columns.indexOf(name));
}

/** Reads one column's cell out of a row: its type and raw value. */
function cellReader(column: string): (rowXml: string) => { type: string | null; value: string } | null {
  const pattern = new RegExp(
    `<c r="${column}\\d+"([^>]*)>(?:<f[^>]*>[^<]*</f>|<f[^>]*/>)?(?:<v>([^<]*)</v>|<is><t[^>]*>([^<]*)</t></is>)`
  );
  return (rowXml) => {
    const match = pattern.exec(rowXml);
    if (!match) return null;
    return { type: /\bt="([^"]+)"/.exec(match[1])?.[1] ?? null, value: match[2] ?? match[3] ?? "" };
  };
}

/** A cell value as text, or a pending shared-string index to resolve later. */
type Pending = { shared: number } | { text: string };

function pendingOf(cell: { type: string | null; value: string } | null): Pending {
  if (!cell) return { text: "" };
  return cell.type === "s" ? { shared: Number(cell.value) } : { text: unescapeXml(cell.value) };
}

const pendingKey = (value: Pending): string => ("shared" in value ? `#${value.shared}` : `=${value.text}`);

function resolveKey(key: string, strings: ReadonlyMap<number, string>): string {
  return key.startsWith("#") ? (strings.get(Number(key.slice(1))) ?? "") : key.slice(1);
}

type ScanResult = { lastRow: number; lastRowXml: string };

async function scanTableRows(
  archive: ZipArchive,
  table: TableShell,
  onDataRow: (rowXml: string) => void
): Promise<ScanResult> {
  const result: ScanResult = { lastRow: table.range.startRow, lastRowXml: "" };
  await scanSheetRows(await entryStream(archive, table.sheetPath), (rowNumber, rowXml) => {
    if (rowNumber <= table.range.startRow) return;
    onDataRow(rowXml);
    result.lastRow = rowNumber;
    result.lastRowXml = rowXml;
  });
  if (result.lastRow !== table.range.endRow) {
    throw new IndicatorTemplateError(
      `ورقة ${table.sheetName}: آخر صف بيانات (${result.lastRow}) لا يطابق نهاية الجدول ${table.tableName} (${table.range.endRow}).`
    );
  }
  return result;
}

function readCard(cardXml: string): Pick<IndicatorBaseline, "targets" | "cardMonths"> {
  const number = (cell: string): number | null => {
    const match = new RegExp(`<c r="${cell}"[^>]*>(?:<f[^>]*>[^<]*</f>)?<v>([^<]*)</v>`).exec(cardXml);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  // Row 1 holds the data-month keys; a month has a block when a formula refers to its key cell.
  const keyCells = new Set([...cardXml.matchAll(/\$([A-Z]{1,2})\$1\b/g)].map((match) => match[1]));
  const cardMonths = [...keyCells]
    .map((column) => number(`${column}1`))
    .filter((month): month is number => month !== null && month >= 1 && month <= 12);
  return {
    targets: { second: number("F7") ?? 2500, third: number("F8") ?? 1875, fourth: number("F9") ?? 1875 },
    cardMonths: [...new Set(cardMonths)],
  };
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toMonthStageCounts(counts: ReadonlyMap<string, number>, strings: ReadonlyMap<number, string>): MonthStageCounts {
  const out: MonthStageCounts = {};
  for (const [key, count] of counts) {
    const split = key.indexOf("|");
    const month = key.slice(0, split);
    const stage = resolveKey(key.slice(split + 1), strings);
    if (!month || !stage) continue;
    const byStage = (out[month] ??= {});
    byStage[stage] = (byStage[stage] ?? 0) + count;
  }
  return out;
}

function collectShared(keys: Iterable<string>, into: Set<number>, afterBar = false): void {
  for (const key of keys) {
    const value = afterBar ? key.slice(key.indexOf("|") + 1) : key;
    if (value.startsWith("#")) into.add(Number(value.slice(1)));
  }
}

/**
 * Reads an uploaded indicator workbook: finds its tables, counts the population
 * and the studied cases per month and level, and lists the studied image ids.
 * Throws `IndicatorTemplateError` (Arabic message) when the file is not this
 * workbook.
 */
export async function scanIndicatorWorkbook(
  file: Blob,
  fileName: string,
  onProgress?: (sheetName: string) => void
): Promise<IndicatorBaseline> {
  let archive: ZipArchive;
  try {
    archive = await openZip(file);
  } catch {
    throw new IndicatorTemplateError("الملف ليس ملف إكسل (xlsx) صالحاً.");
  }
  const sheets = await listSheets(archive);
  const tables = await listTables(archive, sheets);
  const card = sheets.find((sheet) => sheet.name === INDICATOR_CARD_SHEET);
  const samplesShell = tables.find((table) => table.tableName === INDICATOR_SAMPLES_TABLE);
  const populationShells = [1, 2, 3, 4].map((quarter) => tables.find((table) => table.tableName === `Q${quarter}_`));
  if (!card || !samplesShell || populationShells.some((table) => !table)) {
    throw new IndicatorTemplateError(
      "الملف ليس نموذج المؤشر: يجب أن يحتوي ورقة «بطاقة العمل» والجداول Q1_ و Q2_ و Q3_ و Q4_ و Samples."
    );
  }
  const populationTableShells = populationShells as TableShell[];
  for (const table of populationTableShells) requireColumns(table, [POPULATION_COLUMNS.stage, POPULATION_COLUMNS.month]);
  requireColumns(samplesShell, [SAMPLE_COLUMNS.stage, SAMPLE_COLUMNS.imageId, SAMPLE_COLUMNS.captureMonth]);

  const populationCounts = new Map<string, number>();
  const populationTables: IndicatorTable[] = [];
  for (const table of populationTableShells) {
    onProgress?.(table.sheetName);
    const stage = cellReader(columnOf(table, POPULATION_COLUMNS.stage));
    const month = cellReader(columnOf(table, POPULATION_COLUMNS.month));
    const scan = await scanTableRows(archive, table, (rowXml) => {
      bump(populationCounts, `${month(rowXml)?.value ?? ""}|${pendingKey(pendingOf(stage(rowXml)))}`);
    });
    populationTables.push({ ...table, lastRowCells: parseRowCells(scan.lastRowXml) });
  }

  onProgress?.(samplesShell.sheetName);
  const sampleCounts = new Map<string, number>();
  const sampleIdKeys = new Set<string>();
  const sampleStage = cellReader(columnOf(samplesShell, SAMPLE_COLUMNS.stage));
  const sampleMonth = cellReader(columnOf(samplesShell, SAMPLE_COLUMNS.captureMonth));
  const sampleId = cellReader(columnOf(samplesShell, SAMPLE_COLUMNS.imageId));
  const samplesScan = await scanTableRows(archive, samplesShell, (rowXml) => {
    bump(sampleCounts, `${sampleMonth(rowXml)?.value ?? ""}|${pendingKey(pendingOf(sampleStage(rowXml)))}`);
    sampleIdKeys.add(pendingKey(pendingOf(sampleId(rowXml))));
  });

  const wanted = new Set<number>();
  collectShared(populationCounts.keys(), wanted, true);
  collectShared(sampleCounts.keys(), wanted, true);
  collectShared(sampleIdKeys, wanted);
  const strings =
    wanted.size > 0 && archive.byName.has("xl/sharedStrings.xml")
      ? await readSharedStrings(await entryStream(archive, "xl/sharedStrings.xml"), wanted)
      : new Map<number, string>();

  return {
    fileName,
    sizeBytes: file.size,
    scannedAt: new Date().toISOString(),
    populationTables,
    samplesTable: { ...samplesShell, lastRowCells: parseRowCells(samplesScan.lastRowXml) },
    population: toMonthStageCounts(populationCounts, strings),
    samples: toMonthStageCounts(sampleCounts, strings),
    sampleIds: [...sampleIdKeys].map((key) => resolveKey(key, strings)).filter((id) => id !== ""),
    ...readCard(await entryText(archive, card.path)),
  };
}

/** Rows to append under one table. Each row maps a column header to its value. */
export type IndicatorAppend = {
  tableName: string;
  rows: ReadonlyArray<Readonly<Record<string, CellInput>>>;
};

const ROWS_PER_CHUNK = 2000;

function encodeRows(table: IndicatorTable, rows: IndicatorAppend["rows"]): Uint8Array[] {
  const encoder = new TextEncoder();
  const formulaByColumn = new Map(table.lastRowCells.map((cell) => [cell.column, cell.formula]));
  const chunks: Uint8Array[] = [];
  let xml = "";
  rows.forEach((row, index) => {
    const cells = table.columns.map((name, offset): CellInput => {
      const given = row[name] ?? null;
      const formula = formulaByColumn.get(columnLetters(table.range.startColumn + offset));
      // A calculated column keeps the table's own formula; a supplied value is only its cached result.
      if (!formula) return given;
      if (given?.kind === "number" || given?.kind === "text") return { kind: "formula", formula, cached: given.value };
      return { kind: "formula", formula };
    });
    xml += buildRowXml(table.range.endRow + 1 + index, table.range.startColumn, cells, table.lastRowCells);
    if ((index + 1) % ROWS_PER_CHUNK === 0) {
      chunks.push(encoder.encode(xml));
      xml = "";
    }
  });
  if (xml) chunks.push(encoder.encode(xml));
  return chunks;
}

/**
 * The owner's workbook with `appends` written under their tables. Everything
 * else in the file is unchanged; the workbook is flagged to recalculate when
 * Excel opens it, so the card's formulas pick the new rows up.
 */
export async function buildIndicatorWorkbook(
  file: Blob,
  baseline: IndicatorBaseline,
  appends: readonly IndicatorAppend[]
): Promise<Blob> {
  const archive = await openZip(file);
  const encoder = new TextEncoder();
  const replacements = new Map<string, Uint8Array[]>();
  const tables = [...baseline.populationTables, baseline.samplesTable];
  let workbook = await entryText(archive, "xl/workbook.xml");
  let workbookChanged = false;

  for (const append of appends) {
    if (append.rows.length === 0) continue;
    const table = tables.find((candidate) => candidate.tableName === append.tableName);
    if (!table) throw new IndicatorTemplateError(`الجدول ${append.tableName} غير موجود في النموذج.`);
    const oldRef = formatRange(table.range);
    const newRange: CellRange = { ...table.range, endRow: table.range.endRow + append.rows.length };
    const newRef = formatRange(newRange);

    const sheet = await entryBytes(archive, table.sheetPath);
    replacements.set(table.sheetPath, appendRowsToSheet(sheet, encodeRows(table, append.rows), newRange.endRow));

    const tableXml = (await entryText(archive, table.tablePath))
      .replace(/(<table\b[^>]*?\bref=")[^"]+(")/, `$1${newRef}$2`)
      .replace(/(<autoFilter\b[^>]*?\bref=")[^"]+(")/, `$1${newRef}$2`);
    replacements.set(table.tablePath, [encoder.encode(tableXml)]);

    // A query table's sheet range is also a defined name (`ExternalData_n`).
    const absolute = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
    if (workbook.includes(absolute(oldRef))) {
      workbook = workbook.split(absolute(oldRef)).join(absolute(newRef));
      workbookChanged = true;
    }
  }

  if (replacements.size > 0 && !/fullCalcOnLoad=/.test(workbook)) {
    workbook = /<calcPr\b/.test(workbook)
      ? workbook.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"')
      : workbook.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    workbookChanged = true;
  }
  if (workbookChanged) replacements.set("xl/workbook.xml", [encoder.encode(workbook)]);
  return rebuildZip(archive, replacements, INDICATOR_XLSX_TYPE);
}
