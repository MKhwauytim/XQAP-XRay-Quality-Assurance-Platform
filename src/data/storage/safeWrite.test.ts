import { afterEach, expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { simpleHash } from "./jsonEnvelope";
import {
  __resetStreamingForcedSizeLimitForTests,
  __setStreamingForcedSizeLimitForTests,
  safeReadJson,
  safeWriteJson,
  safeWriteJsonText,
} from "./safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";

afterEach(() => {
  __resetStreamingForcedSizeLimitForTests();
});

async function readRaw(
  dir: ReturnType<typeof createMemoryDirectory>,
  name: string
): Promise<string> {
  const handle = await dir.getFileHandle(name, { create: false });
  const file = await handle.getFile();
  return file.text();
}

test("write then read round-trips an object", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { hello: "world" });

  const result = await safeReadJson<{ hello: string }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.hello).toBe("world");
    expect(result.recoveredFromBak).toBe(false);
  }
});

test("large payloads are written compact to avoid the JSON.stringify string-length ceiling", async () => {
  // A pretty-printed (JSON.stringify(x, null, 2)) serialization of a very large
  // array can exceed V8's max string length and throw "Invalid string length".
  // We cannot build a 512 MB string cheaply in a unit test, so we assert the
  // mechanism that prevents it: payloads over VERIFY_SIZE_LIMIT (512 KB) are
  // serialized compactly (no indentation), which both halves the size and is the
  // path that stays under the ceiling.
  const dir = createMemoryDirectory();
  const rows = Array.from({ length: 12000 }, (_, i) => ({
    id: i,
    name: `row-${i}`,
    note: "padding-".repeat(6),
  }));
  await safeWriteJson(dir, "big.json", { rows });

  const raw = await readRaw(dir, "big.json");
  // Pretty-printing would insert "\n  " indentation; compact output has none.
  expect(raw).not.toContain('\n  "');
  // And the compact file still round-trips.
  const result = await safeReadJson<{ rows: unknown[] }>(dir, "big.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.rows).toHaveLength(12000);
  }
});

test("small payloads stay pretty-printed for readability", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "small.json", { hello: "world" });
  const raw = await readRaw(dir, "small.json");
  expect(raw).toContain('\n  "');
});

test("second write snapshots the previous content to .bak", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 });

  // Files are written as JsonEnvelope<T> — raw bytes contain { metadata, data }
  const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { data: { v: number } };
  const live = JSON.parse(await readRaw(dir, "a.json")) as { data: { v: number } };
  expect(bak.data.v).toBe(1);
  expect(live.data.v).toBe(2);
});

test("plain writes increment envelope revision from the current live file", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 });

  const live = JSON.parse(await readRaw(dir, "a.json")) as {
    metadata: { revision: number };
    data: { v: number };
  };
  expect(live.metadata.revision).toBe(2);
  expect(live.data.v).toBe(2);
});

test("safeReadJson recovers from .bak when the live file is corrupt", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 }); // a.json.bak now holds {v:1}

  // Corrupt the live file directly.
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const result = await safeReadJson<{ v: number }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }
});

test("safeReadJson recovers from .bak when envelope hash validation fails", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 });

  const raw = JSON.parse(await readRaw(dir, "a.json")) as {
    metadata: Record<string, unknown>;
    data: { v: number };
  };
  raw.data.v = 999;
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write(JSON.stringify(raw));
  await writable.close();

  const result = await safeReadJson<{ v: number }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }
});

test("safeReadJson reports missing files", async () => {
  const dir = createMemoryDirectory();
  const result = await safeReadJson(dir, "nope.json");
  expect(result).toMatchObject({ ok: false, reason: "missing" });
});

test("safeReadJson rejects unsupported app envelope schema versions", async () => {
  const dir = createMemoryDirectory();
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write(
    JSON.stringify({
      metadata: {
        schemaVersion: 999,
        revision: 1,
        contentHash: "bad",
        writtenAt: "2026-05-01T00:00:00.000Z",
      },
      data: { v: 1 },
    })
  );
  await writable.close();

  const result = await safeReadJson(dir, "a.json");
  expect(result).toMatchObject({ ok: false, reason: "corrupt" });
});

test("safeWriteJsonText rejects invalid restore content before overwriting live data", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });

  await expect(safeWriteJsonText(dir, "a.json", "{ invalid")).rejects.toThrow(
    "Cannot restore invalid JSON file"
  );

  const result = await safeReadJson<{ v: number }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
  }
});

test("failed live commit leaves previous valid file readable", async () => {
  const base = createMemoryDirectory();
  await safeWriteJson(base, "a.json", { v: 1 });

  let failLiveClose = true;
  const failingDir: DirectoryHandleLike = {
    ...base,
    getFileHandle: async (name, options) => {
      const handle = await base.getFileHandle(name, options);
      if (name !== "a.json" || !failLiveClose) {
        return handle;
      }
      return {
        ...handle,
        createWritable: async () => {
          const writable = await handle.createWritable!();
          return {
            write: writable.write,
            close: async () => {
              failLiveClose = false;
              throw new Error("simulated commit failure");
            },
          };
        },
      } satisfies FileHandleLike;
    },
  };

  await expect(safeWriteJson(failingDir, "a.json", { v: 2 })).rejects.toThrow(
    "simulated commit failure"
  );

  const result = await safeReadJson<{ v: number }>(base, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
  }
});

