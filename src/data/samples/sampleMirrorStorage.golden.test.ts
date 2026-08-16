import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir, getSampleMainDir } from "../workspace/workspacePaths";
import type {
  DistributionCurrentData,
  DistributionEntry,
} from "../distribution/distributionTypes";
import type { EmployeeMirrorRowStub } from "../population/populationTypes";
import { syncSampleMirrors, readEmployeeMirrorIndex } from "./sampleMirrorStorage";
import type { EmployeeSamplesFile, EmployeeMirrorIndexFile } from "./sampleMirrorStorage";

/**
 * GOLDEN MASTER (Slice 0) — the `syncSampleMirrors` projection.
 *
 * `syncSampleMirrors` is the fan-out that turns one derived
 * `DistributionCurrentData` into one `{username}.samples.json` per assignee.
 * Employees read ONLY their mirror, so the exact projected content — which
 * entries land in which file, in what order, with what surrounding fields —
 * is the contract.
 *
 * `updatedAt` is excluded from every assertion: it is `new Date().toISOString()`
 * and is the only non-deterministic field written.
 *
 * RE-RECORDED (Design B, items 2.1/2.2). Three deliberate projection changes
 * versus the previous master, each asserted below:
 *   1. `main.samples.json` is no longer written at all — it had zero readers
 *      and cost a whole-month-sized file write on every distribution save.
 *   2. The per-employee fan-out is now a UNION write over (mirrors already on
 *      disk ∪ employees in `current.entries`), so an employee reassigned down
 *      to zero entries gets an explicit empty-entries file instead of keeping a
 *      stale one (bug F8).
 *   3a. (Design B step 2) The projection also writes a derived side-index,
 *      `2-employees/_index.json`. It is ADDITIVE: no assertion below about the
 *      mirrors themselves changed, and `listEmployeeFiles` does not see it
 *      because the name deliberately does not end in `.samples.json`.
 *   3. Each mirror carries a frozen `quota` snapshot when
 *      `current.quotas[username]` exists, so a reader needs no second file. It
 *      is ABSENT when the derived state carries no quota — dual-read contract.
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
  logRevision?: number,
  quotas?: DistributionCurrentData["quotas"]
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
    quotas,
    entries,
  };
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

/** Every file name (any extension) directly under `1-main/`, or [] when absent. */
async function listMainFiles(root: DirectoryHandleLike): Promise<string[]> {
  let dir: DirectoryHandleLike;
  try {
    dir = await getSampleMainDir(root, MONTH, false);
  } catch {
    return [];
  }
  const iterable = (
    dir as unknown as { values: () => AsyncIterable<{ name: string; kind: string }> }
  ).values();
  const names: string[] = [];
  for await (const handle of iterable) names.push(handle.name);
  return names.sort();
}

/**
 * Drops `updatedAt` — the only non-deterministic field written by
 * syncSampleMirrors (`new Date().toISOString()`).
 */
