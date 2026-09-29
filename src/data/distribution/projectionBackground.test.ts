// P4 — the distribution projection write is off the user's click path.
//
// `appendDistributionEvents` commits the immutable event files (awaited), then
// queues the `distribution.log.json` compatibility-projection update on a
// per-month serialized chain with its own deadline. The caller waits at most a
// short grace for it: a healthy share settles inside it and behaves exactly as
// before; a failing one returns `projectionPending` in about the grace instead
// of holding the click for the projection's whole deadline (~20 s).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  __setProjectionTimingForTests,
  appendDistributionEvents,
  flushPendingDistributionProjectionWrites,
  isDistributionProjectionPending,
  loadDistributionLog,
  readDistributionLogStamp,
} from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";

const MONTH = "5-May-2026";

const assign = (id: string) =>
  buildAssignEvent({ xrayImageId: id, assignedTo: "employee1", eventBy: "admin" });

beforeEach(() => {
  clearErrors();
  __setProjectionTimingForTests({ graceMs: 300, deadlineMs: 2_500 });
});

afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  __setProjectionTimingForTests(null);
});

describe("healthy share: behaviour is unchanged", () => {
  it("returns the projected log with a bumped revision, in batch order, no pending flag", async () => {
    const root = createMemoryDirectory("root");
    const first = await appendDistributionEvents(root, MONTH, [assign("XR-1"), assign("XR-2")]);
    const second = await appendDistributionEvents(root, MONTH, [assign("XR-3")]);

    expect(first.ok && first.log.revision).toBe(1);
    expect(second.ok && second.log.revision).toBe(2);
    expect(first.ok && first.log.events.map((e) => e.xrayImageId)).toEqual(["XR-1", "XR-2"]);
    expect(second.ok && second.log.events.map((e) => e.xrayImageId)).toEqual(["XR-1", "XR-2", "XR-3"]);
    expect(first.ok && first.projectionPending).toBeUndefined();
    expect(first.ok && first.projectionDegraded).toBeUndefined();

    expect((await readDistributionLogStamp(root, MONTH)).revision).toBe(2);
    const reread = await loadDistributionLog(root, MONTH);
    expect(second.ok && second.log.eventSetId).toBe(reread.eventSetId);
    expect(isDistributionProjectionPending(root, MONTH)).toBe(false);
  });
});

describe("failing projection", () => {
  function failingShare(): DirectoryHandleLike {
    return createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          name: "distribution.log.json",
          errorName: "InvalidStateError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });
  }

  it("returns in about the grace, not the projection deadline, flagged pending", async () => {
    const root = failingShare();
    const started = Date.now();
    const result = await appendDistributionEvents(root, MONTH, [assign("XR-1")]);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(result.ok && result.projectionPending).toBe(true);
    // Returned while the job was still running, and well before its deadline
    // (the wall-clock bound is the deadline itself, not a tight second count).
    expect(isDistributionProjectionPending(root, MONTH)).toBe(true);
    expect(elapsed).toBeLessThan(2_500);
    // Durable events are what the returned log is derived from.
    expect(result.ok && result.log.events.some((e) => e.xrayImageId === "XR-1")).toBe(true);
  });

  it("logs the degradation exactly once when the background job settles", async () => {
    const root = failingShare();
    await appendDistributionEvents(root, MONTH, [assign("XR-1")]);
    expect(
      getRecentErrors().filter((e) => e.context.includes("distribution:projection-degraded"))
    ).toHaveLength(0);

    await flushPendingDistributionProjectionWrites();

    expect(
      getRecentErrors().filter((e) => e.context.includes("distribution:projection-degraded"))
    ).toHaveLength(1);
    expect(isDistributionProjectionPending(root, MONTH)).toBe(false);
  });

  it("serializes projection updates per month in FIFO order: each append gets its own, strictly increasing, bump", async () => {
    __setProjectionTimingForTests({ graceMs: 0, deadlineMs: 2_500 });
    const root = createMemoryDirectory("root");
    const one = await appendDistributionEvents(root, MONTH, [assign("XR-1")]);
    const two = await appendDistributionEvents(root, MONTH, [assign("XR-2")]);
    expect(one.ok && two.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();

    // Two distinct jobs, run one after the other: revision 1 then 2 (a lost or
    // reordered bump would leave 1, or make job 2 compute from a stale base).
    expect((await readDistributionLogStamp(root, MONTH)).revision).toBe(2);
    expect(isDistributionProjectionPending(root, MONTH)).toBe(false);
  });

  it("coalesces a backlog queued behind a running job into ONE update, losing no event", async () => {
    __setProjectionTimingForTests({ graceMs: 0, deadlineMs: 2_500 });
    const root = createMemoryDirectory("root");
    await Promise.all([1, 2, 3, 4].map((n) => appendDistributionEvents(root, MONTH, [assign(`XR-${n}`)])));
    await flushPendingDistributionProjectionWrites();

    const revision = (await readDistributionLogStamp(root, MONTH)).revision;
    expect(revision).toBeGreaterThanOrEqual(1);
    expect(revision).toBeLessThan(4); // fewer bumps than appends: the backlog ran as fewer updates
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((e) => e.xrayImageId).sort()).toEqual(["XR-1", "XR-2", "XR-3", "XR-4"]);
  });
});
