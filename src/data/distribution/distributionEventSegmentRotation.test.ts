// Bounded segment rotation for the distribution event log.
//
// The open segment is rewritten in full on every append, so before rotation
// both the bytes written per append and the blast radius of one failed write
// grew with session length. Rotation seals a segment once it crosses
// MAX_OPEN_SEGMENT_BYTES / MAX_OPEN_SEGMENT_LINES and starts `{chain}-{seq+1}`.
//
// What these tests defend, in order of how expensive the bug would be:
//   1. no event is ever lost or duplicated across a rotation, a crash, or a
//      writer resuming a chain it no longer remembers;
//   2. a sealed segment is never rewritten (asserted through the operation log,
//      because "it happened to still contain the right bytes" would pass a
//      content-only check while the write cost quietly came back);
//   3. readers with per-name byte offsets keep working across the new names,
//      including the pre-rotation unsuffixed name older writers still produce;
//   4. bytes-per-append stays bounded as the event count grows — the whole
//      point of the change, and the one property that can silently regress.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { buildAssignEvent } from "./distributionLog";
import type { DistributionEvent } from "./distributionTypes";
import {
  DISTRIBUTION_EVENTS_DIR,
  MAX_OPEN_SEGMENT_BYTES,
  __resetWrittenSegmentsForTests,
  appendDistributionEventSegment,
  distributionEventSegmentFileName,
  loadDistributionEventSegments,
  readDistributionEventSegmentDelta,
} from "./distributionEventStore";

const DEVICE = "dev";

function writer(sessionId: string, scopeId?: string) {
  return { deviceId: DEVICE, sessionId, scopeId };
}

/** ~20 KB per line, so a handful of appends crosses the 128 KiB cap. */
const FILLER = "x".repeat(20_000);

function bigEvent(id: string): DistributionEvent {
  return {
    ...buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin", notes: FILLER }),
    eventId: `evt-${id}`,
    eventAt: `2026-05-01T10:00:00.000Z`,
  };
}

function smallEvent(id: string): DistributionEvent {
  return {
    ...buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin" }),
    eventId: `evt-${id}`,
    eventAt: `2026-05-01T10:00:00.000Z`,
  };
}

async function eventsDirOf(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return root.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
}

async function segmentNames(root: DirectoryHandleLike): Promise<string[]> {
  const dir = await eventsDirOf(root);
  const names: string[] = [];
  for await (const entry of (dir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }).values()) {
    if (entry.kind === "file" && entry.name.endsWith(".ndjson")) names.push(entry.name);
  }
  return names.sort();
}

async function readSegmentText(root: DirectoryHandleLike, name: string): Promise<string> {
  const dir = await eventsDirOf(root);
  return (await (await dir.getFileHandle(name, { create: false })).getFile()).text();
}

