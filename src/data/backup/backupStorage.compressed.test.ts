/**
 * Backup and restore of COMPRESSED workspace files.
 *
 * Both walks classify files by exact name, and compression deliberately does not
 * change a file's name — so nothing in either walk had to learn a new family.
 * What did have to change is HOW the bytes move: the text copy that is correct
 * for a plain JSON file silently destroys a gzip member, because decoding it as
 * UTF-8 and re-encoding it does not round-trip.
 *
 * These tests pin exactly that: a compressed file survives a backup byte for
 * byte, comes back byte for byte, and — because the name is shared — a restore
 * can never leave a compressed and a plain copy of one logical file side by side.
 */
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { probeFileFormat } from "../storage/compressedEnvelope";
import { PLAIN_JSON_POLICY } from "../storage/storagePolicy";
import { getPopulationRoot, getSystemRoot } from "../workspace/workspacePaths";
import { createBackup, restoreBackupSnapshot } from "./backupStorage";

const MONTH = "5-may-2026";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function population(count: number, tag: string) {
  return {
    sourceMonthFolder: MONTH,
    processedBy: tag,
    rows: Array.from({ length: count }, (_, i) => ({
      xrayImageId: `XR-${i}`,
      portName: "ميناء جدة الإسلامي",
      result: i % 2 === 0 ? "مطابق" : "غير مطابق",
      tag,
    })),
  };
}

/** `1-population/{month}/2-processed/` — where population.final.json lives. */
async function processedDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const populationDir = await getPopulationRoot(root, true);
  const monthDir = await populationDir.getDirectoryHandle(MONTH, { create: true });
  return monthDir.getDirectoryHandle("2-processed", { create: true });
}

async function bytesOf(dir: DirectoryHandleLike, name: string): Promise<Uint8Array> {
  const handle = await dir.getFileHandle(name, { create: false });
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

async function backupJsonDir(
  root: DirectoryHandleLike,
  folderName: string
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(root, false);
  const backupsDir = await systemDir.getDirectoryHandle("backups", { create: false });
  const backupDir = await backupsDir.getDirectoryHandle(folderName, { create: false });
  return backupDir.getDirectoryHandle("json", { create: false });
}

describe("backup/restore of compressed files", () => {
  it("copies a compressed file into the snapshot byte for byte", async () => {
    const root = makeRoot();
    const processed = await processedDir(root);
    await safeWriteJson(processed, "population.final.json", population(4000, "original"));
    expect((await probeFileFormat(processed, "population.final.json")).kind).toBe("compressed");

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const jsonDir = await backupJsonDir(root, result.folderName);
    const copied = await jsonDir
      .getDirectoryHandle("1-population", { create: false })
      .then((d) => d.getDirectoryHandle(MONTH, { create: false }))
      .then((d) => d.getDirectoryHandle("2-processed", { create: false }));

    expect(await bytesOf(copied, "population.final.json")).toEqual(
      await bytesOf(processed, "population.final.json")
    );
    expect(
      result.manifest.jsonFilesBackedUp.some((f) => f.endsWith("population.final.json"))
    ).toBe(true);
  });

  it("restores a compressed file over a live one and reads back the snapshot's data", async () => {
    const root = makeRoot();
    const processed = await processedDir(root);
    await safeWriteJson(processed, "population.final.json", population(4000, "original"));
    const snapshotBytes = await bytesOf(processed, "population.final.json");

    const backup = await createBackup(root, [], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // The live file moves on after the snapshot was taken.
    await safeWriteJson(processed, "population.final.json", population(4000, "later"));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    // Byte-identical to what was captured, and still one single file under the
    // one name — a compressed and a plain copy of it cannot coexist.
    expect(await bytesOf(processed, "population.final.json")).toEqual(snapshotBytes);
    const read = await safeReadJson<ReturnType<typeof population>>(
      processed,
      "population.final.json"
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.processedBy).toBe("original");
    expect(read.value.rows).toHaveLength(4000);
  });

  it("restores a PLAIN snapshot over a compressed live file, leaving no mixed remains", async () => {
    const root = makeRoot();
    const processed = await processedDir(root);
    // A snapshot taken before compression existed.
    await safeWriteJson(processed, "population.final.json", population(4000, "legacy-plain"), {
      policy: PLAIN_JSON_POLICY,
    });

    const backup = await createBackup(root, [], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await safeWriteJson(processed, "population.final.json", population(4000, "compressed-live"));
    expect((await probeFileFormat(processed, "population.final.json")).kind).toBe("compressed");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    expect((await probeFileFormat(processed, "population.final.json")).kind).toBe("plain");
    const read = await safeReadJson<ReturnType<typeof population>>(
      processed,
      "population.final.json"
    );
    expect(read.ok && read.value.processedBy).toBe("legacy-plain");
  });
});
