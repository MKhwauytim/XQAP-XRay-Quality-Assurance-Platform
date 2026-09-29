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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerDraftKey,
  clearAnswerDraft,
  clearAnswerDraftAndLegacy,
  isAnswerDraftPersistFailing,
  loadAnswerDraft,
  loadAnswerDraftWithLegacyFallback,
  pruneAnswerDrafts,
  saveAnswerDraft,
  saveAnswerDraftMigratingLegacy,
  subscribeAnswerDraftHealth,
  __resetAnswerDraftHealthForTests,
} from "./answerDraftStore";

const KEY = answerDraftKey("5-may-2026", "IMG-1", "emp-1");

beforeEach(() => {
  localStorage.clear();
  __resetAnswerDraftHealthForTests();
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

describe("draft persistence health (A1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetAnswerDraftHealthForTests();
  });

  it("reports a refused write, notifies subscribers, and recovers on the next successful write", async () => {
    const listener = vi.fn();
    const stop = subscribeAnswerDraftHealth(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(saveAnswerDraft("xray_answer_draft_v1:m::IMG-1::emp1", { note: "x" })).toBe(false);
    expect(isAnswerDraftPersistFailing()).toBe(true);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    expect(saveAnswerDraft("xray_answer_draft_v1:m::IMG-1::emp1", { note: "x" })).toBe(true);
    expect(isAnswerDraftPersistFailing()).toBe(false);
    stop();
  });
});

describe("legacy-key fallback and migration (A1 fix round 1)", () => {
  const LEGACY_KEY = answerDraftKey("5-may-2026", "ADHOC-imp-1-XR-9", "emp-1");
  const CANONICAL_KEY = answerDraftKey("adhoc-imp-1", "ADHOC-imp-1-XR-9", "emp-1");

  it("finds a draft saved under the old key when the canonical key has nothing", () => {
    saveAnswerDraft(LEGACY_KEY, { f1: "old-key-draft" });

    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, LEGACY_KEY)).toEqual({
      f1: "old-key-draft",
    });
  });

  it("prefers the canonical key when both have something", () => {
    saveAnswerDraft(LEGACY_KEY, { f1: "old" });
    saveAnswerDraft(CANONICAL_KEY, { f1: "new" });

    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, LEGACY_KEY)).toEqual({ f1: "new" });
  });

  it("returns null when neither key has anything, and tolerates a null legacy key", () => {
    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, LEGACY_KEY)).toBeNull();
    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, null)).toBeNull();
  });

  it("migrates a legacy draft onto the canonical key on the first successful write", () => {
    saveAnswerDraft(LEGACY_KEY, { f1: "old-key-draft" });

    const ok = saveAnswerDraftMigratingLegacy(CANONICAL_KEY, LEGACY_KEY, { f1: "typed" });

    expect(ok).toBe(true);
    expect(loadAnswerDraft(LEGACY_KEY)).toBeNull();
    expect(loadAnswerDraft(CANONICAL_KEY)).toEqual({ f1: "typed" });
  });

  it("leaves the legacy draft alone when the canonical write is refused", () => {
    saveAnswerDraft(LEGACY_KEY, { f1: "old-key-draft" });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      const ok = saveAnswerDraftMigratingLegacy(CANONICAL_KEY, LEGACY_KEY, { f1: "typed" });
      expect(ok).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }

    expect(loadAnswerDraft(LEGACY_KEY)).toEqual({ f1: "old-key-draft" });
  });

  it("clears both the canonical and legacy keys once the answer is genuinely on disk", () => {
    saveAnswerDraft(LEGACY_KEY, { f1: "old" });
    saveAnswerDraft(CANONICAL_KEY, { f1: "new" });

    clearAnswerDraftAndLegacy(CANONICAL_KEY, LEGACY_KEY);

    expect(loadAnswerDraft(LEGACY_KEY)).toBeNull();
    expect(loadAnswerDraft(CANONICAL_KEY)).toBeNull();
  });

  it("clearAnswerDraftAndLegacy tolerates a null legacy key (the non-ad-hoc case)", () => {
    saveAnswerDraft(CANONICAL_KEY, { f1: "new" });
    expect(() => clearAnswerDraftAndLegacy(CANONICAL_KEY, null)).not.toThrow();
    expect(loadAnswerDraft(CANONICAL_KEY)).toBeNull();
  });

  it("still finds an old-key draft saved when no month at all was selected (selectedMonth === \"\")", () => {
    const emptyMonthLegacyKey = answerDraftKey("", "ADHOC-imp-1-XR-9", "emp-1");
    saveAnswerDraft(emptyMonthLegacyKey, { f1: "no-month-draft" });

    expect(loadAnswerDraftWithLegacyFallback(CANONICAL_KEY, emptyMonthLegacyKey)).toEqual({
      f1: "no-month-draft",
    });
  });
});
