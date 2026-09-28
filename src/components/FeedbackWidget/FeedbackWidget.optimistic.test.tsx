/* @vitest-environment jsdom */
// Workstream B (2026-09-28): submit and reply apply the thread the write
// returned, instead of re-reading the whole feedback directory (the widget's
// own refresh PLUS a provider reload -- 2 x N thread reads per click), and a
// reply no longer leaves its card stuck on the loading line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackReply,
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { DEFAULT_LABELS, resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
  loadThreads: vi.fn<(dir: unknown, ids: readonly string[]) => Promise<FeedbackThread[]>>(),
  loadFeedback: vi.fn<() => Promise<FeedbackThread[]>>(),
  submitFeedback: vi.fn<(dir: unknown, payload: unknown) => Promise<FeedbackThread>>(),
  replyToFeedback: vi.fn<
    (dir: unknown, id: string, reply: FeedbackReply, resolve: boolean) => Promise<FeedbackThread>
  >(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadThreads: storage.loadThreads,
    loadFeedback: storage.loadFeedback,
    submitFeedback: storage.submitFeedback,
    replyToFeedback: storage.replyToFeedback,
  };
});

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

const EXISTING: FeedbackThread = {
  id: "t20260920100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-09-20T10:00:00.000Z",
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

async function renderOpenAndSettle() {
  writeSession(SARA);
  render(
    <FeedbackUnreadProvider session={SARA}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
  // Mount-time provider load + the open's background reload.
  await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalledTimes(2));
  await act(async () => {});
}

describe("FeedbackWidget — optimistic submit and reply", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    storage.loadThreads.mockReset().mockResolvedValue([]);
    storage.loadFeedback.mockReset();
    storage.submitFeedback.mockReset();
    storage.replyToFeedback.mockReset();
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("submit applies the created thread and performs no full reload of its own", async () => {
    storage.listThreadSummaries.mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    const created: FeedbackThread = {
      id: "t20260928090000-cccccccc",
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح جديد",
      timestamp: "2026-09-28T09:00:00.000Z",
      status: "open",
      replies: [],
      revision: 1,
    };
    storage.submitFeedback.mockResolvedValue(created);

    await renderOpenAndSettle();
    const summaryReadsBefore = storage.listThreadSummaries.mock.calls.length;
    const fullReadsBefore = storage.loadFeedback.mock.calls.length;

    fireEvent.change(screen.getByLabelText(DEFAULT_LABELS.fb_message_label), {
      target: { value: "اقتراح جديد" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_submit_btn }));
    expect(await screen.findByText(DEFAULT_LABELS.fb_success_title)).toBeInTheDocument();
    await act(async () => {});

    // No widget refresh (index + listing) and exactly ONE provider reload --
    // not the old `refresh()` + `reloadUnread()` pair.
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReadsBefore);
    await waitFor(() => expect(storage.loadFeedback.mock.calls.length).toBe(fullReadsBefore + 1));

    // The new thread is already in "my messages", body and all, with no read.
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_success_send_another }));
    expect(await screen.findByText("اقتراح جديد")).toBeInTheDocument();
    expect(storage.loadThreads).not.toHaveBeenCalled();
  });

  it("reply renders the new reply immediately, with no re-fetch and no stuck loading line", async () => {
    storage.listThreadSummaries.mockResolvedValue([summaryOf(EXISTING)]);
    // The provider's copy stays at revision 1 for the whole test; the widget
    // must keep showing its fresher, just-written revision 2.
    storage.loadFeedback.mockResolvedValue([EXISTING]);
    const reply: FeedbackReply = {
      from: "sara",
      role: "employee",
      text: "ما زالت المشكلة قائمة",
      timestamp: "2026-09-28T09:05:00.000Z",
    };
    storage.replyToFeedback.mockResolvedValue({ ...EXISTING, replies: [reply], revision: 2 });

    await renderOpenAndSettle();
    expect(await screen.findByText("الجهاز لا يعمل")).toBeInTheDocument();
    const summaryReadsBefore = storage.listThreadSummaries.mock.calls.length;
    const threadReadsBefore = storage.loadThreads.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText(DEFAULT_LABELS.fb_reply_placeholder), {
      target: { value: "ما زالت المشكلة قائمة" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_reply_btn }));

    expect(await screen.findByText("ما زالت المشكلة قائمة")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText(DEFAULT_LABELS.fb_loading)).toBeNull();
    expect(storage.loadThreads.mock.calls.length).toBe(threadReadsBefore);
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReadsBefore);
  });
});
