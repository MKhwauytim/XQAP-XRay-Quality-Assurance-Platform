/**
 * PROD-2 — the admin `activity` / `actions` sub-tabs must render the merged
 * per-user + legacy view INDISTINGUISHABLY from the pre-split single-file view.
 *
 * Both sub-tabs read through exactly two functions (`readAuthActivityLog()` and
 * `readWorkspaceActions(dir)` — `UserManagement/TabView.tsx`), so pinning those
 * two contracts pins the screens. What is asserted here is the ORDERING
 * SEMANTICS, because that is what the sections then re-sort and paginate:
 *
 *   - activity: ascending by `signedInAt`, tie-broken by `id`
 *   - actions:  ascending by `at` (newest last), tie-broken by `id`
 *   - both:     deduped by entry id, legacy entries included, and the result is
 *               byte-for-byte identical whether the same entries live in the
 *               legacy shared file or are split across per-user files.
 *
 * The last property is the real requirement: a field workspace mid-upgrade, with
 * some history in the old file and some in the new folders, must produce the
 * same list as a workspace where everything sat in one file.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAuditActionsDir, getAuditActivityDir, getAuditRoot } from "../workspace/workspacePaths";
import { actionsFileName, activityFileName } from "./auditPaths";
import {
  appendWorkspaceAction,
  readWorkspaceActions,
  type WorkspaceActionEntry,
  type WorkspaceActionLogFile,
  type WorkspaceActionUserLogFile,
} from "./actionLog";
import {
  configureAuthActivityLogWorkspace,
  readAuthActivityLog,
  resetAuthActivityLogForTests,
  type AuthActivityLogEntry,
  type AuthActivityLogFile,
  type AuthActivityUserLogFile,
} from "../../auth/authActivityLog";

function activity(id: string, username: string, signedInAt: string): AuthActivityLogEntry {
  return {
    id,
    username,
    role: "employee",
    signedInAt,
    lastSeenAt: signedInAt,
    signedOutAt: signedInAt,
    durationMs: 0,
    closeReason: "logout",
  };
}

function action(id: string, actor: string, at: string): WorkspaceActionEntry {
  return { id, at, actor, actorRole: "supervisor", action: "referral-approved", target: id };
}

// The same six entries, two ways: all in the legacy shared file, or split
// across per-user files exactly as the new writers would leave them.
const ACTIVITY_ENTRIES = [
  activity("auth-c", "omar", "2026-06-03T08:00:00.000Z"),
  activity("auth-a", "sara", "2026-06-01T08:00:00.000Z"),
  activity("auth-e", "sara", "2026-06-05T08:00:00.000Z"),
  activity("auth-b", "omar", "2026-06-02T08:00:00.000Z"),
  // Deliberate `signedInAt` tie between two users — only the id tie-break makes
  // the order deterministic across clients.
  activity("auth-d1", "sara", "2026-06-04T08:00:00.000Z"),
  activity("auth-d2", "omar", "2026-06-04T08:00:00.000Z"),
];

const ACTION_ENTRIES = [
  action("act-c", "omar", "2026-06-03T08:00:00.000Z"),
  action("act-a", "sara", "2026-06-01T08:00:00.000Z"),
  action("act-e", "sara", "2026-06-05T08:00:00.000Z"),
  action("act-b", "omar", "2026-06-02T08:00:00.000Z"),
  action("act-d1", "sara", "2026-06-04T08:00:00.000Z"),
  action("act-d2", "omar", "2026-06-04T08:00:00.000Z"),
];

async function seedLegacyOnly(root: DirectoryHandleLike): Promise<void> {
  const auditDir = await getAuditRoot(root, true);
  await safeWriteJson<AuthActivityLogFile>(auditDir, "activity.log.json", {
    revision: 1,
    updatedAt: "2026-06-05T08:00:00.000Z",
    entries: ACTIVITY_ENTRIES,
  });
  await safeWriteJson<WorkspaceActionLogFile>(auditDir, "actions.log.json", {
    revision: 1,
    updatedAt: "2026-06-05T08:00:00.000Z",
    entries: ACTION_ENTRIES,
  });
}

async function seedPerUserOnly(root: DirectoryHandleLike): Promise<void> {
  const activityDir = await getAuditActivityDir(root, true);
  const actionsDir = await getAuditActionsDir(root, true);
  for (const username of ["sara", "omar"]) {
    await safeWriteJson<AuthActivityUserLogFile>(activityDir, activityFileName(username), {
      username,
      revision: 1,
      updatedAt: "2026-06-05T08:00:00.000Z",
      entries: ACTIVITY_ENTRIES.filter((e) => e.username === username),
    });
    await safeWriteJson<WorkspaceActionUserLogFile>(actionsDir, actionsFileName(username), {
      actor: username,
      revision: 1,
      updatedAt: "2026-06-05T08:00:00.000Z",
      entries: ACTION_ENTRIES.filter((e) => e.actor === username),
    });
  }
}

/** Mid-upgrade: the two oldest entries are still only in the legacy file. */
async function seedMixed(root: DirectoryHandleLike): Promise<void> {
  const auditDir = await getAuditRoot(root, true);
  const legacyActivity = ACTIVITY_ENTRIES.filter((e) => e.id === "auth-a" || e.id === "auth-b");
  const legacyActions = ACTION_ENTRIES.filter((e) => e.id === "act-a" || e.id === "act-b");
  await safeWriteJson<AuthActivityLogFile>(auditDir, "activity.log.json", {
    revision: 1,
    updatedAt: "2026-06-02T08:00:00.000Z",
    entries: legacyActivity,
  });
  await safeWriteJson<WorkspaceActionLogFile>(auditDir, "actions.log.json", {
    revision: 1,
    updatedAt: "2026-06-02T08:00:00.000Z",
    entries: legacyActions,
  });

  const activityDir = await getAuditActivityDir(root, true);
  const actionsDir = await getAuditActionsDir(root, true);
  for (const username of ["sara", "omar"]) {
    await safeWriteJson<AuthActivityUserLogFile>(activityDir, activityFileName(username), {
      username,
      revision: 1,
      updatedAt: "2026-06-05T08:00:00.000Z",
      entries: ACTIVITY_ENTRIES.filter(
        (e) => e.username === username && !legacyActivity.includes(e)
      ),
    });
    await safeWriteJson<WorkspaceActionUserLogFile>(actionsDir, actionsFileName(username), {
      actor: username,
      revision: 1,
      updatedAt: "2026-06-05T08:00:00.000Z",
      entries: ACTION_ENTRIES.filter((e) => e.actor === username && !legacyActions.includes(e)),
    });
  }
}

