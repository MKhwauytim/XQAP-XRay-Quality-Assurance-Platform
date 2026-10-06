import { readZipDirectory, readZipEntryText } from "./zipReader";
import { parseSharedStrings, parseSheetRows, rowsByHeader } from "./sheetXml";
import { mapSampleRow, newMappingReport, type MappedWorkbookRow, type MappingReport } from "./workbookColumnMap";

const REQUIRED = ["معرف الأشعة", "الشهر", "نتيجة المستوى الأول", "نتيجة المستوى الثاني", "الاكتمال"];
const SAMPLE_SHEET = /^Q\d_Sample$/;

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
  if (sheets.length === 0) throw new Error("XQ-WB-NOSAMPLE: no Q*_Sample sheet found");
  const ssEntry = dir.get("xl/sharedStrings.xml");
  const shared = ssEntry ? parseSharedStrings(await readZipEntryText(file, ssEntry)) : [];
  const report = newMappingReport();
  const rows: MappedWorkbookRow[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const { name, path } = sheets[i];
    onProgress?.({ sheet: name, done: i, total: sheets.length });
    const raw = parseSheetRows(await readZipEntryText(file, need(path)), shared);
    const headers = new Set(Object.values(raw[0] ?? {}));
    const missing = REQUIRED.filter((h) => !headers.has(h));
    if (missing.length) throw new Error(`XQ-WB-COLUMNS: ${name} missing ${missing.join("، ")}`);
    const data = rowsByHeader(raw);
    report.sheetsRead.push({ name, rows: data.length });
    for (const cells of data) { const m = mapSampleRow(cells, name, report); if (m) rows.push(m); }
  }
  onProgress?.({ sheet: "", done: sheets.length, total: sheets.length });
  return { rows, report };
}
