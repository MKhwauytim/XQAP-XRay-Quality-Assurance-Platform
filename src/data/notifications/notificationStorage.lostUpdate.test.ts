import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import type { NotificationsFile } from "./notificationTypes";
import {
  acceptNotification,
  loadNotifications,
  postNotification,
} from "./notificationStorage";

/**
 * The lost-update interleaving `casLoop` documents and `notificationStorage`'s
 * own module comment promises to survive: A reads, B reads, A commits and
 * verifies its own read-back, THEN B commits over it. A's in-attempt read-back
 * cannot see a write that lands after it, so only the delayed `verify` re-read
 * catches the clobber — without it A's acceptance is gone from the file while
 * `acceptNotification` still reports success and A's banner hides for good.
 *
 * `withResourceLock` serializes writers inside one tab, so the interleaving is
 * reproduced the way it happens in production — two machines on the same shared
 * folder — by letting machine B's commit land from outside the loop, at the one
 * moment that matters: right after machine A's in-attempt read-back.
 */
const hooks = vi.hoisted(() => ({
  reads: 0,
  afterReadNumber: 0,
  afterRead: null as null | (() => Promise<void>),
}));

vi.mock("../storage/safeWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/safeWrite")>();
  return {
    ...actual,
    readOptionalJson: async (
      context: Parameters<typeof actual.readOptionalJson>[0],
      locations: Parameters<typeof actual.readOptionalJson>[1],
      options?: Parameters<typeof actual.readOptionalJson>[2],
    ) => {
      const result = await actual.readOptionalJson(context, locations, options);
      hooks.reads += 1;
      if (hooks.afterRead && hooks.reads === hooks.afterReadNumber) {
        const hook = hooks.afterRead;
        hooks.afterRead = null;
        await hook();
      }
      return result;
    },
  };
});

describe("notificationStorage — lost update across two machines", () => {
  beforeEach(() => {
    hooks.reads = 0;
    hooks.afterReadNumber = 0;
    hooks.afterRead = null;
  });

  it("retries instead of reporting success when a competing machine clobbers the acceptance", async () => {
    const { safeWriteJson } = await vi.importActual<
      typeof import("../storage/safeWrite")
    >("../storage/safeWrite");

    const root = createMemoryDirectory("root");
    await postNotification(root, { message: "تعميم", postedBy: "manager1" });
    const [notification] = await loadNotifications(root);
    expect(notification).toBeDefined();

    const systemDir = await getSystemRoot(root, true);
    const notificationsDir = await systemDir.getDirectoryHandle(
      SYSTEM_FOLDER_NAMES.notifications,
      { create: true },
    );

    // Machine B read the same base state as A (revision 1) and commits its own
    // revision 2 — carrying only its own acceptance — a moment after A's write
    // and read-back, i.e. once A already believes it has won.
    hooks.reads = 0;
    hooks.afterReadNumber = 2; // 1 = A's base read, 2 = A's in-attempt read-back
    hooks.afterRead = async () => {
      const clobbered: NotificationsFile = {
        revision: 2,
        _writeToken: "machine-b-write-token",
        updatedAt: new Date().toISOString(),
        notifications: [
          {
            ...notification!,
            acceptances: [
              { username: "userB", acceptedAt: new Date().toISOString() },
            ],
          },
        ],
      };
      await safeWriteJson(notificationsDir, "notifications.json", clobbered);
    };

    const result = await acceptNotification(root, notification!.id, "userA");
    expect(result.ok).toBe(true);

    // Reporting success must mean the acceptance is actually on disk.
    const [stored] = await loadNotifications(root);
    expect(stored!.acceptances.map((a) => a.username).sort()).toEqual([
      "userA",
      "userB",
    ]);
  });
});
