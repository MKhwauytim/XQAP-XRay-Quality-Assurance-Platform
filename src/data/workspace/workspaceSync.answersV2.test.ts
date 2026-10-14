import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { __clearWorkspaceDirCacheForTests, getAnswerEventsDir, invalidateAnswerEventsLayout } from "./workspacePaths";
import { answerFoldersSignature, movedAnswerFolders } from "./workspaceSync";
import { appendToSegment, makeV2Month, savedEvent, writeAssigneeSegment, writeText } from "../answers/v2/v2TestFixtures";

describe("v2 answers sync signature", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });

  it("names exactly the assignee folders that moved", async () => {
    const root = createMemoryDirectory("sig");
    await makeV2Month(root);
    await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    const emp2 = await writeAssigneeSegment(root, "emp2", "b.ndjson", [savedEvent("b", 1, {}, "emp2")]);
    const events = await getAnswerEventsDir(root, "5-may-2026");
    const before = await answerFoldersSignature(events, "5-may-2026");
    await appendToSegment(emp2, "b.ndjson", [savedEvent("b2", 2, {}, "emp2")]);
    const after = await answerFoldersSignature(events, "5-may-2026");
    expect(movedAnswerFolders(before, after)).toEqual(new Set(["emp2"]));
    expect(movedAnswerFolders(before, before)).toEqual(new Set());
    // v1 -> v2 flip: owners unknown
    expect(movedAnswerFolders("1|a.ndjson:10", after)).toBeNull();
  });

  it("ignores reserved folders, snapshot.json and archive/ (compaction is not a remote answer change)", async () => {
    const root = createMemoryDirectory("sig2");
    await makeV2Month(root);
    const emp1 = await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    const events = await getAnswerEventsDir(root, "5-may-2026");
    const before = await answerFoldersSignature(events, "5-may-2026");
    const archiveV1 = await events.getDirectoryHandle("_archive-v1", { create: true });
    await writeText(archiveV1, "old.ndjson", "{}\n");
    await writeText(emp1, "snapshot.json", "{}");
    const after = await answerFoldersSignature(events, "5-may-2026");
    expect(movedAnswerFolders(before, after)).toEqual(new Set());
    expect(after).not.toContain("_archive-v1");
  });
});
