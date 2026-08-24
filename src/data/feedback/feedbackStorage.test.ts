import { describe, expect, it } from "vitest";

import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedWritePermission,
} from "../storage/memoryDirectory";
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
  migrateLegacyMessages,
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

async function seedLegacyLog(
  root: DirectoryHandleLike,
  messages: FeedbackMessage[],
  where: "system" | "workspace-root"
): Promise<void> {
  const dir =
    where === "system"
      ? await (await root.getDirectoryHandle("5-system", { create: true })).getDirectoryHandle(
          SYSTEM_FOLDER_NAMES.feedback,
          { create: true }
        )
      : await root.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: true });
  // Legacy writers persisted the bare array (wrapped only by safeWriteJson's envelope).
  await safeWriteJson<FeedbackMessage[]>(dir, "messages.json", messages);
}

const LEGACY_ONE: FeedbackMessage = {
  id: "legacy-1",
  from: "old",
  role: "employee",
  category: "inquiry",
  text: "قديم",
  timestamp: "2026-06-01T00:00:00.000Z",
  status: "open",
  replies: [],
};

const LEGACY_TWO: FeedbackMessage = {
  id: "legacy-2",
  from: "older",
  role: "supervisor",
  category: "issue",
  text: "أقدم",
  timestamp: "2026-05-01T00:00:00.000Z",
  status: "resolved",
  replies: [{ from: "admin", role: "admin", text: "تم", timestamp: "2026-05-02T00:00:00.000Z" }],
};

describe("feedbackStorage — per-thread storage", () => {
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

  it("survives two concurrent submits without losing either (cross-machine CAS)", async () => {
    const root = makeRoot();
    // Two users on two PCs submit at the same instant. Each mints its own
    // never-before-used thread id — neither can clobber the other, because
    // there is no shared file for them to contend on.
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

describe("feedbackStorage — legacy migration", () => {
  it("splits a legacy messages.json into one thread file per message on first read", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId).sort()).toEqual(["legacy-1", "legacy-2"]);

    // Each message is now its own self-contained file, replies included.
    const two = await loadThread(root, "legacy-2");
    expect(two!.status).toBe("resolved");
    expect(two!.replies).toHaveLength(1);
  });

  it("never touches the legacy messages.json", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "system");
    const systemDir = await root.getDirectoryHandle("5-system", { create: false });
    const feedbackDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, { create: false });
    const before = await (await (await feedbackDir.getFileHandle("messages.json")).getFile()).text();

    await listThreadSummaries(root);
    await submitFeedback(root, { from: "new", role: "admin", category: "issue", text: "جديد" });

    const after = await (await (await feedbackDir.getFileHandle("messages.json")).getFile()).text();
    expect(after).toBe(before);
  });

  it("migrates from the legacy workspace-ROOT feedback/ folder too", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "workspace-root");

    const summaries = await listThreadSummaries(root);
    expect(summaries.map((s) => s.threadId)).toEqual(["legacy-1"]);
  });

  it("is idempotent — a second call migrates nothing and duplicates nothing", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    const first = await migrateLegacyMessages(root);
    expect(first.migrated).toBe(2);
    const second = await migrateLegacyMessages(root);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe("already-migrated");

    expect((await listThreadSummaries(root)).map((s) => s.threadId).sort()).toEqual([
      "legacy-1",
      "legacy-2",
    ]);
  });

  it("survives two clients migrating the same workspace concurrently", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE, LEGACY_TWO], "system");

    await Promise.all([migrateLegacyMessages(root), migrateLegacyMessages(root)]);

    // Thread files are keyed by the legacy id, so both writers produce
    // byte-identical content at identical names -- no duplicates, no loss.
    const index = await loadThreadsIndex(root);
    expect(index.threads.map((t) => t.threadId).sort()).toEqual(["legacy-1", "legacy-2"]);
  });

  it("never migrates on top of existing threads", async () => {
    const root = makeRoot();
    await createThread(root, { from: "sara", role: "employee", category: "issue", text: "حديث" });
    await seedLegacyLog(root, [LEGACY_ONE], "system");

    const outcome = await migrateLegacyMessages(root);
    expect(outcome.skipped).toBe("already-migrated");
    expect(outcome.migrated).toBe(0);
    // The legacy message stays visible through the legacy fallback in
    // loadFeedback -- but it is NOT copied over an already-migrated workspace,
    // which would resurrect messages a later state deliberately supersedes.
    expect((await listThreadSummaries(root)).map((s) => s.threadId)).not.toContain("legacy-1");
  });

  it("still serves legacy messages read-only when the workspace cannot be written", async () => {
    const root = makeRoot();
    await seedLegacyLog(root, [LEGACY_ONE], "system");
    setSimulatedWritePermission(root, "denied", "denied");

    // A guest with a read grant must still SEE the history; migration failing
    // is not a reason to show an empty panel.
    const messages = await loadFeedback(root);
    expect(messages.map((m) => m.id)).toEqual(["legacy-1"]);
  });

  it("reports no legacy data for a brand-new workspace", async () => {
    const root = makeRoot();
    const outcome = await migrateLegacyMessages(root);
    expect(outcome).toEqual({ migrated: 0, skipped: "no-legacy-data" });
  });
});

describe("feedbackStorage — loadFeedback aggregate", () => {
  it("returns every thread as a FeedbackMessage, newest-first", async () => {
    const root = makeRoot();
    const first = await createThread(root, { from: "a", role: "employee", category: "issue", text: "أ" });
    const second = await createThread(root, { from: "b", role: "employee", category: "issue", text: "ب" });
    await appendReply(root, first.id, { from: "admin", role: "admin", text: "رد", timestamp: "2026-08-24T11:00:00.000Z" }, false);

    const messages = await loadFeedback(root);
    expect(messages.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(messages.find((m) => m.id === first.id)!.replies).toHaveLength(1);
  });

  it("keeps the submit -> reply -> resolve round trip working through the wrappers", async () => {
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
});
