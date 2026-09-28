/* @vitest-environment jsdom */
// Workstream B (2026-09-28): a page's thread bodies come from the provider's
// in-memory aggregate first; only ids missing there are read from disk, and a
// re-sort of the visible rows must never trigger a second read of the same set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
    replyToFeedback: storage.replyToFeedback,
  };
});

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

function session(username: string, role: AuthSession["role"]): AuthSession {
  return { username, role, loginAt: "2026-09-28T08:00:00.000Z" };
}

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

function renderProvider(as: AuthSession = SARA) {
  writeSession(as);
  return render(
    <FeedbackUnreadProvider session={as}>
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
    storage.replyToFeedback.mockReset();
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

  it("resolving a provider-held thread shows the reply and the resolved state before the provider's next load resolves", async () => {
    // OLDER_BUT_ANSWERED comes only from the provider's own aggregate --
    // exactly the case Task 2 review flagged: `threadFor` must resolve it
    // from `threadsById` once this tab writes it, not fall back to the
    // provider's stale pre-write copy (which would make the reply vanish and
    // the card still show "open"). A manager session (not admin -- the
    // floating trigger is intentionally hidden for a real admin, who opens
    // the panel through AdminToolbar's icon instead) exercises the same
    // resolve-capable admin view.
    storage.listThreadSummaries.mockResolvedValue([summaryOf(OLDER_BUT_ANSWERED)]);
    storage.loadThreads.mockResolvedValue([]);

    // Calls 1-2 (provider mount + panel-open reload) resolve immediately;
    // every later call (the reload `handleReply` kicks off via `reloadUnread`)
    // hangs on a deferred promise the test controls, so the assertions below
    // run before that reload can possibly have landed.
    let deferredResolve!: (threads: FeedbackThread[]) => void;
    const deferred = new Promise<FeedbackThread[]>((resolve) => {
      deferredResolve = resolve;
    });
    let loadFeedbackCalls = 0;
    storage.loadFeedback.mockImplementation(() => {
      loadFeedbackCalls += 1;
      return loadFeedbackCalls <= 2 ? Promise.resolve([OLDER_BUT_ANSWERED]) : deferred;
    });

    const resolved: FeedbackThread = {
      ...OLDER_BUT_ANSWERED,
      status: "resolved",
      replies: [
        ...OLDER_BUT_ANSWERED.replies,
        { from: "boss", role: "manager", text: "تم الحل", timestamp: "2026-08-25T10:00:00.000Z" },
      ],
      revision: 3,
    };
    storage.replyToFeedback.mockResolvedValue(resolved);

    renderProvider(session("boss", "manager"));
    await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalledTimes(1));
    openPanel();
    await waitFor(() => expect(storage.loadFeedback).toHaveBeenCalledTimes(2));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${DEFAULT_LABELS.fb_tab_all}`) })
    );
    await screen.findByText("المشكلة الأولى");

    fireEvent.change(screen.getByPlaceholderText(DEFAULT_LABELS.fb_reply_placeholder), {
      target: { value: "تم الحل" },
    });
    // Scoped by class, not accessible name -- the panel's own close button
    // shares the same Arabic label ("إغلاق") as the resolve button.
    fireEvent.click(document.querySelector(".fb-resolve-btn")!);

    // Resolving moves the ticket out of the default "open" filter -- switch
    // to "all" so the just-resolved card is still visible to assert on.
    // Two "الكل" buttons exist (status filter + reply-status filter) --
    // the status filter is the first one.
    fireEvent.click(document.querySelectorAll(".fb-filter-bar")[0]!.querySelectorAll("button")[2]!);

    // Let handleReply's promise chain settle before asserting.
    await act(async () => {});
    // The reply and the resolved badge render from the write's own returned
    // thread -- the deferred reload (call #3+) is still pending. Scoped to the
    // card itself, since the status filter bar has a "مغلقة" button too.
    expect(await screen.findByText("تم الحل")).toBeInTheDocument();
    const card = document.querySelector(".fb-msg-card")!;
    expect(card.className).toContain("resolved");
    expect(within(card as HTMLElement).getByText(DEFAULT_LABELS.fb_resolved_badge)).toBeInTheDocument();
    expect(storage.loadFeedback.mock.calls.length).toBeGreaterThanOrEqual(3);

    deferredResolve([OLDER_BUT_ANSWERED]);
    await act(async () => {});
  });
});
