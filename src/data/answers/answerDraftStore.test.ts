/* @vitest-environment jsdom */
// An in-progress answer must survive a save that fails.
//
// Employees reported ~1 submission in 10 hanging for about a minute and then
// failing, and having to "fill the information and study it again". The save
// failure itself is share contention (XQ-IO-032, 55 rows in the production
// log). Losing the typed work on top of it is the app's own doing: the panel
// holds the answers in React state seeded once at mount, so anything that
// remounts it after a failed submit — navigating to another sample and back,
// the tab-mount LRU, or the page reload an impatient user does after a
// minute-long hang — takes the work with it.
import { beforeEach, describe, expect, it } from "vitest";

import {
  answerDraftKey,
  clearAnswerDraft,
  loadAnswerDraft,
  pruneAnswerDrafts,
  saveAnswerDraft,
} from "./answerDraftStore";

const KEY = answerDraftKey("5-may-2026", "IMG-1", "emp-1");

beforeEach(() => {
  localStorage.clear();
});

describe("answerDraftStore", () => {
  it("returns what was last written for that sample", () => {
    saveAnswerDraft(KEY, { f1: "سليمة", f2: 3 });
    expect(loadAnswerDraft(KEY)).toEqual({ f1: "سليمة", f2: 3 });
  });

  it("keeps drafts for different samples, employees and months apart", () => {
    saveAnswerDraft(KEY, { f1: "a" });
    saveAnswerDraft(answerDraftKey("5-may-2026", "IMG-2", "emp-1"), { f1: "b" });
    saveAnswerDraft(answerDraftKey("5-may-2026", "IMG-1", "emp-2"), { f1: "c" });
    saveAnswerDraft(answerDraftKey("6-june-2026", "IMG-1", "emp-1"), { f1: "d" });

    expect(loadAnswerDraft(KEY)).toEqual({ f1: "a" });
    expect(loadAnswerDraft(answerDraftKey("5-may-2026", "IMG-2", "emp-1"))).toEqual({ f1: "b" });
    expect(loadAnswerDraft(answerDraftKey("5-may-2026", "IMG-1", "emp-2"))).toEqual({ f1: "c" });
    expect(loadAnswerDraft(answerDraftKey("6-june-2026", "IMG-1", "emp-1"))).toEqual({ f1: "d" });
  });

  it("is gone once the answer is actually saved", () => {
    saveAnswerDraft(KEY, { f1: "a" });
    clearAnswerDraft(KEY);
    expect(loadAnswerDraft(KEY)).toBeNull();
  });

  it("treats an empty draft as nothing to restore", () => {
    saveAnswerDraft(KEY, {});
    expect(loadAnswerDraft(KEY)).toBeNull();
  });

  it("survives unparseable stored content rather than throwing at mount", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadAnswerDraft(KEY)).toBeNull();
  });

  it("drops drafts older than the retention window, keeping recent ones", () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    localStorage.setItem(KEY, JSON.stringify({ savedAt: old, values: { f1: "stale" } }));
    saveAnswerDraft(answerDraftKey("5-may-2026", "IMG-9", "emp-1"), { f1: "fresh" });

    pruneAnswerDrafts();

    expect(loadAnswerDraft(KEY)).toBeNull();
    expect(loadAnswerDraft(answerDraftKey("5-may-2026", "IMG-9", "emp-1"))).toEqual({ f1: "fresh" });
  });

  it("never throws when storage itself refuses (private mode, quota, file:// bucket cleared)", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => saveAnswerDraft(KEY, { f1: "a" })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
