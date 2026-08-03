import { expect, test, vi } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import {
  checkWorkspaceStructure,
  createWorkspaceStructure,
  readJsonFile,
  writeJsonFile,
} from "./fileSystemAccess";

test("workspace checks require read permission only", async () => {
  const dir = createMemoryDirectory();
  const queryPermission = vi.fn(async () => "granted" as const);
  dir.queryPermission = queryPermission;

  await checkWorkspaceStructure(dir);

  expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
});

test("checkWorkspaceStructure preserves item order across categories after parallelizing (§V)", async () => {
  const dir = createMemoryDirectory();
  // Present: 1-population, 4-reports, 5-system (with "audit" + "backups" subfolders).
  // Missing: 2-samples, 3-user-data, 6-templates (top folders); "locks" (system
  // subfolder); both required files -- deliberately spread across all three
  // checked categories to prove the concatenated order survives parallelizing.
  await dir.getDirectoryHandle("1-population", { create: true });
  await dir.getDirectoryHandle("4-reports", { create: true });
  const system = await dir.getDirectoryHandle("5-system", { create: true });
  await system.getDirectoryHandle("audit", { create: true });
  await system.getDirectoryHandle("backups", { create: true });

  const result = await checkWorkspaceStructure(dir);

  expect(result.missingItems).toEqual([
    "2-samples",
    "3-user-data",
    "6-templates",
    "5-system/locks",
    "workspace.manifest.json",
    "users.permissions.json",
  ]);
});

test("checkWorkspaceStructure checks top-level folders concurrently, not one at a time (§V)", async () => {
  const inner = createMemoryDirectory();
  let current = 0;
  let peak = 0;
  const tracked = {
    ...inner,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await inner.getDirectoryHandle(name, options);
      } finally {
        current -= 1;
      }
    },
  };

  await checkWorkspaceStructure(tracked);

  // 6 top-level folders are checked in the first phase -- if they still ran
  // one at a time, peak would never exceed 1.
  expect(peak).toBeGreaterThan(1);
});

test("writeJsonFile produces a .bak snapshot on the second write", async () => {
  const dir = createMemoryDirectory();
  await writeJsonFile(dir, "x.json", { a: 1 });
  await writeJsonFile(dir, "x.json", { a: 2 });

  // Files are written as JsonEnvelope<T> — readJsonFile returns the raw envelope
  const live = await readJsonFile<{ data: { a: number } }>(dir, "x.json");
  const bak = await readJsonFile<{ data: { a: number } }>(dir, "x.json.bak");

  expect(live.ok && live.file.data.a).toBe(2);
  expect(bak.ok && bak.file.data.a).toBe(1);
});

test(".bak recovery: readJsonFile falls back to the snapshot when the live file is missing", async () => {
  const dir = createMemoryDirectory();
  // A torn write left only the .bak snapshot (no valid live bootstrap file).
  await writeJsonFile(dir, "manifest.json.bak", { schema: "m" });

  const rec = await readJsonFile<{ data: { schema: string } }>(dir, "manifest.json");
  expect(rec.ok && rec.file.data.schema).toBe("m");
});

test(".bak recovery: readJsonFile recovers from .bak when the live file is corrupt", async () => {
  const dir = createMemoryDirectory();
  await writeJsonFile(dir, "manifest.json", { v: 1 });
  await writeJsonFile(dir, "manifest.json", { v: 2 }); // second write snapshots v:1 to .bak

  // Torn write: overwrite the live file with invalid JSON.
  const fh = await dir.getFileHandle("manifest.json", { create: true });
  const writable = await fh.createWritable!();
  await writable.write("{ broken json");
  await writable.close();

  const rec = await readJsonFile<{ data: { v: number } }>(dir, "manifest.json");
  expect(rec.ok && rec.file.data.v).toBe(1); // recovered from the .bak snapshot
});

test("createWorkspaceStructure creates numbered workspace folders", async () => {
  const dir = createMemoryDirectory();
  // createWorkspaceStructure calls ensureDirectoryPermission which calls queryPermission.
  // The memory double always returns "granted" so the permission gate passes.
  await createWorkspaceStructure(dir, "test-user");

  const population = await dir.getDirectoryHandle("1-population", { create: false });
  expect(population.name).toBe("1-population");

  const samples = await dir.getDirectoryHandle("2-samples", { create: false });
  expect(samples.name).toBe("2-samples");

  const userData = await dir.getDirectoryHandle("3-user-data", { create: false });
  expect(userData.name).toBe("3-user-data");

  const system = await dir.getDirectoryHandle("5-system", { create: false });
  const backups = await system.getDirectoryHandle("backups", { create: false });
  expect(backups.name).toBe("backups");

  const templates = await dir.getDirectoryHandle("6-templates", { create: false });
  expect(templates.name).toBe("6-templates");
});
