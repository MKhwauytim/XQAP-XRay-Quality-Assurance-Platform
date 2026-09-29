/**
 * Task E5 — Chrome's after-write "Safe Browsing" check failing on `close()`.
 * See `.superpowers/sdd/errorlog-2026-09-28/other-groups.md` §D (#26).
 *
 * Chromium runs a Safe Browsing check as part of `FileSystemWritableFileStream
 * .close()` and rejects it with `AbortError: Failed to perform Safe Browsing
 * check.` while the network is degraded. `close()` never replaced the
 * destination, so retrying is safe. It used to fall past
 * `isTransientWriteError` (no retry) and land on the XQ-IO-032 catch-all.
 *
 * The picker's `AbortError` ("The user aborted a request.") must stay exactly
 * as it was: it is not a write failure and is not transient.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearErrors } from "./errorLogger";
import { classifyFileSystemError, errorCodeMessage, resolveErrorCode } from "./errorCodes";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { isTransientWriteError } from "./transientFileErrors";
import { getLabels } from "../labels/labelsStore";

const SAFE_BROWSING_MESSAGE = "Failed to perform Safe Browsing check.";

function safeBrowsingError(): Error {
  const error = new Error(SAFE_BROWSING_MESSAGE);
  error.name = "AbortError";
  return error;
}

function pickerAbortError(): Error {
  const error = new Error("The user aborted a request.");
  error.name = "AbortError";
  return error;
}

beforeEach(() => clearErrors());
afterEach(() => clearErrors());

describe("Safe Browsing AbortError on close()", () => {
  it("is a transient WRITE error; the picker's AbortError is not", () => {
    expect(isTransientWriteError(safeBrowsingError())).toBe(true);
    expect(isTransientWriteError(pickerAbortError())).toBe(false);
  });

  it("safeWriteJson succeeds when close() rejects once, and the file holds the new value", async () => {
    const dir = createMemoryDirectory("sb-once");
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: "t.json",
        errorName: "AbortError",
        errorMessage: SAFE_BROWSING_MESSAGE,
        times: 1,
      },
    ]);

    await expect(safeWriteJson(dir, "t.json", { v: 1 })).resolves.toBeUndefined();

    const read = await safeReadJson<{ v: number }>(dir, "t.json");
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toEqual({ v: 1 });
  });

  it("a persistent failure resolves to its own code, not the XQ-IO-032 catch-all", async () => {
    const dir = createMemoryDirectory("sb-persistent");
    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: "t.json",
        errorName: "AbortError",
        errorMessage: SAFE_BROWSING_MESSAGE,
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    let thrown: unknown;
    try {
      await safeWriteJson(dir, "t.json", { v: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const code = resolveErrorCode(thrown);
    expect(code).toBe("XQ-IO-039");
    expect(code).not.toBe("XQ-IO-032");
  });

  it("a persistent failure leaves a pre-existing file byte-for-byte unchanged", async () => {
    const dir = createMemoryDirectory("sb-unchanged");
    await safeWriteJson(dir, "t.json", { v: 1 });
    const handle = await dir.getFileHandle("t.json");
    const before = await (await handle.getFile()).text();

    setSimulatedFaults(dir, [
      {
        operation: "close",
        name: "t.json",
        errorName: "AbortError",
        errorMessage: SAFE_BROWSING_MESSAGE,
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    await expect(safeWriteJson(dir, "t.json", { v: 2 })).rejects.toThrow();

    const after = await (await (await dir.getFileHandle("t.json")).getFile()).text();
    expect(after).toBe(before);
  });

  it("the user text is Arabic, comes from labelsStore, and tells the user to retry", () => {
    const text = errorCodeMessage("XQ-IO-039");
    expect(text).toBe(getLabels().err_io_039_safe_browsing_check_failed);
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).toContain("أعد المحاولة");
  });

  it("leaves the picker's AbortError unclassified", () => {
    expect(classifyFileSystemError(pickerAbortError())).toBeNull();
    expect(resolveErrorCode(pickerAbortError())).toBeNull();
  });
});
