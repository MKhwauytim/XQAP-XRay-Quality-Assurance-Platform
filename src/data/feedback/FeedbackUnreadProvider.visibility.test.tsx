/* @vitest-environment jsdom */
// The background feedback poll used to read every ticket's full body on a
// blind 60 s timer, for every signed-in user, on every page, whether or not
// anyone had the widget open. This is the regression guard for the
// 2026-08-25 fix: the timer tick is skipped while the tab is hidden, and a
// `visibilitychange` listener catches it back up once the tab is looked at
// again -- see FeedbackUnreadProvider's own doc for why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { FeedbackUnreadProvider } from "./FeedbackUnreadProvider";
import { useFeedbackUnread } from "./useFeedbackUnread";
import type { FeedbackMessage } from "./feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";

const directoryHandle = { name: "workspace" };

vi.mock("../workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle, refreshPermissions: () => {} }),
}));

const loadFeedback = vi.fn<() => Promise<FeedbackMessage[]>>();

vi.mock("./feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./feedbackStorage")>();
  return { ...actual, loadFeedback: () => loadFeedback() };
});

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function Consumer() {
  useFeedbackUnread();
  return null;
}

function session(username: string): AuthSession {
  return { username, role: "employee", loginAt: new Date().toISOString() };
}

describe("FeedbackUnreadProvider — visibility-gated background poll", () => {
  beforeEach(() => {
    loadFeedback.mockReset().mockResolvedValue([]);
    setDocumentHidden(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "hidden");
  });

  it("skips the timer tick's full read while the tab is hidden", async () => {
    render(
      <FeedbackUnreadProvider session={session("emp-1")}>
        <Consumer />
      </FeedbackUnreadProvider>
    );
    await vi.waitFor(() => expect(loadFeedback).toHaveBeenCalledTimes(1));

    setDocumentHidden(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // The tab was hidden the whole time -- no extra full-aggregate read.
    expect(loadFeedback).toHaveBeenCalledTimes(1);
  });

  it("still polls on the timer while the tab stays visible", async () => {
    render(
      <FeedbackUnreadProvider session={session("emp-1")}>
        <Consumer />
      </FeedbackUnreadProvider>
    );
    await vi.waitFor(() => expect(loadFeedback).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => expect(loadFeedback).toHaveBeenCalledTimes(2));
  });

  it("reloads once on becoming visible again, catching up a hidden tab", async () => {
    render(
      <FeedbackUnreadProvider session={session("emp-1")}>
        <Consumer />
      </FeedbackUnreadProvider>
    );
    await vi.waitFor(() => expect(loadFeedback).toHaveBeenCalledTimes(1));

    setDocumentHidden(true);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(loadFeedback).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(loadFeedback).toHaveBeenCalledTimes(2));
  });
});
