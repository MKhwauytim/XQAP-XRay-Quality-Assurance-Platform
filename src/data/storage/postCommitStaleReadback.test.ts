// Error-log group E3 (2026-09-28): on the SMB share, the read-back of a write
// this client JUST committed can raise InvalidStateError (stale (size, mtime)
// snapshot) for longer than the ordinary read ladder (~630 ms). safeWriteJson
// used to throw there although the commit had landed, and casLoop then re-ran
// the whole attempt -- a fresh commit that re-armed the same stale window --
// until it exhausted (`casLoop:exhausted(feedback:threadsIndex) [XQ-IO-036]`,
// three revisions on disk for one logical write). The post-commit read now has
// the same patience a missing entry gets.
import { afterEach, describe, expect, it } from "vitest";

import { clearErrors, getRecentErrors } from "./errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { createThread, flushPendingFeedbackIndexWrites, loadThreadsIndex } from "../feedback/feedbackStorage";

const STALE = { operation: "readFile", errorName: "InvalidStateError" } as const;

describe("post-commit stale-snapshot read-back", () => {
  afterEach(async () => {
    await flushPendingFeedbackIndexWrites();
  });

  it("safeWriteJson rides out a stale read-back longer than the ordinary read ladder", async () => {
    const root = createMemoryDirectory("root");
    // 6 consecutive stale reads of the live file: the ordinary ladder gives up
    // after 5 (1 + 4 retries), so the 6th must be absorbed by the read-back one.
    setSimulatedFaults(root, [{ ...STALE, name: "idx.json", times: 6 }]);

    await safeWriteJson(root, "idx.json", { n: 1 });

    const read = await safeReadJson<{ n: number }>(root, "idx.json");
    expect(read.ok && read.value.n).toBe(1);
  }, 20_000);

  it("a stale read-back after the index commit costs one revision, not an exhausted loop", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [{ ...STALE, name: "threads.index.json", times: 6 }]);
    clearErrors();

    const thread = await createThread(root, {
      from: "sara",
      role: "employee",
      category: "issue",
      text: "رسالة",
    });
    await flushPendingFeedbackIndexWrites();

    const index = await loadThreadsIndex(root);
    expect(index.threads.map((row) => row.threadId)).toEqual([thread.id]);
    expect(index.revision).toBe(1);
    expect(getRecentErrors().filter((e) => e.context.includes("feedback"))).toEqual([]);
  }, 20_000);
});
