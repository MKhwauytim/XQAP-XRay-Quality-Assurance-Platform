/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { countUnsentAnswers } from "./answerLocalMirror";
import {
  __resetAnswerOutboxForTests, flushAnswersNow, getAnswerSubmitMode, requestAnswerFlush, setAnswerSubmitMode, submitAnswerLocalFirst,
} from "./answerOutbox";

const item = { xrayImageId: "A", templateId: "t", templateVersion: 1, answers: [], lastSavedAt: "2026-10-13T10:00:00.000Z",
  submittedAt: "2026-10-13T10:00:00.000Z", answeredBy: "u1", status: "submitted" as const };

describe("answerOutbox", () => {
  beforeEach(() => { installFreshIndexedDb(); __resetAnswerOutboxForTests(); localStorage.clear(); });

  it("submit stores locally and reports stored:true without touching any directory", async () => {
    expect(await submitAnswerLocalFirst("m", "u1", item)).toEqual({ stored: true });
    expect(await countUnsentAnswers("u1")).toBe(1);
  });

  it("reports stored:false when IndexedDB is unavailable so the caller can fall back", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await submitAnswerLocalFirst("m", "u1", item)).toEqual({ stored: false });
  });

  it("mode defaults to outbox and can be switched back to sync", () => {
    expect(getAnswerSubmitMode()).toBe("outbox");
    setAnswerSubmitMode("sync");
    expect(getAnswerSubmitMode()).toBe("sync");
  });

  it("coalesces requests made while a flush runs into exactly one follow-up pass", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const replay = vi.fn(async () => { await gate; return { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0 }; });
    const dir = {} as never;
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    requestAnswerFlush(dir, "u1", { immediate: true, replay });
    release();
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
  });

  it("a failing flush never throws to the caller and the next request still runs", async () => {
    const replay = vi.fn().mockRejectedValueOnce(new Error("share down")).mockResolvedValue({ replayed: 1, alreadyOnDisk: 0, failed: 0, cannotLand: 0 });
    requestAnswerFlush({} as never, "u1", { immediate: true, replay });
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
    requestAnswerFlush({} as never, "u1", { immediate: true, replay });
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
  });

  it("flushAnswersNow resolves with the pass's summary and cancels a pending debounced flush", async () => {
    const summary = { replayed: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 2, blocked: { "month-closed": 2 } };
    const debounced = vi.fn(async () => summary);
    requestAnswerFlush({} as never, "u1", { replay: debounced, debounceMs: 20 });
    const replay = vi.fn(async () => summary);
    await expect(flushAnswersNow({} as never, "u1", replay)).resolves.toEqual(summary);
    await new Promise((r) => setTimeout(r, 40));
    expect(debounced).not.toHaveBeenCalled();
  });
});
