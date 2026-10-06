/* @vitest-environment jsdom */
// Workstream B (2026-09-28): opening the panel must render from the thread
// INDEX first. The provider's full aggregate read (`loadFeedback`, every thread
// file) runs in the background and must never gate the first render.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackWidget } from "./FeedbackWidget";
import { FeedbackUnreadProvider } from "../../data/feedback/FeedbackUnreadProvider";
import { listThreadSummaries, type FeedbackThread } from "../../data/feedback/feedbackStorage";
import { safeWriteJson } from "../../data/storage/safeWrite";
import { clearReadLog, createMemoryDirectory, getReadLog } from "../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { getFeedbackThreadsDir } from "../../data/workspace/workspacePaths";
import type { AuthSession } from "../../auth/authTypes";
import { clearSession, writeSession } from "../../auth/authSession";
import { resetAllLabels } from "../../data/labels/labelsStore";

const workspace = vi.hoisted(() => ({ dir: null as DirectoryHandleLike | null }));

vi.mock("../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: workspace.dir, refreshPermissions: () => {} }),
}));

// Holds every full-aggregate read until the test opens the gate, so "the panel
// rendered before the full read" is an ordering the test controls rather than
// a race it hopes to win.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});

vi.mock("../../data/feedback/feedbackStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../data/feedback/feedbackStorage")>();
  return {
    ...actual,
    loadFeedback: async (dir: DirectoryHandleLike) => {
      await gate.opened;
      return actual.loadFeedback(dir);
    },
  };
});

function thread(id: string, from: string, text: string, second: number): FeedbackThread {
  return {
    id,
    from,
    role: "employee",
    category: "issue",
    text,
    timestamp: new Date(Date.UTC(2026, 8, 20, 10, 0, second)).toISOString(),
    status: "open",
    replies: [],
    revision: 1,
  };
}

const SARA_THREADS = [
  thread("t20260920100001-aaaaaaa1", "sara", "رسالة سارة الأولى", 1),
  thread("t20260920100002-aaaaaaa2", "sara", "رسالة سارة الثانية", 2),
  thread("t20260920100003-aaaaaaa3", "sara", "رسالة سارة الثالثة", 3),
];
const OTHER_THREADS = [
  thread("t20260920100004-bbbbbbb4", "omar", "رسالة عمر", 4),
  thread("t20260920100005-bbbbbbb5", "omar", "رسالة عمر الثانية", 5),
  thread("t20260920100006-bbbbbbb6", "lina", "رسالة لينا", 6),
  thread("t20260920100007-bbbbbbb7", "lina", "رسالة لينا الثانية", 7),
  thread("t20260920100008-bbbbbbb8", "huda", "رسالة هدى", 8),
];

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root", { trackReads: true });
  const threadsDir = await getFeedbackThreadsDir(root, true);
  for (const t of [...SARA_THREADS, ...OTHER_THREADS]) {
    await safeWriteJson<FeedbackThread>(threadsDir, `${t.id}.json`, t);
  }
  // Builds threads.index.json so the steady-state open costs 0 recovery reads.
  await listThreadSummaries(root, { repairIndex: true });
  clearReadLog(root);
  return root;
}

function threadFileReads(root: DirectoryHandleLike): string[] {
  return getReadLog(root)
    .filter((path) => path.includes("/threads/") && path.endsWith(".json"))
    .map((path) => path.slice(path.lastIndexOf("/") + 1, -".json".length));
}

const SARA: AuthSession = { username: "sara", role: "employee", loginAt: new Date().toISOString() };

describe("FeedbackWidget — open renders from the index before any full read", () => {
  beforeEach(() => {
    clearSession();
    resetAllLabels();
    localStorage.clear();
  });
  afterEach(() => {
    gate.open();
    cleanup();
    clearSession();
    resetAllLabels();
    localStorage.clear();
    workspace.dir = null;
  });

  it("shows the user's threads while the provider's full read is still pending", async () => {
    const root = await seedWorkspace();
    workspace.dir = root;
    writeSession(SARA);
    render(
      <FeedbackUnreadProvider session={SARA}>
        <FeedbackWidget />
      </FeedbackUnreadProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /التواصل والاقتراحات|غير مقروءة/ }));

    // The full read is still gated, yet the panel has already rendered.
    expect(await screen.findByText("رسالة سارة الأولى")).toBeInTheDocument();
    expect(await screen.findByText("رسالة سارة الثالثة")).toBeInTheDocument();

    // Only the visible page's thread files were opened -- never another user's.
    const reads = new Set(threadFileReads(root));
    for (const other of OTHER_THREADS) expect(reads.has(other.id)).toBe(false);
    for (const own of SARA_THREADS) expect(reads.has(own.id)).toBe(true);

    // The background reload still happens once the full read is allowed to run.
    gate.open();
    await waitFor(() => {
      const after = new Set(threadFileReads(root));
      for (const other of OTHER_THREADS) expect(after.has(other.id)).toBe(true);
    });
  });
});
