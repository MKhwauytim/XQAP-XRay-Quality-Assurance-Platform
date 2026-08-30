#!/usr/bin/env node
// Measures the real cost of `answerStorage.ts`'s answer-save read path,
// before and after the in-memory per-tab-session `answers.events/` cache
// (see that file's own module doc, right above `readAllAnswerEventsForMonth`,
// for the full design rationale).
//
// REALISM NOTE — read before trusting any number below. This uses
// `createMemoryDirectory` (`src/data/storage/memoryDirectory.ts`), NOT a real
// filesystem adapter, unlike `bench-distribution.mjs`'s node:fs harness. That
// is a deliberate choice, not a shortcut: `memoryDirectory.ts`'s `getFile()`
// is LAZY (no content transfer) and only a later `.text()`/`.slice().text()`
// call — logged separately as a "readFile" operation — actually moves bytes,
// which correctly reproduces the real File System Access API's cost model
// this codebase's own storage-layer comments rely on throughout
// (`directoryScan.ts`'s `boundedSizeSignature`/`listDirectoryEntriesWithSize`:
// "getFile() yields a File WITHOUT transferring content ... whereas reading
// even a bounded slice of the file is a second round trip"). The node:fs
// adapter used elsewhere in this directory (`nodeDirectory.mjs`) reads a
// file's FULL content eagerly inside `getFile()` itself, which would make
// EVERY size-only stat check as expensive as a real content read and hide
// exactly the distinction this fix depends on — so it is the wrong tool for
// THIS benchmark specifically. In-memory also means wall-clock time is not a
// meaningful signal here (no real I/O latency exists to time) — the headline
// numbers below are operation counts (segment content-reads: "readFile" ops
// on `.ndjson` files), matching how the accompanying test suite
// (`src/data/answers/answerEventsCache.test.ts`) asserts the same fix.
// Wall-clock is still reported, for a rough relative sense only.
//
// Usage:
//   node scripts/bench/bench-answers.mjs [--employees=18] [--sessions=3]
//     [--events-per-session=12] [--saves=8]

import { createSrcLoader } from "./viteLoader.mjs";

function parseArgs(argv) {
  const args = { employees: 18, sessions: 3, eventsPerSession: 12, saves: 8 };
  for (const raw of argv) {
    if (raw.startsWith("--employees=")) args.employees = Number(raw.split("=")[1]);
    else if (raw.startsWith("--sessions=")) args.sessions = Number(raw.split("=")[1]);
    else if (raw.startsWith("--events-per-session=")) args.eventsPerSession = Number(raw.split("=")[1]);
    else if (raw.startsWith("--saves=")) args.saves = Number(raw.split("=")[1]);
  }
  return args;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}
