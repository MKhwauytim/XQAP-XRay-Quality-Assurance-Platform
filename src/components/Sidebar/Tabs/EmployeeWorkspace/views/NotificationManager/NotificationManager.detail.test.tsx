/* @vitest-environment jsdom */
// The list + detail half of the targeted-publishing rebuild: selection, search
// and the filter chips over the list, the acknowledgement roster in the detail
// pane, and the three per-notification actions (تعديل / تذكير من لم يطّلع / حذف)
// with the delete toast's تراجع.
//
// The undo path is the one worth stating plainly: the toast hands the ORIGINAL
// record — same id — back to `restoreNotification`, which is what lets the
// per-employee acknowledgement files re-attach instead of every reader being
// asked again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../../auth/userManagement";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import {
  deleteNotification,
  loadNotifications,
  postNotification,
  restoreNotification,
  updateNotificationMessage,
} from "../../../../../../data/notifications/notificationStorage";
import type { AppNotification } from "../../../../../../data/notifications/notificationTypes";
import NotificationManager from "./index";

vi.mock("../../../../../../data/notifications/notificationStorage", () => ({
  loadNotifications: vi.fn(),
  postNotification: vi.fn(),
  updateNotificationMessage: vi.fn(),
  deleteNotification: vi.fn(),
  restoreNotification: vi.fn(),
}));

vi.mock("../../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

const loadNotificationsMock = vi.mocked(loadNotifications);
const postNotificationMock = vi.mocked(postNotification);
const updateNotificationMessageMock = vi.mocked(updateNotificationMessage);
const deleteNotificationMock = vi.mocked(deleteNotification);
const restoreNotificationMock = vi.mocked(restoreNotification);

// Seed managed roster: malrogi (supervisor), jalgahamdi, hihaloraini, saalhijji.
const ACCEPTED_AT = "2026-08-02T08:00:00.000Z";

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    message: "رسالة",
    postedBy: "mgr-1",
    postedAt: "2026-08-01T08:00:00.000Z",
    acceptances: [],
    ...overrides,
  };
}

function detailPane(): HTMLElement {
  const pane = document.querySelector(".ntf-detail");
  if (!pane) throw new Error("detail pane not rendered");
  return pane as HTMLElement;
}

/** The list cards — the only toggle-style buttons on screen while the composer's person picker is closed. */
function listCards(): HTMLElement[] {
  return screen.queryAllByRole("button").filter((node) => node.hasAttribute("aria-pressed"));
}

function cardMessages(): string[] {
  return listCards().map((card) => card.querySelector("p")?.textContent ?? "");
}

/**
 * The list's filter chips. Scoped by container because they share their
 * tablist's accessible name with the detail pane's roster tabs.
 */
function filterChip(name: RegExp): HTMLElement {
  const chips = document.querySelector(".ntf-filter-chips");
  if (!chips) throw new Error("filter chips not rendered");
  return within(chips as HTMLElement).getByRole("tab", { name });
}

function composerTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("اكتب نص الإشعار هنا...") as HTMLTextAreaElement;
}

async function renderManager(notifications: AppNotification[]): Promise<void> {
  writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  loadNotificationsMock.mockResolvedValue(notifications);
  render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
  await waitFor(() => expect(listCards().length).toBe(notifications.length));
}

