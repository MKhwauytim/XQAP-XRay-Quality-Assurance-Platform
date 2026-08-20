/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureAuthActivityLogWorkspace,
  endAuthActivitySession,
  readAuthActivityLog,
  recordAuthActivityHeartbeat,
  resetAuthActivityLogForTests,
  startAuthActivitySession,
  waitForAuthActivityLogFlush,
  type AuthActivityLogEntry,
  type AuthActivityLogFile,
  type AuthActivityUserLogFile,
} from "./authActivityLog";
import type { AuthSession } from "./authTypes";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import { createWorkspaceStructure } from "../data/storage/fileSystemAccess";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { listDirectoryEntries } from "../data/storage/directoryScan";
import { clearErrors } from "../data/storage/errorLogger";
import { safeReadJson, safeWriteJson } from "../data/storage/safeWrite";
import { getAuditActivityDir, getAuditRoot } from "../data/workspace/workspacePaths";
import { activityFileName } from "../data/audit/auditPaths";

function makeSession(username: string, loginAt: string): AuthSession {
  return {
    username,
    role: "employee",
    loginAt,
  };
}

describe("authActivityLog", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T08:00:00.000Z"));
  });

  afterEach(() => {
    endAuthActivitySession("logout");
    resetAuthActivityLogForTests();
    vi.useRealTimers();
  });

  it("records sign-in, heartbeat, sign-out, and duration", async () => {
    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));

    vi.setSystemTime(new Date("2026-06-28T10:30:00.000Z"));
    recordAuthActivityHeartbeat();

    vi.setSystemTime(new Date("2026-06-28T11:00:00.000Z"));
    endAuthActivitySession("logout");

    const [entry] = await readAuthActivityLog();
    expect(entry?.username).toBe("user1");
    expect(entry?.signedInAt).toBe("2026-06-28T08:00:00.000Z");
    expect(entry?.signedOutAt).toBe("2026-06-28T11:00:00.000Z");
    expect(entry?.closeReason).toBe("logout");
    expect(entry?.durationMs).toBe(3 * 60 * 60 * 1000);
  });

  it("closes the previous active session when a new sign-in starts", async () => {
    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));

    vi.setSystemTime(new Date("2026-06-28T09:00:00.000Z"));
    startAuthActivitySession(makeSession("user2", "2026-06-28T09:00:00.000Z"));

    const entries = await readAuthActivityLog();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.username).toBe("user1");
    expect(entries[0]?.closeReason).toBe("session-replaced");
    expect(entries[0]?.durationMs).toBe(60 * 60 * 1000);
    expect(entries[1]?.username).toBe("user2");
    expect(entries[1]?.signedOutAt).toBeNull();
  });

  it("writes activity entries to the signed-in user's OWN audit file, never the shared one", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));
    vi.setSystemTime(new Date("2026-06-28T08:45:00.000Z"));
    endAuthActivitySession("page-closed");
    await waitForAuthActivityLogFlush();

    const activityDir = await getAuditActivityDir(root, false);
    const result = await safeReadJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("user1")
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.username).toBe("user1");
    expect(result.value.entries).toHaveLength(1);
    expect(result.value.entries[0]?.username).toBe("user1");
    expect(result.value.entries[0]?.closeReason).toBe("page-closed");
    expect(result.value.entries[0]?.durationMs).toBe(45 * 60 * 1000);

    // The shared legacy file is never created by a write path any more.
    const auditDir = await getAuditRoot(root, false);
    const legacy = await safeReadJson<AuthActivityLogFile>(auditDir, "activity.log.json");
    expect(legacy.ok).toBe(false);
    if (legacy.ok) return;
    expect(legacy.reason).toBe("missing");
  });

  it("a flush merges a concurrent machine's write to the SAME user's file instead of clobbering it (cross-machine CAS)", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    // This machine records user1 and flushes it to disk.
    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));
    await waitForAuthActivityLogFlush();

    // The same account signed in on another machine and wrote its own earlier
    // session straight into user1's file at a much higher revision.
    const activityDir = await getAuditActivityDir(root, false);
    const externalEntry: AuthActivityLogEntry = {
      id: "auth-user1-otherpc",
      username: "user1",
      role: "employee",
      signedInAt: "2026-06-28T07:00:00.000Z",
      lastSeenAt: "2026-06-28T07:30:00.000Z",
      signedOutAt: "2026-06-28T07:30:00.000Z",
      durationMs: 30 * 60 * 1000,
      closeReason: "logout",
    };
    await safeWriteJson<AuthActivityUserLogFile>(activityDir, activityFileName("user1"), {
      username: "user1",
      revision: 10,
      updatedAt: "2026-06-28T07:30:00.000Z",
      entries: [externalEntry],
    });

    // This machine flushes again. It must re-read the other machine's write and
    // MERGE (not clobber) — both sessions survive, and the revision advances past
    // the external write, proving a fresh re-read rather than a stale overwrite.
    // The heartbeat is coalesced, so time is advanced past the flush window.
    vi.setSystemTime(new Date("2026-06-28T09:00:00.000Z"));
    recordAuthActivityHeartbeat();
    await waitForAuthActivityLogFlush();

    const result = await safeReadJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("user1")
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.entries.map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("auth-user1-otherpc");
    expect(ids.some((id) => id !== "auth-user1-otherpc" && id.startsWith("auth-user1-"))).toBe(true);
    expect(result.value.revision).toBeGreaterThan(10);
  });

  // The property the per-user split buys: a DIFFERENT user's file is not touched
  // by this machine's flush at all, so their history cannot be lost to it.
  it("never writes into another user's file", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    const activityDir = await getAuditActivityDir(root, true);
    const otherFile: AuthActivityUserLogFile = {
      username: "user2",
      revision: 7,
      updatedAt: "2026-06-28T07:30:00.000Z",
      entries: [
        {
          id: "auth-user2-otherpc",
          username: "user2",
          role: "employee",
          signedInAt: "2026-06-28T07:00:00.000Z",
          lastSeenAt: "2026-06-28T07:30:00.000Z",
          signedOutAt: "2026-06-28T07:30:00.000Z",
          durationMs: 30 * 60 * 1000,
          closeReason: "logout",
        },
      ],
    };
    await safeWriteJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("user2"),
      otherFile
    );
    const before = await safeReadJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("user2")
    );

    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    const after = await safeReadJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("user2")
    );
    expect(after.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (!after.ok || !before.ok) return;
    expect(after.value).toEqual(before.value);

    // ...but both users show up in the merged admin view.
    const merged = await readAuthActivityLog();
    expect(merged.map((e) => e.username).sort()).toEqual(["user1", "user2"]);
  });
});

