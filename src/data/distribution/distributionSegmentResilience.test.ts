// Every way a Phase 4 event append can fail on a real UNC/SMB share, and the
// defence for each.
//
// Field history: `XQ-IO-031` was reported four times running, after a longer
// retry ladder (v98.0), an extension probe (v98.3) and rotation away from an
// unreadable segment (v98.6). Each of those fixed a real path and none stopped
// the report, and the remaining fatal emitter on a Phase 4 save is the segment
// WRITE itself — `getFileHandle(create:true)` / `createWritable()` raising
// NotFoundError in a directory the probe finds healthy. That is a per-NAME
// failure, not a transient one, so this file pins the three per-name causes
// (name length, blocked extension, oversized single write) plus the two
// mechanical ones (a short retry ladder, a stale directory handle).
import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { clearSimulatedFaults, createMemoryDirectory } from "../storage/memoryDirectory";
import { listDirectoryEntries } from "../storage/directoryScan";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { buildAssignEvent } from "./distributionLog";
import {
  DISTRIBUTION_EVENTS_DIR,
  MAX_OPEN_SEGMENT_BYTES,
  MAX_OPEN_SEGMENT_LINES,
  __resetWrittenSegmentsForTests,
  appendDistributionEventsDurably,
  chunkEventsForSegmentAppends,
  distributionEventSegmentFileName,
  loadDistributionEventSegments,
  loadImmutableDistributionEvents,
} from "./distributionEventStore";

const DEVICE_UUID = "3c26ccb7-0eeb-4173-a880-0bdd31c80324";
const SESSION_UUID = "70dbde0f-3fc7-48a6-97d3-ac3d1248ec0b";

function writer(sessionId = SESSION_UUID) {
  return { deviceId: DEVICE_UUID, sessionId };
}

function assignEvents(count: number, prefix = "IMG") {
  return Array.from({ length: count }, (_unused, index) =>
    buildAssignEvent({
      xrayImageId: `${prefix}-${index}`,
      assignedTo: "emp-1",
      eventBy: "admin",
      notes: "تعيين تلقائي",
    })
  );
}

async function segmentFiles(root: DirectoryHandleLike): Promise<{ name: string; size: number }[]> {
  const eventsDir = await root.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
  const files: { name: string; size: number }[] = [];
  for (const entry of await listDirectoryEntries(eventsDir)) {
    if (entry.kind !== "file" || !entry.name.endsWith(".ndjson")) continue;
    const handle = await eventsDir.getFileHandle(entry.name, { create: false });
    files.push({ name: entry.name, size: (await handle.getFile()).size });
  }
  return files;
}

/** `logCodedError` puts the code in the entry CONTEXT, not the message. */
function fallbackLogEntries() {
  return getRecentErrors().filter((entry) => entry.context.includes("XQ-DIST-009"));
}

beforeEach(() => {
  __resetWrittenSegmentsForTests();
  clearErrors();
});

describe("segment names are short enough for a deep UNC path", () => {
  it("keeps a segment name at 22 characters even from two UUIDs", () => {
    const name = distributionEventSegmentFileName(DEVICE_UUID, SESSION_UUID);
    // Was `{36}-{36}.ndjson` = 80 characters, and Chromium's `.crswap` sibling
    // 87 — over Windows' 260-character path budget on a deep share path, while
    // every other file this app writes fits.
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name.endsWith(".ndjson")).toBe(true);
    // A rotated sibling stays short too.
    expect(distributionEventSegmentFileName(DEVICE_UUID, SESSION_UUID, 12).length)
      .toBeLessThanOrEqual(27);
  });

  it("still distinguishes two writer sessions on the same device", () => {
    const first = distributionEventSegmentFileName(DEVICE_UUID, SESSION_UUID);
    const second = distributionEventSegmentFileName(DEVICE_UUID, "9f8e7d6c-1111-2222-3333-444455556666");
    expect(first).not.toBe(second);
  });

  it("lands the batch on a share that rejects any name of 24+ characters", async () => {
    const root = createMemoryDirectory("root", {
      // A path-length limit: short names are created, long ones raise
      // NotFoundError in a directory that is otherwise perfectly writable.
      // The pre-fix 80-character segment name fell on this side of the line.
      faults: [
        {
          operation: "getFileHandle",
          create: true,
          nameMinLength: 24,
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    await expect(
      appendDistributionEventsDurably(root, assignEvents(3), { writer: writer() })
    ).resolves.toBe("verified");

    clearSimulatedFaults(root);
    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(3);
  });
});

describe("chunkEventsForSegmentAppends", () => {
  it("bounds every chunk by bytes and by lines, preserving order", () => {
    const events = assignEvents(4_000);
    const chunks = chunkEventsForSegmentAppends(events);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_LINES);
      const bytes = new TextEncoder().encode(
        chunk.map((event) => `${JSON.stringify(event)}\n`).join("")
      ).length;
      expect(bytes).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_BYTES);
    }
    expect(chunks.flat().map((event) => event.xrayImageId)).toEqual(
      events.map((event) => event.xrayImageId)
    );
  });

  it("gives a single oversized event its own chunk rather than dropping it", () => {
    const [big] = assignEvents(1);
    const huge = { ...big!, notes: "ن".repeat(MAX_OPEN_SEGMENT_BYTES) };
    const chunks = chunkEventsForSegmentAppends([huge, ...assignEvents(2, "SMALL")]);
    expect(chunks[0]).toEqual([huge]);
    expect(chunks.flat()).toHaveLength(3);
  });
});

