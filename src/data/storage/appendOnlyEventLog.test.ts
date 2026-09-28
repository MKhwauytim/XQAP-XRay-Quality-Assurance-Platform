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
  clearOperationLog,
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "./memoryDirectory";
import { listDirectoryEntries } from "./directoryScan";
import { errorCodeOf } from "./errorCodes";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import type { OperationDeadline } from "./operationDeadline";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
} from "./transientFileErrors";
import {
  MAX_OPEN_SEGMENT_BYTES,
  MAX_SEGMENT_SEQ,
  type AppendOnlyEventLogConfig,
  type FoldOrderComparison,
  EventSegmentUnreadableError,
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

  // R2: never write to a ROTATION TARGET whose own pre-write baseline read is
  // unreliable — this is the size-threshold rotation's own target, not the
  // "could not re-read my claimed segment" branch above it.
  it("R2: rotates PAST a rotation target that is itself unreadable, rather than writing over it", async () => {
    const dir = root();
    // Fill seq 0 past the cap, exactly like the sibling test above.
    await appendEventSegment(
      dir,
      Array.from({ length: 10 }, (_unused, i) => bigEvent(`BIG-${i}`)),
      WRITER,
      TEST_LOG
    );
    expect(await segmentNames(dir)).toEqual([name(0)]);

    // The NEXT append's shouldRotate branch will target name(1). Make that
    // target's own pre-write re-read exhaust as unreliable (NotReadableError,
    // not NotFoundError — so the E1 rule makes it unreliable regardless of
    // knownWritten, exactly like a real "this segment briefly cannot be
    // read" condition on a name nothing has claimed yet).
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(1),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [bigEvent("AFTER")], WRITER, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    // R2's guarantee: name(1) was never written over — it was never even
    // CREATED (only its read was probed, with create:false, and that's all
    // ensureReliableRotationTarget ever does to a target it rejects) — the
    // batch landed one hop further, in name(2).
    expect(await segmentNames(dir)).not.toContain(name(1));
    expect(await readSegmentText(dir, name(2))).toContain("evt-AFTER");
    expect(await loadAll(dir)).toHaveLength(11);
  });

  // R2: bounded — never spins indefinitely (up to MAX_SEGMENT_SEQ) hunting for
  // a reliable target; gives up after MAX_UNRELIABLE_ROTATION_ATTEMPTS hops.
  it("R2: gives up (throws) rather than spinning forever when every rotation target is unreadable", async () => {
    const dir = root();
    await appendEventSegment(
      dir,
      Array.from({ length: 10 }, (_unused, i) => bigEvent(`BIG-${i}`)),
      WRITER,
      TEST_LOG
    );
    expect(await segmentNames(dir)).toEqual([name(0)]);

    // Every rotation target this append could possibly reach is unreadable —
    // seq 1 through 7 explicitly (well past MAX_UNRELIABLE_ROTATION_ATTEMPTS),
    // deliberately NOT seq 0 itself: that name's own re-read must stay
    // healthy so `shouldRotate` is reached the ordinary way, and this test
    // exercises the ROTATION TARGET bound, not the earlier single-hop branch.
    setSimulatedFaults(
      dir,
      Array.from({ length: 7 }, (_unused, i) => ({
        operation: "getFileHandle" as const,
        name: name(i + 1),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      }))
    );

    await expect(
      withCapturedSleeps(() => appendEventSegment(dir, [bigEvent("AFTER")], WRITER, TEST_LOG))
    ).rejects.toThrow(/rotation (ceiling|attempt bound)/);
    clearSimulatedFaults(dir);

    // Nothing was overwritten: seq 0 still holds exactly its original batch.
    expect(await segmentNames(dir)).toEqual([name(0)]);
    expect(await loadAll(dir)).toHaveLength(10);
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

/* ───────────────────── E1: exhausted ladder ≠ NotFoundError-only ────────── */

describe("E1: an exhausted ladder is unreliable for ANY error, not just NotFoundError", () => {
  // Production analysis: .superpowers/sdd/errorlog-2026-09-28/unreadable-segments.md.
  // `readExistingSegment` used to only treat an EXHAUSTED `knownWritten &&
  // isNotFoundError` as unreliable. A `NotReadableError` or `InvalidStateError`
  // past the ladder fell through to the "fresh, no segment yet" branch and came
  // back `reliable: true` with `text: ""` — so the caller happily overwrote an
  // EXISTING segment with only the new batch, silently truncating everything
  // already in it. These pin the fix: any exhausted ladder for a `knownWritten`
  // name, or any non-NotFoundError outcome at all, must come back unreliable
  // and force a rotation instead of an overwrite.

  it("rotates away (does not overwrite) on an exhausted NotReadableError, same session", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0));

    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], WRITER, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("rotates away on an exhausted InvalidStateError (stale snapshot), same session", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0));

    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], WRITER, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("applies to a NON-stable, distribution-shaped writer too — the bug lived in the shared mechanics", async () => {
    // `WRITER` carries no `stable` flag, so every case above already exercises
    // the non-stable path; this asserts that explicitly and end to end.
    expect(WRITER).not.toHaveProperty("stable");
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    await withCapturedSleeps(() => appendEventSegment(dir, [event("B")], WRITER, TEST_LOG));
    clearSimulatedFaults(dir);
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("a STABLE writer across a simulated reload also rotates instead of truncating a month of history", async () => {
    // The reproduction that made this reachable on an ordinary page reload:
    // A1's stable chain means the SECOND page load's first append targets a
    // segment that already holds real content, not an empty fresh one — so
    // this exact bug is reachable on every reload, not just some rare edge.
    const dir = root();
    const stableWriter = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0, stableWriter));

    // Simulate a reload: this session's memo forgets it ever wrote name(0).
    __resetAppendOnlyEventLogMemosForTests();

    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0, stableWriter),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], stableWriter, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0, stableWriter))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1, stableWriter))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  // R7: the reload variant above only exercised NotReadableError. InvalidStateError
  // (the actual production XQ-IO-036 shape) is a DIFFERENT branch of
  // `isTransientWriteError` and deserves its own reload-scoped pin.
  it("a STABLE writer across a simulated reload rotates on an exhausted InvalidStateError too", async () => {
    const dir = root();
    const stableWriter = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0, stableWriter));

    // Simulate a reload: this session's memo forgets it ever wrote name(0).
    __resetAppendOnlyEventLogMemosForTests();

    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0, stableWriter),
        create: false,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], stableWriter, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0, stableWriter))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1, stableWriter))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });
});

