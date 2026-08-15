/* @vitest-environment jsdom */
import { expect, test } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
  setSimulatedFaults,
  type OperationLogEntry,
} from "../storage/memoryDirectory";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { directoryPath, directoryResourceKey } from "../storage/webLocks";
import { ALL_DATA_REFRESH_FAMILIES, broadcastDataRefresh } from "./dataRefreshSignal";
import {
  LEGACY_WORKSPACE_ROOTS,
  WORKSPACE_ROOTS,
  __clearWorkspaceDirCacheForTests,
  getPopulationRoot,
  invalidateWorkspaceDirCache,
  POPULATION_SUBFOLDERS,
  SAMPLE_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  REPORTS_SUBFOLDERS,
  getSampleMainDir,
  getSampleEmployeeDir,
  getSampleApprovalsDir,
} from "./workspacePaths";

test("WORKSPACE_ROOTS are lowercase kebab-case", () => {
  expect(WORKSPACE_ROOTS).toEqual({
    population: "1-population",
    samples: "2-samples",
    userData: "3-user-data",
    reports: "4-reports",
    system: "5-system",
    templates: "6-templates",
  });
});

test("POPULATION_SUBFOLDERS, SAMPLE_SUBFOLDERS, SYSTEM_FOLDER_NAMES, REPORTS_SUBFOLDERS are lowercase", () => {
  expect(POPULATION_SUBFOLDERS).toEqual({ raw: "1-raw", processed: "2-processed" });
  expect(SAMPLE_SUBFOLDERS).toEqual({
    main: "1-main",
    employees: "2-employees",
    approvals: "3-approvals",
  });
  expect(SYSTEM_FOLDER_NAMES).toEqual({
    locks: "locks",
    audit: "audit",
    backups: "backups",
    powerbiExport: "powerbi-export",
    userPresets: "user-presets",
    feedback: "feedback",
    notifications: "notifications",
    adhocImports: "adhoc-imports",
  });
  expect(REPORTS_SUBFOLDERS).toEqual({ designs: "designs" });
});

test("getSampleMainDir/EmployeeDir/ApprovalsDir create lowercase numbered subfolders", async () => {
  const root = createMemoryDirectory();

  const main = await getSampleMainDir(root, "5-may-2026", true);
  expect(main.name).toBe("1-main");

  const employees = await getSampleEmployeeDir(root, "5-may-2026", true);
  expect(employees.name).toBe("2-employees");

  const approvals = await getSampleApprovalsDir(root, "5-may-2026", true);
  expect(approvals.name).toBe("3-approvals");
});

/* --------------------------------------------------------------------------
 * Item 1.7 — directory-handle cache
 * -------------------------------------------------------------------------- */

function dirOpens(root: DirectoryHandleLike, name?: string): OperationLogEntry[] {
  return getOperationLog(root).filter(
    (entry) =>
      entry.operation === "getDirectoryHandle" && (name === undefined || entry.name === name)
  );
}

test("a warm read re-uses the whole resolved directory chain instead of re-walking it", async () => {
  const root = createMemoryDirectory("cache-root", { trackOperations: true });
  __clearWorkspaceDirCacheForTests();

  // Cold: 2-samples → {month} → 1-main is three round trips.
  await getSampleMainDir(root, "5-May-2026", true);
  expect(dirOpens(root)).toHaveLength(3);

  clearOperationLog(root);
  await getSampleMainDir(root, "5-May-2026", true);
  await getSampleMainDir(root, "5-May-2026", true);
  // Warm: zero. On the UNC/SMB share this is the whole point of item 1.7.
  expect(dirOpens(root)).toHaveLength(0);

  // Sibling sub-dirs of an already-resolved month pay one open, not three.
  clearOperationLog(root);
  await getSampleEmployeeDir(root, "5-May-2026", true);
  expect(dirOpens(root)).toHaveLength(1);
});

test("getRoot's legacy-folder probe is resolved once, not on every call", async () => {
  const root = createMemoryDirectory("legacy-root", { trackOperations: true });
  __clearWorkspaceDirCacheForTests();
  // A legacy workspace: only the unnumbered `Population/` folder exists.
  await root.getDirectoryHandle(LEGACY_WORKSPACE_ROOTS.population, { create: true });

  clearOperationLog(root);
  const first = await getPopulationRoot(root, false);
  expect(first.name).toBe(LEGACY_WORKSPACE_ROOTS.population);
  // Cold: the numbered name is probed and misses, then the legacy name hits.
  expect(dirOpens(root, WORKSPACE_ROOTS.population)).toHaveLength(1);
  expect(dirOpens(root, LEGACY_WORKSPACE_ROOTS.population)).toHaveLength(1);

  clearOperationLog(root);
  await getPopulationRoot(root, false);
  expect(dirOpens(root)).toHaveLength(0);

  // An explicit invalidation drops the remembered name along with the handles
  // (it is the "assume nothing about this workspace" reset), so the probe pair
  // is paid once more — and once only.
  invalidateWorkspaceDirCache(root);
  clearOperationLog(root);
  const again = await getPopulationRoot(root, false);
  expect(again.name).toBe(LEGACY_WORKSPACE_ROOTS.population);
  expect(dirOpens(root, WORKSPACE_ROOTS.population)).toHaveLength(1);
  clearOperationLog(root);
  await getPopulationRoot(root, false);
  expect(dirOpens(root)).toHaveLength(0);
});

