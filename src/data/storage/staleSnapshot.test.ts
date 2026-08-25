/**
 * The 2026-08-25 XQ-IO-032 production incident, as a regression suite.
 *
 * Four users (admin, saalhijji, jalgahamdi, amonem) running the app from a
 * mapped network drive against one shared workspace hit repeated write failures
 * over ~3.5 hours. jalgahamdi alone failed eleven consecutive answer saves in 90
 * minutes and lost every one. Every entry in all four error logs carried the
 * SAME underlying exception message:
 *
 *   "An operation that depends on state cached in an interface object was made
 *    but the state had changed since it was read from disk."
 *
 * That sentence is Chromium's fixed text for `InvalidStateError` — the DOM name
 * raised when the (size, mtime) snapshot an interface object cached no longer
 * matches the file when the operation touches the bytes. It happens at two
 * boundaries, and BOTH are exercised below:
 *
 *   - READ:  `getFile()` snapshots; the later `text()` / `slice().arrayBuffer()`
 *            compares and throws.
 *   - WRITE: `createWritable()` snapshots; the later `close()` compares and
 *            throws.
 *
 * `InvalidStateError` was classified nowhere. It was not in
 * `isTransientWriteError` (so `retryTransientWrite` did not retry it), not in
 * `classifyFileSystemError` (so `resolveErrorCode` returned null), and not in
 * safeWrite's read ladders. It fell all the way out to `casLoop`, which reported
 * its XQ-IO-032 catch-all — a message whose advice ("the file may be in use by
 * another device") was a guess, because by construction nothing at that point
 * knew what had failed.
 *
 * The tests are written against the OBSERVABLE user outcome — "the save
 * succeeds" — not against the retry mechanism, so a future refactor that keeps
 * the outcome is free to change how it gets there.
 */

import { describe, expect, it } from "vitest";

import {
  clearOperationLog,
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { casLoop } from "./casLoop";
import { classifyFileSystemError, resolveErrorCode } from "./errorCodes";
import {
  SNAPSHOT_STALE_RETRY_DELAYS_MS,
  isSnapshotStaleError,
  isTransientWriteError,
} from "./transientFileErrors";
import { loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";

const MONTH = "8-August-2026";

/** The exception Chromium actually raises, message included. */
function staleSnapshotError(): Error {
  const error = new Error(
    "An operation that depends on state cached in an interface object was made " +
      "but the state had changed since it was read from disk."
  );
  error.name = "InvalidStateError";
  return error;
}

function answer(xrayImageId: string, value: string): ItemAnswer {
  return {
    xrayImageId,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value }],
    lastSavedAt: "2026-08-25T06:00:00.000Z",
    submittedAt: null,
    answeredBy: "employee",
    status: "draft",
  };
}

describe("stale-snapshot InvalidStateError — classification", () => {
  it("names the production exception XQ-IO-036 instead of leaving it unclassified", () => {
    // Before the fix this returned null, which is exactly why casLoop fell back
    // to the XQ-IO-032 catch-all in all four users' logs.
    expect(classifyFileSystemError(staleSnapshotError())).toBe("XQ-IO-036");
    expect(resolveErrorCode(staleSnapshotError())).toBe("XQ-IO-036");
  });

  it("recognises the DOM name, not the message text", () => {
    // Message text is a Chromium implementation detail and is localised in some
    // builds; the name is the stable contract.
    const renamed = new Error("something else entirely");
    renamed.name = "InvalidStateError";
    expect(isSnapshotStaleError(renamed)).toBe(true);

    const impostor = new Error(
      "An operation that depends on state cached in an interface object was made " +
        "but the state had changed since it was read from disk."
    );
    impostor.name = "TypeError";
    expect(isSnapshotStaleError(impostor)).toBe(false);
  });

  it("counts as transient, so the write ladder retries it", () => {
    expect(isTransientWriteError(staleSnapshotError())).toBe(true);
  });

  it("does not reclassify the neighbouring DOM names it used to be confused with", () => {
    const make = (name: string): Error => {
      const error = new Error(name);
      error.name = name;
      return error;
    };
    expect(classifyFileSystemError(make("NotAllowedError"))).toBe("XQ-IO-017");
    expect(classifyFileSystemError(make("NoModificationAllowedError"))).toBe("XQ-IO-035");
    expect(classifyFileSystemError(make("NotReadableError"))).toBe("XQ-IO-018");
    expect(classifyFileSystemError(make("NotFoundError"))).toBe("XQ-IO-027");
  });
});

