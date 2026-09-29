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

const workspace = vi.hoisted(() => ({ handle: { name: "workspace" } as { name: string } }));

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspace.handle, refreshPermissions: () => {} }),
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
const ADMIN: AuthSession = { username: "admin", role: "admin", loginAt: "2026-09-28T08:00:00.000Z" };

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
    workspace.handle = { name: "workspace" };
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

  it("keeps the typed text and shows the error when the submit fails", async () => {
    storage.listThreadSummaries.mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    storage.submitFeedback.mockRejectedValue(new Error("تعذّر حفظ الرسالة: تعارض في الكتابة"));

    await renderOpenAndSettle();
    const box = screen.getByLabelText(DEFAULT_LABELS.fb_message_label) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "رسالة يجب ألا تضيع" } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_submit_btn }));

    expect(await screen.findByText("تعذّر حفظ الرسالة: تعارض في الكتابة")).toBeInTheDocument();
    // Nothing is lost: the text stays for a retry and no success screen shows.
    expect((screen.getByLabelText(DEFAULT_LABELS.fb_message_label) as HTMLTextAreaElement).value).toBe(
      "رسالة يجب ألا تضيع"
    );
    expect(screen.queryByText(DEFAULT_LABELS.fb_success_title)).toBeNull();
  });

  it("a refresh that started before a local submit and resolve does not undo either", async () => {
    const opened = summaryOf(EXISTING);
    // Refresh A (the first open) is held on a deferred promise; refresh B (a
    // close + reopen) lands normally. A is therefore the stale one: it started
    // before the local changes below and lands after them.
    let releaseStaleList!: (list: FeedbackThreadSummary[]) => void;
    storage.listThreadSummaries
      .mockReturnValueOnce(
        new Promise<FeedbackThreadSummary[]>((resolve) => {
          releaseStaleList = resolve;
        })
      )
      .mockResolvedValueOnce([opened]);
    storage.loadFeedback.mockResolvedValue([EXISTING]);
    const created: FeedbackThread = {
      id: "t20260928090000-cccccccc",
      from: "admin",
      role: "admin",
      category: "suggestion",
      text: "اقتراح لا يجب أن يختفي",
      timestamp: "2026-09-28T09:00:00.000Z",
      status: "open",
      replies: [],
      revision: 1,
    };
    storage.submitFeedback.mockResolvedValue(created);
    storage.replyToFeedback.mockResolvedValue({
      ...EXISTING,
      status: "resolved",
      replies: [
        { from: "admin", role: "admin", text: "", timestamp: "2026-09-28T09:05:00.000Z" },
      ],
      revision: 2,
    });

    // The admin's launcher lives in the toolbar: it drives the widget through
    // the same window event.
    writeSession(ADMIN);
    render(
      <FeedbackUnreadProvider session={ADMIN}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    const toggle = () => act(async () => void window.dispatchEvent(new Event("feedback:toggle")));
    await toggle(); // open: refresh A starts and is held
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(1));
    await toggle(); // close
    await toggle(); // reopen: refresh B lands
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(2));
    await act(async () => {});

    // While A is in flight: resolve the existing thread ...
    fireEvent.click(screen.getByRole("button", { name: new RegExp(DEFAULT_LABELS.fb_tab_all) }));
    await screen.findByText("الجهاز لا يعمل");
    // (The panel's own close button shares the label, so go by class.)
    fireEvent.click(document.querySelector(".fb-resolve-btn") as HTMLElement);
    await waitFor(() => expect(storage.replyToFeedback).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("الجهاز لا يعمل")).toBeNull());

    // ... and submit a new one.
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_tab_new }));
    fireEvent.change(screen.getByLabelText(DEFAULT_LABELS.fb_message_label), {
      target: { value: "اقتراح لا يجب أن يختفي" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_submit_btn }));
    expect(await screen.findByText(DEFAULT_LABELS.fb_success_title)).toBeInTheDocument();

    // The stale list lands: it knows neither change.
    await act(async () => {
      releaseStaleList([opened]);
    });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(DEFAULT_LABELS.fb_tab_all) }));
    expect(await screen.findByText("اقتراح لا يجب أن يختفي")).toBeInTheDocument();
    expect(screen.queryByText("الجهاز لا يعمل")).toBeNull();
  });

  it("a workspace switch leaves no thread of the previous workspace in the list", async () => {
    storage.listThreadSummaries.mockResolvedValueOnce([summaryOf(EXISTING)]).mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    storage.loadThreads.mockResolvedValue([EXISTING]);
    writeSession(SARA);
    const tree = () => (
      <FeedbackUnreadProvider session={SARA}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    const { rerender } = render(tree());
    fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
    expect(await screen.findByText("الجهاز لا يعمل")).toBeInTheDocument();

    // Another workspace is mounted: its index is empty.
    workspace.handle = { name: "other-workspace" };
    rerender(tree());
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText("الجهاز لا يعمل")).toBeNull();
  });

  it("a thread this tab merely read, and that is gone from disk, does not reappear on refresh", async () => {
    storage.listThreadSummaries.mockResolvedValueOnce([summaryOf(EXISTING)]).mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    storage.loadThreads.mockResolvedValue([EXISTING]);
    await renderOpenAndSettle();
    expect(await screen.findByText("الجهاز لا يعمل")).toBeInTheDocument();

    const toggle = () => act(async () => void window.dispatchEvent(new Event("feedback:toggle")));
    await toggle(); // close
    await toggle(); // reopen: refresh returns an empty index
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText("الجهاز لا يعمل")).toBeNull();
  });

  it("a submit still in flight across a workspace switch stays in its own workspace", async () => {
    storage.listThreadSummaries.mockResolvedValue([]);
    storage.loadFeedback.mockResolvedValue([]);
    const created: FeedbackThread = {
      id: "t20260928090000-dddddddd",
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "خيط من المساحة القديمة",
      timestamp: "2026-09-28T09:00:00.000Z",
      status: "open",
      replies: [],
      revision: 1,
    };
    let finishSubmit!: (thread: FeedbackThread) => void;
    storage.submitFeedback.mockReturnValue(
      new Promise<FeedbackThread>((resolve) => {
        finishSubmit = resolve;
      })
    );
    writeSession(SARA);
    const tree = () => (
      <FeedbackUnreadProvider session={SARA}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    const { rerender } = render(tree());
    fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(DEFAULT_LABELS.fb_message_label), {
      target: { value: "نص مكتوب" },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_submit_btn }));
    await waitFor(() => expect(storage.submitFeedback).toHaveBeenCalledTimes(1));

    // Switch workspace while the write is still pending; B's refresh lands empty.
    workspace.handle = { name: "other-workspace" };
    rerender(tree());
    await waitFor(() => expect(storage.listThreadSummaries).toHaveBeenCalledTimes(2));
    await act(async () => {});

    await act(async () => {
      finishSubmit(created);
    });
    await act(async () => {});

    const another = screen.queryByRole("button", { name: DEFAULT_LABELS.fb_success_send_another });
    if (another) fireEvent.click(another);
    expect(screen.queryByText("خيط من المساحة القديمة")).toBeNull();
    expect(screen.queryByText(DEFAULT_LABELS.fb_submit_error_generic)).toBeNull();
  });
});