/* ───────────── the `stable` writer's core safety property (F2) ──────────── */

describe("a stable writer's knownFor treats a LISTED segment as claimed, not just this session's memo", () => {
  it("a listed segment with a stale NotFound (post-reload) still takes the patient ladder and rotates", async () => {
    const dir = root();
    const stableWriter = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0, stableWriter));

    // Reload: the session memo that would normally say "I wrote this" is
    // gone. Only the directory LISTING (via `knownFor`) can still say so.
    __resetAppendOnlyEventLogMemosForTests();

    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0, stableWriter),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], stableWriter, TEST_LOG)
    );
    expect(result).toBe("verified");
    // Proof it was `knownFor`'s LISTING (not a session memo, which was just
    // cleared) that made this take the patient ladder rather than the fast
    // one reserved for a genuinely fresh writer.
    expect(ladderPrefix(delays, VERIFY_READBACK_RETRY_DELAYS_MS.length)).toEqual([
      ...VERIFY_READBACK_RETRY_DELAYS_MS,
    ]);
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0, stableWriter))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1, stableWriter))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("a genuinely fresh name for a stable writer still takes the FAST ladder, not the patient one", async () => {
    // The other side of `knownFor`: being `stable` must not by itself make
    // every name look claimed — only one the directory actually lists.
    // Faults ONLY the first target name — see the comment on the equivalent
    // non-stable test above for why a suffix-wide fault would cascade into
    // the rotation target too and change what this test is pinning.
    const stableWriter = { ...WRITER, stable: true };
    const dir = root({
      faults: [
        {
          operation: "getFileHandle",
          name: name(0, stableWriter),
          create: false,
          errorName: "NotReadableError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    const { delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG)
    );

    expect(ladderPrefix(delays, TRANSIENT_WRITE_RETRY_DELAYS_MS.length)).toEqual([
      ...TRANSIENT_WRITE_RETRY_DELAYS_MS,
    ]);
  });

  it("treats a directory-listing failure inside knownFor as claimed too (conservative default) and still rotates safely", async () => {
    const dir = root();
    const stableWriter = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0, stableWriter));
    __resetAppendOnlyEventLogMemosForTests();

    const eventsDir = await eventsDirOf(dir);
    // First listing call is `discoverHighestOwnSeq` re-establishing `seq`
    // after the reload above cleared `openSegmentSeqByWriter` too — let that
    // one succeed normally. Only the SECOND listing call, `knownFor`'s own,
    // fails — a share hiccup between two nearby calls, not a permanently
    // broken directory.
    let listCalls = 0;
    const rawEventsDir = eventsDir as unknown as { values: () => AsyncGenerator<{ name: string; kind: string }> };
    const originalValues = rawEventsDir.values.bind(rawEventsDir);
    const brokenEventsDir = {
      ...eventsDir,
      values: () => {
        listCalls += 1;
        if (listCalls === 1) return originalValues();
        // A rejecting async iterator, not a generator — `require-yield` flags
        // a `function*` with no reachable `yield`, and there is nothing to
        // yield before this always throws.
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => Promise.reject(new Error("simulated directory listing failure")),
        } as AsyncGenerator<{ name: string; kind: string }>;
      },
    } as unknown as DirectoryHandleLike;

    // R7: this MUST be NotFoundError, not NotReadableError. `isNotFoundError`
    // is the only error shape whose unreliable-baseline verdict actually
    // depends on `knownWritten` (`if (knownWritten || !isNotFoundError(error))`
    // — for every OTHER error name the `!isNotFoundError` half already makes
    // the check true regardless of `knownWritten`). So NotFoundError is the
    // only fault that PINS `knownFor`'s listing-failure catch returning `true`:
    // if that catch wrongly returned `false` here, `knownWritten` would be
    // `false`, the short ladder would exhaust, and the check above would
    // evaluate `false` — falling through to `reliable: true` and silently
    // OVERWRITING the sealed segment instead of rotating away from it.
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0, stableWriter),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(
        { ...dir, getDirectoryHandle: async () => brokenEventsDir } as unknown as DirectoryHandleLike,
        [event("B")],
        stableWriter,
        TEST_LOG
      )
    );
    expect(result).toBe("verified");
    // IMPORTANT-1-fix-round update: `delays` is asserted EXACTLY, not just as
    // a prefix. Seq 0 (within `highestReliableSeq`, the watermark the FIRST,
    // successful listing established) correctly takes the PATIENT ladder —
    // `knownFor`'s catch resolving to `true` there is trusted, since a real
    // listing once vouched for that name. But the rotation target, seq 1, is
    // BEYOND that watermark: `knownWrittenFor` no longer trusts a
    // listing-failure-only claim for it, so it takes the FAST ladder and
    // resolves as an immediate, reliable absence — contributing ZERO further
    // delay. A bounded match (not merely "at least the patient ladder")
    // pins that seq 1 did NOT also burn a second patient ladder, which is
    // exactly the fix for the ~700 s spin this test used to permit (a
    // broken listing used to make EVERY candidate name look claimed, forcing
    // each one through its own ~11 s ladder before also coming back
    // unreliable).
    // (The one extra entry allowed is `logExhaustedNotFound`'s single failure-
    // path probe wait after seq 0's ladder — not a second ladder.)
    expect(ladderPrefix(delays, VERIFY_READBACK_RETRY_DELAYS_MS.length)).toEqual([
      ...VERIFY_READBACK_RETRY_DELAYS_MS,
    ]);
    // Round 3: the hop after the unreadable seq0 now re-probes seq1's NotFound on
    // the FAST ladder (4 rungs, ~630 ms) before trusting it — still no second
    // patient ladder.
    expect(delays.length).toBeLessThanOrEqual(
      VERIFY_READBACK_RETRY_DELAYS_MS.length + 1 + TRANSIENT_WRITE_RETRY_DELAYS_MS.length
    );
    clearSimulatedFaults(dir);

    expect(await readSegmentText(dir, name(0, stableWriter))).toBe(sealedBefore);
    expect(await readSegmentText(dir, name(1, stableWriter))).toContain("evt-B");
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });
});

