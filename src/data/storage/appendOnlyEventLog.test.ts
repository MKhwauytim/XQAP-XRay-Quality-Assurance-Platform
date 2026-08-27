// Fault-injection suite for the GENERIC append-only event log.
//
// Deliberately written in generic vocabulary against a synthetic minimal event
// (`{ eventId, eventAt, seq }`) with no distribution and no answers fields. The
// point is to prove the guarantees belong to the MECHANICS rather than to one
// consumer's event shape: distribution's own suite
// (`distributionEventSegmentRotation.test.ts`, `segmentVerifyNotAFailure.test.ts`,
// `distributionCheckpointSidecar.test.ts`) pins the same guarantees through
// distribution's types, and every scenario here is a generic re-expression of
// one of those — not a newly invented one.
//
// Two things are pinned here that nothing pinned before (round 3's Findings 2
// and 4):
//   * the literal segment file NAME for fixed inputs, so a change to the naming
//     format is caught explicitly rather than passing because both sides of
//     some future comparison moved together; and
//   * which RETRY LADDER each code path takes, via a captured clock, so a
//     refactor cannot silently swap "the first append of a session resolves
//     promptly" for "it sleeps ~11 s" and stay green.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearErrors,
  getRecentErrors,
} from "./errorLogger";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  setSimulatedFaults,
} from "./memoryDirectory";
import { listDirectoryEntries } from "./directoryScan";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
} from "./transientFileErrors";
import {
  MAX_OPEN_SEGMENT_BYTES,
  MAX_SEGMENT_SEQ,
  type AppendOnlyEventLogConfig,
  type FoldOrderComparison,
  __resetAppendOnlyEventLogMemosForTests,
  appendEventSegment,
  buildSegmentBaseName,
  checkpointResumeVerdict,
  chunkEventsForSegmentAppends,
  eventSetDigest,
  filterAlreadyFolded,
  isEventOutOfOrder,
  maxSegmentBaseNameChars,
  readEventSegmentDelta,
  segmentFileName,
  sortEventsForFold,
} from "./appendOnlyEventLog";

/* ───────────────────────────── synthetic fixtures ───────────────────────── */

/** The minimal shape this module actually requires: an id and an order key. */
type TestEvent = {
  eventId: string;
  eventAt: string;
  seq: number;
  /** Only to make an event large enough to cross the rotation cap. */
  filler?: string;
};

const EVENTS_DIR = "test.events";
const SUFFIX = ".ndjson";

const TEST_LOG: AppendOnlyEventLogConfig = {
  consumerNamespace: "tst",
  eventsDirName: EVENTS_DIR,
  segmentSuffix: SUFFIX,
  diagnostics: {
    writeContext: "test:append-segment",
    rereadContext: "test:segment-reread",
    verifyContext: "test:segment-verify",
    cannotWriteCode: "XQ-DIST-006",
    unverifiedCode: "XQ-DIST-007",
    sizeMismatchCode: "XQ-DIST-008",
    segmentParseError: (name) => `Cannot parse test event segment: ${name}`,
    verificationFailedError: (fileName, expected, observed) =>
      `Test segment write verification failed: ${fileName} (expected ${expected}, saw ${observed})`,
  },
};

const WRITER = { deviceId: "device-a", sessionId: "session-a", scopeId: "scope-1" };

/** ~20 KB per line, so a handful of appends crosses the 128 KiB cap. */
const FILLER = "x".repeat(20_000);

let nextSeq = 0;

function event(id: string, at = "2026-08-27T10:00:00.000Z"): TestEvent {
  nextSeq += 1;
  return { eventId: `evt-${id}`, eventAt: at, seq: nextSeq };
}

function bigEvent(id: string): TestEvent {
  return { ...event(id), filler: FILLER };
}

function root(options?: Parameters<typeof createMemoryDirectory>[1]): DirectoryHandleLike {
  return createMemoryDirectory("root", options) as unknown as DirectoryHandleLike;
}

async function eventsDirOf(dir: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return dir.getDirectoryHandle(EVENTS_DIR, { create: true });
}