test("bumpWorkspaceEpoch invalidates the month's cached handles", async () => {
  const root = createMemoryDirectory("epoch-root", { trackOperations: true });
  __clearWorkspaceDirCacheForTests();
  await getSampleMainDir(root, "5-May-2026", true);
  await getSampleMainDir(root, "6-June-2026", true);

  bumpWorkspaceEpoch(root, "5-May-2026");

  clearOperationLog(root);
  await getSampleMainDir(root, "5-May-2026", true);
  // The bumped month re-resolves {month} and 1-main; 2-samples is not
  // month-scoped and stays cached.
  expect(dirOpens(root).map((entry) => entry.name)).toEqual(["5-May-2026", "1-main"]);

  clearOperationLog(root);
  await getSampleMainDir(root, "6-June-2026", true);
  // A different month was not bumped and must not have been invalidated.
  expect(dirOpens(root)).toHaveLength(0);
});

test("a manual refresh purges the cache; a periodic tick does not", async () => {
  const root = createMemoryDirectory("refresh-root", { trackOperations: true });
  __clearWorkspaceDirCacheForTests();
  await getSampleMainDir(root, "5-May-2026", true);

  broadcastDataRefresh({ source: "periodic", changed: new Set(ALL_DATA_REFRESH_FAMILIES) });
  clearOperationLog(root);
  await getSampleMainDir(root, "5-May-2026", true);
  expect(dirOpens(root)).toHaveLength(0);

  broadcastDataRefresh("manual");
  clearOperationLog(root);
  await getSampleMainDir(root, "5-May-2026", true);
  expect(dirOpens(root)).toHaveLength(3);
});

test("a NotFoundError through a cached handle drops the stale chain and retries", async () => {
  const root = createMemoryDirectory("stale-root", { trackOperations: true });
  __clearWorkspaceDirCacheForTests();
  // Warms 2-samples and 2-samples/{month}; 2-employees is NOT cached yet.
  await getSampleMainDir(root, "5-May-2026", true);

  // The month folder was deleted and recreated externally, so the cached month
  // handle is an object that resolves nothing: opening a child through it
  // raises NotFoundError, exactly as a real handle to a deleted directory does.
  setSimulatedFaults(root, [
    { operation: "getDirectoryHandle", name: SAMPLE_SUBFOLDERS.employees, times: 1 },
  ]);

  clearOperationLog(root);
  const recovered = await getSampleEmployeeDir(root, "5-May-2026", true);
  expect(recovered.name).toBe(SAMPLE_SUBFOLDERS.employees);
  // 2-employees through the stale cached month (raises) → the stale ancestors
  // are dropped → the month is re-resolved → 2-employees succeeds.
  expect(dirOpens(root).map((entry) => entry.name)).toEqual([
    SAMPLE_SUBFOLDERS.employees,
    "5-May-2026",
    SAMPLE_SUBFOLDERS.employees,
  ]);

  // And the retry re-cached the chain rather than leaving it half-dropped.
  clearOperationLog(root);
  await getSampleEmployeeDir(root, "5-May-2026", true);
  await getSampleMainDir(root, "5-May-2026", true);
  expect(dirOpens(root)).toHaveLength(1); // only 1-main, dropped with the subtree
});

test("a genuinely missing directory still throws instead of retrying forever", async () => {
  const root = createMemoryDirectory("missing-root");
  __clearWorkspaceDirCacheForTests();
  await expect(getSampleMainDir(root, "5-May-2026", false)).rejects.toThrow();
});

/* --------------------------------------------------------------------------
 * Item 1.11 — lock-key path registry
 * -------------------------------------------------------------------------- */

test("distinct months produce distinct lock keys for the same file name", async () => {
  const root = createMemoryDirectory("lock-root");
  __clearWorkspaceDirCacheForTests();

  const may = await getSampleMainDir(root, "5-May-2026", true);
  const june = await getSampleMainDir(root, "6-June-2026", true);

  // Both leaves are called "1-main" — the old `dir.name` key made every month
  // in the workspace contend on one lock.
  expect(may.name).toBe(june.name);
  expect(directoryResourceKey(may, "sample.master.json")).toBe(
    "2-samples/5-May-2026/1-main/sample.master.json"
  );
  expect(directoryResourceKey(june, "sample.master.json")).toBe(
    "2-samples/6-June-2026/1-main/sample.master.json"
  );
  expect(directoryResourceKey(may, "sample.master.json")).not.toBe(
    directoryResourceKey(june, "sample.master.json")
  );

  // Different file in the same folder is still a different key.
  expect(directoryResourceKey(may, "main.samples.json")).not.toBe(
    directoryResourceKey(may, "sample.master.json")
  );
});

test("an unregistered directory handle falls back to its leaf name", () => {
  const bare = { kind: "directory", name: "1-main" } as unknown as DirectoryHandleLike;
  expect(directoryPath(bare)).toBe("1-main");
  expect(directoryResourceKey(bare, "sample.master.json")).toBe("1-main/sample.master.json");
});

test("memory directories register their full path", async () => {
  const root = createMemoryDirectory("mem-root");
  const nested = await (
    await root.getDirectoryHandle("a", { create: true })
  ).getDirectoryHandle("b", { create: true });
  expect(directoryPath(nested)).toBe("a/b");
  // The root has no relative path of its own, so it keeps its name.
  expect(directoryPath(root)).toBe("mem-root");
});
