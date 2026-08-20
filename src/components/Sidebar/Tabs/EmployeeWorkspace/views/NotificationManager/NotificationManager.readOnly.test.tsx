/* @vitest-environment jsdom */
// canMutate gating, as distinct from can(): a manager keeps the right to SEE
// the composer when the workspace itself is not writable (not yet connected,
// read-only/demo mode), but every write affordance must be inert — the repo's
// rule is to apply the capability at the render boundary as well as in the
// handler, so nothing offers an action that would be refused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../../auth/userManagement";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { loadNotifications } from "../../../../../../data/notifications/notificationStorage";
import NotificationManager from "./index";

vi.mock("../../../../../../data/notifications/notificationStorage", () => ({
  loadNotifications: vi.fn(),
  postNotification: vi.fn(),
  updateNotificationMessage: vi.fn(),
  deleteNotification: vi.fn(),
  restoreNotification: vi.fn(),
}));

// No workspace connected → getMutationCapability refuses every mutation, while
// the page-level `can("post-notification")` still passes for a manager.
vi.mock("../../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: null, status: "idle" }),
}));

const loadNotificationsMock = vi.mocked(loadNotifications);

beforeEach(() => {
  loadNotificationsMock.mockReset();
  loadNotificationsMock.mockResolvedValue([
    {
      id: "n1",
      message: "رسالة قائمة",
      postedBy: "mgr-1",
      postedAt: "2026-08-01T08:00:00.000Z",
      acceptances: [],
    },
  ]);
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("NotificationManager without mutation capability", () => {
  it("still shows the composer but disables posting and hides the per-notification actions", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(screen.getByText("نص الإشعار الجديد")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    const postButton = screen.getByRole("button", { name: "نشر الإشعار" });
    expect(postButton).toBeDisabled();
    // …and says why, rather than failing silently on click.
    expect(postButton).toHaveAttribute(
      "title",
      "يتطلب النشر صلاحية التعديل ومساحة عمل قابلة للكتابة."
    );

    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تذكير من لم يطّلع" })).not.toBeInTheDocument();
  });
});
