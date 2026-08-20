import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import {
  __resetMaxStringLengthForTests,
  __setMaxStringLengthForTests,
  safeWriteJson,
} from "../storage/safeWrite";
import {
  createWorkspaceFixture,
  readFixtureFileText,
} from "../storage/workspaceLayoutFixture";
import { __clearWorkspaceDirCacheForTests, getSystemRoot } from "../workspace/workspacePaths";
import { createBackup, loadBackupHistory } from "./backupStorage";

/**
 * The backup is the product's whole data-safety story, and it had two
 * compounding holes:
 *
 *  STO-2 — the copy walk moved every file as a decoded STRING. A workspace
 *  holding one file past V8's max string length could therefore never be
 *  backed up at all: the read threw `RangeError: Invalid string length` and
 *  took the entire walk with it. That is the big, old, legacy-layout workspace
 *  whose data is least replaceable.
 *
 *  STO-5 — nothing verified the copies. A torn write produced a truncated file
 *  inside a folder the manifest certified as a complete backup.
 */
async function backupJsonDir(
  root: DirectoryHandleLike,
  folderName: string
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(root, false);
  const backupsDir = await systemDir.getDirectoryHandle("backups", { create: false });
  const backupDir = await backupsDir.getDirectoryHandle(folderName, { create: false });
  return backupDir.getDirectoryHandle("json", { create: false });
}

async function readCopyText(
  root: DirectoryHandleLike,
  folderName: string,
  relativePath: string
): Promise<string> {
  const jsonDir = await backupJsonDir(root, folderName);
  return readFixtureFileText(jsonDir, relativePath);
}

/**
 * Wraps a memory directory so that WRITES (create:true) of `targetFileName`
 * are damaged: a byte write lands with its final byte flipped (same length,
 * different content — a verification that only compared sizes would still
 * certify it), and a text write lands one character short. Both forms are
 * covered so the test describes "the copy did not come out right", not "the
 * copy path happens to be byte-based today".
 */
function wrapDirTearingWritesOf(
  real: DirectoryHandleLike,
  targetFileName: string
): DirectoryHandleLike {
  return {
    ...real,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const handle = await real.getFileHandle(fileName, options);
      if (!options?.create || fileName !== targetFileName || !handle.createWritable) {
        return handle;
      }
      const createWritable = handle.createWritable.bind(handle);
      const torn: FileHandleLike = {
        ...handle,
        createWritable: async () => {
          const writable = await createWritable();
          let tornYet = false;
          return {
            write: async (data: string | Uint8Array) => {
              const write = writable.write as unknown as (
                chunk: string | Uint8Array
              ) => Promise<void>;
              if (tornYet || data.length === 0) {
                await write(data);
                return;
              }
              tornYet = true;
              if (typeof data === "string") {
                await write(data.slice(0, -1));
                return;
              }
              const damaged = new Uint8Array(data);
              damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0xff;
              await write(damaged);
            },
            close: () => writable.close(),
          };
        },
      };
      return torn;
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const child = await real.getDirectoryHandle(dirName, options);
      return wrapDirTearingWritesOf(child, targetFileName);
    },
  };
}

beforeEach(() => {
  __clearWorkspaceDirCacheForTests();
});

afterEach(() => {
  __resetMaxStringLengthForTests();
});

describe("createBackup — a large plain legacy file (STO-2)", () => {
  it("backs up a legacy workspace whose raw file is larger than the max JS string, byte-identically", async () => {
    const fixture = await createWorkspaceFixture({
      layout: "legacy",
      plainRawFileBytes: 300 * 1024,
    });
    const sourceText = await readFixtureFileText(fixture.root, fixture.largePlainFilePath);

    // Stand in for V8's real ~537M-code-unit ceiling: any file above this can
    // no longer be read as one string, which is exactly the condition a real
    // 573 MB bi.raw.json creates on a real share.
    __setMaxStringLengthForTests(200 * 1024);

    const result = await createBackup(fixture.root, [], "admin", "manual");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.jsonFilesBackedUp).toContain(fixture.largePlainFilePath);
    expect(await readCopyText(fixture.root, result.folderName, fixture.largePlainFilePath)).toBe(
      sourceText
    );
  });

  it("copies every seeded plain file of a MIXED-layout workspace byte-for-byte", async () => {
    const fixture = await createWorkspaceFixture({ layout: "mixed" });

    const result = await createBackup(fixture.root, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.status).toBe("complete");

    for (const [path, text] of Object.entries(fixture.plainFiles)) {
      expect(result.manifest.jsonFilesBackedUp).toContain(path);
      expect(await readCopyText(fixture.root, result.folderName, path)).toBe(text);
    }
  });
});

describe("createBackup — copies are verified, not assumed (STO-5)", () => {
  it("reports a torn copy as a named failure and refuses to certify the backup as complete", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await safeWriteJson(root, "healthy.json", { value: "healthy" });
    await safeWriteJson(root, "torn.json", { value: "torn", padding: "x".repeat(2048) });

    // Only the SNAPSHOT copy is damaged; the live file is untouched.
    const tearing = wrapDirTearingWritesOf(root, "torn.json");

    const result = await createBackup(tearing, [], "admin", "manual");

    // The walk keeps going — one bad file must not cost the admin the other
    // hundred.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.jsonFilesBackedUp).toContain("healthy.json");

    // …but the damaged file is NOT reported as backed up (it used to be: the
    // copy was written and recorded without anyone ever looking at it again),
    // the backup is not certified complete, and the failure is named.
    expect(result.manifest.jsonFilesBackedUp).not.toContain("torn.json");
    expect(result.manifest.status).toBe("partial");
    expect(result.manifest.filesFailedVerification?.map((failure) => failure.path)).toEqual([
      "torn.json",
    ]);
    expect(result.manifest.filesFailedVerification?.[0]?.reason).toBeTruthy();

    // The admin's history list must show the same verdict.
    const history = await loadBackupHistory(root);
    expect(history[0]?.status).toBe("partial");
    expect(history[0]?.failedFilesCount).toBe(1);
  });

  it("certifies a clean backup as complete with no failures recorded (control)", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await safeWriteJson(root, "healthy.json", { value: "healthy" });

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.filesFailedVerification).toEqual([]);

    const history = await loadBackupHistory(root);
    expect(history[0]?.status).toBe("complete");
    expect(history[0]?.failedFilesCount).toBe(0);
  });
});

describe("createBackup — a file that vanishes mid-walk", () => {
  it("skips and notes it instead of aborting the backup", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await safeWriteJson(root, "stays.json", { value: "stays" });
    await safeWriteJson(root, "vanishes.json", { value: "vanishes" });

    // Listed by the walk, then deleted by another machine (or by
    // safeWriteJson's own .tmp churn) before the copy opens it. READ lookups
    // only — the snapshot's own create:true writes must still work.
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        name: "vanishes.json",
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await createBackup(root, [], "admin", "manual");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.jsonFilesBackedUp).toContain("stays.json");
    expect(result.manifest.jsonFilesBackedUp).not.toContain("vanishes.json");
    expect(result.manifest.filesSkippedMissing).toContain("vanishes.json");
    // A vanished last-write-wins file is routine churn, not a broken snapshot.
    expect(result.manifest.status).toBe("complete");
  });
});
