// Streams the row-level population sheets of the «بيانات التقرير مختصر»
// workbook (one sheet per year / quarter) and returns per-port, per-month
// workload counts: images received, images carrying an employee code, days
// with images, and the distinct level-1 / level-2 employee codes.
//
// Sheet layouts (verified 2026-11-04 against the results sheet's own codes):
//   2024        : no employee columns.
//   2025-Q1..Q4 : «موظف المستوى الاول» / «موظف المستوى الثاني» hold the employee
//                 CODES (the headers say employee, the cells are codes).
//   2026-Q1..Q4 : a summary row first; the real header is the row holding
//                 «رقم صورة الاشعة». «كود موظف المستوى الأول/الثاني» are codes.
//   Q4B         : «كود موظف المستوى الأول/الثاني» codes.
// An image id seen in an earlier sheet is skipped, so each image counts once.
// Uses Windows' bsdtar from an ASCII-named copy, as populationSheets.mjs does.

import { copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const clean = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s === "#N/A" ? "" : s;
};
const ID = ["معرف الأشعة", "معرف الاشعة", "رقم صورة الاشعة"];
const DATE = ["تاريخ دخول الأشعة", "تاريخ دخول الاشعة", "تاريخ دخول للاشعة", "تاريخ الاشعة"];
const RES1 = ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الاول", "المستوى الأول"];
const RES2 = ["نتيجة المستوى الثاني", "المستوى الثاني"];
const CODE1 = ["كود موظف المستوى الأول"];
const CODE2 = ["كود موظف المستوى الثاني"];
const CODE1_2025 = ["موظف المستوى الاول", "موظف المستوى الأول"];
const CODE2_2025 = ["موظف المستوى الثاني"];
/** Result codes that are a system, not a person. */
const NON_EMPLOYEE = new Set(["X-RAY", "XRAY"]);

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

const dayOf = (v) => {
  const n = Number(v);
  if (n > 0) return new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

/**
 * @returns {Promise<{ months: Array<{ port: string, type: string, month: string, images: number, suspicion: number, coded: number, days: string[], l1: Record<string, number>, l2: Record<string, number> }>, sheets: Array<{ name: string, rows: number, coded: number, duplicates: number }> } | null>}
 *          null when the workbook has no year / quarter population sheets.
 */
export async function readWorkload(workbookPath) {
  const dir = mkdtempSync(join(tmpdir(), "port-workload-"));
  try {
    const src = join(dir, "source.xlsx");
    copyFileSync(workbookPath, src);
    const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(existsSync(winTar) ? winTar : "tar", ["-xf", src, "-C", dir, "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets"]);
    const sheets = sheetFiles(dir).filter(([n]) => /^(\d{4}(-Q\d)?|Q\dB)$/.test(n));
    if (!sheets.length) return null;
    // Oldest first, Q4B last, so a duplicate keeps the row from its own period sheet.
    sheets.sort((a, b) => (a[0].startsWith("Q") ? 1 : 0) - (b[0].startsWith("Q") ? 1 : 0) || a[0].localeCompare(b[0]));
    const strings = [];
    for (const m of readFileSync(join(dir, "xl/sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push(decode(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
    }
    const seen = new Set();
    const acc = new Map(); // port|month -> agg
    const report = [];
    for (const [name, file] of sheets) {
      let col = null;
      let rows = 0, coded = 0, duplicates = 0;
      await scanRows(file, strings, (cells) => {
        if (!col) {
          if (!Object.values(cells).some((v) => ID.includes(String(v).trim()))) return;
          const f = (hs) => Object.keys(cells).find((k) => hs.includes(String(cells[k]).trim()));
          const is2025 = /^2025/.test(name);
          col = { id: f(ID), date: f(DATE), port: f(["اسم المنفذ"]), type: f(["نوع المنفذ"]), c1: f(is2025 ? CODE1_2025 : CODE1), c2: f(is2025 ? CODE2_2025 : CODE2), r1: f(RES1), r2: f(RES2) };
          return;
        }
        const id = clean(cells[col.id]);
        if (id) {
          if (seen.has(id)) { duplicates++; return; }
          seen.add(id);
        }
        const port = clean(cells[col.port]);
        const day = dayOf(cells[col.date]);
        if (!port || !day) return;
        rows++;
        const key = `${port}|${day.slice(0, 7)}`;
        let a = acc.get(key);
        if (!a) {
          a = { port, type: clean(cells[col.type]), month: day.slice(0, 7), images: 0, suspicion: 0, coded: 0, days: new Set(), l1: new Map(), l2: new Map() };
          acc.set(key, a);
        }
        a.images++;
        // An image is «اشتباه» when either level flagged it.
        if (clean(cells[col.r1]) === "اشتباه" || clean(cells[col.r2]) === "اشتباه") a.suspicion++;
        a.days.add(day);
        const c1 = col.c1 ? clean(cells[col.c1]) : "";
        const c2 = col.c2 ? clean(cells[col.c2]) : "";
        const ok1 = c1 && !NON_EMPLOYEE.has(c1.toUpperCase());
        const ok2 = c2 && !NON_EMPLOYEE.has(c2.toUpperCase());
        if (ok1 || ok2) { a.coded++; coded++; }
        // Per-employee image counts, so an employee working several ports can be
        // apportioned by their share of each port's work.
        if (ok1) a.l1.set(c1, (a.l1.get(c1) ?? 0) + 1);
        if (ok2) a.l2.set(c2, (a.l2.get(c2) ?? 0) + 1);
      });
      report.push({ name, rows, coded, duplicates });
    }
    const months = [...acc.values()].map((a) => ({ ...a, days: [...a.days], l1: Object.fromEntries(a.l1), l2: Object.fromEntries(a.l2) }));
    return { months, sheets: report };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
