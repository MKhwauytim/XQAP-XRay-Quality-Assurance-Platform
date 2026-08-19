import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import { clearErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { createBackup } from "../backup/backupStorage";
import {
  __clearWorkspaceDirCacheForTests,
  getNotificationAcksDir,
  getNotificationsDir,
} from "../workspace/workspacePaths";
import {
  acceptNotification,
  loadNotifications,
  postNotification,
} from "./notificationStorage";
import { ackFileName, loadUserAcks } from "./notificationAckStorage";
import {
  getUnacceptedFor,
  hasAccepted,
  type AppNotification,
  type NotificationAcksFile,
  type NotificationsFile,
} from "./notificationTypes";

const SHARED_FILE = "notifications.json";

async function readRaw(dir: DirectoryHandleLike, fileName: string): Promise<string> {
  return (await (await dir.getFileHandle(fileName)).getFile()).text();
}

/** Write the shared broadcast file the way a pre-split client left it. */
async function writeSharedFile(root: DirectoryHandleLike, file: NotificationsFile): Promise<void> {
  await safeWriteJson(await getNotificationsDir(root, true), SHARED_FILE, file);
}

/** Write one employee's ack file directly (fixture for an already-split workspace). */
async function writeAckFile(root: DirectoryHandleLike, file: NotificationAcksFile): Promise<void> {
  await safeWriteJson(await getNotificationAcksDir(root, true), ackFileName(file.username), file);
}

function notification(
  id: string,
  acceptances: AppNotification["acceptances"] = []
): AppNotification {
  return {
    id,
    message: `تعميم ${id}`,
    postedBy: "manager1",
    postedAt: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
    acceptances,
  };
}

describe("notification acknowledgements — per-employee files", () => {
  beforeEach(() => {
    clearErrors();
    __clearWorkspaceDirCacheForTests();
  });

  it("writes NOTHING to the shared broadcast file when two employees acknowledge concurrently", async () => {
    // The XQ-IO-032 class this split exists for: acknowledgements used to be
    // appended into the one shared file, so every employee pressing "قبول" was
    // a writer on the file every other employee was also rewriting.
    const root = createMemoryDirectory("root", { trackOperations: true });
    await postNotification(root, { message: "تعميم مشترك", postedBy: "manager1" });
    const [posted] = await loadNotifications(root);
    expect(posted).toBeDefined();

    const notificationsDir = await getNotificationsDir(root, true);
    const sharedBefore = await readRaw(notificationsDir, SHARED_FILE);
    const opsBefore = getOperationLog(root).length;

    await Promise.all([
      acceptNotification(root, posted!.id, "employee_a"),
      acceptNotification(root, posted!.id, "employee_b"),
    ]);

    // 1. The shared file's bytes are untouched.
    expect(await readRaw(notificationsDir, SHARED_FILE)).toBe(sharedBefore);

    // 2. Not one write was even attempted against it — including safeWrite's
    //    `.tmp` staging and `.bak` rollback siblings, which all carry the
    //    shared file's name.
    const writes = getOperationLog(root)
      .slice(opsBefore)
      .filter((entry) => entry.operation === "createWritable");
    expect(writes.filter((entry) => entry.name.includes(SHARED_FILE))).toEqual([]);

    // 3. Each employee wrote his own file, and only his own.
    const written = new Set(writes.map((entry) => entry.name.replace(/\.(tmp|bak)$/, "")));
    expect(written).toEqual(new Set([ackFileName("employee_a"), ackFileName("employee_b")]));

    // 4. The merged read is what it always was: both acknowledgements present.
    const [merged] = await loadNotifications(root);
    expect(merged!.acceptances.map((a) => a.username).sort()).toEqual([
      "employee_a",
      "employee_b",
    ]);
  });

  it("renders a legacy-only workspace exactly as before — acceptances still inside the shared file", async () => {
    // A pin, not a fail-before test: this is the state every existing workspace
    // is in on the day this ships, and the merge must be a no-op for it. The
    // legacy entries are read forever and never rewritten or migrated.
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const legacy: NotificationsFile = {
      revision: 4,
      updatedAt: "2026-08-05T00:00:00.000Z",
      notifications: [
        notification("ntf-1", [{ username: "emp1", acceptedAt: "2026-08-02T09:00:00.000Z" }]),
        notification("ntf-2"),
      ],
    };
    await writeSharedFile(root, legacy);

    const list = await loadNotifications(root);
    expect(list).toEqual(legacy.notifications);
    expect(hasAccepted(list[0]!, "emp1")).toBe(true);
    expect(getUnacceptedFor(list, "emp1").map((n) => n.id)).toEqual(["ntf-2"]);
    expect(getUnacceptedFor(list, "emp2").map((n) => n.id)).toEqual(["ntf-1", "ntf-2"]);

    // Reading must not create the acks folder on a workspace that has none.
    await expect(getNotificationAcksDir(root, false)).rejects.toThrow();
  });

  it("merges a mixed workspace without duplicating a user recorded in both places", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await writeSharedFile(root, {
      revision: 7,
      updatedAt: "2026-08-05T00:00:00.000Z",
      notifications: [
        notification("ntf-1", [
          // emp1 is ALSO in his own ack file below — the overlap case.
          { username: "emp1", acceptedAt: "2026-08-02T09:00:00.000Z" },
          { username: "emp2", acceptedAt: "2026-08-02T10:00:00.000Z" },
        ]),
        notification("ntf-2"),
      ],
    });
    await writeAckFile(root, {
      revision: 2,
      username: "emp1",
      updatedAt: "2026-08-06T00:00:00.000Z",
      acks: [
        { notificationId: "ntf-1", acceptedAt: "2026-08-06T11:00:00.000Z" },
        { notificationId: "ntf-2", acceptedAt: "2026-08-06T11:00:01.000Z" },
      ],
    });
    await writeAckFile(root, {
      revision: 1,
      username: "emp3",
      updatedAt: "2026-08-06T00:00:00.000Z",
      acks: [{ notificationId: "ntf-1", acceptedAt: "2026-08-06T12:00:00.000Z" }],
    });

    const [first, second] = await loadNotifications(root);

    // emp1 appears once, and the legacy entry stays authoritative for him.
    expect(first!.acceptances).toHaveLength(3);
    expect(first!.acceptances.map((a) => a.username).sort()).toEqual(["emp1", "emp2", "emp3"]);
    expect(first!.acceptances.find((a) => a.username === "emp1")!.acceptedAt).toBe(
      "2026-08-02T09:00:00.000Z"
    );
    expect(second!.acceptances.map((a) => a.username)).toEqual(["emp1"]);

    expect(getUnacceptedFor([first!, second!], "emp1")).toHaveLength(0);
    expect(getUnacceptedFor([first!, second!], "emp3").map((n) => n.id)).toEqual(["ntf-2"]);
  });

  it("persists an acknowledgement in the employee's own file and reads it back after a reload", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await postNotification(root, { message: "تعميم", postedBy: "manager1" });
    const [posted] = await loadNotifications(root);

    const result = await acceptNotification(root, posted!.id, "employee_a");
    expect(result.ok).toBe(true);

    // A reload: fresh directory-handle resolution, nothing cached in this tab.
    __clearWorkspaceDirCacheForTests();

    const own = await loadUserAcks(root, "employee_a");
    expect(own.username).toBe("employee_a");
    expect(own.acks.map((a) => a.notificationId)).toEqual([posted!.id]);
    expect(Date.parse(own.acks[0]!.acceptedAt)).not.toBeNaN();

    // The file really is the per-employee one, and the shared file still shows
    // no acceptance of its own.
    const acksDir = await getNotificationAcksDir(root, false);
    expect(await readRaw(acksDir, ackFileName("employee_a"))).toContain(posted!.id);
    const sharedRaw = await readRaw(await getNotificationsDir(root, false), SHARED_FILE);
    expect(sharedRaw).not.toContain("employee_a");

    // And the merged view a reloaded app renders shows it accepted.
    const [reloaded] = await loadNotifications(root);
    expect(hasAccepted(reloaded!, "employee_a")).toBe(true);
    expect(getUnacceptedFor([reloaded!], "employee_a")).toHaveLength(0);
  });

  it("prunes only the writer's OWN dead acks, never another employee's file", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await writeSharedFile(root, {
      revision: 1,
      updatedAt: "2026-08-05T00:00:00.000Z",
      notifications: [notification("ntf-1")],
    });
    await acceptNotification(root, "ntf-1", "emp1");
    // emp2 acknowledged the same (soon-to-be-dropped) notification.
    await acceptNotification(root, "ntf-1", "emp2");
    const acksDir = await getNotificationAcksDir(root, false);
    const emp2Before = await readRaw(acksDir, ackFileName("emp2"));

    // The broadcast log rolls over (it keeps only the newest 500): ntf-1 is gone.
    await writeSharedFile(root, {
      revision: 2,
      updatedAt: "2026-08-07T00:00:00.000Z",
      notifications: [notification("ntf-2")],
    });
    await acceptNotification(root, "ntf-2", "emp1");

    // emp1 dropped his own orphaned ack while writing his own file.
    expect((await loadUserAcks(root, "emp1")).acks.map((a) => a.notificationId)).toEqual(["ntf-2"]);
    // emp2's file was not touched — not even to clean up the same dead ack.
    expect(await readRaw(acksDir, ackFileName("emp2"))).toBe(emp2Before);
    expect((await loadUserAcks(root, "emp2")).acks.map((a) => a.notificationId)).toEqual(["ntf-1"]);
  });

  it("is a no-op success when the notification is already acknowledged in a legacy shared-file entry", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await writeSharedFile(root, {
      revision: 1,
      updatedAt: "2026-08-05T00:00:00.000Z",
      notifications: [
        notification("ntf-1", [{ username: "emp1", acceptedAt: "2026-08-02T09:00:00.000Z" }]),
      ],
    });

    const result = await acceptNotification(root, "ntf-1", "emp1");

    expect(result.ok).toBe(true);
    // No redundant per-user file, and the legacy entry is left exactly as it is.
    await expect(getNotificationAcksDir(root, false)).rejects.toThrow();
    const [only] = await loadNotifications(root);
    expect(only!.acceptances).toEqual([{ username: "emp1", acceptedAt: "2026-08-02T09:00:00.000Z" }]);
  });

  it("answers the banner identically when scoped to one user, without reading anyone else's file", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await writeSharedFile(root, {
      revision: 1,
      updatedAt: "2026-08-05T00:00:00.000Z",
      notifications: [
        notification("ntf-1", [{ username: "emp2", acceptedAt: "2026-08-02T09:00:00.000Z" }]),
        notification("ntf-2"),
      ],
    });
    await writeAckFile(root, {
      revision: 1,
      username: "emp1",
      updatedAt: "2026-08-06T00:00:00.000Z",
      acks: [{ notificationId: "ntf-1", acceptedAt: "2026-08-06T11:00:00.000Z" }],
    });
    await writeAckFile(root, {
      revision: 1,
      username: "emp2",
      updatedAt: "2026-08-06T00:00:00.000Z",
      acks: [{ notificationId: "ntf-2", acceptedAt: "2026-08-06T11:00:00.000Z" }],
    });

    const scoped = await loadNotifications(root, { forUsername: "emp1" });
    const full = await loadNotifications(root);

    // What the banner and the unread badge actually ask is identical either way.
    expect(getUnacceptedFor(scoped, "emp1").map((n) => n.id)).toEqual(
      getUnacceptedFor(full, "emp1").map((n) => n.id)
    );
    expect(getUnacceptedFor(scoped, "emp1").map((n) => n.id)).toEqual(["ntf-2"]);
    // Legacy acceptances are still merged when scoped — only the per-user fan-out narrows.
    expect(hasAccepted(scoped[0]!, "emp2")).toBe(true);
    // …and emp2's ack FILE was deliberately not read, so his ntf-2 ack is absent
    // from the scoped view. That is why this option is banner-only.
    expect(hasAccepted(scoped[1]!, "emp2")).toBe(false);
    expect(hasAccepted(full[1]!, "emp2")).toBe(true);
  });

  it("is included in the backup walk", async () => {
    // Requirement 5: the new files must fall inside the existing snapshot walk.
    // They are `.json` under `5-system/notifications/acks/`, and the walk is a
    // recursive whole-tree sweep for `.json` — this pins that it stays true.
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await postNotification(root, { message: "تعميم", postedBy: "manager1" });
    const [posted] = await loadNotifications(root);
    await acceptNotification(root, posted!.id, "employee_a");

    const backup = await createBackup(root, [], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    expect(
      backup.manifest.jsonFilesBackedUp.some(
        (f) => f === `5-system/notifications/acks/${ackFileName("employee_a")}`
      )
    ).toBe(true);
    expect(
      backup.manifest.jsonFilesBackedUp.some((f) => f === `5-system/notifications/${SHARED_FILE}`)
    ).toBe(true);
  });
});
