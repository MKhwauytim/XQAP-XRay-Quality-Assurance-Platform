/**
 * PROD-2 — per-actor action logs (owner directive, 2026-08-19).
 *
 * The properties pinned here are the ones the split exists for: one file per
 * writer, the legacy shared files still read and never rewritten, and the
 * suffix arithmetic that keeps a per-year archive out of the live-log listing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { listDirectoryEntries } from "../storage/directoryScan";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAuditActionsDir, getAuditRoot } from "../workspace/workspacePaths";
import {
  ACTIONS_FILE_SUFFIX,
  actionsArchiveFileName,
  actionsFileName,
  auditUserStem,
} from "./auditPaths";
import {
  __resetMaxActionEntriesForTests,
  __setMaxActionEntriesForTests,
  appendWorkspaceAction,
  hashActionArchive,
  readWorkspaceActionArchive,
  readWorkspaceActions,
  type WorkspaceActionArchiveFile,
  type WorkspaceActionEntry,
  type WorkspaceActionInput,
  type WorkspaceActionLogFile,
  type WorkspaceActionUserLogFile,
} from "./actionLog";

afterEach(() => {
  __resetMaxActionEntriesForTests();
});

function input(actor: string, target: string): WorkspaceActionInput {
  return {
    actor,
    actorRole: "supervisor",
    action: "referral-approved",
    monthFolderName: "5-may-2026",
    target,
  };
}

function legacyEntry(id: string, actor: string, at: string): WorkspaceActionEntry {
  return { id, at, actor, actorRole: "admin", action: "month-closed", target: id };
}

async function seedLegacyLog(root: DirectoryHandleLike): Promise<void> {
  const auditDir = await getAuditRoot(root, true);
  const file: WorkspaceActionLogFile = {
    revision: 9,
    updatedAt: "2026-05-01T09:00:00.000Z",
    entries: [
      legacyEntry("act-legacy-1", "oldadmin", "2026-05-01T08:00:00.000Z"),
      legacyEntry("act-legacy-2", "oldadmin", "2026-05-02T08:00:00.000Z"),
    ],
  };
  await safeWriteJson(auditDir, "actions.log.json", file);
}

async function legacyBytes(root: DirectoryHandleLike, fileName: string): Promise<string> {
  const auditDir = await getAuditRoot(root, false);
  return (await (await auditDir.getFileHandle(fileName)).getFile()).text();
}

describe("actionLog — one file per actor", () => {
  it("writes each actor's entries to that actor's own file and nowhere else", async () => {
    const root = createMemoryDirectory("root");

    await appendWorkspaceAction(root, input("sara", "a1"));
    await appendWorkspaceAction(root, input("omar", "b1"));
    await appendWorkspaceAction(root, input("sara", "a2"));

    const actionsDir = await getAuditActionsDir(root, false);
    const names = (await listDirectoryEntries(actionsDir))
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(ACTIONS_FILE_SUFFIX));
    expect(names.sort()).toEqual([actionsFileName("omar"), actionsFileName("sara")].sort());

    const sara = await safeReadJson<WorkspaceActionUserLogFile>(
      actionsDir,
      actionsFileName("sara")
    );
    expect(sara.ok).toBe(true);
    if (!sara.ok) return;
    expect(sara.value.actor).toBe("sara");
    expect(sara.value.entries.map((e) => e.target)).toEqual(["a1", "a2"]);
    expect(sara.value.entries.every((e) => e.actor === "sara")).toBe(true);
  });

  it("the merged read returns every actor's entries, oldest first", async () => {
    const root = createMemoryDirectory("root");

    await appendWorkspaceAction(root, input("sara", "a1"));
    await appendWorkspaceAction(root, input("omar", "b1"));
    await appendWorkspaceAction(root, input("sara", "a2"));

    const entries = await readWorkspaceActions(root);
    expect(entries.map((e) => e.target)).toEqual(["a1", "b1", "a2"]);
  });

  it("two actor names that sanitize alike still get separate files", async () => {
    const root = createMemoryDirectory("root");
    // `safeWorkspaceFilePart` maps both to "a_b"; the raw-name hash keeps them
    // apart. A collision here silently restores the two-writers-one-file bug.
    expect(auditUserStem("a/b")).not.toBe(auditUserStem("a\\b"));

    await appendWorkspaceAction(root, input("a/b", "slash"));
    await appendWorkspaceAction(root, input("a\\b", "backslash"));

    const actionsDir = await getAuditActionsDir(root, false);
    for (const [actor, target] of [["a/b", "slash"], ["a\\b", "backslash"]] as const) {
      const file = await safeReadJson<WorkspaceActionUserLogFile>(
        actionsDir,
        actionsFileName(actor)
      );
      expect(file.ok).toBe(true);
      if (!file.ok) continue;
      expect(file.value.entries.map((e) => e.target)).toEqual([target]);
    }
  });
});

describe("actionLog — legacy shared file read-through (no migration)", () => {
  it("merges the legacy actions.log.json into the aggregate read", async () => {
    const root = createMemoryDirectory("root");
    await seedLegacyLog(root);

    await appendWorkspaceAction(root, input("sara", "new-1"));

    const entries = await readWorkspaceActions(root);
    expect(entries.map((e) => e.id.startsWith("act-legacy-") ? e.id : e.target)).toEqual([
      "act-legacy-1",
      "act-legacy-2",
      "new-1",
    ]);
  });

  it("never rewrites the legacy file — its bytes are identical before and after a write cycle", async () => {
    const root = createMemoryDirectory("root");
    await seedLegacyLog(root);
    const before = await legacyBytes(root, "actions.log.json");

    for (let i = 0; i < 5; i += 1) {
      await appendWorkspaceAction(root, input("sara", `n${i}`));
      await appendWorkspaceAction(root, input("omar", `m${i}`));
    }

    const after = await legacyBytes(root, "actions.log.json");
    expect(after).toBe(before);
  });

  it("a legacy per-year archive is still merged by readWorkspaceActionArchive", async () => {
    const root = createMemoryDirectory("root");
    const auditDir = await getAuditRoot(root, true);
    const legacyArchive: WorkspaceActionArchiveFile = {
      year: 2026,
      revision: 1,
      updatedAt: "2026-05-01T09:00:00.000Z",
      entries: [legacyEntry("act-archived-legacy", "oldadmin", "2026-01-05T08:00:00.000Z")],
    };
    await safeWriteJson(auditDir, "actions.archive.2026.json", legacyArchive);

    // ...alongside a new per-actor archive for the same year.
    const actionsDir = await getAuditActionsDir(root, true);
    await safeWriteJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("sara", 2026),
      {
        year: 2026,
        revision: 1,
        updatedAt: "2026-06-01T09:00:00.000Z",
        entries: [legacyEntry("act-archived-sara", "sara", "2026-02-05T08:00:00.000Z")],
      }
    );

    const archived = await readWorkspaceActionArchive(root, 2026);
    expect(archived.map((e) => e.id)).toEqual(["act-archived-legacy", "act-archived-sara"]);
  });
});

describe("actionLog — per-actor archival", () => {
  it("overflow lands in THAT actor's per-year archive and the live listing never picks it up", async () => {
    __setMaxActionEntriesForTests(2);
    const root = createMemoryDirectory("root");

    for (let i = 1; i <= 4; i += 1) await appendWorkspaceAction(root, input("sara", `s${i}`));
    for (let i = 1; i <= 3; i += 1) await appendWorkspaceAction(root, input("omar", `o${i}`));

    const actionsDir = await getAuditActionsDir(root, false);
    const year = new Date().getFullYear();

    // The suffix arithmetic: `{stem}.actions.{year}.json` does NOT end with
    // `.actions.json`, so the live-log listing cannot fold an archive back in.
    // A `.includes()` here would silently merge every archived entry.
    expect(actionsArchiveFileName("sara", year).endsWith(ACTIONS_FILE_SUFFIX)).toBe(false);
    const liveNames = (await listDirectoryEntries(actionsDir))
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(ACTIONS_FILE_SUFFIX));
    expect(liveNames.sort()).toEqual([actionsFileName("omar"), actionsFileName("sara")].sort());

    // Live logs are trimmed to the per-actor cap; the evicted entries are in
    // each actor's OWN archive, not a shared one.
    const live = await readWorkspaceActions(root);
    expect(live.map((e) => e.target)).toEqual(["s3", "s4", "o2", "o3"]);

    const saraArchive = await safeReadJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("sara", year)
    );
    expect(saraArchive.ok).toBe(true);
    if (!saraArchive.ok) return;
    expect(saraArchive.value.entries.map((e) => e.target)).toEqual(["s1", "s2"]);

    const omarArchive = await safeReadJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("omar", year)
    );
    expect(omarArchive.ok).toBe(true);
    if (!omarArchive.ok) return;
    expect(omarArchive.value.entries.map((e) => e.target)).toEqual(["o1"]);
  });

  it("the B5 previousArchiveHash chain links an actor's year to the SAME actor's previous year", async () => {
    __setMaxActionEntriesForTests(1);
    const root = createMemoryDirectory("root");
    const actionsDir = await getAuditActionsDir(root, true);
    const year = new Date().getFullYear();

    // sara already has a year-(N-1) archive; omar does not.
    const priorSara: WorkspaceActionArchiveFile = {
      year: year - 1,
      revision: 4,
      updatedAt: "2025-12-31T23:00:00.000Z",
      entries: [legacyEntry("act-prior-sara", "sara", `${year - 1}-06-01T08:00:00.000Z`)],
    };
    await safeWriteJson(actionsDir, actionsArchiveFileName("sara", year - 1), priorSara);

    await appendWorkspaceAction(root, input("sara", "s1"));
    await appendWorkspaceAction(root, input("sara", "s2"));
    await appendWorkspaceAction(root, input("omar", "o1"));
    await appendWorkspaceAction(root, input("omar", "o2"));

    const saraCurrent = await safeReadJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("sara", year)
    );
    expect(saraCurrent.ok).toBe(true);
    if (!saraCurrent.ok) return;
    // The archive payload is unchanged in shape, so the hash is computed the
    // same way a legacy archive's would be.
    const written = await safeReadJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("sara", year - 1)
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(saraCurrent.value.previousArchiveHash).toBe(hashActionArchive(written.value));

    // omar has no prior year of his own, so no link is established — the chain
    // is per-actor, not workspace-wide.
    const omarCurrent = await safeReadJson<WorkspaceActionArchiveFile>(
      actionsDir,
      actionsArchiveFileName("omar", year)
    );
    expect(omarCurrent.ok).toBe(true);
    if (!omarCurrent.ok) return;
    expect(omarCurrent.value.previousArchiveHash).toBeUndefined();
  });
});
