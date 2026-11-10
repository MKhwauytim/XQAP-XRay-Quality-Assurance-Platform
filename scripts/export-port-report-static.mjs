// Renders the port business report (src/data/reporting/portReport/) for one
// selected port from the report workbook, as one self-contained HTML file.
// Same Vite-SSR loading approach as export-exec-report-static.mjs.
//
//   node scripts/export-port-report-static.mjs <workbook.xlsx> [--port=<المنفذ الموحد>] [--period=<label>] [--name=<display name>] [outPath]
//
// Without --port it prints the ports found in the workbook and exits.

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as XLSX from "xlsx";
import { readPopulationByYear } from "./lib/populationSheets.mjs";
import { readWorkload } from "./lib/workloadSheets.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith("--"));
const workbookPath = positional[0];
if (!workbookPath) {
  console.error("usage: node scripts/export-port-report-static.mjs <workbook.xlsx> [--port=...] [--period=...] [outPath]");
  process.exit(1);
}
const port = flag("port");
const period = flag("period") ?? "فترة التقرير";
const displayName = flag("name");
const outPath = resolve(root, positional[1] ?? "dist-preview/port-report.html");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});

try {
  const src = await server.ssrLoadModule("/src/data/reporting/portReport/portReportSource.ts");
  const model = await server.ssrLoadModule("/src/data/reporting/portReport/portReportModel.ts");
  const html = await server.ssrLoadModule("/src/data/reporting/portReport/portReportHtml.ts");

  // Workload mode (--workload=<workbook with year/quarter population sheets>): the
  // positional workbook only needs «نتائج الدراسة»; population comes from the
  // workload sheets. Otherwise the original layout (study sheet + population pivot).
  const workloadPath = flag("workload");
  // Studied image ids: the population pass keeps their employee codes so study rows without codes can be completed.
  const studyIds = (rows, cols) => { const i = (rows?.[0] ?? []).findIndex((h) => cols.includes(String(h ?? "").trim())); return new Set(i < 0 ? [] : rows.slice(1).map((r) => String(r[i] ?? "").trim()).filter(Boolean)); };
  const wb = XLSX.read(readFileSync(resolve(workbookPath)), { type: "buffer", dense: true, sheets: workloadPath ? [src.STUDY_SHEET] : undefined });
  const sheets = {};
  for (const name of [src.STUDY_SHEET, src.POPULATION_SHEET]) {
    const ws = wb.Sheets[name];
    if (!ws) {
      if (workloadPath && name === src.POPULATION_SHEET) continue;
      throw new Error(`sheet not found: ${name}`);
    }
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }
  const input = src.portReportInputFromSheets(sheets, period);
  if (workloadPath) {
    // Workload mode: every step after reading the sheets is shared with the port report tool
    // (src/data/reporting/portReport/portReportBuild.ts), so the two give the same figures.
    const build = await server.ssrLoadModule("/src/data/reporting/portReport/portReportBuild.ts");
    const agg = await server.ssrLoadModule("/src/data/reporting/portReport/workloadAggregate.ts");
    // --workload-cache=<file.json> keeps the (minutes-long) workbook pass between layout iterations.
    const cachePath = flag("workload-cache");
    const wl = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : await readWorkload(resolve(workloadPath), () => agg.createWorkloadAggregator({ codesFor: studyIds(sheets[src.STUDY_SHEET], src.STUDY_ID_COLS) }));
    if (cachePath && wl && !existsSync(cachePath)) writeFileSync(cachePath, JSON.stringify(wl));
    if (!wl) throw new Error(`no year/quarter population sheets in ${workloadPath}`);
    for (const s of wl.sheets) console.log(`  ${s.name}: ${s.rows} images, ${s.coded} with employee codes, ${s.duplicates} repeated ids skipped, ${s.transit ?? 0} transit`);
    const data = { studyRows: sheets[src.STUDY_SHEET], workloadMonths: wl.months, workloadMonthsNoTransit: wl.monthsNoTransit, transitIds: wl.transitIds, studyCodes: wl.studyCodes };
    if (!port) {
      console.log("ports:\n  " + build.listPortsInData(data).join("\n  "));
    } else {
      // --last-month=YYYY-MM drops rows dated after the report period; --exclude-years=2024[,…] leaves whole years out.
      const excludeYears = (flag("exclude-years") ?? "").split(",").map((y) => y.trim()).filter(Boolean);
      // --exclude-transit leaves transit declarations («البيان» = ترانزيت) out.
      const r = build.buildPortReport(data, { port, displayName, period, lastMonth: flag("last-month"), excludeYears, excludeTransit: args.includes("--exclude-transit") });
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, r.html, "utf8");
      const m = r.model;
      console.log(`  tiers: ${r.workload.tiers.map((t) => `${t.label} ${t.ports.length} (${t.ports.map((p) => p.port).slice(0, 3).join("، ")}…)`).join(" | ")}`);
      console.log(
        `port report written: ${outPath}\n` +
          `  ${m.displayName} · studied ${m.selected.image.studied} · accuracy ${(m.selected.image.accuracy * 100).toFixed(2)}% · ` +
          `tiers ${m.distribution.tiers.map((t) => `${t.label} ${t.count}`).join(" / ")} · skew ${m.distribution.skewness?.toFixed(3)}`,
      );
      const xlsxPath = flag("xlsx");
      if (xlsxPath) {
        writeFileSync(resolve(xlsxPath), await build.portReportWorkbookBytes(build.portReportSheets(r)));
        console.log(`report data written: ${resolve(xlsxPath)}`);
      }
    }
  } else {
    // Row-level population (with entry year) replaces the pivot totals when the
    // workbook carries it; see scripts/lib/populationSheets.mjs.
    const byYear = await readPopulationByYear(resolve(workbookPath));
    if (byYear) {
      input.population = byYear.rows;
      for (const [sheet, u] of Object.entries(byYear.undated)) {
        if (u.rows) console.log(`  ${sheet}: ${u.rows} rows without an entry date counted in ${u.year}`);
      }
    }
    const ports = model.listReportPorts(input);
    if (!port) {
      console.log("ports:\n  " + ports.join("\n  "));
    } else {
      if (!ports.includes(port)) throw new Error(`port not in workbook: ${port}`);
      const m = model.buildPortReportModel(input, port, displayName ? { displayName } : {});
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html.buildPortReportHtml(m), "utf8");
      console.log(`port report written: ${outPath}`);
      if (flag("xlsx")) console.log("  --xlsx needs --workload (the data workbook is built from the workload sheets).");
    }
  }
} finally {
  await server.close();
}
