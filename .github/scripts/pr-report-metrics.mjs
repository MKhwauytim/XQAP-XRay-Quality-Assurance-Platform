#!/usr/bin/env node
// Collects one side's (PR head or base) numbers for the PR report.
//
// Contract: this script NEVER throws and always exits 0. Every measurement is
// individually guarded and a failure is recorded in the output JSON, so the
// report can print "unavailable" for one number instead of turning the whole
// workflow red. CI (`ci.yml`) is the gate; this is only a reporter.
//
// Usage: node pr-report-metrics.mjs --out <file> [--side pr|base] [--sha <sha>]
// Run with cwd = the checkout being measured. The script is always taken from
// the PR's checkout, so both sides are measured by identical code.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const cwd = process.cwd();
const outPath = arg("out", "metrics.json");
const STEP_TIMEOUT_MS = 15 * 60_000;
// eslint's JSON report with the probe rule below is ~11 MB on this repo.
const MAX_BUFFER = 512 * 1024 * 1024;

const result = {
  schema: 1,
  side: arg("side", "pr"),
  sha: arg("sha", ""),
  version: null,
  bundle: null,
  complexity: null,
  tests: null,
  release: null,
  errors: [],
};

const fail = (step, error) => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`${step}: ${message.split("\n").slice(0, 4).join(" ").slice(0, 500)}`);
  return null;
};

/** Spawn a local binary. Returns { status, stdout, stderr } and never throws. */
const run = (command, commandArgs, options = {}) => {
  const spawned = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: STEP_TIMEOUT_MS,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
    ...options,
  });
  if (spawned.error) throw spawned.error;
  if (spawned.signal) throw new Error(`killed by signal ${spawned.signal} (timeout?)`);
  return spawned;
};

const localBin = (name) => {
  const binPath = path.join(cwd, "node_modules", ".bin", name);
  if (!existsSync(binPath)) throw new Error(`${name} is not installed at ${binPath}`);
  return binPath;
};

const readText = (relativePath) => readFileSync(path.join(cwd, relativePath), "utf8");

// --- package.json version -----------------------------------------------
let packageJson = {};
try {
  packageJson = JSON.parse(readText("package.json"));
  result.version = packageJson.version ?? null;
} catch (error) {
  fail("package.json", error);
}

// --- build + bundle size -------------------------------------------------
// Mirrors scripts/check-bundle-size.mjs exactly (gzip level 9 over
// dist/index.html) and reads that script's own budget constants, so the
// reported headroom can never drift from the gate.
try {
  const build = run("npm", ["run", "build"]);
  if (build.status !== 0) {
    throw new Error(`npm run build exited ${build.status}. ${(build.stderr || build.stdout || "").trim().slice(-400)}`);
  }
  const bundle = readFileSync(path.join(cwd, "dist", "index.html"));
  const budgetSource = readText("scripts/check-bundle-size.mjs");
  const budget = (name) => {
    const match = budgetSource.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
    return match ? Number(match[1].replaceAll("_", "")) : null;
  };
  result.bundle = {
    ok: true,
    rawBytes: bundle.byteLength,
    gzipBytes: gzipSync(bundle, { level: 9 }).byteLength,
    maxRawBytes: budget("MAX_BYTES"),
    maxGzipBytes: budget("MAX_GZIP_BYTES"),
  };
} catch (error) {
  result.bundle = { ok: false };
  fail("build/bundle-size", error);
}

// --- max-lines-per-function headroom -------------------------------------
// `check:complexity` only reports functions ALREADY over the cap. Re-running
// the same rule with a cap of 1 makes every function report its own line
// count in the message, which is how we can show headroom before the gate
// trips. Counting options are the rule defaults in both cases, so the numbers
// are directly comparable to the real ceiling.
try {
  const capMatch = String(packageJson?.scripts?.["check:complexity"] ?? "").match(
    /max-lines-per-function:\s*\[\s*error\s*,\s*(\d+)/,
  );
  const cap = capMatch ? Number(capMatch[1]) : null;
  const eslint = run(localBin("eslint"), [
    "src",
    "--format",
    "json",
    "--no-warn-ignored",
    "--rule",
    "max-lines-per-function: [error, 1]",
  ]);
  // Exit status 1 just means "the probe rule reported", which is the point.
  const payload = (eslint.stdout || "").trim();
  if (!payload.startsWith("[")) {
    throw new Error(`eslint produced no JSON. ${(eslint.stderr || "").trim().slice(-400)}`);
  }
  const files = JSON.parse(payload);
  const functions = [];
  for (const file of files) {
    for (const message of file.messages ?? []) {
      if (message.ruleId !== "max-lines-per-function") continue;
      const lines = Number(message.message.match(/has too many lines \((\d+)\)/)?.[1]);
      if (!Number.isFinite(lines)) continue;
      functions.push({
        lines,
        name: message.message.replace(/ has too many lines[\s\S]*$/, "").trim(),
        file: path.relative(cwd, file.filePath).split(path.sep).join("/"),
        line: message.line,
      });
    }
  }
  functions.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
  result.complexity = { ok: true, cap, total: functions.length, functions: functions.slice(0, 25) };
} catch (error) {
  result.complexity = { ok: false };
  fail("max-lines-per-function probe", error);
}

// --- test count ----------------------------------------------------------
// `vitest list` collects without running, so this is far cheaper than a full
// `test:run` and still counts `.each` expansions the way the suite does.
try {
  const listed = run(localBin("vitest"), ["list", "--json"]);
  const payload = (listed.stdout || "").trim();
  const start = payload.indexOf("[");
  if (start === -1) {
    throw new Error(`vitest list produced no JSON. ${(listed.stderr || "").trim().slice(-400)}`);
  }
  const tests = JSON.parse(payload.slice(start));
  result.tests = {
    ok: true,
    tests: tests.length,
    files: new Set(tests.map((test) => test.file)).size,
  };
} catch (error) {
  result.tests = { ok: false };
  fail("vitest list", error);
}

// --- release / edit-log consistency --------------------------------------
try {
  const release = run("npm", ["run", "--silent", "check:release"]);
  result.release = {
    ok: release.status === 0,
    message: ((release.status === 0 ? release.stdout : release.stderr || release.stdout) || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(">") && !line.startsWith("npm "))
      .slice(-3)
      .join(" ")
      .slice(0, 300),
  };
} catch (error) {
  result.release = { ok: false, message: "" };
  fail("check:release", error);
}

writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${outPath} (${result.errors.length} measurement error(s)).`);
process.exit(0);
