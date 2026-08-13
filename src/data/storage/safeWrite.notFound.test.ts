// The write/read asymmetry documented in safeWrite.ts's module header and in
// transientFileErrors.ts: on a UNC/SMB share a NotFoundError on the WRITE path
// is transient (the directory listing has not caught up), while on the READ
// path it still means the file is absent and must resolve immediately.
//
// The second half of that is easy to break silently — nothing about the
// returned value distinguishes "absent" from "absent after four retries", only
// latency does — so the read-path test asserts the number of open attempts, not
// just the result.
import { describe, expect, it } from "vitest";
import {
  clearSimulatedFaults,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
} from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { TRANSIENT_WRITE_RETRY_DELAYS_MS } from "./transientFileErrors";

describe("safeWrite NotFoundError handling", () => {
  it("commits successfully when the post-write verification read transiently reports NotFoundError", async () => {
    const root = createMemoryDirectory("root");
    await safeWriteJson(root, "file.json", { value: 1 });

    // Fail the next `create: false` open of the live file — that is the
    // "verifying-committed" read-back of a file safeWriteJson just closed.
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "file.json", create: false, errorName: "NotFoundError", times: 1 },
    ]);

    await expect(safeWriteJson(root, "file.json", { value: 2 })).resolves.toBeUndefined();

    clearSimulatedFaults(root);
    const read = await safeReadJson<{ value: number }>(root, "file.json");
    expect(read.ok && read.value).toEqual({ value: 2 });
  });

  it("succeeds when the write itself transiently reports NotFoundError", async () => {
    const root = createMemoryDirectory("root");
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "file.json", create: true, errorName: "NotFoundError", times: 1 },
    ]);

    await expect(safeWriteJson(root, "file.json", { value: 7 })).resolves.toBeUndefined();

    clearSimulatedFaults(root);
    const read = await safeReadJson<{ value: number }>(root, "file.json");
    expect(read.ok && read.value).toEqual({ value: 7 });
  });

  it("resolves a genuinely absent file to `missing` WITHOUT burning the retry budget", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });

    const result = await safeReadJson(root, "never-written.json");
    expect(result).toEqual({ ok: false, reason: "missing" });

    // One attempt per probed name (live, .bak, .tmp) and no more. If this ever
    // reads 1 + TRANSIENT_WRITE_RETRY_DELAYS_MS.length, someone has made every
    // absent-file read in the app pay ~630 ms of dead wait.
    const attempts = (name: string) =>
      getOperationLog(root).filter(
        (entry) => entry.operation === "getFileHandle" && entry.name === name
      ).length;
    expect(attempts("never-written.json")).toBe(1);
    expect(attempts("never-written.json.bak")).toBe(1);
    expect(attempts("never-written.json.tmp")).toBe(1);
    expect(TRANSIENT_WRITE_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
  });

  it("keeps the opt-in retry off by default for safeReadJson", async () => {
    const root = createMemoryDirectory("root", { trackOperations: true });
    // Two writes so a `.bak` snapshot exists — the first write of a file has
    // nothing to back up.
    await safeWriteJson(root, "file.json", { value: 1 });
    await safeWriteJson(root, "file.json", { value: 2 });

    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "file.json", create: false, errorName: "NotFoundError", times: 1 },
    ]);

    // Default read: the single NotFoundError is taken at face value, so the
    // live file reads as absent and the `.bak` fallback answers instead.
    const read = await safeReadJson<{ value: number }>(root, "file.json");
    expect(read.ok).toBe(true);
    expect(read.ok && read.recoveredFromBak).toBe(true);
  });

  it("retries the live read when a caller explicitly opts in", async () => {
    const root = createMemoryDirectory("root");
    await safeWriteJson(root, "file.json", { value: 1 });
    await safeWriteJson(root, "file.json", { value: 2 });

    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "file.json", create: false, errorName: "NotFoundError", times: 1 },
    ]);

    const read = await safeReadJson<{ value: number }>(root, "file.json", { retryMissing: true });
    expect(read.ok && read.recoveredFromBak).toBe(false);
    expect(read.ok && read.value).toEqual({ value: 2 });
  });
});
