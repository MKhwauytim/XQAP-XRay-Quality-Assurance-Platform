/**
 * The V8 max-string-length ceiling on the streamed write path.
 *
 * Real customer data measured 573,236,797 bytes for one `bi.raw.json`, decoding
 * to 455,755,299 UTF-16 code units — 85% of V8's hard 536,870,888 ceiling. The
 * streamed write path was built so a payload that large never has to exist as
 * one string, but it then verified its own staged `.tmp` with `file.text()`,
 * which materializes exactly that string. Past the ceiling that throws
 * `RangeError: Invalid string length`, which propagated out of `safeWriteJson`
 * and aborted the whole month save (manifest included) while leaving a
 * multi-hundred-MB orphaned `.tmp`.
 *
 * **How the ceiling is exercised here.** A test cannot allocate a >512 MB file:
 * the memory-directory double stores file content as a JS string, so it could
 * not even hold one. Instead the ceiling is *injected* —
 * `__setMaxStringLengthForTests(n)` makes `readText` throw the same RangeError
 * the engine would for any file larger than `n` bytes. The code path is
 * identical to production's; only the number moves. A write that still succeeds
 * with the cap set far below the file size has provably never read the file as
 * one string — and each test below asserts that impossibility directly, by
 * showing the whole-string read (`safeReadJson`) *does* throw for the very file
 * the write just produced and verified.
 */
import { afterEach, expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";
import {
  __resetMaxStringLengthForTests,
  __resetStreamingForcedSizeLimitForTests,
  __setMaxStringLengthForTests,
  __setStreamingForcedSizeLimitForTests,
  safeReadJson,
  safeWriteJson,
} from "./safeWrite";

afterEach(() => {
  __resetMaxStringLengthForTests();
  __resetStreamingForcedSizeLimitForTests();
});

/** Reads a file's bytes directly, bypassing the injected string-length cap. */
async function readRaw(dir: DirectoryHandleLike, name: string): Promise<string> {
  const handle = await dir.getFileHandle(name, { create: false });
  return (await handle.getFile()).text();
}

/** Byte size on disk — read windows are byte-sized, so this is what counts. */
async function byteSize(dir: DirectoryHandleLike, name: string): Promise<number> {
  const handle = await dir.getFileHandle(name, { create: false });
  return (await handle.getFile()).size;
}

async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * A payload whose serialized envelope crosses several 4 MB read windows and is
 * dense with Arabic text, so byte-boundary slicing lands inside multi-byte
 * UTF-8 sequences on essentially every window boundary.
 */
function multiWindowPayload(): { rows: { i: number; note: string }[] } {
  return {
    rows: Array.from({ length: 80_000 }, (_, i) => ({
      i,
      note: `قياس الجودة للصف رقم ${i} — مراجعة الأشعة السينية والتحقق من النتائج`,
    })),
  };
}

test("a streamed write above the max-string-length ceiling succeeds and stays byte-exact", async () => {
  const dir = createMemoryDirectory();
  const payload = multiWindowPayload();

  __setStreamingForcedSizeLimitForTests(0); // force the streamed path
  __setMaxStringLengthForTests(1024 * 1024); // "engine" cannot hold >1 MB strings

  await safeWriteJson(dir, "bi.raw.json", payload);

  const raw = await readRaw(dir, "bi.raw.json");
  // The file really is far past the injected ceiling and spans several 4 MB
  // read windows, so the write was verified window by window.
  expect(await byteSize(dir, "bi.raw.json")).toBeGreaterThan(2 * 4 * 1024 * 1024);

  // Proof the ceiling is real for this exact file: the whole-string read path —
  // which is what the old verification used — still throws for it.
  await expect(safeReadJson(dir, "bi.raw.json")).rejects.toThrow(RangeError);

  // …yet the committed bytes are a complete, correct envelope.
  const parsed = JSON.parse(raw) as {
    metadata: { revision: number; schemaVersion: number };
    data: typeof payload;
  };
  expect(parsed.metadata.schemaVersion).toBe(1);
  expect(parsed.metadata.revision).toBe(1);
  expect(parsed.data.rows).toHaveLength(80_000);
  expect(parsed.data.rows[79_999]!.note).toBe(payload.rows[79_999]!.note);
  expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(payload));

  // The staged copy was cleaned up on success.
  expect(await exists(dir, "bi.raw.json.tmp")).toBe(false);
});

