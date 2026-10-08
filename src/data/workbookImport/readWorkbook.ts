import { readZipDirectory, readZipEntryText, type ZipEntry } from "./zipReader";
import { forEachSheetRow, parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
import { createPopulationFold } from "./populationSummary";
import type { PopulationSummary } from "../reporting/executiveReportTypes";
import { canonicalHeader, mapSampleRow, newMappingReport, type MappedWorkbookRow, type MappingReport } from "./workbookColumnMap";

const REQUIRED = ["معرف الأشعة", "الشهر", "نتيجة المستوى الأول", "نتيجة المستوى الثاني", "الاكتمال"];
/** `Q1_Sample` (merged layout) or `SJAN`…`SDEC` (examined-sample layout). */
const SAMPLE_SHEET = /^(?:Q\d_Sample|S(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))$/;
/** The follow-up workbook («متابعة أعمال الفحص»): one answered sheet per month, `1-Jan`…`12-Dec`. */
const FOLLOW_UP_SHEET = /^\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
/** The monthly population sheets of the examined-sample workbook: `JAN`…`DEC`. */
const POPULATION_SHEET = /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/;
const IMAGE_STATUSES = new Set(["نعم", "لا", "معرف غير صحيح", "لا يوجد صورة", "سرت سكان"]);
/** Key under which the follow-up sheet's own expert verdict is carried (never overrides the sample workbook's). */
const FOLLOW_UP_VERDICT = "نتيجة صحة المتابعة";
/**
 * The expert-answer columns the examined-sample workbook does not carry; they are
 * taken from the follow-up workbook by image id. Canonical names (see HEADER_ALIASES).
 */
export const FOLLOW_UP_FIELDS = [
  "هل يوجد صورة؟", "هل يوجد تحديد؟", "مستوى جودة الصورة", "أسباب انخفاض الجودة",
  "تقييم الاشتباه", "الاصناف المشبوهة", "الية التهريب المحتملة", "الملاحظات العامة",
] as const;

type SheetRef = { name: string; path: string };
type OpenWorkbook = { file: Blob; dir: Map<string, ZipEntry>; sheets: SheetRef[]; need: (n: string) => ZipEntry };

async function openWorkbook(file: Blob, pick: RegExp): Promise<OpenWorkbook> {
  const dir = await readZipDirectory(file);
  const need = (n: string) => { const e = dir.get(n); if (!e) throw new Error(`XQ-WB-ZIP: missing ${n}`); return e; };
  const wbXml = await readZipEntryText(file, need("xl/workbook.xml"));
  const relXml = await readZipEntryText(file, need("xl/_rels/workbook.xml.rels"));
  const target = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets: SheetRef[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const path = rid ? target.get(rid) : undefined;
    if (name && path && pick.test(name)) sheets.push({ name, path });
  }
  return { file, dir, sheets, need };
}

async function sharedStringsOf(wb: OpenWorkbook): Promise<string[]> {
  const ssEntry = wb.dir.get("xl/sharedStrings.xml");
  return ssEntry ? parseSharedStrings(await readZipEntryText(wb.file, ssEntry)) : [];
}

/** image id → the follow-up answer fields (non-blank only), merged across the follow-up sheets. */
export type FollowUpIndex = Map<string, Record<string, string>>;

async function readFollowUp(wb: OpenWorkbook, report: MappingReport): Promise<FollowUpIndex> {
  const shared = await sharedStringsOf(wb);
  const index: FollowUpIndex = new Map();
  for (const { name, path } of wb.sheets) {
    const raw = parseSheetRows(await readZipEntryText(wb.file, wb.need(path)), shared);
    const hdr = Object.fromEntries(Object.entries(raw[0] ?? {}).map(([col, h]) => [col, canonicalHeader(h)]));
    const data = rowsByHeader([hdr, ...raw.slice(1)]);
    (report.followUpSheets ??= []).push({ name, rows: data.length });
    for (const cells of data) {
      const id = cells["معرف الأشعة"]?.trim();
      if (!id) continue;
      const rec = index.get(id) ?? {};
      for (const f of FOLLOW_UP_FIELDS) {
        const v = cells[f];
        // The follow-up sheets carry pivot tables beside the data whose header repeats «هل يوجد صورة؟»; only real statuses count.
        if (f === "هل يوجد صورة؟" && v !== undefined && !IMAGE_STATUSES.has(v.trim())) continue;
        if (v !== undefined && v.trim() !== "" && rec[f] === undefined) rec[f] = v;
      }
      const verdict = cells["صحة النتيجة"];
      if (verdict !== undefined && verdict.trim() !== "" && rec[FOLLOW_UP_VERDICT] === undefined) rec[FOLLOW_UP_VERDICT] = verdict;
      index.set(id, rec);
    }
  }
  return index;
}

/** Fill the sample row's blank answer columns from the follow-up index; the sample workbook's own values always win. */
function withFollowUp(cells: Record<string, string>, index: FollowUpIndex | null, report: MappingReport): Record<string, string> {
  if (!index) return cells;
  const rec = index.get((cells["معرف الأشعة"] ?? "").trim());
  if (!rec) { report.followUpUnmatched = (report.followUpUnmatched ?? 0) + 1; return cells; }
  report.followUpMatched = (report.followUpMatched ?? 0) + 1;
  const out = { ...cells };
  for (const f of FOLLOW_UP_FIELDS) {
    if ((out[f] ?? "").trim() === "" && rec[f] !== undefined) out[f] = rec[f];
  }
  if ((out["صحة النتيجة"] ?? "").trim() === "" && rec[FOLLOW_UP_VERDICT] !== undefined) out["صحة النتيجة"] = rec[FOLLOW_UP_VERDICT];
  return out;
}

/** Folds every population sheet into totals (rows are never retained). January's results are numeric codes. */
async function readPopulation(
  wb: OpenWorkbook,
  shared: string[],
  onProgress?: (p: { sheet: string; done: number; total: number }) => void,
): Promise<PopulationSummary> {
  const fold = createPopulationFold();
  const sheets: Array<{ name: string; rows: number }> = [];
  for (let i = 0; i < wb.sheets.length; i++) {
    const { name, path } = wb.sheets[i];
    onProgress?.({ sheet: name, done: i, total: wb.sheets.length });
    const xml = await readZipEntryText(wb.file, wb.need(path));
    let header: Record<string, string> = {};
    let rows = 0;
    forEachSheetRow(xml, shared, (rec, index) => {
      if (index === 0) {
        header = Object.fromEntries(Object.entries(rec).map(([col, h]) => [col, canonicalHeader(h)]));
        return;
      }
      const cells: Record<string, string> = {};
      for (const [col, h] of Object.entries(header)) if (rec[col] !== undefined && h !== "__proto__") cells[h] = rec[col];
      rows++;
      fold.add(cells, name === "JAN");
    });
    sheets.push({ name, rows });
  }
  return fold.finish(sheets);
}

export async function readComprehensiveWorkbook(
  file: Blob,
  onProgress?: (p: { sheet: string; done: number; total: number }) => void,
): Promise<{ rows: MappedWorkbookRow[]; report: MappingReport; populationSummary: PopulationSummary | null }> {
  return readComprehensiveWorkbooks([file], onProgress);
}

/**
 * Reads the examined-sample workbook and, when one of `files` is the follow-up
 * workbook (`1-Jan`…`12-Dec` sheets), enriches each sample row with the answer
 * columns the sample workbook lacks (image availability, marking, quality…).
 * Files are told apart by their sheet names, so the user just picks both.
 */
export async function readComprehensiveWorkbooks(
  files: Blob[],
  onProgress?: (p: { sheet: string; done: number; total: number }) => void,
  /** The report page needs both workbooks: reject when the follow-up workbook («متابعة أعمال الفحص») is missing. */
  opts: { requireFollowUp?: boolean } = {},
): Promise<{ rows: MappedWorkbookRow[]; report: MappingReport; populationSummary: PopulationSummary | null }> {
  const report = newMappingReport();
  let primary: OpenWorkbook | null = null;
  let followUpWb: OpenWorkbook | null = null;
  for (const f of files) {
    const sample = await openWorkbook(f, SAMPLE_SHEET);
    if (sample.sheets.length > 0) { primary ??= sample; continue; }
    const fu = await openWorkbook(f, FOLLOW_UP_SHEET);
    if (fu.sheets.length > 0) followUpWb ??= fu;
  }
  if (!primary) throw new Error("XQ-WB-NOSAMPLE: no sample sheet found (Q*_Sample or S<MON>)");
  if (opts.requireFollowUp && !followUpWb) throw new Error("XQ-WB-NOFOLLOWUP: the follow-up workbook (1-Jan…12-Dec sheets) was not provided");
  const followUp = followUpWb ? await readFollowUp(followUpWb, report) : null;
  const sheets = primary.sheets;
  const shared = await sharedStringsOf(primary);
  const rows: MappedWorkbookRow[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const { name, path } = sheets[i];
    onProgress?.({ sheet: name, done: i, total: sheets.length });
    const raw = parseSheetRows(await readZipEntryText(primary.file, primary.need(path)), shared);
    const hdr = Object.fromEntries(Object.entries(raw[0] ?? {}).map(([col, h]) => [col, canonicalHeader(h)]));
    const headers = new Set(Object.values(hdr));
    // No «الاكتمال» column: the sheet lists examined samples only, so each row is a completed sample.
    const examined = !headers.has("الاكتمال") && Object.values(raw[0] ?? {}).includes("شهر الفحص");
    const missing = REQUIRED.filter((h) => !headers.has(h) && !(examined && h === "الاكتمال"));
    if (missing.length) throw new Error(`XQ-WB-COLUMNS: ${name} missing ${missing.join("، ")}`);
    const data = rowsByHeader([hdr, ...raw.slice(1)]);
    report.sheetsRead.push({ name, rows: data.length });
    for (const cells of data) { const m = mapSampleRow(withFollowUp(cells, followUp, report), name, report, { examined }); if (m) rows.push(m); }
  }
  // The same workbook also carries the risk population (JAN…DEC) the samples were drawn from.
  const popWb = await openWorkbook(primary.file, POPULATION_SHEET);
  const populationSummary = popWb.sheets.length > 0 ? await readPopulation(popWb, shared, onProgress) : null;
  onProgress?.({ sheet: "", done: sheets.length, total: sheets.length });
  return { rows, report, populationSummary };
}
