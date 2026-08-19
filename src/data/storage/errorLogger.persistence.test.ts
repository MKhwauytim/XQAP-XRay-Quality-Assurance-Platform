/* @vitest-environment jsdom */
// persist-error-log (Batch 4): the ring buffer in errorLogger.ts is mirrored
// to localStorage (`xray_error_log_v1`) so it survives a reload — the exact
// moment a user says "it broke and I reloaded" is when the in-memory-only
// ring used to die. Kept in its own jsdom file (not merged into
// errorLogger.test.ts, which stays on the default node environment) because
// this suite needs real localStorage and repeatedly re-imports the module
// fresh via vi.resetModules() to exercise module-init hydration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "xray_error_log_v1";

async function freshModule() {
  vi.resetModules();
  return import("./errorLogger");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("errorLogger · localStorage persistence", () => {
  it("logError mirrors the entry to localStorage", async () => {
    const { logError } = await freshModule();

    logError("test-context", new Error("boom"));

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].context).toBe("test-context");
    expect(persisted[0].message).toBe("boom");
  });

  it("a fresh module instance restores entries from localStorage, tagged restored: true", async () => {
    const first = await freshModule();
    first.logError("ctx-a", new Error("first boom"));

    const second = await freshModule();
    const restored = second.getRecentErrors();

    expect(restored).toHaveLength(1);
    expect(restored[0].context).toBe("ctx-a");
    expect(restored[0].message).toBe("first boom");
    expect(restored[0].restored).toBe(true);
  });

  it("does not tag an entry logged within the current module lifetime as restored", async () => {
    const { logError, getRecentErrors } = await freshModule();

    logError("ctx-b", new Error("fresh"));

    expect(getRecentErrors()[0].restored).toBeUndefined();
  });

  it("truncates oversized context/message/stack fields", async () => {
    const { logError, getRecentErrors } = await freshModule();

    const longMessage = "m".repeat(600);
    const longContext = "c".repeat(200);
    const error = new Error(longMessage);
    error.stack = "s".repeat(600);

    logError(longContext, error);

    const entry = getRecentErrors()[0];
    expect(entry.context).toHaveLength(100);
    expect(entry.message).toHaveLength(500);
    expect(entry.stack).toHaveLength(500);

    // Truncation applies to the persisted copy too.
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted[0].context).toHaveLength(100);
    expect(persisted[0].message).toHaveLength(500);
    expect(persisted[0].stack).toHaveLength(500);
  });

  it("a throwing localStorage.setItem (quota exceeded) does not throw out of logError and does not recurse", async () => {
    const { logError, getRecentErrors } = await freshModule();

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => logError("ctx-quota", new Error("boom"))).not.toThrow();
    // The in-memory ring is still updated — persistence failing is silent and
    // best-effort, it must not roll back the entry that was already logged.
    expect(getRecentErrors()).toHaveLength(1);
    expect(getRecentErrors()[0].context).toBe("ctx-quota");
    // Called exactly once: the re-entrancy guard means a throwing setItem
    // cannot trigger a second, recursive persistence attempt.
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it("clearErrors wipes both the in-memory ring and the localStorage key", async () => {
    const { logError, clearErrors, getRecentErrors } = await freshModule();

    logError("ctx-c", new Error("boom"));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    clearErrors();

    expect(getRecentErrors()).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hydration tolerates a corrupted/foreign payload without throwing at module init", async () => {
    localStorage.setItem(STORAGE_KEY, "not valid json{{{");

    const { getRecentErrors } = await freshModule();

    expect(getRecentErrors()).toHaveLength(0);
  });

  it("hydration ignores a non-array payload", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));

    const { getRecentErrors } = await freshModule();

    expect(getRecentErrors()).toHaveLength(0);
  });
});
