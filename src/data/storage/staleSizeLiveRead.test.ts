/**
 * Task E2 (error-log group `storage:bak-recovery`, evidence §A in
 * `.superpowers/sdd/errorlog-2026-09-28/other-groups.md`).
 *
 * Production mechanism: `safeReadJson` decides a live file is "damaged" from a
 * SINGLE read. `readContent`'s small-file fast path trusts the `File.size` of
 * whatever `getFile()` snapshot it was just handed — on a UNC/SMB share that
 * snapshot can be stale (the classic case is the 0-byte entry
 * `getFileHandle({ create: true })` leaves behind, or simply an older,
 * shorter size than the real file that was written a moment ago). A stale
 * size yields `slice(0, size)`, which decodes to `""` or a truncated prefix —
 * no exception, so nothing about it looks different from a torn write. JSON
 * validation then fails, `safeReadJson` falls straight to `.bak`/`.tmp`, and
 * `reportBakRecovery` asserts "the live file is damaged" — even though the
 * live file is completely healthy and a read a moment later proves it.
 *
 * Fix-round-1: the first version of the retry gated on a zero-delay
 * `getFile()` size PEEK, which reads the exact same stale cache the failed
 * read just saw and therefore never observed growth for a size that stays
 * flat across two back-to-back calls (this covers 0-byte AND non-zero short
 * snapshots — see `readContent`'s own comment on `LIVE_INVALID_RETRY_DELAYS_MS`
 * in `safeWrite.ts`). The tests below pin the corrected design: WAIT before
 * re-reading (never a same-instant peek), treat `reportedSize === 0` as
 * unconditional evidence of staleness, and bound further retries by
 * comparing consecutive invalid reads' (size, content-hash) — identical twice
 * in a row means "this is not changing," not "not evidence yet."
 */
import { afterEach, beforeEach, expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import { safeReadJson, safeWriteJson } from "./safeWrite";
import { clearErrors, getRecentErrors } from "./errorLogger";
import { __resetBakRecoveryReportsForTests } from "./bakRecoveryReport";

beforeEach(() => {
  clearErrors();
  __resetBakRecoveryReportsForTests();
});

afterEach(() => {
  clearErrors();
  __resetBakRecoveryReportsForTests();
});

/** One scripted `getFile()` outcome for `wrapWithScriptedReads`. */
type ScriptedRead =
  | { kind: "truncate"; size: number }
  | { kind: "text"; text: string }
  | { kind: "throw"; errorName: string };

/**
 * Wraps a memory directory so that each successive `getFile()` call on
 * `targetName` follows `script` in order; once `script` is exhausted, every
 * further call serves the REAL, unmodified file. `getCallCount()` reports how
 * many `getFile()` calls this wrapper has served for `targetName`, so a test
 * can assert exactly how many attempts a fix spent — the difference between
 * "recovered on the 2nd try" and "recovered on the 3rd try" is invisible in
 * the returned value alone.
 *
 * Every scripted outcome (including `truncate`, which reads the real bytes
 * and slices them) resolves the promise fresh each call — nothing here reuses
 * a cached `File`/interface object, exactly like a real client re-acquiring
 * the handle on each attempt.
 */
function wrapWithScriptedReads(
  base: DirectoryHandleLike,
  targetName: string,
  script: ScriptedRead[]
): { dir: DirectoryHandleLike; getCallCount: () => number } {
  let calls = 0;
  const dir: DirectoryHandleLike = {
    ...base,
    getFileHandle: async (name: string, options?: { create?: boolean }): Promise<FileHandleLike> => {
      const handle = await base.getFileHandle(name, options);
      if (name !== targetName) return handle;
      return {
        ...handle,
        getFile: async (): Promise<File> => {
          const index = calls;
          calls += 1;
          const step = script[index];
          if (step === undefined) return handle.getFile();
          if (step.kind === "throw") {
            const error = new Error(`Simulated ${step.errorName} for "${targetName}".`);
            error.name = step.errorName;
            throw error;
          }
          if (step.kind === "text") {
            return new File([step.text], targetName, { type: "application/json" });
          }
          const real = await handle.getFile();
          const text = await real.text();
          return new File([text.slice(0, step.size)], real.name, { type: real.type });
        },
      };
    },
  };
  return { dir, getCallCount: () => calls };
}

async function readRaw(dir: DirectoryHandleLike, name: string): Promise<string> {
  const handle = await dir.getFileHandle(name, { create: false });
  const file = await handle.getFile();
  return file.text();
}

test("safeReadJson retries a stale 0-byte then short live snapshot instead of reporting damage", async () => {
  const dir = createMemoryDirectory("stale-size-1");
  await safeWriteJson(dir, "t.json", { v: 1 });

  // First getFile() of t.json reports a 0-byte snapshot, second a 40-byte
  // (still-truncated) snapshot, third and later the real, complete file —
  // exactly the "stale-then-good" shape from the evidence repro.
  const { dir: wrapped } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "truncate", size: 0 },
    { kind: "truncate", size: 40 },
  ]);

  const result = await safeReadJson<{ v: number }>(wrapped, "t.json");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(false);
  }

  // No false "damaged" report, durably or to the ring buffer.
  const bakEntries = getRecentErrors().filter((e) => e.context.startsWith("storage:bak-recovery"));
  expect(bakEntries).toHaveLength(0);
});

