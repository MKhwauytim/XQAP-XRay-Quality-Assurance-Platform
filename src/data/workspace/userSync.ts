/**
 * Disk sync of the browser-storage user-management state (Tier-1 Item F) —
 * extracted from `UserManagement/index.tsx`'s inline `saveUsersToDisk` so
 * data-layer callers (e.g. backup verification/tests) can reference the same
 * serialization without importing a React component.
 */

import type { UserManagementState } from "../../auth/userManagement";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readJsonFile, writeJsonFile } from "../storage/fileSystemAccess";
import { codedMessage } from "../storage/errorCodes";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { WORKSPACE_FILE_NAMES } from "./workspaceDefaults";
import { WORKSPACE_SCHEMA_VERSION, type UsersPermissionsFile } from "./workspaceTypes";
import { getUserDataRoot } from "./workspacePaths";

/**
 * Either the write landed, or it was abandoned WITHOUT touching the file —
 * carried through casLoop's result channel (rather than thrown) so an
 * unreadable identity file aborts immediately instead of burning the whole CAS
 * retry budget on a condition no retry inside this loop can fix.
 */
type SyncOutcome = { ok: true } | { ok: false; error: string };

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
    casLoop<SyncOutcome>(
      async (writeToken) => {
        const existing = await readJsonFile<UsersPermissionsFile>(
          userDataDir,
          WORKSPACE_FILE_NAMES.usersPermissions
        );
        // "I could not read it" is NOT "there is nothing there". Collapsing
        // every failed read into `prevMeta = null` made ONE transient share
        // blip (NotReadableError on an idle SMB session, an antivirus lock, a
        // revoked grant) restart the identity file's revision counter at 1 and
        // re-stamp createdAt/createdBy — while still WRITING the file. Every
        // other machine then holds a revision far ahead of the share's, so the
        // CAS token/revision pair that is supposed to catch a lost update no
        // longer means anything, and the next admin's edit silently fights it.
        //
        //  - missing / invalid_json → genuinely nothing usable on disk: seed a
        //    fresh file (revision 1). An unparseable file has already lost its
        //    metadata, and readJsonFile has already tried the .bak/.tmp ladder.
        //  - read_failed → transient. Abort THIS cycle, keep the in-memory
        //    roster authoritative, and let the caller retry on the next tick.
        //  - permission_denied → terminal. Never seed, never reset the
        //    revision; surface it so the user reconnects the workspace.
        if (!existing.ok && existing.reason !== "missing" && existing.reason !== "invalid_json") {
          return {
            done: true,
            result: {
              ok: false as const,
              error:
                existing.reason === "permission_denied"
                  ? codedMessage("XQ-FS-013", { file: WORKSPACE_FILE_NAMES.usersPermissions })
                  : codedMessage("XQ-FS-014", { file: WORKSPACE_FILE_NAMES.usersPermissions }),
            },
          };
        }
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
            // SEC-01 applies here too: this is an Argon2id hash of the admin
            // passcode, never the passcode itself.
            adminAccount: {
              passwordHash: next.adminAccount.passwordHash,
              allowUsernameLogin: next.adminAccount.allowUsernameLogin,
              updatedAt: next.adminAccount.updatedAt,
              updatedBy: next.adminAccount.updatedBy,
            },
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
          return {
            done: true,
            result: { ok: true as const },
            verify: async () => {
              const recheck = await readJsonFile<UsersPermissionsFile>(
                userDataDir,
                WORKSPACE_FILE_NAMES.usersPermissions
              );
              return (
                recheck.ok &&
                recheck.file.metadata.revision === nextRevision &&
                recheck.file.metadata._writeToken === writeToken
              );
            },
          };
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
