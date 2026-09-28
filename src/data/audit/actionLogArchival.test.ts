import { afterEach, describe, expect, test } from "vitest";

import { createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAuditActionsDir } from "../workspace/workspacePaths";
import { actionsArchiveFileName, actionsFileName } from "./auditPaths";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import {
  __resetMaxActionEntriesForTests,
  __setActionLowWaterMarkForTests,
  __setMaxActionEntriesForTests,
  appendWorkspaceAction,
  readWorkspaceActionArchive,
  readWorkspaceActions,
  type WorkspaceActionInput,
} from "./actionLog";

afterEach(() => {
  __resetMaxActionEntriesForTests();
});

function input(marker: string): WorkspaceActionInput {
  return {
    actor: "admin",
    actorRole: "admin",
    action: "sample-drawn",
    monthFolderName: "5-may-2026",
    target: marker,
  };
}

/**
 * Wrap a directory so writes to any per-year archive file fail — used to verify
 * that an archive failure blocks the live-log trim. Matches BOTH shapes: the
 * legacy workspace-wide `actions.archive.{year}.json` and the per-actor
 * `{stem}.actions.{year}.json` this module writes now.
 */
const ARCHIVE_FILE_PATTERN = /(^actions\.archive\.\d{4}\.json$)|(\.actions\.\d{4}\.json$)/;

function wrapArchiveFailing(dir: DirectoryHandleLike): DirectoryHandleLike {
  return {
    ...dir,
    kind: "directory",
    name: dir.name,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (ARCHIVE_FILE_PATTERN.test(name)) {
        throw new Error("archive write blocked (test)");
      }
      return dir.getFileHandle(name, options);
    },
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      const child = await dir.getDirectoryHandle(name, options);
      return wrapArchiveFailing(child);
    },
  };
}

describe("audit log archival (A6)", () => {
  test("overflow lands in the per-year archive; the live log is trimmed to the cap", async () => {
    __setMaxActionEntriesForTests(3);
    const dir = createMemoryDirectory();

    for (let i = 1; i <= 5; i += 1) {
      await appendWorkspaceAction(dir, input(`n${i}`));
    }

    const live = await readWorkspaceActions(dir);
    expect(live.map((e) => e.target)).toEqual(["n3", "n4", "n5"]);

    const year = new Date().getFullYear();
    const archived = await readWorkspaceActionArchive(dir, year);
    expect(archived.map((e) => e.target)).toEqual(["n1", "n2"]);
  });

  test("archive-write failure blocks the trim — no entry is dropped", async () => {
    __setMaxActionEntriesForTests(3);
    const dir = wrapArchiveFailing(createMemoryDirectory());

    for (let i = 1; i <= 5; i += 1) {
      await appendWorkspaceAction(dir, input(`n${i}`));
    }

    // Trim was blocked because archival failed: the live log keeps ALL entries
    // (over cap) rather than dropping the oldest without archiving them.
    const live = await readWorkspaceActions(dir);
    expect(live.map((e) => e.target)).toEqual(["n1", "n2", "n3", "n4", "n5"]);

    const year = new Date().getFullYear();
    const archived = await readWorkspaceActionArchive(dir, year);
    expect(archived).toHaveLength(0);
  });
});