// IMPORTANT 1 (fix round 1, reviewer's reproduced data-loss finding): the
// single hop out of "this session's claimed segment came back unreliable"
// (just above `shouldRotate` in `appendEventSegment`) used to accept
// whatever the ONE hop's read produced, reliable or not, and write over it
// regardless. When the hop lands on a name a REAL directory listing already
// confirmed exists — another tab's already-rotated segment, holding real
// events — and this attempt's own read of it also fails, the old code wrote
// straight over those events. Must FAIL against the pre-fix code (temporarily
// revert the `ensureReliableRotationTarget` call on this hop to reproduce)
// and PASS after.
describe("IMPORTANT 1: the single-hop rotation branch must never write over a target a real listing vouched for", () => {
  it("seq0 AND seq1 both fail their read past the full ladder — seq1 (another tab's real segment) is preserved, batch lands in seq2", async () => {
    const dir = root();
    const stableWriter = { ...WRITER, stable: true };
    // seq0: this writer's own earlier, real segment.
    await appendEventSegment(dir, [event("SEED")], stableWriter, TEST_LOG);
    const seq0Before = await readSegmentText(dir, name(0, stableWriter));
    // seq1: ANOTHER TAB of the same stable chain already rotated here and
    // wrote a real event — genuinely present on disk, discoverable by a real
    // directory listing (nothing about the listing itself is faulted below).
    const otherEvent = { eventId: "evt-OTHER", eventAt: "2026-08-27T10:00:00.000Z", seq: 999 };
    const seq1Before = `${JSON.stringify(otherEvent)}\n`;
    await writeSegmentText(dir, name(1, stableWriter), seq1Before);

    // NO reload here, deliberately: this session's memo still says "I wrote
    // seq0", so the writer STARTS at seq0 (not at the seq1 a fresh listing
    // would discover), fails to re-read it, and hops to seq1 — the exact
    // hop the reviewer reproduced. seq1 is claimed via the real listing.

    // Both seq0's and seq1's CONTENT reads fail past the full patient ladder
    // — a share visibility hiccup on the specific files, not on the listing.
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0, stableWriter),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
      {
        operation: "getFileHandle",
        name: name(1, stableWriter),
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], stableWriter, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    // Neither pre-existing segment was touched — both are byte-identical to
    // before this call, in particular seq1's real "evt-OTHER" line survives.
    expect(await readSegmentText(dir, name(0, stableWriter))).toBe(seq0Before);
    expect(await readSegmentText(dir, name(1, stableWriter))).toBe(seq1Before);
    // The new batch landed one hop further out, in seq2.
    expect(await readSegmentText(dir, name(2, stableWriter))).toContain("evt-B");

    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-B", "evt-OTHER", "evt-SEED"]);
  });
});

// N1 (fix round 2, CRITICAL): a THROWN directory listing is no evidence of
// absence. These pin the two data-loss reproductions the re-review found on
// 60f00c1 (the `highestReliableSeq` watermark used to turn a thrown listing
// into a trusted NotFound, so the fast path returned `reliable: true` and the
// write fully replaced a real segment).

/** A parent dir whose events dir lists successfully `okCalls` times, then always throws. */
async function withBrokenListing(
  dir: DirectoryHandleLike,
  okCalls: number
): Promise<DirectoryHandleLike> {
  const eventsDir = await eventsDirOf(dir);
  const raw = eventsDir as unknown as { values: () => AsyncGenerator<{ name: string; kind: string }> };
  const original = raw.values.bind(raw);
  let calls = 0;
  const broken = {
    ...eventsDir,
    values: () => {
      calls += 1;
      if (calls <= okCalls) return original();
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: () => Promise.reject(new Error("simulated directory listing failure")),
      } as AsyncGenerator<{ name: string; kind: string }>;
    },
  } as unknown as DirectoryHandleLike;
  return { ...dir, getDirectoryHandle: async () => broken } as unknown as DirectoryHandleLike;
}

