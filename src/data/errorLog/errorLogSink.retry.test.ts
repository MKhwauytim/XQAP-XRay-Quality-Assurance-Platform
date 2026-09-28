import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetErrorSinkForTests, clearErrors, logError } from "../storage/errorLogger";
import { __resetErrorContextForTests } from "../storage/errorContext";

// Wrap the real checked writer: it can be told to (a) land the batch and still
// report failure, or (b) fail without writing, and it counts every attempt.
const control = vi.hoisted(() => ({ mode: "real" as "real" | "land-then-fail" | "fail", calls: 0 }));
vi.mock("./errorLogStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./errorLogStorage")>();
  return {
    ...actual,
    appendUserErrorsChecked: async (...args: Parameters<typeof actual.appendUserErrorsChecked>) => {
      control.calls += 1;
      if (control.mode === "fail") return false;
      const ok = await actual.appendUserErrorsChecked(...args);
      return control.mode === "land-then-fail" ? false : ok;
    },
  };
});

import { readAllWorkspaceErrors } from "./errorLogStorage";
import { errorsFileName } from "./errorLogPaths";
import { __getPendingCountForTests, flushErrorLogNow, installWorkspaceErrorSink } from "./errorLogSink";

let uninstall: (() => void) | null = null;

beforeEach(() => {
  clearErrors();
  __resetErrorSinkForTests();
  __resetErrorContextForTests();
  control.mode = "real";
  control.calls = 0;
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

describe("errorLogSink retries", () => {
  it("a batch that landed but reported failure is not duplicated when retried", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("ctx-a", new Error("a"));
    logError("ctx-b", new Error("b"));
    control.mode = "land-then-fail";
    await flushErrorLogNow(); // committed on disk, reported as failed -> requeued
    expect(__getPendingCountForTests()).toBe(2);

    control.mode = "real";
    await flushErrorLogNow(); // retry re-sends the SAME ids
    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.message).sort()).toEqual(["a", "b"]);
    // The RAW file too (the export dedups by id, the file must not carry copies).
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("alice"), { create: false });
    expect(JSON.parse(await (await handle.getFile()).text()).data.entries).toHaveLength(2);
    expect(__getPendingCountForTests()).toBe(0);
  });

  it("after a failed flush, new errors do not fire more write attempts until the interval elapses", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({
      directoryHandle: dir, username: "alice", minFlushIntervalMs: 120_000,
    });
    control.mode = "fail";

    for (let i = 0; i < 25; i++) logError(`ctx-${i}`, new Error(`e${i}`));
    await vi.advanceTimersByTimeAsync(10);
    expect(control.calls).toBe(1);

    // 30 more errors: pending is well past the batch size, but no new attempt.
    for (let i = 0; i < 30; i++) logError(`more-${i}`, new Error(`m${i}`));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(control.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(61_000); // interval elapsed: exactly one retry
    expect(control.calls).toBe(2);
    expect(__getPendingCountForTests()).toBe(55);
  });
});
