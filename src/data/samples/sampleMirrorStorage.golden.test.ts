import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, getSampleMainDir } from "../workspace/workspacePaths";
import type {
  DistributionCurrentData,
  DistributionEntry,
} from "../distribution/distributionTypes";
import type { EmployeeMirrorRowStub } from "../population/populationTypes";
import { syncSampleMirrors } from "./sampleMirrorStorage";
import type { EmployeeSamplesFile, MainSamplesFile } from "./sampleMirrorStorage";

/**
 * GOLDEN MASTER (Slice 0) — the `syncSampleMirrors` projection.
 *
 * `syncSampleMirrors` is the fan-out that turns one derived
 * `DistributionCurrentData` into `main.samples.json` plus one
 * `{username}.samples.json` per assignee. Employees read ONLY their mirror, so
 * the exact projected content — which entries land in which file, in what
 * order, with what surrounding fields — is the contract.
 *
 * `updatedAt` is excluded from every assertion: it is `new Date().toISOString()`
 * and is the only non-deterministic field written.
 *
 * Values are recorded as OBSERVED. Where a value looks wrong, the comment says
 * so and the value is still the observed one.
 */

const MONTH = "5-May-2026";

function stub(id: string): EmployeeMirrorRowStub {
  return {
    stage: "1",
    portName: "بري",
    xrayEntryDate: `2026-05-0${id.slice(-1)}`,
    plateOrContainerNumber: `PLATE-${id}`,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    certScanStatus: "NonCertscan",
    declarationNumber: `D-${id}`,
    declarationDate: "2026-05-01",
    chassisNumber: `CH-${id}`,
    movementType: "LAND",
    portCode: "P1",
    portType: "بري",
    targetedByRiskEngine: null,
    riskMessage: null,
    biEnrichmentStatus: "BI Not Provided",
    reportNumber: `R-${id}`,
  };
}

function entry(
  id: string,
  assignedTo: string,
  status: DistributionEntry["status"] = "pending"
): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo,
    status,
    replacedById: null,
    lastEventAt: `2026-05-04T0${id.slice(-1)}:00:00.000Z`,
    lastEventId: `evt-${id}`,
    row: stub(id),
  };
}

function current(
  entries: DistributionEntry[],
  logRevision?: number
): DistributionCurrentData {
  return {
    monthFolderName: MONTH,
    logRevision,
    deriveVersion: 2,
    derivedAt: "2026-05-06T00:00:00.000Z",
    totalAssigned: entries.filter((e) => e.status !== "replaced").length,
    totalCompleted: entries.filter((e) => e.status === "completed").length,
    totalReplaced: entries.filter((e) => e.status === "replaced").length,
    totalPending: entries.filter((e) => e.status === "pending").length,
    entries,
  };
}

async function readMain(root: DirectoryHandleLike): Promise<MainSamplesFile> {
  const dir = await getSampleMainDir(root, MONTH, false);
  const result = await safeReadJson<MainSamplesFile>(dir, "main.samples.json");
  if (!result.ok) throw new Error("main.samples.json missing");
  return result.value;
}

async function readEmployee(
  root: DirectoryHandleLike,
  fileName: string
): Promise<EmployeeSamplesFile | null> {
  const dir = await getSampleEmployeeDir(root, MONTH, false);
  const result = await safeReadJson<EmployeeSamplesFile>(dir, fileName);
  return result.ok ? result.value : null;
}

async function listEmployeeFiles(root: DirectoryHandleLike): Promise<string[]> {
  const dir = await getSampleEmployeeDir(root, MONTH, false);
  const iterable = (
    dir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }
  ).values();
  const names: string[] = [];
  for await (const handle of iterable) {
    // safeWriteJson leaves .bak/.tmp siblings behind; only the real mirrors matter.
    if (handle.name.endsWith(".samples.json")) names.push(handle.name);
  }
  return names.sort();
}

/**
 * Drops `updatedAt` — the only non-deterministic field written by
 * syncSampleMirrors (`new Date().toISOString()`).
 */
function omitUpdatedAt<T extends MainSamplesFile>(file: T): Omit<T, "updatedAt"> {
  const copy: Partial<T> = { ...file };
  delete copy.updatedAt;
  return copy as Omit<T, "updatedAt">;
}

