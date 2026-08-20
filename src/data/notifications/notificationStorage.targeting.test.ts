// Storage-level coverage for the targeted-publishing pass: posting with each
// `NotificationTarget`, editing a posted notification in place, and the
// delete → "تراجع" round trip.
//
// The load-bearing property here is the restore contract: a restored
// notification comes back under its ORIGINAL id, so acknowledgements already
// written to `acks/{username}.acks.json` — which are keyed by that id and are
// never touched by a delete — re-attach on the next read. That is what makes a
// delete + undo invisible to a reader who had already acknowledged, instead of
// asking him again. It is asserted end to end (accept → delete → restore),
// because a restore that minted a fresh id would still look correct in every
// single-step assertion.
import { beforeEach, describe, expect, it } from "vitest";

import { clearErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  acceptNotification,
  deleteNotification,
  loadNotifications,
  postNotification,
  restoreNotification,
  updateNotificationMessage,
} from "./notificationStorage";
import { hasAccepted, notificationTarget, type AppNotification } from "./notificationTypes";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

async function postAndRead(
  root: DirectoryHandleLike,
  params: Parameters<typeof postNotification>[1]
): Promise<AppNotification> {
  const result = await postNotification(root, params);
  expect(result.ok).toBe(true);
  const list = await loadNotifications(root);
  const posted = list.find((n) => n.message === params.message.trim());
  expect(posted).toBeDefined();
  return posted!;
}

beforeEach(() => {
  clearErrors();
});

describe("postNotification targeting", () => {
  it("defaults an untargeted post to \"all\" rather than leaving the field absent", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "للجميع", postedBy: "mgr-1" });
    expect(posted.target).toBe("all");
    expect(posted.audience).toBeUndefined();
  });

  it("stores the role targets verbatim and carries no audience list for them", async () => {
    const root = makeRoot();
    const employees = await postAndRead(root, {
      message: "للموظفين",
      postedBy: "mgr-1",
      target: "employees",
    });
    const supervisors = await postAndRead(root, {
      message: "للمشرفين",
      postedBy: "mgr-1",
      target: "supervisors",
    });

    expect(employees.target).toBe("employees");
    expect(employees.audience).toBeUndefined();
    expect(supervisors.target).toBe("supervisors");
    expect(supervisors.audience).toBeUndefined();
  });

  it("stores the named usernames for a custom post", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, {
      message: "لأشخاص محددين",
      postedBy: "mgr-1",
      target: "custom",
      audience: ["emp1", "sup1"],
    });
    expect(posted.target).toBe("custom");
    expect(posted.audience).toEqual(["emp1", "sup1"]);
  });

  it("drops an audience list supplied alongside a non-custom target", async () => {
    // Otherwise a stale picker selection would be persisted as a list that
    // nothing reads — and would come back the moment the target was edited
    // to "custom".
    const root = makeRoot();
    const posted = await postAndRead(root, {
      message: "للموظفين مع قائمة عالقة",
      postedBy: "mgr-1",
      target: "employees",
      audience: ["emp1"],
    });
    expect(posted.audience).toBeUndefined();
  });

  it("rejects a custom post with an empty audience, writing nothing", async () => {
    const root = makeRoot();
    for (const audience of [undefined, [], ["", "   "].slice(0, 1)]) {
      const result = await postNotification(root, {
        message: "بلا مستلمين",
        postedBy: "mgr-1",
        target: "custom",
        audience,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("اختر مستلماً واحداً على الأقل قبل النشر.");
    }
    // A notification nobody can read would sit in the list forever at 0/0.
    expect(await loadNotifications(root)).toHaveLength(0);
  });

  it("rejects a custom post whose audience holds only empty entries", async () => {
    const root = makeRoot();
    const result = await postNotification(root, {
      message: "أسماء فارغة",
      postedBy: "mgr-1",
      target: "custom",
      audience: ["", ""],
    });
    expect(result.ok).toBe(false);
    expect(await loadNotifications(root)).toHaveLength(0);
  });
});