describe("authActivityLog — unreadable log file", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
  });

  afterEach(() => {
    endAuthActivitySession("logout");
    resetAuthActivityLogForTests();
  });

  it("never rewrites a user's own history from an empty shell when their file cannot be read", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    // Sign-ins already recorded for this account across machines.
    startAuthActivitySession(makeSession("historic1", "2026-06-01T08:00:00.000Z"));
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    const activityDir = await getAuditActivityDir(root, false);
    const ownFile = activityFileName("historic1");
    const before = await safeReadJson<AuthActivityUserLogFile>(activityDir, ownFile);
    expect(before.ok).toBe(true);

    // A torn write / half-synced copy leaves the live file, its .bak and its
    // .tmp all unparsable — safeReadJson reports "corrupt", not "missing".
    for (const name of [ownFile, `${ownFile}.bak`, `${ownFile}.tmp`]) {
      const handle = await activityDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{ truncated");
      await writable.close();
    }

    // The same account signs in again and flushes against that unreadable file.
    resetAuthActivityLogForTests();
    configureAuthActivityLogWorkspace(root);
    startAuthActivitySession(makeSession("historic1", "2026-06-28T08:00:00.000Z"));
    await waitForAuthActivityLogFlush();

    // The flush must be skipped: an empty base read is not a neutral starting
    // point here, it is a whole-file replacement of this account's login
    // history. Leaving the damaged file for recovery beats overwriting it with
    // this one session and reporting success.
    const after = await safeReadJson<AuthActivityUserLogFile>(activityDir, ownFile);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toBe("corrupt");
  });

  // BLAST RADIUS — the property the whole refactor exists for. Under the old
  // single shared file, one damaged/contended file was every writer's problem:
  // the failing flush owned the write chain and `readAuthActivityLog` awaited
  // that same chain, so nobody could write and nobody could read.
  it("one user's damaged file blocks only that user — another user still flushes, and the whole fleet is still readable", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");

    // "damaged" arrives with an unreadable file (torn write / half-synced copy).
    const activityDir = await getAuditActivityDir(root, true);
    const damagedFile = activityFileName("damaged");
    for (const name of [damagedFile, `${damagedFile}.bak`, `${damagedFile}.tmp`]) {
      const handle = await activityDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable!();
      await writable.write("{ truncated");
      await writable.close();
    }
    // A healthy pre-existing file from a third user, to prove the merged read
    // still surfaces the fleet.
    await safeWriteJson<AuthActivityUserLogFile>(activityDir, activityFileName("bystander"), {
      username: "bystander",
      revision: 1,
      updatedAt: "2026-06-28T07:00:00.000Z",
      entries: [
        {
          id: "auth-bystander-1",
          username: "bystander",
          role: "employee",
          signedInAt: "2026-06-28T07:00:00.000Z",
          lastSeenAt: "2026-06-28T07:30:00.000Z",
          signedOutAt: "2026-06-28T07:30:00.000Z",
          durationMs: 30 * 60 * 1000,
          closeReason: "logout",
        },
      ],
    });

    configureAuthActivityLogWorkspace(root);
    // Both users end up pending in the SAME process/flush batch.
    startAuthActivitySession(makeSession("damaged", "2026-06-28T08:00:00.000Z"));
    endAuthActivitySession("logout");
    startAuthActivitySession(makeSession("healthy", "2026-06-28T08:10:00.000Z"));
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    // The damaged file is left alone for recovery, NOT overwritten...
    const damaged = await safeReadJson<AuthActivityUserLogFile>(activityDir, damagedFile);
    expect(damaged.ok).toBe(false);
    if (damaged.ok) return;
    expect(damaged.reason).toBe("corrupt");

    // ...and the healthy user's flush went through regardless.
    const healthy = await safeReadJson<AuthActivityUserLogFile>(
      activityDir,
      activityFileName("healthy")
    );
    expect(healthy.ok).toBe(true);
    if (!healthy.ok) return;
    expect(healthy.value.entries.map((e) => e.username)).toEqual(["healthy"]);

    // The merged admin view skips the unreadable file rather than failing, and
    // still shows every other user — including the damaged user's live session,
    // which is still held in memory.
    const merged = await readAuthActivityLog();
    expect([...new Set(merged.map((e) => e.username))].sort()).toEqual([
      "bystander",
      "damaged",
      "healthy",
    ]);
  });
});

