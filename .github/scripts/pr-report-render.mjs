#!/usr/bin/env node
// Renders the sticky PR-report comment from the two metrics files written by
// pr-report-metrics.mjs. Pure string building: no network, no API calls, so it
// can be run locally against two metrics files to preview the comment.
//
// Usage: node pr-report-render.mjs --pr <pr.json> --base <base.json> --out <file.md>
//        [--pr-sha <sha>] [--base-sha <sha>] [--base-ref main] [--run-url <url>]

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

// Kept in sync with the lookup in the workflow's github-script step. Changing
// it orphans every existing comment and starts a fresh one.
const MARKER = "<!-- xqap-pr-report -->";

const load = (file) => {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const pr = load(arg("pr"));
const base = load(arg("base"));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const signed = (value, format) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${format(Math.abs(value))}`;
const shortSha = (sha) => (sha || "").slice(0, 7) || "unknown";
const percent = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

const sections = [];

// --- header ---------------------------------------------------------------
const baseRef = arg("base-ref", "main");
sections.push(
  "### PR report",
  "",
  `\`${shortSha(arg("pr-sha", pr?.sha))}\` vs \`${baseRef}\` at \`${shortSha(arg("base-sha", base?.sha))}\``,
);

// --- bundle budget --------------------------------------------------------
// The single most useful number in this repo: the raw ceiling has been raised
// three times, so "how much room is left" is what reviewers actually need.
const bundleRow = (label, key, maxKey) => {
  const current = pr?.bundle?.ok ? pr.bundle[key] : null;
  const previous = base?.bundle?.ok ? base.bundle[key] : null;
  const budget = pr?.bundle?.ok ? pr.bundle[maxKey] : null;
  const delta = current !== null && previous !== null ? current - previous : null;
  const headroom = current !== null && budget ? budget - current : null;
  return [
    label,
    current === null ? "unavailable" : kb(current),
    previous === null ? "—" : kb(previous),
    delta === null ? "—" : signed(delta, kb),
    budget ? kb(budget) : "—",
    headroom === null ? "—" : `${kb(headroom)} (${percent(headroom, budget)})`,
  ];
};

sections.push("", "#### Bundle budget — `npm run check:bundle-size`", "");
if (pr?.bundle?.ok || base?.bundle?.ok) {
  sections.push(
    "| | this PR | " + baseRef + " | Δ | budget | headroom left |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| raw | ${bundleRow("", "rawBytes", "maxRawBytes").slice(1).join(" | ")} |`,
    `| gzip | ${bundleRow("", "gzipBytes", "maxGzipBytes").slice(1).join(" | ")} |`,
  );
  if (pr?.bundle?.ok && pr.bundle.maxRawBytes && pr.bundle.rawBytes > pr.bundle.maxRawBytes) {
    sections.push("", "Raw size is over the budget — `check:bundle-size` fails in CI.");
  }
  if (pr?.bundle?.ok && pr.bundle.maxGzipBytes && pr.bundle.gzipBytes > pr.bundle.maxGzipBytes) {
    sections.push("", "Gzip size is over the budget — `check:bundle-size` fails in CI.");
  }
} else {
  sections.push("Unavailable — the build did not produce `dist/index.html` on either side.");
}