async function segmentNames(dir: DirectoryHandleLike): Promise<string[]> {
  const eventsDir = await eventsDirOf(dir);
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

async function readSegmentText(dir: DirectoryHandleLike, name: string): Promise<string> {
  const eventsDir = await eventsDirOf(dir);
  return (await (await eventsDir.getFileHandle(name, { create: false })).getFile()).text();
}

async function writeSegmentText(
  dir: DirectoryHandleLike,
  name: string,
  text: string
): Promise<void> {
  const eventsDir = await eventsDirOf(dir);
  const handle = await eventsDir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function loadAll(dir: DirectoryHandleLike): Promise<TestEvent[]> {
  const { events } = await readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG);
  return events;
}

function name(seq = 0, writer = WRITER, config = TEST_LOG): string {
  return segmentFileName(config, writer, seq);
}

/**
 * Run `body` with every `waitFor()` sleep recorded and resolved immediately.
 *
 * Recording the DELAYS, not just the count, is what makes "which ladder did
 * this path take" assertable at all — the two ladders share their first four
 * rungs, so only the fifth (`800`) and the total length distinguish them.
 */
async function withCapturedSleeps<T>(
  body: () => Promise<T>
): Promise<{ result: T; delays: number[] }> {
  const delays: number[] = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    // A microtask rather than a synchronous call: the awaits in the code under
    // test must still yield, or the ordering being tested is not the real one.
    void Promise.resolve().then(callback);
    return 0;
  }) as unknown as typeof setTimeout;
  try {
    const result = await body();
    return { result, delays };
  } finally {
    globalThis.setTimeout = original;
  }
}

/** The rungs a retry ladder actually slept, ignoring the failure-path probes that follow it. */
function ladderPrefix(delays: number[], length: number): number[] {
  return delays.slice(0, length);
}

beforeEach(() => {
  __resetAppendOnlyEventLogMemosForTests();
  clearErrors();
  nextSeq = 0;
});

afterEach(() => {
  __resetAppendOnlyEventLogMemosForTests();
});

/* ──────────────────────────── golden-name pins ──────────────────────────── */

describe("segment naming is pinned to a literal, not to itself", () => {
  it("produces the exact expected file name for fixed device/session/seq inputs", () => {
    // If this changes, EVERY writer on every deployed share starts a new chain
    // and every reader's checkpoint offsets are keyed on names that no longer
    // appear. That is a data-shape change, and it must never happen by accident
    // — hence a literal, not a re-derivation of the same formula.
    const fixed = { deviceId: "device-fixed", sessionId: "session-fixed" };
    expect(segmentFileName(TEST_LOG, fixed)).toBe("70064406-4a0c30.ndjson");
    expect(segmentFileName(TEST_LOG, fixed, 7)).toBe("70064406-4a0c30-7.ndjson");
    expect(segmentFileName(TEST_LOG, fixed, MAX_SEGMENT_SEQ)).toBe(
      "70064406-4a0c30-999999.ndjson"
    );
  });

  it("prefixes the base name only when a consumer asks for it", () => {
    const fixed = { deviceId: "device-fixed", sessionId: "session-fixed" };
    const prefixed: AppendOnlyEventLogConfig = { ...TEST_LOG, baseNamePrefix: "ans" };
    expect(segmentFileName(prefixed, fixed)).toBe("ans-70064406-4a0c30.ndjson");
    // …and the unprefixed form is genuinely a different chain, so a consumer
    // adopting a prefix never silently appends to another consumer's file.
    expect(segmentFileName(prefixed, fixed)).not.toBe(segmentFileName(TEST_LOG, fixed));
  });

  it("hashes rather than slices, so low-entropy id shapes still separate", () => {
    // `ephemeral-{uuid}` (the no-localStorage fallback) shares its first eight
    // characters in every case; slicing would hand two machines one base.
    const a = buildSegmentBaseName(
      { deviceId: "ephemeral-1111", sessionId: "ephemeral-2222" },
      SUFFIX
    );
    const b = buildSegmentBaseName(
      { deviceId: "ephemeral-3333", sessionId: "ephemeral-4444" },
      SUFFIX
    );
    expect(a).not.toBe(b);
    expect(a).toHaveLength(15);
  });
});

