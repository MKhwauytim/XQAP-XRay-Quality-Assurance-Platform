// R1 review fixes: (1) coalescing orders queued snapshots by how much of the event
// store they cover, not by the (possibly lagging) log revision; (2) a failed
// background persist is retried once, then logged.
import { afterEach, describe, expect, it } from "vitest";

import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { directoryResourceKey, withResourceLock } from "../storage/webLocks";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { invalidateMonthLockCache } from "../population/monthLock";
import {
  __setPersistRetryDelayForTests,
  flushPendingDistributionPersist,
  queueDistributionCurrentPersist,
} from "./distributionStorage";
import type { DistributionCurrentData } from "./distributionTypes";

const MONTH = "5-May-2026";
const snap = (logRevision: number, bytes: number): DistributionCurrentData =>
  ({
    monthFolderName: MONTH, logRevision, deriveVersion: 5, derivedAt: "2026-05-06T00:00:00.000Z",
    totalAssigned: 0, totalCompleted: 0, totalReplaced: 0, totalPending: 0, entries: [],
    scanIdentity: { segmentOffsets: { "s.ndjson": bytes }, legacyFilesDigest: "0:0" },
  }) as unknown as DistributionCurrentData;

afterEach(async () => {
  __setPersistRetryDelayForTests(null);
  await flushPendingDistributionPersist();
  clearErrors();
});

/** The LIVE cache file only (safeReadJson would recover a staged .tmp after a failed commit). */
async function cacheScanBytes(root: DirectoryHandleLike): Promise<number | undefined> {
  const main = await getSampleMainDir(root, MONTH, false);
  try {
    const text = await (await (await main.getFileHandle("distribution.current.json")).getFile()).text();
    return (JSON.parse(text) as { data: DistributionCurrentData }).data.scanIdentity?.segmentOffsets["s.ndjson"];
  } catch {
    return undefined;
  }
}

describe("persist chain coalescing", () => {
  it("keeps the snapshot that covers more of the event store even when a lagging revision says otherwise", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    invalidateMonthLockCache();
    const main = await getSampleMainDir(root, MONTH, true);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    void withResourceLock(directoryResourceKey(main, "distribution.current.json"), async () => {
      locked();
      await held;
    });
    await lockTaken;
    void queueDistributionCurrentPersist(root, MONTH, snap(1, 100)); // running job, blocked on the lock
    void queueDistributionCurrentPersist(root, MONTH, snap(1, 300)); // queued: covers 300 bytes of events (pre-bump revision)
    void queueDistributionCurrentPersist(root, MONTH, snap(2, 200)); // later, higher revision, but covers LESS
    release();
    await flushPendingDistributionPersist();
    expect(await cacheScanBytes(root)).toBe(300);
  });
});

describe("persist retry", () => {
  const fault = (times: number) => [{ operation: "createWritable" as const, name: "distribution.current.json", times, errorName: "NotAllowedError" }];

  it("a transient failure is retried once and the derived files still land, without an error entry", async () => {
    clearErrors();
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    setSimulatedFaults(root, fault(Number.POSITIVE_INFINITY));
    // The share heals between the first attempt (which exhausted its own write retries) and the retry.
    __setPersistRetryDelayForTests({ minMs: 5, maxMs: 10, beforeRetry: () => setSimulatedFaults(root, []) });
    invalidateMonthLockCache();
    void queueDistributionCurrentPersist(root, MONTH, snap(1, 100));
    await flushPendingDistributionPersist();
    expect(await cacheScanBytes(root)).toBe(100);
    expect(getRecentErrors().filter((e) => e.context.includes("distribution:cache-write"))).toHaveLength(0);
  });

  it("gives up after the second attempt with ONE error-log entry", async () => {
    __setPersistRetryDelayForTests({ minMs: 5, maxMs: 10 });
    clearErrors();
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    setSimulatedFaults(root, fault(Number.POSITIVE_INFINITY));
    invalidateMonthLockCache();
    void queueDistributionCurrentPersist(root, MONTH, snap(1, 100));
    await flushPendingDistributionPersist();
    expect(await cacheScanBytes(root)).toBeUndefined();
    expect(getRecentErrors().filter((e) => e.context.includes("distribution:cache-write"))).toHaveLength(1);
  });
});
