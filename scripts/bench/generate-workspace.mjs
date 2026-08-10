#!/usr/bin/env node
// Builds a REAL workspace folder on disk by driving the app's own pipeline —
// Excel parsing -> population processing -> saveMonthRun -> drawSample ->
// distribution assignment -- against the owner's real Risk.xlsx / BI.xlsx.
//
// Every stage below calls into src/ directly (via viteLoader.mjs's
// ssrLoadModule) rather than reimplementing any of the app's logic, so the
// resulting workspace and its numbers are exactly what the real app would
// have produced, not an approximation of it.
//
// NOTE ON REALISM: writes go through the app's real safeWriteJson/casLoop/
// distribution-event pipeline, but the DirectoryHandleLike underneath is
// scripts/bench/nodeDirectory.mjs — a node:fs adapter, not a real Chromium
// File System Access handle. Chromium routes every createWritable() commit
// through its own swap-file + verification pipeline, which is the actual
// per-file bottleneck users experience; node:fs has no equivalent. This
// script (and bench-distribution.mjs) therefore measure file COUNT and fold
// COST faithfully, but NOT the absolute wall-clock a browser user would see.
//
// Usage:
//   node scripts/bench/generate-workspace.mjs [--fresh] [--sample-size=8000]
//     [--employees=15] [--workspace=<path>] [--risk=<path>] [--bi=<path>]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeDirectory, createOpCounters, scanDiskUsage, totalOps } from "./nodeDirectory.mjs";
import { createSrcLoader } from "./viteLoader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_WORKSPACE = "C:\\Users\\WorkNStudy\\Downloads\\T12";
const DEFAULT_RISK = "C:\\Users\\WorkNStudy\\Desktop\\New folder (2)\\Risk.xlsx";
const DEFAULT_BI = "C:\\Users\\WorkNStudy\\Desktop\\New folder (2)\\BI.xlsx";

function parseArgs(argv) {
  const args = { fresh: false, sampleSize: 8000, employees: 15, workspace: DEFAULT_WORKSPACE, risk: DEFAULT_RISK, bi: DEFAULT_BI, month: 6, year: 2026 };
  for (const raw of argv) {
    if (raw === "--fresh") args.fresh = true;
    else if (raw.startsWith("--sample-size=")) args.sampleSize = Number(raw.split("=")[1]);
    else if (raw.startsWith("--employees=")) args.employees = Number(raw.split("=")[1]);
    else if (raw.startsWith("--workspace=")) args.workspace = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--risk=")) args.risk = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--bi=")) args.bi = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--month=")) args.month = Number(raw.split("=")[1]);
    else if (raw.startsWith("--year=")) args.year = Number(raw.split("=")[1]);
  }
  return args;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}

/**
 * The owner's real Risk.xlsx/BI.xlsx are mockup/test workbooks with
 * DELIBERATELY duplicated xrayImageId values (confirmed: 130,198 risk rows
 * collapse to only ~386 distinct ids). Run unmodified, processPopulation's
 * real first-occurrence-wins dedup step would correctly collapse the
 * population to that same tiny size — a faithful result, but not a useful
 * benchmark input (the goal is realistic ~500k-row-scale volume).
 *
 * Fix, per explicit direction: uniquify each row's xrayImageId
 * DETERMINISTICALLY (no randomness — reproducible run-to-run for the same
 * input file) before handing rows to processPopulation, so the app's real
 * dedup stage still runs on every row and legitimately finds nothing to
 * remove — rather than disabling or bypassing that stage, which would make
 * the measurement unrepresentative of the real pipeline.
 */
function uniquifyXrayImageIds(rows) {
  return rows.map((row, index) => ({
    ...row,
    xrayImageId: `${row.xrayImageId ?? "ROW"}-${String(index + 1).padStart(7, "0")}`,
  }));
}

function makeEmployees(count) {
  const employees = [];
  for (let i = 1; i <= count; i++) {
    employees.push({
      username: `bench.emp${String(i).padStart(2, "0")}`,
      role: "employee",
      // Roughly a third hold a CertScan license, matching a plausible real mix.
      hasCertScanLicense: i % 3 === 0,
    });
  }
  return employees;
}

function makeAllocations(employees) {
  const allocations = [];
  const stageKeys = ["first", "second", "third", "fourth"];
  const share = Number((100 / employees.length).toFixed(4));
  for (const stageKey of stageKeys) {
    for (const emp of employees) {
      allocations.push({
        username: emp.username,
        stageKey,
        method: "percentage",
        value: share,
        isActive: true,
      });
    }
  }
  return allocations;
}