describe("the segment base name length budget is a real check", () => {
  it("derives 27 characters for a .ndjson suffix", () => {
    // 48 (longest component ever written successfully on the affected shares:
    // `{uuid}.json` + `.crswap`) − 7 `.crswap` − 7 `.ndjson` − 7 `-999999`.
    expect(maxSegmentBaseNameChars(SUFFIX)).toBe(27);
  });

  it("accepts a base exactly at the budget and rejects one character more", () => {
    const writer = { deviceId: "device-fixed", sessionId: "session-fixed" }; // 15-char base
    const atBudget = "p".repeat(27 - 15 - 1); // + the joining dash
    expect(buildSegmentBaseName(writer, SUFFIX, atBudget)).toHaveLength(27);
    expect(() => buildSegmentBaseName(writer, SUFFIX, `${atBudget}p`)).toThrow(/XQ-IO-031/);
  });

  it("names the budget and the reason in the failure, not just 'too long'", () => {
    // The whole value of failing here is that the alternative diagnosis costs a
    // ~11 s ladder plus a multi-second probe and still cannot tell a too-long
    // name from share flake.
    expect(() =>
      buildSegmentBaseName({ deviceId: "d", sessionId: "s" }, SUFFIX, "x".repeat(40))
    ).toThrow(/too long for a deep UNC path/);
  });
});

/* ──────────────────────── rotation and crash safety ─────────────────────── */

describe("rotation preserves every event exactly once", () => {
  it("spans several rotations without losing or duplicating a line", async () => {
    const dir = root();
    const total = 20;
    for (let i = 0; i < total; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }

    const names = await segmentNames(dir);
    expect(names.length).toBeGreaterThan(1); // it really did rotate

    const events = await loadAll(dir);
    expect(events).toHaveLength(total);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(total);

    // "Nothing gained" as well as "nothing lost": a rotation that copied the
    // previous segment's content forward would still pass a lost-nothing check.
    let lines = 0;
    for (const segment of names) {
      lines += (await readSegmentText(dir, segment)).split("\n").filter(Boolean).length;
    }
    expect(lines).toBe(total);
  });

  it("keeps every sealed segment inside the byte cap", async () => {
    const dir = root();
    for (let i = 0; i < 20; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }
    for (const segment of await segmentNames(dir)) {
      expect((await readSegmentText(dir, segment)).length).toBeLessThanOrEqual(
        MAX_OPEN_SEGMENT_BYTES
      );
    }
  });

  it("lets a single over-cap batch land rather than rotating forever", async () => {
    const dir = root();
    await appendEventSegment(
      dir,
      Array.from({ length: 10 }, (_unused, i) => bigEvent(`BIG-${i}`)),
      WRITER,
      TEST_LOG
    );
    expect(await segmentNames(dir)).toEqual([name(0)]);

    // …and the next append rotates away from the over-cap segment.
    await appendEventSegment(dir, [bigEvent("AFTER")], WRITER, TEST_LOG);
    expect(await segmentNames(dir)).toContain(name(1));
    expect(await loadAll(dir)).toHaveLength(11);
  });

  it("rotates rather than growing a segment it finds already over the cap on startup", async () => {
    const dir = root();
    const seeded = Array.from({ length: 8 }, (_unused, i) => bigEvent(`SEED-${i}`));
    await writeSegmentText(dir, name(0), seeded.map((e) => `${JSON.stringify(e)}\n`).join(""));
    __resetAppendOnlyEventLogMemosForTests();

    await appendEventSegment(dir, [bigEvent("FRESH")], WRITER, TEST_LOG);

    expect(await segmentNames(dir)).toEqual([name(0), name(1)].sort());
    expect(await readSegmentText(dir, name(1))).toContain("FRESH");
    expect(await loadAll(dir)).toHaveLength(9);
  });

  it("resumes in the right segment after the writer loses its in-memory position", async () => {
    const dir = root();
    for (let i = 0; i < 10; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }
    const before = await segmentNames(dir);
    expect(before.length).toBeGreaterThan(1);
    const openName = name(before.length - 1);
    const openBefore = await readSegmentText(dir, openName);
    const sealedBefore = await readSegmentText(dir, name(0));

    // Everything the writer knew about its own chain is gone; only the share
    // remains. It must rediscover its highest sequence from the listing.
    __resetAppendOnlyEventLogMemosForTests();
    await appendEventSegment(dir, [bigEvent("RESUMED")], WRITER, TEST_LOG);

    const openAfter = await readSegmentText(dir, openName);
    expect(openAfter.startsWith(openBefore)).toBe(true);
    expect(openAfter).toContain("RESUMED");
    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);
    expect(await loadAll(dir)).toHaveLength(11);
  });

  it("does not claim another writer's segment when rediscovering its own sequence", async () => {
    const dir = root();
    const base = buildSegmentBaseName(WRITER, SUFFIX);
    // Names a naive "split on the last dash" parse could mistake for this chain.
    await writeSegmentText(dir, `${base}x-4${SUFFIX}`, `${JSON.stringify(event("OTHER-A"))}\n`);
    await writeSegmentText(dir, `${base}-beta${SUFFIX}`, `${JSON.stringify(event("OTHER-B"))}\n`);
    await writeSegmentText(dir, `${base}-007${SUFFIX}`, `${JSON.stringify(event("OTHER-C"))}\n`);

    await appendEventSegment(dir, [event("MINE")], WRITER, TEST_LOG);

    expect(await readSegmentText(dir, name(0))).toContain("MINE");
    expect(await readSegmentText(dir, `${base}-007${SUFFIX}`)).toContain("OTHER-C");
    // All four remain readable — the read path is a pure suffix glob.
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual([
      "evt-MINE",
      "evt-OTHER-A",
      "evt-OTHER-B",
      "evt-OTHER-C",
    ]);
  });

  it("loses no event and writes none twice when the rotation write fails outright", async () => {
    const dir = root();
    for (let i = 0; i < 6; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }
    const sealedBefore = await readSegmentText(dir, name(0));

    // The rotation target refuses to be created, permanently — the closest
    // deterministic stand-in for a process dying at the moment of rotation.
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(1),
        create: true,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    await withCapturedSleeps(async () => {
      await expect(
        appendEventSegment(dir, [bigEvent("CRASH")], WRITER, TEST_LOG)
      ).rejects.toMatchObject({ name: "NotFoundError" });
    });
    clearSimulatedFaults(dir);

    // The sealed segment was not touched by the failed rotation.
    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);

    // Retrying the same batch lands it exactly once.
    await appendEventSegment(dir, [bigEvent("CRASH")], WRITER, TEST_LOG);
    const events = await loadAll(dir);
    expect(events).toHaveLength(7);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(7);
  });
});

