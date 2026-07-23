/* @vitest-environment jsdom */
// Regression tests for the NotificationManager hardening pass (synthesis medium,
// 4 merged findings):
//  1. loadState now has a real LoadingState/ErrorState + retry instead of a
//     `.catch(() => {})` that left the page permanently stuck on an empty list.
//  2. audienceUsers re-derives via subscribeToUserManagementChanges instead of
//     being frozen forever at `useMemo(..., [])`'s first-mount value.
//  3. The post composer disables its textarea while a post is in flight, and only
//     clears the draft if it still matches exactly what was submitted (guards
//     against clobbering text the user started typing the instant the request
//     settles).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../../auth/userManagement";
import type { AppNotification } from "../../../../../data/notifications/notificationTypes";
import { loadNotifications, postNotification } from "../../../../../data/notifications/notificationStorage";
import NotificationManager from "./NotificationManager";

vi.mock("../../../../../data/notifications/notificationStorage", () => ({
  loadNotifications: vi.fn(),
  postNotification: vi.fn(),
}));

// usePermissions() reads useWorkspace() only to gate canMutate on "is a workspace
// open" — this test's directoryHandle prop is opaque (notificationStorage is mocked).
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {} as DirectoryHandleLike, status: "ready" }),
}));

const loadNotificationsMock = vi.mocked(loadNotifications);
const postNotificationMock = vi.mocked(postNotification);

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  loadNotificationsMock.mockReset();
  postNotificationMock.mockReset();
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("NotificationManager loading/error hardening", () => {
  it("shows an error state with a retry action when the initial load fails, and recovers on retry", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    loadNotificationsMock.mockRejectedValueOnce(new Error("read failed"));
    loadNotificationsMock.mockResolvedValueOnce([]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);

    // Previously: the load promise chain ended in `.catch(() => {})`, silently
    // leaving the page on an empty list forever with no way to tell a real read
    // failure apart from "no notifications posted yet".
    await waitFor(() => expect(screen.getByText("تعذر تحميل الإشعارات.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => expect(screen.getByText("لا توجد إشعارات")).toBeInTheDocument());
    expect(screen.queryByText("تعذر تحميل الإشعارات.")).not.toBeInTheDocument();
    expect(loadNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it("re-derives the audience roster via subscribeToUserManagementChanges instead of freezing it at mount", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    const initialState = createEmptyUserManagementState();
    writeUserManagementState(initialState, false);

    const notification: AppNotification = {
      id: "n1",
      message: "رسالة تجريبية",
      postedBy: "mgr-1",
      postedAt: new Date().toISOString(),
      acceptances: [],
    };
    loadNotificationsMock.mockResolvedValue([notification]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);

    // Default seed audience (isNotificationAudienceRole = employee | supervisor):
    // mohammed.otaibi (supervisor) + jamila.ghamdi/hatem.oraini/salman.hajji (employee) = 4.
    await waitFor(() => expect(screen.getByText("0 من 4 اطّلعوا")).toBeInTheDocument());
    expect(screen.getByText("جميلة الغامدي")).toBeInTheDocument();

    // Deactivate one audience-eligible user, as if done concurrently from the
    // User Management tab. Previously: audienceUsers was `useMemo(fn, [])` — a
    // one-time snapshot that could never observe this without a full remount.
    const updatedUsers = initialState.users.map((u) =>
      u.username === "jamila.ghamdi" ? { ...u, isActive: false } : u
    );
    act(() => {
      writeUserManagementState({ ...initialState, users: updatedUsers }, true);
    });

    await waitFor(() => expect(screen.getByText("0 من 3 اطّلعوا")).toBeInTheDocument());
    expect(screen.queryByText("جميلة الغامدي")).not.toBeInTheDocument();
  });
});

describe("NotificationManager post composer hardening", () => {
  it("disables the textarea while posting and only clears it if the draft still matches what was submitted", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    loadNotificationsMock.mockResolvedValue([]);

    const deferred = createDeferred<{ ok: true } | { ok: false; error: string }>();
    postNotificationMock.mockReturnValue(deferred.promise);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(screen.getByText("لا توجد إشعارات")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "رسالة أولى" } });

    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    // Busy: the textarea must be disabled while the request is in flight.
    await waitFor(() => expect(textarea).toBeDisabled());
    expect(postNotificationMock).toHaveBeenCalledWith(
      {},
      { message: "رسالة أولى", postedBy: "mgr-1" }
    );

    // A draft change lands while the request is still pending (the race the
    // guard protects against) — it must survive the eventual clear-on-success.
    fireEvent.change(textarea, { target: { value: "مسودة جديدة أثناء الإرسال" } });

    await act(async () => {
      deferred.resolve({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => expect(textarea).not.toBeDisabled());
    // Previously: `setMessage("")` unconditionally cleared the textarea here,
    // discarding whatever the user had already started typing next.
    expect(textarea.value).toBe("مسودة جديدة أثناء الإرسال");
  });
});
