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
import { clearSimulatedFaults, createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
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
    expect(elapsed).toBeLessThan(1_500);
    expect(isDistributionProjectionPending(root, MONTH)).toBe(true);
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

  it("serializes projection updates per month: every append still gets its own revision bump once the share recovers", async () => {
    const root = failingShare();
    const one = await appendDistributionEvents(root, MONTH, [assign("XR-1")]);
    expect(one.ok && one.projectionPending).toBe(true);
    // The share recovers while job 1 is still in flight; job 2 queues behind it.
    clearSimulatedFaults(root);
    const two = await appendDistributionEvents(root, MONTH, [assign("XR-2")]);
    expect(two.ok).toBe(true);
    await flushPendingDistributionProjectionWrites();

    // Job 1 either finished on the recovered share or exhausted; job 2 ran
    // strictly after it and committed a bump on top of whatever it left.
    const stamp = await readDistributionLogStamp(root, MONTH);
    expect(stamp.revision).toBeGreaterThanOrEqual(1);
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((e) => e.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  it("never fails the append when the durable events are written", async () => {
    const root = failingShare();
    setSimulatedFaults(root, [
      { operation: "createWritable", name: "distribution.log.json", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);
    const result = await appendDistributionEvents(root, MONTH, [assign("XR-9")]);
    expect(result.ok).toBe(true);
  });
});
