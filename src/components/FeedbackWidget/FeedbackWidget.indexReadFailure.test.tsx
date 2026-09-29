/* @vitest-environment jsdom */
// Task 1 review fix (2026-09-28): a failed thread-index read on panel open
// used to be silently swallowed. It must now be logged (so it is visible in
// the durable error log) and must never crash or blank the panel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type { FeedbackThreadSummary } from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const directoryHandle = { name: "workspace" };

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const storage = vi.hoisted(() => ({
  listThreadSummaries: vi.fn<() => Promise<FeedbackThreadSummary[]>>(),
}));

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    listThreadSummaries: storage.listThreadSummaries,
    loadFeedback: async () => [],
  };
});

const errorLogger = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("../../data/storage/errorLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/storage/errorLogger")>();
  return {
    ...actual,
    logError: errorLogger.logError,
  };
});

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: "2026-09-28T08:00:00.000Z" };

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));
}

describe("FeedbackWidget — a failed thread-index read is logged, not swallowed", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset();
    errorLogger.logError.mockReset();
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("logs the failure via errorLogger and still renders the panel", async () => {
    const failure = new Error("index read failed");
    storage.listThreadSummaries.mockRejectedValue(failure);

    writeSession(SARA);
    render(
      <FeedbackUnreadProvider session={SARA}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    openPanel();

    await screen.findByRole("dialog");

    expect(errorLogger.logError).toHaveBeenCalledWith(
      "feedbackWidget:listThreadSummaries",
      failure
    );
    // The panel is still usable -- no crash, no blank screen.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
