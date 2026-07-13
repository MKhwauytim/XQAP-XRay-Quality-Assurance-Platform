import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson } from "../storage/safeWrite";
import { saveMonthRun } from "./populationStorage";
import type { MonthRawData } from "./monthTypes";

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

async function getRawDir(dir: ReturnType<typeof createMemoryDirectory>) {
  const population = await dir.getDirectoryHandle("1-population", { create: false });
  const monthDir = await population.getDirectoryHandle("5-may-2026", { create: false });
  return monthDir.getDirectoryHandle("1-raw", { create: false });
}

async function listRaw(dir: ReturnType<typeof createMemoryDirectory>): Promise<string[]> {
  const rawDir = await getRawDir(dir);
  const names: string[] = [];
  const iterable = (rawDir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }).values();
  for await (const entry of iterable) {
    if (entry.kind === "file") names.push(entry.name);
  }
  return names;
}

describe("immutable raw imports (A5)", () => {
  test("first import writes risk.raw.json with no supersedes and no archive", async () => {
    const dir = createMemoryDirectory();
    await saveMonthRun({
      directoryHandle: dir,
      ...baseParams,
      riskRawRows: [{ id: "A1", v: "first" }],
      processedRows: [{ xrayImageId: "A1" }],
    });

    const rawDir = await getRawDir(dir);
    const live = await safeReadJson<MonthRawData>(rawDir, "risk.raw.json");
    expect(live.ok).toBe(true);
    if (live.ok) {
      expect(live.value.supersedes ?? null).toBeNull();
      expect(live.value.rows).toEqual([{ id: "A1", v: "first" }]);
    }
    const names = await listRaw(dir);
    expect(names.filter((n) => n.includes(".superseded."))).toHaveLength(0);
  });

  test("re-import archives the prior raw file and stamps supersedes on the new one", async () => {
    const dir = createMemoryDirectory();
    await saveMonthRun({
      directoryHandle: dir,
      ...baseParams,
      riskRawRows: [{ id: "A1", v: "first" }],
      processedRows: [{ xrayImageId: "A1" }],
    });

    await saveMonthRun({
      directoryHandle: dir,
      ...baseParams,
      riskRawRows: [{ id: "A1", v: "second" }],
      processedRows: [{ xrayImageId: "A1" }],
    });

    const rawDir = await getRawDir(dir);
    const live = await safeReadJson<MonthRawData>(rawDir, "risk.raw.json");
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.value.rows).toEqual([{ id: "A1", v: "second" }]);
    expect(live.value.supersedes).toBeTruthy();

    // The archived file exists, its name is filename-safe (no colons), and it
    // preserves the ORIGINAL import verbatim.
    const archiveName = live.value.supersedes!;
    expect(archiveName).toMatch(/^risk\.raw\..+\.superseded\.json$/);
    expect(archiveName).not.toContain(":");

    const archived = await safeReadJson<MonthRawData>(rawDir, archiveName);
    expect(archived.ok).toBe(true);
    if (archived.ok) {
      expect(archived.value.rows).toEqual([{ id: "A1", v: "first" }]);
    }
  });
});
