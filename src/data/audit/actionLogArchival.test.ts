import { afterEach, describe, expect, test } from "vitest";

import { createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAuditActionsDir } from "../workspace/workspacePaths";
import { actionsFileName } from "./auditPaths";
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

describe("audit log archival — P1 hysteresis (progressive-slowdown.md cause #2)", () => {
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

  test("live-file write size for a non-overflowing append does not grow with archive size", async () => {
    __setMaxActionEntriesForTests(5);
    __setActionLowWaterMarkForTests(3);

    async function liveFileWriteBytes(dir: DirectoryHandleLike, seedAppends: number): Promise<number> {
      for (let i = 1; i <= seedAppends; i += 1) {
        await appendWorkspaceAction(dir, input(`seed${i}`));
      }
      const actionsDir = await getAuditActionsDir(dir, false);
      const handle = await actionsDir.getFileHandle(actionsFileName("admin"), { create: false });
      const before = (await (await handle.getFile()).text()).length;
      // One more append that does NOT push the live log past the cap (it sits
      // at the low-water mark right after a hysteresis trim).
      await appendWorkspaceAction(dir, input("marker"));
      const after = (await (await handle.getFile()).text()).length;
      return after - before;
    }

    const smallArchiveDelta = await liveFileWriteBytes(createMemoryDirectory(), 4);
    const largeArchiveDelta = await liveFileWriteBytes(createMemoryDirectory(), 44);

    // Both deltas are the cost of ONE more entry in the live file; a large
    // archive (44 seeded vs. 4) must not inflate it.
    expect(largeArchiveDelta).toBeLessThanOrEqual(smallArchiveDelta * 2);
  });
});
