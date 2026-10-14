// Restore of a layout-v2 (per-assignee) answers month: segments merge into
// wherever the target now keeps them (live, `archive/`, `_archive-v1/`), a
// derived snapshot.json is never copied back but rebuilt, and nothing the
// target holds is ever deleted.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  __clearWorkspaceDirCacheForTests,
  getAnswerArchiveV1Dir,
  getAnswerEventsDir,
  getAssigneeArchiveDir,
  invalidateAnswerEventsLayout,
} from "../workspace/workspacePaths";
import { encodeEventLine } from "../storage/appendOnlyEventLog";
import { readAnswerSnapshot } from "../answers/v2/answerSnapshotStore";
import { fileNames, makeV2Month, readText, savedEvent, V2_MONTH, writeAssigneeSegment, writeText } from "../answers/v2/v2TestFixtures";
import { createBackup, restoreBackupSnapshot } from "./backupStorage";

const month = { folderName: V2_MONTH, month: 5, year: 2026 };

async function restore(root: DirectoryHandleLike, folder: string) {
  return restoreBackupSnapshot({ directoryHandle: root, months: [month], backupFolderName: folder, username: "admin" });
}

async function move(from: DirectoryHandleLike, to: DirectoryHandleLike, name: string): Promise<void> {
  await writeText(to, name, await readText(from, name));
  await from.removeEntry!(name);
}

describe("restore of a v2 answers month", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });

  it("restores a lost assignee segment and rebuilds that assignee's snapshot", async () => {
    const root = createMemoryDirectory("root");
    await makeV2Month(root);
    const emp1 = await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    await writeText(emp1, "snapshot.json", "not a snapshot -- would be corrupt if copied back");
    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await emp1.removeEntry!("a.ndjson");
    await emp1.removeEntry!("snapshot.json");
    const restored = await restore(root, backup.folderName);
    expect(restored.ok).toBe(true);
    expect(await fileNames(emp1)).toEqual(["a.ndjson"]);
    const snap = await readAnswerSnapshot(emp1);
    expect(snap.kind).not.toBe("absent");
  });

  it("merges a segment compaction moved into archive/ there, never re-creating a live copy", async () => {
    const root = createMemoryDirectory("root");
    await makeV2Month(root);
    const emp1 = await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const archive = await getAssigneeArchiveDir(root, V2_MONTH, "emp1", true);
    await move(emp1, archive, "a.ndjson");
    const archivedBefore = await readText(archive, "a.ndjson");
    const restored = await restore(root, backup.folderName);
    expect(restored.ok).toBe(true);
    expect(await fileNames(emp1)).toEqual([]);
    expect(await readText(archive, "a.ndjson")).toBe(archivedBefore);
  });

  it("merges a flat v1 segment the migration archived into _archive-v1/, never back into the flat root", async () => {
    const root = createMemoryDirectory("root");
    const events = await getAnswerEventsDir(root, V2_MONTH, true);
    await writeText(events, "flat.ndjson", encodeEventLine(savedEvent("f", 1)));
    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const archiveV1 = await getAnswerArchiveV1Dir(root, V2_MONTH, true);
    await move(events, archiveV1, "flat.ndjson");
    await makeV2Month(root);
    invalidateAnswerEventsLayout();
    const restored = await restore(root, backup.folderName);
    expect(restored.ok).toBe(true);
    expect(await fileNames(events)).toEqual([]);
    expect(await fileNames(archiveV1)).toEqual(["flat.ndjson"]);
  });
});