test("re-saving a file that is already too large to read as one string keeps the .bak/revision ladder", async () => {
  const dir = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  __setMaxStringLengthForTests(1024 * 1024);

  const first = multiWindowPayload();
  await safeWriteJson(dir, "bi.raw.json", first);

  // Second save: safeWriteJson reads the EXISTING file before every write (for
  // the previous revision and the .bak snapshot). That read is a whole-string
  // read too, so before this fix a re-save of an oversized month threw
  // RangeError before the streamed path was even reached.
  const second = { rows: [...first.rows, { i: -1, note: "صف إضافي" }] };
  await safeWriteJson(dir, "bi.raw.json", second);

  const live = JSON.parse(await readRaw(dir, "bi.raw.json")) as {
    metadata: { revision: number };
    data: { rows: { i: number }[] };
  };
  const bak = JSON.parse(await readRaw(dir, "bi.raw.json.bak")) as {
    metadata: { revision: number };
    data: { rows: { i: number }[] };
  };
  expect(live.data.rows).toHaveLength(80_001);
  expect(live.metadata.revision).toBe(2); // continued from the oversized file's header
  expect(bak.data.rows).toHaveLength(80_000);
  expect(bak.metadata.revision).toBe(1);
});

/**
 * Wraps a directory so the bytes written to `targetFile` are transformed on
 * their way to disk — a stand-in for silent corruption between "we streamed it"
 * and "it landed".
 */
function mutateWritesTo(
  base: DirectoryHandleLike,
  targetFile: string,
  mutate: (written: string) => string
): DirectoryHandleLike {
  return {
    ...base,
    getFileHandle: async (name, options) => {
      const handle = await base.getFileHandle(name, options);
      if (name !== targetFile || !handle.createWritable) return handle;
      return {
        ...handle,
        createWritable: async () => {
          const writable = await handle.createWritable!();
          let buffer = "";
          return {
            write: async (data: string) => {
              buffer += data;
            },
            close: async () => {
              await writable.write(mutate(buffer));
              await writable.close();
            },
          };
        },
      } satisfies FileHandleLike;
    },
  };
}

test("chunked verification still catches a single mutated character, and cleans up the .tmp", async () => {
  const base = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  __setMaxStringLengthForTests(1024 * 1024);

  // Flip exactly one Arabic character deep inside the staged file — past the
  // first 4 MB read window, and the same character length, so the file's length
  // is unchanged and only the content hash can reveal it. (Verification is a
  // byte-exact hash comparison, not a length or sampled check.)
  let mutatedAt = -1;
  const dir = mutateWritesTo(base, "bi.raw.json.tmp", (written) => {
    // Char index 5M sits well past the first 4 MB *byte* window (Arabic is
    // 2 bytes per character here), i.e. in a later window than the file's start.
    const at = written.indexOf("قياس", 5_000_000);
    mutatedAt = at;
    return `${written.slice(0, at)}فياس${written.slice(at + 4)}`;
  });

  await expect(safeWriteJson(dir, "bi.raw.json", multiWindowPayload())).rejects.toThrow(
    "Safe-write staging failed"
  );
  expect(mutatedAt).toBeGreaterThan(5_000_000);

  // Same length as the honest bytes — nothing but the hash could have caught it.
  const staged = await readRaw(base, "bi.raw.json.tmp").catch(() => null);
  expect(staged).toBeNull(); // and the rejected staging file is gone
  expect(await exists(base, "bi.raw.json")).toBe(false); // live file never touched
});

test("a streamed write that fails mid-stream leaves no orphaned .tmp", async () => {
  const base = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  __setMaxStringLengthForTests(1024 * 1024);

  // Fail after a few 64 KB flushes — the shape of a quota/permission/share
  // failure part-way through a multi-hundred-MB write. Before this fix the
  // partial .tmp was simply left on disk.
  let flushes = 0;
  const dir: DirectoryHandleLike = {
    ...base,
    getFileHandle: async (name, options) => {
      const handle = await base.getFileHandle(name, options);
      if (name !== "bi.raw.json.tmp" || !handle.createWritable) return handle;
      return {
        ...handle,
        createWritable: async () => {
          const writable = await handle.createWritable!();
          return {
            write: async (data: string) => {
              flushes += 1;
              if (flushes > 3) {
                const error = new Error("Simulated quota exhaustion.");
                error.name = "QuotaExceededError";
                throw error;
              }
              await writable.write(data);
            },
            close: () => writable.close(),
          };
        },
      } satisfies FileHandleLike;
    },
  };

  await expect(safeWriteJson(dir, "bi.raw.json", multiWindowPayload())).rejects.toThrow(
    "Simulated quota exhaustion"
  );
  expect(flushes).toBeGreaterThan(3);
  expect(await exists(base, "bi.raw.json.tmp")).toBe(false);
  expect(await exists(base, "bi.raw.json")).toBe(false);
});
