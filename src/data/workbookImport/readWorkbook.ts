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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Exam month (1–12) from a sheet name: `SFEB` / `FEB` (sample sheets) or `2-Feb` (follow-up sheets); null otherwise. */
function examMonthOfSheet(name: string | undefined): number | null {
  const s = (name ?? "").trim().toUpperCase();
  const lead = /^(\d{1,2})-/.exec(s);
  if (lead) return Number(lead[1]);
  const i = MONTHS.indexOf(s.replace(/^S/, ""));
  return i >= 0 ? i + 1 : null;
}

/**
 * One enrichment record for an image: the answer fields (non-blank only) from one row of an enrichment
 * workbook, the exam month that row belongs to, and whether it says the image exists («هل يوجد صورة؟» = نعم).
 */
type FollowUpRecord = { fields: Record<string, string>; month: number | null; imageYes: boolean };
/** image id → every enrichment record for it, across all enrichment workbooks and sheets, in reading order. */
export type FollowUpIndex = Map<string, FollowUpRecord[]>;

async function readFollowUp(wb: OpenWorkbook, report: MappingReport, index: FollowUpIndex): Promise<void> {
  const shared = await sharedStringsOf(wb);
  for (const { name, path } of wb.sheets) {
    const raw = parseSheetRows(await readZipEntryText(wb.file, wb.need(path)), shared);
    const hdr = Object.fromEntries(Object.entries(raw[0] ?? {}).map(([col, h]) => [col, canonicalHeader(h)]));
    const data = rowsByHeader([hdr, ...raw.slice(1)]);
    (report.followUpSheets ??= []).push({ name, rows: data.length });
    const sheetMonth = examMonthOfSheet(name);
    for (const cells of data) {
      const id = cells["معرف الأشعة"]?.trim();
      if (!id) continue;
      const fields: Record<string, string> = {};
      for (const f of FOLLOW_UP_FIELDS) {
        const v = cells[f];
        // The follow-up sheets carry pivot tables beside the data whose header repeats «هل يوجد صورة؟»; only real statuses count.
        if (f === "هل يوجد صورة؟" && v !== undefined && !IMAGE_STATUSES.has(v.trim())) continue;
        if (v !== undefined && v.trim() !== "") fields[f] = v;
      }
      const verdict = cells["صحة النتيجة"];
      if (verdict !== undefined && verdict.trim() !== "") fields[FOLLOW_UP_VERDICT] = verdict;
      if (Object.keys(fields).length === 0) continue;
      // `Q*_Sample` rows name the sample sheet they came from («الشيت المصدر» = SFEB…), which is the exam month.
      const month = sheetMonth ?? examMonthOfSheet(cells["الشيت المصدر"]);
      const list = index.get(id) ?? [];
      list.push({ fields, month, imageYes: (fields["هل يوجد صورة؟"] ?? "").trim() === "نعم" });
      index.set(id, list);
    }
  }
}

/**
 * The one record an image's answers are taken from. An image can appear 3–4 times across the enrichment
 * workbooks; the owner's rule is: take the record that says the image exists («نعم»), from the same exam
 * month as the sample row. Ranking: نعم + same month › نعم › same month › first seen. Fields are never mixed
 * across records, so a «لا» row cannot leak its answers into a «نعم» row's.
 */
function pickRecord(list: FollowUpRecord[], month: number | null, report: MappingReport): FollowUpRecord {
  const sameMonth = (r: FollowUpRecord) => month !== null && r.month === month;
  const best = list.find((r) => r.imageYes && sameMonth(r)) ?? list.find((r) => r.imageYes) ?? list.find(sameMonth) ?? list[0];
  if (list.length > 1) report.followUpMultiple = (report.followUpMultiple ?? 0) + 1;
  if (month !== null && best.month !== null && best.month !== month) report.followUpOtherMonth = (report.followUpOtherMonth ?? 0) + 1;
  return best;
}

/** Fill the sample row's blank answer columns from its chosen enrichment record; the sample workbook's own values always win. */
function withFollowUp(cells: Record<string, string>, index: FollowUpIndex | null, report: MappingReport, sampleMonth: number | null): Record<string, string> {
  if (!index) return cells;
  const list = index.get((cells["معرف الأشعة"] ?? "").trim());
  if (!list || list.length === 0) { report.followUpUnmatched = (report.followUpUnmatched ?? 0) + 1; return cells; }
  report.followUpMatched = (report.followUpMatched ?? 0) + 1;
  const rec = pickRecord(list, sampleMonth, report).fields;
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
  // The report's rows come ONLY from the examined-sample workbook («بناءً على فترة العينة», S<MON> sheets).
  // Every other workbook only enriches those rows by image id: the follow-up workbook (1-Jan…12-Dec) and the
  // merged workbook («بعد التعديل», Q*_Sample). A Q*_Sample workbook is the primary only when no S<MON> one was given.
  const examinedWbs: OpenWorkbook[] = [];
  const merged: OpenWorkbook[] = [];
  const enrichment: OpenWorkbook[] = [];
  for (const f of files) {
    const sample = await openWorkbook(f, SAMPLE_SHEET);
    if (sample.sheets.some((s) => s.name.startsWith("S"))) { examinedWbs.push(sample); continue; }
    if (sample.sheets.length > 0) { merged.push(sample); continue; }
    const fu = await openWorkbook(f, FOLLOW_UP_SHEET);
    if (fu.sheets.length > 0) enrichment.push(fu);
  }
  const primary = examinedWbs[0] ?? merged[0] ?? null;
  if (!primary) throw new Error("XQ-WB-NOSAMPLE: no sample sheet found (Q*_Sample or S<MON>)");
  enrichment.push(...examinedWbs.slice(1), ...merged.filter((wb) => wb !== primary));
  if (opts.requireFollowUp && enrichment.length === 0) throw new Error("XQ-WB-NOFOLLOWUP: the follow-up workbook (1-Jan…12-Dec sheets) was not provided");
  let followUp: FollowUpIndex | null = null;
  if (enrichment.length > 0) {
    followUp = new Map();
    for (const wb of enrichment) await readFollowUp(wb, report, followUp);
  }
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
    const sheetMonth = examMonthOfSheet(name);
    for (const cells of data) {
      // Exam month: the S<MON> sheet, else the row's bare month number («شهر الفحص»).
      const raw = (cells["الشهر"] ?? "").trim();
      const month = sheetMonth ?? (/^(?:[1-9]|1[0-2])$/.test(raw) ? Number(raw) : null);
      const m = mapSampleRow(withFollowUp(cells, followUp, report, month), name, report, { examined });
      if (m) rows.push(m);
    }
  }
  // The same workbook also carries the risk population (JAN…DEC) the samples were drawn from.
  const popWb = await openWorkbook(primary.file, POPULATION_SHEET);
  const populationSummary = popWb.sheets.length > 0 ? await readPopulation(popWb, shared, onProgress) : null;
  onProgress?.({ sheet: "", done: sheets.length, total: sheets.length });
  return { rows, report, populationSummary };
}
