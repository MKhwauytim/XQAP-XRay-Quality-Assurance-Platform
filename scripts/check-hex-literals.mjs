#!/usr/bin/env node
// B4 regression guard — x-ray-quality-app-v1
//
// The B4 hex-literal token sweep (see docs/edit logs/2026-07-08.md, v42.18-v42.22, and
// docs/audit/hardening-2026-07-08/03-approved-plan.md, "Batch 1 — Visual
// System") mapped raw #hex color literals in the four highest-offender CSS
// files to semantic tokens in src/index.css. Every literal remaining after
// the sweep is a deliberate, documented exception carrying a trailing
// `/* no-token: one-off */` comment.
//
// Without a guard, this decays: the original audit found the counts had
// *grown* since a prior sweep (287->310, 183->197) because nothing stopped
// new code from reintroducing raw hex values. This script counts raw hex
// literals in the four swept files and fails the build if any file's count
// exceeds its committed post-sweep baseline.
//
// Usage:
//   node scripts/check-hex-literals.mjs         # check against baseline (exit 1 on regression)
//   node scripts/check-hex-literals.mjs --report # print current counts only, exit 0

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Baseline = the exact count left in each file immediately after the B4
// sweep landed (all of them documented `/* no-token: one-off */` literals,
// or in the DataTable case one plain box-shadow accent). Bump a baseline
// number ONLY alongside a matching new `/* no-token: one-off */` comment
// (or an equivalent documented exception) in the same commit — never to
// silence an accidental regression.
const BASELINE = {
  "src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css": 10,
  "src/components/Sidebar/Tabs/Reports/Reports.css": 23,
  "src/components/DataTable/DataTable.css": 3,
  "src/components/Sidebar/Tabs/Population/Population.css": 16
};

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function countHexLiterals(absPath) {
  const src = fs.readFileSync(absPath, "utf8");
  const matches = src.match(HEX_RE);
  return matches ? matches.length : 0;
}

function main() {
  const reportOnly = process.argv.includes("--report");
  let failed = false;
  const rows = [];

  for (const [relPath, baseline] of Object.entries(BASELINE)) {
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath)) {
      console.error(`[check-hex-literals] MISSING FILE: ${relPath}`);
      failed = true;
      continue;
    }
    const count = countHexLiterals(absPath);
    const status = count > baseline ? "REGRESSION" : count < baseline ? "improved" : "ok";
    rows.push({ file: relPath, baseline, count, status });
    if (count > baseline) failed = true;
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("FILE", 68), pad("BASELINE", 10), pad("CURRENT", 9), "STATUS");
  for (const r of rows) {
    console.log(pad(r.file, 68), pad(r.baseline, 10), pad(r.count, 9), r.status);
  }

  if (reportOnly) {
    process.exit(0);
  }

  if (failed) {
    console.error(
      "\n[check-hex-literals] FAIL — one or more swept files gained raw hex literals " +
        "beyond the committed baseline. Map new colors to an existing token in " +
        "src/index.css, or add a new token if the color repeats >=2x, or annotate a " +
        "genuine one-off with `/* no-token: one-off */` and bump BASELINE in this " +
        "script in the same commit."
    );
    process.exit(1);
  }

  console.log("\n[check-hex-literals] OK — no swept file exceeds its baseline.");
}

main();
