// Regression tests for the UNC/SMB transient-NotFoundError failure.
//
// Reported symptom: a user on a network share saw
// "تمت إضافة البديل للعينة لكن فشل تسجيل الحدث — يُرجى المحاولة مرة أخرى:
//  A requested file or directory could not be found at the time an operation
//  was processed."
// The replacement sample row HAD been written and the event segment HAD been
// written; only the post-close verification could not see its own file yet,
// because on SMB the directory entry is not always visible to the next open
// after close() returns. The whole append was then reported as a failure.
//
// These tests reproduce that with the memoryDirectory fault harness rather than
// a real share: a fault with `times: N` fails the first N matching calls and
// then behaves normally, which is exactly a directory listing that catches up a
// few milliseconds later.
import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import { buildAssignEvent } from "./distributionLog";
import {
  DISTRIBUTION_EVENTS_DIR,
  __resetWrittenSegmentsForTests,
  appendDistributionEventSegment,
  distributionEventSegmentFileName,
  loadDistributionEventSegments,
  readDistributionEventSegmentDelta,
} from "./distributionEventStore";

const DEVICE = "dev";

function writer(sessionId: string): { deviceId: string; sessionId: string } {
  return { deviceId: DEVICE, sessionId };
}

function assignEvent(id: string) {
  return buildAssignEvent({ xrayImageId: id, assignedTo: "emp-1", eventBy: "admin" });
}

beforeEach(() => {
  __resetWrittenSegmentsForTests();
  clearErrors();
});

describe("appendDistributionEventSegment under transient NotFoundError", () => {
  it("reports SUCCESS when the post-close verification transiently cannot see the file it just wrote", async () => {
    const root = createMemoryDirectory("root");
    const session = "s-transient";
    const segment = distributionEventSegmentFileName(DEVICE, session);

    // First append: clean, establishes the segment for this writer session.
    await appendDistributionEventSegment(root, [assignEvent("IMG-1")], writer(session));

    // Now make the share "lose sight of" the segment for the next two reads
    // (the pre-append re-read and the post-close size verification). Both are
    // `create: false` opens of a file that provably exists.
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: segment, create: false, errorName: "NotFoundError", times: 2 },
    ]);

    // Before the fix this rejected with the raw Chromium DOMException even
    // though the bytes had already landed.
    await expect(
      appendDistributionEventSegment(root, [assignEvent("IMG-2")], writer(session))
    ).resolves.toBe("verified");   // was void; the call now reports its verification outcome

    clearSimulatedFaults(root);
    const events = await loadDistributionEventSegments(root);
    expect(events.map((event) => event.xrayImageId)).toEqual(["IMG-1", "IMG-2"]);
  });

  // 40 s: the pre-append re-read ladder is deliberately patient (~11 s) and is
  // driven to exhaustion here by design. The wait is the behaviour under test,
  // not incidental slowness.
  it("rotates to a fresh segment when its own segment stays invisible — losing nothing and failing nothing", { timeout: 40_000 }, async () => {
    // The OLD behaviour here was a hard failure (XQ-IO-031): the exhausted
    // re-read fell back to "", the append blind-rewrote the segment without
    // the lines still on the share, and the unconfirmable verify had to stay
    // fatal because that rewrite was a real data-loss window. Rotation removes
    // the window instead of reporting it: the unreadable segment is left
    // untouched (readers glob *.ndjson, so its events stay in the log) and the
    // batch lands in a fresh segment with a trustworthy empty baseline.
    const root = createMemoryDirectory("root");
    const session = "s-permanent";
    const segment = distributionEventSegmentFileName(DEVICE, session);

    await appendDistributionEventSegment(root, [assignEvent("IMG-1")], writer(session));

    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        name: segment,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(
      appendDistributionEventSegment(root, [assignEvent("IMG-2")], writer(session))
    ).resolves.toBe("verified");

    // The exhausted-retry classifier still recorded the lag — success must not
    // make the share's misbehaviour invisible to the admin.
    const notFoundLogs = getRecentErrors().filter(
      (entry) =>
        entry.context.startsWith("distribution:segment-") && entry.message.includes("cause=")
    );
    expect(notFoundLogs.length).toBeGreaterThan(0);
    clearSimulatedFaults(root);

    // NOTHING lost: the first segment kept its line, the batch landed in the
    // rotated sibling, and a reader folds both.
    const events = await loadDistributionEventSegments(root);
    expect(events.map((event) => event.xrayImageId).sort()).toEqual(["IMG-1", "IMG-2"]);
    const rotated = distributionEventSegmentFileName(DEVICE, session, 1);
    const eventsDir = await root.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
    const seg0 = await (await (await eventsDir.getFileHandle(segment, { create: false })).getFile()).text();
    const seg1 = await (await (await eventsDir.getFileHandle(rotated, { create: false })).getFile()).text();
    expect(seg0).toContain("IMG-1");
    expect(seg0).not.toContain("IMG-2");
    expect(seg1).toContain("IMG-2");

    // And the writer continues in the rotated segment — it never writes the
    // abandoned name again.
    await appendDistributionEventSegment(root, [assignEvent("IMG-3")], writer(session));
    const seg1After = await (await (await eventsDir.getFileHandle(rotated, { create: false })).getFile()).text();
    expect(seg1After).toContain("IMG-3");
    expect(await (await (await eventsDir.getFileHandle(segment, { create: false })).getFile()).text()).toBe(seg0);
  });

  it("does not retry the very first read of a segment this session has never written (absence is the expected answer)", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });
    const session = "s-first";
    const segment = distributionEventSegmentFileName(DEVICE, session);

    await appendDistributionEventSegment(root, [assignEvent("IMG-1")], writer(session));

    const eventsDir = await root.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
    expect(eventsDir).toBeTruthy();

    // Exactly one pre-append open of a not-yet-existing segment: the "start
    // from empty" answer is correct here and must be immediate, not the result
    // of burning the retry budget on every session's first distribution action.
    const opens = getOperationLog(root).filter(
      (entry) => entry.operation === "getFileHandle" && entry.name === segment && entry.create === false
    );
    // One pre-append read (misses) + one post-close verification (hits).
    expect(opens).toHaveLength(2);
  });

  it("survives a transient NotFoundError on the write itself", async () => {
    const root = createMemoryDirectory("root");
    const session = "s-write";
    const segment = distributionEventSegmentFileName(DEVICE, session);

    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: segment, create: true, errorName: "NotFoundError", times: 1 },
    ]);

    await expect(
      appendDistributionEventSegment(root, [assignEvent("IMG-1")], writer(session))
    ).resolves.toBe("verified");   // was void; the call now reports its verification outcome

    clearSimulatedFaults(root);
    const events = await loadDistributionEventSegments(root);
    expect(events.map((event) => event.xrayImageId)).toEqual(["IMG-1"]);
  });
});

