/**
 * Disk sync of the browser-storage user-management state (Tier-1 Item F) —
 * extracted from `UserManagement/index.tsx`'s inline `saveUsersToDisk` so
 * data-layer callers (e.g. backup verification/tests) can reference the same
 * serialization without importing a React component.
 */

import type { UserManagementState } from "../../auth/userManagement";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
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

  // Shared, multi-writer, SEC-01 file (any admin on any PC edits users / roles /
  // permissions / Argon2id password hashes). The `:rmw` outer lock serializes
  // same-tab writers; casLoop re-reads fresh state each attempt, bumps
  // metadata.revision + stamps metadata._writeToken, and verifies BOTH on
  // read-back so a concurrent admin's change on another machine is never silently
  // overwritten. NOTE: this is a whole-object replace — last-writer-wins-cleanly
  // with a detectable revision, NOT a field-level three-way merge of two admins'
  // edits (same tradeoff savePopulationConfig documents for config.json).
  const outcome = await withResourceLock(`users-permissions:rmw`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const existing = await readJsonFile<UsersPermissionsFile>(
          userDataDir,
          WORKSPACE_FILE_NAMES.usersPermissions
        );
        const prevMeta = existing.ok ? existing.file.metadata : null;
        const now = new Date().toISOString();
        const nextRevision = prevMeta ? prevMeta.revision + 1 : 1;

        const diskFile: UsersPermissionsFile = {
          metadata: {
            schemaVersion: WORKSPACE_SCHEMA_VERSION,
            fileType: "users.permissions",
            revision: nextRevision,
            createdAt: prevMeta?.createdAt ?? now,
            createdBy: prevMeta?.createdBy ?? actor,
            updatedAt: now,
            updatedBy: actor,
            contentHash: "",
            _writeToken: writeToken,
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

        const verify = await readJsonFile<UsersPermissionsFile>(
          userDataDir,
          WORKSPACE_FILE_NAMES.usersPermissions
        );
        if (
          verify.ok &&
          verify.file.metadata.revision === nextRevision &&
          verify.file.metadata._writeToken === writeToken
        ) {
          return { done: true, result: { ok: true as const } };
        }
        return { done: false };
      },
      { conflictError: "تعذّر حفظ المستخدمين والصلاحيات: تعارض في الكتابة بعد عدة محاولات." }
    )
  );

  // Surface CAS exhaustion so the caller (UserManagement.saveUsersToDisk, which
  // catches and keeps runtime state authoritative for a later retry) is aware the
  // disk write did not land — instead of silently reporting success.
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}
