// Review fix (A6): a SYNCHRONOUS throw from `indexedDB.open` (Chromium SecurityError,
// opaque origin, blocked storage) must resolve the mirror layer to "no mirror" like
// every other failure. It used to touch the cached promise in its temporal dead zone
// and reject, so a landed save reported failure and a failed save was not queued.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backfillMirrorFromDisk,
  countPendingAnswers,
  isAnswerQueuedPending,
  loadMirroredAnswers,
  loadPendingAnswerRecords,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

const item: ItemAnswer = {
  xrayImageId: "X", templateId: "t", templateVersion: 1, answers: [],
  lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy: "e", status: "draft",
};

afterEach(() => vi.unstubAllGlobals());

describe("the mirror layer never throws when indexedDB.open throws synchronously", () => {
  it("resolves every API to its safe default, repeatedly", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        const e = new Error("denied");
        e.name = "SecurityError";
        throw e;
      },
    });
    for (let i = 0; i < 2; i += 1) {
      await expect(mirrorAnswerLocally("m", "e", item)).resolves.toBeUndefined();
      await expect(markAnswerPendingLocally("m", "e", item)).resolves.toBeUndefined();
      await expect(backfillMirrorFromDisk("m", "e", [item])).resolves.toBeUndefined();
      await expect(countPendingAnswers("m", "e")).resolves.toBe(0);
      await expect(loadMirroredAnswers("m", "e")).resolves.toEqual([]);
      await expect(loadPendingAnswerRecords("e")).resolves.toEqual([]);
      await expect(isAnswerQueuedPending("m", "e", item)).resolves.toBe(false);
    }
  });
});