describe("N1: a thrown listing never makes an absent segment trustworthy", () => {
  it("P1: reload + discovery listing always throws + seq0 NotFound ONCE — evt-A is kept (retried, then appended)", async () => {
    const dir = root();
    const w = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], w, TEST_LOG);
    __resetAppendOnlyEventLogMemosForTests();
    setSimulatedFaults(dir, [
      { operation: "getFileHandle", name: name(0, w), create: false, errorName: "NotFoundError", times: 1 },
    ]);
    const parent = await withBrokenListing(dir, 0);
    const { result } = await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG));
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);
    expect((await loadAll(dir)).map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("P1 persistent: seq0 NotFound forever — never overwritten; ends in a bounded XQ-IO-038", async () => {
    const dir = root();
    const w = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], w, TEST_LOG);
    const before = await readSegmentText(dir, name(0, w));
    __resetAppendOnlyEventLogMemosForTests();
    setSimulatedFaults(dir, [
      { operation: "getFileHandle", name: name(0, w), create: false, errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
    ]);
    const parent = await withBrokenListing(dir, 0);
    const failure = await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG)).then(
      () => null,
      (error: unknown) => error
    );
    clearSimulatedFaults(dir);
    expect(errorCodeOf(failure)).toBe("XQ-IO-038");
    expect(await readSegmentText(dir, name(0, w))).toBe(before);
    expect((await loadAll(dir)).map((e) => e.eventId)).toEqual(["evt-A"]);
  });

  it("P3: seq0 memoised, another tab's evt-OTHER in seq1, listing throws, seq1 gets ONE stale NotFound — seq1 is not overwritten", async () => {
    const dir = root();
    const w = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("SEED")], w, TEST_LOG);
    const otherLine = `${JSON.stringify({ eventId: "evt-OTHER", eventAt: "2026-08-27T10:00:00.000Z", seq: 999 })}\n`;
    await writeSegmentText(dir, name(1, w), otherLine);
    setSimulatedFaults(dir, [
      { operation: "getFileHandle", name: name(0, w), create: false, errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
      { operation: "getFileHandle", name: name(1, w), create: false, errorName: "NotFoundError", times: 1 },
    ]);
    const parent = await withBrokenListing(dir, 0);
    await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG)).catch(() => undefined);
    clearSimulatedFaults(dir);
    expect(await readSegmentText(dir, name(1, w))).toContain("evt-OTHER");
  });

  it("an always-throwing listing is bounded: XQ-IO-038 after a handful of probes, not a spin toward MAX_SEGMENT_SEQ", async () => {
    const dir = root({ trackOperations: true });
    const w = { ...WRITER, stable: true };
    await appendEventSegment(dir, [event("A")], w, TEST_LOG);
    __resetAppendOnlyEventLogMemosForTests();
    setSimulatedFaults(dir, [
      { operation: "getFileHandle", name: name(0, w), create: false, errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
    ]);
    const eventsDir = await eventsDirOf(dir);
    clearOperationLog(eventsDir);
    const parent = await withBrokenListing(dir, 0);
    const failure = await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG)).then(
      () => null,
      (error: unknown) => error
    );
    clearSimulatedFaults(dir);
    expect(errorCodeOf(failure)).toBe("XQ-IO-038");
    // seq0 + 5 bounded hops, each at most a fast ladder (5 attempts) plus failure-path probes — ~75 observed; a spin toward MAX_SEGMENT_SEQ would be orders of magnitude more.
    expect(getOperationLog(eventsDir).filter((e) => e.operation === "getFileHandle").length).toBeLessThan(100);
  });
});

// Round 3 guard: the hop taken because the previous segment was UNREADABLE
// retries a NotFound on the fast ladder before trusting it, so ONE stale
// NotFound on another tab's real seq1 (hidden by a stale-but-SUCCESSFUL
// listing) can no longer get it overwritten.
async function seedStaleListingScenario(dir: DirectoryHandleLike) {
  const w = { ...WRITER, stable: true };
  await appendEventSegment(dir, [event("A")], w, TEST_LOG);
  const otherLine = `${JSON.stringify({ eventId: "evt-OTHER", eventAt: "2026-08-27T10:00:00.000Z", seq: 999 })}\n`;
  await writeSegmentText(dir, name(1, w), otherLine);
  __resetAppendOnlyEventLogMemosForTests();
  setSimulatedFaults(dir, [
    { operation: "getFileHandle", name: name(0, w), create: false, errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
    { operation: "getFileHandle", name: name(1, w), create: false, errorName: "NotFoundError", times: 1 },
  ]);
  return { w, otherLine };
}

/** Parent whose events-dir listing SUCCEEDS but hides `hidden` for the first `staleCalls` calls. */
async function withStaleListing(dir: DirectoryHandleLike, hidden: string, staleCalls: number) {
  const eventsDir = await eventsDirOf(dir);
  const raw = eventsDir as unknown as { values: () => AsyncGenerator<{ name: string; kind: string }> };
  const original = raw.values.bind(raw);
  let calls = 0;
  const stale = {
    ...eventsDir,
    values: () => {
      calls += 1;
      if (calls > staleCalls) return original();
      const inner = original();
      return (async function* () {
        for await (const entry of inner) if (entry.name !== hidden) yield entry;
      })();
    },
  } as unknown as DirectoryHandleLike;
  return { ...dir, getDirectoryHandle: async () => stale } as unknown as DirectoryHandleLike;
}

describe("round 3: a stale NotFound on an unreadable-hop target is retried before it is trusted", () => {
  it("stale-but-successful listing hides seq1 (every listing) + seq0 unreadable + one stale NotFound on seq1 — evt-OTHER survives", async () => {
    const dir = root();
    const { w } = await seedStaleListingScenario(dir);
    const parent = await withStaleListing(dir, name(1, w), Number.POSITIVE_INFINITY);
    const { result } = await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG));
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);
    const text = await readSegmentText(dir, name(1, w));
    expect(text).toContain("evt-OTHER");
    expect(text).toContain("evt-B");
  });

  it("same, but only the DISCOVERY listing is stale (later listings show seq1) — evt-OTHER survives", async () => {
    const dir = root();
    const { w } = await seedStaleListingScenario(dir);
    const parent = await withStaleListing(dir, name(1, w), 1);
    await withCapturedSleeps(() => appendEventSegment(parent, [event("B")], w, TEST_LOG));
    clearSimulatedFaults(dir);
    expect(await readSegmentText(dir, name(1, w))).toContain("evt-OTHER");
  });

  it("HEALTHY path is unchanged: six stable appends with a reload and a rotation = fixed op and sleep counts", async () => {
    const dir = root({ trackOperations: true });
    const w = { ...WRITER, stable: true };
    const eventsDir = await eventsDirOf(dir);
    clearOperationLog(eventsDir);
    const { delays } = await withCapturedSleeps(async () => {
      for (let i = 0; i < 6; i += 1) {
        if (i === 3) __resetAppendOnlyEventLogMemosForTests();
        await appendEventSegment(dir, [bigEvent(`H${i}`), bigEvent(`I${i}`), bigEvent(`J${i}`)], w, TEST_LOG);
      }
    });
    const ops = getOperationLog(eventsDir);
    expect(await segmentNames(dir)).toEqual([name(0, w), name(1, w), name(2, w)].sort());
    expect({ total: ops.length, getFileHandle: ops.filter((o) => o.operation === "getFileHandle").length, sleeps: delays.length })
      .toEqual({ total: 54, getFileHandle: 20, sleeps: 0 });
  });
});

