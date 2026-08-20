/* @vitest-environment jsdom */
// Regression tests for the NotificationManager hardening pass, carried forward
// onto the targeted-publishing rebuild (the single-column view became
// `NotificationManager/{index,NotificationComposer,NotificationList,NotificationDetail}`):
//  1. loadState has a real LoadingState/ErrorState + retry instead of a
//     `.catch(() => {})` that left the page permanently stuck on an empty list.
//  2. audienceUsers re-derives via subscribeToUserManagementChanges instead of
//     being frozen forever at its first-mount value.
//  3. A background/manual refresh never blanks or remounts a rendered list, and
//     a failed silent refresh never surfaces an error state.
//  4. The composer disables its textarea while a post is in flight, and only
//     clears the draft if it still matches exactly what was submitted (guards
//     against clobbering text the user started typing the instant the request
//     settles).
//  5. Posting is gated on the post-notification permission at the render
//     boundary, not only in the handler.
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
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import NotificationManager from "./NotificationManager";

vi.mock("../../../../../data/notifications/notificationStorage", () => ({
  loadNotifications: vi.fn(),
  postNotification: vi.fn(),
  updateNotificationMessage: vi.fn(),
  deleteNotification: vi.fn(),
  restoreNotification: vi.fn(),
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

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    message: "رسالة تجريبية",
    postedBy: "mgr-1",
    postedAt: "2026-08-01T08:00:00.000Z",
    acceptances: [],
    ...overrides,
  };
}

/**
 * The list card for a message. The body text now renders twice — once in the
 * left-hand list card and once in the detail pane — so an unqualified
 * `getByText` is ambiguous by construction; the card is the occurrence inside
 * an `<li>`.
 */
function listCard(message: string): HTMLLIElement {
  const card = screen
    .getAllByText(message)
    .map((node) => node.closest("li"))
    .find((node): node is HTMLLIElement => node !== null);
  if (!card) throw new Error(`no list card rendered for "${message}"`);
  return card;
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

    await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());
    expect(screen.queryByText("تعذر تحميل الإشعارات.")).not.toBeInTheDocument();
    expect(loadNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it("re-derives the audience roster via subscribeToUserManagementChanges instead of freezing it at mount", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    const initialState = createEmptyUserManagementState();
    writeUserManagementState(initialState, false);

    loadNotificationsMock.mockResolvedValue([makeNotification()]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);

    // Default seed audience (isNotificationAudienceRole = employee | supervisor):
    // malrogi (supervisor) + jalgahamdi/hihaloraini/saalhijji (employee) = 4.
    // (the two manager seed users, amonem and mkhuwaytim, are not audience-eligible.)
    await waitFor(() => expect(screen.getByText("0 من 4 اطّلعوا")).toBeInTheDocument());
    expect(screen.getByText("جميلة الغامدي")).toBeInTheDocument();

    // Deactivate one audience-eligible user, as if done concurrently from the
    // User Management tab. Previously: audienceUsers was `useMemo(fn, [])` — a
    // one-time snapshot that could never observe this without a full remount.
    const updatedUsers = initialState.users.map((u) =>
      u.username === "jalgahamdi" ? { ...u, isActive: false } : u
    );
    act(() => {
      writeUserManagementState({ ...initialState, users: updatedUsers }, true);
    });

    await waitFor(() => expect(screen.getByText("0 من 3 اطّلعوا")).toBeInTheDocument());
    expect(screen.queryByText("جميلة الغامدي")).not.toBeInTheDocument();
  });
});

