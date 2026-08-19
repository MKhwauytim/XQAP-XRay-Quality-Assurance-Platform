/**
 * PROD-2 — backup coverage for the per-user audit logs.
 *
 * `copyAllJsonFiles` walks from the workspace ROOT and `isSnapshotPayloadFile`
 * accepts any `.json`, so `5-system/audit/activity/` and `.../actions/` are
 * captured and restored with no backup-side code change at all. That is the one
 * part of the PROD-2 consumer sweep that is INFERRED rather than modified, so
 * it is pinned here: create a backup, wipe the audit tree, restore, and require
 * both per-user folders AND the untouched legacy files to come back.
 */
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { listDirectoryEntries } from "../storage/directoryScan";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAuditActionsDir, getAuditActivityDir, getAuditRoot } from "../workspace/workspacePaths";
import { actionsFileName, activityFileName } from "../audit/auditPaths";
import type { WorkspaceActionUserLogFile } from "../audit/actionLog";
import type { AuthActivityUserLogFile } from "../../auth/authActivityLog";
import { createBackup, restoreBackupSnapshot } from "./backupStorage";

const months = [{ folderName: "5-may-2026", month: 5, year: 2026 }];

function activityFile(username: string): AuthActivityUserLogFile {
  return {
    username,
    revision: 3,
    updatedAt: "2026-06-28T08:00:00.000Z",
    entries: [
      {
        id: `auth-${username}-1`,
        username,
        role: "employee",
        signedInAt: "2026-06-28T07:00:00.000Z",
        lastSeenAt: "2026-06-28T08:00:00.000Z",
        signedOutAt: "2026-06-28T08:00:00.000Z",
        durationMs: 60 * 60 * 1000,
        closeReason: "logout",
      },
    ],
  };
}

function actionsFile(actor: string): WorkspaceActionUserLogFile {
  return {
    actor,
    revision: 2,
    updatedAt: "2026-06-28T08:00:00.000Z",
    entries: [
      {
        id: `act-${actor}-1`,
        at: "2026-06-28T07:30:00.000Z",
        actor,
        actorRole: "supervisor",
        action: "referral-approved",
        target: `t-${actor}`,
      },
    ],
  };
}

async function seed(root: DirectoryHandleLike): Promise<void> {
  const activityDir = await getAuditActivityDir(root, true);
  for (const username of ["sara", "omar"]) {
    await safeWriteJson(activityDir, activityFileName(username), activityFile(username));
  }
  const actionsDir = await getAuditActionsDir(root, true);
  for (const actor of ["sara", "omar"]) {
    await safeWriteJson(actionsDir, actionsFileName(actor), actionsFile(actor));
  }
  // A pre-upgrade workspace's shared files sit alongside them and must survive
  // the round trip too.
  const auditDir = await getAuditRoot(root, true);
  await safeWriteJson(auditDir, "activity.log.json", {
    revision: 9,
    updatedAt: "2026-05-01T09:00:00.000Z",
    entries: [],
  });
  await safeWriteJson(auditDir, "actions.log.json", {
    revision: 9,
    updatedAt: "2026-05-01T09:00:00.000Z",
    entries: [],
  });
}

async function names(dir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(dir)).map((entry) => entry.name).sort();
}

describe("backup — per-user audit logs round-trip", () => {
  it("captures and restores 5-system/audit/{activity,actions}/ plus the legacy shared files", async () => {
    const root = createMemoryDirectory("root");
    await seed(root);

    const backup = await createBackup(root, months, "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const activityDir = await getAuditActivityDir(root, false);
    const actionsDir = await getAuditActionsDir(root, false);
    const activityBefore = await names(activityDir);
    const actionsBefore = await names(actionsDir);
    expect(activityBefore).toContain(activityFileName("sara"));
    expect(actionsBefore).toContain(actionsFileName("omar"));

    // Wipe every audit file the way a bad sync or a wrong-folder copy would.
    const auditDir = await getAuditRoot(root, false);
    for (const [dir, list] of [
      [activityDir, activityBefore],
      [actionsDir, actionsBefore],
    ] as const) {
      for (const name of list) await dir.removeEntry!(name);
    }
    for (const name of await names(auditDir)) {
      if (name.endsWith(".json")) await auditDir.removeEntry!(name);
    }
    expect(await names(activityDir)).toEqual([]);

    const restore = await restoreBackupSnapshot({
      directoryHandle: root,
      months,
      backupFolderName: backup.folderName!,
      username: "admin",
    });
    expect(restore.ok).toBe(true);

    // Both per-user folders came back, file for file...
    expect(await names(await getAuditActivityDir(root, false))).toEqual(activityBefore);
    expect(await names(await getAuditActionsDir(root, false))).toEqual(actionsBefore);

    // ...with their contents intact, per user.
    const sara = await safeReadJson<AuthActivityUserLogFile>(
      await getAuditActivityDir(root, false),
      activityFileName("sara")
    );
    expect(sara.ok).toBe(true);
    if (!sara.ok) return;
    expect(sara.value.entries.map((e) => e.id)).toEqual(["auth-sara-1"]);

    const omar = await safeReadJson<WorkspaceActionUserLogFile>(
      await getAuditActionsDir(root, false),
      actionsFileName("omar")
    );
    expect(omar.ok).toBe(true);
    if (!omar.ok) return;
    expect(omar.value.entries.map((e) => e.target)).toEqual(["t-omar"]);

    // ...and so did the legacy shared files a pre-upgrade workspace carries.
    const legacyNames = await names(await getAuditRoot(root, false));
    expect(legacyNames).toContain("activity.log.json");
    expect(legacyNames).toContain("actions.log.json");
  });
});
