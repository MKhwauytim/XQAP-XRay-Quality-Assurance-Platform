import { readZipDirectory, readZipEntryText } from "./zipReader";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
import { canonicalHeader, mapSampleRow, newMappingReport, type MappedWorkbookRow, type MappingReport } from "./workbookColumnMap";

const REQUIRED = ["معرف الأشعة", "الشهر", "نتيجة المستوى الأول", "نتيجة المستوى الثاني", "الاكتمال"];
/** `Q1_Sample` (merged layout) or `SJAN`…`SDEC` (examined-sample layout). */
const SAMPLE_SHEET = /^(?:Q\d_Sample|S(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))$/;

export async function readComprehensiveWorkbook(
  file: Blob,
  onProgress?: (p: { sheet: string; done: number; total: number }) => void,
): Promise<{ rows: MappedWorkbookRow[]; report: MappingReport }> {
  const dir = await readZipDirectory(file);
  const need = (n: string) => { const e = dir.get(n); if (!e) throw new Error(`XQ-WB-ZIP: missing ${n}`); return e; };
  const wbXml = await readZipEntryText(file, need("xl/workbook.xml"));
  const relXml = await readZipEntryText(file, need("xl/_rels/workbook.xml.rels"));
  const target = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const path = rid ? target.get(rid) : undefined;
    if (name && path && SAMPLE_SHEET.test(name)) sheets.push({ name, path });
  }
  if (sheets.length === 0) throw new Error("XQ-WB-NOSAMPLE: no sample sheet found (Q*_Sample or S<MON>)");
  const ssEntry = dir.get("xl/sharedStrings.xml");
  const shared = ssEntry ? parseSharedStrings(await readZipEntryText(file, ssEntry)) : [];
  const report = newMappingReport();
  const rows: MappedWorkbookRow[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const { name, path } = sheets[i];
    onProgress?.({ sheet: name, done: i, total: sheets.length });
    const raw = parseSheetRows(await readZipEntryText(file, need(path)), shared);
    const hdr = Object.fromEntries(Object.entries(raw[0] ?? {}).map(([col, h]) => [col, canonicalHeader(h)]));
    const headers = new Set(Object.values(hdr));
    // No «الاكتمال» column: the sheet lists examined samples only, so each row is a completed sample.
    const examined = !headers.has("الاكتمال") && Object.values(raw[0] ?? {}).includes("شهر الفحص");
    const missing = REQUIRED.filter((h) => !headers.has(h) && !(examined && h === "الاكتمال"));
    if (missing.length) throw new Error(`XQ-WB-COLUMNS: ${name} missing ${missing.join("، ")}`);
    const data = rowsByHeader([hdr, ...raw.slice(1)]);
    report.sheetsRead.push({ name, rows: data.length });
    for (const cells of data) { const m = mapSampleRow(cells, name, report, { examined }); if (m) rows.push(m); }
  }
  onProgress?.({ sheet: "", done: sheets.length, total: sheets.length });
  return { rows, report };
}
