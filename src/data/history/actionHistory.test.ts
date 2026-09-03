import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  ACTION_HISTORY_RETENTION_COUNT,
  loadActionHistory,
  recordActionHistorySnapshot,
} from "./actionHistory";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("recordActionHistorySnapshot / loadActionHistory", () => {
  it("records the previous state and reads it back newest-first", async () => {
    const root = makeRoot();
    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      scopeParts: ["tmpl-1"],
      actor: "admin",
      action: "template-create",
      previousState: null,
    });
    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      scopeParts: ["tmpl-1"],
      actor: "admin",
      action: "template-edit",
      previousState: { templateId: "tmpl-1", version: 1 },
    });

    const history = await loadActionHistory(root, "templates", ["tmpl-1"]);
    expect(history).toHaveLength(2);
    expect(history[0]!.action).toBe("template-edit");
    expect(history[0]!.state).toEqual({ templateId: "tmpl-1", version: 1 });
    expect(history[1]!.action).toBe("template-create");
    expect(history[1]!.state).toBeNull();
  });

  it("keeps distinct scopes (e.g. different template ids) separate", async () => {
    const root = makeRoot();
    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      scopeParts: ["tmpl-a"],
      actor: "admin",
      action: "template-edit",
      previousState: { templateId: "tmpl-a" },
    });
    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      scopeParts: ["tmpl-b"],
      actor: "admin",
      action: "template-edit",
      previousState: { templateId: "tmpl-b" },
    });

    const a = await loadActionHistory(root, "templates", ["tmpl-a"]);
    const b = await loadActionHistory(root, "templates", ["tmpl-b"]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.state).toEqual({ templateId: "tmpl-a" });
    expect(b[0]!.state).toEqual({ templateId: "tmpl-b" });
  });

  it("prunes to the most recent ACTION_HISTORY_RETENTION_COUNT snapshots", async () => {
    const root = makeRoot();
    for (let i = 0; i < ACTION_HISTORY_RETENTION_COUNT + 5; i += 1) {
      await recordActionHistorySnapshot({
        directoryHandle: root,
        family: "answers",
        scopeParts: ["5-may-2026", "emp1", "XR-1"],
        actor: "emp1",
        action: "answer:answer-save",
        previousState: { revision: i },
      });
    }

    const history = await loadActionHistory<{ revision: number }>(root, "answers", [
      "5-may-2026",
      "emp1",
      "XR-1",
    ]);
    expect(history).toHaveLength(ACTION_HISTORY_RETENTION_COUNT);
    // Newest first, and the oldest entries were pruned away.
    expect(history[0]!.state?.revision).toBe(ACTION_HISTORY_RETENTION_COUNT + 4);
    expect(history[history.length - 1]!.state?.revision).toBe(5);
  });

  it("never throws even when the write fails (best-effort)", async () => {
    const root = makeRoot();
    // A directory handle whose getDirectoryHandle rejects simulates a
    // workspace write failure — recordActionHistorySnapshot must swallow it.
    const brokenSystemDir = {
      ...root,
      getDirectoryHandle: async () => {
        throw new Error("boom");
      },
    } as unknown as DirectoryHandleLike;

    await expect(
      recordActionHistorySnapshot({
        directoryHandle: brokenSystemDir,
        family: "templates",
        scopeParts: ["tmpl-1"],
        actor: "admin",
        action: "template-edit",
        previousState: null,
      })
    ).resolves.toBeUndefined();
  });
});
