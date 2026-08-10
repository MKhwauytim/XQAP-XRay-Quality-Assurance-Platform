// Generates the mechanical half of a daily edit-log entry (see CLAUDE.md's "Edit log
// requirement"), so writing one costs prose and nothing else.
//
// The fields this fills in — version, date, changed-file list, +/- counts, and the whole-repo
// total on tier 3 — were previously produced by hand from three separate commands
// (`count-lines` before, `count-lines` after, `git diff --stat`). That was the bulk of the
// per-entry cost and the part most prone to drift: v59.199's `Lines:` line degenerated into a
// hedging paragraph because untracked files never appear in `git diff --stat`. This script
// counts untracked files explicitly instead.
//
// Run it AFTER the edit is applied and the working tree reflects the finished change.
//
// Usage:
//   npm run editlog -- --tier=1 "Fix (scope): short description"
//   npm run editlog -- --tier=3 --append --sync-package "Refactor (x): ..."
//
// Flags:
//   --tier=1|2|3     depth ladder (default 2). Governs the skeleton's fields and the gate
//                    reminder printed at the end. See CLAUDE.md for what each tier requires.
//   --append         append to docs/edit logs/YYYY-MM-DD.md (creating it if absent) instead of
//                    printing to stdout. Refuses to create a second file for the same date.
//   --sync-package   also set package.json's version to {version}.0 so `check:release` passes.
//   --bump=major|minor   override the default bump (major on tier 3, minor otherwise).
//   --version=X.Y    use an explicit version instead of computing the next one.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const EDIT_LOG_DIR = fileURLToPath(new URL("docs/edit%20logs/", root));
const PACKAGE_JSON = fileURLToPath(new URL("package.json", root));
const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const HEADING_RE = /^## v(\d+)(?:\.(\d+))? /m;

const GATES = {
  1: ["npm run lint", "npm run typecheck", "npx vitest run <affected test file>"],
  2: ["npm run lint", "npm run typecheck", "npm run test:run"],
  3: [
    "npm run lint",
    "npm run typecheck",
    "npm run test:run",
    "npm run check:complexity",
    "npm run check:hex-literals",
    "npm run check:release",
    "npm run check:vendor",
    "npm run build",
    "npm run check:bundle-size",
  ],
};

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd: fileURLToPath(root) });
  } catch {
    return "";
  }
}

/** Highest version across every daily log, newest file first. */
function latestVersion() {
  const files = readdirSync(EDIT_LOG_DIR)
    .filter((name) => DAILY_FILE_RE.test(name))
    .sort((a, b) => b.localeCompare(a));
  for (const name of files) {
    const match = readFileSync(`${EDIT_LOG_DIR}${name}`, "utf8").match(HEADING_RE);
    if (match) return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
  }
  return { major: 0, minor: 0 };
}

/**
 * Changed-file stats over the whole working tree (staged + unstaged + untracked).
 * `git diff --shortstat` alone silently omits untracked files, which is exactly how a new
 * test file's several hundred lines went unrecorded in past entries.
 */
function changeStats() {
  const tracked = git(["diff", "HEAD", "--numstat"]).trim();
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);

  let added = 0;
  let removed = 0;
  const files = [];

  for (const line of tracked ? tracked.split("\n") : []) {
    const [a, r, file] = line.split("\t");
    if (!file) continue;
    // "-" marks a binary file; its line delta is meaningless.
    if (a !== "-") added += Number(a) || 0;
    if (r !== "-") removed += Number(r) || 0;
    files.push(file);
  }

  for (const file of untracked) {
    try {
      const text = readFileSync(fileURLToPath(new URL(file, root)), "utf8");
      added += text.length === 0 ? 0 : text.split("\n").length;
      files.push(`${file} (new)`);
    } catch {
      /* vanished between listing and read */
    }
  }

  return { added, removed, files };
}

