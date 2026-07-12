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

  it("survives two concurrent full-state writes without a silent lost update (cross-machine CAS)", async () => {
    const root = makeRoot();

    // Two admins on two PCs save near-simultaneously from independent snapshots.
    // Each write is a whole-object replace, so the contract is
    // last-writer-wins-CLEANLY: exactly one complete state must survive, the
    // revision must advance past BOTH writes (proving the second re-read the
    // first's revision instead of clobbering it at the same revision), and no
    // partial/torn state is left behind.
    const stateA: UserManagementState = {
      ...STATE,
      users: [{ ...STATE.users[0]!, id: "uA", username: "alpha" }],
    };
    const stateB: UserManagementState = {
      ...STATE,
      users: [{ ...STATE.users[0]!, id: "uB", username: "beta" }],
    };

    await Promise.all([
      syncUserManagementToDisk(root, stateA, "adminA"),
      syncUserManagementToDisk(root, stateB, "adminB"),
    ]);

    const userDataDir = await getUserDataRoot(root, false);
    const result = await readJsonFile<UsersPermissionsFile>(
      userDataDir,
      WORKSPACE_FILE_NAMES.usersPermissions
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both writes participated in the CAS protocol → revision advanced to 2.
    expect(result.file.metadata.revision).toBe(2);
    // Exactly one complete, uncorrupted winner survived.
    expect(result.file.data.users).toHaveLength(1);
    expect(["alpha", "beta"]).toContain(result.file.data.users[0]!.username);
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