describe("a whole-month batch never becomes one giant write", () => {
  it("writes a 3,000-event batch as bounded segments and reads every event back", async () => {
    const root = createMemoryDirectory("root");

    await expect(
      appendDistributionEventsDurably(root, assignEvents(3_000), { writer: writer() })
    ).resolves.toBe("verified");

    const files = await segmentFiles(root);
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      // Pre-fix, `shouldRotate`'s empty-segment escape hatch let the entire
      // batch land in one file — a multi-megabyte single write on the share.
      expect(file.size).toBeLessThanOrEqual(MAX_OPEN_SEGMENT_BYTES);
    }
    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(3_000);
  });
});

describe("the write itself gets the patient ladder", () => {
  it("survives 5 consecutive NotFoundError write failures without falling back", async () => {
    const root = createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          nameSuffix: ".ndjson",
          errorName: "NotFoundError",
          // The old short ladder allowed 4 retries (~630 ms) and would fail here.
          times: 5,
        },
      ],
    });

    await expect(
      appendDistributionEventsDurably(root, assignEvents(2), { writer: writer() })
    ).resolves.toBe("verified");

    // The fast path itself succeeded — patience, not degradation.
    expect(fallbackLogEntries()).toHaveLength(0);
    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(2);
  }, 30_000);
});

describe("a stale directory handle gets one re-resolve", () => {
  it("retries the chunk against a freshly-resolved directory", async () => {
    const root = createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          nameSuffix: ".ndjson",
          errorName: "NotFoundError",
          // Exhausts the patient ladder (9 attempts) once, then succeeds — the
          // shape of a handle that went stale on an idle SMB disconnect and
          // works again once re-resolved.
          times: 9,
        },
      ],
    });
    let reopened = 0;

    await expect(
      appendDistributionEventsDurably(root, assignEvents(2), {
        writer: writer(),
        reopenDir: async () => {
          reopened += 1;
          return root;
        },
      })
    ).resolves.toBe("verified");

    expect(reopened).toBe(1);
    expect(fallbackLogEntries()).toHaveLength(0);
    const events = await loadDistributionEventSegments(root);
    expect(events).toHaveLength(2);
  }, 40_000);
});

describe("a share that refuses .ndjson entirely", () => {
  it("falls back to one immutable {eventId}.json per event and records XQ-DIST-009", async () => {
    const root = createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          nameSuffix: ".ndjson",
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    // The events must be DURABLE, not the save refused: an antivirus rule on
    // one extension is not a reason to lose a month's distribution.
    await expect(
      appendDistributionEventsDurably(root, assignEvents(4), {
        writer: writer(),
        reopenDir: async () => root,
      })
    ).resolves.toBe("verified");

    clearSimulatedFaults(root);
    const perEvent = await loadImmutableDistributionEvents(root);
    expect(perEvent.map((event) => event.xrayImageId).sort()).toEqual(
      ["IMG-0", "IMG-1", "IMG-2", "IMG-3"]
    );
    // Recorded, so the admin learns the fast path is unusable here instead of
    // silently paying per-event write costs forever.
    expect(fallbackLogEntries().length).toBeGreaterThan(0);
  }, 60_000);

  it("diagnoses the unusable segment path ONCE per save, not once per chunk", async () => {
    // The causes this degrades for are properties of the NAME (a path the share
    // cannot hold, an extension a scanner strips), so they fail identically for
    // every chunk. Re-deriving that per chunk costs the full write ladder plus
    // the classification plus a second ladder on the re-resolved handle each
    // time — minutes of pure sleeping on a multi-chunk month to reach the same
    // answer repeatedly. This pins the decision to once per save.
    const root = createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          nameSuffix: ".ndjson",
          errorName: "NotFoundError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    // Enough events to span several chunks, so "once per save" and "once per
    // chunk" are distinguishable at all.
    const events = assignEvents(MAX_OPEN_SEGMENT_LINES * 3, "MULTI");
    const chunkCount = chunkEventsForSegmentAppends(events).length;
    expect(chunkCount).toBeGreaterThan(1);

    let reopenCalls = 0;
    await expect(
      appendDistributionEventsDurably(root, events, {
        writer: writer(),
        reopenDir: async () => {
          reopenCalls += 1;
          return root;
        },
      })
    ).resolves.toBe("verified");

    // Only the FIRST chunk pays the diagnosis. `reopenDir` is the precise
    // witness: it runs once per segment-path diagnosis, so once-per-chunk
    // behaviour would make this equal chunkCount rather than 1.
    expect(reopenCalls).toBe(1);
    expect(reopenCalls).toBeLessThan(chunkCount);

    // ...and the events are still all durable, which is the point of degrading.
    clearSimulatedFaults(root);
    const perEvent = await loadImmutableDistributionEvents(root);
    expect(perEvent).toHaveLength(events.length);
  }, 60_000);
});