function fmtMs(ms) {
  return `${ms.toFixed(2)}ms`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { loadModule, close } = await createSrcLoader();
  try {
    const { createMemoryDirectory, getOperationLog, clearOperationLog } = await loadModule(
      "src/data/storage/memoryDirectory.ts"
    );
    const { getSampleMainDir } = await loadModule("src/data/workspace/workspacePaths.ts");
    const { workspaceScopeId } = await loadModule("src/data/storage/inFlightReads.ts");
    const { appendAnswerEventSegment, readAnswerEventDelta } = await loadModule(
      "src/data/answers/answerEventStore.ts"
    );
    const { upsertItemAnswer, __resetAnswerEventsCacheForTests } = await loadModule(
      "src/data/answers/answerStorage.ts"
    );

    const MONTH = "5-may-2026";
    const BENCH_EMPLOYEE = "bench-employee";

    function ndjsonReadFileOps(dir) {
      return getOperationLog(dir).filter(
        (e) => e.operation === "readFile" && e.name.endsWith(".ndjson")
      ).length;
    }
    function allOps(dir) {
      return getOperationLog(dir).length;
    }

    function makeItem(id) {
      return {
        xrayImageId: id,
        templateId: "t1",
        templateVersion: 1,
        answers: [{ fieldId: "f1", value: `v-${id}` }],
        lastSavedAt: "2026-05-12T09:00:00.000Z",
        submittedAt: null,
        answeredBy: BENCH_EMPLOYEE,
        status: "draft",
      };
    }

    /**
     * Build a realistic multi-employee, multi-session month directly on
     * disk, bypassing `answerStorage.ts`'s write functions entirely (this is
     * SEEDING prior history, not something either the "before" or "after"
     * measurement below should pay for) — `args.employees` distinct
     * employees, each having written across `args.sessions` separate writer
     * sessions (a different device/session hash per session, so segment file
     * COUNT is realistic, not just event count), `args.eventsPerSession`
     * `item-saved` events per session.
     */
    async function seedRealisticMonth(root) {
      const mainDir = await getSampleMainDir(root, MONTH, true);
      const scopeId = `${workspaceScopeId(root)}|${MONTH}`;
      let globalEventCounter = 0;
      for (let e = 0; e < args.employees; e += 1) {
        const username = `employee-${e}`;
        for (let s = 0; s < args.sessions; s += 1) {
          const batch = [];
          if (s === 0) {
            batch.push({
              eventId: `${username}-seed`,
              eventType: "migration-seed",
              eventAt: `2026-05-01T00:00:00.${String(e).padStart(3, "0")}Z`,
              eventBy: username,
              authority: "self",
              answeredBy: username,
              legacyContentHash: "",
            });
          }
          for (let i = 0; i < args.eventsPerSession; i += 1) {
            globalEventCounter += 1;
            batch.push({
              eventId: `${username}-s${s}-e${i}`,
              eventType: "item-saved",
              eventAt: `2026-05-${String(2 + s).padStart(2, "0")}T${String(9 + (i % 8)).padStart(2, "0")}:${String(
                globalEventCounter % 60
              ).padStart(2, "0")}:00.000Z`,
              eventBy: username,
              authority: "self",
              xrayImageId: `${username}-img-${s}-${i}`,
              answers: [{ fieldId: "f1", value: `session-${s}-answer-${i}` }],
              status: "draft",
              answeredBy: username,
            });
          }
          await appendAnswerEventSegment(mainDir, batch, {
            deviceId: `${username}-device-${s}`,
            sessionId: `${username}-session-${s}`,
            scopeId,
          });
        }
      }
      return globalEventCounter;
    }

    console.log("[bench-answers] Seeding a realistic multi-employee month...");
    console.log(
      `[bench-answers]   employees=${args.employees} sessions/employee=${args.sessions} events/session=${args.eventsPerSession}`
    );

    // ── BEFORE (unfixed): readAnswerEventDelta(mainDir, {}) on every call ──
    // This is EXACTLY what the pre-fix `readAllAnswerEventsForMonth` did —
    // same function, same call shape — reproduced directly rather than
    // re-implemented, against its own freshly-seeded, uncontaminated
    // workspace so neither measurement below affects the other.
    const beforeRoot = createMemoryDirectory("bench-before", { trackOperations: true });
    const beforeEventCount = await seedRealisticMonth(beforeRoot);
    const beforeMainDir = await getSampleMainDir(beforeRoot, MONTH, true);

    const beforePerCallOps = [];
    const beforePerCallMs = [];
    for (let call = 0; call < args.saves; call += 1) {
      clearOperationLog(beforeRoot);
      const t0 = performance.now();
      await readAnswerEventDelta(beforeMainDir, {});
      beforePerCallMs.push(performance.now() - t0);
      beforePerCallOps.push(ndjsonReadFileOps(beforeRoot));
    }

    // ── AFTER (fixed): the real upsertItemAnswer, N sequential saves by the
    // SAME employee in one simulated tab session. ──
    const afterRoot = createMemoryDirectory("bench-after", { trackOperations: true });
    await seedRealisticMonth(afterRoot);
    __resetAnswerEventsCacheForTests(); // fresh tab session for this root

    const afterPerCallOps = [];
    const afterPerCallMs = [];
    const afterPerCallAllOps = [];
    for (let call = 0; call < args.saves; call += 1) {
      clearOperationLog(afterRoot);
      const t0 = performance.now();
      const result = await upsertItemAnswer(afterRoot, MONTH, BENCH_EMPLOYEE, makeItem(`bench-${call}`));
      afterPerCallMs.push(performance.now() - t0);
      if (!result.ok) throw new Error(`upsertItemAnswer failed: ${result.error}`);
      afterPerCallOps.push(ndjsonReadFileOps(afterRoot));
      afterPerCallAllOps.push(allOps(afterRoot));
    }

    const totalSegmentFiles = args.employees * args.sessions;

    console.log("\n================= BENCH SUMMARY (bench-answers.mjs) =================");
    console.log("REALISM: in-memory createMemoryDirectory adapter (see header comment for");
    console.log("why this, not node:fs, is the right tool for this specific benchmark).");
    console.log("Headline metric: '.ndjson content-read ops' (readFile ops on segment files —");
    console.log("a free size-only stat vs an actual byte transfer are DISTINCT ops here, exactly");
    console.log("matching the real File System Access API's cost model). Wall-clock is");
    console.log("informational only; there is no real I/O latency in this harness to time.\n");

    console.log(`Employees:                    ${args.employees}`);
    console.log(`Sessions / employee:          ${args.sessions}`);
    console.log(`Events / session:             ${args.eventsPerSession}`);
    console.log(`Total seeded segment files:   ${fmt(totalSegmentFiles)}`);
    console.log(`Total seeded events:          ${fmt(beforeEventCount)}`);
    console.log(`Sequential saves measured:    ${args.saves} (same employee, one simulated tab)\n`);

    console.log("── BEFORE THIS FIX — every call does readAnswerEventDelta(mainDir, {}) ──");
    console.log(
      "  (this is the exact call `readAllAnswerEventsForMonth` made on every single write, per call, before the cache)"
    );
    console.log(`  .ndjson content-read ops per call: [${beforePerCallOps.join(", ")}]`);
    console.log(`  wall time per call (informational): [${beforePerCallMs.map((m) => m.toFixed(2)).join(", ")}] ms`);
    console.log(
      `  total .ndjson content-read ops across ${args.saves} calls: ${fmt(
        beforePerCallOps.reduce((a, b) => a + b, 0)
      )}`
    );

    console.log("\n── AFTER THIS FIX — real upsertItemAnswer, same employee, same tab session ──");
    console.log(`  .ndjson content-read ops per call: [${afterPerCallOps.join(", ")}]`);
    console.log(`  ALL adapter ops per call (for reference): [${afterPerCallAllOps.join(", ")}]`);
    console.log(`  wall time per call (informational): [${afterPerCallMs.map((m) => m.toFixed(2)).join(", ")}] ms`);
    console.log(
      `  total .ndjson content-read ops across ${args.saves} calls: ${fmt(
        afterPerCallOps.reduce((a, b) => a + b, 0)
      )}`
    );

    const beforeTotal = beforePerCallOps.reduce((a, b) => a + b, 0);
    const afterTotal = afterPerCallOps.reduce((a, b) => a + b, 0);
    const beforeWarmAvg =
      beforePerCallOps.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, beforePerCallOps.length - 1);
    const afterWarmAvg =
      afterPerCallOps.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, afterPerCallOps.length - 1);

    console.log("\n── COMPARISON ─────────────────────────────────────────────────────────");
    console.log(`  first (cold) call: before=${beforePerCallOps[0]}  after=${afterPerCallOps[0]}`);
    console.log(
      `  average WARM call (calls 2..${args.saves}): before=${beforeWarmAvg.toFixed(
        1
      )}  after=${afterWarmAvg.toFixed(1)}  ` +
        `(${(beforeWarmAvg / Math.max(afterWarmAvg, 0.001)).toFixed(1)}x fewer content-read ops per warm save)`
    );
    console.log(
      `  total across ${args.saves} sequential saves: before=${fmt(beforeTotal)}  after=${fmt(afterTotal)}  ` +
        `(${(beforeTotal / Math.max(afterTotal, 1)).toFixed(1)}x fewer overall)`
    );
    console.log(
      "\nNote: `after` calls 2+ still show a small non-zero op count — that is the write\n" +
        "path's OWN unavoidable pre-write 'read the existing segment before rewriting it'\n" +
        "step (`appendEventSegment` in `appendOnlyEventLog.ts` — there is no true positional-\n" +
        "append primitive), which existed before this fix and is unaffected by it. It scales\n" +
        "only with this one employee's own open segment, never with total team history — the\n" +
        "`beforeWarmAvg` column above scales with `employees * sessions` instead, which is the\n" +
        "whole point of the fix."
    );
    console.log("===========================================================================\n");
  } finally {
    await close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bench-answers] FAILED:", err);
    process.exit(1);
  });
