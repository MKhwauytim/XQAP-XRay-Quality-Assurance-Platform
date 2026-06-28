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
  type AuthActivityLogFile,
} from "./authActivityLog";
import type { AuthSession } from "./authTypes";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import { createWorkspaceStructure } from "../data/storage/fileSystemAccess";
import { safeReadJson } from "../data/storage/safeWrite";
import { getSystemRoot } from "../data/workspace/workspacePaths";

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

  it("writes activity entries to the workspace audit file when a workspace is configured", async () => {
    const root = createMemoryDirectory("root");
    await createWorkspaceStructure(root, "admin");
    configureAuthActivityLogWorkspace(root);

    startAuthActivitySession(makeSession("user1", "2026-06-28T08:00:00.000Z"));
    vi.setSystemTime(new Date("2026-06-28T08:45:00.000Z"));
    endAuthActivitySession("page-closed");
    await waitForAuthActivityLogFlush();

    const systemDir = await getSystemRoot(root, false);
    const auditDir = await systemDir.getDirectoryHandle("2-Audit", { create: false });
    const result = await safeReadJson<AuthActivityLogFile>(auditDir, "auth-activity.log.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries).toHaveLength(1);
    expect(result.value.entries[0]?.username).toBe("user1");
    expect(result.value.entries[0]?.closeReason).toBe("page-closed");
    expect(result.value.entries[0]?.durationMs).toBe(45 * 60 * 1000);
  });
});
