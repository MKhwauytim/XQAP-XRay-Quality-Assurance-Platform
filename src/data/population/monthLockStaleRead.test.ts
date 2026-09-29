// A closed-state read that STARTED before an invalidation (closeMonth's commit)
// must not re-cache its pre-commit "open" verdict after it: that kept the write
// gate open in this tab for the whole 30 s TTL after the month locked.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { saveMonthRun } from "./populationStorage";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache, isMonthClosed } from "./monthLock";
import type { MonthManifestData } from "./monthTypes";

const MONTH = formatMonthFolderName(5, 2026);

describe("month lock cache vs an in-flight read", () => {
  it("a read that began before the invalidation does not cache its stale 'open' verdict", async () => {
    const dir = createMemoryDirectory();
    await saveMonthRun({
      directoryHandle: dir, month: 5, year: 2026, username: "admin", riskFileName: "r.xlsx", biFileName: null, certScanUsed: false,
      riskRawRows: [{ id: "A1" }], biRawRows: [], processedRows: [{ xrayImageId: "A1", certScanStatus: "NonCertscan" }],
      certScanRows: 0, nonCertScanRows: 1,
    });
    invalidateMonthLockCache();

    const inFlight = isMonthClosed(dir, MONTH); // read of the still-open manifest begins
    invalidateMonthLockCache(MONTH); // closeMonth's commit-time invalidation lands while it is in flight
    expect(await inFlight).toBe(false); // the caller of THAT read gets its (pre-commit) answer

    // The month is closed by a path that does not invalidate (another machine, or the commit racing).
    const monthDir = await getPopulationMonthDir(dir, MONTH, false);
    const manifest = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    await safeWriteJson(monthDir, "month.manifest.json", { ...manifest.value, status: "closed" });

    expect(await isMonthClosed(dir, MONTH)).toBe(true); // must re-read, not serve the stale cached "open"
  });

  it("does not share a cached verdict between two workspaces that have the same month folder name", async () => {
    const make = async (): Promise<ReturnType<typeof createMemoryDirectory>> => {
      const d = createMemoryDirectory();
      await saveMonthRun({
        directoryHandle: d, month: 5, year: 2026, username: "admin", riskFileName: "r.xlsx", biFileName: null, certScanUsed: false,
        riskRawRows: [{ id: "A1" }], biRawRows: [], processedRows: [{ xrayImageId: "A1", certScanStatus: "NonCertscan" }],
        certScanRows: 0, nonCertScanRows: 1,
      });
      return d;
    };
    const open = await make();
    const closed = await make();
    const monthDir = await getPopulationMonthDir(closed, MONTH, false);
    const manifest = await safeReadJson<MonthManifestData>(monthDir, "month.manifest.json");
    if (!manifest.ok) throw new Error("no manifest");
    await safeWriteJson(monthDir, "month.manifest.json", { ...manifest.value, status: "closed" });
    invalidateMonthLockCache();
    expect(await isMonthClosed(open, MONTH)).toBe(false);
    expect(await isMonthClosed(closed, MONTH)).toBe(true);
  });
});