/* ───────────────── "cannot confirm" is not automatically a failure ───────── */

describe("a segment we cannot read back is not automatically a lost write", () => {
  it("reports unverified — not a throw — when the baseline read WAS reliable", async () => {
    const dir = root();
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        nameSuffix: SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    // `close()` already resolved, so the bytes ARE committed; this is only the
    // share failing to show an entry it already holds. Throwing here is what
    // aborted a caller before its projection write and stranded a completed
    // save (the incident `segmentVerifyNotAFailure.test.ts` pins for
    // distribution).
    expect(result).toBe("unverified");
    // …and it is recorded rather than passing silently.
    expect(
      getRecentErrors().some(
        (entry) =>
          entry.context.includes("test:segment-verify") && entry.context.includes("XQ-DIST-007")
      )
    ).toBe(true);
  });

  it("still throws when the read-back SUCCEEDS and the size is genuinely wrong", async () => {
    const dir = root();
    // Land a first segment normally so a second append has a baseline to read.
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    // Now corrupt the file between the write and the verify: the verify read
    // succeeds and finds a size that does not match what was just written.
    const eventsDir = await eventsDirOf(dir);
    setSimulatedFaults(dir, []);
    const original = eventsDir.getFileHandle.bind(eventsDir);
    let wroteOnce = false;
    (eventsDir as { getFileHandle: DirectoryHandleLike["getFileHandle"] }).getFileHandle = async (
      entryName: string,
      options?: { create?: boolean }
    ) => {
      const handle = await original(entryName, options);
      if (options?.create && entryName.endsWith(SUFFIX) && !wroteOnce) {
        wroteOnce = true;
        const inner = handle.createWritable!.bind(handle);
        return {
          ...handle,
          createWritable: async () => {
            const writable = await inner();
            return {
              // Truncate the content: a genuinely bad write, not a stale view.
              write: (data: string) => writable.write(data.slice(0, 5)),
              close: () => writable.close(),
            };
          },
        };
      }
      return handle;
    };

    await expect(
      withCapturedSleeps(() =>
        appendEventSegment({ ...dir, getDirectoryHandle: async () => eventsDir } as unknown as DirectoryHandleLike, [event("B")], WRITER, TEST_LOG)
      )
    ).rejects.toThrow(/verification failed/);
  });

  it("stays FATAL when the baseline was unreliable and the chain cannot rotate away", async () => {
    // The one path where "cannot confirm" is NOT benign: the pre-append re-read
    // of a segment this session wrote fell back to "", so the write just
    // rewrote the file without lines that may still be on the share. Normally
    // an unreliable baseline rotates to a fresh segment instead (see the next
    // describe block); at the sequence CEILING there is nowhere to rotate to,
    // and the post-close check is then the only thing that can detect the loss.
    const dir = root();
    const base = buildSegmentBaseName(WRITER, SUFFIX);
    const ceilingName = `${base}-${MAX_SEGMENT_SEQ}${SUFFIX}`;
    await writeSegmentText(dir, ceilingName, `${JSON.stringify(event("SEED"))}\n`);
    __resetAppendOnlyEventLogMemosForTests();

    // First append resumes into the ceiling segment and memoizes it.
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    expect(await segmentNames(dir)).toEqual([ceilingName]);

    // Now the share stops showing that entry, permanently.
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: ceilingName,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(
      withCapturedSleeps(() => appendEventSegment(dir, [event("B")], WRITER, TEST_LOG))
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("an unreliable baseline forces rotation rather than a blind overwrite", () => {
  it("leaves the unreadable segment untouched and lands the batch in a fresh one", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0));

    // This session wrote `name(0)`, and the share now refuses to show it. The
    // patient re-read exhausts and falls back to "" — writing there would
    // rewrite the file without lines still on the server.
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], WRITER, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    // The unreadable segment kept its bytes; the new batch is in `-1`.
    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });
});

/* ─────────────────────────── retry-ladder pins ──────────────────────────── */

describe("each path takes the retry ladder it is supposed to take", () => {
  it("gives a FRESH writer's first re-read the fast ladder, not the patient one", async () => {
    // Absence is the expected, correct answer for a session's first append.
    // Taking the ~11 s ladder here would put dead wait in front of the first
    // action of every session — the regression this pin exists to catch.
    const dir = root({
      faults: [
        {
          operation: "getFileHandle",
          nameSuffix: SUFFIX,
          create: false,
          errorName: "NotReadableError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    const { delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(ladderPrefix(delays, TRANSIENT_WRITE_RETRY_DELAYS_MS.length)).toEqual([
      ...TRANSIENT_WRITE_RETRY_DELAYS_MS,
    ]);
    // The distinguishing rung: the patient ladder's 5th is 800 ms. The fast
    // ladder has no 5th, so the re-read must have stopped after four.
    expect(delays.slice(0, 5)).not.toEqual([...VERIFY_READBACK_RETRY_DELAYS_MS.slice(0, 5)]);
  });

  it("gives a re-read of a segment THIS SESSION WROTE the patient ladder", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], WRITER, TEST_LOG)
    );

    // Exhausting this ladder is what forces the rotation that avoids data loss,
    // so more patience here directly narrows the loss window.
    expect(ladderPrefix(delays, VERIFY_READBACK_RETRY_DELAYS_MS.length)).toEqual([
      ...VERIFY_READBACK_RETRY_DELAYS_MS,
    ]);
  });

  it("gives the segment WRITE the patient ladder, not the fast one", async () => {
    // Failing the write aborts a whole month save, so giving up in ~630 ms buys
    // nothing. Five consecutive failures is past the fast ladder's four rungs.
    const dir = root({
      faults: [
        {
          operation: "createWritable",
          nameSuffix: SUFFIX,
          errorName: "NotFoundError",
          times: 5,
        },
      ],
    });

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    expect(delays).toEqual([...VERIFY_READBACK_RETRY_DELAYS_MS.slice(0, 5)]);
    // The fast ladder would have surrendered on the fifth attempt.
    expect(delays.length).toBeGreaterThan(TRANSIENT_WRITE_RETRY_DELAYS_MS.length);
  });
});

