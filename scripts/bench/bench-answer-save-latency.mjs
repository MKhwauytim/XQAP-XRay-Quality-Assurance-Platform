#!/usr/bin/env node
// STAGE 3 VALIDATION INFRASTRUCTURE for
// docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md.
//
// This is not application code — it exists to answer one question the whole
// rewrite is justified by (§0's history, §12's Stage 3 line): does a per-save
// answer write get progressively slower as an employee's answer count grows
// within a month, and does the append-only replacement actually fix that?
//
// The original investigation (pre-proposal) measured ~9 whole-file passes per
// save and 125ms→348ms growth at N=10/100/500/1000 existing answers, using
// createMemoryDirectory() and the app's real functions — this script
// reproduces that methodology so the "before" number is a real measurement,
// not a recollection, and adds the "after" side now that Stage 1
// (answerEventStore.ts) exists.
//
// WHAT THIS MEASURES, PER §12'S STAGE 3 LINE ("append-only save cost,
// excluding the now-async cache refresh, measured separately"):
//
//   BEFORE — the real, pre-Stage-2 `upsertItemAnswer` (whole-file
//   read-modify-write, at N = 10/100/500/1000 prior items already in the
//   file). Stage 2 has since replaced this function IN PLACE with the
//   event-log-backed version, so this script can no longer re-derive that
//   number live from the current tree — see `LEGACY_BASELINE_MEDIAN_MS`'s own
//   comment for why, and for the real numbers this repo already measured
//   against the genuine legacy code before it was migrated away.
//
//   AFTER (wired, the default) — Stage 2's real, production `upsertItemAnswer`
//   from src/data/answers/answerStorage.ts, now backed by the event log (with
//   its in-memory per-tab read cache) instead of a whole-file rewrite.
//
//   AFTER (primitive, still available) — Stage 1's `appendAnswerEventSegment`
//   from src/data/answers/answerEventStore.ts directly, appending ONE new
//   event onto N prior events already durably on disk. Useful for isolating
//   the append primitive's own cost from the wired write's surrounding logic
//   (migration-seed resolution, the read-cache, cache-refresh) — flip
//   `NEW_PATH_BACKEND` to `"primitive"` to use it.
//
//   FOLD (measured separately, per §12) — `foldAnswerEvents` over all N+1
//   events, characterizing the cost §5's async cache-refresh pattern moves off
//   the save's own critical path.
//
// CRITICAL HONESTY NOTE — read before trusting any absolute ms below.
//
// createMemoryDirectory() is pure in-process JS with NO simulated I/O latency
// at all — not even the real-disk cost scripts/bench/nodeDirectory.mjs has for
// the distribution benchmark, let alone Chromium's real File System Access
// swap-file + verification pipeline (createWritable/close/getFile round
// trips), which is the actual bottleneck production users experience. So the
// absolute millisecond figures below are NOT a browser-experience prediction —
// they are dominated by JSON.stringify/parse and array-copy cost, not by any
// fixed per-file overhead a real share would add on top.
//
// What IS faithful, because every operation below calls the app's real code
// (safeWriteJson, casLoop, upsertItemAnswer, appendAnswerEventSegment,
// foldAnswerEvents — nothing here reimplements any of it): the SHAPE of the
// growth curve. The legacy path rewrites `existing items + 1` as one JSON
// blob on every save, so its cost is expected to grow with N. The append path
// rewrites only the CURRENT OPEN SEGMENT (capped at ~128 KiB / ~500 events by
// MAX_OPEN_SEGMENT_BYTES/MAX_OPEN_SEGMENT_LINES in appendOnlyEventLog.ts,
// after which it rotates to a fresh, empty segment), so its cost is expected
// to stay roughly flat across N instead of climbing — that is the entire
// point of the rewrite, and this harness is what turns "expected" into
// "measured."
//
// A SECOND, UNRELATED FIXED COST ALSO SHOWS UP ON EVERY LEGACY SAVE, seed
// writes included: `updateEmployeeAnswerFile` (answerStorage.ts) hands casLoop
// a `verify` callback (B-XQIO032's lost-update guard, casLoop.ts), which makes
// EVERY successful write sleep a real ~80–180ms (`VERIFY_MIN/MAX_DELAY_MS`)
// before returning, regardless of file size. That sleep is real production
// behavior on the highest-stakes write in the app, so it belongs in the
// TIMED number — but it also means seeding N prior answers (untimed, but not
// un-slept) is what makes this script slow to RUN at N=1000, not a hang or a
// bug in this harness. It also means the growth-with-N story is visible as an
// ADDITIONAL delta on top of a roughly-constant ~130ms floor, not as the
// whole number — pass a larger --trials to average it down if the floor's own
// jitter (±50ms) is obscuring the trend at your N values. The append path has
// no equivalent sleep (a writer-session chain can't collide with another
// writer's by construction, so it doesn't need this settle window), which is
// itself part of the real difference this benchmark exists to surface.
//
// Usage:
//   node scripts/bench/bench-answer-save-latency.mjs [--n=10,100,500,1000] [--trials=30]