// The owner directive's hard requirement: existing field workspaces keep
// working, AND their history must still appear in the merged admin view.
describe("authActivityLog — legacy shared file read-through (no migration)", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
    clearErrors();
  });

  afterEach(() => {
    endAuthActivitySession("logout");
    resetAuthActivityLogForTests();
  });

  async function seedLegacy(root: DirectoryHandleLike): Promise<void> {
    const auditDir = await getAuditRoot(root, true);
    await safeWriteJson<AuthActivityLogFile>(auditDir, "activity.log.json", {
      revision: 42,
      updatedAt: "2026-05-01T09:00:00.000Z",
      entries: [
        legacyEntry("auth-legacy-1", "oldtimer", "2026-05-01T08:00:00.000Z"),
        legacyEntry("auth-legacy-2", "oldtimer", "2026-05-02T08:00:00.000Z"),
        legacyEntry("auth-legacy-3", "someoneelse", "2026-05-03T08:00:00.000Z"),
      ],
    });
  }

  function legacyEntry(id: string, username: string, signedInAt: string): AuthActivityLogEntry {
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

  it("merges legacy entries into the admin view and leaves the legacy file byte-identical", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    await seedLegacy(root);

    const auditDir = await getAuditRoot(root, false);
    const bytesBefore = await (await (await auditDir.getFileHandle("activity.log.json")).getFile()).text();

    configureAuthActivityLogWorkspace(root);
    startAuthActivitySession(makeSession("oldtimer", "2026-06-28T08:00:00.000Z"));
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    const merged = await readAuthActivityLog();
    expect(merged.map((e) => e.id)).toEqual([
      "auth-legacy-1",
      "auth-legacy-2",
      "auth-legacy-3",
      expect.stringMatching(/^auth-oldtimer-/) as unknown as string,
    ]);

    // No migration: the legacy file is not rewritten, moved or deleted.
    const bytesAfter = await (await (await auditDir.getFileHandle("activity.log.json")).getFile()).text();
    expect(bytesAfter).toBe(bytesBefore);
  });

  it("a session that spans the upgrade is deduped by id, with the later lastSeenAt winning", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");

    // The SAME session id lives in the legacy file (short, still open) and in
    // the user's own per-user file (extended by later heartbeats).
    const auditDir = await getAuditRoot(root, true);
    await safeWriteJson<AuthActivityLogFile>(auditDir, "activity.log.json", {
      revision: 3,
      updatedAt: "2026-06-28T08:10:00.000Z",
      entries: [
        {
          id: "auth-spanning-1",
          username: "spanner",
          role: "employee",
          signedInAt: "2026-06-28T08:00:00.000Z",
          lastSeenAt: "2026-06-28T08:10:00.000Z",
          signedOutAt: null,
          durationMs: 10 * 60 * 1000,
          closeReason: null,
        },
      ],
    });
    const activityDir = await getAuditActivityDir(root, true);
    await safeWriteJson<AuthActivityUserLogFile>(activityDir, activityFileName("spanner"), {
      username: "spanner",
      revision: 1,
      updatedAt: "2026-06-28T09:30:00.000Z",
      entries: [
        {
          id: "auth-spanning-1",
          username: "spanner",
          role: "employee",
          signedInAt: "2026-06-28T08:00:00.000Z",
          lastSeenAt: "2026-06-28T09:30:00.000Z",
          signedOutAt: "2026-06-28T09:30:00.000Z",
          durationMs: 90 * 60 * 1000,
          closeReason: "logout",
        },
      ],
    });

    configureAuthActivityLogWorkspace(root);
    const merged = await readAuthActivityLog();

    expect(merged).toHaveLength(1);
    expect(merged[0]!.lastSeenAt).toBe("2026-06-28T09:30:00.000Z");
    expect(merged[0]!.durationMs).toBe(90 * 60 * 1000);
    expect(merged[0]!.closeReason).toBe("logout");
  });

  it("two usernames that sanitize alike still get separate files", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    // `safeWorkspaceFilePart` maps both of these to "a_b"; the raw-name hash in
    // `auditUserStem` is what keeps them apart. A collision here would silently
    // restore the two-writers-one-file bug this layout exists to remove.
    expect(activityFileName("a/b")).not.toBe(activityFileName("a\\b"));

    startAuthActivitySession(makeSession("a/b", "2026-06-28T08:00:00.000Z"));
    endAuthActivitySession("logout");
    startAuthActivitySession(makeSession("a\\b", "2026-06-28T08:10:00.000Z"));
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    const activityDir = await getAuditActivityDir(root, false);
    for (const username of ["a/b", "a\\b"]) {
      const file = await safeReadJson<AuthActivityUserLogFile>(
        activityDir,
        activityFileName(username)
      );
      expect(file.ok).toBe(true);
      if (!file.ok) continue;
      expect(file.value.entries.map((e) => e.username)).toEqual([username]);
    }
  });

  it("a demo session writes nothing into a real mounted workspace", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");

    // AuthGate only hands over a real handle when workspaceStatus === "ready";
    // the demo mounts an in-memory workspace, so the log stays unconfigured.
    configureAuthActivityLogWorkspace(null);
    startAuthActivitySession({ username: "viewer", role: "guest", loginAt: "2026-06-28T08:00:00.000Z" });
    endAuthActivitySession("logout");
    await waitForAuthActivityLogFlush();

    // Nothing was written under 5-system/audit/ at all — no activity folder,
    // no viewer file, no legacy file.
    const activityDir = await getAuditActivityDir(root, false).catch(() => null);
    if (activityDir) {
      const names = (await listDirectoryEntries(activityDir)).map((e) => e.name);
      expect(names).toEqual([]);
    }
    const viewerRead = activityDir
      ? await safeReadJson<AuthActivityUserLogFile>(activityDir, activityFileName("viewer"))
      : null;
    expect(viewerRead === null || viewerRead.ok === false).toBe(true);
  });
});