test("[0,0] persistent-stale shape: a 0-byte snapshot on the first TWO calls still recovers on the third", async () => {
  const dir = createMemoryDirectory("stale-size-zero-zero");
  await safeWriteJson(dir, "t.json", { v: 42 });

  const { dir: wrapped, getCallCount } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "truncate", size: 0 },
    { kind: "truncate", size: 0 },
  ]);

  const result = await safeReadJson<{ v: number }>(wrapped, "t.json");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(42);
    expect(result.recoveredFromBak).toBe(false);
  }
  // reportedSize === 0 is UNCONDITIONAL evidence of staleness (rule a): both
  // retries fire regardless of the "identical to the previous read" check,
  // since two empty reads in a row are still not proof of a stable file —
  // safeWriteJson never writes an empty one. Exactly 3 attempts: the
  // original read plus both retries.
  expect(getCallCount()).toBe(3);
  expect(getRecentErrors().filter((e) => e.context.startsWith("storage:bak-recovery"))).toHaveLength(0);
});

test("[40,40] persistent-stale shape (same size, DIFFERENT content each read) still recovers on the third call", async () => {
  const dir = createMemoryDirectory("stale-size-forty-forty");
  await safeWriteJson(dir, "t.json", { v: 7 });

  // Same SIZE (40 bytes) on both scripted reads, but different bytes — a
  // torn write whose byte count happens to hold steady while its content
  // keeps shifting. Size-only comparison (the fix-round-1 "growth" check)
  // cannot tell this apart from a genuinely stable file; content-hash
  // comparison can.
  const { dir: wrapped, getCallCount } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "text", text: `{"metadata":{"revision":1,"schemaVer` }, // 40 chars, invalid JSON
    { kind: "text", text: `{"metadata":{"schemaVersion":1,"revi` }, // 40 chars, DIFFERENT, still invalid
  ]);

  const result = await safeReadJson<{ v: number }>(wrapped, "t.json");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(7);
    expect(result.recoveredFromBak).toBe(false);
  }
  expect(getCallCount()).toBe(3);
});

test("a genuinely stable (identical every read), corrupt live file stops retrying after ONE extra attempt", async () => {
  const dir = createMemoryDirectory("stale-size-stable-corrupt");
  await safeWriteJson(dir, "t.json", { v: 1 });
  await safeWriteJson(dir, "t.json", { v: 2 }); // t.json.bak now holds {v:1}

  // Corrupt the live file directly, and keep it EXACTLY the same on every
  // read — the "persistent-stale-for-N-calls" case, where N exceeds this
  // module's 2-retry budget. Rule (c) must give up after the SECOND read
  // (the first retry) rather than spending the full ladder: same (size,
  // content-hash) twice in a row is exactly the stable-file signal.
  const handle = await dir.getFileHandle("t.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const { dir: wrapped, getCallCount } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "text", text: "{ not valid json" },
    { kind: "text", text: "{ not valid json" },
    { kind: "text", text: "{ not valid json" },
    { kind: "text", text: "{ not valid json" },
  ]);

  const result = await safeReadJson<{ v: number }>(wrapped, "t.json");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }
  // Exactly 2 calls: the original read plus ONE retry (mandatory — there is
  // nothing to compare the first invalid read against yet), then the SECOND
  // read matches the first exactly and the loop stops rather than spending
  // its full 2-retry budget. This is what keeps a real corrupt file's cost
  // bounded inside a caller's own retry loop (casLoop defaults to 10
  // attempts) — see readContract.test.ts's corrupt-base-read case.
  expect(getCallCount()).toBe(2);

  const bakEntries = getRecentErrors().filter((e) => e.context.startsWith("storage:bak-recovery"));
  expect(bakEntries.length).toBeGreaterThanOrEqual(1);
  expect(await readRaw(dir, "t.json")).toBe("{ not valid json");
  // Evidence line: size, bytes read, failure stage, and the stale-retry count.
  expect(bakEntries[0]?.message).toMatch(/bytes/);
  expect(bakEntries[0]?.message).toMatch(/failed at/);
});

