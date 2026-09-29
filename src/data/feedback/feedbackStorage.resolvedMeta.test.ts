// Workstream B (2026-09-28): resolving a thread stamps WHEN and BY WHOM, as
// new OPTIONAL fields. Older threads simply lack them -- no migration, because
// no existing field changes shape.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import { getFeedbackThreadsDir } from "../workspace/workspacePaths";
import {
  appendReply,
  createThread,
  flushPendingFeedbackIndexWrites,
  loadThread,
  type FeedbackThread,
} from "./feedbackStorage";

const RESOLVE_REPLY = { from: "admin", role: "admin", text: "تم الحل", timestamp: "2026-09-28T10:00:00.000Z" };

describe("feedbackStorage — resolvedAt / resolvedBy", () => {
  it("stamps resolvedAt and resolvedBy from the resolving reply, in the returned and stored thread", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    const updated = await appendReply(root, thread.id, RESOLVE_REPLY, true);
    await flushPendingFeedbackIndexWrites();

    expect(updated.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(updated.resolvedBy).toBe("admin");
    const stored = await loadThread(root, thread.id);
    expect(stored?.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(stored?.resolvedBy).toBe("admin");
  });

  it("a plain reply sets neither field", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });

    const updated = await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "نراجع", timestamp: "2026-09-28T09:00:00.000Z" },
      false
    );
    await flushPendingFeedbackIndexWrites();

    expect(updated.resolvedAt).toBeUndefined();
    expect(updated.resolvedBy).toBeUndefined();
  });

  it("resolving an already-resolved thread keeps the FIRST resolution", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "خطأ" });
    await appendReply(root, thread.id, RESOLVE_REPLY, true);
    await flushPendingFeedbackIndexWrites();

    const again = await appendReply(
      root,
      thread.id,
      { from: "manager1", role: "manager", text: "ملاحظة", timestamp: "2026-09-29T10:00:00.000Z" },
      true
    );
    await flushPendingFeedbackIndexWrites();

    expect(again.resolvedAt).toBe("2026-09-28T10:00:00.000Z");
    expect(again.resolvedBy).toBe("admin");
  });

  it("a legacy resolved thread without the fields still loads, with them absent", async () => {
    const root = createMemoryDirectory("root");
    const legacy: FeedbackThread = {
      id: "t20260101100000-dddddddd",
      from: "omar",
      role: "employee",
      category: "inquiry",
      text: "قديم",
      timestamp: "2026-01-01T10:00:00.000Z",
      status: "resolved",
      replies: [{ from: "admin", role: "admin", text: "تم", timestamp: "2026-01-02T10:00:00.000Z" }],
      revision: 2,
    };
    await safeWriteJson<FeedbackThread>(await getFeedbackThreadsDir(root, true), `${legacy.id}.json`, legacy);

    const loaded = await loadThread(root, legacy.id);
    expect(loaded?.status).toBe("resolved");
    expect(loaded?.resolvedAt).toBeUndefined();
    expect(loaded?.resolvedBy).toBeUndefined();
  });
});
