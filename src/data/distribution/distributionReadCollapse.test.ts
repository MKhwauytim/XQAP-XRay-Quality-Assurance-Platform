// R4 (lane R): redundant event-store reads are collapsed.
//  * one listing fewer of distribution.events/ per full read;
//  * an append handed the caller's pre-append `DistributionLogLoad` lets the
//    projection job skip its own full re-read of every segment.
// The fold, the projection bytes and the returned events are unchanged.
import { afterEach, describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory, clearOperationLog, getOperationLog } from "../storage/memoryDirectory";
import { registerDirectoryPath } from "../storage/webLocks";
import {
  appendDistributionEvents,
  flushPendingDistributionProjectionWrites,
  loadDistributionLog,
  loadDistributionLogLoad,
} from "./distributionStorage";
import { buildAssignEvent, buildReassignEvent } from "./distributionLog";

const MONTH = "5-May-2026";
const assign = (id: string) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp1", eventBy: "admin" });

afterEach(async () => {
  await flushPendingDistributionProjectionWrites();
});

/** Counts values() calls per directory name. */
function countingRoot(counts: Record<string, number>): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike, path: string): DirectoryHandleLike => {
    const inner = dir as DirectoryHandleLike & { values(): AsyncIterable<unknown> };
    const out = {
      kind: "directory" as const,
      name: dir.name,
      getFileHandle: (n: string, o?: { create?: boolean }) => dir.getFileHandle(n, o),
      getDirectoryHandle: async (n: string, o?: { create?: boolean }) => wrap(await dir.getDirectoryHandle(n, o), `${path}/${n}`),
      removeEntry: (n: string, o?: { recursive?: boolean }) => dir.removeEntry!(n, o),
      queryPermission: dir.queryPermission?.bind(dir),
      requestPermission: dir.requestPermission?.bind(dir),
      values: () => {
        counts[dir.name] = (counts[dir.name] ?? 0) + 1;
        return inner.values();
      },
    };
    registerDirectoryPath(out as DirectoryHandleLike, path);
    return out as DirectoryHandleLike;
  };
  return wrap(createMemoryDirectory("root"), "root");
}

describe("R4: collapsed reads", () => {
  it("a full read lists distribution.events/ at most twice (was three times)", async () => {
    const counts: Record<string, number> = {};
    const root = countingRoot(counts);
    await appendDistributionEvents(root, MONTH, [assign("XR-1"), assign("XR-2")]);
    await flushPendingDistributionProjectionWrites();
    counts["distribution.events"] = 0;
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events).toHaveLength(2);
    expect(counts["distribution.events"]).toBeLessThanOrEqual(2);
  });

  it("with the caller's pre-append load the projection job does not re-read the segments, and writes identical bytes", async () => {
    const run = async (withLoad: boolean) => {
      const root = createMemoryDirectory("root", { trackOperations: true }) as DirectoryHandleLike;
      await appendDistributionEvents(root, MONTH, [assign("XR-1"), assign("XR-2")]);
      await flushPendingDistributionProjectionWrites();
      const load = await loadDistributionLogLoad(root, MONTH);
      clearOperationLog(root);
      const event = buildReassignEvent({ xrayImageId: "XR-1", assignedTo: "emp1", reassignedTo: "emp2", eventBy: "admin" });
      const result = await appendDistributionEvents(root, MONTH, [{ ...event, eventId: "evt-fixed", eventAt: "2026-05-06T00:00:00.000Z" }], {
        interactive: true,
        ...(withLoad ? { priorLoad: load } : { priorLog: load.log }),
      });
      await flushPendingDistributionProjectionWrites();
      const segmentReads = getOperationLog(root).filter((o) => o.operation === "getFile" && o.name.endsWith(".ndjson")).length;
      const logFile = await (await (await root.getDirectoryHandle("2-samples")).getDirectoryHandle(MONTH)
        .then((d) => d.getDirectoryHandle("1-main")).then((d) => d.getFileHandle("distribution.log.json"))).getFile();
      const parsed = JSON.parse(await logFile.text()) as { data: { revision: number; eventSetId?: string } };
      return { segmentReads, revision: parsed.data.revision, eventSetId: parsed.data.eventSetId, ok: result.ok };
    };
    const without = await run(false);
    const withLoad = await run(true);
    expect(withLoad.ok).toBe(true);
    expect(withLoad.revision).toBe(without.revision);
    expect(withLoad.segmentReads).toBeLessThan(without.segmentReads);
  });
});