test("safeReadJson still recovers from .bak and logs when the live file is persistently corrupt (no scripted reads)", async () => {
  const dir = createMemoryDirectory("stale-size-2");
  await safeWriteJson(dir, "t.json", { v: 1 });
  await safeWriteJson(dir, "t.json", { v: 2 }); // t.json.bak now holds {v:1}

  // Corrupt the live file directly (not a stale snapshot — genuinely bad
  // bytes on disk), the same way the existing bak-recovery suite does. No
  // wrapper here: this exercises the real memory-directory path end to end.
  const handle = await dir.getFileHandle("t.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const result = await safeReadJson<{ v: number }>(dir, "t.json");

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }

  const bakEntries = getRecentErrors().filter((e) => e.context.startsWith("storage:bak-recovery"));
  expect(bakEntries.length).toBeGreaterThanOrEqual(1);
  expect(await readRaw(dir, "t.json")).toBe("{ not valid json");
  expect(bakEntries[0]?.message).toMatch(/bytes/);
});

test("a throwing retry read never propagates out of safeReadJson — falls through to .bak instead", async () => {
  const dir = createMemoryDirectory("stale-size-throw");
  await safeWriteJson(dir, "t.json", { v: 9 });
  await safeWriteJson(dir, "t.json", { v: 10 }); // .bak now holds {v:9}

  // Corrupt the live file so the first read is found-but-invalid, then make
  // the RETRY's own read hit a persistent, non-transient fault (simulating
  // an exhausted NotReadable/stale-snapshot ladder inside readContent).
  const handle = await dir.getFileHandle("t.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const { dir: wrapped } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "text", text: "{ not valid json" }, // the original read, served normally below
    { kind: "throw", errorName: "SecurityError" }, // the retry's read throws, non-transient
  ]);

  // SecurityError is not on any transient ladder, so it throws straight out
  // of readContent on the very first attempt already, for BOTH the initial
  // read and any retry. What this test really pins is that a throw from the
  // RETRY specifically must not propagate past safeReadJson — it must fall
  // through to .bak exactly as if the retry had simply found the same
  // invalid content again.
  const result = await safeReadJson<{ v: number }>(wrapped, "t.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(9);
    expect(result.recoveredFromBak).toBe(true);
  }
});

test("respects a caller-supplied deadline: stops retrying once the budget is spent, never throws", async () => {
  const dir = createMemoryDirectory("stale-size-deadline");
  await safeWriteJson(dir, "t.json", { v: 5 });
  await safeWriteJson(dir, "t.json", { v: 6 }); // .bak now holds {v:5}

  const handle = await dir.getFileHandle("t.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const { dir: wrapped, getCallCount } = wrapWithScriptedReads(dir, "t.json", [
    { kind: "truncate", size: 0 }, // unconditionally "worth a retry" (rule a) —
    { kind: "truncate", size: 0 }, // would normally still retry, but the deadline below is already spent
  ]);

  const result = await safeReadJson<{ v: number }>(wrapped, "t.json", {
    // Already expired — `nextRetryDelayMs` must report `null` immediately,
    // same contract as every other ladder in this module.
    deadline: { at: Date.now() - 1_000, label: "test-deadline" },
  });

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.recoveredFromBak).toBe(true);
  // No retry spent: the budget was gone before the first wait was even
  // considered.
  expect(getCallCount()).toBe(1);
});