describe("syncSampleMirrors — golden master projection", () => {
  const entries = [
    entry("img-1", "emp-a"),
    entry("img-2", "emp-b", "completed"),
    entry("img-3", "emp-a", "replacement-requested"),
    entry("img-4", "emp-b"),
    // Terminal "replaced" entries are still mirrored to their assignee.
    entry("img-5", "emp-a", "replaced"),
  ];

  it("pins the main.samples.json projection", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current(entries, 7));

    const main = omitUpdatedAt(await readMain(root));
    expect(main).toEqual({
      monthFolderName: MONTH,
      sourceLogRevision: 7,
      // Every entry, in the exact order of `current.entries` — no filtering, no
      // sorting, and no summary counters are carried across.
      entries,
    });
    expect(Object.keys(main)).toEqual(["monthFolderName", "sourceLogRevision", "entries"]);
  });

  it("pins the per-employee split: only that employee's entries, in source order", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current(entries, 7));

    expect(await listEmployeeFiles(root)).toEqual(["emp-a.samples.json", "emp-b.samples.json"]);

    const empA = omitUpdatedAt((await readEmployee(root, "emp-a.samples.json"))!);
    expect(empA).toEqual({
      monthFolderName: MONTH,
      username: "emp-a",
      sourceLogRevision: 7,
      entries: [entries[0], entries[2], entries[4]],
    });

    const empB = omitUpdatedAt((await readEmployee(root, "emp-b.samples.json"))!);
    expect(empB).toEqual({
      monthFolderName: MONTH,
      username: "emp-b",
      sourceLogRevision: 7,
      entries: [entries[1], entries[3]],
    });
  });

  it("pins the missing-logRevision default of 0", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")]));
    expect((await readMain(root)).sourceLogRevision).toBe(0);
    expect((await readEmployee(root, "emp-a.samples.json"))!.sourceLogRevision).toBe(0);
  });

  it("SURPRISE: the main and employee monotonic guards use DIFFERENT comparisons at equal revisions", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Same revision, different content.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 5));

    // main: `existing < incoming` → an EQUAL revision is skipped.
    expect((await readMain(root)).entries[0].status).toBe("pending");
    // employee: `existing >= incoming` → return … also skipped. Same outcome
    // here, but the two guards are written as each other's inverse rather than
    // as one shared predicate, so they only agree by coincidence.
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("pending");
  });

  it("pins that a newer revision overwrites both files", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 6));
    expect((await readMain(root)).entries[0].status).toBe("completed");
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("completed");
  });

  it("SURPRISE: an employee who loses every entry keeps a STALE mirror file", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Revision 6 reassigns everything away from emp-a. `entriesByEmployee` is
    // built only from entries that exist, so emp-a is simply not visited — its
    // mirror is never rewritten to an empty list and never deleted. The
    // employee keeps seeing an assignment they no longer own.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-b")], 6));

    const stale = (await readEmployee(root, "emp-a.samples.json"))!;
    expect(stale.sourceLogRevision).toBe(5);
    expect(stale.entries.map((e) => e.xrayImageId)).toEqual(["img-1"]);
    // The main mirror, in contrast, is fully replaced.
    expect((await readMain(root)).entries[0].assignedTo).toBe("emp-b");
  });

  it("pins the empty-distribution case: main written, no employee files", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([], 1));
    expect((await readMain(root)).entries).toEqual([]);
    expect(await listEmployeeFiles(root)).toEqual([]);
  });

  it("pins the employee file-name sanitization", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(
      root,
      MONTH,
      current([entry("img-1", " a/b:c*?\"<>|d..e "), entry("img-2", "طارق")], 1)
    );
    expect(await listEmployeeFiles(root)).toEqual([
      "a_b_c_d.e.samples.json",
      "طارق.samples.json",
    ]);
    // The sanitized name is only the FILE name — `username` inside the file
    // keeps the original, un-sanitized string.
    expect((await readEmployee(root, "a_b_c_d.e.samples.json"))!.username).toBe(
      " a/b:c*?\"<>|d..e "
    );
  });

  it("SURPRISE: two usernames that sanitize to the same file name collide silently", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(
      root,
      MONTH,
      current([entry("img-1", "a/b"), entry("img-2", "a\\b")], 1)
    );
    // Both map to "a_b.samples.json"; the writes race through Promise.all and
    // one employee's mirror is overwritten by the other's. Only one file exists.
    expect(await listEmployeeFiles(root)).toEqual(["a_b.samples.json"]);
    const survivor = (await readEmployee(root, "a_b.samples.json"))!;
    expect(survivor.entries).toHaveLength(1);
    expect(["a/b", "a\\b"]).toContain(survivor.username);
  });

  it("pins the row stub carried into the mirror verbatim", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 1));
    const mirror = (await readEmployee(root, "emp-a.samples.json"))!;
    expect(mirror.entries[0].row).toEqual(stub("img-1"));
    // No projection/trimming happens here — the mirror stores whatever the
    // fold put on the entry.
    expect(mirror.entries[0].lastEventId).toBe("evt-img-1");
  });
});
