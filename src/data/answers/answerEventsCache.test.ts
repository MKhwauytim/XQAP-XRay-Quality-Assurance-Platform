/* @vitest-environment jsdom */
/**
 * Coverage for the in-memory, per-tab-session `answers.events/` read cache
 * added to `answerStorage.ts` (see that file's own module doc, right above
 * `readAllAnswerEventsForMonth`, for the full design rationale). Three
 * things matter here, in order of importance:
 *
 *  1. A genuinely stale cache — bytes grown by another writer this tab has
 *     not yet read — is correctly picked up on the very next call, never
 *     silently served as if nothing changed.
 *  2. The perf claim is real: the first read in a fresh tab pays close to
 *     the full month-wide cost once; every subsequent same-tab read is
 *     cheap and does NOT grow with total team history.
 *  3. Every P0-1 guarantee ("unreadable never becomes empty") and every
 *     existing Stage 2 contract test keeps working with the cache active —
 *     this file adds new coverage, it does not replace
 *     `answerStorageStage2.test.ts`'s own P0-1 case.
 */
import { describe, test, expect, beforeEach } from "vitest";

import { createMemoryDirectory, getOperationLog, clearOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { workspaceScopeId } from "../storage/inFlightReads";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";
import {
  ANSWER_EVENTS_DIR,
  appendAnswerEventSegment,
  type AnswerEvent,
} from "./answerEventStore";
import {
  __resetAnswerEventsCacheForTests,
  loadEmployeeAnswers,
  upsertItemAnswer,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-may-2026";
const EMPLOYEE = "emp1";

beforeEach(() => {
  __resetAnswerEventsCacheForTests();
});

function makeItem(overrides?: Partial<ItemAnswer>): ItemAnswer {
  return {
    xrayImageId: "X1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "v0" }],
    lastSavedAt: "2026-05-12T09:00:00.000Z",
    submittedAt: null,
    answeredBy: EMPLOYEE,
    status: "draft",
    ...overrides,
  };
}

/**
 * Every `.ndjson` content-read this call made (`readFile` op = an actual
 * `.slice(offset).text()`/`.text()`, as opposed to `getFile`, a free
 * size-only stat — see `directoryScan.ts`'s `readSegmentTails`). This is the
 * metric the cache is meant to shrink; it is not "bytes read" directly, but a
 * direct 1:1 proxy for it (one op per segment file whose content was
 * transferred).
 *
 * TWO SOURCES contribute to this count, and only one is what the cache
 * optimizes:
 *  - the READ side (`readAnswerEventDelta` → `readSegmentTails`), which is
 *    what this cache makes incremental — this is the count that shrinks from
 *    "every matched segment" to "only segments that grew since this tab last
 *    looked".
 *  - the WRITE side's own unavoidable "read the existing segment before
 *    rewriting it" step (`appendEventSegment` in `appendOnlyEventLog.ts` —
 *    the Like-handle contract has no true positional-append primitive, so
 *    every append is read-modify-write). This fires once per actual append,
 *    ALWAYS, on exactly the writer's own currently-open segment — it existed
 *    before this cache and is unaffected by it. It never scales with team
 *    size (only with how large THIS writer's own open segment has grown), so
 *    it does not undermine the scaling claim below, but it does mean a
 *    steady-state warm call costs a small constant (2), not 1: one read-side
 *    op (this cache's job) plus one write-side op (pre-existing, orthogonal).
 */
function segmentReadFileOps(dir: DirectoryHandleLike): number {
  return getOperationLog(dir).filter(
    (entry) => entry.operation === "readFile" && entry.name.endsWith(".ndjson")
  ).length;
}

/** Seed `count` OTHER employees' segment history directly through the
 *  low-level append primitive (bypassing `answerStorage.ts`'s write functions
 *  entirely) — each with its own writer identity, so each lands in its own
 *  segment file, matching a real multi-employee `answers.events/` directory. */
async function seedOtherEmployeesHistory(
  dir: DirectoryHandleLike,
  month: string,
  count: number
): Promise<void> {
  const mainDir = await getSampleMainDir(dir, month, true);
  for (let i = 0; i < count; i += 1) {
    const username = `seed-emp-${i}`;
    const seed: AnswerEvent = {
      eventId: `seed-${i}`,
      eventType: "migration-seed",
      eventAt: `2026-05-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      eventBy: username,
      authority: "self",
      answeredBy: username,
      legacyContentHash: "",
    };
    const saved: AnswerEvent = {
      eventId: `seed-${i}-item`,
      eventType: "item-saved",
      eventAt: `2026-05-01T00:01:${String(i).padStart(2, "0")}.000Z`,
      eventBy: username,
      authority: "self",
      xrayImageId: `SEED-${i}`,
      answers: [{ fieldId: "f1", value: `seed-${i}` }],
      status: "draft",
      answeredBy: username,
    };
    await appendAnswerEventSegment(mainDir, [seed, saved], {
      deviceId: `seed-device-${i}`,
      sessionId: `seed-session-${i}`,
      // Matches `answerWriterIdentity` in `answerStorage.ts`: without a real
      // per-(root, month) scopeId, the generic module's `writtenSegmentsThisSession`
      // memo (`appendOnlyEventLog.ts`) is keyed only on device+session, so the
      // SAME synthetic deviceId/sessionId reused across two different tests'
      // directories in the same process would make the second test's genuinely
      // brand-new segment look like "already written this session" to a
      // directory it has never touched — forcing the patient ~11s retry ladder
      // on every such call instead of the instant "fresh segment" answer.
      scopeId: `${workspaceScopeId(dir)}|${month}`,
    });
  }
}

describe("cache eliminates redundant month-wide re-reads within one tab session", () => {
  test("the first save pays the full-directory read cost once; every later save in the same tab is cheap and does not grow with team history", async () => {
    const dir = createMemoryDirectory("root-perf", { trackOperations: true } as never);
    await seedOtherEmployeesHistory(dir, MONTH, 5);

    clearOperationLog(dir);
    const first = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" }));
    expect(first.ok).toBe(true);
    const firstCallOps = segmentReadFileOps(dir);
    // Cold: this tab has never read the month before, so it pays for every
    // pre-existing segment (the 5 seeded employees' history) plus its own
    // (not-yet-existing) segment, discovered as new mid-call.
    expect(firstCallOps).toBe(5);

    clearOperationLog(dir);
    const second = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X2" }));
    expect(second.ok).toBe(true);
    const secondCallOps = segmentReadFileOps(dir);
    // Warm: none of the 5 seeded segments changed since the first read, so
    // only this tab's own segment is touched — once by the cache's own
    // incremental delta read, once by the append's unavoidable pre-write
    // existing-content read (see segmentReadFileOps's doc). Both are O(1),
    // neither scales with the 5 seeded employees.
    expect(secondCallOps).toBe(2);
    expect(secondCallOps).toBeLessThan(firstCallOps);

    clearOperationLog(dir);
    const third = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X3" }));
    expect(third.ok).toBe(true);
    const thirdCallOps = segmentReadFileOps(dir);
    // Steady state: still just this tab's own small, constant cost, never the
    // whole team's history again.
    expect(thirdCallOps).toBe(2);

    clearOperationLog(dir);
    const fourth = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X4" }));
    expect(fourth.ok).toBe(true);
    expect(segmentReadFileOps(dir)).toBe(2);

    // And the state is actually correct throughout — nothing was silently
    // dropped by reading incrementally.
    const file = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(file.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X2", "X3", "X4"]);
  });

  test("scaling: N sequential saves cost O(seeded team history) once + O(N) small increments, never O(N * team history)", async () => {
    const dir = createMemoryDirectory("root-scale", { trackOperations: true } as never);
    await seedOtherEmployeesHistory(dir, MONTH, 20);

    let totalOps = 0;
    for (let i = 0; i < 8; i += 1) {
      clearOperationLog(dir);
      const result = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: `X${i}` }));
      expect(result.ok).toBe(true);
      totalOps += segmentReadFileOps(dir);
    }
    // Unfixed behaviour (readAnswerEventDelta(mainDir, {}) on every call) would
    // have cost roughly 20 segment reads PER call from the read side alone,
    // i.e. ~160 for 8 calls, before even counting the write side's own
    // unavoidable pre-write read (segmentReadFileOps's doc). With the cache:
    // one cold read of the 20 seeded segments (call 1, read side only — this
    // employee's own segment does not exist yet so the write side contributes
    // nothing) plus a small CONSTANT 2 per later call (calls 2-8: one
    // read-side op the cache makes incremental, one write-side op that always
    // fires on append and is unaffected by this cache either way) =
    // 20 + 7*2 = 34 — versus the unfixed ~160+ that scales with
    // (calls * seeded team history).
    expect(totalOps).toBe(34);
  });
});

describe("a genuinely stale cache is detected, never silently served as current", () => {
  test("an event appended by ANOTHER writer (simulated second tab/machine) between two reads in THIS tab is picked up on the very next read", async () => {
    const dir = createMemoryDirectory();
    const mainDir = await getSampleMainDir(dir, MONTH, true);

    // This tab reads and caches once.
    const first = await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" }));
    expect(first.ok).toBe(true);
    const before = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(before.items.map((i) => i.xrayImageId)).toEqual(["X1"]);

    // ANOTHER writer session (different device/session — a second tab or
    // machine) appends a save for a DIFFERENT item directly, bypassing this
    // tab's cache/write path entirely, the way a real second client would.
    const otherWriterEvent: AnswerEvent = {
      eventId: "other-tab-1",
      eventType: "item-saved",
      eventAt: "2026-05-12T09:05:00.000Z",
      eventBy: EMPLOYEE,
      authority: "self",
      xrayImageId: "X2",
      answers: [{ fieldId: "f1", value: "from-other-tab" }],
      status: "draft",
      answeredBy: EMPLOYEE,
    };
    await appendAnswerEventSegment(mainDir, [otherWriterEvent], {
      deviceId: "other-device",
      sessionId: "other-session",
    });

    // This tab never explicitly invalidated anything — the very next read
    // must still see the externally-added event, not the cached snapshot
    // from before it existed.
    const after = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(after.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X2"]);
  });

  test("a THIRD writer's segment appearing for the first time is picked up even though this tab's cache already holds other segments", async () => {
    const dir = createMemoryDirectory();
    const mainDir = await getSampleMainDir(dir, MONTH, true);

    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" }));
    await loadEmployeeAnswers(dir, MONTH, EMPLOYEE); // establish a cache entry

    // A brand-new segment file this tab has never seen the NAME of before —
    // not just growth of a known file.
    const brandNewSegment: AnswerEvent = {
      eventId: "brand-new-writer-1",
      eventType: "item-saved",
      eventAt: "2026-05-12T09:10:00.000Z",
      eventBy: EMPLOYEE,
      authority: "self",
      xrayImageId: "X3",
      answers: [{ fieldId: "f1", value: "brand-new" }],
      status: "draft",
      answeredBy: EMPLOYEE,
    };
    await appendAnswerEventSegment(mainDir, [brandNewSegment], {
      deviceId: "yet-another-device",
      sessionId: "yet-another-session",
    });

    const after = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(after.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X3"]);
  });

  test("the manual refresh signal wholesale-drops the cache; a periodic broadcast alone does not", async () => {
    const dir = createMemoryDirectory("root-manual", { trackOperations: true } as never);
    await seedOtherEmployeesHistory(dir, MONTH, 4);

    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" }));

    // A periodic tick must NOT force a full re-read — that would defeat the
    // cache for the exact "active team" scenario it exists to help (see the
    // module doc's INVALIDATION note). Still just the small constant cost
    // (one cache-incremental read + one write-side pre-write read, per
    // segmentReadFileOps's doc), unrelated to the 4 seeded segments.
    broadcastDataRefresh("periodic");
    clearOperationLog(dir);
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X2" }));
    expect(segmentReadFileOps(dir)).toBe(2);

    // An explicit manual refresh (the admin toolbar button) DOES force a full
    // cold re-read on the next call — the one safety valve this cache relies
    // on for the residual "bytes replaced under an unchanged name" case
    // (a backup restore) that a pure byte-growth diff cannot see.
    broadcastDataRefresh("manual");
    clearOperationLog(dir);
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X3" }));
    // Cold again: 4 seeded segments + this employee's own (now pre-existing)
    // segment, all via the read side (5), plus the write side's one
    // unavoidable pre-write read of this employee's own segment (1) = 6.
    expect(segmentReadFileOps(dir)).toBe(6);
  });
});

describe("P0-1 preserved: an unreadable segment throws through the cache, warm or cold", () => {
  test("cold (never read before): a corrupt segment throws rather than reading as empty", async () => {
    const dir = createMemoryDirectory();
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem());

    const mainDir = await getSampleMainDir(dir, MONTH, true);
    const eventsDir = await mainDir.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const names = await listNdjsonNames(eventsDir);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const handle = await eventsDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{not valid ndjson\n");
      await writable.close();
    }

    // Fresh tab (fresh cache) reading this month for the first time.
    __resetAnswerEventsCacheForTests();
    await expect(loadEmployeeAnswers(dir, MONTH, EMPLOYEE)).rejects.toThrow();
  });

  test("warm (this tab already cached a real offset for the segment): corruption appended past that offset still throws, never silently drops back to cached state", async () => {
    const dir = createMemoryDirectory();
    const mainDir = await getSampleMainDir(dir, MONTH, true);

    // Two real saves establish a genuine, non-zero cached offset for this
    // employee's own segment (see this file's header doc / the perf test
    // above for why the SECOND call is the first one to actually record a
    // real offset for a freshly-created segment).
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X1" }));
    await upsertItemAnswer(dir, MONTH, EMPLOYEE, makeItem({ xrayImageId: "X2" }));
    const before = await loadEmployeeAnswers(dir, MONTH, EMPLOYEE);
    expect(before.items.map((i) => i.xrayImageId).sort()).toEqual(["X1", "X2"]);

    const eventsDir = await mainDir.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const names = await listNdjsonNames(eventsDir);
    expect(names).toHaveLength(1);
    const [name] = names as [string];
    const handle = await eventsDir.getFileHandle(name, { create: false });
    const existing = await (await handle.getFile()).text();
    const writable = await handle.createWritable!();
    // GROW the file past the cached offset with unparseable content, so a
    // real tail-read is forced (this is not the "shrink" case — see this
    // file's own header doc on that residual, documented gap).
    await writable.write(`${existing}not valid ndjson\n`);
    await writable.close();

    await expect(loadEmployeeAnswers(dir, MONTH, EMPLOYEE)).rejects.toThrow();
  });
});

async function listNdjsonNames(dir: DirectoryHandleLike): Promise<string[]> {
  const iterable = (dir as DirectoryHandleLike & {
    values: () => AsyncIterable<{ name: string; kind: string }>;
  }).values();
  const names: string[] = [];
  for await (const entry of iterable) {
    if (entry.kind === "file" && entry.name.endsWith(".ndjson")) names.push(entry.name);
  }
  return names;
}
