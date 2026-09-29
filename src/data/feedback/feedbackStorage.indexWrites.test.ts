// Workstream B (2026-09-28): the threads.index.json update after a create or a
// status change is a REBUILDABLE-CACHE write, so the user's click must not wait
// for it; and every write on the interactive path carries the interactive
// deadline down into safeWriteJson's own read-back ladders.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/safeWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/safeWrite")>();
  return { ...actual, safeWriteJson: vi.fn(actual.safeWriteJson) };
});

import { safeWriteJson } from "../storage/safeWrite";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import {
  appendReply,
  createThread,
  FEEDBACK_THREADS_INDEX_FILE,
  flushPendingFeedbackIndexWrites,
  loadThreadsIndex,
} from "./feedbackStorage";

const writeSpy = vi.mocked(safeWriteJson);

function deadlineLabelsFor(fileName: string): (string | undefined)[] {
  return writeSpy.mock.calls
    .filter((call) => call[1] === fileName)
    .map((call) => {
      const options = call[3];
      return typeof options === "object" && options !== null ? options.deadline?.label : undefined;
    });
}

describe("feedbackStorage — index writes are background, writes carry a deadline", () => {
  afterEach(async () => {
    await flushPendingFeedbackIndexWrites();
    writeSpy.mockClear();
  });

  it("createThread resolves before its index write has finished failing", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [
      {
        operation: "createWritable",
        name: FEEDBACK_THREADS_INDEX_FILE,
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    clearErrors();

    await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });

    // The failing index write needs its retry ladder to give up before it can
    // log -- which the click no longer waits for.
    expect(getRecentErrors().filter((e) => e.context.startsWith("feedback:createThreadIndex"))).toHaveLength(0);

    await flushPendingFeedbackIndexWrites();
    expect(getRecentErrors().filter((e) => e.context.startsWith("feedback:createThreadIndex"))).toHaveLength(1);
    clearSimulatedFaults(root);
  });

  it("the background index write still lands", async () => {
    const root = createMemoryDirectory("root");
    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });
    await flushPendingFeedbackIndexWrites();
    expect((await loadThreadsIndex(root)).threads.map((t) => t.threadId)).toEqual([thread.id]);
  });

  it("passes the interactive deadline to the thread-file and index writes", async () => {
    const root = createMemoryDirectory("root");
    writeSpy.mockClear();

    const thread = await createThread(root, { from: "sara", role: "employee", category: "issue", text: "رسالة" });
    await flushPendingFeedbackIndexWrites();
    expect(deadlineLabelsFor(`${thread.id}.json`)).toEqual(["feedback:createThread"]);
    expect(deadlineLabelsFor(FEEDBACK_THREADS_INDEX_FILE)).toEqual(["feedback:threadsIndex"]);

    writeSpy.mockClear();
    await appendReply(
      root,
      thread.id,
      { from: "admin", role: "admin", text: "تم", timestamp: "2026-09-28T10:00:00.000Z" },
      true
    );
    await flushPendingFeedbackIndexWrites();
    expect(deadlineLabelsFor(`${thread.id}.json`)).toEqual(["feedback:threadReply"]);
    expect(deadlineLabelsFor(FEEDBACK_THREADS_INDEX_FILE)).toEqual(["feedback:threadsIndex"]);
  });
});
