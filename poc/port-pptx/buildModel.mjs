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
  const build = await server.ssrLoadModule("/src/data/reporting/portReport/portReportBuild.ts");
  // The shared build (the same one the export script and the port tool call).
  const wb = XLSX.read(readFileSync(resolve(studyPath)), { type: "buffer", dense: true, sheets: [src.STUDY_SHEET] });
  const studyRows = XLSX.utils.sheet_to_json(wb.Sheets[src.STUDY_SHEET], { header: 1, raw: true, defval: null });
  const wl = JSON.parse(readFileSync(cachePath, "utf8"));
  const excludeYears = (flag("exclude-years") ?? "").split(",").map((y) => y.trim()).filter(Boolean);
  const r = build.buildPortReport({ studyRows, workloadMonths: wl.months, workloadMonthsNoTransit: wl.monthsNoTransit, transitIds: wl.transitIds }, { port: port ?? "", displayName, period, lastMonth: flag("last-month"), excludeYears, excludeTransit: args.includes("--exclude-transit") });
  const { model: m, workload } = r;
  writeFileSync(join(outDir, "model.json"), JSON.stringify({ m, workload }));
  writeFileSync(join(outDir, "report.html"), r.html, "utf8");
  console.log(`model: ${m.displayName} studied ${m.selected.image.studied} accuracy ${(m.selected.image.accuracy * 100).toFixed(2)}% employees ${m.employees.length}`);
} finally {
  await server.close();
}