function repoTotal() {
  try {
    return Number(
      execFileSync("node", [fileURLToPath(new URL("scripts/count-lines.mjs", root)), "--quiet"], {
        encoding: "utf8",
        cwd: fileURLToPath(root),
      }).trim(),
    );
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const has = (name) => argv.includes(`--${name}`);
  const title = argv.find((a) => !a.startsWith("--"));

  if (!title) {
    console.error('Usage: npm run editlog -- --tier=2 "Fix (scope): short description"');
    process.exit(1);
  }

  const tier = Number(flag("tier") ?? 2);
  if (![1, 2, 3].includes(tier)) {
    console.error(`--tier must be 1, 2 or 3 (got ${tier}).`);
    process.exit(1);
  }

  const bump = flag("bump") ?? (tier === 3 ? "major" : "minor");
  const previous = latestVersion();
  // Major entries are written as "{N}.0" rather than a bare "vN": check:release compares the
  // heading against package.json's first two segments, so a bare "v60" can never match.
  const version =
    flag("version") ??
    (bump === "major" ? `${previous.major + 1}.0` : `${previous.major}.${previous.minor + 1}`);

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  const { added, removed, files } = changeStats();
  let linesLine = `**Lines:** ${files.length} files, +${added} / -${removed}`;
  if (tier === 3) {
    const total = repoTotal();
    if (total !== null) {
      linesLine += ` · whole repo now ${total} lines (excl. docs/edit logs/)`;
    }
  }

  const fileBlocks = files.length
    ? files.map((f) => `**File:** \`${f}\``).join("\n\n")
    : "**File:** `<path>`";

  const snippetBlock =
    tier === 1
      ? ""
      : "\n**Before:**\n```ts\n// paste the replaced snippet\n```\n\n" +
        "**After:**\n```ts\n// paste the replacing snippet\n```\n";

  const prosePrompt =
    tier === 1
      ? "**What changed:** <one or two sentences — no Why paragraph required at this tier>\n"
      : tier === 2
        ? "**Why:** <what forced the change>\n\n**What changed:** <brief description>\n"
        : "**Why:** <what forced the change, and what was rejected>\n\n" +
          "**What changed:** <full description>\n\n" +
          "**Migration/rollback:** <if the change touches data formats or release mechanics>\n";

  const entry =
    `## v${version} — ${date} — ${title}\n\n` +
    `${prosePrompt}\n` +
    `${fileBlocks}\n` +
    `${snippetBlock}\n` +
    `**Verification:** <paste the tier-${tier} gate results>\n\n` +
    `${linesLine}\n\n---\n`;

  if (has("append")) {
    const target = `${EDIT_LOG_DIR}${date}.md`;
    if (existsSync(target)) {
      // Newest entry goes on top, directly under the file's `# Edit Log — DATE` header.
      const existing = readFileSync(target, "utf8");
      const headerEnd = existing.indexOf("\n## ");
      const insertAt = headerEnd >= 0 ? headerEnd + 1 : existing.length;
      writeFileSync(target, existing.slice(0, insertAt) + entry + "\n" + existing.slice(insertAt));
    } else {
      writeFileSync(target, `# Edit Log — ${date}\n\n${entry}`);
    }
    console.log(`Appended v${version} skeleton to docs/edit logs/${date}.md`);
  } else {
    console.log(entry);
  }

  if (has("sync-package")) {
    const pkg = readFileSync(PACKAGE_JSON, "utf8");
    const next = pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}.0$2`);
    writeFileSync(PACKAGE_JSON, next);
    console.log(`package.json version set to ${version}.0`);
  }

  console.error(`\nTier ${tier} gates — run these and paste the results into **Verification:**`);
  for (const gate of GATES[tier]) console.error(`  ${gate}`);
  if (tier < 3) {
    console.error(
      "  (build + check:* gates are NOT required at this tier — see CLAUDE.md's gate ladder)",
    );
  }
}

main();
