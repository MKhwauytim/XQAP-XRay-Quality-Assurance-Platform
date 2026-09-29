import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getLabels } from "../labels/labelsStore";
import { restoreBackupSnapshot } from "./backupStorage";
import type { RestoreScope } from "./restoreScope";
import {
  backupFolderNames,
  distEvent,
  M1,
  M2,
  makeRoot,
  ndjson,
  openDir,
  readJsonAt,
  readRawAt,
  seedBackup,
  sentinelExists,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

function restore(root: DirectoryHandleLike, scope?: RestoreScope) {
  return restoreBackupSnapshot({
    directoryHandle: root,
    months: [],
    backupFolderName: TEST_BACKUP,
    username: "admin",
    ...(scope ? { scope } : {}),
  });
}

/** Wrap a memory root so creating `fileName` anywhere below it throws. */
function failWritesOf(real: DirectoryHandleLike, fileName: string): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create && name === fileName) throw new Error(`Simulated write failure for ${name}`);
      return real.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
      failWritesOf(await real.getDirectoryHandle(name, options), fileName),
  };
}

describe("restoreBackupSnapshot — scope absent (full restore unchanged)", () => {
  it("restores every payload file, including ones no element owns", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/2-processed/population.final.json`]: { rows: [{ xrayImageId: "A" }] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "A" }] },
      "5-system/audit/actions/admin.actions.json": { entries: [] },
      "unowned/extra.json": { value: 1 },
    });

    const result = await restore(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.restoredFiles].sort()).toEqual(
      [
        `1-population/${M1}/2-processed/population.final.json`,
        `2-samples/${M1}/1-main/sample.master.json`,
        "5-system/audit/actions/admin.actions.json",
        "unowned/extra.json",
      ].sort()
    );
  });
});

describe("restoreBackupSnapshot — scoped", () => {
  it("restores only the selected month's population files for a population-only scope", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/month.manifest.json`]: { monthFolderName: M1, source: "backup" },
      [`1-population/${M1}/2-processed/population.final.json`]: { source: "backup", rows: [] },
      [`1-population/${M1}/2-processed/population.aggregate.json`]: { source: "backup" },
      [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`]: { source: "backup" },
      [`1-population/${M2}/2-processed/population.final.json`]: { source: "backup", rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { source: "backup", rows: [] },
      "6-templates/templates.index.json": { source: "backup" },
    });
    for (const path of [
      `1-population/${M1}/2-processed/population.final.json`,
      `1-population/${M2}/2-processed/population.final.json`,
      `2-samples/${M1}/1-main/sample.master.json`,
      "6-templates/templates.index.json",
    ]) {
      await writeJsonAt(root, path, { source: "live", rows: [] });
    }

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.restoredFiles].sort()).toEqual([
      `1-population/${M1}/2-processed/population.final.json`,
      `1-population/${M1}/month.manifest.json`,
    ]);
    type Tagged = { source: string };
    expect((await readJsonAt<Tagged>(root, `1-population/${M1}/2-processed/population.final.json`))?.source).toBe("backup");
    expect((await readJsonAt<Tagged>(root, `1-population/${M2}/2-processed/population.final.json`))?.source).toBe("live");
    expect((await readJsonAt<Tagged>(root, `2-samples/${M1}/1-main/sample.master.json`))?.source).toBe("live");
    expect((await readJsonAt<Tagged>(root, "6-templates/templates.index.json"))?.source).toBe("live");
    // Derived population artifacts are rebuilt later, never copied.
    expect(await readJsonAt(root, `1-population/${M1}/2-processed/population.aggregate.json`)).toBeNull();
    expect(await openDir(root, ["1-population", M1, "2-processed", "replacement-index"])).toBeNull();
  });

  it("does not create folders for elements the scope leaves out", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
      "4-reports/designs/designs.index.json": { designs: [] },
    });

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    expect(await openDir(root, ["2-samples"])).toBeNull();
    expect(await openDir(root, ["4-reports"])).toBeNull();
  });

  it("still union-merges distribution event segments for a sample-only scope and leaves answers alone", async () => {
    const root = makeRoot();
    const segmentPath = `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`;
    const answersPath = `2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`;
    await seedBackup(root, {}, {
      [segmentPath]: ndjson([distEvent("e01"), distEvent("e02")]),
      [answersPath]: ndjson([{ eventId: "a01", eventType: "saved" }]),
    });
    await writeRawAt(root, segmentPath, ndjson([distEvent("e02"), distEvent("e03")]));

    const result = await restore(root, { elements: ["sampleDistribution"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredFiles).toEqual([segmentPath]);
    const ids = ((await readRawAt(root, segmentPath)) ?? "")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => (JSON.parse(line) as { eventId: string }).eventId);
    // Live order is the base; only the id the live segment lacked is appended.
    expect(ids).toEqual(["e02", "e03", "e01"]);
    expect(await readRawAt(root, answersPath)).toBeNull();
  });

  it("selects the unnumbered legacy month folder for a population scope", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`Population/${M1}/processed/population.final.json`]: { source: "backup", rows: [] },
      [`Population/${M1}/sample/sample.master.json`]: { source: "backup", rows: [] },
    });

    const result = await restore(root, { elements: ["population"], months: [M1] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredFiles).toEqual([`Population/${M1}/processed/population.final.json`]);
    expect(await openDir(root, ["Population", M1, "sample"])).toBeNull();
  });

  it("refuses an unusable scope before any rollback backup or sentinel is written", async () => {
    const root = makeRoot();
    await seedBackup(root, { [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] } });

    const result = await restore(root, { elements: ["population"], months: [] });

    expect(result).toEqual({ ok: false, error: getLabels().restore_scope_invalid });
    expect(await backupFolderNames(root)).toEqual([TEST_BACKUP]);
    expect(await sentinelExists(root)).toBe(false);
  });

  it("creates the pre-restore rollback backup and clears the sentinel for a scoped restore", async () => {
    const root = makeRoot();
    await seedBackup(root, { "6-templates/templates.index.json": { source: "backup" } });

    const result = await restore(root, { elements: ["templates"], months: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rollbackFolderName).toContain("pre-restore");
    expect(await backupFolderNames(root)).toContain(result.rollbackFolderName);
    expect(await sentinelExists(root)).toBe(false);
  });

  it("leaves the sentinel behind when a scoped restore fails partway", async () => {
    const root = makeRoot();
    // Live has no population.final.json, so the rollback backup never touches
    // the failing name — only the restore walk does.
    await seedBackup(root, { [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] } });

    const result = await restore(failWritesOf(root, "population.final.json"), {
      elements: ["population"],
      months: [M1],
    });

    expect(result.ok).toBe(false);
    expect(await sentinelExists(root)).toBe(true);
  });
});
