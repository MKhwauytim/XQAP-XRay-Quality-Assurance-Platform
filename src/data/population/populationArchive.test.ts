import { beforeEach, describe, expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson } from "../storage/safeWrite";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvents, __clearDeriveMemoForTests } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { formatMonthFolderName } from "./monthFolder";
import { invalidateMonthLockCache } from "./monthLock";
import { loadMonthPopulationFinal, saveMonthRun, supersededFileName, supersedeStamp } from "./populationStorage";
import type { PopulationFinalData } from "./monthTypes";
import { makePopulationRow, makeSampleMaster } from "./populationTestFixtures";

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

  // Fix round 1 (reviewer finding #1/#2): a mandatory archive that cannot be
  // produced/verified must refuse the save — never fall through to
  // overwriting the live file with no proven-good backup. Fault the SOURCE
  // read of the existing population.final.json (the byte-copy step inside
  // copyFileBytesVerified), not the file's existence — this is the exact
  // "the file is there but the copy cannot be made/verified" case the
  // required archive exists to guard against.
  test("a required population archive failure refuses the save and leaves the live file untouched", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
    });
    expect(first.ok).toBe(true);

    setSimulatedFaults(root, [
      { operation: "readFile", name: "population.final.json", errorName: "SecurityError", times: Number.POSITIVE_INFINITY },
    ]);
    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
    });
    setSimulatedFaults(root, []);

    expect(second.ok).toBe(false);
    const live = await loadMonthPopulationFinal(root, MONTH);
    expect(live?.rows.map((row) => row["xrayImageId"])).toEqual(["A1"]);
  });

  // Fix round 1 (reviewer finding #3b): the SOURCE-file archives stay
  // best-effort — a copy failure is logged, not fatal, and the save proceeds
  // with the new source bytes written.
  test("a best-effort source-archive failure is logged but does not block the save", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["first-bytes"], "risk.xlsx"),
    });
    expect(first.ok).toBe(true);

    setSimulatedFaults(root, [
      { operation: "readFile", name: "risk.source.xlsx", errorName: "SecurityError", times: Number.POSITIVE_INFINITY },
    ]);
    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
      riskSourceFile: new File(["second-bytes"], "risk.xlsx"),
    });
    setSimulatedFaults(root, []);

    expect(second.ok).toBe(true);
    const raw = await monthSubdir(root, "1-raw");
    const sourceArchives = (await fileNames(raw)).filter((n) => /^risk\.source\..+\.superseded\.xlsx$/.test(n));
    expect(sourceArchives).toEqual([]);
    const liveSourceText = await (await (await raw.getFileHandle("risk.source.xlsx")).getFile()).text();
    expect(liveSourceText).toBe("second-bytes");
  });

  // Fix round 1 (reviewer finding #3c): multi-file BI — each of the N BI
  // source files gets its OWN superseded archive under its own indexed name.
  test("a BI re-save keeps each previous multi-file BI source as its own superseded copy", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      biSourceFiles: [
        new File(["bi-1-first"], "bi1.xlsx"),
        new File(["bi-2-first"], "bi2.xlsx"),
      ],
    });
    expect(first.ok).toBe(true);

    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
      biSourceFiles: [
        new File(["bi-1-second"], "bi1.xlsx"),
        new File(["bi-2-second"], "bi2.xlsx"),
      ],
    });
    expect(second.ok).toBe(true);

    const raw = await monthSubdir(root, "1-raw");
    const names = await fileNames(raw);
    const bi1Archives = names.filter((n) => /^bi\.source\.1\..+\.superseded\.xlsx$/.test(n));
    const bi2Archives = names.filter((n) => /^bi\.source\.2\..+\.superseded\.xlsx$/.test(n));
    expect(bi1Archives).toHaveLength(1);
    expect(bi2Archives).toHaveLength(1);
    const archived1 = await (await (await raw.getFileHandle(bi1Archives[0]!)).getFile()).text();
    const archived2 = await (await (await raw.getFileHandle(bi2Archives[0]!)).getFile()).text();
    expect(archived1).toBe("bi-1-first");
    expect(archived2).toBe("bi-2-first");
  });

  // Fix round 1 (reviewer finding #3d): when Task 3's overwrite guard refuses
  // a re-save (a distributed month would lose a live sampled id), NOTHING is
  // archived — the guard decides before any folder is touched, so a refused
  // save must leave zero *.superseded.* files behind, not a partial archive
  // of a save that never actually happened.
  test("a guard-blocked re-save writes zero superseded files", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [
        makePopulationRow("A1") as unknown as Record<string, unknown>,
        makePopulationRow("A2") as unknown as Record<string, unknown>,
      ],
    });
    expect(first.ok).toBe(true);
    const sampleRows = [makePopulationRow("A1"), makePopulationRow("A2")];
    const sampled = await saveSampleMaster(root, MONTH, makeSampleMaster(sampleRows));
    expect(sampled.ok).toBe(true);
    const distributed = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    ]);
    expect(distributed.ok).toBe(true);
    __clearDeriveMemoForTests();

    // Missing "A2" (a live sampled id) from a distributed month — blocked
    // regardless of confirmedOverwrite (Task 3's A2 overwrite rule).
    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
      confirmedOverwrite: true,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.overwriteBlocked).toBeDefined();

    const processed = await monthSubdir(root, "2-processed");
    const raw = await monthSubdir(root, "1-raw");
    const allSuperseded = [
      ...(await fileNames(processed)).filter((n) => n.includes(".superseded.")),
      ...(await fileNames(raw)).filter((n) => n.includes(".superseded.")),
    ];
    expect(allSuperseded).toEqual([]);
  });

  // Fix round 2 (F5 finding #1, closed): a TRANSIENT NotFound opening the
  // existing population.final.json — the exact SMB directory-listing-lag
  // symptom the reviewer flagged — must not be read as "nothing to archive".
  // `retryMissingSource: true` on the mandatory call rides the same
  // retryMissing ladder copyFileBytes/openFile already use for post-write
  // verification reads; here it is proven against a fault that fails
  // `getFileHandle` a few times and then lets it through, which the OLD
  // (round-1) code — a single unretried attempt — would have silently
  // resolved to `source_missing` and let the overwrite through with zero
  // backup.
  test("a transient NotFound on the existing population.final.json is retried, not treated as absent", async () => {
    const root = createMemoryDirectory("root");
    const first = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
    });
    expect(first.ok).toBe(true);

    // Three failures then success — well inside the retryMissing ladder's
    // budget (8 rungs), so this resolves in well under a second.
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "population.final.json", create: false, errorName: "NotFoundError", times: 3 },
    ]);
    const second = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("B1") as unknown as Record<string, unknown>],
    });
    setSimulatedFaults(root, []);

    expect(second.ok).toBe(true);
    const processed = await monthSubdir(root, "2-processed");
    const archives = (await fileNames(processed)).filter((n) => /^population\.final\..+\.superseded\.json$/.test(n));
    expect(archives).toHaveLength(1);
    const archived = await safeReadJson<PopulationFinalData>(processed, archives[0]!);
    expect(archived.ok && archived.value.rows.map((row) => row["xrayImageId"])).toEqual(["A1"]);
    const live = await safeReadJson<PopulationFinalData>(processed, "population.final.json");
    expect(live.ok && live.value.rows.map((row) => row["xrayImageId"])).toEqual(["B1"]);
  });

  // Fix round 2, the other direction: a genuinely first-ever save of a month
  // (no `month.manifest.json` yet) has no live population.final.json to
  // protect, so `retryMissingSource` must stay OFF for it — proving this
  // stays FAST (no ~11s ladder paid) is the point: `saveMonthRun` unconditionally
  // turning retryMissingSource on for every save, including this one, is
  // exactly what broke several unrelated tests' 20s `testTimeout` during
  // development of this fix (see task-4-report.md's fix-round-2 section) —
  // this is the regression guard for that. `copyFileBytesVerified`'s own
  // "a genuinely absent file still resolves to source_missing after
  // exhausting the ladder WHEN retryMissingSource is on" contract is proven
  // directly at the storage-layer unit level instead, in
  // `safeWrite.copyVerifiedRetry.test.ts` — pinning it here too would just
  // re-pay the same ~11s for no additional coverage.
  test("a genuinely first-ever save resolves fast, with nothing to archive", async () => {
    const root = createMemoryDirectory("root");
    const startedAt = performance.now();
    const result = await saveMonthRun({
      directoryHandle: root,
      ...baseParams,
      processedRows: [makePopulationRow("A1") as unknown as Record<string, unknown>],
    });
    const elapsed = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    // Comfortably under the retryMissing ladder's first rung — no retry loop
    // ran at all for the mandatory archive's source probe.
    expect(elapsed).toBeLessThan(2000);
    const processed = await monthSubdir(root, "2-processed");
    expect((await fileNames(processed)).filter((n) => n.includes(".superseded."))).toEqual([]);
    const live = await safeReadJson<PopulationFinalData>(processed, "population.final.json");
    expect(live.ok && live.value.rows.map((row) => row["xrayImageId"])).toEqual(["A1"]);
  });
});