describe("configureAuthActivityLogWorkspace — deferred until login (Task 1)", () => {
  beforeEach(() => {
    resetAuthActivityLogForTests();
  });

  it("does not log any session when configured with no active session", async () => {
    // Note: configureAuthActivityLogWorkspace's queueFlush()/flushMemoryToWorkspace()
    // unconditionally calls getActivityAuditDir(true), so the 5-system/audit folder
    // (and an activity.log.json with an empty entries array) IS created on disk even
    // with zero pending entries — that write itself is what needs a "readwrite" grant.
    // The property this test actually characterizes is that no *session* gets logged
    // absent a real sign-in, which is what the AuthGate.tsx fix relies on: it only
    // calls configureAuthActivityLogWorkspace from an effect gated on `session` being
    // truthy, moving that readwrite trigger from an automatic page-load effect to the
    // moment a session actually exists (fresh login, demo login, or reload-continued).
    const root = createMemoryDirectory();
    configureAuthActivityLogWorkspace(root);
    await waitForAuthActivityLogFlush();

    // Prove the flush actually ran (the audit folder was created) rather than merely
    // asserting an empty result that would also be true if the flush never happened.
    const auditRoot = await root.getDirectoryHandle("5-system", { create: false });
    expect(auditRoot).toBeTruthy();

    // ...but no session was logged into it.
    const entries = await readAuthActivityLog();
    expect(entries).toEqual([]);
  });

  it("writes to disk once a real login session starts after the workspace is configured", async () => {
    const root = createMemoryDirectory();
    configureAuthActivityLogWorkspace(root);
    startAuthActivitySession({ role: "employee", username: "alice", loginAt: new Date().toISOString() });
    await waitForAuthActivityLogFlush();

    const entries = await readAuthActivityLog();
    expect(entries.map((e) => e.username)).toEqual(["alice"]);
  });
});
