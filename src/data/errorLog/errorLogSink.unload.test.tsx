/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetErrorSinkForTests, clearErrors, logError } from "../storage/errorLogger";
import { __resetErrorContextForTests } from "../storage/errorContext";
import { readAllWorkspaceErrors } from "./errorLogStorage";
import { __getPendingCountForTests, installWorkspaceErrorSink } from "./errorLogSink";

let uninstall: (() => void) | null = null;

beforeEach(() => {
  clearErrors();
  __resetErrorSinkForTests();
  __resetErrorContextForTests();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

describe("errorLogSink unload durability", () => {
  it("flushes on pagehide and when the tab becomes hidden, ignoring the minimum interval", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({
      directoryHandle: dir, username: "alice", minFlushIntervalMs: 300_000,
    });

    logError("ctx-a", new Error("a"));
    await vi.advanceTimersByTimeAsync(6_000); // first flush (no prior flush)
    logError("ctx-b", new Error("b"));
    // Well inside the 5 min interval: the timer would not fire, pagehide must.
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(2);

    logError("ctx-c", new Error("c"));
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(3);
    expect(__getPendingCountForTests()).toBe(0);
  });
});
