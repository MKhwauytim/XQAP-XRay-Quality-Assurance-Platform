import { describe, expect, it } from "vitest";

import { clearOperationLog, createMemoryDirectory, getOperationLog } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import {
  appendReply,
  createThread,
  listThreadSummaries,
  loadFeedback,
  loadThread,
  loadThreads,
  loadThreadsIndex,
  replyToFeedback,
  submitFeedback,
  type FeedbackMessage,
  type FeedbackThread,
} from "./feedbackStorage";

function makeRoot(
  name = "root",
  options: Parameters<typeof createMemoryDirectory>[1] = {}
): DirectoryHandleLike {
  return createMemoryDirectory(name, options) as DirectoryHandleLike;
}

describe("feedbackStorage", () => {
  it("submits a message and reads it back", async () => {
    const root = makeRoot();
    await submitFeedback(root, {
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح",
    });

    const messages = await loadFeedback(root);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("اقتراح");
    expect(messages[0]!.status).toBe("open");
  });

  it("appends a reply and can resolve a message", async () => {
    const root = makeRoot();
    await submitFeedback(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    const [msg] = await loadFeedback(root);

    await replyToFeedback(
      root,
      msg!.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-07-01T10:00:00.000Z" },
      true
    );

    const [after] = await loadFeedback(root);
    expect(after!.replies).toHaveLength(1);
    expect(after!.status).toBe("resolved");
  });

  it("reads the legacy bare-array messages.json shape", async () => {
    const root = makeRoot();
    const feedbackDir = await root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {
      create: true,
    });
    const legacy: FeedbackMessage[] = [
      {
        id: "legacy-1",
        from: "old",
        role: "employee",
        category: "inquiry",
        text: "قديم",
        timestamp: "2026-06-01T00:00:00.000Z",
        status: "open",
        replies: [],
      },
    ];
    // Legacy writers persisted the bare array (wrapped only by safeWriteJson's envelope).
    await safeWriteJson<FeedbackMessage[]>(feedbackDir, "messages.json", legacy);

    const messages = await loadFeedback(root);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe("legacy-1");

    // A subsequent write migrates the file forward without losing the legacy entry.
    await submitFeedback(root, { from: "new", role: "admin", category: "issue", text: "جديد" });
    const after = await loadFeedback(root);
    expect(after).toHaveLength(2);
    expect(after.some((m) => m.id === "legacy-1")).toBe(true);
    expect(after.some((m) => m.from === "new")).toBe(true);
  });

  it("writes new feedback under 5-system/feedback/, not the legacy workspace-root folder", async () => {
    const root = makeRoot();
    await submitFeedback(root, { from: "sara", role: "employee", category: "suggestion", text: "اقتراح" });

    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {
      create: false,
    });
    const handle = await feedbackDir.getFileHandle("messages.json", { create: false });
    const text = await (await handle.getFile()).text();
    expect(text).toContain("اقتراح");

    // Nothing was ever written to the legacy root-level folder for a fresh workspace.
    await expect(
      root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false })
    ).rejects.toThrow();
  });

  it("survives two concurrent submits without losing either (cross-machine CAS)", async () => {
    const root = makeRoot();
    // Two users on two PCs submit at the same instant. Each read the list, each
    // unshifts its own message — neither may clobber the other. The
    // withResourceLock + casLoop read-back/retry loop must land both.
    await Promise.all([
      submitFeedback(root, { from: "userA", role: "employee", category: "suggestion", text: "من الجهاز الأول" }),
      submitFeedback(root, { from: "userB", role: "supervisor", category: "issue", text: "من الجهاز الثاني" }),
    ]);

    const messages = await loadFeedback(root);
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.from).sort()).toEqual(["userA", "userB"]);
  });

  it("writes a new thread to its own file under 5-system/feedback/threads/", async () => {
    const root = makeRoot();
    const thread = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح",
    });

    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {
      create: false,
    });
    const threadsDir = await feedbackDir.getDirectoryHandle("threads", { create: false });
    const handle = await threadsDir.getFileHandle(`${thread.id}.json`, { create: false });
    expect(await (await handle.getFile()).text()).toContain("اقتراح");

    // The shared legacy log is never written to by the new path.
    await expect(feedbackDir.getFileHandle("messages.json", { create: false })).rejects.toThrow();
  });

  it("appends the new thread's summary to threads.index.json", async () => {
    const root = makeRoot();
    const thread = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "issue",
      text: "سطر أول\nسطر ثانٍ",
    });

    const index = await loadThreadsIndex(root);
    expect(index.threads).toHaveLength(1);
    expect(index.threads[0]!.threadId).toBe(thread.id);
    expect(index.threads[0]!.status).toBe("open");
    // Preview is the FIRST LINE only -- the body stays in the thread file.
    expect(index.threads[0]!.preview).toBe("سطر أول");
    expect(index.threads[0]!.preview).not.toContain("سطر ثانٍ");
  });

  it("two concurrent submits never touch the same thread file (the contention fix)", async () => {
    const root = makeRoot("root", { trackOperations: true });
    clearOperationLog(root);

    const [a, b] = await Promise.all([
      createThread(root, { from: "userA", role: "employee", category: "suggestion", text: "من الجهاز الأول" }),
      createThread(root, { from: "userB", role: "supervisor", category: "issue", text: "من الجهاز الثاني" }),
    ]);

    expect(a.id).not.toBe(b.id);
    const written = getOperationLog(root)
      .filter((entry) => entry.operation === "createWritable")
      .map((entry) => entry.name);
    // Each submit wrote its OWN thread file. The two names are disjoint, so no
    // retry ladder can be triggered by the other writer -- that is the fix.
    expect(written).toContain(`${a.id}.json`);
    expect(written).toContain(`${b.id}.json`);

    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.from).sort()).toEqual(["userA", "userB"]);
  });

  it("loadThread returns null for an id that has no file, and the thread for one that does", async () => {
    const root = makeRoot();
    const created = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "suggestion",
      text: "اقتراح",
    });

    expect(await loadThread(root, "t20260101000000-deadbeef")).toBeNull();
    const found = await loadThread(root, created.id);
    expect(found?.text).toBe("اقتراح");
    expect(found?.status).toBe("open");
    expect(found?.replies).toEqual([]);
  });

  it("loadThreads reads only the ids it is given, in the order it is given", async () => {
    const root = makeRoot();
    const a = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const b = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });
    const c = await createThread(root, { from: "c", role: "employee", category: "issue", text: "ج" });

    const loaded = await loadThreads(root, [c.id, a.id]);
    expect(loaded.map((t) => t.from)).toEqual(["c", "a"]);
    // b was never asked for and must not have been read.
    expect(loaded.some((t) => t.id === b.id)).toBe(false);
  });

  it("a reply rewrites only its own thread file and never the index", async () => {
    const root = makeRoot("root", { trackOperations: true });
    const target = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    const other = await createThread(root, { from: "omar", role: "employee", category: "issue", text: "خطأ آخر" });

    clearOperationLog(root);
    await appendReply(
      root,
      target.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-08-24T10:00:00.000Z" },
      false
    );

    const written = getOperationLog(root)
      .filter((entry) => entry.operation === "createWritable")
      .map((entry) => entry.name);
    expect(written.some((name) => name.startsWith(`${target.id}.json`))).toBe(true);
    // The other thread and the shared index are untouched -- that is the fix.
    expect(written.some((name) => name.startsWith(`${other.id}.json`))).toBe(false);
    expect(written.some((name) => name.startsWith("threads.index.json"))).toBe(false);

    const after = await loadThread(root, target.id);
    expect(after!.replies).toHaveLength(1);
    expect(after!.status).toBe("open");
  });

  it("resolving a thread updates its own file AND its index summary", async () => {
    const root = makeRoot();
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-08-24T10:00:00.000Z" },
      true
    );

    expect((await loadThread(root, thread.id))!.status).toBe("resolved");
    const summaries = await listThreadSummaries(root);
    expect(summaries.find((s) => s.threadId === thread.id)!.status).toBe("resolved");
  });

  it("replies to two DIFFERENT threads at the same instant both land", async () => {
    const root = makeRoot();
    const a = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const b = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });

    await Promise.all([
      appendReply(root, a.id, { from: "admin", role: "admin", text: "ردأ", timestamp: "2026-08-24T10:00:00.000Z" }, false),
      appendReply(root, b.id, { from: "admin", role: "admin", text: "ردب", timestamp: "2026-08-24T10:00:00.000Z" }, false),
    ]);

    expect((await loadThread(root, a.id))!.replies).toHaveLength(1);
    expect((await loadThread(root, b.id))!.replies).toHaveLength(1);
  });

  it("two concurrent replies to the SAME thread both land (residual CAS case)", async () => {
    const root = makeRoot();
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    await Promise.all([
      appendReply(root, thread.id, { from: "admin1", role: "admin", text: "أولاً", timestamp: "2026-08-24T10:00:00.000Z" }, false),
      appendReply(root, thread.id, { from: "admin2", role: "manager", text: "ثانياً", timestamp: "2026-08-24T10:00:01.000Z" }, false),
    ]);

    const after = await loadThread(root, thread.id);
    expect(after!.replies.map((r) => r.from).sort()).toEqual(["admin1", "admin2"]);
  });

  it("appendReply rejects an unknown thread id instead of inventing one", async () => {
    const root = makeRoot();
    await expect(
      appendReply(root, "t20260101000000-deadbeef", { from: "admin", role: "admin", text: "x", timestamp: "2026-08-24T10:00:00.000Z" }, false)
    ).rejects.toThrow();
  });

  it("listThreadSummaries folds in a thread the index never recorded, and repairs the index", async () => {
    const root = makeRoot();
    const known = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "معروف" });

    // Simulate a create whose index write lost the CAS race permanently: the
    // thread file is on disk, the index does not mention it.
    const orphan: FeedbackThread = {
      id: "t20260824120000-aaaaaaaa",
      from: "omar",
      role: "employee",
      category: "inquiry",
      text: "يتيم",
      timestamp: "2026-08-24T12:00:00.000Z",
      status: "open",
      replies: [],
    };
    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
    const threadsDir = await feedbackDir.getDirectoryHandle("threads", { create: false });
    await safeWriteJson<FeedbackThread>(threadsDir, `${orphan.id}.json`, orphan);

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId).sort()).toEqual([known.id, orphan.id].sort());

    // Repaired in place, so the next read costs no extra thread opens.
    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.threadId).sort()).toEqual([known.id, orphan.id].sort());
  });

  it("orders summaries newest-first by createdAt", async () => {
    const root = makeRoot();
    const first = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const second = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });

    const summaries = await listThreadSummaries(root);
    expect(summaries[0]!.threadId).toBe(second.id);
    expect(summaries[1]!.threadId).toBe(first.id);
  });
});
