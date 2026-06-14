import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { readJsonFile, writeJsonFile } from "./fileSystemAccess";

test("writeJsonFile produces a .bak snapshot on the second write", async () => {
  const dir = createMemoryDirectory();
  await writeJsonFile(dir, "x.json", { a: 1 });
  await writeJsonFile(dir, "x.json", { a: 2 });

  const live = await readJsonFile<{ a: number }>(dir, "x.json");
  const bak = await readJsonFile<{ a: number }>(dir, "x.json.bak");

  expect(live.ok && live.file.a).toBe(2);
  expect(bak.ok && bak.file.a).toBe(1);
});
