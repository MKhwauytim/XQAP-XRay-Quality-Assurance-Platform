import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";

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

test("safeReadJson reports missing files", async () => {
  const dir = createMemoryDirectory();
  const result = await safeReadJson(dir, "nope.json");
  expect(result).toMatchObject({ ok: false, reason: "missing" });
});