/* ───────────────────────── cross-consumer isolation ─────────────────────── */

describe("two consumers never observe each other's writer memos", () => {
  // The direct regression test for round 3's Gap 1a. Both consumers run in the
  // same tab, on the same device and session, under the same scope — which is
  // the ordinary case, not a contrived one — so the ONLY thing separating their
  // module-level memo entries is `consumerNamespace`.
  const CONSUMER_A: AppendOnlyEventLogConfig = {
    ...TEST_LOG,
    consumerNamespace: "aaa",
    eventsDirName: "a.events",
  };
  const CONSUMER_B: AppendOnlyEventLogConfig = {
    ...TEST_LOG,
    consumerNamespace: "bbb",
    eventsDirName: "b.events",
  };

  it("does not make consumer B's FIRST append pay A's patient ladder", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A1")], WRITER, CONSUMER_A);

    // B's first append: its own directory is empty, so the pre-append re-read's
    // NotFoundError is the expected answer and must resolve with NO sleeping.
    // If the memos were shared, B would see A's entry, decide "this session
    // already wrote that name", and burn the full ~11 s patient ladder.
    const { delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B1")], WRITER, CONSUMER_B)
    );

    expect(delays).toEqual([]);
  });

  it("does not let consumer A's rotation advance consumer B's sequence", async () => {
    const dir = root();
    // Drive A well past seq 0.
    for (let i = 0; i < 10; i += 1) {
      await appendEventSegment(dir, [bigEvent(`A-${i}`)], WRITER, CONSUMER_A);
    }
    const aDir = await dir.getDirectoryHandle("a.events", { create: true });
    const aNames = (await listDirectoryEntries(aDir)).filter((e) => e.kind === "file");
    expect(aNames.length).toBeGreaterThan(1);

    await appendEventSegment(dir, [event("B1")], WRITER, CONSUMER_B);

    // B started its own chain at seq 0 in its own directory. A shared
    // `openSegmentSeqByWriter` would have put it at A's sequence instead,
    // leaving a sparse chain whose earlier sequence numbers never exist.
    const bDir = await dir.getDirectoryHandle("b.events", { create: true });
    const bNames = (await listDirectoryEntries(bDir))
      .filter((e) => e.kind === "file")
      .map((e) => e.name);
    expect(bNames).toEqual([segmentFileName(CONSUMER_B, WRITER, 0)]);
  });

  it("keeps each consumer's events entirely within its own directory", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A1")], WRITER, CONSUMER_A);
    await appendEventSegment(dir, [event("B1")], WRITER, CONSUMER_B);

    const a = await readEventSegmentDelta<TestEvent>(dir, {}, CONSUMER_A);
    const b = await readEventSegmentDelta<TestEvent>(dir, {}, CONSUMER_B);
    expect(a.events.map((e) => e.eventId)).toEqual(["evt-A1"]);
    expect(b.events.map((e) => e.eventId)).toEqual(["evt-B1"]);
  });
});

