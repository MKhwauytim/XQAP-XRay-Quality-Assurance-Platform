#!/usr/bin/env node
// One-off verification script (not part of CI) for the CertScan match-preview
// work: parses the owner's real Risk.xlsx through the app's own
// processRiskWorkbook, lists the real distinct port names it produces, then
// runs computeCertScanMatchPreview against a few synthetic CertScan pastes to
// prove: (a) exact port-name pastes report a real match percentage instead of
// the ~30-vs-~30k mismatch, and (b) a deliberately misspelled port name is
// clearly surfaced as unmatched/fuzzy rather than silently dropped.

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSrcLoader } from "./viteLoader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RISK_PATH = "C:\\Users\\WorkNStudy\\Desktop\\New folder (2)\\Risk.xlsx";

async function readAsFile(filePath) {
  const buf = await fs.readFile(filePath);
  const name = path.basename(filePath);
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function main() {
  const loader = await createSrcLoader();
  try {
    await run(loader);
  } finally {
    await loader.close();
  }
}

async function run(loader) {

  const { processRiskWorkbook } = await loader.loadModule(
    "src/components/Sidebar/Tabs/Population/riskData/riskDataWorkbook.ts"
  );
  const { DEFAULT_MAPPING_TEMPLATE } = await loader.loadModule(
    "src/data/population/populationConfig.ts"
  );
  const { computeCertScanMatchPreview } = await loader.loadModule(
    "src/components/Sidebar/Tabs/Population/processing/certScanMatchPreview.ts"
  );

  console.log(`Parsing ${RISK_PATH} ...`);
  const riskFile = await readAsFile(RISK_PATH);
  const riskResult = await processRiskWorkbook(
    riskFile,
    () => {},
    DEFAULT_MAPPING_TEMPLATE.sheetPatterns.risk,
    DEFAULT_MAPPING_TEMPLATE.columnMappings
  );

  const rows = riskResult.rows;
  console.log(`Parsed ${rows.length} risk rows.`);

  const portCounts = new Map();
  for (const row of rows) {
    const p = (row.portName ?? "").trim();
    if (!p) continue;
    portCounts.set(p, (portCounts.get(p) ?? 0) + 1);
  }
  const distinctPorts = Array.from(portCounts.entries()).sort((a, b) => b[1] - a[1]);

  console.log(`\nDistinct port names in real Risk.xlsx (${distinctPorts.length}):`);
  for (const [port, count] of distinctPorts) {
    console.log(`  ${count.toString().padStart(8)}  ${port}`);
  }

  // ── Scenario A: paste names every real port exactly ────────────────────
  const exactPasteRows = distinctPorts.map(
    ([port], i) => `${port}\tSN-${100000 + i}-A${i}`
  );
  const exactPaste = ["Port Name\tSystem S/N", ...exactPasteRows].join("\n");

  const previewA = computeCertScanMatchPreview(rows, exactPaste);
  console.log("\n=== Scenario A: CertScan paste names every real port exactly ===");
  console.log(`totalCertScanEntries=${previewA.totalCertScanEntries}`);
  console.log(`totalPopulationRows=${previewA.totalPopulationRows}`);
  console.log(`totalMatchedRows=${previewA.totalMatchedRows} (${previewA.totalMatchPercentage}%)`);
  console.log(`pasteOnlyPorts=${JSON.stringify(previewA.pasteOnlyPorts)}`);
  console.log(`populationOnlyPorts=${JSON.stringify(previewA.populationOnlyPorts)}`);
  console.log(`looseTierAlignments=${JSON.stringify(previewA.looseTierAlignments)}`);
  console.log("portBreakdown (top 5):");
  for (const p of previewA.portBreakdown.slice(0, 5)) {
    console.log(
      `  ${p.populationPortName} -> ${p.alignedPastePortName} [${p.tier}] ${p.matchedRowCount}/${p.populationRowCount}`
    );
  }

  // ── Scenario B: paste deliberately mis-spells the busiest port (the exact
  // shape of the owner's real ~30-vs-~30k bug: one/some ports' spelling in the
  // paste diverges from the population, so that port's CertScan bucket misses
  // entirely under the OLD exact-only matching). ─────────────────────────
  if (distinctPorts.length > 0) {
    const [busiestPort] = distinctPorts[0];
    const mangledPort = `${busiestPort}XYZQ`; // guaranteed not to align at any tier
    const mangledPasteRows = distinctPorts.map(([port], i) => {
      const pasteName = port === busiestPort ? mangledPort : port;
      return `${pasteName}\tSN-${200000 + i}-B${i}`;
    });
    const mangledPaste = ["Port Name\tSystem S/N", ...mangledPasteRows].join("\n");

    const previewB = computeCertScanMatchPreview(rows, mangledPaste);
    console.log(`\n=== Scenario B: busiest port ("${busiestPort}") deliberately mis-spelled in the paste ===`);
    console.log(`totalMatchedRows=${previewB.totalMatchedRows} (${previewB.totalMatchPercentage}%)`);
    console.log(`populationOnlyPorts=${JSON.stringify(previewB.populationOnlyPorts)}`);
    console.log(`pasteOnlyPorts=${JSON.stringify(previewB.pasteOnlyPorts)}`);
    const busiestRow = previewB.portBreakdown.find((p) => p.populationPortName === busiestPort);
    console.log(
      `Busiest port breakdown row: ${JSON.stringify(busiestRow)}`
    );
  }

  // ── Scenario C: paste spells a real port with a fuzzy-tier divergence
  // (adds the "ميناء" descriptor word) to prove the new looser-tier fallback
  // catches it AND discloses it instead of silently applying it. ─────────
  if (distinctPorts.length > 1) {
    const [secondPort] = distinctPorts[1];
    const fuzzyPasteRows = distinctPorts.map(([port], i) => {
      const pasteName = port === secondPort ? `ميناء ${port}` : port;
      return `${pasteName}\tSN-${300000 + i}-C${i}`;
    });
    const fuzzyPaste = ["Port Name\tSystem S/N", ...fuzzyPasteRows].join("\n");
    const previewC = computeCertScanMatchPreview(rows, fuzzyPaste);
    console.log(`\n=== Scenario C: second port ("${secondPort}") pasted with an extra "ميناء" descriptor ===`);
    console.log(`looseTierAlignments=${JSON.stringify(previewC.looseTierAlignments)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
