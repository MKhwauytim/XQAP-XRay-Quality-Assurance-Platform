import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  getNotificationAcksDir,
  getNotificationsDir,
} from "../workspace/workspacePaths";
import type { NotificationAcksFile, NotificationsFile } from "./notificationTypes";
import { ackFileName, loadUserAcks } from "./notificationAckStorage";
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
 * catches the clobber — without it A's write is gone from the file while the
 * call still reports success.
 *
 * **What this file guards after the per-employee ack split.** Acknowledgements
 * no longer touch the shared broadcast file, so the original scenario (two
 * employees racing on `notifications.json`) cannot happen any more — that is
 * now proven the other way round, by
 * `notificationAckStorage.test.ts`'s "writes NOTHING to the shared broadcast
 * file" test. The delayed-verify contract still has two live writers, and both
 * are pinned below:
 *
 *   1. the shared broadcast file — still whole-file, still cross-machine, now
 *      written only by admins/managers POSTING (`postNotification`);
 *   2. one employee's own ack file — still whole-file, and still reachable from
 *      two of HIS OWN tabs/machines on the same shared folder.
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

  it("retries instead of reporting success when a competing machine clobbers a posted broadcast", async () => {
    const { safeWriteJson } = await vi.importActual<
      typeof import("../storage/safeWrite")
    >("../storage/safeWrite");

    const root = createMemoryDirectory("root");
    await postNotification(root, { message: "تعميم أول", postedBy: "manager1" });
    const [first] = await loadNotifications(root);
    expect(first).toBeDefined();

    const notificationsDir = await getNotificationsDir(root, true);

    // Machine B read the same base state as A (revision 1) and commits its own
    // revision 2 — carrying only its own notification — a moment after A's write
    // and read-back, i.e. once A already believes it has won.
    hooks.reads = 0;
    hooks.afterReadNumber = 2; // 1 = A's base read, 2 = A's in-attempt read-back
    hooks.afterRead = async () => {
      const clobbered: NotificationsFile = {
        revision: 2,
        _writeToken: "machine-b-write-token",
        updatedAt: new Date().toISOString(),
        notifications: [
          first!,
          {
            id: "ntf-from-machine-b",
            message: "تعميم من جهاز آخر",
            postedBy: "manager2",
            postedAt: new Date().toISOString(),
            acceptances: [],
          },
        ],
      };
      await safeWriteJson(notificationsDir, "notifications.json", clobbered);
    };

    const result = await postNotification(root, { message: "تعميم ثانٍ", postedBy: "manager1" });
    expect(result.ok).toBe(true);

    // Reporting success must mean the broadcast is actually on disk — alongside
    // the competing machine's, not instead of it.
    const stored = await loadNotifications(root);
    expect(stored.map((n) => n.message).sort()).toEqual([
      "تعميم أول",
      "تعميم من جهاز آخر",
      "تعميم ثانٍ",
    ].sort());
  });

  it("retries instead of reporting success when the user's OTHER machine clobbers his own ack file", async () => {
    const { safeWriteJson } = await vi.importActual<
      typeof import("../storage/safeWrite")
    >("../storage/safeWrite");

    const root = createMemoryDirectory("root");
    await postNotification(root, { message: "تعميم أول", postedBy: "manager1" });
    await postNotification(root, { message: "تعميم ثانٍ", postedBy: "manager1" });
    await postNotification(root, { message: "تعميم ثالث", postedBy: "manager1" });
    const [first, second, third] = await loadNotifications(root);
    // Seed the file so the clobber below is a plausible revision-2 successor.
    await acceptNotification(root, first!.id, "employee_a");

    const acksDir = await getNotificationAcksDir(root, true);

    // employee_a's second tab read the same base state (revision 1, holding his
    // acknowledgement of `first`) and commits its own acknowledgement of `third`
    // a moment after this tab's write and read-back.
    hooks.reads = 0;
    // 1 = the broadcast base read, 2 = the ack file's base read,
    // 3 = the ack file's in-attempt read-back.
    hooks.afterReadNumber = 3;
    hooks.afterRead = async () => {
      const clobbered: NotificationAcksFile = {
        revision: 3,
        _writeToken: "other-tab-write-token",
        username: "employee_a",
        updatedAt: new Date().toISOString(),
        acks: [
          { notificationId: first!.id, acceptedAt: new Date().toISOString() },
          { notificationId: third!.id, acceptedAt: new Date().toISOString() },
        ],
      };
      await safeWriteJson(acksDir, ackFileName("employee_a"), clobbered);
    };

    const result = await acceptNotification(root, second!.id, "employee_a");
    expect(result.ok).toBe(true);

    // Every acknowledgement survives: the retry re-reads the other tab's file
    // and folds this one in rather than replacing it.
    const own = await loadUserAcks(root, "employee_a");
    expect(own.acks.map((a) => a.notificationId).sort()).toEqual(
      [first!.id, second!.id, third!.id].sort()
    );
    const merged = await loadNotifications(root);
    expect(merged.every((n) => n.acceptances.some((a) => a.username === "employee_a"))).toBe(true);
  });
});
