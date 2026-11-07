// T2 step 1: build the Jeddah port report model with the source worktree's own code.
//
// Loads portReportSource/Model/Html and portWorkloadModel from the source worktree
// (read only) through Vite SSR, exactly like scripts/export-port-report-static.mjs
// does in workload mode, and writes:
//   out/model.json   { m, workload }  (the PortReportModel and the WorkloadSlideInput)
//   out/report.html  buildPortReportHtml(m, workload) from that same model
// run.ps1 also runs the source script itself and compares the two HTML files byte for byte.
//
//   node buildModel.mjs <sourceRoot> <studyWorkbook.xlsx> <workloadCache.json> --port=.. --name=.. --period=.. [--last-month=YYYY-MM] [--exclude-years=..]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
if (!srcRoot || !studyPath || !cachePath || !existsSync(cachePath)) {
  console.error("usage: node buildModel.mjs <sourceRoot> <studyWorkbook.xlsx> <workloadCache.json> --port=.. --name=.. --period=..");
  process.exit(1);
}
const port = flag("port");
const displayName = flag("name");
const period = flag("period") ?? "فترة التقرير";
const pkg = JSON.parse(readFileSync(resolve(srcRoot, "package.json"), "utf8"));

const server = await createServer({
  root: resolve(srcRoot),
  configFile: false,
  logLevel: "warn",
  appType: "custom",
  cacheDir: join(outDir, ".vite"), // keep anything Vite writes out of the source worktree
  server: { middlewareMode: true, hmr: false },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
try {
  const src = await server.ssrLoadModule("/src/data/reporting/portReport/portReportSource.ts");
  const model = await server.ssrLoadModule("/src/data/reporting/portReport/portReportModel.ts");
  const html = await server.ssrLoadModule("/src/data/reporting/portReport/portReportHtml.ts");
  const wlm = await server.ssrLoadModule("/src/data/reporting/portReport/portWorkloadModel.ts");
  const canon = await server.ssrLoadModule("/src/data/reporting/portNameCanonical.ts");

  // Same steps as the source script's workload branch, in the same order.
  const wb = XLSX.read(readFileSync(resolve(studyPath)), { type: "buffer", dense: true, sheets: [src.STUDY_SHEET] });
  const sheets = { [src.STUDY_SHEET]: XLSX.utils.sheet_to_json(wb.Sheets[src.STUDY_SHEET], { header: 1, raw: true, defval: null }) };
  const input = src.portReportInputFromSheets(sheets, period);
  const wl = JSON.parse(readFileSync(cachePath, "utf8"));
  const aliases = { "الرياض - الميناء الجاف": "ميناء الرياض الجاف" };
  const nameMap = canon.buildPortNameMap([...wl.months.map((x) => aliases[x.port] ?? x.port), ...input.studies.map((r) => aliases[r.port] ?? r.port)]);
  const canonOf = (p) => nameMap.get(aliases[p] ?? p) ?? aliases[p] ?? p;
  for (const r of input.studies) r.port = canonOf(r.port);
  const lastMonth = flag("last-month");
  const excludeYears = new Set((flag("exclude-years") ?? "").split(",").map((y) => y.trim()).filter(Boolean));
  if (excludeYears.size) input.studies = input.studies.filter((r) => r.year === null || !excludeYears.has(String(r.year)));
  const months = wl.months.filter((x) => (!lastMonth || x.month <= lastMonth) && !excludeYears.has(x.month.slice(0, 4))).map((x) => ({ ...x, port: canonOf(x.port) }));
  const portWorkloads = wlm.buildPortWorkloads(months);
  const tiers = wlm.buildWorkloadTiers(portWorkloads);
  const selPort = canonOf(port ?? "");
  const outcomes = { selected: wlm.outcomesFor(input.studies, new Set([selPort])) };
  for (const t of tiers) outcomes[t.key] = wlm.outcomesFor(input.studies, new Set(t.ports.map((p) => p.port).filter((p) => p !== selPort)));
  const workload = { displayName: displayName ?? selPort, port: selPort, tiers, outcomes, yearly: wlm.outcomesByYear(input.studies, selPort, tiers), loadYear: wlm.LOAD_YEAR, periodLabel: period, unrated: wlm.unratedPorts(portWorkloads) };
  const groupOf = new Map(input.studies.map((r) => [r.port, r.group]));
  const popRows = new Map();
  for (const x of months) {
    const k = `${x.port}|${x.month.slice(0, 4)}`;
    const v = popRows.get(k) ?? { port: x.port, group: groupOf.get(x.port) ?? x.type, year: Number(x.month.slice(0, 4)), total: 0, suspicion: 0 };
    v.total += x.images;
    popRows.set(k, v);
  }
  input.population = [...popRows.values()];
  const m = model.buildPortReportModel(input, selPort, displayName ? { displayName } : {});
  writeFileSync(join(outDir, "model.json"), JSON.stringify({ m, workload }));
  writeFileSync(join(outDir, "report.html"), html.buildPortReportHtml(m, workload), "utf8");
  console.log(`model: ${m.displayName} studied ${m.selected.image.studied} accuracy ${(m.selected.image.accuracy * 100).toFixed(2)}% employees ${m.employees.length}`);
} finally {
  await server.close();
}