/* ─────────────────────────── retry-ladder pins ──────────────────────────── */

describe("each path takes the retry ladder it is supposed to take", () => {
  it("gives a FRESH writer's first re-read the fast ladder, not the patient one", async () => {
    // Absence is the expected, correct answer for a session's first append.
    // Taking the ~11 s ladder here would put dead wait in front of the first
    // action of every session — the regression this pin exists to catch.
    //
    // Faults ONLY `name(0)` (not every `.ndjson` by suffix, as before E1):
    // since the fix, an exhausted non-NotFound error is unreliable regardless
    // of `knownWritten`, so a fault matching every name — including the
    // rotation target this now-unreliable baseline sends the write to — would
    // also make THAT read exhaust its own (fast, since it's genuinely
    // unclaimed) ladder and come back unreliable too, cascading into a
    // baseline-unreliable post-close verify failure that has nothing to do
    // with what this test pins (which ladder the FIRST read takes).
    const dir = root({
      faults: [
        {
          operation: "getFileHandle",
          name: name(0),
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

/* ──────── E1b: rotate away from a segment whose replace is refused ──────── */
//
// The production root cause (see
// `.superpowers/sdd/errorlog-2026-09-28/answer-save-invalidstate.md`, R1):
// `writable.close()` fails with InvalidStateError because the share refuses
// to replace one target file. Every retry ladder and every casLoop attempt
// used to retarget the SAME name, so a save made ~27 identical failed closes
// over ~34 s and every later save in the page session failed the same way.

describe("E1b: a blocked segment REPLACE rotates instead of retrying forever", () => {
  it("(a) a persistent close fault on seq 0 rotates to -1 within a few attempts, leaving seq 0 untouched", async () => {
    const dir = root({ trackOperations: true });
    const eventsDir = await eventsDirOf(dir);
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A"), event("B")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    // R8(d): bounded by the SHORT replace-blocked ladder specifically
    // (SEGMENT_REPLACE_BLOCKED_RETRY_DELAYS_MS has exactly one rung), not
    // merely "shorter than the ~11 s patient one" — a looser bound would
    // also pass if this regressed to some OTHER, still-shorter-than-patient
    // ladder.
    expect(delays.length).toBeLessThanOrEqual(1);

    // Seq 0 was created (getFileHandle(create: true) always creates the
    // entry) but never received the batch's bytes — the close() that would
    // have committed them never succeeded.
    expect(await readSegmentText(dir, name(0))).toBe("");
    // The batch landed in the rotated segment instead.
    expect(await readSegmentText(dir, name(1))).toContain("evt-A");
    expect(await readSegmentText(dir, name(1))).toContain("evt-B");

    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);

    // The blocked close() attempts against seq 0 were bounded, not unbounded.
    const closeAttemptsOnSeqZero = getOperationLog(eventsDir).filter(
      (entry) => entry.operation === "createWritable" && entry.name === name(0)
    ).length;
    expect(closeAttemptsOnSeqZero).toBeLessThanOrEqual(2);
  });

  it("(b) the next save in the same session goes straight to -1 — no further attempts on the blocked segment", async () => {
    const dir = root({ trackOperations: true });
    const eventsDir = await eventsDirOf(dir);
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    // Clear the log so this assertion is only about the SECOND save.
    clearOperationLog(eventsDir);

    await appendEventSegment(dir, [event("B")], WRITER, TEST_LOG);

    // R8(d): no operation of ANY kind touched the blocked segment again — not
    // just no `create: true` getFileHandle call. A narrower check would miss
    // e.g. a stray read-only getFileHandle/getFile probe against seq 0.
    const touchedSeqZero = getOperationLog(eventsDir).some((entry) => entry.name === name(0));
    expect(touchedSeqZero).toBe(false);

    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });

  it("(c) a transient close fault (fails once) still lands exactly once, no duplicate", async () => {
    const dir = root();
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: 1,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    // No rotation was needed — the retry against the SAME target succeeded.
    expect(await segmentNames(dir)).toEqual([name(0)]);
    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId)).toEqual(["evt-A"]);
  });

  // R8(a): the rarer, more dangerous shape — the OS-level replace genuinely
  // LANDED (the commit happened) and only the JS promise still rejected. A
  // caller that rotates blindly here would append the SAME batch a second
  // time, into a second file — `segmentReplaceMayHaveLanded`'s re-read is
  // what this pins.
  it("(a2) a close fault that COMMITS the write before throwing is detected as landed — no rotation, no duplicate", async () => {
    const dir = root({ trackOperations: true });
    const eventsDir = await eventsDirOf(dir);
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
        commitBeforeThrow: true,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    // No rotation: the batch is already durably in seq 0 (the commit landed
    // before the throw), so `segmentReplaceMayHaveLanded` must have recognised
    // that and stopped the rotation loop before it ever created a `-1`.
    expect(await segmentNames(dir)).toEqual([name(0)]);
    expect(await readSegmentText(dir, name(0))).toContain("evt-A");

    const events = await loadAll(dir);
    // Exactly ONE copy — not appended twice into the same file, and not
    // duplicated into a rotated one either.
    expect(events.map((e) => e.eventId)).toEqual(["evt-A"]);

    const closeAttemptsOnSeqZero = getOperationLog(eventsDir).filter(
      (entry) => entry.operation === "close" && entry.name === name(0)
    ).length;
    expect(closeAttemptsOnSeqZero).toBeLessThanOrEqual(2);
  });

  // Minor (tail-compare regression): a SAME-SIZE coincidence must not fool
  // `segmentReplaceMayHaveLanded`'s "did it land anyway?" check — only a tail
  // that actually ENDS WITH this call's own bytes counts as landed.
  it("a same-size, different-content commit is NOT treated as landed — still rotates", async () => {
    const dir = root({ trackOperations: true });
    const evt = event("A");
    const addedText = `${JSON.stringify(evt)}\n`;
    // Same length as addedText (only the id character differs: "A" -> "Z"),
    // but a genuinely different, independently-parseable event — modelling
    // some OTHER writer's content landing at this exact name, coincidentally
    // the same total byte length as what THIS call would have produced.
    const alienEvt = { ...evt, eventId: "evt-Z" };
    const alienText = `${JSON.stringify(alienEvt)}\n`;
    expect(alienText.length).toBe(addedText.length);
    expect(alienText.endsWith(addedText)).toBe(false);

    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
        commitBeforeThrow: true,
        commitAlienContent: alienText,
      },
    ]);

    const { result } = await withCapturedSleeps(() => appendEventSegment(dir, [evt], WRITER, TEST_LOG));
    expect(result).toBe("verified");

    // Rotated — the size-only coincidence at seq 0 was correctly NOT trusted.
    expect(await segmentNames(dir)).toEqual([name(0), name(1)].sort());
    expect(await readSegmentText(dir, name(0))).toBe(alienText);
    expect(await readSegmentText(dir, name(1))).toContain("evt-A");

    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-Z"]);
  });

  it("does not rotate for a NotFoundError on the write step — keeps the existing patient ladder", async () => {
    // A regression guard for the "non-NotFound" qualifier in the brief: this
    // module already has a pinned test for the patient ladder on write
    // (`gives the segment WRITE the patient ladder, not the fast one`); this
    // adds the rotation-must-NOT-fire counterpart.
    const dir = root({
      faults: [
        {
          operation: "createWritable",
          name: name(0),
          errorName: "NotFoundError",
          times: 5,
        },
      ],
    });

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    // Landed in seq 0 itself — no rotation for a NotFoundError.
    expect(await segmentNames(dir)).toEqual([name(0)]);
  });

  it("R8(b): does not rotate for a NotReadableError on the write step either — patient ladder, same target", async () => {
    // NotReadableError typically fires at getFileHandle/createWritable, BEFORE
    // any replace was attempted — it is not evidence THIS target's replace is
    // being refused, so it must not trigger rotation away from a perfectly
    // good segment. It gets the same patient ladder as NotFoundError.
    const dir = root({
      faults: [
        {
          operation: "createWritable",
          name: name(0),
          errorName: "NotReadableError",
          times: 5,
        },
      ],
    });

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );

    expect(result).toBe("verified");
    // Landed in seq 0 itself — no rotation for a NotReadableError.
    expect(await segmentNames(dir)).toEqual([name(0)]);
    // The PATIENT ladder was used, not the short replace-blocked one.
    expect(ladderPrefix(delays, 5)).toEqual(VERIFY_READBACK_RETRY_DELAYS_MS.slice(0, 5));
  });

  // IMPORTANT 2 (fix round 1): the `ensureReliableRotationTarget` call in
  // THIS branch (the E1b blocked-write rotation loop) was untested — removing
  // it kept the whole 84/84-test file green, because no existing test made
  // the rotation TARGET a blocked write lands on itself come back unreliable.
  // This does: seq 0's close() is persistently refused (the ordinary E1b
  // rotation trigger), AND seq 1 (the target that rotation would normally
  // land on) cannot even be READ. The guard must skip past seq 1 too, and —
  // because it is only ever probed with `create: false` — seq 1 must never
  // be created on disk at all.
  it("IMPORTANT 2: the E1b rotation ALSO protects its own second target — lands in seq2, seq1 is never created", async () => {
    const dir = root({ trackOperations: true });
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
      {
        operation: "getFileHandle",
        name: name(1),
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("A")], WRITER, TEST_LOG)
    );
    expect(result).toBe("verified");
    clearSimulatedFaults(dir);

    expect(await segmentNames(dir)).not.toContain(name(1));
    expect(await readSegmentText(dir, name(2))).toContain("evt-A");
    expect((await loadAll(dir)).map((e) => e.eventId)).toEqual(["evt-A"]);
  });

  it("throws the real underlying error when there is nowhere left to rotate to", async () => {
    const dir = root();
    const base = buildSegmentBaseName(WRITER, SUFFIX);
    const ceilingName = `${base}-${MAX_SEGMENT_SEQ}${SUFFIX}`;
    // Seed the writer's chain AT the ceiling — the same setup the existing
    // "stays FATAL when the baseline was unreliable and the chain cannot
    // rotate away" test above uses — so `seq` is already at MAX_SEGMENT_SEQ
    // and there is genuinely nowhere left to rotate to.
    await writeSegmentText(dir, ceilingName, `${JSON.stringify(event("SEED"))}\n`);
    __resetAppendOnlyEventLogMemosForTests();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    expect(await segmentNames(dir)).toEqual([ceilingName]);

    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: ceilingName,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(
      withCapturedSleeps(() => appendEventSegment(dir, [event("B")], WRITER, TEST_LOG))
    ).rejects.toMatchObject({ name: "InvalidStateError" });

    // Never rewrite/overwrite the failed segment: its prior content survives.
    expect(await readSegmentText(dir, ceilingName)).toContain("evt-SEED");
    expect(await readSegmentText(dir, ceilingName)).toContain("evt-A");
    expect(await readSegmentText(dir, ceilingName)).not.toContain("evt-B");
  });

  it("controller addition #1: a knownWritten segment's re-read that stops on an EXPIRED DEADLINE (not ladder exhaustion) still rotates rather than overwriting", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const sealedBefore = await readSegmentText(dir, name(0));

    // A single NotReadableError on the pre-append re-read of the segment this
    // session already wrote (`knownWritten`).
    setSimulatedFaults(dir, [
      {
        operation: "getFileHandle",
        name: name(0),
        create: false,
        errorName: "NotReadableError",
        times: 1,
      },
    ]);

    // The deadline is already spent BEFORE the retry ladder even starts, so
    // `nextRetryDelayMs` returns null on attempt 0 — the ladder had rungs
    // left; only the deadline stopped it.
    const alreadyExpired: OperationDeadline = { at: Date.now() - 1, label: "test:E1b-controller-1" };

    const { result } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], WRITER, TEST_LOG, { deadline: alreadyExpired })
    );

    expect(result).toBe("verified");
    // The original segment was NOT rewritten — its prior line survived.
    expect(await readSegmentText(dir, name(0))).toBe(sealedBefore);
    // The new batch landed in the rotated segment instead of being lost.
    expect(await readSegmentText(dir, name(1))).toContain("evt-B");
    clearSimulatedFaults(dir);
    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B"]);
  });
});