describe("stale-snapshot InvalidStateError — read path", () => {
  it("reads through a snapshot that went stale mid-read", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "thing.json", { value: 7 });

    // getFile() SUCCEEDS and hands back a File; the read of its bytes is what
    // fails — the real shape of the bug. Faulting getFile instead would let a
    // "fix" that reuses the already-stale File pass.
    setSimulatedFaults(dir, [
      { operation: "readFile", name: "thing.json", errorName: "InvalidStateError", times: 2 },
    ]);

    const result = await safeReadJson<{ value: number }>(dir, "thing.json");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ value: 7 });
  });

  it("survives a stale snapshot on every attempt the ladder allows", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "thing.json", { value: 7 });

    setSimulatedFaults(dir, [
      {
        operation: "readFile",
        name: "thing.json",
        errorName: "InvalidStateError",
        times: SNAPSHOT_STALE_RETRY_DELAYS_MS.length,
      },
    ]);

    const result = await safeReadJson<{ value: number }>(dir, "thing.json");
    expect(result.ok).toBe(true);
  });

  it("still fails — and never invents an empty default — when the fault never clears", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "thing.json", { value: 7 });

    setSimulatedFaults(dir, [
      {
        operation: "readFile",
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    // A permanent fault must surface, not be laundered into "missing". An empty
    // default handed to a read-modify-write is written back as the whole file —
    // see readContract.test.ts for why that is the failure mode that matters.
    await expect(safeReadJson(dir, "thing.json")).rejects.toMatchObject({
      name: "InvalidStateError",
    });

    clearSimulatedFaults(dir);
  });
});

describe("stale-snapshot InvalidStateError — exposure per read", () => {
  it("touches a small file's bytes exactly ONCE per snapshot", async () => {
    // Every byte-touch re-validates the same (size, mtime) snapshot, so a read
    // that touches twice has two chances to hit the fault instead of one — on
    // exactly the small, hot, contended files (threads.index.json,
    // month.manifest.json, the lock and notification files) where a stale
    // snapshot bites hardest. It is also one SMB round trip.
    const dir = createMemoryDirectory("root", { trackOperations: true });
    await safeWriteJson(dir, "small.json", { قيمة: "نص عربي", n: 1 });

    clearOperationLog(dir);
    const result = await safeReadJson<{ قيمة: string; n: number }>(dir, "small.json");

    expect(result.ok).toBe(true);
    // Round-trips through the head window's own decode, Arabic payload
    // included — `TextDecoder("utf-8")` has to match `Blob.text()` exactly.
    if (result.ok) expect(result.value).toEqual({ قيمة: "نص عربي", n: 1 });

    const touches = getOperationLog(dir).filter((entry) => entry.operation === "readFile");
    expect(touches).toHaveLength(1);
  });

  it("still absorbs a fault on that single touch by re-opening the file", async () => {
    // The saving above must not cost the recovery: one touch still means one
    // retryable failure point, and the retry re-opens for a fresh snapshot.
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "small.json", { value: 5 });
    setSimulatedFaults(dir, [
      { operation: "readFile", name: "small.json", errorName: "InvalidStateError", times: 2 },
    ]);

    const result = await safeReadJson<{ value: number }>(dir, "small.json");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ value: 5 });

    clearSimulatedFaults(dir);
  });
});

describe("stale-snapshot InvalidStateError — write path", () => {
  it("commits a write whose createWritable snapshot went stale", async () => {
    const dir = createMemoryDirectory();
    await safeWriteJson(dir, "thing.json", { value: 1 });

    setSimulatedFaults(dir, [
      { operation: "createWritable", errorName: "InvalidStateError", times: 2 },
    ]);

    await safeWriteJson(dir, "thing.json", { value: 2 });

    clearSimulatedFaults(dir);
    const result = await safeReadJson<{ value: number }>(dir, "thing.json");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ value: 2 });
  });
});

