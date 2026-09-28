import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { saveMonthRun, supersededFileName, supersedeStamp } from "./populationStorage";
import type { PopulationFinalData } from "./monthTypes";
import { makePopulationRow } from "./populationTestFixtures";

const MONTH = formatMonthFolderName(5, 2026);

const baseParams = {
  month: 5,
  year: 2026,
  username: "admin",
  riskFileName: "risk.xlsx",
  biFileName: null,
  certScanUsed: false,
  riskRawRows: [{ id: "raw-1" }],
  biRawRows: [],
  certScanRows: 0,
  nonCertScanRows: 1,
};

async function monthSubdir(root: DirectoryHandleLike, sub: "1-raw" | "2-processed"): Promise<DirectoryHandleLike> {
  const population = await root.getDirectoryHandle("1-population", { create: false });
  const month = await population.getDirectoryHandle(MONTH, { create: false });
  return month.getDirectoryHandle(sub, { create: false });
}

async function fileNames(dir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(dir)).filter((entry) => entry.kind === "file").map((entry) => entry.name);
}

beforeEach(() => {
  invalidateMonthLockCache();
});

describe("supersededFileName", () => {
  test("inserts the stamp before the extension", () => {
    expect(supersededFileName("population.final.json", "T1")).toBe("population.final.T1.superseded.json");
    expect(supersededFileName("risk.source.xlsx", "T1")).toBe("risk.source.T1.superseded.xlsx");
    expect(supersededFileName("bi.source.2.xlsb", "T1")).toBe("bi.source.2.T1.superseded.xlsb");
  });
});

describe("supersedeStamp", () => {
  test("never collides within the same millisecond (F20)", () => {
    const now = new Date("2026-09-28T10:15:00.123Z");
    const stamps = new Set(Array.from({ length: 50 }, () => supersedeStamp(now)));
    expect(stamps.size).toBe(50);
  });

  test("is filename-safe (no colons)", () => {
    expect(supersedeStamp(new Date("2026-09-28T10:15:00.123Z"))).not.toContain(":");
  });
});

describe("saveMonthRun archives before it overwrites (A2)", () => {
  test("the first save archives nothing", async () => {
    const root = createMemoryDirectory("root");
    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["first-bytes"], "risk.xlsx"),
    });
    expect(result.ok).toBe(true);
    expect((await fileNames(await monthSubdir(root, "2-processed"))).filter((n) => n.includes(".superseded."))).toEqual([]);
    expect((await fileNames(await monthSubdir(root, "1-raw"))).filter((n) => n.startsWith("risk.source.") && n.includes(".superseded."))).toEqual([]);
  });

  test("a re-save keeps the previous population.final.json and risk source as superseded copies", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["first-bytes"], "risk.xlsx"),
    });
    expect(first.ok).toBe(true);

    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["second-bytes"], "risk.xlsx"),
    });
    expect(second.ok).toBe(true);

    const processed = await monthSubdir(root, "2-processed");
    const archives = (await fileNames(processed)).filter((n) => /^population\.final\..+\.superseded\.json$/.test(n));
    expect(archives).toHaveLength(1);
    expect(archives[0]).not.toContain(":");
    const archived = await safeReadJson<PopulationFinalData>(processed, archives[0]!);
    expect(archived.ok).toBe(true);
    if (archived.ok) {
      expect(archived.value.rows.map((row) => row["xrayImageId"])).toEqual(["A1"]);
    }
    const live = await safeReadJson<PopulationFinalData>(processed, "population.final.json");
    expect(live.ok && live.value.rows.map((row) => row["xrayImageId"])).toEqual(["B1"]);

    const raw = await monthSubdir(root, "1-raw");
    const sourceArchives = (await fileNames(raw)).filter((n) => /^risk\.source\..+\.superseded\.xlsx$/.test(n));
    expect(sourceArchives).toHaveLength(1);
    const archivedSource = await (await (await raw.getFileHandle(sourceArchives[0]!)).getFile()).text();
    expect(archivedSource).toBe("first-bytes");
  });
});
