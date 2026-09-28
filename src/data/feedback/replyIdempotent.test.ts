/**
 * E3b fix round — DURABLE writes (feedback replies) are idempotent by their own
 * id, so "committed but could not be read back" is retried, never accepted blind
 * and never re-committed as a duplicate.
 *
 * The interleavings are driven by wrapping `safeWriteJson`: the first call for
 * the thread file runs the real write, then optionally lets ANOTHER writer commit
 * (from a snapshot taken BEFORE ours: the lost-update interleaving), then reports
 * `committedUnverified` like a stale post-commit read-back would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getFeedbackThreadsDir } from "../workspace/workspacePaths";

const hooks = vi.hoisted(() => ({
  /** Runs after the REAL write of the first thread-file save, before it resolves. */
  afterFirstCommit: null as null | (() => Promise<void>),
  fired: false,
}));

vi.mock("../storage/safeWrite", async (importOriginal) => {
  const original = await importOriginal<typeof import("../storage/safeWrite")>();
  return {
    ...original,
    safeWriteJson: (async (dir: never, fileName: string, value: unknown, options?: never) => {
      const result = await original.safeWriteJson(dir, fileName, value, options);
      if (hooks.afterFirstCommit && !hooks.fired && fileName.startsWith("t2")) {
        hooks.fired = true;
        await hooks.afterFirstCommit();
        return { committedUnverified: true, cause: new Error("simulated stale read-back") };
      }
      return result;
    }) as typeof original.safeWriteJson,
  };
});

import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import {
  appendReply,
  createThread,
  feedbackThreadFileName,
  loadThread,
  type FeedbackThread,
} from "./feedbackStorage";

beforeEach(() => {
  clearErrors();
  hooks.afterFirstCommit = null;
  hooks.fired = false;
});
afterEach(() => {
  clearErrors();
});

const reply = (text: string) => ({ from: text, role: "admin", text, timestamp: new Date().toISOString() });

async function setup() {
  const root = createMemoryDirectory("reply-idem") as DirectoryHandleLike;
  const thread = await createThread(root, { from: "u", role: "employee", category: "issue", text: "hi" });
  // Rename-proof hook target: the thread file name is `t…`; the wrapper matches "t2".
  expect(feedbackThreadFileName(thread.id).startsWith("t2")).toBe(true);
  const threadsDir = await getFeedbackThreadsDir(root, true);
  return { root, thread, threadsDir, fileName: feedbackThreadFileName(thread.id) };
}

/** Another writer commits from the snapshot taken BEFORE our commit. */
async function otherWriterCommits(
  threadsDir: DirectoryHandleLike,
  fileName: string,
  before: FeedbackThread,
  text: string
): Promise<void> {
  const current = await safeReadJson<FeedbackThread>(threadsDir, fileName);
  const revision = current.ok ? (current.value.revision ?? 0) : 0;
  await safeWriteJson<FeedbackThread>(threadsDir, fileName, {
    ...before,
    replies: [...before.replies, { ...reply(text), id: `other-${text}` }],
    revision: revision + 1,
    _writeToken: `other-token-${text}`,
  });
}

const repliesOf = async (root: DirectoryHandleLike, id: string) =>
  ((await loadThread(root, id))?.replies ?? []).map((r) => r.text);

describe("appendReply is idempotent by reply id", () => {
  it("unverified, then the token read returns ANOTHER writer's token: retry, our reply lands exactly once", async () => {
    const { root, thread, threadsDir, fileName } = await setup();
    const before = (await loadThread(root, thread.id))!;
    hooks.afterFirstCommit = () => otherWriterCommits(threadsDir, fileName, before, "B");

    await appendReply(root, thread.id, reply("A"), false);

    const texts = await repliesOf(root, thread.id);
    expect(texts.filter((t) => t === "A")).toHaveLength(1);
    expect(texts.filter((t) => t === "B")).toHaveLength(1);
  });

  it("unverified, then the token read ALSO throws: retry finds our reply id, exactly one copy, nothing re-committed blindly", async () => {
    const { root, thread } = await setup();
    const file = feedbackThreadFileName(thread.id);
    setSimulatedFaults(root, [
      { operation: "readFile", name: file, errorName: "NotReadableError", times: 12, rearmAfterClose: true },
    ]);

    await appendReply(root, thread.id, reply("A"), false);

    setSimulatedFaults(root, []);
    expect(await repliesOf(root, thread.id)).toEqual(["A"]);
    expect(getRecentErrors().filter((e) => e.context.includes("casLoop:exhausted"))).toEqual([]);
  });

  it("the lost-race interleaving (A read, B read, A commit, B commit, A's reads failing): both replies present exactly once", async () => {
    const { root, thread, threadsDir, fileName } = await setup();
    const before = (await loadThread(root, thread.id))!;
    hooks.afterFirstCommit = async () => {
      await otherWriterCommits(threadsDir, fileName, before, "B");
      // From now on our reads of the file fail for a while (NotReadable).
      setSimulatedFaults(root, [
        { operation: "readFile", name: fileName, errorName: "NotReadableError", times: 12, rearmAfterClose: false },
      ]);
    };

    await appendReply(root, thread.id, reply("A"), false);

    setSimulatedFaults(root, []);
    const texts = await repliesOf(root, thread.id);
    expect(texts.filter((t) => t === "A")).toHaveLength(1);
    expect(texts.filter((t) => t === "B")).toHaveLength(1);
  });
});
