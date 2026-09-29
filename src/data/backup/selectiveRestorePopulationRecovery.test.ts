import { describe, expect, it } from "vitest";

import { listPopulationRecoveryCandidates } from "../population/populationRecovery";
import {
  BACKUP_POPULATION_CANDIDATE_SCAN_LIMIT,
  listBackupPopulationCandidates,
  restorePopulationMonthFromBackup,
} from "./selectiveRestore";
import { invalidateMonthLockCache } from "../population/monthLock";
import { distEvent, M1, M2, makeRoot, ndjson, readJsonAt, seedBackup, TEST_BACKUP, writeJsonAt, writeRawAt } from "./selectiveRestoreTestKit";

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;

describe("listBackupPopulationCandidates (A2 recovery tool)", () => {
  it("lists every complete backup holding the month's population, newest first, with sampled-id coverage", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, {
      rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }],
    });
    await seedBackup(root, { [POP_M1]: { processedAt: "2026-05-01T09:00:00.000Z", rows: [{ xrayImageId: "A" }] } }, {}, {
      folderName: "older",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }] } }, {}, {
      folderName: "newer",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    await seedBackup(root, { [`1-population/${M2}/2-processed/population.final.json`]: { rows: [] } }, {}, {
      folderName: "other-month",
      createdAt: "2026-06-02T00:00:00.000Z",
    });
    await seedBackup(root, { [POP_M1]: { rows: [] } }, {}, {
      folderName: "interrupted",
      createdAt: "2026-06-03T00:00:00.000Z",
      complete: false,
    });

    const candidates = await listBackupPopulationCandidates(root, M1);

    expect(candidates).toEqual([
      { fileName: "newer", source: "backup", rowCount: 2, processedAt: null, coveredSampledIds: 2, totalSampledIds: 2, wouldBlock: false },
      {
        fileName: "older",
        source: "backup",
        rowCount: 1,
        processedAt: "2026-05-01T09:00:00.000Z",
        coveredSampledIds: 1,
        totalSampledIds: 2,
        wouldBlock: false,
      },
    ]);
  });
});

describe("restorePopulationMonthFromBackup (A2 recovery tool)", () => {
  it("restores only that month's population through the scoped engine", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { source: "live", rows: [] });
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, { source: "live", rows: [] });
    await seedBackup(root, {
      [POP_M1]: { source: "backup", rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { source: "backup", rows: [] },
    });

    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: root,
      backupFolderName: TEST_BACKUP,
      month: M1,
      username: "admin",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.restoredFiles.every((path) => path.startsWith(`1-population/${M1}/`))).toBe(true);
    expect(outcome.rollbackFolderName).toContain("pre-restore");
    expect((await readJsonAt<{ source: string }>(root, POP_M1))?.source).toBe("backup");
    expect((await readJsonAt<{ source: string }>(root, `2-samples/${M1}/1-main/sample.master.json`))?.source).toBe("live");
  });

  it("marks a backup candidate that would orphan sampled ids of a distributed month as blocked", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, {
      rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }],
    });
    await writeRawAt(root, `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, ndjson([distEvent("e01", "A")]));
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const [candidate] = await listBackupPopulationCandidates(root, M1);

    expect(candidate?.wouldBlock).toBe(true);
  });

  it("refuses to overwrite the population of a closed month", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `1-population/${M1}/month.manifest.json`, { monthFolderName: M1, status: "closed" });
    await writeJsonAt(root, POP_M1, { source: "live", rows: [] });
    await seedBackup(root, { [POP_M1]: { source: "backup", rows: [] } });
    invalidateMonthLockCache(M1);

    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: root,
      backupFolderName: TEST_BACKUP,
      month: M1,
      username: "admin",
    });

    expect(outcome.ok).toBe(false);
    expect((await readJsonAt<{ source: string }>(root, POP_M1))?.source).toBe("live");
  });

  it("leaves a superseded local candidate behind, so the restore can be undone from the recovery list", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { source: "live", rows: [{ xrayImageId: "A" }] });
    await seedBackup(root, { [POP_M1]: { source: "backup", rows: [{ xrayImageId: "A" }] } });

    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: root,
      backupFolderName: TEST_BACKUP,
      month: M1,
      username: "admin",
    });

    expect(outcome.ok).toBe(true);
    const local = await listPopulationRecoveryCandidates(root, M1);
    expect(local.some((candidate) => candidate.source === "superseded")).toBe(true);
  });

  it("only considers the newest complete backups (bounded scan)", async () => {
    const root = makeRoot();
    const total = BACKUP_POPULATION_CANDIDATE_SCAN_LIMIT + 2;
    for (let index = 0; index < total; index += 1) {
      await seedBackup(root, { [POP_M1]: { rows: [] } }, {}, {
        folderName: `b-${String(index).padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 4, 1 + index)).toISOString(),
      });
    }

    const candidates = await listBackupPopulationCandidates(root, M1);

    expect(candidates).toHaveLength(BACKUP_POPULATION_CANDIDATE_SCAN_LIMIT);
    expect(candidates[0]?.fileName).toBe(`b-${String(total - 1).padStart(2, "0")}`);
  });
});
