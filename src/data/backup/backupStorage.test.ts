import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getUserDataRoot } from "../workspace/workspacePaths";
import { WORKSPACE_FILE_NAMES } from "../workspace/workspaceDefaults";
import { createBackup } from "./backupStorage";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("createBackup — Tier-1 Item F coverage", () => {
  it("includes seeded 3-user-data/ files (users.permissions.json + labels snapshot) in jsonFilesBackedUp", async () => {
    const root = makeRoot();
    const userDataDir = await getUserDataRoot(root, true);
    await safeWriteJson(userDataDir, WORKSPACE_FILE_NAMES.usersPermissions, {
      metadata: {
        schemaVersion: "1",
        fileType: "users.permissions",
        revision: 1,
        createdAt: new Date().toISOString(),
        createdBy: "admin",
        updatedAt: new Date().toISOString(),
        updatedBy: "admin",
        contentHash: "",
      },
      data: { users: [], roles: [], permissions: [], featurePermissions: [] },
    });

    const result = await createBackup(root, [], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // users.permissions.json (seeded) and labels.snapshot.json (written by
    // createBackup's exportLabelsSnapshot call) must both be captured. Entries
    // are recorded with their source-relative path (e.g. "3-user-data/…"), so
    // match on suffix rather than the bare filename.
    expect(
      result.manifest.jsonFilesBackedUp.some((f) => f.endsWith(WORKSPACE_FILE_NAMES.usersPermissions))
    ).toBe(true);
    expect(
      result.manifest.jsonFilesBackedUp.some((f) => f.endsWith("labels.snapshot.json"))
    ).toBe(true);
  });
});
