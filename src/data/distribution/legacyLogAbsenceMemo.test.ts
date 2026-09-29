/* @vitest-environment jsdom */
// R5 (lane R): the ABSENCE of the legacy `1-population/{month}/distribution.log.json`
// is remembered per (workspace, month), so each full event-store read stops
// paying three NotFound probes (file, .bak, .tmp). A manual refresh, a restore
// stamp and an explicit invalidation forget it, so a legacy log that does appear
// is still read.
import { beforeEach, describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";
import {
  appendDistributionEvents,
  flushPendingDistributionProjectionWrites,
  invalidateLegacyDistributionLogMemo,
  loadDistributionLog,
  readDistributionLogStamp,
} from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";

const MONTH = "5-May-2026";
const assign = (id: string, to = "emp1") => buildAssignEvent({ xrayImageId: id, assignedTo: to, eventBy: "admin" });

async function seeded(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root", { trackOperations: true }) as DirectoryHandleLike;
  await getPopulationMonthDir(root, MONTH, true);
  await appendDistributionEvents(root, MONTH, [assign("XR-1")]);
  await flushPendingDistributionProjectionWrites();
  return root;
}
const legacyProbes = (root: DirectoryHandleLike): number =>
  getOperationLog(root).filter((o) => o.operation === "getFileHandle" && o.name === "distribution.log.json.bak").length;

async function plantLegacyLog(root: DirectoryHandleLike): Promise<void> {
  const dir = await getPopulationMonthDir(root, MONTH, true);
  await safeWriteJson(dir, "distribution.log.json", { monthFolderName: MONTH, revision: 9, events: [assign("XR-LEGACY", "emp2")] });
}

beforeEach(() => invalidateLegacyDistributionLogMemo());

describe("legacy distribution log absence memo", () => {
  it("probes the legacy location once, not on every full read", async () => {
    const root = await seeded();
    invalidateLegacyDistributionLogMemo();
    clearOperationLog(root);
    await loadDistributionLog(root, MONTH);
    const first = legacyProbes(root);
    clearOperationLog(root);
    await loadDistributionLog(root, MONTH);
    await loadDistributionLog(root, MONTH);
    expect(first).toBeGreaterThan(0);
    expect(legacyProbes(root)).toBe(0);
  });

  it("a legacy log that appears is read again after a manual refresh", async () => {
    const root = await seeded();
    await loadDistributionLog(root, MONTH);
    await plantLegacyLog(root);
    broadcastDataRefresh("manual");
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((e) => e.xrayImageId).sort()).toEqual(["XR-1", "XR-LEGACY"]);
    expect(log.revision).toBe(9);
  });

  it("and after an explicit invalidation (the restore path)", async () => {
    const root = await seeded();
    await loadDistributionLog(root, MONTH);
    await plantLegacyLog(root);
    invalidateLegacyDistributionLogMemo();
    expect((await loadDistributionLog(root, MONTH)).events.map((e) => e.xrayImageId)).toContain("XR-LEGACY");
  });

  it("never memoizes a present legacy log", async () => {
    const root = await seeded();
    await plantLegacyLog(root);
    invalidateLegacyDistributionLogMemo(); // seeding memoized the absence before the file appeared
    expect((await loadDistributionLog(root, MONTH)).events.map((e) => e.xrayImageId)).toContain("XR-LEGACY");
    expect((await loadDistributionLog(root, MONTH)).events.map((e) => e.xrayImageId)).toContain("XR-LEGACY");
  });

  it("the periodic sync's resolved-path stamp read forgets the memo when it finds a legacy log", async () => {
    const root = await seeded();
    await loadDistributionLog(root, MONTH); // memoizes the absence
    await plantLegacyLog(root); // e.g. a restore on another machine
    const currentDir = await getSampleMainDir(root, MONTH, false);
    const legacyDir = await getPopulationMonthDir(root, MONTH, false);
    const stamp = await readDistributionLogStamp(root, MONTH, { currentDir, legacyDir });
    expect(stamp.revision).toBe(9);
    expect((await loadDistributionLog(root, MONTH)).events.map((e) => e.xrayImageId)).toContain("XR-LEGACY");
  });
});
