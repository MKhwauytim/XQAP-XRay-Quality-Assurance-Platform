// The most severe finding of the error-code audit, and the one with live
// data-integrity consequences.
//
// `appendDistributionEventSegment` writes the segment, awaits `close()` — at
// which point the bytes ARE committed — and only then reads the file back to
// check its size. On a UNC/SMB share the read-back can fail with NotFoundError
// simply because the directory entry is not visible yet. That threw, which
// aborted `appendDistributionEvents` BEFORE its projection `casLoop`, so:
//
//   - the events were durable on disk, but
//   - `distribution.log.json`'s revision never advanced, and revision is the
//     staleness authority everywhere. The assignee's mirror was judged current,
//     so the assignment stayed invisible to them THROUGH RELOADS; the sync tick
//     never fired; and an operator retry ran against a stale snapshot whose
//     idempotency guard no longer matched, emitting duplicate events.
//   - the user was told the write failed, for a write that had succeeded.
//
// The fix splits two outcomes that were conflated: a file we could not READ
// (inconclusive — commit the projection, the bytes are there) versus a size we
// read and found WRONG (a genuine bad write — still fatal).
//
// The first test fails against the pre-fix code: the append rejected instead of
// resolving, and no events were readable.

import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { appendDistributionEvent, loadDistributionLog } from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";
import { __resetWrittenSegmentsForTests } from "./distributionEventStore";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";

const MONTH = "5-May-2026";
const SEGMENT_SUFFIX = ".ndjson";

beforeEach(() => {
  __resetWrittenSegmentsForTests();
  clearErrors();
});

function assign(id: string) {
  return buildAssignEvent({ xrayImageId: id, assignedTo: "employee1", eventBy: "admin" });
}

describe("a segment we cannot read back is not a lost write", () => {
  it("commits the projection when the share never shows the file back", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    // The read-back open fails forever; the WRITE (create: true) is untouched,
    // which is exactly the SMB visibility-lag shape.
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        nameSuffix: SEGMENT_SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await appendDistributionEvent(root, MONTH, assign("XR-0001"));

    // Pre-fix: ok === false, and the operator was told the assignment failed.
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The revision MUST have advanced — this is the whole point. A revision
    // that stays put is what made the assignment invisible to its assignee.
    expect(result.log.revision).toBeGreaterThan(0);
    expect(result.log.events.map((event) => event.xrayImageId)).toEqual(["XR-0001"]);

    // And it is genuinely on disk, not just in the returned object.
    const reloaded = await loadDistributionLog(root, MONTH);
    expect(reloaded.events.map((event) => event.xrayImageId)).toEqual(["XR-0001"]);
    expect(reloaded.revision).toBe(result.log.revision);
  });

  it("records that the write went unconfirmed rather than passing silently", async () => {
    // Committing the projection is right, but it must not be invisible: an
    // admin needs to know the share is lagging.
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        nameSuffix: SEGMENT_SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await appendDistributionEvent(root, MONTH, assign("XR-0001"));

    const logged = getRecentErrors().filter((entry) =>
      entry.context.includes("segment-verify")
    );
    expect(logged.some((entry) => entry.context.includes("XQ-DIST-007"))).toBe(true);
  });

  it("a transient read-back that recovers still verifies normally", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        nameSuffix: SEGMENT_SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: 2,
      },
    ]);

    const result = await appendDistributionEvent(root, MONTH, assign("XR-0001"));

    expect(result.ok).toBe(true);
    // Recovered inside the ladder, so nothing is reported as unconfirmed.
    expect(
      getRecentErrors().some((entry) => entry.context.includes("XQ-DIST-007"))
    ).toBe(false);
  });

  it("still succeeds with no faults at all", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    const result = await appendDistributionEvent(root, MONTH, assign("XR-0001"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log.events).toHaveLength(1);
    expect(getRecentErrors()).toHaveLength(0);
  });
});
