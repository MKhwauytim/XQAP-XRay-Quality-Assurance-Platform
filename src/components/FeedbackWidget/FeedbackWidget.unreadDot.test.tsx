/* @vitest-environment jsdom */
// The orange unread dot on the feedback ("chat") trigger: it must light up when
// somebody else writes to this user, and go out once they have actually opened
// the panel — not merely by clicking anything, and not on a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type { FeedbackMessage } from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const loadFeedback = vi.fn<() => Promise<FeedbackMessage[]>>();

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return { ...actual, loadFeedback: () => loadFeedback() };
});

const REPLIED_TO_EMP: FeedbackMessage = {
  id: "m1",
  from: "emp-1",
  role: "employee",
  category: "issue",
  text: "الجهاز لا يعمل",
  timestamp: "2026-08-19T09:00:00.000Z",
  status: "open",
  replies: [
    { from: "admin", role: "admin", text: "تم الاطلاع", timestamp: "2026-08-19T10:00:00.000Z" },
  ],
};

function session(username: string, role: AuthSession["role"]): AuthSession {
  return { username, role, loginAt: new Date().toISOString() };
}

function renderWidget(as: AuthSession) {
  writeSession(as);
  return render(
    <FeedbackUnreadProvider session={as}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
}

const dot = (container: HTMLElement) => container.querySelector(".fb-fab-dot");

beforeEach(() => {
  clearSession();
  resetAllLabels();
  localStorage.clear();
  loadFeedback.mockReset();
  loadFeedback.mockResolvedValue([REPLIED_TO_EMP]);
});

afterEach(() => {
  cleanup();
  clearSession();
  resetAllLabels();
  localStorage.clear();
});

describe("FeedbackWidget — unread dot", () => {
  it("shows the dot when an admin has replied to this employee", async () => {
    const { container } = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(dot(container)).not.toBeNull());
  });

  it("does not show the dot for a colleague with nothing addressed to them", async () => {
    const { container } = renderWidget(session("emp-2", "employee"));
    await waitFor(() => expect(loadFeedback).toHaveBeenCalled());
    expect(dot(container)).toBeNull();
  });

  it("shows the dot to a manager for a message an employee sent", async () => {
    const { container } = renderWidget(session("boss", "manager"));
    await waitFor(() => expect(dot(container)).not.toBeNull());
  });

  it("clears the dot once the panel has actually been opened", async () => {
    const { container } = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(dot(container)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /غير مقروءة/ }));
    // The panel replaces the floating button while it is open.
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dot(container)).toBeNull();
  });

  it("keeps the dot out once seen, even across a fresh mount", async () => {
    const first = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(dot(first.container)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /غير مقروءة/ }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dot(first.container)).toBeNull());
    cleanup();

    const second = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(loadFeedback).toHaveBeenCalled());
    expect(dot(second.container)).toBeNull();
  });

  it("lights the dot again when a newer reply arrives after the last visit", async () => {
    const first = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(dot(first.container)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /غير مقروءة/ }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dot(first.container)).toBeNull());
    cleanup();

    loadFeedback.mockResolvedValue([
      {
        ...REPLIED_TO_EMP,
        replies: [
          ...REPLIED_TO_EMP.replies,
          { from: "admin", role: "admin", text: "تم الإصلاح", timestamp: "2026-08-19T13:00:00.000Z" },
        ],
      },
    ]);
    const second = renderWidget(session("emp-1", "employee"));
    await waitFor(() => expect(dot(second.container)).not.toBeNull());
  });
});
