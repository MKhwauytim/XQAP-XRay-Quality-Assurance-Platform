/* @vitest-environment jsdom */
// The list view now reads the thread INDEX (cheap) and opens only the current
// page's thread files (cheap), instead of the old loadFeedback() full
// aggregate. This is the regression guard for that split.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
  loadThreads: vi.fn<(dir: unknown, ids: readonly string[]) => Promise<FeedbackThread[]>>(),
  loadFeedback: vi.fn<() => Promise<FeedbackThread[]>>(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadThreads: storage.loadThreads,
    loadFeedback: storage.loadFeedback,
  };
});

function session(username: string, role: AuthSession["role"]): AuthSession {
  return { username, role, loginAt: new Date().toISOString() };
}

// Default: the same username every default-shaped summary() row is "from" --
// so the panel's own "my messages" list (no extra tab click needed) already
// shows the full paginated set under test.
function renderWidgetOpen(as: AuthSession = session("sara", "employee")) {
  writeSession(as);
  const result = render(
    <FeedbackUnreadProvider session={as}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
  return result;
}

function summary(overrides: Partial<FeedbackThreadSummary> & { threadId: string }): FeedbackThreadSummary {
  return {
    from: "sara",
    role: "employee",
    category: "suggestion",
    status: "open",
    createdAt: "2026-08-24T10:00:00.000Z",
    lastActivityAt: "2026-08-24T10:00:00.000Z",
    preview: "معاينة",
    ...overrides,
  };
}

describe("FeedbackWidget — per-thread data fetching", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset();
    storage.loadFeedback.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("reads the index for the list and opens only the current page's thread files", async () => {
    // Newest-first, matching what the real `listThreadSummaries` guarantees
    // (feedbackStorage.ts sorts by `createdAt` descending) -- the widget's own
    // "my messages" sort-by-latest-activity then keeps that order stable
    // before any thread body has loaded (it falls back to `createdAt`), so
    // page one is still the newest 100 either way.
    const summaries = Array.from({ length: 150 }, (_, i) =>
      summary({
        threadId: `t2026082410${String(i).padStart(4, "0")}-aaaaaaaa`,
        from: "sara",
        createdAt: new Date(Date.UTC(2026, 7, 24, 10, 0, 149 - i)).toISOString(),
      })
    );
    storage.listThreadSummaries.mockResolvedValue(summaries);
    storage.loadThreads.mockResolvedValue([]);

    renderWidgetOpen();

    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalled());
    await waitFor(() => expect(storage.loadThreads).toHaveBeenCalled());

    // DATA_PAGE_SIZE is 100: page one, and only page one -- the OLDEST
    // summary (index 149, last in this newest-first fixture) is on page two.
    const requestedIds = storage.loadThreads.mock.calls.at(-1)![1];
    expect(requestedIds).toHaveLength(100);
    expect(requestedIds).not.toContain(summaries[149]!.threadId);
  });

  it("never calls the full loadFeedback aggregate from its own list view", async () => {
    storage.listThreadSummaries.mockResolvedValue([summary({ threadId: "t20260824100000-aaaaaaaa" })]);
    storage.loadThreads.mockResolvedValue([]);

    renderWidgetOpen();

    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalled());
    // The unread PROVIDER may call it; the widget's own refresh must not.
    expect(storage.loadFeedback).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("renders a thread's replies once its file has loaded", async () => {
    const threadId = "t20260824100000-aaaaaaaa";
    storage.listThreadSummaries.mockResolvedValue([summary({ threadId, preview: "خطأ" })]);
    storage.loadThreads.mockResolvedValue([
      {
        id: threadId,
        from: "sara",
        role: "employee",
        category: "issue",
        text: "خطأ",
        timestamp: "2026-08-24T10:00:00.000Z",
        status: "open",
        replies: [{ from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-24T11:00:00.000Z" }],
      },
    ]);

    renderWidgetOpen();

    expect(await screen.findByText("تم الاطلاع")).toBeInTheDocument();
  });
});