describe("segment READ when one segment vanishes between listing and open", () => {
  it("folds the surviving segments unchanged instead of failing the whole read", async () => {
    const root = createMemoryDirectory("root");
    await appendDistributionEventSegment(root, [assignEvent("IMG-1")], writer("s-keep"));
    await appendDistributionEventSegment(root, [assignEvent("IMG-2")], writer("s-gone"));

    const goneSegment = distributionEventSegmentFileName(DEVICE, "s-gone");
    // Faulted on `getFile`, not `getFileHandle`: the segment read reuses the
    // handle the directory enumeration already produced (one round trip per
    // segment instead of two), so on a real share a vanished entry surfaces
    // when the handle is READ, not when it is looked up by name.
    setSimulatedFaults(root, [
      {
        operation: "getFile",
        name: goneSegment,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const delta = await readDistributionEventSegmentDelta(root, {});

    // The vanished segment's events are absent (they are unreadable, not
    // invented), but the read succeeded and the other segment folded normally.
    expect(delta.events.map((event) => event.xrayImageId)).toEqual(["IMG-1"]);
    // Crucially, no offset is recorded for the skipped segment, so the next
    // read re-reads it from 0 rather than treating it as already consumed —
    // a skip must never look like data loss on the following fold.
    expect(delta.offsets[goneSegment]).toBeUndefined();
    expect(delta.segmentNames).toContain(goneSegment);

    clearSimulatedFaults(root);
    const recovered = await readDistributionEventSegmentDelta(root, delta.offsets);
    expect(recovered.events.map((event) => event.xrayImageId).sort()).toEqual(["IMG-2"]);
  });
});

describe("the written-segment memo is scoped to the workspace, not just the file name", () => {
  it("does not burn the retry ladder on the first append after a workspace switch", async () => {
    const first = createMemoryDirectory("workspace-a");
    const second = createMemoryDirectory("workspace-b", { trackOperations: true });
    const session = "s-switch";
    const segment = distributionEventSegmentFileName(DEVICE, session);

    // Same device + session, two different workspaces — exactly what happens
    // when the user re-picks a workspace folder without reloading the page.
    await appendDistributionEventSegment(first, [assignEvent("IMG-1")], {
      deviceId: DEVICE,
      sessionId: session,
      scopeId: "ws1|5-May-2026",
    });
    await appendDistributionEventSegment(second, [assignEvent("IMG-2")], {
      deviceId: DEVICE,
      sessionId: session,
      scopeId: "ws2|5-May-2026",
    });

    const preAppendReads = getOperationLog(second).filter(
      (entry) =>
        entry.operation === "getFileHandle" && entry.name === segment && entry.create === false
    );
    // One pre-append read (misses — this segment is genuinely new HERE) and one
    // post-close verification. Keyed on the bare file name, the memo from
    // workspace A would have claimed this file exists, spending the whole
    // ~630 ms TRANSIENT_WRITE_RETRY_DELAYS_MS ladder plus a classifyNotFound
    // write probe before falling back to "" — on the user's first distribution
    // action in the new workspace.
    expect(preAppendReads).toHaveLength(2);
    expect(
      getRecentErrors().filter((entry) => entry.context === "distribution:segment-reread")
    ).toHaveLength(0);

    const events = await loadDistributionEventSegments(second);
    expect(events.map((event) => event.xrayImageId)).toEqual(["IMG-2"]);
  });
});
