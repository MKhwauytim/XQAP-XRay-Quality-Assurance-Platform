// Total line count across every git-tracked text file in the repo — the "how big is the whole
// app right now" number referenced from daily edit-log entries (see CLAUDE.md's edit log
// requirement). Binary files (fonts, the vendored xlsx tarball) are skipped: "lines" is
// meaningless for them and counting would inflate the total with noise, not real content.
//
// `docs/edit logs/` is ALSO excluded by default. That archive is the log describing the edits,
// not the app being measured, and it grew to 18% of the old total (52,557 of 286,257 lines) —
// so every entry inflated the next entry's number and the metric tracked documentation growth
// as much as code. Pass --with-edit-logs to reproduce a pre-2026-08-07 total for comparison
// against historical entries, which were all recorded on the old, inclusive basis.
//
// Usage:
//   npm run count-lines                     total plus a by-extension breakdown
//   npm run count-lines -- --quiet          only the bare total (for scripting)
//   npm run count-lines -- --with-edit-logs old inclusive basis (historical comparison)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BINARY_EXT_RE = /\.(tgz|gz|zip|png|jpe?g|gif|ico|woff2?|ttf|eot|pdf)$/i;
const EDIT_LOG_DIR_RE = /^docs\/edit logs\//;

function isProbablyBinary(buf) {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

function main() {
  const quiet = process.argv.includes("--quiet");
  const withEditLogs = process.argv.includes("--with-edit-logs");
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  let total = 0;
  let editLogLines = 0;
  const byExt = new Map();
  const skipped = [];

  for (const file of files) {
    if (BINARY_EXT_RE.test(file)) {
      skipped.push(file);
      continue;
    }
    if (!withEditLogs && EDIT_LOG_DIR_RE.test(file)) {
      // Counted separately so the non-quiet report can still show what was left out.
      try {
        const buf = readFileSync(file);
        editLogLines += buf.length === 0 ? 0 : buf.toString("utf8").split("\n").length;
      } catch {
        /* deleted-but-still-staged; nothing to report */
      }
      continue;
    }
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue; // deleted-but-still-staged, submodule path, etc.
    }
    if (isProbablyBinary(buf)) {
      skipped.push(file);
      continue;
    }
    const text = buf.toString("utf8");
    const lines = text.length === 0 ? 0 : text.split("\n").length;
    total += lines;
    const ext = (file.match(/\.[^./\\]+$/) || ["(none)"])[0];
    byExt.set(ext, (byExt.get(ext) || 0) + lines);
  }

  if (quiet) {
    console.log(total);
    return;
  }

  const basis = withEditLogs ? "including docs/edit logs/" : "excluding docs/edit logs/";
  console.log(`Total lines (git-tracked, text files, ${basis}): ${total}`);
  console.log(`Files counted: ${files.length - skipped.length} (skipped ${skipped.length} binary)`);
  if (!withEditLogs) {
    console.log(`Excluded edit-log archive: ${editLogLines} lines (--with-edit-logs to include)`);
  }
  console.log("\nBy extension:");
  const sorted = [...byExt.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    console.log(`  ${ext.padEnd(8)} ${String(count).padStart(8)}`);
  }
}

main();
