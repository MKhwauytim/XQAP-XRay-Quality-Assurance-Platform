// Streams the row-level population sheets of the «بيانات التقرير مختصر»
// workbook (one sheet per year / quarter) and returns per-port, per-month
// workload counts: images received, images carrying an employee code, days
// with images, and the distinct level-1 / level-2 employee codes.
//
// The column rules and the per-month counting live in
// src/data/reporting/portReport/workloadAggregate.ts, shared with the port
// report tool, which reads the same sheets in the browser.
// Uses Windows' bsdtar from an ASCII-named copy, as populationSheets.mjs does.

import { copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
function sheetFiles(dir) {
  const wb = readFileSync(join(dir, "xl/workbook.xml"), "utf8");
  const rels = readFileSync(join(dir, "xl/_rels/workbook.xml.rels"), "utf8");
  const target = {};
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target[m[1]] = m[2].replace(/^\/?xl\//, "");
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => [decode(m[1]), join(dir, "xl", target[m[2]])]);
}

function scanRows(file, strings, onRow) {
  return new Promise((resolve, reject) => {
    let buf = "";
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
          const v = / t="s"/.test(c[2]) ? strings[+c[3]] : c[4] !== undefined ? decode(c[4]) : c[3];
          if (v !== undefined) cells[c[1]] = v;
        }
        onRow(cells);
      }
    });
    stream.on("end", resolve);
  });
}

/**
 * @param {string} workbookPath
 * @param {() => { startSheet(name: string): void, row(cells: Record<string, unknown>): void, result(): unknown }} createAggregator
 *        createWorkloadAggregator from src/data/reporting/portReport/workloadAggregate.ts (loaded through Vite by the caller),
 *        which owns every column rule.
 * @returns {Promise<{ months: unknown[], sheets: unknown[] } | null>} null when the workbook has no year / quarter population sheets.
 */
export async function readWorkload(workbookPath, createAggregator) {
  const dir = mkdtempSync(join(tmpdir(), "port-workload-"));
  try {
    const src = join(dir, "source.xlsx");
    copyFileSync(workbookPath, src);
    const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(existsSync(winTar) ? winTar : "tar", ["-xf", src, "-C", dir, "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets"]);
    // 2024 is not part of the report: same rule as workloadAggregate.isWorkloadSheet.
    const sheets = sheetFiles(dir).filter(([n]) => /^(\d{4}(-Q\d)?|Q\dB|Q\dM\d{1,2})$/.test(n) && !(/^\d{4}/.test(n) && n.slice(0, 4) < "2025"));
    if (!sheets.length) return null;
    // Oldest first, Q4B last, so a duplicate keeps the row from its own period sheet.
    sheets.sort((a, b) => (a[0].startsWith("Q") ? 1 : 0) - (b[0].startsWith("Q") ? 1 : 0) || a[0].localeCompare(b[0]));
    const strings = [];
    for (const m of readFileSync(join(dir, "xl/sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push(decode(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
    }
    const agg = createAggregator();
    for (const [name, file] of sheets) {
      agg.startSheet(name);
      await scanRows(file, strings, (cells) => agg.row(cells));
    }
    return agg.result();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
