// The share's dominant transient fault must get a retry ladder sized for it.
//
// `NOT_READABLE_RETRY_DELAYS_MS` was [20, 60] — 80 ms, two retries, the
// shortest ladder in the app — while a stale snapshot got ~630 ms and a
// post-write read-back ~11 s. On the UNC/SMB share this app runs on,
// `NotReadableError` is the fault that actually happens: one exported
// production day held 314 of them out of 424 log entries, every one already
// past the end of its ladder, across every file the app reads.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { wrap } from "./jsonEnvelope";



describe("NotReadableError read ladder", () => {
  it("rides out a burst longer than the old two-retry budget", async () => {
    const dir = createMemoryDirectory("root");
    await safeWriteJson(dir, "thing.json", wrap({ value: "kept" }));

    // Three consecutive failures: survivable on a four-rung ladder, fatal on
    // the two-rung one (attempt + 2 retries = 3 tries, all of them faulted).
    setSimulatedFaults(dir, [
      { operation: "readFile", name: "thing.json", errorName: "NotReadableError", times: 3 },
    ]);

    const read = await safeReadJson<{ value: string }>(dir, "thing.json");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toEqual({ value: "kept" });
  });

  it("still gives up on a share that never comes back", async () => {
    const dir = createMemoryDirectory("root");
    await safeWriteJson(dir, "thing.json", wrap({ value: "kept" }));

    setSimulatedFaults(dir, [
      {
        operation: "readFile",
        name: "thing.json",
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    // Never reinterpreted as "missing" — that is what would let a caller serve
    // a stale `.bak`, or a write verification roll a good commit back.
    await expect(safeReadJson(dir, "thing.json")).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });
});
