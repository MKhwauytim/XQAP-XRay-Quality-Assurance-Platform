import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { safeReadJson, safeWriteJson, safeWriteJsonText } from "./safeWrite";
import type { DirectoryHandleLike, FileHandleLike } from "./fileSystemAccess";

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