const EXPECTED_ACTIVITY_IDS = ["auth-a", "auth-b", "auth-c", "auth-d1", "auth-d2", "auth-e"];
const EXPECTED_ACTION_IDS = ["act-a", "act-b", "act-c", "act-d1", "act-d2", "act-e"];

describe("merged admin audit view — same ordering however the history is laid out", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
  });
  afterEach(() => {
    resetAuthActivityLogForTests();
  });

  const layouts = [
    ["legacy shared file only (a pre-upgrade field workspace)", seedLegacyOnly],
    ["per-user files only (a workspace created after the split)", seedPerUserOnly],
    ["mixed (a field workspace part-way through the upgrade)", seedMixed],
  ] as const;

  for (const [name, seed] of layouts) {
    it(`activity: ${name}`, async () => {
      const root = createMemoryDirectory("root");
      await seed(root);
      resetAuthActivityLogForTests();
      configureAuthActivityLogWorkspace(root);

      const entries = await readAuthActivityLog();
      expect(entries.map((e) => e.id)).toEqual(EXPECTED_ACTIVITY_IDS);
    });

    it(`actions: ${name}`, async () => {
      const root = createMemoryDirectory("root");
      await seed(root);

      const entries = await readWorkspaceActions(root);
      expect(entries.map((e) => e.id)).toEqual(EXPECTED_ACTION_IDS);
    });
  }

  it("an entry present in BOTH the legacy file and a per-user file appears exactly once", async () => {
    const root = createMemoryDirectory("root");
    await seedLegacyOnly(root);
    await seedPerUserOnly(root);
    resetAuthActivityLogForTests();
    configureAuthActivityLogWorkspace(root);

    expect((await readAuthActivityLog()).map((e) => e.id)).toEqual(EXPECTED_ACTIVITY_IDS);
    expect((await readWorkspaceActions(root)).map((e) => e.id)).toEqual(EXPECTED_ACTION_IDS);
  });

  it("a legacy-only workspace keeps working when new entries are appended on top", async () => {
    const root = createMemoryDirectory("root");
    await seedLegacyOnly(root);

    await appendWorkspaceAction(root, {
      actor: "newcomer",
      actorRole: "admin",
      action: "month-closed",
      monthFolderName: "5-may-2026",
      target: "fresh",
    });

    const entries = await readWorkspaceActions(root);
    // Every legacy id survives, in order, with the new entry last (newest last).
    expect(entries.slice(0, 6).map((e) => e.id)).toEqual(EXPECTED_ACTION_IDS);
    expect(entries).toHaveLength(7);
    expect(entries[6]!.target).toBe("fresh");
  });
});