// --- max-lines-per-function ----------------------------------------------
sections.push("", `#### \`max-lines-per-function\` — ceiling ${pr?.complexity?.cap ?? "?"} (\`npm run check:complexity\`)`, "");
if (pr?.complexity?.ok && pr.complexity.functions?.length) {
  const cap = pr.complexity.cap;
  const baseByKey = new Map(
    (base?.complexity?.ok ? base.complexity.functions ?? [] : []).map((fn) => [`${fn.file}::${fn.name}`, fn.lines]),
  );
  const label = (fn) => fn.name.match(/'([^']+)'/)?.[1] ?? fn.name;
  sections.push(
    "| function | lines | Δ | headroom |",
    "| --- | ---: | ---: | ---: |",
    ...pr.complexity.functions.slice(0, 5).map((fn) => {
      const previous = baseByKey.get(`${fn.file}::${fn.name}`);
      // No base data at all → "—"; base data but no match → the function is
      // new here, or was renamed/moved (the key is file + declared name).
      const delta =
        typeof previous === "number"
          ? signed(fn.lines - previous, (n) => `${n}`)
          : baseByKey.size === 0
            ? "—"
            : "new";
      const headroom = cap ? `${cap - fn.lines}` : "—";
      return `| \`${label(fn)}\` <br><sub>${fn.file}:${fn.line}</sub> | ${fn.lines} | ${delta} | ${headroom} |`;
    }),
  );
  // A function outside the top 5 that this PR grew a lot still matters — it is
  // how today's mid-size component becomes tomorrow's ceiling problem.
  const listed = new Set(pr.complexity.functions.slice(0, 5).map((fn) => `${fn.file}::${fn.name}`));
  const growers = pr.complexity.functions
    .filter((fn) => {
      const previous = baseByKey.get(`${fn.file}::${fn.name}`);
      return typeof previous === "number" && fn.lines - previous >= 25 && !listed.has(`${fn.file}::${fn.name}`);
    })
    .sort((a, b) => b.lines - baseByKey.get(`${b.file}::${b.name}`) - (a.lines - baseByKey.get(`${a.file}::${a.name}`)))
    .slice(0, 3);
  if (growers.length) {
    sections.push(
      "",
      "Grew by 25+ lines in this PR (outside the top 5):",
      ...growers.map((fn) => {
        const previous = baseByKey.get(`${fn.file}::${fn.name}`);
        return `- \`${label(fn)}\` ${previous} → ${fn.lines} (${signed(fn.lines - previous, (n) => `${n}`)}) <sub>${fn.file}:${fn.line}</sub>`;
      }),
    );
  }

  const largest = pr.complexity.functions[0];
  if (cap && largest.lines > cap - 100) {
    sections.push(
      "",
      `\`${label(largest)}\` is within ${cap - largest.lines} lines of the ceiling. Past raises were paid for with a refactor, not a bigger number.`,
    );
  }
} else {
  sections.push("Unavailable — the `max-lines-per-function` probe did not run.");
}

// --- tests ----------------------------------------------------------------
sections.push("", "#### Tests — collected by `vitest list` (not executed; `ci.yml` runs them)", "");
if (pr?.tests?.ok) {
  const deltaTests = base?.tests?.ok ? signed(pr.tests.tests - base.tests.tests, (n) => `${n}`) : "—";
  const deltaFiles = base?.tests?.ok ? signed(pr.tests.files - base.tests.files, (n) => `${n}`) : "—";
  sections.push(
    "| | this PR | " + baseRef + " | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| tests | ${pr.tests.tests} | ${base?.tests?.ok ? base.tests.tests : "—"} | ${deltaTests} |`,
    `| files | ${pr.tests.files} | ${base?.tests?.ok ? base.tests.files : "—"} | ${deltaFiles} |`,
  );
} else {
  sections.push("Unavailable — test collection failed on this PR.");
}

// --- release metadata -----------------------------------------------------
sections.push("", "#### Release metadata — `npm run check:release`", "");
if (pr?.release) {
  const state = pr.release.ok ? "passes" : "**fails**";
  sections.push(
    `${state} · this PR claims \`package.json\` v${pr.version ?? "?"}${
      base?.version && base.version !== pr.version ? ` (${baseRef}: v${base.version})` : ""
    }`,
  );
  if (pr.release.message) sections.push("", `> ${pr.release.message}`);
  if (!pr.release.ok) {
    sections.push(
      "",
      "The newest heading in `docs/edit logs/` and `package.json` disagree — see the edit-log rules in `CLAUDE.md`.",
    );
  }
} else {
  sections.push("Unavailable.");
}

// --- measurement problems -------------------------------------------------
const problems = [
  ...(pr?.errors ?? []).map((error) => `this PR — ${error}`),
  ...(base?.errors ?? []).map((error) => `${baseRef} — ${error}`),
];
if (!pr) problems.push("this PR — no metrics file was produced (the metrics job failed).");
if (!base) problems.push(`${baseRef} — no metrics file was produced, so every Δ is blank.`);
if (problems.length) {
  sections.push("", "<details><summary>Measurement problems</summary>", "");
  sections.push(...problems.map((problem) => `- ${problem}`));
  sections.push("", "</details>");
}

// --- footer ---------------------------------------------------------------
const runUrl = arg("run-url", "");
sections.push(
  "",
  "---",
  `<sub>Report, not a verdict — \`ci.yml\` is the gate. This comment is edited in place on every push.${
    runUrl ? ` [Run log](${runUrl})` : ""
  }</sub>`,
);

const body = `${MARKER}\n${sections.join("\n")}\n`;
const outPath = arg("out", "pr-report.md");
writeFileSync(outPath, body);
console.log(`Wrote ${outPath} (${body.length} chars).`);