describe("updateNotificationMessage", () => {
  it("preserves id, postedAt, postedBy and every acknowledgement, and stamps editedAt", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "النص الأصلي", postedBy: "mgr-1" });
    await acceptNotification(root, posted.id, "emp1");

    const result = await updateNotificationMessage(root, posted.id, { message: "  النص المصحح  " });
    expect(result.ok).toBe(true);

    const [edited] = await loadNotifications(root);
    expect(edited!.id).toBe(posted.id);
    expect(edited!.postedAt).toBe(posted.postedAt);
    expect(edited!.postedBy).toBe("mgr-1");
    expect(edited!.message).toBe("النص المصحح");
    // An edit corrects the wording of the same broadcast; it does not re-issue
    // it, so emp1 is NOT asked to acknowledge again.
    expect(hasAccepted(edited!, "emp1")).toBe(true);
    expect(edited!.editedAt).toBeDefined();
    expect(Date.parse(edited!.editedAt!)).not.toBeNaN();
  });

  it("leaves editedAt absent on a notification that was never edited", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "بلا تعديل", postedBy: "mgr-1" });
    expect(posted.editedAt).toBeUndefined();
  });

  it("retargets the notification when a target is supplied", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "نص", postedBy: "mgr-1" });

    expect(
      (await updateNotificationMessage(root, posted.id, {
        message: "نص",
        target: "custom",
        audience: ["emp2"],
      })).ok
    ).toBe(true);
    let [edited] = await loadNotifications(root);
    expect(notificationTarget(edited!)).toBe("custom");
    expect(edited!.audience).toEqual(["emp2"]);

    // Moving back off "custom" must clear the stale name list.
    expect((await updateNotificationMessage(root, posted.id, { message: "نص", target: "employees" })).ok).toBe(true);
    [edited] = await loadNotifications(root);
    expect(notificationTarget(edited!)).toBe("employees");
    expect(edited!.audience).toBeUndefined();
  });

  it("leaves the target untouched when none is supplied", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, {
      message: "نص",
      postedBy: "mgr-1",
      target: "supervisors",
    });
    expect((await updateNotificationMessage(root, posted.id, { message: "نص جديد" })).ok).toBe(true);
    const [edited] = await loadNotifications(root);
    expect(notificationTarget(edited!)).toBe("supervisors");
  });

  it("rejects an empty message and an empty custom audience without writing", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "الأصلي", postedBy: "mgr-1" });

    const emptyMessage = await updateNotificationMessage(root, posted.id, { message: "   " });
    expect(emptyMessage.ok).toBe(false);

    const emptyAudience = await updateNotificationMessage(root, posted.id, {
      message: "نص",
      target: "custom",
      audience: [],
    });
    expect(emptyAudience.ok).toBe(false);
    if (!emptyAudience.ok) expect(emptyAudience.error).toBe("اختر مستلماً واحداً على الأقل قبل الحفظ.");

    const [unchanged] = await loadNotifications(root);
    expect(unchanged!.message).toBe("الأصلي");
    expect(unchanged!.editedAt).toBeUndefined();
  });

  it("reports a notification another user already deleted instead of silently succeeding", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, { message: "سيُحذف", postedBy: "mgr-1" });
    expect((await deleteNotification(root, posted.id)).ok).toBe(true);

    const result = await updateNotificationMessage(root, posted.id, { message: "تعديل متأخر" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("الإشعار لم يعد موجوداً — ربما حذفه مستخدم آخر.");
  });

  it("edits only the named notification", async () => {
    const root = makeRoot();
    const first = await postAndRead(root, { message: "الأول", postedBy: "mgr-1" });
    await postAndRead(root, { message: "الثاني", postedBy: "mgr-1" });

    expect((await updateNotificationMessage(root, first.id, { message: "الأول المعدّل" })).ok).toBe(true);

    const list = await loadNotifications(root);
    expect(list.map((n) => n.message).sort()).toEqual(["الأول المعدّل", "الثاني"]);
    expect(list.find((n) => n.message === "الثاني")!.editedAt).toBeUndefined();
  });
});

