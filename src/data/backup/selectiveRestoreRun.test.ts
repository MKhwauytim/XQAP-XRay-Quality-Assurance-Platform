import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadPopulationAggregate } from "../population/populationAggregate";
import { loadReplacementIndexManifest } from "../population/replacementIndexStorage";
import type { RestoreScope } from "./restoreScope";
import { runSelectiveRestore } from "./selectiveRestore";
import {
  backupFolderNames,
  distEvent,
  listNames,
  M1,
  makeRoot,
  ndjson,
  openDir,
  readJsonAt,
  seedBackup,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;
const PROCESSED_M1 = `1-population/${M1}/2-processed`;

function run(root: DirectoryHandleLike, scope: RestoreScope) {
  return runSelectiveRestore({ directoryHandle: root, months: [], backupFolderName: TEST_BACKUP, username: "admin", scope });
}

function populationRow(id: string): Record<string, unknown> {
  return { xrayImageId: id, certScanStatus: "NonCertscan", stage: "المرحلة الأولى", portName: "ميناء" };
}

async function seedStaleDerived(root: DirectoryHandleLike): Promise<void> {
  await writeJsonAt(root, `${PROCESSED_M1}/replacement-index/index.manifest.json`, {
    formatVersion: 1,
    monthFolderName: M1,
    sourceRevision: 999,
    stageMappingsHash: "stale",
    builtAt: "2026-06-01T00:00:00.000Z",
    builtBy: "stale",
    totalIndexedRows: 0,
    buckets: [],
  });
  await writeJsonAt(root, `${PROCESSED_M1}/population.aggregate.json`, {
    schemaVersion: 1,
    monthFolderName: M1,
    computedAt: "2026-06-01T00:00:00.000Z",
    computedBy: "stale",
    summary: {},
    previewRows: [],
  });
}

describe("runSelectiveRestore", () => {
  it("refuses a plan that cannot be confirmed and never creates a rollback backup", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }] });
    await writeRawAt(root, `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, ndjson([distEvent("e01", "A")]));
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("plan-rejected");
    expect(await backupFolderNames(root)).toEqual([TEST_BACKUP]);
  });

  it("rebuilds the replacement index and aggregate from the restored (older-revision) population", async () => {
    const root = makeRoot();
    // Live population is NEWER (revision 2) than the backup's (revision 1).
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await seedStaleDerived(root);
    await seedBackup(root, {
      [POP_M1]: { rows: [populationRow("A"), populationRow("C")] },
      [`${PROCESSED_M1}/processing.summary.json`]: {
        summary: { totalRows: 2 },
        removedRows: [],
        duplicateRows: [],
        invalidResultRows: [],
        savedAt: "2026-05-31T10:00:00.000Z",
      },
    });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const manifest = await loadReplacementIndexManifest(root, M1);
    expect(manifest?.sourceRevision).toBe(1);
    expect(manifest?.totalIndexedRows).toBe(2);
    const aggregate = await loadPopulationAggregate(root, M1);
    expect(aggregate.status).toBe("ok");
    if (aggregate.status !== "ok") return;
    expect(aggregate.aggregate.computedBy).toBe("admin");
  });

  it("discards a stale aggregate when the restored month has no processing summary", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { rows: [populationRow("A")] });
    await seedStaleDerived(root);
    await seedBackup(root, { [POP_M1]: { rows: [populationRow("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    expect((await loadPopulationAggregate(root, M1)).status).toBe("missing");
  });

  it("rebuilds distribution.current.json for a restored Sample & distribution month", async () => {
    const root = makeRoot();
    await writeJsonAt(root, `2-samples/${M1}/1-main/distribution.current.json`, {
      monthFolderName: M1,
      entries: [{ xrayImageId: "STALE" }],
    });
    await seedBackup(
      root,
      { [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "XR-e01", portName: "ميناء" }] } },
      { [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`]: ndjson([distEvent("e01")]) }
    );

    // Sample & distribution only: selecting Answers too would be an EMPTY
    // selection (the backup holds none) and the plan would refuse to confirm.
    const outcome = await run(root, { elements: ["sampleDistribution"], months: [M1] });

    expect(outcome.ok).toBe(true);
    const current = await readJsonAt<{ entries: Array<{ xrayImageId: string }> }>(
      root,
      `2-samples/${M1}/1-main/distribution.current.json`
    );
    expect(current?.entries.map((entry) => entry.xrayImageId)).toEqual(["XR-e01"]);
  });

  it("runs the integrity scan for every selected month and reports it", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [populationRow("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.integrity).toHaveLength(1);
    expect(outcome.integrity[0]?.month).toBe(M1);
    expect(outcome.integrity[0]?.error).toBeNull();
    expect(outcome.integrity[0]?.result?.clean).toBe(true);
  });

  it("reports an interrupted backup as a failed run", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [] } }, {}, { complete: false });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "restore-failed") return;
    expect(outcome.error).toMatch(/غير مكتملة/);
  });
  it("archives the live population next to itself before overwriting it (never deletes)", async () => {
    const root = makeRoot();
    await writeJsonAt(root, POP_M1, { source: "live", rows: [populationRow("A")] });
    await seedBackup(root, { [POP_M1]: { source: "backup", rows: [populationRow("A")] } });

    const outcome = await run(root, { elements: ["population"], months: [M1] });

    expect(outcome.ok).toBe(true);
    expect((await readJsonAt<{ source: string }>(root, POP_M1))?.source).toBe("backup");
    const processed = await openDir(root, ["1-population", M1, "2-processed"]);
    const names = processed ? await listNames(processed) : [];
    const archived = names.filter((name) => /^population\.final\..+\.superseded\.json$/.test(name));
    expect(archived).toHaveLength(1);
    expect((await readJsonAt<{ source: string }>(root, `${PROCESSED_M1}/${archived[0]}`))?.source).toBe("live");
  });
});