// R5 (fix round 1): a STORAGE-LEVEL (not answer-level) stable-writer twin of
// the E1b blocked-replace rotation, across TWO simulated reloads — the first
// proving the rotation survives a reload with zero further attempts on the
// now-known-blocked seq 0, the second additionally blocking the ROTATED
// target (seq "-1") too, so the writer must rotate a SECOND time to seq "-2".
describe("R5: a STABLE writer's blocked-replace rotation survives a reload, including a second consecutive block", () => {
  it("seq0 blocked -> reload -> resumes at seq1 with zero further seq0 attempts; seq1 ALSO blocked -> rotates to seq2", async () => {
    const dir = root({ trackOperations: true });
    const stableWriter = { ...WRITER, stable: true };
    const eventsDir = await eventsDirOf(dir);

    await appendEventSegment(dir, [event("A")], stableWriter, TEST_LOG);
    expect(await segmentNames(dir)).toEqual([name(0, stableWriter)]);

    // seq0's REPLACE is persistently refused from here on — the same shape
    // as the production incident, on a stable (cross-reload) writer chain.
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0, stableWriter),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const { result: secondResult } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("B")], stableWriter, TEST_LOG)
    );
    expect(secondResult).toBe("verified");
    expect(await segmentNames(dir)).toEqual(
      expect.arrayContaining([name(0, stableWriter), name(1, stableWriter)])
    );

    // Reload: this tab's in-page memo of "seq0 is blocked, I'm now on seq1"
    // is gone. Only the (still-live) fault plan and the real files on disk
    // remain.
    __resetAppendOnlyEventLogMemosForTests();
    clearOperationLog(eventsDir);

    const { result: thirdResult } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("C")], stableWriter, TEST_LOG)
    );
    expect(thirdResult).toBe("verified");
    // Zero attempts of any kind against seq0 this time — the stable chain's
    // directory listing found seq1 already on disk and resumed there.
    const touchesOnSeqZeroAfterReload = getOperationLog(eventsDir).filter(
      (entry) => entry.name === name(0, stableWriter)
    ).length;
    expect(touchesOnSeqZeroAfterReload).toBe(0);
    expect(await readSegmentText(dir, name(1, stableWriter))).toContain("evt-C");

    // Second reload. NOW seq1 (the rotation target from the first block) is
    // ALSO persistently refused — the "-1-blocked" variant.
    __resetAppendOnlyEventLogMemosForTests();
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: name(0, stableWriter),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
      {
        operation: "close",
        name: name(1, stableWriter),
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    clearOperationLog(eventsDir);

    const { result: fourthResult } = await withCapturedSleeps(() =>
      appendEventSegment(dir, [event("D")], stableWriter, TEST_LOG)
    );
    expect(fourthResult).toBe("verified");
    expect(await readSegmentText(dir, name(2, stableWriter))).toContain("evt-D");
    clearSimulatedFaults(dir);

    const events = await loadAll(dir);
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt-A", "evt-B", "evt-C", "evt-D"]);
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

/* ─────────────── strict mode (F21 fix round 2): a listed-but-unreadable
   segment must not silently vanish for a safety-critical caller ─────────── */

describe("readEventSegmentDelta strict option", () => {
  it("non-strict (default): a segment that fails every retry is silently excluded, as before", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const segName = (await segmentNames(dir))[0]!;
    setSimulatedFaults(dir, [
      { operation: "getFile", name: segName, errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "readFile", name: segName, errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    const delta = await readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG);
    expect(delta.events).toEqual([]);
    // Listed (it exists), but no offset recorded for it — the "vanished"
    // contract readSegmentTails documents: an unread segment must not be
    // marked consumed, so the next read can still pick it up.
    expect(delta.segmentNames).toEqual([segName]);
    expect(delta.offsets[segName]).toBeUndefined();
  });

  it("strict: throws EventSegmentUnreadableError naming the skipped segment instead of excluding it", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A")], WRITER, TEST_LOG);
    const segName = (await segmentNames(dir))[0]!;
    setSimulatedFaults(dir, [
      { operation: "getFile", name: segName, errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
      { operation: "readFile", name: segName, errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);

    const rejection = expect(
      readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG, { strict: true })
    ).rejects;
    await rejection.toBeInstanceOf(EventSegmentUnreadableError);
    await rejection.toMatchObject({ segmentNames: [segName] });
  });

  it("strict: a fully readable segment set behaves exactly like non-strict", async () => {
    const dir = root();
    await appendEventSegment(dir, [event("A"), event("B")], WRITER, TEST_LOG);

    const lenient = await readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG);
    const strict = await readEventSegmentDelta<TestEvent>(dir, {}, TEST_LOG, { strict: true });
    expect(strict).toEqual(lenient);
  });
});

/* ───────── F15: verifySegmentSize's guaranteed first retry (A1) ─────────── */

/**
 * An already-EXPIRED deadline, constructed directly rather than via
 * `createDeadline` (which requires a positive future budget) — exactly the
 * shape `nextRetryDelayMs` sees once `INTERACTIVE_WRITE_DEADLINE_MS` has been
 * spent by casLoop attempts and the inner retry ladders before verification
 * even starts.
 */
function expiredDeadline(): OperationDeadline {
  return { at: Date.now() - 1, label: "test:F15" };
}

/**
 * Installs a fake `getFileHandle` on `eventsDir` that lets the real
 * pre-append re-read and write through untouched, then intercepts the
 * post-close VERIFY read-back (`getFileHandle(name, { create: false })`
 * calls made after the real write's `close()` resolves): the first
 * `staleReads` matching calls return a `File` one byte SHORTER than what was
 * actually written — a stale size, not a corrupted write — and every call
 * after that delegates to the real handle.
 *
 * This is deliberately size-tampering, not a `SimulatedFault` error
 * injection: F15 is about a read that SUCCEEDS with the wrong size (the
 * "share has not caught up yet" case `verifySegmentSize`'s doc comment
 * describes), which `memoryDirectory.ts`'s fault vocabulary — throwing —
 * cannot express.
 */
function installStaleSizeReads(
  eventsDir: DirectoryHandleLike,
  fileName: string,
  staleReads: number
): void {
  const original = eventsDir.getFileHandle.bind(eventsDir);
  let wroteOnce = false;
  let staleReadsLeft = staleReads;
  (eventsDir as { getFileHandle: DirectoryHandleLike["getFileHandle"] }).getFileHandle = async (
    entryName: string,
    options?: { create?: boolean }
  ) => {
    const handle = await original(entryName, options);
    if (entryName !== fileName) return handle;
    if (options?.create) {
      // The write call. Let it through untouched, but learn when its
      // close() resolves — only reads AFTER that point are the post-close
      // verify this test targets, not the pre-append re-read.
      const innerCreateWritable = handle.createWritable!.bind(handle);
      return {
        ...handle,
        createWritable: async () => {
          const writable = await innerCreateWritable();
          return {
            write: (data: string) => writable.write(data),
            close: async () => {
              await writable.close();
              wroteOnce = true;
            },
          };
        },
      };
    }
    // A read. Only fake it once the real write has landed and only for the
    // configured number of calls — the pre-append re-read of a brand-new
    // segment (before wroteOnce) must see the real NotFoundError, untouched.
    if (wroteOnce && staleReadsLeft > 0) {
      staleReadsLeft -= 1;
      return {
        ...handle,
        getFile: async () => {
          const real = await handle.getFile();
          const text = await real.text();
          return new File([text.slice(0, -1)], entryName);
        },
      } satisfies FileHandleLike;
    }
    return handle;
  };
}

describe("F15: verifySegmentSize keeps at least one retry under an expired deadline", () => {
  it("RED/GREEN target — a stale first read followed by a correct second read still verifies (exactly one retry)", async () => {
    const dir = root();
    const eventsDir = await eventsDirOf(dir);
    const fileName = name();
    installStaleSizeReads(eventsDir, fileName, 1);

    const { result, delays } = await withCapturedSleeps(() =>
      appendEventSegment(
        { ...dir, getDirectoryHandle: async () => eventsDir } as unknown as DirectoryHandleLike,
        [event("A")],
        WRITER,
        TEST_LOG,
        { deadline: expiredDeadline() }
      )
    );

    // Succeeded — the stale first observation did not get reported as a
    // fatal, unrecoverable size mismatch.
    expect(result).toBe("verified");
    // Exactly the guaranteed first retry was taken: one sleep, at the
    // ladder's own first rung — not zero (which would mean the deadline was
    // honoured over F15) and not more than one (nothing beyond attempt 0 is
    // exempt from the deadline).
    expect(delays).toEqual([VERIFY_READBACK_RETRY_DELAYS_MS[0]]);
    // The file itself really does hold the one event that was appended.
    expect(await loadAll({ ...dir, getDirectoryHandle: async () => eventsDir } as unknown as DirectoryHandleLike)).toHaveLength(1);
  });

  it("companion — two stale reads in a row still fail, but bounded at the guaranteed retry (never more)", async () => {
    const dir = root();
    const eventsDir = await eventsDirOf(dir);
    const fileName = name();
    // Both the guaranteed attempt-0 read AND attempt 1 (which the expired
    // deadline should refuse to retry past) come back stale.
    installStaleSizeReads(eventsDir, fileName, 2);

    const { delays } = await withCapturedSleeps(() =>
      expect(
        appendEventSegment(
          { ...dir, getDirectoryHandle: async () => eventsDir } as unknown as DirectoryHandleLike,
          [event("A")],
          WRITER,
          TEST_LOG,
          { deadline: expiredDeadline() }
        )
      ).rejects.toThrow(/verification failed/)
    );

    // Bounded: the guaranteed first retry slept once, and the expired
    // deadline then refused a second — never more than the one guaranteed
    // rung, however many stale reads keep coming back.
    expect(delays).toEqual([VERIFY_READBACK_RETRY_DELAYS_MS[0]]);
  });
});
