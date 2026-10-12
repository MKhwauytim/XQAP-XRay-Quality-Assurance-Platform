// Renders the comprehensive executive deck (deck3, Excel-only mode) from the
// two real workbooks to a standalone HTML file - the same path the Reports tab
// «التقرير الشامل» page takes, minus the browser. Re-run after every text edit.
//
//   node scripts/export-comprehensive-report-static.mjs <sample.xlsx> <followup.xlsx> [outPath]
//
// Vite's SSR loader runs the real TypeScript source (incl. `?inline` fonts)
// without opening a port or building the app.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [samplePath, followUpPath, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!samplePath || !followUpPath) {
  console.error("usage: node scripts/export-comprehensive-report-static.mjs <sample.xlsx> <followup.xlsx> [outPath]");
  process.exit(1);
}
const outPath = resolve(root, out ?? "dist-preview/comprehensive-report.html");
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
  const { readComprehensiveWorkbooks } = await server.ssrLoadModule("/src/data/workbookImport/readWorkbook.ts");
  const { mergeCompletedRows, buildComprehensiveInput } = await server.ssrLoadModule("/src/data/workbookImport/mergeWithSystem.ts");
  const { DEFAULT_EXEC_CONFIG } = await server.ssrLoadModule("/src/data/reporting/executiveReportTypes.ts");
  const { buildExecutiveDeckV3 } = await server.ssrLoadModule("/src/data/reporting/executive/deck3/index.ts");

  const blobs = [samplePath, followUpPath].map((p) => new Blob([readFileSync(p)]));
  const wb = await readComprehensiveWorkbooks(blobs, undefined, { requireFollowUp: true });
  const merged = mergeCompletedRows([], wb.rows);
  const input = buildComprehensiveInput(merged.rows, { template: null, config: DEFAULT_EXEC_CONFIG }, merged.period, wb.populationSummary);
  const html = await buildExecutiveDeckV3(input, {}, { textTemplate: null });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  console.log(`report written: ${outPath}\n  ${merged.rows.length} rows · ${(html.length / 1024 / 1024).toFixed(2)} MB`);

  // The report's data workbook (what the app's xlsx button exports): one sheet per report page, then the raw per-image rows behind them.
  const XLSX = await server.ssrLoadModule("xlsx");
  const { buildExecutiveRawWorkbookObject } = await server.ssrLoadModule("/src/data/reporting/executive/workbook/workbook.ts");
  const rawBook = await buildExecutiveRawWorkbookObject(input, {});
  const rawPath = outPath.replace(/\.html$/i, "") + "-data.xlsx";
  const rawBuf = (XLSX.write ?? XLSX.default.write)(rawBook, { type: "buffer", bookType: "xlsx", compression: true });
  writeFileSync(rawPath, rawBuf);
  console.log(`data workbook written: ${rawPath}
  ${rawBook.SheetNames.length} sheets · ${(rawBuf.length / 1024 / 1024).toFixed(1)} MB`);
  // The observations and recommendations (الملاحظات والتوصيات) drafted from the report's results, as a separate small workbook.
  const { buildStatements, buildStatementsWorkbook } = await server.ssrLoadModule("/src/data/reporting/executive/deck3/statements.ts");
  const { buildReportModel } = await server.ssrLoadModule("/src/data/reporting/executive/model/reportModel.ts");
  const statements = buildStatements(buildReportModel(input, {}));
  const stPath = outPath.replace(/\.html$/i, "") + "-statements.xlsx";
  writeFileSync(stPath, (XLSX.write ?? XLSX.default.write)(buildStatementsWorkbook(statements, input.periodLabel ?? ""), { type: "buffer", bookType: "xlsx", compression: true }));
  console.log(`statements written: ${stPath}\n  ${statements.length} statements`);
  // A small workbook with only the page-level supporting sheets (no per-image / per-answer rows): easy to share.
  const { buildDeckSupportSheets } = await server.ssrLoadModule("/src/data/reporting/executive/deck3/supportData.ts");
  const supportBook = XLSX.utils.book_new();
  for (const sheet of buildDeckSupportSheets(buildReportModel(input, {}))) XLSX.utils.book_append_sheet(supportBook, XLSX.utils.aoa_to_sheet(sheet.aoa), sheet.name);
  const supportPath = outPath.replace(/\.html$/i, "") + "-support.xlsx";
  writeFileSync(supportPath, (XLSX.write ?? XLSX.default.write)(supportBook, { type: "buffer", bookType: "xlsx", compression: true }));
  console.log(`support data written: ${supportPath}\n  ${supportBook.SheetNames.length} sheets`);
} finally {
  await server.close();
}
