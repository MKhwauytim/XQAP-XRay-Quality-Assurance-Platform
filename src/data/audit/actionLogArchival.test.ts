import { afterEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  __resetMaxActionEntriesForTests,
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
 * Wrap a directory so writes to any `actions.archive.*.json` fail — used to
 * verify that an archive failure blocks the live-log trim.
 */
function wrapArchiveFailing(dir: DirectoryHandleLike): DirectoryHandleLike {
  return {
    ...dir,
    kind: "directory",
    name: dir.name,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (name.startsWith("actions.archive.")) {
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
