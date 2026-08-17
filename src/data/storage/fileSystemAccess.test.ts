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

  // `tracked` only wraps getDirectoryHandle on the top-level directoryHandle
  // object, so it also counts the required-file-root phase's 2 concurrent
  // getSystemRoot/getUserDataRoot calls (both resolve via that same object) --
  // but that phase alone can only ever reach a peak of 2. The top-folder
  // phase is the only one that can reach all 6 of allTopFolders (6 entries:
  // REQUIRED_WORKSPACE_FOLDERS, TOP_LEVEL_DATA_FOLDERS is currently empty)
  // concurrently, so >= 6 can only pass if that phase specifically still runs
  // concurrently -- a >1 threshold would stay green even if just the
  // top-folder loop (the one with the most items, and the one this task's
  // commit specifically calls out as the network-share win) regressed back to
  // sequential, since the file-root phase's peak of 2 would still clear it.
  expect(peak).toBeGreaterThanOrEqual(6);
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

// ── The create-workspace field report: "fails once, works after re-pick + re-grant" ──
// Four-link chain (2026-08-17 workflow audit): the structure check read every
// probe failure as absence, the missing_structure card then offered CREATE over
// a live-but-unreachable workspace, and the create path itself overwrote the
// manifest + users file with defaults unconditionally. These pin the closures.

test("checkWorkspaceStructure returns error (XQ-FS-015), never missing_structure, when a probe fails with a non-NotFound error", async () => {
  const { setSimulatedFaults, clearSimulatedFaults } = await import("./memoryDirectory");
  const dir = createMemoryDirectory();
  await createWorkspaceStructure(dir, "admin");

  // An idle-disconnected SMB session: the folder EXISTS, the probe just fails.
  setSimulatedFaults(dir, [
    {
      operation: "getDirectoryHandle",
      name: "1-population",
      create: false,
      errorName: "NotReadableError",
      times: Number.POSITIVE_INFINITY,
    },
  ]);
  const result = await checkWorkspaceStructure(dir);
  expect(result.status).toBe("error");
  expect(result.missingItems).toEqual([]);
  expect(result.message).toContain("XQ-FS-015");

  // The share recovers — the same workspace is ready, nothing was created.
  clearSimulatedFaults(dir);
  expect((await checkWorkspaceStructure(dir)).status).toBe("ready");
});

test("a genuinely missing folder still reports missing_structure (absence is still absence)", async () => {
  const dir = createMemoryDirectory();
  await createWorkspaceStructure(dir, "admin");
  await dir.removeEntry!("6-templates", { recursive: true });

  const result = await checkWorkspaceStructure(dir);
  expect(result.status).toBe("missing_structure");
  expect(result.missingItems).toContain("6-templates");
});

test("createWorkspaceStructure never rewrites a healthy manifest or users file", async () => {
  const dir = createMemoryDirectory();
  await createWorkspaceStructure(dir, "first-admin");
  const userData = await dir.getDirectoryHandle("3-user-data", { create: false });
  const system = await dir.getDirectoryHandle("5-system", { create: false });
  const usersBefore = await readJsonFile<Record<string, unknown>>(userData, "users.permissions.json");
  const manifestBefore = await readJsonFile<Record<string, unknown>>(system, "workspace.manifest.json");
  expect(usersBefore.ok && manifestBefore.ok).toBe(true);

  // A second create (misdiagnosed missing_structure, or the repair path) must
  // be a no-op for both files — byte-identical, not merely similar.
  await createWorkspaceStructure(dir, "second-admin");
  const usersAfter = await readJsonFile<Record<string, unknown>>(userData, "users.permissions.json");
  const manifestAfter = await readJsonFile<Record<string, unknown>>(system, "workspace.manifest.json");
  expect(usersAfter.ok && usersBefore.ok && usersAfter.rawText === usersBefore.rawText).toBe(true);
  expect(manifestAfter.ok && manifestBefore.ok && manifestAfter.rawText === manifestBefore.rawText).toBe(true);
});

test("loadWorkspaceFiles throws XQ-FS-015 for an unreadable users file instead of returning null (default-users wipe guard)", async () => {
  const { setSimulatedFaults, clearSimulatedFaults } = await import("./memoryDirectory");
  const { errorCodeOf } = await import("./errorCodes");
  const { loadWorkspaceFiles } = await import("./fileSystemAccess");
  const dir = createMemoryDirectory();
  await createWorkspaceStructure(dir, "admin");

  setSimulatedFaults(dir, [
    {
      operation: "getFile",
      name: "users.permissions.json",
      errorName: "NotReadableError",
      times: Number.POSITIVE_INFINITY,
    },
  ]);
  let thrown: unknown = null;
  try {
    await loadWorkspaceFiles(dir);
  } catch (error) {
    thrown = error;
  }
  clearSimulatedFaults(dir);
  expect(thrown).not.toBeNull();
  expect(errorCodeOf(thrown)).toBe("XQ-FS-015");

  // With the share healthy the same call returns the real users file.
  const files = await loadWorkspaceFiles(dir);
  expect(files.usersPermissions).not.toBeNull();
});
