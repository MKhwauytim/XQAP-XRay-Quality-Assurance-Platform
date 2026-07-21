// Total line count across every git-tracked text file in the repo — the "how big is the whole
// app right now" number referenced from EDIT_LOG.md entries (see CLAUDE.md's edit log
// requirement). Binary files (fonts, the vendored xlsx tarball) are skipped: "lines" is
// meaningless for them and counting would inflate the total with noise, not real content.
//
// Usage:
//   npm run count-lines            print the total plus a by-extension breakdown
//   npm run count-lines -- --quiet print only the bare total (for scripting)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BINARY_EXT_RE = /\.(tgz|gz|zip|png|jpe?g|gif|ico|woff2?|ttf|eot|pdf)$/i;

function isProbablyBinary(buf) {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

function main() {
  const quiet = process.argv.includes("--quiet");
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  let total = 0;
  const byExt = new Map();
  const skipped = [];

  for (const file of files) {
    if (BINARY_EXT_RE.test(file)) {
      skipped.push(file);
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

  console.log(`Total lines (git-tracked, text files): ${total}`);
  console.log(`Files counted: ${files.length - skipped.length} (skipped ${skipped.length} binary)`);
  console.log("\nBy extension:");
  const sorted = [...byExt.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sorted) {
    console.log(`  ${ext.padEnd(8)} ${String(count).padStart(8)}`);
  }
}

main();