/* ────────────────────── checkpoint ↔ digest binding ─────────────────────── */

describe("the event-set digest", () => {
  it("is commutative and duplicate-insensitive, so two discovery orders agree", () => {
    expect(eventSetDigest(["a", "b", "c"])).toBe(eventSetDigest(["c", "a", "b"]));
    expect(eventSetDigest(["a", "b", "a"])).toBe(eventSetDigest(["a", "b"]));
  });

  it("changes when the SET changes, including when only the count does", () => {
    expect(eventSetDigest(["a", "b"])).not.toBe(eventSetDigest(["a", "b", "c"]));
    expect(eventSetDigest([])).not.toBe(eventSetDigest(["a"]));
  });

  it("can never collide with the pre-v85 concatenated format", () => {
    // A digest and an old id are therefore never `===`, which reads as "stale",
    // costs one full refold, and self-heals across the format change.
    expect(eventSetDigest(["a"]).startsWith("d1:")).toBe(true);
  });
});

describe("a checkpoint is refused unless its digest binds it to the cache", () => {
  const checkpoint = {
    segmentOffsets: { "s.ndjson": 120 },
    knownEventIds: ["a", "b"],
    deriveVersion: 4,
    eventSetId: eventSetDigest(["a", "b"]),
  };

  it("resumes when the derive version and the digest both agree", () => {
    expect(
      checkpointResumeVerdict(checkpoint, {
        deriveVersion: 4,
        eventSetId: eventSetDigest(["a", "b"]),
      })
    ).toEqual({ usable: true });
  });

  it("forces a full refold on a STALE digest rather than trusting the checkpoint", () => {
    // The danger the binding exists for: a checkpoint whose segmentOffsets are
    // AHEAD of the state it is folded onto. Resuming reads no new bytes and
    // returns that state verbatim — every event in between disappears
    // permanently into an advancing checkpoint.
    expect(
      checkpointResumeVerdict(checkpoint, {
        deriveVersion: 4,
        eventSetId: eventSetDigest(["a"]),
      })
    ).toEqual({ usable: false, reason: "digest-mismatch" });
  });

  it("refuses a checkpoint carrying no digest at all", () => {
    expect(
      checkpointResumeVerdict(
        { deriveVersion: 4 },
        { deriveVersion: 4, eventSetId: eventSetDigest(["a", "b"]) }
      )
    ).toEqual({ usable: false, reason: "digest-absent" });
  });

  it("refuses a checkpoint built by a different fold version", () => {
    expect(
      checkpointResumeVerdict(checkpoint, {
        deriveVersion: 5,
        eventSetId: eventSetDigest(["a", "b"]),
      })
    ).toEqual({ usable: false, reason: "derive-version" });
  });
});

