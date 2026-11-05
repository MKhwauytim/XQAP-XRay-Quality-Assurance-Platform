// T8 step 1: rebuild the row sets behind poc/port-pptx/out/model.json, read only.
//
// Repeats buildModel.mjs's loading path (same source modules through Vite SSR, same
// canonical port names, same --last-month filter) and writes out/rows.json:
//   population: one row per port x month from the workload cache (the base set the
//               model's population figures sum), with the group the model assigns.
//   studies:    one row per studied image (the derived set), without staff codes/names.
//
//   node extract.mjs <sourceRoot> <studyWorkbook.xlsx> <workloadCache.json> --last-month=YYYY-MM

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const [srcRoot, studyPath, cachePath] = args.filter((a) => !a.startsWith("--"));
const lastMonth = flag("last-month");
const pkg = JSON.parse(readFileSync(resolve(srcRoot, "package.json"), "utf8"));
const t0 = Date.now();
const server = await createServer({
  root: resolve(srcRoot), configFile: false, logLevel: "warn", appType: "custom",
  cacheDir: join(outDir, ".vite"), server: { middlewareMode: true, hmr: false },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
try {
  const src = await server.ssrLoadModule("/src/data/reporting/portReport/portReportSource.ts");
  const canon = await server.ssrLoadModule("/src/data/reporting/portNameCanonical.ts");
  const wb = XLSX.read(readFileSync(resolve(studyPath)), { type: "buffer", dense: true, sheets: [src.STUDY_SHEET] });
  const sheets = { [src.STUDY_SHEET]: XLSX.utils.sheet_to_json(wb.Sheets[src.STUDY_SHEET], { header: 1, raw: true, defval: null }) };
  const input = src.portReportInputFromSheets(sheets, "");
  const wl = JSON.parse(readFileSync(cachePath, "utf8"));
  const aliases = { "الرياض - الميناء الجاف": "ميناء الرياض الجاف" };
  const nameMap = canon.buildPortNameMap([...wl.months.map((x) => aliases[x.port] ?? x.port), ...input.studies.map((r) => aliases[r.port] ?? r.port)]);
  const canonOf = (p) => nameMap.get(aliases[p] ?? p) ?? aliases[p] ?? p;
  for (const r of input.studies) r.port = canonOf(r.port);
  const months = wl.months.filter((x) => !lastMonth || x.month <= lastMonth).map((x) => ({ ...x, port: canonOf(x.port) }));
  const groupOf = new Map(input.studies.map((r) => [r.port, r.group]));
  const population = months.map((x) => ({ port: x.port, type: x.type, group: groupOf.get(x.port) ?? x.type, year: Number(x.month.slice(0, 4)), month: x.month, images: x.images }));
  const studies = input.studies.map((r) => ({ port: r.port, group: r.group, year: r.year, month: r.monthKey, status: r.imageStatus, match: r.imageMatch ? 1 : 0 }));
  writeFileSync(join(outDir, "rows.json"), JSON.stringify({ population, studies }));
  console.log(`rows: population ${population.length}, studies ${studies.length}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await server.close();
}