describe("audit log archival — P1 hysteresis", () => {
  test("archive is rewritten roughly once per (cap - low-water) appends, not once per append past the cap", async () => {
    __setMaxActionEntriesForTests(20);
    __setActionLowWaterMarkForTests(10);
    const dir = createMemoryDirectory("root", { trackOperations: true });

    const APPENDS = 75; // well past the cap, several hysteresis cycles
    for (let i = 1; i <= APPENDS; i += 1) {
      await appendWorkspaceAction(dir, input(`n${i}`));
    }

    const year = new Date().getFullYear();
    const archiveSuffix = `.actions.${year}.json`;
    const archiveWrites = getOperationLog(dir).filter(
      (e) => e.operation === "createWritable" && e.name.endsWith(archiveSuffix)
    );

    // Interval between archive triggers is cap - lowWater = 10, so the archive
    // is touched at most ceil(APPENDS / 10) times — never once per overflowing
    // append (which would be up to APPENDS - cap = 55 times here).
    expect(archiveWrites.length).toBeLessThanOrEqual(Math.ceil(APPENDS / 10));
    expect(archiveWrites.length).toBeGreaterThan(0);

    const live = await readWorkspaceActions(dir);
    expect(live.length).toBeLessThanOrEqual(20);
  });

  /**
   * Wrap a directory tree so every `createWritable().write()` is counted: total
   * bytes written, and the names of every file opened for writing.
   */
  function countWrites(dir: DirectoryHandleLike) {
    const stats = { bytes: 0, opened: [] as string[] };
    const wrapDir = (d: DirectoryHandleLike): DirectoryHandleLike => ({
      ...d,
      kind: "directory",
      name: d.name,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const handle = await d.getFileHandle(name, options);
        if (!handle.createWritable) return handle;
        return {
          ...handle,
          kind: "file",
          name: handle.name,
          getFile: () => handle.getFile(),
          createWritable: async () => {
            stats.opened.push(name);
            const writable = await handle.createWritable!();
            return {
              write: async (data: string) => {
                stats.bytes += new TextEncoder().encode(String(data)).length;
                await writable.write(data);
              },
              close: () => writable.close(),
            };
          },
        };
      },
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
        wrapDir(await d.getDirectoryHandle(name, options)),
    });
    return { dir: wrapDir(dir), stats };
  }

  /** Seed the live log at exactly `liveCount` entries and the archive with `archiveCount`. */
  async function seed(liveCount: number, archiveCount: number) {
    const root = createMemoryDirectory("root");
    const at = new Date().toISOString();
    const year = new Date().getFullYear();
    const make = (prefix: string, i: number) => ({
      id: `act-${prefix}-${String(i).padStart(6, "0")}`,
      at,
      actor: "admin",
      actorRole: "admin",
      action: "sample-drawn" as const,
      monthFolderName: "5-may-2026",
      target: `${prefix}-${i}`,
    });
    const actionsDir = await getAuditActionsDir(root, true);
    await safeWriteJson(actionsDir, actionsFileName("admin"), {
      actor: "admin",
      revision: 1,
      updatedAt: at,
      entries: Array.from({ length: liveCount }, (_, i) => make("live", i)),
    });
    if (archiveCount > 0) {
      await safeWriteJson(actionsDir, actionsArchiveFileName("admin", year), {
        year,
        revision: 1,
        updatedAt: at,
        entries: Array.from({ length: archiveCount }, (_, i) => make("arch", i)),
      });
    }
    return root;
  }

  async function liveLength(root: DirectoryHandleLike): Promise<number> {
    const actionsDir = await getAuditActionsDir(root, false);
    const read = await readOptionalJson<{ entries: unknown[] }>("t", [
      { directory: async () => actionsDir, fileName: actionsFileName("admin") },
    ]);
    return read.kind === "found" ? read.value.entries.length : -1;
  }

  test("a non-spill append writes the same bytes with no archive as with a huge archive, and never opens the archive", async () => {
    __setMaxActionEntriesForTests(20);
    __setActionLowWaterMarkForTests(10);
    const year = new Date().getFullYear();

    async function measureMarkerAppend(archiveCount: number) {
      const root = await seed(10, archiveCount); // live sits AT the low-water mark
      expect(await liveLength(root)).toBe(10); // so the marker (11th) cannot overflow the cap of 20
      const { dir, stats } = countWrites(root);
      await appendWorkspaceAction(dir, input("marker"));
      expect(await liveLength(root)).toBe(11);
      return stats;
    }

    const none = await measureMarkerAppend(0);
    const huge = await measureMarkerAppend(3_000);

    expect(none.bytes).toBeGreaterThan(0);
    // Bytes written per append do not depend on the archive's size.
    expect(Math.abs(huge.bytes - none.bytes)).toBeLessThanOrEqual(none.bytes * 0.02);
    // ...because the archive is not even opened for writing.
    expect(huge.opened.filter((n) => n.includes(`.actions.${year}.json`))).toEqual([]);
    expect(none.opened.filter((n) => n.includes(`.actions.${year}.json`))).toEqual([]);
  });

  test("the counter does see the archive being written on a spill append (sanity)", async () => {
    __setMaxActionEntriesForTests(20);
    __setActionLowWaterMarkForTests(10);
    const year = new Date().getFullYear();
    const root = await seed(20, 3_000); // the next append makes 21 > cap
    const { dir, stats } = countWrites(root);
    await appendWorkspaceAction(dir, input("spill"));
    expect(stats.opened.some((n) => n.includes(`.actions.${year}.json`))).toBe(true);
    expect(await liveLength(root)).toBe(10);
  });
});
