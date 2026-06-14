import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";

test("missing file getFileHandle throws a NotFoundError", async () => {
  const dir = createMemoryDirectory("root");
  await expect(
    dir.getFileHandle("missing.json", { create: false })
  ).rejects.toMatchObject({ name: "NotFoundError" });
});

test("write then read round-trips text", async () => {
  const dir = createMemoryDirectory("root");
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("hello");
  await writable.close();

  const file = await handle.getFile();
  expect(await file.text()).toBe("hello");
});

test("createWritable truncates previous contents", async () => {
  const dir = createMemoryDirectory("root");
  const handle = await dir.getFileHandle("a.json", { create: true });
  let writable = await handle.createWritable!();
  await writable.write("first-and-longer");
  await writable.close();

  writable = await handle.createWritable!();
  await writable.write("second");
  await writable.close();

  const file = await handle.getFile();
  expect(await file.text()).toBe("second");
});

test("nested directories are created and persist", async () => {
  const dir = createMemoryDirectory("root");
  const sub = await dir.getDirectoryHandle(".system", { create: true });
  await sub.getDirectoryHandle("locks", { create: true });

  const reread = await dir.getDirectoryHandle(".system", { create: false });
  const locks = await reread.getDirectoryHandle("locks", { create: false });
  expect(locks.name).toBe("locks");
});