import { createSrcLoader } from "./viteLoader.mjs";

function parseArgs(argv) {
  const args = { n: [10, 100, 500, 1000], trials: 30 };
  for (const raw of argv) {
    if (raw.startsWith("--n=")) {
      args.n = raw
        .slice("--n=".length)
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0);
    } else if (raw.startsWith("--trials=")) {
      args.trials = Math.max(1, Number(raw.slice("--trials=".length)));
    }
  }
  return args;
}

function fmtMs(ms) {
  return `${ms.toFixed(2)}ms`;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** More robust than mean against casLoop's uniform-random verify-settle sleep (see header). */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const MONTH = "5-may-2026";
const USERNAME = "bench.emp01";

/** A realistic-sized answer payload — several fields incl. Arabic text, matching
 *  appendOnlyEventLog.ts's own "~258 bytes per event line" measurement basis. */
function buildAnswers(i) {
  return [
    { fieldId: "quality-overall", value: i % 4 === 0 ? "ضعيف" : "جيد" },
    { fieldId: "exposure-correct", value: i % 3 !== 0 },
    {
      fieldId: "positioning-notes",
      value: `ملاحظات تفصيلية حول وضعية المريض للعنصر رقم ${i} وجودة الأشعة الملتقطة خلال الفحص الدوري لضمان مطابقة معايير الجودة.`,
    },
    { fieldId: "repeat-count", value: i % 3 },
    { fieldId: "reviewer-comment", value: "تمت المراجعة والموافقة على الإجابة بعد التحقق من جميع الحقول المطلوبة." },
  ];
}

function eventAtFor(i) {
  // Spread across a realistic month so events don't all share one instant
  // (which would exercise the authority tie-break instead of the common case).
  const day = 1 + (i % 27);
  const minute = i % 1440;
  return new Date(Date.UTC(2026, 4, day, 0, minute)).toISOString();
}

function makeLegacyItem(i) {
  const at = eventAtFor(i);
  return {
    xrayImageId: `X${i}`,
    templateId: "chest-xray-v3",
    templateVersion: 3,
    answers: buildAnswers(i),
    lastSavedAt: at,
    submittedAt: at,
    answeredBy: USERNAME,
    status: "submitted",
  };
}

function makeSeedEvent() {
  return {
    eventId: "seed-0",
    eventType: "migration-seed",
    eventAt: eventAtFor(0),
    eventBy: USERNAME,
    authority: "self",
    legacyContentHash: "", // no legacy file — a brand-new employee chain (§8)
  };
}

function makeSavedEvent(i) {
  const at = eventAtFor(i);
  return {
    eventId: `e${i}`,
    eventType: "item-saved",
    eventAt: at,
    eventBy: USERNAME,
    authority: "self",
    xrayImageId: `X${i}`,
    templateId: "chest-xray-v3",
    templateVersion: 3,
    answers: buildAnswers(i),
    status: "submitted",
    answeredBy: USERNAME,
  };
}

/* ─────────────────────────── BEFORE: legacy path ─────────────────────────── */

/**
 * Today's real `upsertItemAnswer`, exactly as it exists on `main` right now —
 * this file does not import from a Stage-2 branch and must not: Stage 2 is
 * being implemented elsewhere and this benchmark is deliberately independent
 * of it (it measures the baseline Stage 2 will be compared against later).
 */
/**
 * Seeds ONCE to N items, then takes `trials` sequential TIMED samples (saving
 * item N, N+1, …) on top of that same file, rather than re-seeding fresh per
 * trial. Two reasons, not just speed:
 *
 * 1. Every successful `upsertItemAnswer` call — seed writes included — pays
 *    casLoop's real ~80–180ms post-write verify-settle sleep (see the header
 *    comment). Re-seeding to N=1000 from scratch for EACH of several trials
 *    would multiply that fixed sleep by the trial count for no benefit; the
 *    on-disk file shape this benchmark cares about (N items already present)
 *    is identical whether it was just seeded or seeded `trials` samples ago.
 * 2. That same ~80–180ms sleep is uniform-random and roughly N-independent,
 *    so a SINGLE timed sample is mostly noise. Several sequential samples
 *    (each still a real, independent casLoop attempt with its own sleep draw)
 *    let the median/min below separate the real, N-dependent JSON cost from
 *    that fixed floor.
 */
/**
 * Real "before" measurements, captured earlier in this same investigation
 * against the genuine pre-Stage-2 `upsertItemAnswer` (commit range
 * 8172381..f15aa43, i.e. Stage 1 merged, Stage 2 not yet wired — the last
 * point in this repo's history where the whole-file-rewrite `upsertItemAnswer`
 * still existed to measure). This script cannot re-derive that number today:
 * Stage 2 replaced `upsertItemAnswer` IN PLACE with the event-log-backed
 * version (that's the whole point of the migration), so `measureLegacy`
 * calling `upsertItemAnswer` from the current tree would now measure the
 * SAME function `NEW_PATH_BACKENDS.wired` measures — "after vs after," not
 * "before vs after." Rather than silently produce that misleading
 * comparison, this fixed table stands in for a live "before" run. Method:
 * identical to `measureLegacy` below (createMemoryDirectory, N untimed seed
 * saves, 30 timed saves at N, median as the primary column).
 */
const LEGACY_BASELINE_MEDIAN_MS = { 10: 134.25, 100: 144.86, 500: 205.25, 1000: 199.75 };

async function measureLegacy({ createMemoryDirectory, upsertItemAnswer }, n, trials) {
  const dir = createMemoryDirectory();
  // Seed N prior answers via the SAME real write path (untimed) — this is
  // what makes the file's on-disk shape (size, JSON structure) identical to
  // what N real employee saves would have produced.
  for (let i = 0; i < n; i++) {
    const result = await upsertItemAnswer(dir, MONTH, USERNAME, makeLegacyItem(i));
    if (!result.ok) throw new Error(`legacy seed save ${i} failed: ${result.error}`);
  }
  // Time `trials` sequential saves on top of the N already-seeded items — the
  // whole-file rewrite this proposal exists to replace. `trials` is kept small
  // relative to N so each sample is still representative of "saving into a
  // file with ~N items."
  const samples = [];
  for (let trial = 0; trial < trials; trial++) {
    const start = performance.now();
    const result = await upsertItemAnswer(dir, MONTH, USERNAME, makeLegacyItem(n + trial));
    const ms = performance.now() - start;
    if (!result.ok) throw new Error(`legacy timed save at n=${n}+${trial} failed: ${result.error}`);
    samples.push(ms);
  }
  return samples;
}

/* ───────────────────────── AFTER: append-only path ────────────────────────── */

/**
 * Two backends for the "new path" measurement, selected by NEW_PATH_BACKEND
 * below. Both share the exact same call shape (`run({ n, trial, loader })` ->
 * `{ appendMs, foldMs }`), so switching which one `main()` uses is a
 * one-line edit — see the TODO in `wired` for what Stage 2 needs to fill in.
 */
const NEW_PATH_BACKENDS = {
  /**
   * Stage 1's raw primitive — `appendAnswerEventSegment` — since Stage 1 has
   * zero production callers yet (per answerEventStore.ts's own header). Builds
   * a real N-event history via the real append path (migration-seed + N-1
   * item-saved events, one append call each, matching how a month's saves
   * actually accumulate), then times ONE more append.
   */
  async primitive({ loader, n, trial }) {
    const { createMemoryDirectory } = await loader.loadModule("src/data/storage/memoryDirectory.ts");
    const { appendAnswerEventSegment, foldAnswerEvents, readAnswerEventDelta } = await loader.loadModule(
      "src/data/answers/answerEventStore.ts"
    );
    const { __resetAppendOnlyEventLogMemosForTests } = await loader.loadModule(
      "src/data/storage/appendOnlyEventLog.ts"
    );
    __resetAppendOnlyEventLogMemosForTests();

    const dir = createMemoryDirectory();
    const writer = {
      deviceId: "bench-device",
      sessionId: "bench-session",
      // Unique per (n, trial) so this run's writer chain can never be confused
      // with another's in the module-level memo Maps (segmentMemoKey keys on
      // consumerNamespace|scopeId|name) — see appendOnlyEventLog.ts's
      // "NAMESPACED PER CONSUMER" note for why that key shape matters.
      scopeId: `bench|n${n}|t${trial}`,
    };

    // Seed N prior events via the real append path (untimed) — one append per
    // event, exactly like N real saves, so rotation behaves exactly as it
    // would in production (a segment seals at ~128 KiB / ~500 events and a
    // fresh one opens, per MAX_OPEN_SEGMENT_BYTES/MAX_OPEN_SEGMENT_LINES).
    const seedEvents = [makeSeedEvent(), ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => makeSavedEvent(i + 1))];
    for (const event of seedEvents) {
      const verification = await appendAnswerEventSegment(dir, [event], writer);
      if (verification !== "verified") {
        throw new Error(`append primitive seed event ${event.eventId} at n=${n} came back "${verification}"`);
      }
    }

    // Time ONLY the (n+1)th append.
    const oneMore = makeSavedEvent(n);
    const appendStart = performance.now();
    const verification = await appendAnswerEventSegment(dir, [oneMore], writer);
    const appendMs = performance.now() - appendStart;
    if (verification !== "verified") {
      throw new Error(`append primitive timed append at n=${n} came back "${verification}"`);
    }

    // §12: "excluding the now-async cache refresh, measured separately" — read
    // back every event this chain now holds (N+1 of them) and time the fold on
    // its own, off the append's critical path.
    const delta = await readAnswerEventDelta(dir, {});
    const foldStart = performance.now();
    const foldResult = foldAnswerEvents(delta.events, { username: USERNAME, monthFolderName: MONTH });
    const foldMs = performance.now() - foldStart;
    // n events were seeded (1 migration-seed + (n-1) item-saved), plus the one
    // timed append -> n distinct item-saved events -> n items in the fold.
    if (n > 0 && foldResult.file.items.length !== n) {
      throw new Error(
        `append primitive fold at n=${n} produced ${foldResult.file.items.length} items, expected ${n}`
      );
    }

    return { appendMs, foldMs };
  },

  /**
   * Stage 2's real, production-wired `upsertItemAnswer` — the true "after"
   * counterpart to `measureLegacy`'s "before": same function name, same call
   * shape, now backed by the event log (with its in-memory per-tab read
   * cache, `answerStorage.ts`'s `readAllAnswerEventsForMonth`) instead of a
   * whole-file rewrite. Each `dir` is fresh per (n, trial), so every run here
   * is a cold-cache first read for its own N — this measures the append path
   * itself, not the warm-cache win (that's `scripts/bench/bench-answers.mjs`'s
   * job, at team-month scale). The wired write's own derived-state refresh is
   * internal/awaited-but-cheap (§5/§6: `bumpWorkspaceEpoch`, no I/O), so there
   * is no separate fold step to time here the way the primitive backend has
   * one — `foldMs` stays `null`.
   */
  async wired({ loader, n, trial }) {
    const { createMemoryDirectory } = await loader.loadModule("src/data/storage/memoryDirectory.ts");
    const { upsertItemAnswer, __resetAnswerEventsCacheForTests } = await loader.loadModule(
      "src/data/answers/answerStorage.ts"
    );
    const { __resetAppendOnlyEventLogMemosForTests } = await loader.loadModule(
      "src/data/storage/appendOnlyEventLog.ts"
    );
    __resetAppendOnlyEventLogMemosForTests();
    __resetAnswerEventsCacheForTests();

    const dir = createMemoryDirectory();
    for (let i = 0; i < n; i++) {
      const result = await upsertItemAnswer(dir, MONTH, USERNAME, makeLegacyItem(i));
      if (!result.ok) throw new Error(`wired seed save ${i} at n=${n}, trial ${trial} failed: ${result.error}`);
    }

    const start = performance.now();
    const result = await upsertItemAnswer(dir, MONTH, USERNAME, makeLegacyItem(n));
    const appendMs = performance.now() - start;
    if (!result.ok) throw new Error(`wired timed save at n=${n}, trial ${trial} failed: ${result.error}`);
    return { appendMs, foldMs: null };
  },
};

