import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __resetErrorSinkForTests, clearErrors, logError } from "../storage/errorLogger";
import { __resetErrorContextForTests, setErrorActor } from "../storage/errorContext";
import { isReadOnlyMode, setReadOnlyMode } from "../storage/readOnlyMode";
import { readAllWorkspaceErrors } from "./errorLogStorage";
import { errorsFileName } from "./errorLogPaths";
import {
  __getPendingCountForTests,
  flushErrorLogNow,
  installWorkspaceErrorSink,
} from "./errorLogSink";

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
  // Defensive — a test that throws mid-way must not leak read-only mode into
  // the next test file.
  if (isReadOnlyMode()) setReadOnlyMode(false);
});

describe("errorLogSink", () => {
  it("persists a logged error to the signed-in user's own file", async () => {
    const dir = createMemoryDirectory("root");
    setErrorActor("alice", "employee");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("population:save", new Error("boom"));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      username: "alice",
      context: "population:save",
      action: "population:save",
      message: "boom",
    });
  });

  // The sink used to skip only contexts starting with `errorlog:`. `casLoop`
  // reports its own exhaustion as `casLoop:exhausted(<context>)`, so a failed
  // error-log write was enqueued as a fresh error destined for the same failing
  // file — the log joining the storm it was recording. One production day
  // carried 44 of these.
  it("never enqueues its own write failures", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("casLoop:exhausted(errorLog:userFile)", new Error("share said no"));
    logError("errorlog:append", new Error("share said no"));
    expect(__getPendingCountForTests()).toBe(0);

    logError("casLoop:exhausted(answers:employeeFile)", new Error("a real one"));
    expect(__getPendingCountForTests()).toBe(1);

    await flushErrorLogNow();
    const all = await readAllWorkspaceErrors(dir);
    expect(all.map((e) => e.context)).toEqual(["casLoop:exhausted(answers:employeeFile)"]);
  });

  it("batches a burst into ONE write instead of one write per error", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    for (let i = 0; i < 10; i++) logError(`ctx-${i}`, new Error(`boom-${i}`));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    expect(all).toHaveLength(10);
    const system = await dir.getDirectoryHandle("5-system", { create: false });
    const errors = await system.getDirectoryHandle("system-errors", { create: false });
    const handle = await errors.getFileHandle(errorsFileName("alice"), { create: false });
    const parsed = JSON.parse(await (await handle.getFile()).text());
    // One flush, one revision — not ten.
    expect(parsed.data.revision).toBe(1);
  });

  it("flushes automatically once the batch threshold is reached", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice", batchSize: 3 });

    for (let i = 0; i < 3; i++) logError(`ctx-${i}`, new Error("boom"));
    await vi.runAllTimersAsync();

    expect(await readAllWorkspaceErrors(dir)).toHaveLength(3);
  });

  it("flushes on a timer even when the batch never fills", async () => {
    vi.useFakeTimers();
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice", flushDelayMs: 5_000 });

    logError("ctx", new Error("boom"));
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(0);

    // runAllTimersAsync, not a bounded advanceTimersByTimeAsync(5_000): the
    // flush timer fires at t=5000, but the write it triggers goes through
    // casLoop's own internal (real, unmocked-in-intent) verify-delay sleep —
    // a SECOND, nested fake timer scheduled just past the 5s mark. A bounded
    // advance stops before that nested timer fires, leaving its promise
    // permanently pending once this test's afterEach swaps back to real
    // timers — and because withResourceLock's fallback-lock chain is a
    // module-level map keyed only by username (see webLocks.ts), a promise
    // that never settles holds "alice"'s lock forever and hangs every later
    // test in this file that touches the same username. Fully draining with
    // runAllTimersAsync lets that nested sleep resolve before the test ends.
    await vi.runAllTimersAsync();
    expect(await readAllWorkspaceErrors(dir)).toHaveLength(1);
  });

  it("drops the OLDEST pending entries past the queue cap, and records how many", async () => {
    const dir = createMemoryDirectory("root");
    uninstall = installWorkspaceErrorSink({
      directoryHandle: dir, username: "alice", maxPending: 5, flushDelayMs: 1_000_000,
    });

    for (let i = 0; i < 12; i++) logError(`ctx-${i}`, new Error(`boom-${i}`));
    await flushErrorLogNow();

    const all = await readAllWorkspaceErrors(dir);
    // 5 kept + 1 synthetic "N dropped" marker. An error storm is bounded
    // memory, and the fact that it WAS a storm survives to the export.
    expect(all).toHaveLength(6);
    expect(all.some((e) => e.context === "errorlog:overflow" && e.message.includes("7"))).toBe(true);
    expect(all.map((e) => e.message)).toContain("boom-11");
    expect(all.map((e) => e.message)).not.toContain("boom-0");
  });

  it("never queues its own internal failures — a failing disk cannot self-amplify", async () => {
    const dir = createMemoryDirectory("root", { initialWritePermission: "denied" });
    uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });

    logError("population:save", new Error("boom"));
    await flushErrorLogNow();
    await flushErrorLogNow();

    // The write failed and was logged to the ring buffer, but that log did not
    // enqueue anything new: a second flush has nothing left to attempt.
    expect(__getPendingCountForTests()).toBe(0);
  });

  it("writes nothing at all in read-only (demo/viewer) mode", async () => {
    const dir = createMemoryDirectory("root");
    setReadOnlyMode(true);
    try {
      uninstall = installWorkspaceErrorSink({ directoryHandle: dir, username: "demo" });
      logError("ctx", new Error("boom"));
      await flushErrorLogNow();
      expect(await readAllWorkspaceErrors(dir)).toEqual([]);
    } finally {
      setReadOnlyMode(false);
    }
  });

  it("stops persisting after uninstall", async () => {
    const dir = createMemoryDirectory("root");
    const stop = installWorkspaceErrorSink({ directoryHandle: dir, username: "alice" });
    stop();

    logError("ctx", new Error("boom"));
    await flushErrorLogNow();
    expect(await readAllWorkspaceErrors(dir)).toEqual([]);
  });
});