// A2 — a background/manual refresh must never blank a previously rendered list.
describe("NotificationManager silent refresh (A2)", () => {
  it("keeps the previously rendered notification list mounted (same DOM node) across a periodic refresh, and never shows LoadingState", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    const notification = makeNotification({ message: "رسالة أولى" });
    loadNotificationsMock.mockResolvedValue([notification]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(listCard("رسالة أولى")).toBeInTheDocument());

    // Hold a reference to the actual rendered list item -- a naive silent-flag
    // no-op (opts.silent landing on the event's source string, exactly like the
    // `subscribeToDataRefresh(reload)` bug this guards against) would flip
    // loadState to "loading", unmount the whole `<ul>` under the mutually
    // exclusive `loadState === "loading"` / `loadState === "ready"` render
    // gates, and hand back a freshly created node on the next render even if
    // the content ends up identical.
    const listItemBefore = listCard("رسالة أولى");

    const secondNotification = makeNotification({
      id: "n2",
      message: "رسالة ثانية",
      postedAt: "2026-08-02T08:00:00.000Z",
    });
    loadNotificationsMock.mockResolvedValue([secondNotification, notification]);

    act(() => {
      broadcastDataRefresh("periodic");
    });

    await waitFor(() => expect(listCard("رسالة ثانية")).toBeInTheDocument());
    expect(screen.queryByText("جارٍ التحميل…")).not.toBeInTheDocument();
    expect(screen.queryByText("تعذر تحميل الإشعارات.")).not.toBeInTheDocument();

    // The pre-existing item's DOM node was never destroyed and recreated.
    expect(listCard("رسالة أولى")).toBe(listItemBefore);
  });

  it("keeps the previously rendered list and shows no error state when a silent background refresh's read fails", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);

    loadNotificationsMock.mockResolvedValue([makeNotification({ message: "رسالة موجودة" })]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(listCard("رسالة موجودة")).toBeInTheDocument());

    loadNotificationsMock.mockRejectedValueOnce(new Error("transient UNC hiccup"));

    act(() => {
      broadcastDataRefresh("periodic");
    });

    // Give the rejected silent reload a tick to settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(listCard("رسالة موجودة")).toBeInTheDocument();
    expect(screen.queryByText("تعذر تحميل الإشعارات.")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "رسالة أولى" } });

    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    // Busy: the textarea must be disabled while the request is in flight.
    await waitFor(() => expect(textarea).toBeDisabled());
    expect(postNotificationMock).toHaveBeenCalledWith(
      {},
      { message: "رسالة أولى", postedBy: "mgr-1", target: "all", audience: [] }
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

  it("clears the draft on success when the user did not type anything else", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    loadNotificationsMock.mockResolvedValue([]);
    postNotificationMock.mockResolvedValue({ ok: true });

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "رسالة" } });
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() => expect(screen.getByText("تم نشر الإشعار.")).toBeInTheDocument());
    expect(textarea.value).toBe("");
  });

  it("surfaces the storage layer's rejection instead of pretending the post landed", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    loadNotificationsMock.mockResolvedValue([]);
    postNotificationMock.mockResolvedValue({ ok: false, error: "تعارض في الكتابة" });

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "رسالة" } });
    fireEvent.click(screen.getByRole("button", { name: "نشر الإشعار" }));

    await waitFor(() => expect(screen.getByText("تعارض في الكتابة")).toBeInTheDocument());
    expect(screen.queryByText("تم نشر الإشعار.")).not.toBeInTheDocument();
    // The draft is kept so the user can retry without retyping it.
    expect(textarea.value).toBe("رسالة");
  });

  it("does not submit a whitespace-only draft", async () => {
    writeSession({ role: "manager", username: "mgr-1", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    loadNotificationsMock.mockResolvedValue([]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(screen.getByText("لا توجد إشعارات مطابقة")).toBeInTheDocument());

    const textarea = screen.getByLabelText("نص الإشعار الجديد") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "    " } });

    const postButton = screen.getByRole("button", { name: "نشر الإشعار" });
    expect(postButton).toBeDisabled();
    fireEvent.click(postButton);
    expect(postNotificationMock).not.toHaveBeenCalled();
  });
});

describe("NotificationManager permission gating", () => {
  it("hides the composer and the per-notification actions from a role without post-notification", async () => {
    // supervisor is inside the must-accept audience but has no posting rights
    // (userManagement defaults: admin + manager only).
    writeSession({ role: "supervisor", username: "malrogi", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    loadNotificationsMock.mockResolvedValue([makeNotification({ message: "رسالة للمشرف" })]);

    render(<NotificationManager directoryHandle={{} as DirectoryHandleLike} />);
    await waitFor(() => expect(listCard("رسالة للمشرف")).toBeInTheDocument());

    expect(screen.queryByLabelText("نص الإشعار الجديد")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "نشر الإشعار" })).not.toBeInTheDocument();
    // The detail pane still renders — read-only — but offers no mutations.
    expect(screen.queryByRole("button", { name: /تعديل/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تذكير/ })).not.toBeInTheDocument();
  });
});
