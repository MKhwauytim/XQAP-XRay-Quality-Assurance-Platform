// An answers scan that could not be established is not a month in which nobody
// answered anything.
//
// The reported incident: a supervisor opened نتائج الفحص during a share outage
// and read off it that an employee had completed 2 samples all day. The
// employee had completed many more; the scan that should have found them
// failed, was logged, and returned `[]` — which every caller (this view, the
// executive report, the Power BI export, a backup) reads as fact.
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadAllEmployeeFiles, loadAllEmployeeRequestFiles, upsertItemAnswer } from "./answerStorage";

const MONTH = "5-may-2026";

async function seedTwoEmployees(): Promise<ReturnType<typeof createMemoryDirectory>> {
  const root = createMemoryDirectory("root");
  for (const [username, imageId] of [
    ["emp-1", "IMG-1"],
    ["emp-2", "IMG-2"],
  ] as const) {
    const saved = await upsertItemAnswer(root, MONTH, username, {
      xrayImageId: imageId,
      answeredBy: username,
      answers: [],
      status: "submitted",
      submittedAt: "2026-05-02T00:00:00.000Z",
      templateId: "tpl-1",
      templateVersion: 1,
      lastSavedAt: "2026-05-02T00:00:00.000Z",
    });
    if (!saved.ok) throw new Error(`seed ${username} failed: ${saved.error}`);
  }
  return root;
}


/**
 * The seeded tree, with one directory name that raises `NotReadableError` on
 * open — the share-flake shape. A proxy rather than `setSimulatedFaults`
 * because `workspacePaths` caches resolved directory handles per root object,
 * so a fault installed after seeding is never consulted again.
 */
function withUnreadableDir(root: DirectoryHandleLike, unreadableName: string): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    ({
      ...dir,
      kind: "directory",
      name: dir.name,
      getFileHandle: (...args: Parameters<DirectoryHandleLike["getFileHandle"]>) =>
        dir.getFileHandle(...args),
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        if (name === unreadableName) {
          const error = new Error(`Simulated NotReadableError for "${name}".`);
          error.name = "NotReadableError";
          throw error;
        }
        return wrap(await dir.getDirectoryHandle(name, options));
      },
    }) as DirectoryHandleLike;
  return wrap(root);
}

describe("employee answer fan-out: a failed scan is not an empty month", () => {
  it("reads both employees when the share is healthy", async () => {
    const root = await seedTwoEmployees();
    const files = await loadAllEmployeeFiles(root, MONTH);
    expect(files.map((f) => f.username)).toEqual(["emp-1", "emp-2"]);
  });

  it("throws rather than reporting an empty month when the answers directory cannot be opened", async () => {
    const seeded = await seedTwoEmployees();
    // A fresh root object, so `workspacePaths`' directory-handle cache cannot
    // serve the seeding phase's handle straight past the fault below.
    const root = withUnreadableDir(seeded, "2-employees");

    await expect(loadAllEmployeeFiles(root, MONTH)).rejects.toMatchObject({
      name: "NotReadableError",
    });
    await expect(loadAllEmployeeRequestFiles(root, MONTH)).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });
});
