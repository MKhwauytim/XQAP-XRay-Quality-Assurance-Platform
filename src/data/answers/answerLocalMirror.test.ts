import { describe, expect, it } from "vitest";

import {
  countPendingAnswers,
  loadMirroredAnswers,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

// This suite runs in the default `node` test environment, which has no
// `indexedDB` global at all (unlike jsdom's DOM APIs, IndexedDB is not part
// of jsdom either — a real browser or a shim like fake-indexeddb is needed
// for that). What matters here is exactly the contract the module's own doc
// comment promises: with no IndexedDB available, every call degrades to a
// silent no-op rather than throwing — the real browser behavior is exercised
// manually (see the PR description) since introducing a new IndexedDB test
// shim is out of scope for this fix.
function item(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "tpl-1",
    templateVersion: 1,
    answers: [],
    lastSavedAt: "2026-09-09T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

describe("answerLocalMirror (no IndexedDB in this test environment)", () => {
  it("mirrorAnswerLocally never throws", async () => {
    await expect(mirrorAnswerLocally("5-may-2026", "emp1", item("X1"))).resolves.toBeUndefined();
  });

  it("loadMirroredAnswers resolves to an empty array rather than throwing or returning null", async () => {
    await expect(loadMirroredAnswers("5-may-2026", "emp1")).resolves.toEqual([]);
  });

  it("markAnswerPendingLocally never throws", async () => {
    await expect(markAnswerPendingLocally("5-may-2026", "emp1", item("X1"))).resolves.toBeUndefined();
  });

  it("countPendingAnswers resolves to 0 rather than throwing", async () => {
    await expect(countPendingAnswers("5-may-2026", "emp1")).resolves.toBe(0);
  });
});
