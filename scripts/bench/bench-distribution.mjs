#!/usr/bin/env node
// Measures the app's REAL distribution write/fold pipeline against a real
// workspace folder built from the owner's real Excel data (see
// generate-workspace.mjs). Every operation below calls into src/ directly —
// appendDistributionEvents, loadOrDeriveDistributionCurrent — nothing here
// reimplements the app's storage or fold logic.
//
// ============================================================================
// CRITICAL HONESTY NOTE — read before trusting any absolute time below.
//
// Node's fs does NOT reproduce Chromium's File System Access per-file
// overhead. In a real browser, every createWritable() commit is routed
// through Chromium's own swap-file-write + verification pipeline, which is
// the actual bottleneck production users experience. scripts/bench/
// nodeDirectory.mjs talks straight to node:fs/promises — there is no
// equivalent swap/verify cost here.
//
// So: the FILE-COUNT and FOLD-COST numbers below are faithful — they exercise
// the exact same code paths (safeWriteJson, casLoop, distributionEventStore,
// foldDistributionEvents) with the exact same number of underlying handle
// operations a real run would make. The WALL-CLOCK numbers are NOT a
// prediction of what a user sees in Chrome/Edge — treat them only as a
// relative baseline for comparing one code change against another on THIS
// harness, never as an absolute browser-experience number.
// ============================================================================
//
// Usage:
//   node scripts/bench/bench-distribution.mjs [--fresh] [--workspace=<path>]
//     [--sample-size=8000] [--employees=15] [--batch-size=500]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeDirectory, createOpCounters, scanDiskUsage, totalOps } from "./nodeDirectory.mjs";
import { createSrcLoader } from "./viteLoader.mjs";
import { generateWorkspace } from "./generate-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE = "C:\\Users\\WorkNStudy\\Downloads\\T12";
const DEFAULT_RISK = "C:\\Users\\WorkNStudy\\Desktop\\New folder (2)\\Risk.xlsx";
const DEFAULT_BI = "C:\\Users\\WorkNStudy\\Desktop\\New folder (2)\\BI.xlsx";