describe("dedup across the checkpoint boundary", () => {
  const idOf = (e: TestEvent) => e.eventId;

  it("drops an event the checkpoint has already folded", () => {
    const known = ["evt-A"];
    const incoming = [event("A"), event("B")];
    expect(filterAlreadyFolded(incoming, known, idOf).map(idOf)).toEqual(["evt-B"]);
  });

  it("also dedupes a repeat WITHIN the batch, keeping first-seen order", () => {
    // A durable-append path that retries a chunk and then degrades to a
    // per-event file writes one event twice; a per-batch map alone cannot see
    // across the checkpoint boundary, and this filter must do both jobs.
    const incoming = [event("A"), event("B"), event("A")];
    expect(filterAlreadyFolded(incoming, [], idOf).map(idOf)).toEqual(["evt-A", "evt-B"]);
  });

  it("passes everything through when the checkpoint is empty", () => {
    const incoming = [event("A"), event("B")];
    expect(filterAlreadyFolded(incoming, [], idOf)).toHaveLength(2);
  });
});

/* ────────────────── ordering and late-event detection ───────────────────── */

describe("the late-event guard shares the fold's own comparator", () => {
  type Marker = { lastEventAt: string; lastEventId?: string };

  /**
   * The exact rule `distributionDerivation.ts`'s `isEventEarlierThanEntry`
   * applies, expressed as one comparator so the guard and the fold cannot
   * drift apart (round 3's Gap 1b).
   */
  const compare = (e: TestEvent, marker: Marker): FoldOrderComparison => {
    const byTime = e.eventAt.localeCompare(marker.lastEventAt);
    if (byTime !== 0) return byTime;
    if (!marker.lastEventId) return "unknown";
    return e.eventId.localeCompare(marker.lastEventId);
  };

  const marker: Marker = { lastEventAt: "2026-08-27T10:00:00.000Z", lastEventId: "evt-M" };

  it("treats an absent marker as not-late — an unseen key has no order to violate", () => {
    expect(isEventOutOfOrder(event("A"), undefined, compare)).toBe(false);
    expect(isEventOutOfOrder(event("A"), null, compare)).toBe(false);
  });

  it("flags an event that sorts strictly before the marker", () => {
    expect(isEventOutOfOrder(event("A", "2026-08-27T09:00:00.000Z"), marker, compare)).toBe(true);
  });

  it("passes an event that sorts after the marker", () => {
    expect(isEventOutOfOrder(event("A", "2026-08-27T11:00:00.000Z"), marker, compare)).toBe(false);
  });

  it("uses the tie-break at an exactly-equal primary key, in both directions", () => {
    expect(isEventOutOfOrder({ ...event("A"), eventId: "evt-A" }, marker, compare)).toBe(true);
    expect(isEventOutOfOrder({ ...event("Z"), eventId: "evt-Z" }, marker, compare)).toBe(false);
  });

  it("conservatively calls an UNDECIDABLE comparison late", () => {
    // A marker written by an older format carries no tie-break field. The
    // caller pays for one safe full refold rather than risking a silent
    // misordering — the same rule `isEventEarlierThanEntry` has always had.
    const older: Marker = { lastEventAt: "2026-08-27T10:00:00.000Z" };
    expect(isEventOutOfOrder(event("A"), older, compare)).toBe(true);
  });
});

