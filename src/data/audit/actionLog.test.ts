import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { safeWriteJson } from "../storage/safeWrite";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import {
  appendWorkspaceAction,
  readWorkspaceActions,
  type WorkspaceActionEntry,
  type WorkspaceActionInput,
  type WorkspaceActionLogFile,
} from "./actionLog";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function makeInput(overrides: Partial<WorkspaceActionInput> = {}): WorkspaceActionInput {
  return {
    actor: "admin",
    actorRole: "admin",
    action: "month-closed",
    monthFolderName: "5-may-2026",
    target: null,
    ...overrides,
  };
}

describe("actionLog", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("appends and reads back entries with stamped id/at", async () => {
    const root = makeRoot();
    await appendWorkspaceAction(root, makeInput());
    await appendWorkspaceAction(root, makeInput({ action: "month-reopened" }));

    const entries = await readWorkspaceActions(root);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe("month-closed");
    expect(entries[1]!.action).toBe("month-reopened");
    expect(entries[0]!.id).toMatch(/^act-/);
    expect(Date.parse(entries[0]!.at)).not.toBeNaN();
  });

  it("silently skips when no workspace handle is connected", async () => {
    await expect(appendWorkspaceAction(null, makeInput())).resolves.toBeUndefined();
    expect(getRecentErrors()).toHaveLength(0);
  });

  it("caps the log at 10,000 entries, dropping the oldest", async () => {
    const root = makeRoot();

    // Pre-seed the on-disk file at exactly the cap (building 10,000 real
    // appends would be too slow), then append one more through the writer.
    const seededEntries: WorkspaceActionEntry[] = Array.from(
      { length: 10_000 },
      (_, i) => ({
        id: `act-seed-${i}`,
        at: new Date().toISOString(),
        actor: "admin",
        actorRole: "admin",
        action: "permission-changed",
        target: `t-${i}`,
      })
    );
    const seededFile: WorkspaceActionLogFile = {
      revision: 1,
      updatedAt: new Date().toISOString(),
      entries: seededEntries,
    };
    const systemDir = await getSystemRoot(root, true);
    const auditDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.audit, {
      create: true,
    });
    await safeWriteJson(auditDir, "actions.log.json", seededFile);

    await appendWorkspaceAction(root, makeInput({ target: "newest" }));

    const entries = await readWorkspaceActions(root);
    expect(entries).toHaveLength(10_000);
    // Oldest seeded entry dropped; the new entry is last.
    expect(entries[0]!.target).toBe("t-1");
    expect(entries[entries.length - 1]!.target).toBe("newest");
  });

  it("resolves without throwing when the handle fails, and logs the failure", async () => {
    const throwingDir = {
      kind: "directory",
      name: "broken",
      getFileHandle: async () => {
        throw new Error("disk gone");
      },
      getDirectoryHandle: async () => {
        throw new Error("disk gone");
      },
    } as unknown as DirectoryHandleLike;

    await expect(
      appendWorkspaceAction(throwingDir, makeInput())
    ).resolves.toBeUndefined();

    const errors = getRecentErrors().filter((e) => e.context === "audit:append");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("both concurrent appends survive", async () => {
    const root = makeRoot();
    await Promise.all([
      appendWorkspaceAction(root, makeInput({ target: "a" })),
      appendWorkspaceAction(root, makeInput({ target: "b" })),
    ]);
    const entries = await readWorkspaceActions(root);
    expect(entries.map((e) => e.target).sort()).toEqual(["a", "b"]);
  });
});