beforeEach(() => {
  loadNotificationsMock.mockReset();
  postNotificationMock.mockReset();
  updateNotificationMessageMock.mockReset();
  deleteNotificationMock.mockReset();
  restoreNotificationMock.mockReset();
  postNotificationMock.mockResolvedValue({ ok: true });
  updateNotificationMessageMock.mockResolvedValue({ ok: true });
  deleteNotificationMock.mockResolvedValue({ ok: true });
  restoreNotificationMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("NotificationManager list + selection", () => {
  it("opens the head of the list by default and follows an explicit selection", async () => {
    await renderManager([
      makeNotification({ id: "n1", message: "الأحدث", postedAt: "2026-08-03T08:00:00.000Z" }),
      makeNotification({ id: "n2", message: "الأقدم", postedAt: "2026-08-01T08:00:00.000Z" }),
    ]);

    // Newest first, and the newest is what the detail pane opens on.
    expect(cardMessages()).toEqual(["الأحدث", "الأقدم"]);
    expect(within(detailPane()).getByText("الأحدث")).toBeInTheDocument();

    fireEvent.click(listCards()[1]!);
    expect(within(detailPane()).getByText("الأقدم")).toBeInTheDocument();
    expect(listCards()[1]!).toHaveAttribute("aria-pressed", "true");
    expect(listCards()[0]!).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the head of the list when a search drops the selected notification", async () => {
    await renderManager([
      makeNotification({ id: "n1", message: "تعميم الجودة", postedAt: "2026-08-03T08:00:00.000Z" }),
      makeNotification({ id: "n2", message: "تعميم الصيانة", postedAt: "2026-08-01T08:00:00.000Z" }),
    ]);

    fireEvent.click(listCards()[1]!);
    expect(within(detailPane()).getByText("تعميم الصيانة")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ابحث في نص الإشعارات أو اسم الناشر…"), {
      target: { value: "الجودة" },
    });

    expect(cardMessages()).toEqual(["تعميم الجودة"]);
    // Not an empty pane: the selection follows the filtered list.
    expect(within(detailPane()).getByText("تعميم الجودة")).toBeInTheDocument();
  });

  it("searches on the poster's name as well as the body", async () => {
    await renderManager([
      makeNotification({ id: "n1", message: "الأول", postedBy: "mgr-1" }),
      makeNotification({ id: "n2", message: "الثاني", postedBy: "sup-9" }),
    ]);

    fireEvent.change(screen.getByLabelText("ابحث في نص الإشعارات أو اسم الناشر…"), {
      target: { value: "sup-9" },
    });
    expect(cardMessages()).toEqual(["الثاني"]);
  });

  it("splits the list into pending / fully-acknowledged with live counts", async () => {
    const everyone = ["malrogi", "jalgahamdi", "hihaloraini", "saalhijji"].map((username) => ({
      username,
      acceptedAt: ACCEPTED_AT,
    }));
    await renderManager([
      makeNotification({
        id: "n1",
        message: "اطّلع عليه الجميع",
        postedAt: "2026-08-03T08:00:00.000Z",
        acceptances: everyone,
      }),
      makeNotification({
        id: "n2",
        message: "بانتظار الاطّلاع",
        postedAt: "2026-08-01T08:00:00.000Z",
        acceptances: [{ username: "malrogi", acceptedAt: ACCEPTED_AT }],
      }),
    ]);

    expect(filterChip(/بانتظار اطّلاع/)).toHaveTextContent("1");
    expect(filterChip(/اطّلع الجميع/)).toHaveTextContent("1");

    fireEvent.click(filterChip(/بانتظار اطّلاع/));
    expect(cardMessages()).toEqual(["بانتظار الاطّلاع"]);
    expect(filterChip(/بانتظار اطّلاع/)).toHaveAttribute("aria-selected", "true");

    fireEvent.click(filterChip(/اطّلع الجميع/));
    expect(cardMessages()).toEqual(["اطّلع عليه الجميع"]);

    fireEvent.click(filterChip(/^الكل/));
    expect(cardMessages()).toHaveLength(2);
  });
});

describe("NotificationManager detail pane", () => {
  it("reports the acknowledgement ratio and percentage over the targeted roster only", async () => {
    await renderManager([
      makeNotification({
        target: "supervisors",
        acceptances: [{ username: "malrogi", acceptedAt: ACCEPTED_AT }],
      }),
    ]);

    const detail = detailPane();
    // Supervisors target → roster of one, already acknowledged.
    expect(within(detail).getByText("1 من 1 اطّلعوا")).toBeInTheDocument();
    expect(within(detail).getByText("100%")).toBeInTheDocument();
    expect(within(detail).getByText("المشرفون")).toBeInTheDocument();
    expect(within(detail).getByText("محمد العتيبي")).toBeInTheDocument();
    // The employees are not addressed, so they are not on the roster at all.
    expect(within(detail).queryByText("جميلة الغامدي")).not.toBeInTheDocument();
  });

  it("filters and searches the roster without touching the counts", async () => {
    await renderManager([
      makeNotification({ acceptances: [{ username: "jalgahamdi", acceptedAt: ACCEPTED_AT }] }),
    ]);

    const detail = detailPane();
    expect(within(detail).getByText("1 من 4 اطّلعوا")).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("tab", { name: "لم يطّلع" }));
    expect(within(detail).queryByText("جميلة الغامدي")).not.toBeInTheDocument();
    expect(within(detail).getByText("محمد العتيبي")).toBeInTheDocument();
    // The summary still describes the whole roster, not the filtered view.
    expect(within(detail).getByText("1 من 4 اطّلعوا")).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("tab", { name: "اطّلع" }));
    expect(within(detail).getByText("جميلة الغامدي")).toBeInTheDocument();
    expect(within(detail).queryByText("محمد العتيبي")).not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("tab", { name: "الكل" }));
    fireEvent.change(within(detail).getByLabelText("ابحث باسم الموظف…"), {
      target: { value: "حاتم" },
    });
    expect(within(detail).getByText("حاتم العريني")).toBeInTheDocument();
    expect(within(detail).queryByText("جميلة الغامدي")).not.toBeInTheDocument();

    fireEvent.change(within(detail).getByLabelText("ابحث باسم الموظف…"), {
      target: { value: "لا أحد" },
    });
    expect(within(detail).getByText("لا يوجد أسماء مطابقة لهذه التصفية.")).toBeInTheDocument();
  });

  it("shows when a notification has been edited", async () => {
    await renderManager([makeNotification({ editedAt: "2026-08-05T09:30:00.000Z" })]);
    expect(within(detailPane()).getByText(/عُدّل في/)).toBeInTheDocument();
  });
});

