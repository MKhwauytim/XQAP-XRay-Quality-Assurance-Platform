import { describe, expect, it } from "vitest";

import { summarizeFeedbackThread, type FeedbackMessage, type FeedbackThread } from "./feedbackStorage";
import {
  indexThreadsById,
  mergeFeedbackThreads,
  mergeSummariesWithLocalThreads,
  missingThreadIds,
  pickFresherThread,
} from "./feedbackThreadMerge";

function thread(overrides: Partial<FeedbackThread> & { id: string }): FeedbackThread {
  return {
    from: "sara",
    role: "employee",
    category: "issue",
    text: "نص",
    timestamp: "2026-09-20T10:00:00.000Z",
    status: "open",
    replies: [],
    ...overrides,
  };
}

const REPLY = { from: "admin", role: "admin", text: "رد", timestamp: "2026-09-21T10:00:00.000Z" };

describe("pickFresherThread", () => {
  it("returns whichever copy exists when only one does", () => {
    const t = thread({ id: "t1" });
    expect(pickFresherThread(t, undefined)).toBe(t);
    expect(pickFresherThread(undefined, t)).toBe(t);
    expect(pickFresherThread(undefined, undefined)).toBeUndefined();
  });

  it("prefers the higher revision", () => {
    const local = thread({ id: "t1", revision: 3 });
    const polled = thread({ id: "t1", revision: 2, replies: [REPLY, REPLY] });
    expect(pickFresherThread(local, polled)).toBe(local);
    expect(pickFresherThread(thread({ id: "t1", revision: 1 }), polled)).toBe(polled);
  });

  it("falls back to reply count, then keeps the local copy on a full tie", () => {
    const local = thread({ id: "t1" });
    const polled: FeedbackMessage = thread({ id: "t1", replies: [REPLY] });
    expect(pickFresherThread(local, polled)).toBe(polled);
    const tieLocal = thread({ id: "t1", revision: 2 });
    const tiePolled = thread({ id: "t1", revision: 2 });
    expect(pickFresherThread(tieLocal, tiePolled)).toBe(tieLocal);
  });
});

describe("missingThreadIds", () => {
  it("returns only ids neither source holds, de-duplicated and sorted", () => {
    const local = { b: thread({ id: "b" }) };
    const polled = indexThreadsById([thread({ id: "d" })]);
    expect(missingThreadIds(["e", "b", "c", "d", "c", "a"], local, polled)).toEqual(["a", "c", "e"]);
  });

  it("is order-insensitive -- a re-sort of the page yields the same set", () => {
    const polled = indexThreadsById([]);
    expect(missingThreadIds(["x", "y"], {}, polled)).toEqual(missingThreadIds(["y", "x"], {}, polled));
  });
});

describe("mergeFeedbackThreads", () => {
  it("unions both sources, resolves each id to its fresher copy, newest-first", () => {
    const polledOld = thread({ id: "t1", revision: 1, timestamp: "2026-09-20T10:00:00.000Z" });
    const polledOther = thread({ id: "t2", revision: 1, timestamp: "2026-09-22T10:00:00.000Z" });
    const localNewer = thread({ id: "t1", revision: 2, replies: [REPLY], timestamp: "2026-09-20T10:00:00.000Z" });
    const localOnly = thread({ id: "t3", revision: 1, timestamp: "2026-09-23T10:00:00.000Z" });

    const merged = mergeFeedbackThreads([polledOld, polledOther], { t1: localNewer, t3: localOnly });

    expect(merged.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(merged.find((t) => t.id === "t1")).toBe(localNewer);
  });
});

describe("mergeSummariesWithLocalThreads", () => {
  const OLD = thread({ id: "t-old", timestamp: "2026-09-20T10:00:00.000Z" });
  const NEW = thread({ id: "t-new", timestamp: "2026-09-28T09:00:00.000Z" });

  it("keeps a locally created thread the listing does not have, newest first", () => {
    const merged = mergeSummariesWithLocalThreads([summarizeFeedbackThread(OLD)], { "t-new": NEW });
    expect(merged.map((row) => row.threadId)).toEqual(["t-new", "t-old"]);
  });

  it("uses the local summary when the local thread has later activity", () => {
    const resolved = thread({ ...OLD, status: "resolved", replies: [REPLY], revision: 2 });
    const merged = mergeSummariesWithLocalThreads([summarizeFeedbackThread(OLD)], { "t-old": resolved });
    expect(merged[0]).toMatchObject({ status: "resolved", lastActivityAt: REPLY.timestamp });
  });

  it("lets a listed row that is newer than the local copy stand", () => {
    const other = thread({ ...OLD, status: "resolved", replies: [REPLY] });
    const merged = mergeSummariesWithLocalThreads([summarizeFeedbackThread(other)], { "t-old": OLD });
    expect(merged[0]).toMatchObject({ status: "resolved" });
  });
});
