import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryDirectory,
  clearSimulatedFaults,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { __clearWorkspaceDirCacheForTests, getUserDataRoot } from "./workspacePaths";
import { WORKSPACE_FILE_NAMES } from "./workspaceDefaults";
import type { UsersPermissionsFile } from "./workspaceTypes";
import { syncUserManagementToDisk } from "./userSync";
import type { UserManagementState } from "../../auth/userManagement";

/**
 * `users.permissions.json` is the identity file: it carries every managed
 * user, every role→tab permission and the Argon2id hashes, and it is written
 * from every admin's machine against ONE shared folder. Its
 * `metadata.revision` + `_writeToken` pair is the only thing that can detect a
 * lost update there.
 *
 * The defect these tests pin: a read failure that is not an absence used to be
 * treated as "no file yet", so a single transient share fault restarted the
 * revision counter at 1 and re-stamped createdAt/createdBy — on a file that
 * already existed, with a much higher revision, on every other machine.
 */
const STATE: UserManagementState = {
  users: [
    {
      id: "u-new",
      username: "incoming",
      displayName: "وارد",
      passwordHash: { algorithm: "argon2id", encoded: "new" },
      role: "employee",
      isActive: true,
      hasCertScanLicense: false,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  permissions: [{ role: "supervisor", tabId: "archive", access: "view" }],
  featurePermissions: [],
  adminAccount: {
    passwordHash: null,
    allowUsernameLogin: true,
    updatedAt: null,
    updatedBy: null,
  },
};

const EXISTING_FILE = {
  metadata: {
    schemaVersion: "1",
    fileType: "users.permissions",
    revision: 42,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "founder",
    updatedAt: "2026-04-01T00:00:00.000Z",
    updatedBy: "founder",
    contentHash: "",
  },
  data: {
    users: [
      {
        id: "u-existing",
        username: "settled",
        displayName: "مستقر",
        passwordHash: { algorithm: "argon2id", encoded: "old" },
        role: "manager",
        isActive: true,
        hasCertScanLicense: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "founder",
        updatedAt: "2026-04-01T00:00:00.000Z",
        updatedBy: "founder",
      },
    ],
    roles: [],
    permissions: [],
    featurePermissions: [],
  },
};

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;
  const userDataDir = await getUserDataRoot(root, true);
  await safeWriteJson(userDataDir, WORKSPACE_FILE_NAMES.usersPermissions, EXISTING_FILE);
  return root;
}

async function readUsersFile(root: DirectoryHandleLike): Promise<UsersPermissionsFile> {
  const userDataDir = await getUserDataRoot(root, false);
  const result = await readJsonFile<UsersPermissionsFile>(
    userDataDir,
    WORKSPACE_FILE_NAMES.usersPermissions
  );
  if (!result.ok) throw new Error(`fixture read failed: ${result.reason}`);
  return result.file;
}

beforeEach(() => {
  __clearWorkspaceDirCacheForTests();
});

describe("syncUserManagementToDisk — an unreadable identity file is not an absent one", () => {
  // `readJsonFile` (fileSystemAccess.ts) now retries a transient NotReadableError
  // on this exact read — closing the XQ-FS-014/XQ-WS-013 gap where a single SMB
  // blip on `users.permissions.json`, hit on every 45s sync tick, surfaced with
  // zero retries even though the same fault class was already retried everywhere
  // safeWrite.ts reads. A ONE-shot blip is therefore no longer this test's
  // boundary case — see the "single blip" test below for that regression — but a
  // PERSISTENT failure (one that outlasts the retry budget) must still abort the
  // cycle rather than being read as absence and silently resetting the revision
  // counter, which is what this test now pins.
  it("aborts the cycle on a PERSISTENT read failure instead of resetting the revision counter", async () => {
    const root = await seedWorkspace();

    setSimulatedFaults(root, [
      {
        operation: "getFile",
        name: WORKSPACE_FILE_NAMES.usersPermissions,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    await expect(syncUserManagementToDisk(root, STATE, "admin")).rejects.toThrow();

    clearSimulatedFaults(root);
    const onDisk = await readUsersFile(root);
    // Untouched: same revision, same creator, same roster. The in-memory state
    // stays authoritative for the next tick's retry.
    expect(onDisk.metadata.revision).toBe(42);
    expect(onDisk.metadata.createdBy).toBe("founder");
    expect(onDisk.metadata.updatedBy).toBe("founder");
    expect(onDisk.data.users.map((user) => user.username)).toEqual(["settled"]);
  });

  it("rides out a single transient NotReadableError blip and completes normally (XQ-FS-014/XQ-WS-013 regression)", async () => {
    const root = await seedWorkspace();

    // ONE getFile() of users.permissions.json fails with a transient
    // NotReadableError, and the very next read succeeds — the exact shape of
    // the production log entries this fix targets. This must no longer abort
    // the sync at all.
    setSimulatedFaults(root, [
      {
        operation: "getFile",
        name: WORKSPACE_FILE_NAMES.usersPermissions,
        errorName: "NotReadableError",
        times: 1,
      },
    ]);

    await syncUserManagementToDisk(root, STATE, "admin");

    clearSimulatedFaults(root);
    const onDisk = await readUsersFile(root);
    expect(onDisk.metadata.revision).toBe(43);
    expect(onDisk.data.users.map((user) => user.username)).toEqual(["incoming"]);
  });

  it("aborts on a permission-denied read without seeding a replacement file", async () => {
    const root = await seedWorkspace();

    setSimulatedFaults(root, [
      {
        operation: "getFile",
        name: WORKSPACE_FILE_NAMES.usersPermissions,
        errorName: "NotAllowedError",
        times: 1,
      },
    ]);

    await expect(syncUserManagementToDisk(root, STATE, "admin")).rejects.toThrow();

    clearSimulatedFaults(root);
    const onDisk = await readUsersFile(root);
    expect(onDisk.metadata.revision).toBe(42);
    expect(onDisk.data.users.map((user) => user.username)).toEqual(["settled"]);
  });

  it("still advances the revision normally when the file reads fine (control)", async () => {
    const root = await seedWorkspace();

    await syncUserManagementToDisk(root, STATE, "admin");

    const onDisk = await readUsersFile(root);
    expect(onDisk.metadata.revision).toBe(43);
    // Creation metadata is preserved from the existing file, not re-stamped.
    expect(onDisk.metadata.createdBy).toBe("founder");
    expect(onDisk.metadata.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(onDisk.data.users.map((user) => user.username)).toEqual(["incoming"]);
  });

  it("seeds a fresh revision-1 file when there is genuinely nothing on disk (control)", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;

    await syncUserManagementToDisk(root, STATE, "admin");

    const onDisk = await readUsersFile(root);
    expect(onDisk.metadata.revision).toBe(1);
    expect(onDisk.metadata.createdBy).toBe("admin");
  });
});
