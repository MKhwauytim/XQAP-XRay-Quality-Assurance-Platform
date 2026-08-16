// Reported from the field, after the diagnostics work made the cause legible:
// `XQ-IO-031` on a real SMB share. That code means the post-retry probe found
// the containing directory **reachable and writable** — only one entry was
// temporarily invisible. In other words: the write succeeded, the share just
// had not published the directory entry yet, and the app gave up waiting.
//
// It gave up after ~630 ms, because the post-write verification read shared a
// backoff ladder with ordinary reads. Those two cases are not comparable:
//
//   - ordinary read: "not found" is a QUESTION. The file may genuinely not
//     exist, so resolving quickly is correct.
//   - post-write verification: `close()` already resolved, so the file provably
//     EXISTS. Absence can only be a stale view, and the sole consequence of
//     giving up early is failing an operation that actually succeeded.
//
// The read-back path now uses its own, much longer ladder (~11 s over 8
// attempts). These tests pin the boundary in both directions: a lag that would
// have exhausted the old ladder now survives, and a genuinely absent file is
// still not waited on.

import { describe, it, expect } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import type { DirectoryHandleLike } from "./fileSystemAccess";
import {
  TRANSIENT_WRITE_RETRY_DELAYS_MS,
  VERIFY_READBACK_RETRY_DELAYS_MS,
} from "./transientFileErrors";
import { safeReadJson, safeWriteJson } from "./safeWrite";

const total = (ladder: readonly number[]): number => ladder.reduce((a, b) => a + b, 0);

describe("the post-write read-back ladder is patient enough for a real share", () => {
  it("is materially longer than the ordinary write ladder", () => {
    // The property that matters, pinned as a property rather than as exact
    // numbers so tuning the delays does not force a test edit.
    expect(VERIFY_READBACK_RETRY_DELAYS_MS.length).toBeGreaterThan(
      TRANSIENT_WRITE_RETRY_DELAYS_MS.length
    );
    expect(total(VERIFY_READBACK_RETRY_DELAYS_MS)).toBeGreaterThan(
      total(TRANSIENT_WRITE_RETRY_DELAYS_MS) * 5
    );
  });

  it("survives a lag that would have exhausted the old ladder", async () => {
    const root = createMemoryDirectory() as unknown as DirectoryHandleLike;
    await safeWriteJson(root, "thing.json", { value: 1 });

    // One more miss than the OLD ladder could absorb. Against the pre-fix code
    // this exhausted the retries and surfaced as XQ-IO-031.
    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        name: "thing.json",
        create: false,
        errorName: "NotFoundError",
        times: TRANSIENT_WRITE_RETRY_DELAYS_MS.length + 1,
      },
    ]);

    const result = await safeReadJson<{ value: number }>(root, "thing.json", {
      retryMissing: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ value: 1 });
  });

  it("still reports a file that is genuinely absent, without waiting on it", async () => {
    // The other direction. `retryMissing` is opt-in precisely so ordinary
    // probes stay fast — safeReadJson alone probes .bak and .tmp on every miss,
    // and making those patient would add seconds to routine reads.
    const root = createMemoryDirectory() as unknown as DirectoryHandleLike;

    const startedAt = performance.now();
    const result = await safeReadJson(root, "never-written.json");
    const elapsed = performance.now() - startedAt;

    expect(result.ok).toBe(false);
    // Comfortably under even the OLD ladder's total: no retrying happened.
    expect(elapsed).toBeLessThan(total(TRANSIENT_WRITE_RETRY_DELAYS_MS));
  });
});
