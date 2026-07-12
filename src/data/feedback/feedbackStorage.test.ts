import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import {
  loadFeedback,
  replyToFeedback,
  submitFeedback,
  type FeedbackMessage,
} from "./feedbackStorage";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
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
});
