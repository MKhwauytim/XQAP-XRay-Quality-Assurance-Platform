/**
 * Archive-before-trim for the notifications file (owner directive,
 * 2026-08-19), mirroring `audit/actionLogArchival.test.ts`'s coverage of the
 * same A6 pattern in `actionLog.ts`: overflow is archived by year BEFORE the
 * live file is trimmed, a retry never double-archives, and a failing archive
 * write blocks the trim so nothing is ever dropped unarchived.
 */
import { afterEach, describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  __resetMaxNotificationsForTests,
  __setMaxNotificationsForTests,
  loadNotifications,
  postNotification,
  readNotificationsArchive,
} from "./notificationStorage";

afterEach(() => {
  __resetMaxNotificationsForTests();
});

/**
 * Wrap a directory so writes to any per-year notifications archive file fail
 * — used to verify that an archive failure blocks the live-file trim.
 */
const ARCHIVE_FILE_PATTERN = /^notifications\.archive\.\d{4}\.json$/;

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

describe("notificationStorage — archive-before-trim (A6)", () => {
  test("overflow lands in the per-year archive; the live file is trimmed to the cap", async () => {
    __setMaxNotificationsForTests(3);
    const root = createMemoryDirectory("root") as DirectoryHandleLike;

    for (let i = 1; i <= 5; i += 1) {
      await postNotification(root, { message: `n${i}`, postedBy: "admin" });
    }

    const live = await loadNotifications(root);
    expect(live.map((n) => n.message)).toEqual(["n3", "n4", "n5"]);

    const year = new Date().getFullYear();
    const archived = await readNotificationsArchive(root, year);
    expect(archived.map((n) => n.message)).toEqual(["n1", "n2"]);
  });

  test("a retry (re-run) does not duplicate already-archived ids", async () => {
    __setMaxNotificationsForTests(3);
    const root = createMemoryDirectory("root") as DirectoryHandleLike;

    for (let i = 1; i <= 5; i += 1) {
      await postNotification(root, { message: `n${i}`, postedBy: "admin" });
    }
    const year = new Date().getFullYear();
    const firstArchive = await readNotificationsArchive(root, year);
    expect(firstArchive.map((n) => n.message)).toEqual(["n1", "n2"]);

    // Another overflow-triggering write. archiveOverflow re-reads the archive
    // and only appends ids it has not already seen — the earlier two entries
    // must not be duplicated.
    await postNotification(root, { message: "n6", postedBy: "admin" });

    const secondArchive = await readNotificationsArchive(root, year);
    expect(secondArchive.map((n) => n.message)).toEqual(["n1", "n2", "n3"]);
    // No id appears twice.
    expect(new Set(secondArchive.map((n) => n.id)).size).toBe(secondArchive.length);
  });

  test("archive-write failure blocks the trim — no notification is dropped", async () => {
    __setMaxNotificationsForTests(3);
    const root = wrapArchiveFailing(createMemoryDirectory("root") as DirectoryHandleLike);

    for (let i = 1; i <= 5; i += 1) {
      await postNotification(root, { message: `n${i}`, postedBy: "admin" });
    }

    // Trim was blocked because archival failed: the live file keeps ALL
    // entries (over cap) rather than dropping the oldest without archiving.
    const live = await loadNotifications(root);
    expect(live.map((n) => n.message)).toEqual(["n1", "n2", "n3", "n4", "n5"]);

    const year = new Date().getFullYear();
    const archived = await readNotificationsArchive(root, year);
    expect(archived).toHaveLength(0);
  });
});
