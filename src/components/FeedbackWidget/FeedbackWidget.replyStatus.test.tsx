/* @vitest-environment jsdom */
// "Hard to tell tickets with no answer from ones with answers" and "hard to
// find the ticket with the latest reply" -- the reply-status badge, the
// latest-activity sort, and the awaiting/answered filter this adds to the
// employee's own "my messages" list.
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

const OLDER_BUT_ANSWERED: FeedbackThread = {
  id: "t20260820100000-aaaaaaaa",
  from: "sara",
  role: "employee",
  category: "issue",
  text: "المشكلة الأولى",
  timestamp: "2026-08-20T10:00:00.000Z",
  status: "open",
  replies: [{ from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-24T09:00:00.000Z" }],
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

describe("FeedbackWidget — reply-status badge, sort and filter", () => {
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

  it("shows an answered badge for a ticket with a reply and an awaiting badge for one without", async () => {
    storage.listThreadSummaries.mockResolvedValue([
      summaryOf(OLDER_BUT_ANSWERED),
      summaryOf(NEWER_NO_REPLY),
    ]);
    storage.loadThreads.mockResolvedValue([OLDER_BUT_ANSWERED, NEWER_NO_REPLY]);

    renderWidgetOpen();

    expect(await screen.findByText("تم الرد")).toBeInTheDocument();
    expect(await screen.findByText("بانتظار الرد")).toBeInTheDocument();
  });

  it("sorts the newest reply to the top even though its ticket was opened first", async () => {
    storage.listThreadSummaries.mockResolvedValue([
      // Index order matches listThreadSummaries' real createdAt-desc contract:
      // NEWER_NO_REPLY (created 08-23) before OLDER_BUT_ANSWERED (created 08-20).
      summaryOf(NEWER_NO_REPLY),
      summaryOf(OLDER_BUT_ANSWERED),
    ]);
    storage.loadThreads.mockResolvedValue([OLDER_BUT_ANSWERED, NEWER_NO_REPLY]);

    renderWidgetOpen();

    await waitFor(() => expect(screen.getAllByText(/المشكلة الأولى|استفسار جديد/)).toHaveLength(2));
    // OLDER_BUT_ANSWERED's reply (08-24) is the newest activity overall, so its
    // card renders BEFORE the newer-but-untouched ticket's card.
    const bodies = screen.getAllByText(/المشكلة الأولى|استفسار جديد/).map((el) => el.textContent);
    expect(bodies).toEqual(["المشكلة الأولى", "استفسار جديد"]);
  });

  it("the awaiting-reply filter hides the answered ticket", async () => {
    storage.listThreadSummaries.mockResolvedValue([
      summaryOf(NEWER_NO_REPLY),
      summaryOf(OLDER_BUT_ANSWERED),
    ]);
    storage.loadThreads.mockResolvedValue([OLDER_BUT_ANSWERED, NEWER_NO_REPLY]);

    renderWidgetOpen();
    await screen.findByText("استفسار جديد");
    await screen.findByText("المشكلة الأولى");

    fireEvent.click(screen.getByRole("button", { name: "بانتظار الرد" }));

    expect(screen.getByText("استفسار جديد")).toBeInTheDocument();
    expect(screen.queryByText("المشكلة الأولى")).toBeNull();
  });
});
