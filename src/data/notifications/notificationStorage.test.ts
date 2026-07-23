import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { clearErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import {
  acceptNotification,
  loadNotifications,
  postNotification,
} from "./notificationStorage";
import {
  getUnacceptedFor,
  hasAccepted,
  isNotificationAudienceRole,
  shouldShowBanner,
} from "./notificationTypes";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("notificationStorage", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("posts a notification and reads it back", async () => {
    const root = makeRoot();
    const result = await postNotification(root, {
      message: "اجتماع الجودة غداً الساعة العاشرة",
      postedBy: "manager1",
    });
    expect(result.ok).toBe(true);

    const list = await loadNotifications(root);
    expect(list).toHaveLength(1);
    expect(list[0]!.message).toBe("اجتماع الجودة غداً الساعة العاشرة");
    expect(list[0]!.postedBy).toBe("manager1");
    expect(list[0]!.acceptances).toEqual([]);
    expect(list[0]!.id).toMatch(/^ntf-/);
    expect(Date.parse(list[0]!.postedAt)).not.toBeNaN();
  });

  it("rejects an empty message", async () => {
    const root = makeRoot();
    const result = await postNotification(root, { message: "   ", postedBy: "admin" });
    expect(result.ok).toBe(false);
    expect(await loadNotifications(root)).toHaveLength(0);
  });

  it("records acceptance for one user only, leaving others unaffected", async () => {
    const root = makeRoot();
    await postNotification(root, { message: "تعميم مهم", postedBy: "manager1" });
    const [notification] = await loadNotifications(root);

    await acceptNotification(root, notification!.id, "employee_a");

    const list = await loadNotifications(root);
    const n = list[0]!;
    expect(n.acceptances).toHaveLength(1);
    expect(hasAccepted(n, "employee_a")).toBe(true);
    // Another audience user is still pending.
    expect(hasAccepted(n, "employee_b")).toBe(false);
    expect(getUnacceptedFor(list, "employee_b")).toHaveLength(1);
    expect(getUnacceptedFor(list, "employee_a")).toHaveLength(0);
  });

  it("accepting is idempotent per user", async () => {
    const root = makeRoot();
    await postNotification(root, { message: "تنبيه", postedBy: "admin" });
    const [notification] = await loadNotifications(root);

    await acceptNotification(root, notification!.id, "employee_a");
    await acceptNotification(root, notification!.id, "employee_a");

    const list = await loadNotifications(root);
    expect(list[0]!.acceptances).toHaveLength(1);
  });

  it("banner-visibility logic depends on audience role AND acceptance state", async () => {
    const root = makeRoot();
    await postNotification(root, { message: "أول", postedBy: "manager1" });
    await postNotification(root, { message: "ثانٍ", postedBy: "manager1" });
    let list = await loadNotifications(root);

    // Audience roles with unaccepted notifications see the banner.
    expect(shouldShowBanner("employee", "emp1", list)).toBe(true);
    expect(shouldShowBanner("supervisor", "sup1", list)).toBe(true);
    // Non-audience roles never see the banner even with unaccepted notifications.
    expect(shouldShowBanner("manager", "manager1", list)).toBe(false);
    expect(shouldShowBanner("admin", "admin", list)).toBe(false);
    expect(shouldShowBanner("guest", "guest", list)).toBe(false);
    expect(isNotificationAudienceRole("employee")).toBe(true);
    expect(isNotificationAudienceRole("manager")).toBe(false);

    // Oldest is shown first.
    expect(getUnacceptedFor(list, "emp1")[0]!.message).toBe("أول");

    // After emp1 accepts both, the banner hides for emp1 but not sup1.
    for (const n of list) {
      await acceptNotification(root, n.id, "emp1");
    }
    list = await loadNotifications(root);
    expect(shouldShowBanner("employee", "emp1", list)).toBe(false);
    expect(shouldShowBanner("supervisor", "sup1", list)).toBe(true);
  });

  it("supports the manager who-accepted view across many users", async () => {
    const root = makeRoot();
    await postNotification(root, { message: "تعميم", postedBy: "manager1" });
    const [notification] = await loadNotifications(root);
    await acceptNotification(root, notification!.id, "emp1");
    await acceptNotification(root, notification!.id, "sup1");

    const audience = ["emp1", "emp2", "sup1"];
    const list = await loadNotifications(root);
    const n = list[0]!;
    const accepted = audience.filter((u) => hasAccepted(n, u));
    const pending = audience.filter((u) => !hasAccepted(n, u));
    expect(accepted.sort()).toEqual(["emp1", "sup1"]);
    expect(pending).toEqual(["emp2"]);
  });

  it("keeps both acceptances when two users accept the same notification concurrently", async () => {
    const root = makeRoot();
    await postNotification(root, { message: "سباق", postedBy: "manager1" });
    const [notification] = await loadNotifications(root);

    // Two writers on the shared folder accept near-simultaneously.
    await Promise.all([
      acceptNotification(root, notification!.id, "employee_a"),
      acceptNotification(root, notification!.id, "employee_b"),
    ]);

    const list = await loadNotifications(root);
    const n = list[0]!;
    expect(n.acceptances.map((a) => a.username).sort()).toEqual([
      "employee_a",
      "employee_b",
    ]);
  });

  it("keeps both notifications when two managers post concurrently", async () => {
    const root = makeRoot();
    await Promise.all([
      postNotification(root, { message: "من المدير أ", postedBy: "manager_a" }),
      postNotification(root, { message: "من المدير ب", postedBy: "manager_b" }),
    ]);
    const list = await loadNotifications(root);
    expect(list.map((n) => n.message).sort()).toEqual(["من المدير أ", "من المدير ب"]);
  });

  it("requests write permission before creating the notifications folder, on a freshly-restored read-only workspace", async () => {
    // A remembered workspace (PR #36) opens with read permission only; the first
    // notification write must request write access itself — via the one-click
    // browser prompt — rather than assuming it already holds it. Regression test
    // for the withWorkspaceWriteAccess gap (mirrors populationStorage.test.ts /
    // exportWriter.test.ts for the same class of bug).
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "granted",
    });

    const result = await postNotification(root, {
      message: "تعميم بعد إعادة الاتصال بمساحة العمل",
      postedBy: "manager1",
    });

    expect(result.ok).toBe(true);
    const list = await loadNotifications(root);
    expect(list).toHaveLength(1);
    expect(list[0]!.message).toBe("تعميم بعد إعادة الاتصال بمساحة العمل");
  });

  it("fails with the Arabic permission-required message, not casLoop's misleading reconnect message, when write access is declined", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "denied",
    });

    const result = await postNotification(root, { message: "تعميم", postedBy: "manager1" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(new WorkspacePermissionError().message);
    // Must NOT be casLoop's terminal "access lost, reconnect" message — that
    // would wrongly tell a merely-not-yet-granted user to reconnect the whole
    // workspace instead of just accepting the one-click permission prompt.
    expect(result.error).not.toBe("فقد الوصول إلى مجلد العمل — أعد الاتصال بمساحة العمل.");

    // Nothing should have been created — declined before any folder was made.
    await expect(
      root.getDirectoryHandle("5-system", { create: false })
    ).rejects.toThrow();
    expect(await loadNotifications(root)).toHaveLength(0);
  });
});
