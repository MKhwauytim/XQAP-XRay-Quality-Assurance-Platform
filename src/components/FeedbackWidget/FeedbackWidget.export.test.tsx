/* @vitest-environment jsdom */
// Workstream B (2026-09-28): the real admin can export every conversation from
// the "all messages" tab. The full read happens ONLY on click (never on panel
// open), in chunks with progress, and an unreadable thread is reported.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import type {
  FeedbackMessage,
  FeedbackThread,
  FeedbackThreadSummary,
} from "../../data/feedback/feedbackStorage";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { DEFAULT_LABELS, resetAllLabels, type Labels } from "../../data/labels/labelsStore";

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

const reader = vi.hoisted(() => ({ spy: vi.fn() }));

vi.mock("../../data/feedback/feedbackExportRead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackExportRead")>();
  reader.spy.mockImplementation(actual.readAllThreadsForExport);
  return { ...actual, readAllThreadsForExport: (...args: Parameters<typeof actual.readAllThreadsForExport>) => reader.spy(...args) };
});

const exporter = vi.hoisted(() => ({
  run: vi.fn<
    (threads: readonly FeedbackMessage[], labels: Labels) => Promise<{ threadCount: number; messageCount: number }>
  >(),
}));

vi.mock("../../data/feedback/feedbackExport", () => ({
  exportFeedbackWorkbook: exporter.run,
}));

const THREAD: FeedbackThread = {
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

const SUMMARY: FeedbackThreadSummary = {
  threadId: THREAD.id,
  from: THREAD.from,
  role: THREAD.role,
  category: THREAD.category,
  status: THREAD.status,
  createdAt: THREAD.timestamp,
  lastActivityAt: THREAD.timestamp,
  preview: THREAD.text,
};

function session(role: AuthSession["role"], mode?: "demo"): AuthSession {
  return { username: "boss", role, loginAt: "2026-09-28T08:00:00.000Z", ...(mode ? { mode } : {}) };
}

async function openAllMessages(as: AuthSession) {
  writeSession(as);
  render(
    <FeedbackUnreadProvider session={as}>
      <FeedbackWidget />
    </FeedbackUnreadProvider>
  );
  // A real admin has no floating trigger (AdminToolbar owns it) -- open the
  // panel the way that toolbar button does.
  act(() => {
    window.dispatchEvent(new CustomEvent("feedback:toggle"));
  });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(DEFAULT_LABELS.fb_tab_all) }));
  await screen.findByText(THREAD.text);
}

describe("FeedbackWidget — admin export", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
    storage.listThreadSummaries.mockReset().mockResolvedValue([SUMMARY]);
    storage.loadThreads.mockReset().mockResolvedValue([]);
    storage.loadFeedback.mockReset().mockResolvedValue([THREAD]);
    reader.spy.mockClear();
    exporter.run.mockReset().mockResolvedValue({ threadCount: 1, messageCount: 1 });
  });
  afterEach(() => {
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });

  it("reads every thread only when the button is clicked, then exports them", async () => {
    storage.loadThreads.mockImplementation(async (_dir, ids) => (ids.includes(THREAD.id) ? [THREAD] : []));
    await openAllMessages(session("admin"));
    // Pinned at the source: opening the panel and the all-messages tab never starts the export read.
    expect(reader.spy).not.toHaveBeenCalled();
    const summaryReadsBeforeClick = storage.listThreadSummaries.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));

    await waitFor(() => expect(exporter.run).toHaveBeenCalledTimes(1));
    const [threads, labels] = exporter.run.mock.calls[0]!;
    expect(threads.map((t) => t.id)).toEqual([THREAD.id]);
    expect(labels.fb_export_sheet_threads).toBe(DEFAULT_LABELS.fb_export_sheet_threads);
    expect(reader.spy).toHaveBeenCalledTimes(1);
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReadsBeforeClick + 1);
  });

  it("does not read the workspace for the export until it is clicked", async () => {
    await openAllMessages(session("admin"));
    expect(reader.spy).not.toHaveBeenCalled();
    const summaryReads = storage.listThreadSummaries.mock.calls.length;
    const fullReads = storage.loadFeedback.mock.calls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(exporter.run).not.toHaveBeenCalled();
    expect(storage.listThreadSummaries.mock.calls.length).toBe(summaryReads);
    expect(storage.loadFeedback.mock.calls.length).toBe(fullReads);
  });

  it("shows the read state on the button while the threads are being read", async () => {
    await openAllMessages(session("admin"));
    let releaseRead!: () => void;
    storage.loadThreads.mockImplementation(
      (_dir, ids) => new Promise((resolve) => { releaseRead = () => resolve(ids.includes(THREAD.id) ? [THREAD] : []); })
    );
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    const busy = await screen.findByRole("button", { name: DEFAULT_LABELS.fb_exporting });
    expect(busy).toBeDisabled();
    await act(async () => releaseRead());
    await waitFor(() => expect(exporter.run).toHaveBeenCalledTimes(1));
  });

  it("still exports but says so when a thread could not be read", async () => {
    storage.listThreadSummaries.mockResolvedValue([SUMMARY, { ...SUMMARY, threadId: "t20260921100000-bbbbbbbb" }]);
    storage.loadThreads.mockImplementation(async (_dir, ids) => (ids.includes(THREAD.id) ? [THREAD] : []));
    await openAllMessages(session("admin"));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      DEFAULT_LABELS.fb_export_partial.replace("{skipped}", "1")
    );
    expect(exporter.run).toHaveBeenCalledTimes(1);
  });

  it("does not report a skipped thread that this tab already holds", async () => {
    // The panel page-loads THREAD into local state; the export read then fails on it.
    storage.loadFeedback.mockResolvedValue([]);
    storage.loadThreads.mockImplementationOnce(async () => [THREAD]);
    await openAllMessages(session("admin"));
    storage.loadThreads.mockImplementation(async () => []);
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    await waitFor(() => expect(exporter.run).toHaveBeenCalledTimes(1));
    expect(exporter.run.mock.calls[0]![0].map((t) => t.id)).toEqual([THREAD.id]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the button while the export runs", async () => {
    let finish!: (value: { threadCount: number; messageCount: number }) => void;
    exporter.run.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await openAllMessages(session("admin"));

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.fb_exporting })).toBeDisabled());
    await act(async () => finish({ threadCount: 1, messageCount: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeEnabled());
  });

  it("reports an empty export as empty", async () => {
    exporter.run.mockResolvedValue({ threadCount: 0, messageCount: 0 });
    await openAllMessages(session("admin"));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    expect(await screen.findByRole("status")).toHaveTextContent(DEFAULT_LABELS.fb_export_empty);
  });

  it("surfaces a failed export as an alert", async () => {
    exporter.run.mockRejectedValue(new Error("boom"));
    await openAllMessages(session("admin"));
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.fb_export_btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(DEFAULT_LABELS.fb_export_failed);
  });

  it("is not offered to a manager or to a demo session", async () => {
    await openAllMessages(session("manager"));
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeNull();
    cleanup();
    await openAllMessages(session("admin", "demo"));
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.fb_export_btn })).toBeNull();
  });
});