describe("deleteNotification", () => {
  it("removes only the named record", async () => {
    const root = makeRoot();
    const first = await postAndRead(root, { message: "الأول", postedBy: "mgr-1" });
    await postAndRead(root, { message: "الثاني", postedBy: "mgr-1" });
    await postAndRead(root, { message: "الثالث", postedBy: "mgr-1" });

    expect((await deleteNotification(root, first.id)).ok).toBe(true);

    const list = await loadNotifications(root);
    expect(list.map((n) => n.message).sort()).toEqual(["الثالث", "الثاني"]);
    expect(list.some((n) => n.id === first.id)).toBe(false);
  });

  it("is a no-op that still reports success for an id that is already gone", async () => {
    const root = makeRoot();
    await postAndRead(root, { message: "باقٍ", postedBy: "mgr-1" });
    expect((await deleteNotification(root, "ntf-does-not-exist")).ok).toBe(true);
    expect(await loadNotifications(root)).toHaveLength(1);
  });
});

describe("restoreNotification (the delete toast's تراجع)", () => {
  it("puts the record back under its ORIGINAL id so recorded acknowledgements re-attach", async () => {
    const root = makeRoot();
    const posted = await postAndRead(root, {
      message: "تعميم مهم",
      postedBy: "mgr-1",
      target: "custom",
      audience: ["emp1", "emp2"],
    });

    // emp1 acknowledges. The ack lands in HIS ack file, keyed by this id.
    expect((await acceptNotification(root, posted.id, "emp1")).ok).toBe(true);
    const beforeDelete = (await loadNotifications(root))[0]!;
    expect(hasAccepted(beforeDelete, "emp1")).toBe(true);

    // The manager deletes it, then immediately undoes the delete.
    expect((await deleteNotification(root, beforeDelete.id)).ok).toBe(true);
    expect(await loadNotifications(root)).toHaveLength(0);

    expect((await restoreNotification(root, beforeDelete)).ok).toBe(true);

    const restored = (await loadNotifications(root))[0]!;
    expect(restored.id).toBe(posted.id);
    expect(restored.message).toBe("تعميم مهم");
    expect(restored.postedAt).toBe(posted.postedAt);
    expect(restored.postedBy).toBe("mgr-1");
    expect(notificationTarget(restored)).toBe("custom");
    expect(restored.audience).toEqual(["emp1", "emp2"]);
    // The whole point: emp1 is not asked to acknowledge it a second time.
    // A restore that minted a fresh id would leave this false.
    expect(hasAccepted(restored, "emp1")).toBe(true);
    expect(hasAccepted(restored, "emp2")).toBe(false);
  });

  it("keeps one employee's acknowledgement across a delete another employee's write straddles", async () => {
    // Acknowledgements live in per-employee files, so emp2 acknowledging a
    // different notification while the first one is deleted cannot touch emp1's
    // record of it.
    const root = makeRoot();
    const deleted = await postAndRead(root, { message: "المحذوف", postedBy: "mgr-1" });
    const other = await postAndRead(root, { message: "الآخر", postedBy: "mgr-1" });
    expect((await acceptNotification(root, deleted.id, "emp1")).ok).toBe(true);

    expect((await deleteNotification(root, deleted.id)).ok).toBe(true);
    expect((await acceptNotification(root, other.id, "emp2")).ok).toBe(true);
    expect((await restoreNotification(root, deleted)).ok).toBe(true);

    const list = await loadNotifications(root);
    const restored = list.find((n) => n.id === deleted.id)!;
    expect(hasAccepted(restored, "emp1")).toBe(true);
  });

  it("restores into chronological order and is idempotent", async () => {
    const root = makeRoot();
    const first = await postAndRead(root, { message: "الأول", postedBy: "mgr-1" });
    const second = await postAndRead(root, { message: "الثاني", postedBy: "mgr-1" });
    await postAndRead(root, { message: "الثالث", postedBy: "mgr-1" });

    expect((await deleteNotification(root, second.id)).ok).toBe(true);
    expect((await restoreNotification(root, second)).ok).toBe(true);
    // A second undo (double-clicked toast) must not duplicate the record.
    expect((await restoreNotification(root, second)).ok).toBe(true);

    const list = await loadNotifications(root);
    expect(list).toHaveLength(3);
    expect(list.filter((n) => n.id === second.id)).toHaveLength(1);
    // Back in postedAt order, not appended at the end.
    expect(list.map((n) => n.postedAt)).toEqual([...list.map((n) => n.postedAt)].sort());
    expect(list[0]!.id).toBe(first.id);
  });
});
