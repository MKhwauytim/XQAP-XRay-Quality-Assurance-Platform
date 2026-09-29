// R3 (lane R): an INTERACTIVE single-row append no longer waits for the
// distribution.log.json projection, and no longer re-reads the event store to
// build the log it returns.
//
// Before, `appendDistributionEvents` raced the projection job against a 3 s
// grace. On a healthy share the job (a full event-store re-read plus the log
// write and its verify, ~55 operations) settles inside the grace, so the click
// always paid for it. The caller of an interactive append already holds the
// fresh pre-append log (it read it to gate the write), so the returned log is
// that log plus the batch; the projection still runs, in order, on its own
// per-month chain, and the revision it bumps is unchanged.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors } from "../storage/errorLogger";
import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  __setProjectionTimingForTests,
  appendDistributionEvents,
  flushPendingDistributionProjectionWrites,
  isDistributionProjectionPending,
  loadDistributionLog,
  readDistributionLogStamp,
} from "./distributionStorage";
import { buildAssignEvent, buildReassignEvent } from "./distributionLog";

const MONTH = "5-May-2026";
const assign = (id: string, to = "emp1") => buildAssignEvent({ xrayImageId: id, assignedTo: to, eventBy: "admin" });

beforeEach(() => {
  clearErrors();
  __setProjectionTimingForTests({ graceMs: 3_000, deadlineMs: 5_000 });
});
afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
  __setProjectionTimingForTests(null);
});

async function seeded(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root", { trackOperations: true }) as DirectoryHandleLike;
  await appendDistributionEvents(root, MONTH, [assign("XR-1"), assign("XR-2"), assign("XR-3")]);
  await flushPendingDistributionProjectionWrites();
  return root;
}

describe("interactive append", () => {
  it("returns before the projection settles, flagged pending, with the prior log plus the batch", async () => {
    const root = await seeded();
    const prior = await loadDistributionLog(root, MONTH);
    const event = buildReassignEvent({ xrayImageId: "XR-1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" });

    const result = await appendDistributionEvents(root, MONTH, [event], { interactive: true, priorLog: prior });

    expect(result.ok && result.projectionPending).toBe(true);
    expect(isDistributionProjectionPending(root, MONTH)).toBe(true);
    expect(result.ok && result.log.events.map((e) => e.eventId)).toEqual([...prior.events.map((e) => e.eventId), event.eventId]);
    // Projection revision semantics are unchanged: it still bumps exactly once, in the background.
    await flushPendingDistributionProjectionWrites();
    expect((await readDistributionLogStamp(root, MONTH)).revision).toBe(2);
    expect((await loadDistributionLog(root, MONTH)).events.some((e) => e.eventId === event.eventId)).toBe(true);
  });

  it("costs tens of fewer share operations than the same append waiting for its projection", async () => {
    const opsFor = async (interactive: boolean): Promise<number> => {
      const root = await seeded();
      const prior = await loadDistributionLog(root, MONTH);
      clearOperationLog(root);
      const event = buildReassignEvent({ xrayImageId: "XR-2", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" });
      await appendDistributionEvents(root, MONTH, [event], interactive ? { interactive: true, priorLog: prior } : undefined);
      const count = getOperationLog(root).length;
      await flushPendingDistributionProjectionWrites();
      return count;
    };
    const waited = await opsFor(false);
    const interactive = await opsFor(true);
    // The in-memory log counts fewer, coarser operations than the SMB harness (~55 there).
    expect(waited - interactive).toBeGreaterThanOrEqual(30);
  });

  it("does not wait for a projection that is failing", async () => {
    const root = createMemoryDirectory("root", {
      trackOperations: true,
      faults: [{ operation: "createWritable", name: "distribution.log.json", errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY }],
    }) as DirectoryHandleLike;
    const prior = await loadDistributionLog(root, MONTH);
    const started = Date.now();
    const result = await appendDistributionEvents(root, MONTH, [assign("XR-1")], { interactive: true, priorLog: prior });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.ok && result.projectionPending).toBe(true);
    expect(result.ok && result.log.events.map((e) => e.xrayImageId)).toEqual(["XR-1"]);
  });

  it("without a prior log it falls back to re-reading the durable events (still correct)", async () => {
    const root = await seeded();
    const event = buildReassignEvent({ xrayImageId: "XR-3", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" });
    const result = await appendDistributionEvents(root, MONTH, [event], { interactive: true });
    expect(result.ok && result.projectionPending).toBe(true);
    expect(result.ok && result.log.events.some((e) => e.eventId === event.eventId)).toBe(true);
    expect(result.ok && result.log.events).toHaveLength(4);
  });
});