describe("NotificationManager edit action", () => {
  it("loads the notification into the composer and saves it in place, preserving its target", async () => {
    const notification = makeNotification({
      id: "n-edit",
      message: "النص الأصلي",
      target: "custom",
      audience: ["jalgahamdi"],
    });
    await renderManager([notification]);

    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    expect(screen.getByText("تعديل الإشعار")).toBeInTheDocument();
    expect(composerTextarea().value).toBe("النص الأصلي");
    // The stored targeting comes back with it, so saving cannot silently
    // broaden a custom broadcast to everyone.
    expect(
      within(screen.getByRole("tablist", { name: "الاستهداف" })).getByRole("tab", {
        name: "أشخاص محددون",
      })
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.change(composerTextarea(), { target: { value: "النص المصحح" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));

    await waitFor(() => expect(screen.getByText("تم حفظ التعديل.")).toBeInTheDocument());
    expect(updateNotificationMessageMock).toHaveBeenCalledWith({}, "n-edit", {
      message: "النص المصحح",
      target: "custom",
      audience: ["jalgahamdi"],
    });
    expect(postNotificationMock).not.toHaveBeenCalled();
    // Composer is back to compose mode, ready for the next broadcast.
    expect(screen.getByText("نص الإشعار الجديد")).toBeInTheDocument();
    expect(composerTextarea().value).toBe("");
  });

  it("keeps a draft typed while the edit save was still in flight", async () => {
    // Same guarantee the post path already had. It did NOT hold here: the
    // editing branch called `resetComposer()`, whose unconditional
    // `setMessage("")` queued after the guarded update and wiped whatever the
    // user had started typing while the write was settling.
    await renderManager([makeNotification({ id: "n-edit", message: "النص الأصلي" })]);

    let resolveSave!: (value: { ok: true }) => void;
    updateNotificationMessageMock.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveSave = resolve;
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    fireEvent.change(composerTextarea(), { target: { value: "النص المصحح" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));

    await waitFor(() => expect(composerTextarea()).toBeDisabled());
    fireEvent.change(composerTextarea(), { target: { value: "مسودة جديدة أثناء الحفظ" } });

    await act(async () => {
      resolveSave({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("تم حفظ التعديل.")).toBeInTheDocument());
    expect(composerTextarea().value).toBe("مسودة جديدة أثناء الحفظ");
    // The rest of the composer still leaves edit mode.
    expect(screen.getByText("نص الإشعار الجديد")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إلغاء التعديل" })).not.toBeInTheDocument();
  });

  it("abandons an edit without writing when الإلغاء is pressed", async () => {
    await renderManager([makeNotification({ message: "النص الأصلي" })]);

    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
    fireEvent.change(composerTextarea(), { target: { value: "تغيير لن يُحفظ" } });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء التعديل" }));

    expect(screen.getByText("نص الإشعار الجديد")).toBeInTheDocument();
    expect(composerTextarea().value).toBe("");
    expect(updateNotificationMessageMock).not.toHaveBeenCalled();
  });
});

describe("NotificationManager remind action", () => {
  it("posts a reminder addressed to exactly the people who have not acknowledged yet", async () => {
    await renderManager([
      makeNotification({
        message: "تعميم مهم",
        acceptances: [{ username: "jalgahamdi", acceptedAt: ACCEPTED_AT }],
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "تذكير من لم يطّلع" }));

    await waitFor(() => expect(postNotificationMock).toHaveBeenCalled());
    expect(postNotificationMock).toHaveBeenCalledWith(
      {},
      {
        message: "تذكير: تعميم مهم",
        postedBy: "mgr-1",
        target: "custom",
        audience: ["malrogi", "hihaloraini", "saalhijji"],
      }
    );
    // A reminder is a NEW notification, never an edit of the original — the
    // people who already acknowledged must not be asked again.
    expect(updateNotificationMessageMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("أُرسل تذكير إلى 3 شخصاً لم يطّلعوا بعد.")).toBeInTheDocument()
    );
  });

  it("says so and writes nothing when everyone has already acknowledged", async () => {
    await renderManager([
      makeNotification({
        acceptances: ["malrogi", "jalgahamdi", "hihaloraini", "saalhijji"].map((username) => ({
          username,
          acceptedAt: ACCEPTED_AT,
        })),
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "تذكير من لم يطّلع" }));

    await waitFor(() =>
      expect(
        screen.getByText("لا يوجد من لم يطّلع — الجميع اطّلعوا على هذا الإشعار.")
      ).toBeInTheDocument()
    );
    expect(postNotificationMock).not.toHaveBeenCalled();
  });
});

describe("NotificationManager delete + undo", () => {
  it("deletes, then restores the ORIGINAL record — same id — from the toast", async () => {
    const notification = makeNotification({
      id: "n-delete",
      message: "سيُحذف",
      acceptances: [{ username: "jalgahamdi", acceptedAt: ACCEPTED_AT }],
    });
    await renderManager([notification]);

    loadNotificationsMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(screen.getByText("تم حذف الإشعار.")).toBeInTheDocument());
    expect(deleteNotificationMock).toHaveBeenCalledWith({}, "n-delete");
    await waitFor(() => expect(listCards()).toHaveLength(0));

    loadNotificationsMock.mockResolvedValue([notification]);
    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));

    await waitFor(() => expect(restoreNotificationMock).toHaveBeenCalled());
    // The whole record goes back, id and acknowledgements included: the ack
    // files are keyed by that id, so the round trip is invisible to a reader
    // who had already acknowledged.
    expect(restoreNotificationMock).toHaveBeenCalledWith({}, notification);
    expect(restoreNotificationMock.mock.calls[0]![1]!.id).toBe("n-delete");
    await waitFor(() => expect(screen.getByText("تمت استعادة الإشعار.")).toBeInTheDocument());
    await waitFor(() => expect(listCards()).toHaveLength(1));
    // The toast is gone once the undo has been taken.
    expect(screen.queryByRole("button", { name: "تراجع" })).not.toBeInTheDocument();
  });

  it("keeps the list and raises no toast when the delete write fails", async () => {
    await renderManager([makeNotification({ id: "n-delete", message: "سيبقى" })]);
    deleteNotificationMock.mockResolvedValue({ ok: false, error: "تعارض في الكتابة" });

    fireEvent.click(screen.getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(screen.getByText("تعارض في الكتابة")).toBeInTheDocument());
    expect(screen.queryByText("تم حذف الإشعار.")).not.toBeInTheDocument();
    expect(listCards()).toHaveLength(1);
  });

  it("lets the toast be dismissed without undoing the delete", async () => {
    await renderManager([makeNotification({ id: "n-delete", message: "سيُحذف" })]);

    loadNotificationsMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    await waitFor(() => expect(screen.getByText("تم حذف الإشعار.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));

    expect(screen.queryByText("تم حذف الإشعار.")).not.toBeInTheDocument();
    expect(restoreNotificationMock).not.toHaveBeenCalled();
  });
});