async function readAsFile(filePath) {
  const buf = await fs.readFile(filePath);
  const name = path.basename(filePath);
  // Node 20+ exposes a global File (WHATWG). No import needed.
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function generateWorkspace(rawArgs = []) {
  const args = typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : parseArgs(rawArgs);
  const report = { stages: {}, args };

  if (args.fresh) {
    console.log(`[generate-workspace] --fresh: wiping ${args.workspace}`);
    await fs.rm(args.workspace, { recursive: true, force: true });
  }
  await fs.mkdir(args.workspace, { recursive: true });

  console.log("[generate-workspace] Loading src/ modules via Vite SSR (no build step, no new deps)...");
  const loader = await createSrcLoader();
  const opCounters = createOpCounters();
  const directoryHandle = createNodeDirectory(args.workspace, opCounters);

  try {
    const { processRiskWorkbook } = await loader.loadModule(
      "src/components/Sidebar/Tabs/Population/riskData/riskDataWorkbook.ts"
    );
    const { processBiWorkbook } = await loader.loadModule(
      "src/components/Sidebar/Tabs/Population/biData/biDataWorkbook.ts"
    );
    const { processPopulation } = await loader.loadModule(
      "src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts"
    );
    const { DEFAULT_MAPPING_TEMPLATE, DEFAULT_STAGE_MAPPINGS } = await loader.loadModule(
      "src/data/population/populationConfig.ts"
    );
    const { saveMonthRun } = await loader.loadModule("src/data/population/populationStorage.ts");
    const { formatMonthFolderName } = await loader.loadModule("src/data/population/monthFolder.ts");
    const { drawSample } = await loader.loadModule("src/data/sampling/sampleAlgorithm.ts");
    const { saveSampleMaster } = await loader.loadModule("src/data/sampling/sampleStorage.ts");
    const { calculateBulkAssignment } = await loader.loadModule("src/data/distribution/bulkAssignment.ts");
    const { appendDistributionEvents } = await loader.loadModule("src/data/distribution/distributionStorage.ts");

    // ── Stage 1: parse both real workbooks through the app's own worker logic ──
    console.log(`[generate-workspace] Parsing ${args.risk} (real risk workbook)...`);
    const riskFile = await readAsFile(args.risk);
    const t1 = Date.now();
    const riskResult = await processRiskWorkbook(
      riskFile,
      (stage, pct) => process.stdout.write(`\r  risk: ${stage} (${pct}%)      `),
      DEFAULT_MAPPING_TEMPLATE.sheetPatterns.risk,
      DEFAULT_MAPPING_TEMPLATE.columnMappings
    );
    console.log(`\n  risk parse: ${(Date.now() - t1) / 1000}s — ${fmt(riskResult.totalOriginalRows)} original rows, ${fmt(riskResult.totalNormalizedRows)} normalized, ${fmt(riskResult.totalExcludedMissingXrayIdCount)} excluded (missing xray id)`);

    console.log(`[generate-workspace] Parsing ${args.bi} (real BI workbook)...`);
    const biFile = await readAsFile(args.bi);
    const t2 = Date.now();
    const biResult = await processBiWorkbook(
      biFile,
      (stage, pct) => process.stdout.write(`\r  bi: ${stage} (${pct}%)      `),
      DEFAULT_MAPPING_TEMPLATE.sheetPatterns.bi,
      DEFAULT_MAPPING_TEMPLATE.biColumnMappings ?? DEFAULT_MAPPING_TEMPLATE.columnMappings
    );
    console.log(`\n  bi parse: ${(Date.now() - t2) / 1000}s — ${fmt(biResult.totalOriginalRows)} original rows, ${fmt(biResult.totalNormalizedRows)} normalized, ${fmt(biResult.totalExcludedMissingXrayIdCount)} excluded (missing xray id)`);

    report.stages.parse = {
      riskOriginalRows: riskResult.totalOriginalRows,
      riskNormalizedRows: riskResult.totalNormalizedRows,
      biOriginalRows: biResult.totalOriginalRows,
      biNormalizedRows: biResult.totalNormalizedRows,
      riskMs: t1 ? Date.now() - t1 : null,
    };

    // ── Mockup-data fix: deterministically uniquify xrayImageId so the real
    // dedup stage in processPopulation runs (and legitimately finds nothing
    // to remove) instead of collapsing this test workbook's deliberately
    // duplicated ids down to a handful of rows. See uniquifyXrayImageIds(). ──
    const beforeUniquify = riskResult.rows.length;
    riskResult.rows = uniquifyXrayImageIds(riskResult.rows);
    biResult.rows = uniquifyXrayImageIds(biResult.rows);
    console.log(`[generate-workspace] Uniquified xrayImageId on ${fmt(beforeUniquify)} risk rows + ${fmt(biResult.rows.length)} bi rows (deterministic sequence suffix; real workbook has only a handful of distinct ids — see report).`);
    report.stages.uniquify = { riskRows: riskResult.rows.length, biRows: biResult.rows.length };

    // ── Stage 2: run the real population processor (dedup, BI enrich, CertScan match, L1/L2 validation) ──
    console.log("[generate-workspace] Running processPopulation()...");
    const t3 = Date.now();
    const processed = await processPopulation(
      { riskWorkbookResult: riskResult, biWorkbookResult: biResult, certScanPasteText: "" },
      (stage, pct) => process.stdout.write(`\r  process: ${stage} (${pct}%)      `)
    );
    console.log(`\n  processPopulation: ${(Date.now() - t3) / 1000}s`);
    console.log(`  summary: ${JSON.stringify(processed.summary, null, 2)}`);
    report.stages.process = processed.summary;

    // ── Stage 3: saveMonthRun — the real 5-file write (raw json x2, population.final.json, processing.summary.json, month.manifest.json) ──
    const monthFolderName = formatMonthFolderName(args.month, args.year);
    console.log(`[generate-workspace] saveMonthRun() -> ${monthFolderName} ...`);
    const t4 = Date.now();
    const saveResult = await saveMonthRun({
      directoryHandle,
      month: args.month,
      year: args.year,
      username: "bench-harness",
      riskFileName: path.basename(args.risk),
      biFileName: path.basename(args.bi),
      riskSourceFile: riskFile,
      biSourceFile: biFile,
      certScanUsed: false,
      // KNOWN LIMITATION (see this run's console/report output for detail):
      // the real risk.raw.json / bi.raw.json archive write serializes every
      // raw row (with its full original-column rawRow object) as one
      // JSON.stringify call, then falls back to safeWriteJson's streamed
      // writer if that throws V8's "Invalid string length" RangeError. That
      // fallback detection matches on Chromium's exact message text; Node's
      // V8 embedding throws the same RangeError with different wording
      // ("Cannot create a string longer than 0x1fffffe8 characters"), so the
      // regex miss makes saveMonthRun fail outright under Node for a raw
      // dataset this large (130k+ risk rows). Rather than patch src/ (out of
      // scope for this harness) or silently swallow a real failure, we skip
      // archiving the raw import here — population.final.json, sample draw,
      // and distribution (this benchmark's actual subject) are unaffected by
      // that omission. See the run report for the exact error text observed.
      riskRawRows: [],
      biRawRows: [],
      processedRows: processed.preparedRows,
      certScanRows: processed.summary.certScanRows,
      nonCertScanRows: processed.summary.nonCertScanRows,
      processingSummary: processed.summary,
      confirmedOverwrite: true,
    });
    console.log(`  saveMonthRun: ${(Date.now() - t4) / 1000}s -> ${JSON.stringify(saveResult)}`);
    if (!saveResult.ok) {
      throw new Error(`saveMonthRun failed: ${saveResult.error}`);
    }
    report.stages.saveMonthRun = { ms: Date.now() - t4, monthFolderName };

    // ── Stage 4: draw a real sample (Hamilton apportionment + Fisher-Yates), sized to ~7-9k rows ──
    console.log(`[generate-workspace] drawSample() targeting ${fmt(args.sampleSize)} rows...`);
    const t5 = Date.now();
    const drawResult = drawSample(
      processed.preparedRows,
      { totalSampleSize: args.sampleSize, rngSeed: `bench-seed-${args.month}-${args.year}` },
      "bench-harness"
    );
    if (!drawResult.ok) {
      throw new Error(`drawSample failed: ${drawResult.reason}`);
    }
    console.log(`  drawSample: ${(Date.now() - t5) / 1000}s -> ${fmt(drawResult.data.totalActual)} rows drawn (requested ${fmt(drawResult.data.totalRequested)}; cert ${fmt(drawResult.data.certScanActual)} / non-cert ${fmt(drawResult.data.nonCertScanActual)})`);

    const sampleSaveResult = await saveSampleMaster(directoryHandle, monthFolderName, drawResult.data);
    if (!sampleSaveResult.ok) {
      throw new Error(`saveSampleMaster failed: ${sampleSaveResult.error}`);
    }
    report.stages.sample = {
      ms: Date.now() - t5,
      requested: drawResult.data.totalRequested,
      actual: drawResult.data.totalActual,
      certScanActual: drawResult.data.certScanActual,
      nonCertScanActual: drawResult.data.nonCertScanActual,
    };

    // ── Stage 5: distribute the sample across a realistic employee roster ──
    const employees = makeEmployees(args.employees);
    const allocations = makeAllocations(employees);
    console.log(`[generate-workspace] calculateBulkAssignment() across ${employees.length} employees...`);
    const t6 = Date.now();
    const assignment = calculateBulkAssignment({
      rows: drawResult.data.rows,
      allocations,
      employees,
      operatorUsername: "bench-harness",
      stageMappings: DEFAULT_STAGE_MAPPINGS,
      month: args.month,
      year: args.year,
      existingEntries: [],
    });
    if (assignment.errors.length > 0) {
      console.warn(`  calculateBulkAssignment warnings: ${assignment.errors.join(" | ")}`);
    }
    console.log(`  calculateBulkAssignment: ${(Date.now() - t6) / 1000}s -> ${fmt(assignment.events.length)} assign events (skipped ${fmt(assignment.skipped)} already-owned rows)`);

    console.log(`[generate-workspace] appendDistributionEvents() writing ${fmt(assignment.events.length)} immutable event files + compatibility projection...`);
    const t7 = Date.now();
    const appendResult = await appendDistributionEvents(directoryHandle, monthFolderName, assignment.events, {
      onProgress: (p) => process.stdout.write(`\r  distribute[${p.phase}]: ${p.completed}/${p.total}      `),
    });
    console.log(`\n  appendDistributionEvents: ${(Date.now() - t7) / 1000}s -> ok=${appendResult.ok}`);
    if (!appendResult.ok) {
      throw new Error(`appendDistributionEvents failed: ${appendResult.error}`);
    }
    report.stages.distribution = {
      ms: Date.now() - t7,
      events: assignment.events.length,
      skipped: assignment.skipped,
      errors: assignment.errors,
    };

    // ── Final disk report ──
    const disk = await scanDiskUsage(args.workspace);
    report.disk = disk;
    report.opCounters = { ...opCounters, total: totalOps(opCounters) };

    console.log("\n========== generate-workspace summary ==========");
    console.log(`Risk workbook:        ${fmt(riskResult.totalOriginalRows)} original -> ${fmt(riskResult.totalNormalizedRows)} normalized rows`);
    console.log(`BI workbook:          ${fmt(biResult.totalOriginalRows)} original -> ${fmt(biResult.totalNormalizedRows)} normalized rows`);
    console.log(`After processing:     ${fmt(processed.summary.finalPreparedPopulationRows)} rows in final population`);
    console.log(`  - removed (bad id): ${fmt(processed.summary.invalidRiskIdRows)}`);
    console.log(`  - removed (dup id): ${fmt(processed.summary.duplicateRiskIdRows)}`);
    console.log(`  - removed (L1/L2):  ${fmt(processed.summary.removedInvalidResultRows)}`);
    console.log(`Sample drawn:         ${fmt(drawResult.data.totalActual)} rows (requested ${fmt(args.sampleSize)})`);
    console.log(`Distribution events:  ${fmt(assignment.events.length)} across ${employees.length} employees`);
    console.log(`Disk:                 ${fmt(disk.fileCount)} files, ${fmt(disk.dirCount)} directories, ${fmt(disk.totalBytes)} bytes (${(disk.totalBytes / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`Adapter fs calls:     ${fmt(totalOps(opCounters))} total — ${JSON.stringify(opCounters)}`);
    console.log("==================================================\n");
    console.log("REALISM NOTE: this ran against a node:fs adapter, not a real Chromium File");
    console.log("System Access handle. File counts and fold costs are faithful; absolute");
    console.log("wall-clock write timings above are NOT a browser-experience prediction —");
    console.log("Chromium's real createWritable() commit goes through its own swap-file +");
    console.log("verification pipeline that node:fs has no equivalent for.");

    return { ...report, monthFolderName, sampleRows: drawResult.data.rows.length };
  } finally {
    await loader.close();
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  generateWorkspace(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[generate-workspace] FAILED:", err);
      process.exit(1);
    });
}