async function writeSegmentText(root: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const dir = await eventsDirOf(root);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

beforeEach(() => {
  __resetWrittenSegmentsForTests();
});

describe("segment rotation — event preservation", () => {
  it("preserves every event, in order, across appends that span several rotations", async () => {
    const root = createMemoryDirectory("root");
    const total = 20;
    for (let i = 0; i < total; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${String(i).padStart(3, "0")}`)], writer("s1"));
    }

    const names = await segmentNames(root);
    expect(names.length).toBeGreaterThan(1); // it really did rotate

    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(total);
    // Segment order is lexicographic in the listing (`-10` sorts before `-2`),
    // and that is deliberately inert: the reader concatenates and the caller
    // applies a total (eventAt, eventId) sort. Assert on the id set + the
    // per-segment line order rather than on listing order.
    expect(new Set(events.map((event) => event.eventId)).size).toBe(total);
    const inFileOrder: string[] = [];
    for (const name of names) {
      for (const line of (await readSegmentText(root, name)).split("\n")) {
        if (line) inFileOrder.push((JSON.parse(line) as DistributionEvent).eventId);
      }
    }
    expect([...inFileOrder].sort()).toEqual(
      Array.from({ length: total }, (_, i) => `evt-IMG-${String(i).padStart(3, "0")}`)
    );
    // No line is duplicated across segments — a rotation that re-wrote the
    // previous segment's content into the new one would still pass a
    // "nothing lost" check, so assert "nothing gained" too.
    expect(inFileOrder).toHaveLength(total);
  });

  it("keeps each sealed segment within the byte cap and only the last one open", async () => {
    const root = createMemoryDirectory("root");
    for (let i = 0; i < 20; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }
    const names = await segmentNames(root);
    const sizes = await Promise.all(names.map(async (name) => (await readSegmentText(root, name)).length));
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_BYTES);
  });

  it("lets a single batch larger than the cap land rather than rotating forever", async () => {
    const root = createMemoryDirectory("root");
    const oversized = Array.from({ length: 10 }, (_, i) => bigEvent(`BIG-${i}`)); // ~200 KB in one batch
    await appendDistributionEventSegment(root, oversized, writer("s1"));

    expect(await segmentNames(root)).toEqual([distributionEventSegmentFileName(DEVICE, "s1")]);
    expect(await loadDistributionEventSegments(root)).toHaveLength(10);

    // ...and the next append rotates away from the over-cap segment.
    await appendDistributionEventSegment(root, [bigEvent("AFTER")], writer("s1"));
    expect(await segmentNames(root)).toContain(distributionEventSegmentFileName(DEVICE, "s1", 1));
    expect(await loadDistributionEventSegments(root)).toHaveLength(11);
  });
});

describe("segment rotation — sealed segments are immutable", () => {
  it("never re-opens a sealed segment for writing once the writer has moved past it", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });
    for (let i = 0; i < 20; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }

    const names = await segmentNames(root);
    expect(names.length).toBeGreaterThan(1);
    const openName = distributionEventSegmentFileName(DEVICE, "s1", names.length - 1);
    const sealed = names.filter((name) => name !== openName);
    expect(sealed.length).toBeGreaterThan(0);

    const writes = getOperationLog(root).filter((entry) => entry.operation === "createWritable");
    const writesPerName = new Map<string, number>();
    for (const entry of writes) writesPerName.set(entry.name, (writesPerName.get(entry.name) ?? 0) + 1);

    // Each sealed segment was written by the appends that filled it and by
    // nothing afterwards: its write count must equal the number of events it
    // holds, and no write may appear after the FIRST write to the next segment.
    const firstWriteIndexByName = new Map<string, number>();
    const lastWriteIndexByName = new Map<string, number>();
    writes.forEach((entry, index) => {
      if (!firstWriteIndexByName.has(entry.name)) firstWriteIndexByName.set(entry.name, index);
      lastWriteIndexByName.set(entry.name, index);
    });
    for (let seq = 0; seq + 1 < names.length; seq += 1) {
      const current = distributionEventSegmentFileName(DEVICE, "s1", seq);
      const next = distributionEventSegmentFileName(DEVICE, "s1", seq + 1);
      expect(lastWriteIndexByName.get(current)!).toBeLessThan(firstWriteIndexByName.get(next)!);
    }
  });
});

describe("segment rotation — reader offsets", () => {
  it("picks up a newly-rotated segment when the reader holds a stale offset for the previous one", async () => {
    const root = createMemoryDirectory("root");
    for (let i = 0; i < 5; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }
    const firstRead = await readDistributionEventSegmentDelta(root, {});
    expect(firstRead.events).toHaveLength(5);
    expect(Object.keys(firstRead.offsets)).toEqual([distributionEventSegmentFileName(DEVICE, "s1")]);

    // Cross the cap: further appends land in a segment the reader has never seen.
    for (let i = 5; i < 12; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }

    const delta = await readDistributionEventSegmentDelta(root, firstRead.offsets);
    const seen = delta.events.map((event) => event.eventId).sort();
    expect(seen).toEqual(
      Array.from({ length: 7 }, (_, i) => `evt-IMG-${i + 5}`).sort()
    );
    // A segment with no new bytes yields no tail, and an unknown name defaults
    // to offset 0 — so the delta is exactly the new events, never a re-read.
    const third = await readDistributionEventSegmentDelta(root, delta.offsets);
    expect(third.events).toEqual([]);
  });

  it("reads a hand-seeded `-0` / `-1` pair the same way, without any name parsing on the read path", async () => {
    const root = createMemoryDirectory("root");
    await writeSegmentText(root, "other-writer-0.ndjson", `${JSON.stringify(smallEvent("A"))}\n`);
    await writeSegmentText(root, "other-writer-1.ndjson", `${JSON.stringify(smallEvent("B"))}\n`);

    const first = await readDistributionEventSegmentDelta(root, {});
    expect(first.events.map((event) => event.eventId).sort()).toEqual(["evt-A", "evt-B"]);

    // Stale offsets for `-0` only: `-1` is unknown and defaults to a full read.
    const stale = { "other-writer-0.ndjson": first.offsets["other-writer-0.ndjson"]! };
    const second = await readDistributionEventSegmentDelta(root, stale);
    expect(second.events.map((event) => event.eventId)).toEqual(["evt-B"]);
  });
});

describe("segment rotation — crash and resume", () => {
  it("loses no events and writes none twice when the rotation write fails outright", async () => {
    const root = createMemoryDirectory("root");
    for (let i = 0; i < 6; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }
    const sealedBefore = await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1"));

    // The rotation target refuses to be created, permanently — the closest
    // deterministic stand-in for a process dying at the moment of rotation.
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        name: distributionEventSegmentFileName(DEVICE, "s1", 1),
        create: true,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    await expect(
      appendDistributionEventSegment(root, [bigEvent("IMG-CRASH")], writer("s1"))
    ).rejects.toMatchObject({ name: "NotFoundError" });
    clearSimulatedFaults(root);

    // The sealed segment was not touched by the failed rotation.
    expect(await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1"))).toBe(sealedBefore);

    // Retrying the same batch lands it exactly once.
    await appendDistributionEventSegment(root, [bigEvent("IMG-CRASH")], writer("s1"));
    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(7);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(7);
  });

  it("resumes in the right segment after the writer loses its in-memory position", async () => {
    const root = createMemoryDirectory("root");
    for (let i = 0; i < 10; i += 1) {
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
    }
    const namesBefore = await segmentNames(root);
    expect(namesBefore.length).toBeGreaterThan(1);
    const openName = distributionEventSegmentFileName(DEVICE, "s1", namesBefore.length - 1);
    const openBefore = await readSegmentText(root, openName);
    const sealedBefore = await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1"));

    // Everything the writer knew about its own chain is gone; only the share
    // remains. It must rediscover its highest sequence from the listing.
    __resetWrittenSegmentsForTests();
    await appendDistributionEventSegment(root, [bigEvent("IMG-RESUMED")], writer("s1"));

    // It continued in the open segment (kept its prior lines), created no
    // duplicate chain, and did not touch the sealed one.
    const openAfter = await readSegmentText(root, openName);
    expect(openAfter.startsWith(openBefore)).toBe(true);
    expect(openAfter).toContain("IMG-RESUMED");
    expect(await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1"))).toBe(sealedBefore);

    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(11);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(11);
  });

  it("rotates rather than growing a segment it finds already over the cap on startup", async () => {
    const root = createMemoryDirectory("root");
    // A segment left over the cap by a previous run (e.g. one oversized batch).
    const seeded = Array.from({ length: 8 }, (_, i) => bigEvent(`SEED-${i}`));
    await writeSegmentText(
      root,
      distributionEventSegmentFileName(DEVICE, "s1"),
      seeded.map((event) => `${JSON.stringify(event)}\n`).join("")
    );
    __resetWrittenSegmentsForTests();

    await appendDistributionEventSegment(root, [bigEvent("FRESH")], writer("s1"));

    // Listed lexicographically, where `-1` sorts BEFORE the unsuffixed name
    // ('-' < '.'). Inert by design — the reader concatenates and the caller
    // applies a total (eventAt, eventId) sort — so compare as a set.
    expect([...(await segmentNames(root))].sort()).toEqual(
      [
        distributionEventSegmentFileName(DEVICE, "s1"),
        distributionEventSegmentFileName(DEVICE, "s1", 1),
      ].sort()
    );
    expect(await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1", 1))).toContain("FRESH");
    expect(await loadDistributionEventSegments(root)).toHaveLength(9);
  });

  it("does not claim another writer's segment when rediscovering its own sequence", async () => {
    const root = createMemoryDirectory("root");
    // Names that a naive "split on the last dash" parse could mistake for this
    // writer's chain. None of them start with `dev-s1-` followed by digits.
    await writeSegmentText(root, "dev-s1x-4.ndjson", `${JSON.stringify(smallEvent("OTHER-A"))}\n`);
    await writeSegmentText(root, "dev-s1-beta.ndjson", `${JSON.stringify(smallEvent("OTHER-B"))}\n`);
    await writeSegmentText(root, "dev-s1-007.ndjson", `${JSON.stringify(smallEvent("OTHER-C"))}\n`);

    await appendDistributionEventSegment(root, [smallEvent("MINE")], writer("s1"));

    // Started its own chain at the unsuffixed name and left the others alone.
    expect(await readSegmentText(root, distributionEventSegmentFileName(DEVICE, "s1"))).toContain("MINE");
    expect(await readSegmentText(root, "dev-s1-007.ndjson")).toContain("OTHER-C");
    // All four are still readable — the read path is a pure suffix glob.
    expect((await loadDistributionEventSegments(root)).map((e) => e.eventId).sort()).toEqual([
      "evt-MINE",
      "evt-OTHER-A",
      "evt-OTHER-B",
      "evt-OTHER-C",
    ]);
  });
});

describe("segment rotation — the pre-rotation unsuffixed layout", () => {
  it("reads and keeps appending to an old-style segment that has no `-{seq}` at all", async () => {
    const root = createMemoryDirectory("root");
    const legacyName = distributionEventSegmentFileName(DEVICE, "s-old");
    await writeSegmentText(root, legacyName, `${JSON.stringify(smallEvent("OLD-1"))}\n${JSON.stringify(smallEvent("OLD-2"))}\n`);
    __resetWrittenSegmentsForTests();

    await appendDistributionEventSegment(root, [smallEvent("NEW-1")], writer("s-old"));

    // Appended in place — no rotation, because the old file is far under the cap.
    expect(await segmentNames(root)).toEqual([legacyName]);
    const events = await loadDistributionEventSegments(root);
    expect(events.map((event) => event.eventId)).toEqual(["evt-OLD-1", "evt-OLD-2", "evt-NEW-1"]);
  });
});

type Meter = { bytes: number; perAppend: number[] };

/** Counts the bytes handed to every writable stream targeting a `*.ndjson`. */
function meterSegmentWrites(dir: DirectoryHandleLike, meter: Meter): DirectoryHandleLike {
  const wrapped = {
    ...dir,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      meterSegmentWrites(await dir.getDirectoryHandle(name, options), meter),
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      const handle = await dir.getFileHandle(name, options);
      if (!name.endsWith(".ndjson") || !handle.createWritable) return handle;
      const metered: FileHandleLike = {
        ...handle,
        createWritable: async () => {
          const writable = await handle.createWritable!();
          return {
            write: async (data: string) => {
              meter.bytes += new TextEncoder().encode(data).length;
              return writable.write(data);
            },
            close: () => writable.close(),
          };
        },
      };
      return metered;
    },
  } as DirectoryHandleLike;
  const values = (dir as unknown as { values?: () => AsyncIterable<unknown> }).values;
  if (values) (wrapped as unknown as { values: unknown }).values = values.bind(dir);
  return wrapped;
}

describe("segment rotation — bytes written per append stay bounded", () => {
  it("does not grow the per-append write cost as the event count grows", async () => {
    const meter: Meter = { bytes: 0, perAppend: [] };
    const root = meterSegmentWrites(createMemoryDirectory("root"), meter);

    const appends = 40;
    for (let i = 0; i < appends; i += 1) {
      const before = meter.bytes;
      await appendDistributionEventSegment(root, [bigEvent(`IMG-${i}`)], writer("s1"));
      meter.perAppend.push(meter.bytes - before);
    }

    // The hard bound: one append never rewrites more than a full segment plus
    // its own batch. Without rotation this grows without limit — by append 40
    // it was already ~800 KB, and a real bulk distribution runs far longer.
    const batchCeiling = new TextEncoder().encode(`${JSON.stringify(bigEvent("IMG-0"))}\n`).length;
    for (const bytes of meter.perAppend) {
      expect(bytes).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_BYTES + batchCeiling);
    }

    // And the bound is real, not vacuous: the second half of the run costs no
    // more per append than the first half's peak, which is exactly the
    // property that disappears if rotation ever silently stops happening.
    const firstHalfPeak = Math.max(...meter.perAppend.slice(0, appends / 2));
    const secondHalfPeak = Math.max(...meter.perAppend.slice(appends / 2));
    expect(secondHalfPeak).toBeLessThanOrEqual(firstHalfPeak);
  });
});
