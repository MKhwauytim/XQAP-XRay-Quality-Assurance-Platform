/**
 * Disk sync of the browser-storage user-management state (Tier-1 Item F) —
 * extracted from `UserManagement/index.tsx`'s inline `saveUsersToDisk` so
 * data-layer callers (e.g. backup verification/tests) can reference the same
 * serialization without importing a React component.
 */

import type { UserManagementState } from "../../auth/userManagement";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
import { WORKSPACE_FILE_NAMES } from "./workspaceDefaults";
import { WORKSPACE_SCHEMA_VERSION, type UsersPermissionsFile } from "./workspaceTypes";
import { getUserDataRoot } from "./workspacePaths";

/**
 * Serializes the in-memory user-management state to
 * `3-user-data/users.permissions.json`, preserving revision/creation
 * metadata from the existing file when present.
 *
 * SEC-01 note: `users.permissions.json` carries password hashes
 * (Argon2id/legacy-PBKDF2) into the workspace and its backups. Workspace
 * folder ACLs are the only protection for this file at rest — never write
 * plaintext passwords here.
 */
export async function syncUserManagementToDisk(
  directoryHandle: DirectoryHandleLike,
  next: UserManagementState,
  actor: string
): Promise<void> {
  const userDataDir = await getUserDataRoot(directoryHandle, true);
  const existing = await readJsonFile<UsersPermissionsFile>(
    userDataDir,
    WORKSPACE_FILE_NAMES.usersPermissions
  );
  const prevMeta = existing.ok ? existing.file.metadata : null;
  const now = new Date().toISOString();

  const diskFile: UsersPermissionsFile = {
    metadata: {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      fileType: "users.permissions",
      revision: prevMeta ? prevMeta.revision + 1 : 1,
      createdAt: prevMeta?.createdAt ?? now,
      createdBy: prevMeta?.createdBy ?? actor,
      updatedAt: now,
      updatedBy: actor,
      contentHash: "",
    },
    data: {
      users: next.users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        passwordHash: u.passwordHash,
        role: u.role,
        isActive: u.isActive,
        hasCertScanLicense: u.hasCertScanLicense ?? false,
        createdAt: u.createdAt,
        createdBy: actor,
        updatedAt: u.updatedAt,
        updatedBy: actor,
      })),
      roles: [
        { id: "guest",      label: "ضيف",  description: "وصول قراءة فقط.",          isSystemRole: true },
        { id: "employee",   label: "موظف",  description: "صلاحيات تشغيلية.",          isSystemRole: true },
        { id: "supervisor", label: "مشرف",  description: "صلاحيات إشرافية.",           isSystemRole: true },
        { id: "manager",    label: "مدير",  description: "صلاحيات إدارية وتشغيلية.", isSystemRole: true },
      ],
      permissions: next.permissions.map((p) => ({
        role: p.role,
        tabId: p.tabId,
        access: p.access,
      })),
      featurePermissions: next.featurePermissions.map((f) => ({
        role: f.role,
        featureId: f.featureId,
        enabled: f.enabled,
      })),
    },
  };

  await writeJsonFile(userDataDir, WORKSPACE_FILE_NAMES.usersPermissions, diskFile);
}