test("concurrent writes to the same file are serialized and preserve revisions", async () => {
  const dir = createMemoryDirectory();
  await Promise.all([
    safeWriteJson(dir, "a.json", { v: 1 }),
    safeWriteJson(dir, "a.json", { v: 2 }),
    safeWriteJson(dir, "a.json", { v: 3 }),
  ]);

  const live = JSON.parse(await readRaw(dir, "a.json")) as {
    metadata: { revision: number };
  };
  expect(live.metadata.revision).toBe(3);
});

test("concurrent writes to different files do not block each other logically", async () => {
  const dir = createMemoryDirectory();
  await Promise.all([
    safeWriteJson(dir, "a.json", { v: "a" }),
    safeWriteJson(dir, "b.json", { v: "b" }),
  ]);

  const [a, b] = await Promise.all([
    safeReadJson<{ v: string }>(dir, "a.json"),
    safeReadJson<{ v: string }>(dir, "b.json"),
  ]);
  expect(a.ok && a.value.v).toBe("a");
  expect(b.ok && b.value.v).toBe("b");
});

// The streamed write path removes V8's "Invalid string length" ceiling by never
// materializing the whole serialized envelope. We can't allocate a >512 MB
// string in a unit test, so we force the path with a tiny size override and
// assert it produces the *same* envelope as the in-memory path.

test("streamed writes produce the same envelope as the in-memory path", async () => {
  const payload = {
    sourceMonthFolder: "5-May-2026",
    totalRows: 3,
    rows: [
      { id: 0, name: "row-0", flag: true, note: null },
      { id: 1, name: "row-1", flag: false, score: 1.5 },
      { id: 2, name: "row-2", tags: ["a", "b"], nested: { x: 1 } },
    ],
  };

  // Reference: ordinary in-memory write (path unchanged).
  const refDir = createMemoryDirectory();
  await safeWriteJson(refDir, "ref.json", payload);
  const refEnv = JSON.parse(await readRaw(refDir, "ref.json")) as {
    metadata: { contentHash: string };
  };

  // Streamed write of the identical payload.
  const streamDir = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  await safeWriteJson(streamDir, "stream.json", payload);
  const streamEnv = JSON.parse(await readRaw(streamDir, "stream.json")) as {
    metadata: { contentHash: string; revision: number; schemaVersion: number };
    data: unknown;
  };

  // Data serializes identically, and the streamed content hash equals the
  // canonical simpleHash(JSON.stringify(data)) — so it validates on read.
  expect(JSON.stringify(streamEnv.data)).toBe(JSON.stringify(payload));
  expect(streamEnv.metadata.contentHash).toBe(
    simpleHash(JSON.stringify(payload))
  );
  expect(streamEnv.metadata.contentHash).toBe(refEnv.metadata.contentHash);
  expect(streamEnv.metadata.schemaVersion).toBe(1);
  expect(streamEnv.metadata.revision).toBe(1);

  // And it round-trips through safeReadJson without falling back to .bak.
  const result = await safeReadJson<typeof payload>(streamDir, "stream.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.rows).toHaveLength(3);
    expect(result.recoveredFromBak).toBe(false);
  }
});

test("streamed writes snapshot the previous file to .bak and bump revision", async () => {
  const dir = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  await safeWriteJson(dir, "a.json", { rows: [{ v: 1 }] });
  await safeWriteJson(dir, "a.json", { rows: [{ v: 2 }] });

  const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as {
    data: { rows: { v: number }[] };
  };
  const live = JSON.parse(await readRaw(dir, "a.json")) as {
    metadata: { revision: number };
    data: { rows: { v: number }[] };
  };
  expect(bak.data.rows[0].v).toBe(1);
  expect(live.data.rows[0].v).toBe(2);
  expect(live.metadata.revision).toBe(2);
});

test("safeReadJson recovers a streamed write from .bak when the live file is corrupt", async () => {
  const dir = createMemoryDirectory();
  __setStreamingForcedSizeLimitForTests(0);
  await safeWriteJson(dir, "a.json", { rows: [{ v: 1 }] });
  await safeWriteJson(dir, "a.json", { rows: [{ v: 2 }] }); // a.json.bak now holds v:1
  __resetStreamingForcedSizeLimitForTests();

  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const result = await safeReadJson<{ rows: { v: number }[] }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.rows[0].v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }
});

test("safeWriteJsonText streams large restore payloads and round-trips", async () => {
  const dir = createMemoryDirectory();
  // Build a valid envelope file, then restore its text via the streamed path.
  await safeWriteJson(dir, "a.json", { rows: [{ v: 1 }, { v: 2 }] });
  const text = await readRaw(dir, "a.json");

  __setStreamingForcedSizeLimitForTests(0);
  await safeWriteJsonText(dir, "b.json", text);

  const result = await safeReadJson<{ rows: { v: number }[] }>(dir, "b.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.rows.map((r) => r.v)).toEqual([1, 2]);
  }
});