function parseArgs(argv) {
  const args = {
    fresh: false,
    workspace: DEFAULT_WORKSPACE,
    risk: DEFAULT_RISK,
    bi: DEFAULT_BI,
    sampleSize: 8000,
    employees: 15,
    month: 6,
    year: 2026,
    // Defaults to the task's target scale (7-9k assignment events) so the
    // WRITE benchmark exercises realistic per-file overhead even when the
    // real workbook's actual unique-xrayImageId population is much smaller
    // (see generate-workspace's report: this specific Risk.xlsx/BI.xlsx pair
    // only contains ~386 unique X-ray scans). Rows are cycled with unique
    // synthetic ids to reach batchSize — see the loop below.
    batchSize: 8000,
  };
  for (const raw of argv) {
    if (raw === "--fresh") args.fresh = true;
    else if (raw.startsWith("--workspace=")) args.workspace = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--risk=")) args.risk = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--bi=")) args.bi = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--sample-size=")) args.sampleSize = Number(raw.split("=")[1]);
    else if (raw.startsWith("--employees=")) args.employees = Number(raw.split("=")[1]);
    else if (raw.startsWith("--month=")) args.month = Number(raw.split("=")[1]);
    else if (raw.startsWith("--year=")) args.year = Number(raw.split("=")[1]);
    else if (raw.startsWith("--batch-size=")) args.batchSize = Number(raw.split("=")[1]);
  }
  return args;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function monthAlreadyBuilt(workspace, monthFolderName) {
  const sampleFile = path.join(workspace, "2-samples", monthFolderName, "1-main", "sample.master.json");
  try {
    await fs.access(sampleFile);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { formatMonthFolderName } = await (async () => {
    const loader = await createSrcLoader();
    try {
      return await loader.loadModule("src/data/population/monthFolder.ts");
    } finally {
      await loader.close();
    }
  })();
  const monthFolderName = formatMonthFolderName(args.month, args.year);

  const alreadyBuilt = !args.fresh && (await monthAlreadyBuilt(args.workspace, monthFolderName));
  if (!alreadyBuilt) {
    console.log(`[bench] Workspace not found or --fresh requested — building it first via generate-workspace.mjs...`);
    await generateWorkspace(args);
  } else {
    console.log(`[bench] Reusing existing workspace at ${args.workspace} (month ${monthFolderName} already built). Pass --fresh to rebuild from the real Excel files.`);
  }

  const loader = await createSrcLoader();
  try {
    const { loadSampleMaster } = await loader.loadModule("src/data/sampling/sampleStorage.ts");
    const { appendDistributionEvents, loadOrDeriveDistributionCurrent } = await loader.loadModule(
      "src/data/distribution/distributionStorage.ts"
    );
    const { buildAssignEvent } = await loader.loadModule("src/data/distribution/distributionLog.ts");
    const { resetAppendOnlyDirectoryCache } = await loader.loadModule("src/data/storage/directoryScan.ts");

    const opCounters = createOpCounters();
    const directoryHandle = createNodeDirectory(args.workspace, opCounters);

    console.log("[bench] Loading sample.master.json to get the real sampled row set...");
    const sample = await loadSampleMaster(directoryHandle, monthFolderName);
    if (!sample) {
      throw new Error(`No sample.master.json found for ${monthFolderName} — generate-workspace did not complete.`);
    }
    console.log(`  sample rows: ${fmt(sample.rows.length)}`);

    // ── Benchmark 1: WRITE — append a fresh batch of N assignment events ──
    // Use rows not already carrying an "assigned" event, if any remain, else
    // synthesize benchmark-only xrayImageIds so this stays re-runnable without
    // colliding with generate-workspace's own initial distribution.
    // NOT capped to sample.rows.length: this benchmark's subject is per-file
    // write/fold overhead at a realistic EVENT count, decoupled from however
    // many unique population rows the real workbook happens to contain (see
    // generate-workspace's report). Rows are cycled with unique synthetic
    // xrayImageId suffixes so batchSize events are always produced.
    const batchSize = args.batchSize;
    const now = new Date().toISOString();
    const writeEvents = [];
    for (let i = 0; i < batchSize; i++) {
      const row = sample.rows[i % sample.rows.length];
      writeEvents.push(
        buildAssignEvent({
          xrayImageId: `${row.xrayImageId}::bench-write-${i}-${Date.now()}`,
          assignedTo: `bench.emp${String((i % args.employees) + 1).padStart(2, "0")}`,
          eventBy: "bench-harness",
          notes: "bench write timing",
          eventAt: now,
        })
      );
    }

    console.log(`\n[bench] WRITE: appending ${fmt(batchSize)} assignment events...`);
    const beforeWriteOps = { ...opCounters };
    const writeStart = performance.now();
    const writeResult = await appendDistributionEvents(directoryHandle, monthFolderName, writeEvents);
    const writeMs = performance.now() - writeStart;
    if (!writeResult.ok) {
      throw new Error(`appendDistributionEvents (bench write) failed: ${writeResult.error}`);
    }
    const writeOpsDelta = {};
    for (const key of Object.keys(opCounters)) writeOpsDelta[key] = opCounters[key] - beforeWriteOps[key];

    // ── Benchmark 2: COLD FOLD — clear the incremental append-only-directory
    // cache and rebuild distribution.current.json from every event file on disk ──
    resetAppendOnlyDirectoryCache();
    console.log(`[bench] COLD FOLD: rebuilding current distribution state from scratch (cache cleared)...`);
    const beforeColdOps = { ...opCounters };
    const coldStart = performance.now();
    const coldDerived = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows);
    const coldMs = performance.now() - coldStart;
    const coldOpsDelta = {};
    for (const key of Object.keys(opCounters)) coldOpsDelta[key] = opCounters[key] - beforeColdOps[key];
    if (!coldDerived) throw new Error("Cold fold returned null — no distribution log found.");

    // ── Benchmark 3: WARM RE-DERIVE — append exactly ONE new event, then
    // re-derive (cache from the cold fold above is still warm; only the new
    // event's file needs to be picked up incrementally) ──
    const oneMoreEvent = buildAssignEvent({
      xrayImageId: `${sample.rows[0].xrayImageId}::bench-warm-${Date.now()}`,
      assignedTo: "bench.emp01",
      eventBy: "bench-harness",
      notes: "bench warm re-derive",
    });
    console.log(`[bench] WARM RE-DERIVE: appending ONE event, then re-deriving...`);
    const appendOneResult = await appendDistributionEvents(directoryHandle, monthFolderName, [oneMoreEvent]);
    if (!appendOneResult.ok) throw new Error(`single-event append failed: ${appendOneResult.error}`);

    const beforeWarmOps = { ...opCounters };
    const warmStart = performance.now();
    const warmDerived = await loadOrDeriveDistributionCurrent(directoryHandle, monthFolderName, sample.rows);
    const warmMs = performance.now() - warmStart;
    const warmOpsDelta = {};
    for (const key of Object.keys(opCounters)) warmOpsDelta[key] = opCounters[key] - beforeWarmOps[key];
    if (!warmDerived) throw new Error("Warm re-derive returned null.");

    // ── Disk report ──
    const disk = await scanDiskUsage(args.workspace);
    const bytesPerRow = sample.rows.length > 0 ? disk.totalBytes / sample.rows.length : 0;

    console.log("\n================= BENCH SUMMARY (bench-distribution.mjs) =================");
    console.log("REALISM: node:fs adapter, NOT a real Chromium File System Access handle.");
    console.log("File counts/fold cost are faithful; wall-clock is a relative baseline only,");
    console.log("NOT a browser-experience prediction (see header comment for why).\n");

    console.log(`Sample size (real drawn rows): ${fmt(sample.rows.length)}`);
    console.log(`Employees:                     ${args.employees}\n`);

    console.log("── WRITE ──────────────────────────────────────────────────────────────");
    console.log(`  events written:      ${fmt(batchSize)}`);
    console.log(`  wall time:            ${fmtMs(writeMs)}  (${fmtMs(writeMs / batchSize)} / event)`);
    console.log(`  adapter fs calls:     ${fmt(totalOps(writeOpsDelta))} total  (${(totalOps(writeOpsDelta) / batchSize).toFixed(2)} calls / event)`);
    console.log(`    breakdown: ${JSON.stringify(writeOpsDelta)}`);

    console.log("\n── COLD FOLD (cache cleared, full rebuild) ───────────────────────────────");
    console.log(`  events folded:        ${fmt(coldDerived.entries.length)} live entries`);
    console.log(`  wall time:            ${fmtMs(coldMs)}`);
    console.log(`  adapter fs calls:     ${fmt(totalOps(coldOpsDelta))} total`);
    console.log(`    breakdown: ${JSON.stringify(coldOpsDelta)}`);

    console.log("\n── WARM RE-DERIVE (append 1 event, re-derive with warm cache) ───────────");
    console.log(`  wall time:            ${fmtMs(warmMs)}`);
    console.log(`  adapter fs calls:     ${fmt(totalOps(warmOpsDelta))} total`);
    console.log(`    breakdown: ${JSON.stringify(warmOpsDelta)}`);
    console.log(`  speedup vs cold:      ${(coldMs / Math.max(warmMs, 0.001)).toFixed(1)}x wall time, ${(totalOps(coldOpsDelta) / Math.max(totalOps(warmOpsDelta), 1)).toFixed(1)}x fewer fs calls`);

    console.log("\n── DISK ───────────────────────────────────────────────────────────────");
    console.log(`  total files:          ${fmt(disk.fileCount)}`);
    console.log(`  total directories:    ${fmt(disk.dirCount)}`);
    console.log(`  total bytes:          ${fmt(disk.totalBytes)}  (${(disk.totalBytes / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  bytes / sampled row:  ${bytesPerRow.toFixed(0)}`);
    console.log("===========================================================================\n");
  } finally {
    await loader.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bench-distribution] FAILED:", err);
    process.exit(1);
  });
