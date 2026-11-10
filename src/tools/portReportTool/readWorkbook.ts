// Reads the raw report workbook in the browser without loading every sheet
// into memory: the zip is opened with JSZip and each needed sheet's XML is
// streamed row by row. The study sheet («نتائج الدراسة») comes back as rows of
// cell values; the year / quarter population sheets go straight into the
// shared workload aggregator. The Node script reads the same sheets through
// scripts/lib/workloadSheets.mjs; both feed workloadAggregate.ts.

import JSZip from "jszip";
import { STUDY_ID_COLS, STUDY_SHEET } from "../../data/reporting/portReport/portReportSource";
import { createWorkloadAggregator, isWorkloadSheet, orderWorkloadSheets } from "../../data/reporting/portReport/workloadAggregate";
import type { WorkloadRead } from "../../data/reporting/portReport/workloadAggregate";

export type WorkbookRead = { studyRows: unknown[][]; workload: WorkloadRead };
export type ReadProgress = (stage: string, done: number, total: number) => void;

const decode = (s: string): string =>
  s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/** «AB» → 28 (1-based column number). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const CELL = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>[\s\S]*?<\/f>|<f[^>]*\/>)?(?:<v>([\s\S]*?)<\/v>)?(?:<is>([\s\S]*?)<\/is>)?<\/c>)/g;

/** One row's cells as column letter → value: shared and inline strings as text, numbers as numbers. */
function parseRow(rowXml: string, strings: readonly string[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const c of rowXml.matchAll(CELL)) {
    const t = /\bt="([^"]+)"/.exec(c[2])?.[1];
    let v: unknown;
    if (t === "s") v = c[3] !== undefined ? strings[Number(c[3])] : undefined;
    else if (t === "inlineStr") v = c[4] !== undefined ? decode(c[4]) : undefined;
    else if (t === "str" || t === "e") v = c[3] !== undefined ? decode(c[3]) : undefined;
    else if (t === "b") v = c[3] === "1";
    else if (c[3] !== undefined) {
      const n = Number(c[3]);
      v = Number.isFinite(n) ? n : decode(c[3]);
    }
    if (v !== undefined) cells[c[1]] = v;
  }
  return cells;
}

/** JSZip's chunked reader; it exists at runtime but is missing from the bundled type definitions. */
type ChunkStream = {
  on(event: "data", cb: (chunk: string) => void): ChunkStream;
  on(event: "error", cb: (err: unknown) => void): ChunkStream;
  on(event: "end", cb: () => void): ChunkStream;
  resume(): ChunkStream;
};

/** Streams one zip entry's XML and calls `onRow` for every <row>…</row>. */
async function streamRows(file: JSZip.JSZipObject, strings: readonly string[], onRow: (cells: Record<string, unknown>) => void): Promise<void> {
  let buf = "";
  await new Promise<void>((resolve, reject) => {
    (file as unknown as { internalStream(type: "string"): ChunkStream })
      .internalStream("string")
      .on("data", (chunk: string) => {
        buf += chunk;
        let end: number;
        while ((end = buf.indexOf("</row>")) >= 0) {
          onRow(parseRow(buf.slice(0, end), strings));
          buf = buf.slice(end + 6);
        }
      })
      .on("error", reject)
      .on("end", () => resolve())
      .resume();
  });
}

/** Sheet name → zip path, in workbook order. */
async function sheetEntries(zip: JSZip): Promise<Array<[string, string]>> {
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) throw new Error("الملف ليس ملف Excel (.xlsx)");
  const target: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2].replace(/^\/?xl\//, "");
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => [decode(m[1]), `xl/${target[m[2]]}`]);
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(decode(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
  return out;
}

export async function readReportWorkbook(data: ArrayBuffer, progress: ReadProgress): Promise<WorkbookRead> {
  progress("فتح الملف", 0, 1);
  const zip = await JSZip.loadAsync(data);
  const sheets = await sheetEntries(zip);
  progress("قراءة النصوص", 0, 1);
  const strings = await sharedStrings(zip);

  const study = sheets.find(([n]) => n === STUDY_SHEET);
  if (!study) throw new Error(`الورقة «${STUDY_SHEET}» غير موجودة في الملف`);
  const workloadSheets = orderWorkloadSheets(sheets.filter(([n]) => isWorkloadSheet(n)), ([n]) => n);
  if (!workloadSheets.length) throw new Error("لا توجد أوراق المجتمع حسب السنة أو الربع (مثل 2024 أو 2025-Q1) في الملف");
  const total = workloadSheets.length + 1;

  progress(`قراءة «${STUDY_SHEET}»`, 0, total);
  const studyFile = zip.file(study[1]);
  if (!studyFile) throw new Error(`تعذرت قراءة «${STUDY_SHEET}»`);
  const studyRows: unknown[][] = [];
  await streamRows(studyFile, strings, (cells) => {
    const row: unknown[] = [];
    for (const [col, v] of Object.entries(cells)) row[columnIndex(col) - 1] = v;
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    studyRows.push(row);
  });

  // Studied image ids, so the population pass keeps their employee codes (study rows without codes are completed from it).
  const idCol = (studyRows[0] ?? []).findIndex((h) => STUDY_ID_COLS.includes(String(h ?? "").trim()));
  const codesFor = new Set<string>(idCol < 0 ? [] : studyRows.slice(1).map((r) => String(r[idCol] ?? "").trim()).filter(Boolean));
  const agg = createWorkloadAggregator({ codesFor });
  for (let i = 0; i < workloadSheets.length; i++) {
    const [name, path] = workloadSheets[i];
    progress(`قراءة ورقة ${name}`, i + 1, total);
    const f = zip.file(path);
    if (!f) continue;
    agg.startSheet(name);
    await streamRows(f, strings, (cells) => agg.row(cells));
  }
  progress("اكتملت القراءة", total, total);
  return { studyRows, workload: agg.result() };
}
