import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { createWorkspaceStructure, readJsonFile, writeJsonFile } from "./fileSystemAccess";

test("writeJsonFile produces a .bak snapshot on the second write", async () => {
  const dir = createMemoryDirectory();
  await writeJsonFile(dir, "x.json", { a: 1 });
  await writeJsonFile(dir, "x.json", { a: 2 });

  const live = await readJsonFile<{ a: number }>(dir, "x.json");
  const bak = await readJsonFile<{ a: number }>(dir, "x.json.bak");

  expect(live.ok && live.file.a).toBe(2);
  expect(bak.ok && bak.file.a).toBe(1);
});

test("createWorkspaceStructure creates .system/backups and templates folders", async () => {
  const dir = createMemoryDirectory();
  // createWorkspaceStructure calls ensureDirectoryPermission which calls queryPermission.
  // The memory double always returns "granted" so the permission gate passes.
  await createWorkspaceStructure(dir, "test-user");

  // Verify .system/backups exists
  const system = await dir.getDirectoryHandle(".system", { create: false });
  const backups = await system.getDirectoryHandle("backups", { create: false });
  expect(backups.name).toBe("backups");

  // Verify top-level templates folder exists
  const templates = await dir.getDirectoryHandle("templates", { create: false });
  expect(templates.name).toBe("templates");
});