/** Which NEW_PATH_BACKENDS entry `main()` measures. */
const NEW_PATH_BACKEND = "wired";

async function measureNewPath(loader, n, trials) {
  const backend = NEW_PATH_BACKENDS[NEW_PATH_BACKEND];
  const appendSamples = [];
  const foldSamples = [];
  for (let trial = 0; trial < trials; trial++) {
    const { appendMs, foldMs } = await backend({ loader, n, trial });
    appendSamples.push(appendMs);
    if (typeof foldMs === "number") foldSamples.push(foldMs);
  }
  return { appendSamples, foldSamples };
}

/* ──────────────────────────────── runner ──────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[bench] N values: ${args.n.join(", ")}   trials/N: ${args.trials}   new-path backend: "${NEW_PATH_BACKEND}"\n`);

  const usingFixedLegacyBaseline = NEW_PATH_BACKEND === "wired";
  if (usingFixedLegacyBaseline) {
    console.log(
      "[bench] NEW_PATH_BACKEND is \"wired\": upsertItemAnswer is now Stage 2's event-log-backed\n" +
        "        version, so a live \"legacy\" measurement would call the exact same function this\n" +
        "        script is trying to compare it against. Using the fixed pre-Stage-2 baseline\n" +
        "        (LEGACY_BASELINE_MEDIAN_MS) instead — see that constant's comment for provenance.\n"
    );
  }

  const loader = await createSrcLoader();
  try {
    const { createMemoryDirectory } = await loader.loadModule("src/data/storage/memoryDirectory.ts");
    const { upsertItemAnswer } = await loader.loadModule("src/data/answers/answerStorage.ts");

    const rows = [];
    for (const n of args.n) {
      let legacySamples;
      if (usingFixedLegacyBaseline) {
        process.stdout.write(`[bench] n=${n} ... legacy (fixed baseline)`);
        const fixed = LEGACY_BASELINE_MEDIAN_MS[n];
        if (fixed === undefined) {
          throw new Error(
            `No fixed legacy baseline recorded for n=${n}. LEGACY_BASELINE_MEDIAN_MS only has ` +
              `${Object.keys(LEGACY_BASELINE_MEDIAN_MS).join(", ")} — pass --n=10,100,500,1000, or ` +
              `re-measure legacy against a pre-Stage-2 checkout and extend the table.`
          );
        }
        legacySamples = [fixed]; // median/mean/min/max of a single fixed point all equal it — intentional.
      } else {
        process.stdout.write(`[bench] n=${n} ... legacy`);
        legacySamples = await measureLegacy({ createMemoryDirectory, upsertItemAnswer }, n, args.trials);
      }
      process.stdout.write(" ok, append");
      const { appendSamples, foldSamples } = await measureNewPath(loader, n, args.trials);
      process.stdout.write(" ok\n");
      rows.push({
        n,
        legacyMedian: median(legacySamples),
        legacyMs: mean(legacySamples),
        legacyMin: Math.min(...legacySamples),
        legacyMax: Math.max(...legacySamples),
        appendMedian: median(appendSamples),
        appendMs: mean(appendSamples),
        appendMin: Math.min(...appendSamples),
        appendMax: Math.max(...appendSamples),
        foldMs: foldSamples.length > 0 ? mean(foldSamples) : null,
      });
    }

    console.log("\n================ BENCH SUMMARY (bench-answer-save-latency.mjs) ================");
    console.log("REALISM: createMemoryDirectory() has NO simulated I/O latency at all — see the");
    console.log("header comment. Absolute ms are not a browser prediction; the GROWTH SHAPE across");
    console.log("N is the faithful part, because every call below is the app's real code. MEDIAN is");
    console.log("the primary column — it is far less distorted than the mean by casLoop's uniform");
    console.log(`~80-180ms verify-settle sleep on every legacy save (see header). ${args.trials} timed samples/N.\n`);

    console.log("N (prior answers)  |  legacy save: median (mean/min/max ms)          |  append: median (mean/min/max ms)              |  fold N events (mean ms)");
    console.log("----------------------------------------------------------------------------------------------------------------------------------------------");
    for (const row of rows) {
      console.log(
        `${String(row.n).padStart(18)}  |  ${fmtMs(row.legacyMedian).padStart(8)}  (${fmtMs(row.legacyMs).padStart(8)} / ${fmtMs(row.legacyMin).padStart(8)} / ${fmtMs(row.legacyMax).padStart(8)})  |  ` +
          `${fmtMs(row.appendMedian).padStart(8)}  (${fmtMs(row.appendMs).padStart(8)} / ${fmtMs(row.appendMin).padStart(8)} / ${fmtMs(row.appendMax).padStart(8)})  |  ` +
          `${row.foldMs === null ? "n/a".padStart(10) : fmtMs(row.foldMs).padStart(10)}`
      );
    }

    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first && last && first.n !== last.n) {
      const legacyGrowth = first.legacyMedian > 0 ? last.legacyMedian / first.legacyMedian : Number.NaN;
      const appendGrowth = first.appendMedian > 0 ? last.appendMedian / first.appendMedian : Number.NaN;
      const foldGrowth =
        first.foldMs && last.foldMs && first.foldMs > 0 ? last.foldMs / first.foldMs : null;
      console.log(`\nGrowth from N=${first.n} to N=${last.n} (median):`);
      console.log(`  legacy whole-file save:  ${legacyGrowth.toFixed(2)}x   (expected: grows with N)`);
      console.log(
        `  append-only ${NEW_PATH_BACKEND}${NEW_PATH_BACKEND === "wired" ? " (real production write)" : ""}: ` +
          (NEW_PATH_BACKEND === "wired"
            ? // The WIRED backend times upsertItemAnswer end to end, not just the
              // append: every call also folds this employee's full accumulated
              // event list from scratch to compute `previous` (performAnswerWrite
              // -> foldEmployeeEvents — see answerStorage.ts's cache doc, "Every
              // call to foldEmployeeEvents still folds the complete accumulated
              // raw-event list from scratch"). ONLY the disk-read/rewrite half is
              // ~flat (segment rotation caps it, and the cache makes a warm read
              // cheap); the fold half is genuinely O(N) in this ONE employee's own
              // item count — never in total team activity, which is the scaling
              // this whole rewrite exists to remove. So real growth here, bounded
              // by one employee's own monthly item count, is expected — it is not
              // the "expected: ~flat" claim that describes the primitive backend's
              // pure append cost below.
              `${appendGrowth.toFixed(2)}x   (expected: grows with N — this is per-save fold cost over one ` +
              `employee's own item history, not disk cost; see the comment above this line)`
            : `${appendGrowth.toFixed(2)}x   (expected: ~flat — segment rotation caps rewrite size)`)
      );
      console.log(
        `  fold N events (mean):    ${foldGrowth === null ? "n/a — " + NEW_PATH_BACKEND + " backend has no separate fold step (see NEW_PATH_BACKENDS.wired's own comment)" : foldGrowth.toFixed(2) + "x   (expected: grows with N — this is the async-refresh cost §12 asks to measure separately)"}`
      );
    }
    console.log("===================================================================================\n");
  } finally {
    await loader.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bench-answer-save-latency] FAILED:", err);
    process.exit(1);
  });
