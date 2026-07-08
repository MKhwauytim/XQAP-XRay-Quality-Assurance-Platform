import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile } from "../storage/fileSystemAccess";
import { getUserDataRoot } from "./workspacePaths";
import { WORKSPACE_FILE_NAMES } from "./workspaceDefaults";
import type { UsersPermissionsFile } from "./workspaceTypes";
import { syncUserManagementToDisk } from "./userSync";
import {
  normalizeUserManagementState,
  readUserManagementState,
  writeUserManagementState,
} from "../../auth/userManagement";
import type { UserManagementState } from "../../auth/userManagement";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

const STATE: UserManagementState = {
  users: [
    {
      id: "u1",
      username: "sara",
      displayName: "Sara Q",
      passwordHash: { algorithm: "argon2id", encoded: "x" },
      role: "supervisor",
      isActive: true,
      hasCertScanLicense: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  permissions: [{ role: "supervisor", tabId: "archive", access: "view" }],
  featurePermissions: [{ role: "supervisor", featureId: "approve-referrals", enabled: true }],
};

describe("syncUserManagementToDisk / featurePermissions round-trip (Tier-1 Item F verification)", () => {
  it("writes users.permissions.json including featurePermissions", async () => {
    const root = makeRoot();
    await syncUserManagementToDisk(root, STATE, "admin");

    const userDataDir = await getUserDataRoot(root, false);
    const result = await readJsonFile<UsersPermissionsFile>(
      userDataDir,
      WORKSPACE_FILE_NAMES.usersPermissions
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.file.data.featurePermissions).toEqual(STATE.featurePermissions);
    expect(result.file.data.users[0]!.username).toBe("sara");
  });

  it("featurePermissions survives a full disk round-trip through syncUsersFromDisk", async () => {
    const root = makeRoot();
    await syncUserManagementToDisk(root, STATE, "admin");

    const userDataDir = await getUserDataRoot(root, false);
    const result = await readJsonFile<UsersPermissionsFile>(
      userDataDir,
      WORKSPACE_FILE_NAMES.usersPermissions
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    writeUserManagementState(
      normalizeUserManagementState({
        users: result.file.data.users.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          passwordHash: u.passwordHash,
          role: u.role,
          isActive: u.isActive,
          hasCertScanLicense: u.hasCertScanLicense,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
        permissions: result.file.data.permissions,
        featurePermissions: result.file.data.featurePermissions ?? [],
      }),
      false
    );

    const runtime = readUserManagementState();
    expect(
      runtime.featurePermissions.some(
        (f) => f.role === "supervisor" && f.featureId === "approve-referrals" && f.enabled
      )
    ).toBe(true);
  });
});
