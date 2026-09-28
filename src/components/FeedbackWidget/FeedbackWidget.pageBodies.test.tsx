/* @vitest-environment jsdom */
// Workstream B (2026-09-28): a page's thread bodies come from the provider's
// in-memory aggregate first; only ids missing there are read from disk, and a
// re-sort of the visible rows must never trigger a second read of the same set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

const OLDER_BUT_ANSWERED: FeedbackThread = {
  id: "t20260820100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "المشكلة الأولى",
  timestamp: "2026-08-20T10:00:00.000Z",
  status: "open",
  replies: [{ from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-24T09:00:00.000Z" }],
  revision: 2,
};

const NEWER_NO_REPLY: FeedbackThread = {
  id: "t20260823100000-bbbbbbbb",
  from: "sara",
  role: "employee",
  category: "inquiry",
  text: "استفسار جديد",
  timestamp: "2026-08-23T10:00:00.000Z",
  status: "open",
  replies: [],
  revision: 1,
};

function summaryOf(thread: FeedbackThread): FeedbackThreadSummary {
  return {
    threadId: thread.id,
    from: thread.from,
    role: thread.role,
    category: thread.category,
    status: thread.status,
    createdAt: thread.timestamp,
    lastActivityAt: thread.timestamp,
    preview: thread.text,
  };
}

function renderProvider() {
  writeSession(SARA);
  return render(
    <FeedbackUnreadProvider session={SARA}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
}

describe("FeedbackWidget — page bodies come from the provider first", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset();
    storage.loadFeedback.mockReset();
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("reads no thread file when the provider already holds the page's threads", async () => {
    // Index order matches listThreadSummaries' createdAt-desc contract.
    storage.listThreadSummaries.mockResolvedValue([summaryOf(NEWER_NO_REPLY), summaryOf(OLDER_BUT_ANSWERED)]);
    storage.loadFeedback.mockResolvedValue([NEWER_NO_REPLY, OLDER_BUT_ANSWERED]);
    storage.loadThreads.mockResolvedValue([]);

    renderProvider();
    // Let the provider's mount-time aggregate land before the panel opens.
    await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalled());
    await act(async () => {});
    openPanel();

    expect(await screen.findByText("تم الاطلاع")).toBeInTheDocument();
    expect(screen.getByText("استفسار جديد")).toBeInTheDocument();
    expect(storage.loadThreads).not.toHaveBeenCalled();
  });

  it("reads the missing page once, even though the rows re-sort as bodies arrive", async () => {
    storage.listThreadSummaries.mockResolvedValue([summaryOf(NEWER_NO_REPLY), summaryOf(OLDER_BUT_ANSWERED)]);
    // The provider knows nothing yet, so both bodies must come from disk.
    storage.loadFeedback.mockResolvedValue([]);
    storage.loadThreads.mockResolvedValue([OLDER_BUT_ANSWERED, NEWER_NO_REPLY]);

    renderProvider();
    openPanel();

    // OLDER_BUT_ANSWERED's reply is the newest activity, so once its body lands
    // the "my messages" list re-orders -- the old effect key (the joined,
    // ORDERED visible ids) changed with it and read the same page again.
    await waitFor(() => {
      const bodies = screen.getAllByText(/المشكلة الأولى|استفسار جديد/).map((el) => el.textContent);
      expect(bodies).toEqual(["المشكلة الأولى", "استفسار جديد"]);
    });
    await act(async () => {});
    expect(storage.loadThreads).toHaveBeenCalledTimes(1);
    expect([...storage.loadThreads.mock.calls[0]![1]]).toEqual(
      [NEWER_NO_REPLY.id, OLDER_BUT_ANSWERED.id].sort()
    );
  });
});
