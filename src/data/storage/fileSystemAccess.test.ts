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

test("createWorkspaceStructure creates numbered workspace folders", async () => {
  const dir = createMemoryDirectory();
  // createWorkspaceStructure calls ensureDirectoryPermission which calls queryPermission.
  // The memory double always returns "granted" so the permission gate passes.
  await createWorkspaceStructure(dir, "test-user");

  const population = await dir.getDirectoryHandle("1-Population", { create: false });
  expect(population.name).toBe("1-Population");

  const samples = await dir.getDirectoryHandle("2-Samples", { create: false });
  expect(samples.name).toBe("2-Samples");

  const userData = await dir.getDirectoryHandle("3-User Data", { create: false });
  expect(userData.name).toBe("3-User Data");

  const system = await dir.getDirectoryHandle("5-System", { create: false });
  const backups = await system.getDirectoryHandle("3-Backups", { create: false });
  expect(backups.name).toBe("3-Backups");

  const templates = await dir.getDirectoryHandle("6-Templates", { create: false });
  expect(templates.name).toBe("6-Templates");
});
