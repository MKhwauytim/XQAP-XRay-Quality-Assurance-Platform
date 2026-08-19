import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { getNotificationAcksDir } from "../workspace/workspacePaths";
import type { NotificationAcksFile } from "./notificationTypes";
import { ackFileName, loadUserAcks } from "./notificationAckStorage";
import {
  acceptNotification,
  loadNotifications,
  postNotification,
} from "./notificationStorage";

/**
 * The single-owner prune filters an employee's own ack list against the ids the
 * broadcast log held when `acceptNotification` read it — ONE snapshot, taken
 * before the CAS loop and re-applied on every attempt.
 *
 * That is fine for the acks the loop started with, and wrong for an ack that
 * arrives DURING it. A notification posted after the snapshot, acknowledged from
 * this same user's other client, lands in his file while the loop retries; the
 * snapshot could not possibly contain that id, so the retry read it as dead and
 * deleted a real acknowledgement the user had just made — the banner comes back
 * and the roster shows him as never having acknowledged it.
 *
 * The interleaving is reproduced the way the lost-update test reproduces its
 * own: by letting the other client's commit land from outside the loop, right
 * after this one's in-attempt read-back, which is exactly what forces the retry.
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

describe("notification ack prune — an ack newer than the snapshot", () => {
  beforeEach(() => {
    hooks.reads = 0;
    hooks.afterReadNumber = 0;
    hooks.afterRead = null;
  });

  it("survives the retry that re-applies the stale live-id snapshot", async () => {
    const { safeWriteJson } = await vi.importActual<
      typeof import("../storage/safeWrite")
    >("../storage/safeWrite");

    const root = createMemoryDirectory("root");
    await postNotification(root, { message: "تعميم أول", postedBy: "manager1" });
    await postNotification(root, { message: "تعميم ثانٍ", postedBy: "manager1" });
    const [first, second] = await loadNotifications(root);
    // employee_a already acknowledged the first one.
    await acceptNotification(root, first!.id, "employee_a");

    const acksDir = await getNotificationAcksDir(root, true);

    hooks.reads = 0;
    // 1 = the broadcast base read that TAKES the snapshot ({first, second}),
    // 2 = the ack file's base read, 3 = the ack file's in-attempt read-back.
    hooks.afterReadNumber = 3;
    hooks.afterRead = async () => {
      // A third notification is posted — after the snapshot, so its id is not in
      // it — and employee_a's other client acknowledges it, clobbering the ack
      // file this tab just wrote and so forcing the retry below.
      await postNotification(root, { message: "تعميم ثالث", postedBy: "manager1" });
      const third = (await loadNotifications(root)).at(-1)!;
      const fromOtherClient: NotificationAcksFile = {
        revision: 3,
        _writeToken: "other-client-write-token",
        username: "employee_a",
        updatedAt: new Date().toISOString(),
        acks: [
          { notificationId: first!.id, acceptedAt: "2026-08-01T00:00:00.000Z" },
          { notificationId: third.id, acceptedAt: new Date().toISOString() },
        ],
      };
      await safeWriteJson(acksDir, ackFileName("employee_a"), fromOtherClient);
    };

    const result = await acceptNotification(root, second!.id, "employee_a");
    expect(result.ok).toBe(true);

    const third = (await loadNotifications(root)).at(-1)!;
    const own = await loadUserAcks(root, "employee_a");

    // The ack the retry could not have known about is still there.
    expect(own.acks.map((a) => a.notificationId).sort()).toEqual(
      [first!.id, second!.id, third.id].sort()
    );
    // …and it is the ORIGINAL acknowledgement, not a re-created one.
    const merged = await loadNotifications(root);
    expect(merged.every((n) => n.acceptances.some((a) => a.username === "employee_a"))).toBe(true);
  });

  it("still prunes an ack that is genuinely older than the snapshot and gone from the log", async () => {
    // The guard must not turn the prune off: only acks at least as new as the
    // snapshot read escape it, and a real orphan is not one of those.
    const root = createMemoryDirectory("root");
    await postNotification(root, { message: "تعميم أول", postedBy: "manager1" });
    const [live] = await loadNotifications(root);

    const acksDir = await getNotificationAcksDir(root, true);
    const { safeWriteJson } = await vi.importActual<
      typeof import("../storage/safeWrite")
    >("../storage/safeWrite");
    await safeWriteJson(acksDir, ackFileName("employee_a"), {
      revision: 1,
      username: "employee_a",
      updatedAt: "2026-08-01T00:00:00.000Z",
      acks: [{ notificationId: "ntf-rolled-out-of-the-log", acceptedAt: "2026-08-01T00:00:00.000Z" }],
    } satisfies NotificationAcksFile);

    await acceptNotification(root, live!.id, "employee_a");

    expect((await loadUserAcks(root, "employee_a")).acks.map((a) => a.notificationId)).toEqual([
      live!.id,
    ]);
  });
});
