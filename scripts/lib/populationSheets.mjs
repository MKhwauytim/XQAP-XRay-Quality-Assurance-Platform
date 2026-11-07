// Streams the row-level population sheets of the report workbook and returns
// per-port, per-year image counts (total and «اشتباه»).
//
// Why streaming: «مجتمع منفذ جدة» alone is ~1M rows / ~700 MB of sheet XML,
// past V8's maximum string length, so SheetJS silently returns it empty. The
// .xlsx is unzipped with Windows' built-in `tar` (bsdtar reads zip) into a
// temp folder and each sheet is scanned row by row.
//
// Year: from «تاريخ دخول الاشعة» (an Excel serial date). Rows with no date
// fall back to the latest dated year in the same sheet — in the source those
// rows are all the final month of the period — and are counted in `undated`
// so the caller can say so.

import { copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const POPULATION_ROW_SHEETS = ["مجتمع المنافذ البرية", "مجتمع المنافذ البحرية", "مجتمع منفذ جدة"];

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

function sheetFiles(dir) {
  const wb = readFileSync(join(dir, "xl/workbook.xml"), "utf8");
  const rels = readFileSync(join(dir, "xl/_rels/workbook.xml.rels"), "utf8");
  const target = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2].replace(/^\/?xl\//, "");
  const out = {};
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) out[decode(m[1])] = join(dir, "xl", target[m[2]]);
  return out;
}

function scanSheet(file, strings) {
  return new Promise((resolve, reject) => {
    const counts = new Map();
    let header = null;
    let cols = null;
    let buf = "";
    let undated = 0;
    let maxYear = 0;
    const undatedKeys = new Map();
    const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 22 });
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      buf += chunk;
      let end;
      while ((end = buf.indexOf("</row>")) >= 0) {
        const row = buf.slice(0, end);
        buf = buf.slice(end + 6);
        const cells = {};
        for (const c of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>[\s\S]*?<\/f>)?(?:<v>([\s\S]*?)<\/v>)?(?:<is>([\s\S]*?)<\/is>)?<\/c>)/g)) {
          cells[c[1]] = / t="s"/.test(c[2]) ? strings[+c[3]] : c[4] !== undefined ? decode(c[4]) : c[3];
        }
        if (!header) {
          header = cells;
          const col = (h) => Object.keys(header).find((k) => header[k] === h);
          cols = { date: col("تاريخ دخول الاشعة"), port: col("المنفذ الموحد"), group: col("المجموعة") ?? col("نوع المنفذ"), result: col("نتيجة الصورة") };
          continue;
        }
        const port = cells[cols.port];
        if (!port) continue;
        const serial = Number(cells[cols.date]);
        const key = `${cells[cols.group] ?? ""}|${port}`;
        const susp = cells[cols.result] === "اشتباه" ? 1 : 0;
        if (serial > 0) {
          const year = new Date(Math.round((serial - 25569) * 864e5)).getUTCFullYear();
          maxYear = Math.max(maxYear, year);
          const k = `${key}|${year}`;
          const v = counts.get(k) ?? [0, 0];
          v[0] += 1;
          v[1] += susp;
          counts.set(k, v);
        } else {
          undated += 1;
          const v = undatedKeys.get(key) ?? [0, 0];
          v[0] += 1;
          v[1] += susp;
          undatedKeys.set(key, v);
        }
      }
    });
    stream.on("end", () => {
      for (const [key, [t, s]] of undatedKeys) {
        const k = `${key}|${maxYear}`;
        const v = counts.get(k) ?? [0, 0];
        v[0] += t;
        v[1] += s;
        counts.set(k, v);
      }
      resolve({ counts, undated, fallbackYear: maxYear });
    });
  });
}

/**
 * @returns {Promise<{ rows: Array<{port:string, group:string, year:number, total:number, suspicion:number}>, undated: Record<string, {rows:number, year:number}> } | null>}
 *          null when the workbook has none of the population sheets.
 */
export async function readPopulationByYear(workbookPath) {
  const dir = mkdtempSync(join(tmpdir(), "port-report-"));
  try {
    // Windows' own bsdtar reads zip; Git Bash's GNU tar (often first on PATH) does not.
    const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    // bsdtar on Windows cannot open a non-ASCII path (Arabic file names), so extract from an ASCII-named copy.
    const src = join(dir, "source.xlsx");
    copyFileSync(workbookPath, src);
    execFileSync(existsSync(winTar) ? winTar : "tar", ["-xf", src, "-C", dir, "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets"]);
    const files = sheetFiles(dir);
    const present = POPULATION_ROW_SHEETS.filter((n) => files[n]);
    if (!present.length) return null;
    const strings = [];
    for (const m of readFileSync(join(dir, "xl/sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push(decode(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
    }
    const rows = [];
    const undated = {};
    for (const name of present) {
      const { counts, undated: n, fallbackYear } = await scanSheet(files[name], strings);
      undated[name] = { rows: n, year: fallbackYear };
      for (const [k, [total, suspicion]] of counts) {
        const [group, port, year] = k.split("|");
        rows.push({ port, group, year: Number(year), total, suspicion });
      }
    }
    return { rows, undated };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