describe("sortEventsForFold", () => {
  it("is stable, so a tied batch keeps its input order", () => {
    // A bulk write stamps ONE shared timestamp across a whole batch, so ties are
    // the common case, not the edge case — and the input order IS the causal one.
    const at = "2026-08-27T10:00:00.000Z";
    const events = ["c", "a", "b"].map((id) => event(id, at));
    const sorted = sortEventsForFold(events, (l, r) => l.eventAt.localeCompare(r.eventAt));
    expect(sorted.map((e) => e.eventId)).toEqual(["evt-c", "evt-a", "evt-b"]);
  });
});

/* ────────────────────────────── batch chunking ──────────────────────────── */

describe("chunkEventsForSegmentAppends", () => {
  it("bounds every chunk by bytes, preserving order", () => {
    const events = Array.from({ length: 30 }, (_unused, i) => bigEvent(`IMG-${i}`));
    const chunks = chunkEventsForSegmentAppends(events);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const bytes = new TextEncoder().encode(
        chunk.map((e) => `${JSON.stringify(e)}\n`).join("")
      ).length;
      expect(bytes).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_BYTES);
    }
    expect(chunks.flat().map((e) => e.eventId)).toEqual(events.map((e) => e.eventId));
  });

  it("gives a single oversized event its own chunk rather than dropping it", () => {
    const huge = { ...event("HUGE"), filler: "x".repeat(MAX_OPEN_SEGMENT_BYTES) };
    const chunks = chunkEventsForSegmentAppends([huge, event("S1"), event("S2")]);
    expect(chunks[0]).toEqual([huge]);
    expect(chunks.flat()).toHaveLength(3);
  });
});

/* ────────────────────────── reader offset contract ──────────────────────── */

describe("readEventSegmentDelta", () => {
  it("returns only bytes past the known offset, across a rotation", async () => {
    const dir = root();
    for (let i = 0; i < 5; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }
    const first = await readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG);
    expect(first.events).toHaveLength(5);

    for (let i = 5; i < 12; i += 1) {
      await appendEventSegment(dir, [bigEvent(`IMG-${i}`)], WRITER, TEST_LOG);
    }
    const second = await readEventSegmentDelta<TestEvent>(dir, first.offsets, TEST_LOG);
    expect(second.events).toHaveLength(7);

    // A segment with no new bytes yields no tail, and an unknown name defaults
    // to offset 0 — so the delta is exactly the new events, never a re-read.
    const third = await readEventSegmentDelta<TestEvent>(dir, second.offsets, TEST_LOG);
    expect(third.events).toEqual([]);
  });

  it("answers an absent events directory with an empty delta, not an error", async () => {
    const delta = await readEventSegmentDelta<TestEvent>(root(), {}, TEST_LOG);
    expect(delta).toEqual({ events: [], offsets: {}, segmentNames: [] });
  });

  it("throws rather than inventing an empty history when the directory cannot be OPENED", async () => {
    // "No events directory" is a real answer; "I could not open the events
    // directory" is not, and returning an empty delta for it makes a whole
    // event history disappear from every fold that reads through here.
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    setSimulatedFaults(dir, [
      {
        operation: "getDirectoryHandle",
        name: EVENTS_DIR,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    await expect(readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG)).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });

  it("rejects a corrupt segment rather than silently dropping its lines", async () => {
    const dir = root();
    await writeSegmentText(dir, name(0), "{not json}\n");
    await expect(loadAll(dir)).rejects.toThrow(/Cannot parse test event segment/);
  });
});
