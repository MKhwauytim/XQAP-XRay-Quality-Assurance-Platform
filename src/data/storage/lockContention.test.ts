import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { isLockContentionError, isTransientWriteError } from "./transientFileErrors";

/**
 * `NoModificationAllowedError` is what a locked entry raises: another tab, or —
 * on the UNC/SMB share this app is deployed on — another MACHINE holds the file
 * open for writing. It is a timing condition, not a lost grant, and this repo's
 * own doctrine ("could not read" is not "does not exist") applies in the mirror
 * image: "could not write right now" is not "the workspace is gone".
 *
 * It was classified as terminal permission loss, so a user on a busy share was
 * told to reconnect to a workspace they had never lost while a bounded retry
 * would have completed the write.
 */
describe("NoModificationAllowedError is lock contention, not lost permission", () => {
  it("classifies it as a transient write error", () => {
    const locked = new Error("The file is locked");
    locked.name = "NoModificationAllowedError";
    expect(isLockContentionError(locked)).toBe(true);
    expect(isTransientWriteError(locked)).toBe(true);
  });

  it("does not classify a revoked grant as contention", () => {
    const revoked = new Error("not allowed");
    revoked.name = "NotAllowedError";
    expect(isLockContentionError(revoked)).toBe(false);
    expect(isTransientWriteError(revoked)).toBe(false);
  });

  it("completes a write whose lock clears after a bounded number of attempts", async () => {
    const dir = createMemoryDirectory("ws", {
      faults: [
        {
          operation: "createWritable",
          errorName: "NoModificationAllowedError",
          times: 2,
        },
      ],
    });

    await safeWriteJson(dir, "contended.json", { value: 42 });

    const read = await safeReadJson<{ value: number }>(dir, "contended.json");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toEqual({ value: 42 });
  });

  it("still fails terminally when the grant is genuinely revoked", async () => {
    const dir = createMemoryDirectory("ws", {
      faults: [
        {
          operation: "createWritable",
          errorName: "NotAllowedError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    await expect(safeWriteJson(dir, "denied.json", { value: 1 })).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
});
