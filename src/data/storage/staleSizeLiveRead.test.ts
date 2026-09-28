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
 * This is the RED/GREEN pinning test named in the evidence doc's proposed fix:
 * a live read that is FOUND but fails validation must be retried, with a
 * fresh handle, before the sibling fallback fires — while a genuinely corrupt
 * live file must still fall back and still be logged, unchanged.
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

/**
 * Wraps a memory directory so that the next `staleSizes.length` calls to
 * `getFile()` on `targetName` return a `File` truncated to each of
 * `staleSizes` in turn (bytes, not characters — the fixtures here are ASCII
 * JSON, so the two coincide). Every call after that serves the REAL,
 * unmodified file — reproducing "the client's cached directory-entry size
 * catches up a moment later" without ever throwing an exception, exactly the
 * production mechanism in evidence §A (`getFile()` succeeds; only the bytes
 * it reports are wrong).
 */
function wrapWithStaleLiveSizeOnce(
  base: DirectoryHandleLike,
  targetName: string,
  staleSizes: number[]
): DirectoryHandleLike {
  let calls = 0;
  return {
    ...base,
    getFileHandle: async (name: string, options?: { create?: boolean }): Promise<FileHandleLike> => {
      const handle = await base.getFileHandle(name, options);
      if (name !== targetName) return handle;
      return {
        ...handle,
        getFile: async (): Promise<File> => {
          const real = await handle.getFile();
          const index = calls;
          calls += 1;
          if (index >= staleSizes.length) return real;
          const size = staleSizes[index]!;
          const text = await real.text();
          return new File([text.slice(0, size)], real.name, { type: real.type });
        },
      };
    },
  };
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
  const wrapped = wrapWithStaleLiveSizeOnce(dir, "t.json", [0, 40]);

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

test("safeReadJson still recovers from .bak and logs when the live file is persistently corrupt", async () => {
  const dir = createMemoryDirectory("stale-size-2");
  await safeWriteJson(dir, "t.json", { v: 1 });
  await safeWriteJson(dir, "t.json", { v: 2 }); // t.json.bak now holds {v:1}

  // Corrupt the live file directly (not a stale snapshot — genuinely bad
  // bytes on disk), the same way the existing bak-recovery suite does.
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
  // The genuinely-corrupt live file is still on disk, untouched, and the log
  // entry carries the diagnostic evidence (size/bytes/stage) the evidence doc
  // asked for so a real export can tell damage from a stale view.
  expect(await readRaw(dir, "t.json")).toBe("{ not valid json");
  expect(bakEntries[0]?.message).toMatch(/bytes/);
});
