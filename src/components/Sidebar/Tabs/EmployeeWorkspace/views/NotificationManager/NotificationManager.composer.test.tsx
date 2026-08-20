/* @vitest-environment jsdom */
// The composer half of the targeted-publishing rebuild: the segmented target
// control, the custom-person picker, the live "who would this reach" count, and
// the preview block — plus what each of them actually hands to
// `postNotification`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../../auth/userManagement";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import {
  loadNotifications,
  postNotification,
} from "../../../../../../data/notifications/notificationStorage";
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

/** The composer's target control, kept apart from the list's filter chips. */
function targetGroup(): HTMLElement {
  return screen.getByRole("tablist", { name: "الاستهداف" });
}

function pickTarget(label: string): void {
  fireEvent.click(within(targetGroup()).getByRole("tab", { name: label }));
}

async function renderManager(): Promise<HTMLTextAreaElement> {
  writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  loadNotificationsMock.mockResolvedValue([]);
  render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
  await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());
  return screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
}

beforeEach(() => {
  loadNotificationsMock.mockReset();
  postNotificationMock.mockReset();
  postNotificationMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("NotificationComposer targeting", () => {
  it("counts the reach of every target against the live audience roster", async () => {
    // Seed roster: 3 employees + 1 supervisor = 4 must-accept users.
    await renderManager();

    expect(screen.getByText("4 مستلم مستهدف")).toBeInTheDocument();

    pickTarget("الموظفون");
    expect(screen.getByText("3 مستلم مستهدف")).toBeInTheDocument();

    pickTarget("المشرفون");
    expect(screen.getByText("1 مستلم مستهدف")).toBeInTheDocument();

    // "custom" starts at nobody — the picker below decides.
    pickTarget("أشخاص محددون");
    expect(screen.getByText("0 مستلم مستهدف")).toBeInTheDocument();
  });

  it("marks the active target on the segmented control", async () => {
    await renderManager();
    const group = targetGroup();
    expect(within(group).getByRole("tab", { name: "الكل" })).toHaveAttribute("aria-selected", "true");

    pickTarget("الموظفون");
    expect(within(targetGroup()).getByRole("tab", { name: "الكل" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(within(targetGroup()).getByRole("tab", { name: "الموظفون" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("shows the person picker only for a custom target, and posts exactly the picked usernames", async () => {
    const textarea = await renderManager();

    expect(screen.queryByRole("button", { name: /جميلة الغامدي/ })).not.toBeInTheDocument();

    pickTarget("أشخاص محددون");
    const chip = screen.getByRole("button", { name: /جميلة الغامدي/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: /جميلة الغامدي/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("1 مستلم مستهدف")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /محمد العتيبي/ }));
    expect(screen.getByText("2 مستلم مستهدف")).toBeInTheDocument();

    // Toggling one back off removes it again.
    fireEvent.click(screen.getByRole("button", { name: /جميلة الغامدي/ }));
    expect(screen.getByText("1 مستلم مستهدف")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "رسالة موجهة" } });
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() => expect(postNotificationMock).toHaveBeenCalled());
    expect(postNotificationMock).toHaveBeenCalledWith(
      {},
      { message: "رسالة موجهة", postedBy: "mgr-1", target: "custom", audience: ["malrogi"] }
    );
  });

  it("clears the picked people when the target moves off \"custom\"", async () => {
    const textarea = await renderManager();

    pickTarget("أشخاص محددون");
    fireEvent.click(screen.getByRole("button", { name: /جميلة الغامدي/ }));
    expect(screen.getByText("1 مستلم مستهدف")).toBeInTheDocument();

    pickTarget("الموظفون");
    expect(screen.getByText("3 مستلم مستهدف")).toBeInTheDocument();

    // Coming back to "custom" must start from an empty selection rather than
    // resurrecting a stale one the user can no longer see.
    pickTarget("أشخاص محددون");
    expect(screen.getByText("0 مستلم مستهدف")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /جميلة الغامدي/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.change(textarea, { target: { value: "رسالة" } });
    pickTarget("المشرفون");
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() => expect(postNotificationMock).toHaveBeenCalled());
    expect(postNotificationMock).toHaveBeenCalledWith(
      {},
      { message: "رسالة", postedBy: "mgr-1", target: "supervisors", audience: [] }
    );
  });

  it("surfaces the storage layer's empty-custom-audience rejection", async () => {
    const textarea = await renderManager();
    postNotificationMock.mockResolvedValue({
      ok: false,
      error: "اختر مستلماً واحداً على الأقل قبل النشر.",
    });

    fireEvent.change(textarea, { target: { value: "رسالة بلا مستلمين" } });
    pickTarget("أشخاص محددون");
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() =>
      expect(screen.getByText("اختر مستلماً واحداً على الأقل قبل النشر.")).toBeInTheDocument()
    );
    expect(screen.queryByText("تم نشر الإشعار.")).not.toBeInTheDocument();
    // The draft survives so the picker can be filled in and the post retried.
    expect(textarea.value).toBe("رسالة بلا مستلمين");
  });

  it("resets the target back to \"all\" after a successful post", async () => {
    const textarea = await renderManager();

    pickTarget("المشرفون");
    fireEvent.change(textarea, { target: { value: "رسالة" } });
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() => expect(screen.getByText("تم نشر الإشعار.")).toBeInTheDocument());
    expect(within(targetGroup()).getByRole("tab", { name: "الكل" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("4 مستلم مستهدف")).toBeInTheDocument();
  });
});

describe("NotificationComposer preview", () => {
  it("previews the draft as the recipient will see it, and closes again", async () => {
    const textarea = await renderManager();
    fireEvent.change(textarea, { target: { value: "نص المعاينة" } });

    fireEvent.click(screen.getByRole("button", { name: "معاينة" }));

    const preview = screen.getByText("معاينة كما ستظهر للمستلم").closest(".ntf-preview");
    expect(preview).not.toBeNull();
    // The draft is echoed inside the preview banner (the textarea holds the
    // same text, hence the scoped query), next to a static, non-clickable
    // replica of the recipient's "قبول" affordance.
    expect(within(preview as HTMLElement).getByText("نص المعاينة")).toBeInTheDocument();
    expect(within(preview as HTMLElement).getByText("قبول")).toBeInTheDocument();
    // The audience line is repeated inside the preview block.
    expect(screen.getAllByText("4 مستلم مستهدف")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "إخفاء المعاينة" }));
    expect(screen.queryByText("معاينة كما ستظهر للمستلم")).not.toBeInTheDocument();
  });

  it("previews without posting anything", async () => {
    const textarea = await renderManager();
    fireEvent.change(textarea, { target: { value: "نص المعاينة" } });
    fireEvent.click(screen.getByRole("button", { name: "معاينة" }));
    expect(postNotificationMock).not.toHaveBeenCalled();
  });
});