function omitUpdatedAt<T extends EmployeeSamplesFile>(file: T): Omit<T, "updatedAt"> {
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

  it("CHANGED (2.1): no main.samples.json is written any more", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current(entries, 7));

    // Previously this projection wrote a whole-month `main.samples.json`
    // mirror with zero readers. syncSampleMirrors no longer touches `1-main/`
    // at all (it does not even create the directory).
    expect(await listMainFiles(root)).toEqual([]);
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
      // RE-RECORDED (v88 refold fix): the mirror now also stamps WHICH
      // derivation produced it, so the monotonic guard can rewrite a mirror
      // that is at the same log revision but an older derive version. `2` is
      // the `deriveVersion` this suite's `current()` helper stamps.
      deriveVersion: 2,
      entries: [entries[0], entries[2], entries[4]],
    });
    // No `quota` key at all when the derived state carries no quotas.
    expect(Object.keys(empA).sort()).toEqual([
      "deriveVersion",
      "entries",
      "monthFolderName",
      "sourceLogRevision",
      "username",
    ]);

    const empB = omitUpdatedAt((await readEmployee(root, "emp-b.samples.json"))!);
    expect(empB).toEqual({
      monthFolderName: MONTH,
      username: "emp-b",
      sourceLogRevision: 7,
      deriveVersion: 2,
      entries: [entries[1], entries[3]],
    });
  });

  it("CHANGED (2.2c): pins the frozen quota snapshot copied into the mirror", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(
      root,
      MONTH,
      current([entry("img-1", "emp-a")], 3, {
        "emp-a": {
          username: "emp-a",
          sampleCount: 12,
          dailyQuota: 4,
          daysRemainingAtAssignment: 3,
          assignedAt: "2026-05-02T00:00:00.000Z",
        },
      })
    );

    const empA = omitUpdatedAt((await readEmployee(root, "emp-a.samples.json"))!);
    // Exactly three fields are copied — `username` is redundant with the file's
    // own `username`, and `assignedAt` is not needed to render a quota.
    expect(empA.quota).toEqual({
      dailyQuota: 4,
      daysRemainingAtAssignment: 3,
      sampleCount: 12,
    });
  });

  it("CHANGED (2.2c): an employee with no quota entry gets NO quota key (dual-read)", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(
      root,
      MONTH,
      current([entry("img-1", "emp-a"), entry("img-2", "emp-b")], 3, {
        "emp-a": {
          username: "emp-a",
          sampleCount: 1,
          dailyQuota: 1,
          daysRemainingAtAssignment: 1,
          assignedAt: "2026-05-02T00:00:00.000Z",
        },
      })
    );

    expect((await readEmployee(root, "emp-a.samples.json"))!.quota).toBeDefined();
    expect((await readEmployee(root, "emp-b.samples.json"))!.quota).toBeUndefined();
  });

  it("pins the missing-logRevision default of 0", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")]));
    expect((await readEmployee(root, "emp-a.samples.json"))!.sourceLogRevision).toBe(0);
  });

  it("pins the employee monotonic guard: an EQUAL revision is skipped", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Same revision, different content.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 5));

    // `existing >= incoming` on (revision, deriveVersion) → skipped. Both runs
    // carry deriveVersion 2, so the v88 tie-break does not fire here; the
    // same-revision/newer-version case is pinned in sampleMirrorStorage.test.ts.
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("pending");
  });

  it("pins that a newer revision overwrites the mirror", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 6));
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("completed");
  });

  it("FIXED (F8): an employee who loses every entry gets an EMPTY mirror, not a stale one", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Revision 6 reassigns everything away from emp-a. The union write visits
    // emp-a because a mirror for them already exists on disk, even though they
    // appear nowhere in `current.entries`.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-b")], 6));

    const empA = (await readEmployee(root, "emp-a.samples.json"))!;
    expect(empA.sourceLogRevision).toBe(6);
    expect(empA.entries).toEqual([]);
    // The file is emptied, never deleted — the mirror stays a stable read target.
    expect(await listEmployeeFiles(root)).toEqual(["emp-a.samples.json", "emp-b.samples.json"]);
  });

  it("pins the empty-distribution case: no employee files", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([], 1));
    expect(await listEmployeeFiles(root)).toEqual([]);
    expect(await listMainFiles(root)).toEqual([]);
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
    // Both map to "a_b.samples.json"; one employee's mirror is overwritten by
    // the other's. Only one file exists. Unchanged by the union write.
    expect(await listEmployeeFiles(root)).toEqual(["a_b.samples.json"]);
    const survivor = (await readEmployee(root, "a_b.samples.json"))!;
    expect(survivor.entries).toHaveLength(1);
    expect(["a/b", "a\\b"]).toContain(survivor.username);
  });

  it("ADDED (step 2): pins the derived _index.json written alongside the mirrors", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current(entries, 7));

    const index = (await readEmployeeMirrorIndex(root, MONTH))!;
    expect(index.monthFolderName).toBe(MONTH);
    // Committed, not mid-flight: the phase-2 write cleared the marker.
    expect(index.pendingRevision).toBeNull();
    expect(index.pendingDeriveVersion).toBeNull();
    // Keyed by FILE NAME (not username), same as readExistingMirrors.
    // RE-RECORDED (v88 refold fix): each entry now also carries the mirror's
    // `deriveVersion`. Without it the index fast path could not evaluate the
    // guard's new tie-break and would silently defeat the fix.
    expect(index.mirrors).toEqual({
      "emp-a.samples.json": { username: "emp-a", sourceLogRevision: 7, deriveVersion: 2 },
      "emp-b.samples.json": { username: "emp-b", sourceLogRevision: 7, deriveVersion: 2 },
    });
    // The index is NOT a mirror — no listing that filters on the mirror suffix
    // can pick it up (this is what keeps answerStorage's own `.answers.json`
    // scan of this same folder, and every assertion above, unaffected).
    expect(await listEmployeeFiles(root)).toEqual(["emp-a.samples.json", "emp-b.samples.json"]);
  });

  it("ADDED (step 2): the index records the SKIPPED file's higher revision, not the incoming one", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));
    // Equal revision → the monotonic guard skips the write (pinned above), so
    // the index must keep saying 5 rather than adopting the incoming value.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 5));

    const index = (await readEmployeeMirrorIndex(root, MONTH))!;
    expect(index.mirrors["emp-a.samples.json"].sourceLogRevision).toBe(5);
  });

  it("ADDED (step 2): the index survives a sanitize collision the same way the files do", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "a/b"), entry("img-2", "a\\b")], 1));

    const index = (await readEmployeeMirrorIndex(root, MONTH))!;
    // One file, therefore one index entry — the collision is not "fixed" by the
    // index, which would make it disagree with the directory.
    expect(Object.keys(index.mirrors)).toEqual(["a_b.samples.json"]);
    expect(["a/b", "a\\b"]).toContain(index.mirrors["a_b.samples.json"].username);
  });

  it("ADDED (step 2): DUAL-READ — an index that disagrees with the listing is ignored, not trusted", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Hand-write a stale index that both LIES about emp-a's revision (99, which
    // would make the monotonic guard skip every future write forever) and fails
    // to describe the directory (it names a mirror that does not exist).
    const dir = await getSampleEmployeeDir(root, MONTH, false);
    await safeWriteJson<EmployeeMirrorIndexFile>(dir, "_index.json", {
      monthFolderName: MONTH,
      updatedAt: "2026-05-06T00:00:00.000Z",
      pendingRevision: null,
      mirrors: {
        "emp-a.samples.json": { username: "emp-a", sourceLogRevision: 99 },
        "ghost.samples.json": { username: "ghost", sourceLogRevision: 99 },
      },
    });

    // Coverage check fails → the mirrors themselves are read → revision 6 wins.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 6));
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("completed");
    // …and the index is rewritten to agree with the directory again.
    expect((await readEmployeeMirrorIndex(root, MONTH))!.mirrors).toEqual({
      "emp-a.samples.json": { username: "emp-a", sourceLogRevision: 6, deriveVersion: 2 },
    });
  });

  it("ADDED (step 2): SURPRISE — a CONSISTENT index is trusted even when it lies", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Same lie as above, but this time the index exactly covers the listing, so
    // the coverage check passes and the mirrors are never opened. The guard
    // therefore skips a write it should have made. This is the accepted trust
    // boundary of an accelerator validated only against the directory listing:
    // it can be wrong only if something OTHER than syncSampleMirrors wrote it,
    // and the fallout is a stale mirror (recoverable on the next higher
    // revision), never resurrected entries.
    const dir = await getSampleEmployeeDir(root, MONTH, false);
    await safeWriteJson<EmployeeMirrorIndexFile>(dir, "_index.json", {
      monthFolderName: MONTH,
      updatedAt: "2026-05-06T00:00:00.000Z",
      pendingRevision: null,
      mirrors: { "emp-a.samples.json": { username: "emp-a", sourceLogRevision: 99 } },
    });

    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 6));
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("pending");
  });

  it("ADDED (step 2): pendingRevision raises the guard's floor, so an interrupted run cannot be clobbered by an older one", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a")], 5));

    // Shape a crash mid-projection: mirrors may already be at revision 9, but
    // the index still records 5 and is marked in-flight at 9.
    const dir = await getSampleEmployeeDir(root, MONTH, false);
    await safeWriteJson<EmployeeMirrorIndexFile>(dir, "_index.json", {
      monthFolderName: MONTH,
      updatedAt: "2026-05-06T00:00:00.000Z",
      pendingRevision: 9,
      mirrors: { "emp-a.samples.json": { username: "emp-a", sourceLogRevision: 5 } },
    });

    // An OLDER derivation (7 < 9) must not overwrite what the interrupted run
    // may already have written.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 7));
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("pending");

    // A newer one (10 > 9) still gets through — the floor is not a permanent lock.
    await syncSampleMirrors(root, MONTH, current([entry("img-1", "emp-a", "completed")], 10));
    expect((await readEmployee(root, "emp-a.samples.json"))!.entries[0].status).toBe("completed");
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
