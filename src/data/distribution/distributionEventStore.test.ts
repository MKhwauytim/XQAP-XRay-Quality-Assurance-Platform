import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { buildAssignEvent } from "./distributionLog";
import {
  loadImmutableDistributionEvents,
  writeImmutableDistributionEvent,
} from "./distributionEventStore";
import { loadDistributionLog } from "./distributionStorage";
import type { DistributionLog } from "./distributionTypes";

describe("immutable distribution event store", () => {
  it("writes separate files and treats an identical retry as idempotent", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const event = buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" });
    await writeImmutableDistributionEvent(dir, event);
    await writeImmutableDistributionEvent(dir, event);
    expect(await loadImmutableDistributionEvents(dir)).toEqual([event]);
  });

  it("rejects a duplicate event id with conflicting content", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const event = buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" });
    await writeImmutableDistributionEvent(dir, event);
    await expect(writeImmutableDistributionEvent(dir, { ...event, assignedTo: "bob" }))
      .rejects.toThrow(/collision/);
  });

  it("merges concurrent immutable writes even when the compatibility log missed both", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    const dir = await getSampleMainDir(root, month, true);
    const first = { ...buildAssignEvent({ xrayImageId: "A1", assignedTo: "alice", eventBy: "admin" }), eventAt: "2026-05-01T10:00:00.000Z" };
    const second = { ...buildAssignEvent({ xrayImageId: "A2", assignedTo: "bob", eventBy: "admin" }), eventAt: "2026-05-01T10:00:00.000Z" };
    await Promise.all([
      writeImmutableDistributionEvent(dir, first),
      writeImmutableDistributionEvent(dir, second),
    ]);

    const loaded = await loadDistributionLog(root, month);
    expect(loaded.events.map((event) => event.eventId).sort()).toEqual([first.eventId, second.eventId].sort());
    // Commutative event-set digest (v85): `d1:{count}:{xor}:{sum}` — the count
    // segment is what used to be the whole string's leading number.
    expect(loaded.eventSetId).toMatch(/^d1:2:/);
  });

  it("retains a legacy population log when new immutable events are introduced", async () => {
    const root = createMemoryDirectory();
    const month = "5-May-2026";
    const legacyDir = await getPopulationMonthDir(root, month, true);
    const legacyEvent = buildAssignEvent({ xrayImageId: "old", assignedTo: "alice", eventBy: "admin" });
    await safeWriteJson<DistributionLog>(legacyDir, "distribution.log.json", {
      monthFolderName: month,
      revision: 7,
      events: [legacyEvent],
    });
    const currentDir = await getSampleMainDir(root, month, true);
    const currentEvent = buildAssignEvent({ xrayImageId: "new", assignedTo: "bob", eventBy: "admin" });
    await writeImmutableDistributionEvent(currentDir, currentEvent);

    const loaded = await loadDistributionLog(root, month);
    expect(loaded.revision).toBe(7);
    expect(loaded.events.map((event) => event.xrayImageId)).toEqual(["old", "new"]);
  });
});

describe("loadImmutableDistributionEvents — concurrency-safe (Task 4)", () => {
  it("reads a large batch of events and returns them sorted, regardless of read concurrency", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const events = Array.from({ length: 25 }, (_, i) =>
      buildAssignEvent({
        xrayImageId: `img-${i}`,
        assignedTo: "alice",
        eventBy: "admin",
      })
    ).map((event, i) => ({ ...event, eventAt: `2026-05-01T${String(10 + (i % 14)).padStart(2, "0")}:00:00.000Z` }));

    for (const event of events) {
      await writeImmutableDistributionEvent(dir, event);
    }

    const loaded = await loadImmutableDistributionEvents(dir);
    expect(loaded).toHaveLength(25);
    const sortedIds = [...events]
      .sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId))
      .map((e) => e.eventId);
    expect(loaded.map((e) => e.eventId)).toEqual(sortedIds);
  });

  it("still throws when an event file is corrupt", async () => {
    const root = createMemoryDirectory();
    const dir = await getSampleMainDir(root, "5-May-2026", true);
    const eventsDir = await dir.getDirectoryHandle("distribution.events", { create: true });
    const handle = await eventsDir.getFileHandle("00000000-0000-4000-8000-000000000000.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not valid json");
    await writable.close();

    await expect(loadImmutableDistributionEvents(dir)).rejects.toThrow(/Cannot read immutable distribution event/);
  });
});