describe("stale-snapshot InvalidStateError — the reported user action", () => {
  /**
   * jalgahamdi's failure, reproduced: an employee saving an inspection answer
   * from `employee-workspace/xray-referrals` while the share serves a stale
   * snapshot. Before the fix this returned `{ ok: false }` and the typed answer
   * never reached disk. It must now simply save.
   */
  it("saves the employee's answer despite a stale snapshot on the read-back", async () => {
    const dir = createMemoryDirectory();
    const saved = await upsertItemAnswer(dir, MONTH, "jalgahamdi", answer("XR-1", "clean"));
    expect(saved.ok).toBe(true);

    setSimulatedFaults(dir, [
      { operation: "readFile", errorName: "InvalidStateError", times: 3 },
    ]);

    const result = await upsertItemAnswer(dir, MONTH, "jalgahamdi", answer("XR-2", "flagged"));
    expect(result.ok).toBe(true);

    clearSimulatedFaults(dir);
    const stored = await loadEmployeeAnswers(dir, MONTH, "jalgahamdi");
    expect(stored.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  it("saves the employee's answer despite a stale snapshot on the commit", async () => {
    const dir = createMemoryDirectory();
    expect((await upsertItemAnswer(dir, MONTH, "saalhijji", answer("XR-1", "clean"))).ok).toBe(true);

    setSimulatedFaults(dir, [
      { operation: "createWritable", errorName: "InvalidStateError", times: 3 },
    ]);

    const result = await upsertItemAnswer(dir, MONTH, "saalhijji", answer("XR-2", "flagged"));
    expect(result.ok).toBe(true);

    clearSimulatedFaults(dir);
    const stored = await loadEmployeeAnswers(dir, MONTH, "saalhijji");
    expect(stored.items.map((item) => item.xrayImageId).sort()).toEqual(["XR-1", "XR-2"]);
  });

  /**
   * The share that never recovers. The save still fails — nothing client-side
   * can write to a file the platform refuses — but it must now fail with the
   * code that NAMES the condition, so the error log the admin exports says what
   * happened instead of XQ-IO-032's "could not classify this".
   *
   * Asserted against `casLoop` directly rather than through
   * `upsertItemAnswer`: the answer ladder is 14 attempts at a 150 ms base
   * (~20 s with jitter) by design, and a suite that spends 20 s of wall clock
   * to observe a message is a suite people stop running. The path from a throw
   * to the reported code is the same one either way — casLoop is where the
   * classification happens.
   */
  it("reports XQ-IO-036, not the XQ-IO-032 catch-all, when the fault never clears", async () => {
    const result = await casLoop(
      async () => {
        throw staleSnapshotError();
      },
      { maxRetries: 2, baseDelayMs: 1 }
    );

    expect(result).toEqual({ ok: false, error: expect.stringContaining("XQ-IO-036") });
    expect((result as { error: string }).error).not.toContain("XQ-IO-032");
  });

  it("hands the specific code to the caller's own telemetry hook", async () => {
    // answerStorage.ts attaches page/action context to whatever casLoop caught,
    // via `onExhausted`. It has to receive XQ-IO-036 too, or the durable error
    // log the admin exports still says XQ-IO-032 while the on-screen message
    // says something else.
    const seen: string[] = [];
    await casLoop(
      async () => {
        throw staleSnapshotError();
      },
      {
        maxRetries: 2,
        baseDelayMs: 1,
        onExhausted: (_cause, code) => {
          seen.push(code);
        },
      }
    );
    expect(seen).toEqual(["XQ-IO-036"]);
  });
});

describe("stale-snapshot InvalidStateError — no collateral damage", () => {
  it("leaves an unrelated DOM name terminal on the read path", async () => {
    const dir: DirectoryHandleLike = createMemoryDirectory();
    await safeWriteJson(dir, "thing.json", { value: 1 });

    // NotAllowedError is a lost grant: retrying it is exactly the mistake this
    // module's doctrine forbids, so it must still surface on the first throw.
    setSimulatedFaults(dir, [
      {
        operation: "readFile",
        errorName: "NotAllowedError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(safeReadJson(dir, "thing.json")).rejects.toMatchObject({
      name: "NotAllowedError",
    });

    clearSimulatedFaults(dir);
  });

  it("does not retry a missing file into existence", async () => {
    const dir = createMemoryDirectory();
    const result = await safeReadJson(dir, "absent.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });
});
