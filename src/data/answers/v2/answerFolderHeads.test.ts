import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { ANSWER_EVENTS_FOLDERS, __clearWorkspaceDirCacheForTests, answerAssigneeFolderName, getAnswerEventsDir, invalidateAnswerEventsLayout, isAnswerAssigneeFolderName } from "../../workspace/workspacePaths";
import { __resetAnswerFolderHeadsForTests, parseAnswerFolderHeadName, readAnswerFolderHeads, touchAnswerFolderHead } from "./answerFolderHeads";
import { makeV2Month, savedEvent, writeAssigneeSegment } from "./v2TestFixtures";

async function headNames(events: Awaited<ReturnType<typeof getAnswerEventsDir>>): Promise<string[]> {
  const heads = await events.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.heads, { create: false });
  return (await listDirectoryEntries(heads)).map((entry) => entry.name).sort();
}

describe("answer folder head markers", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __resetAnswerFolderHeadsForTests();
  });

  it("is a reserved child: never an assignee folder, never a username", () => {
    expect(isAnswerAssigneeFolderName(ANSWER_EVENTS_FOLDERS.heads)).toBe(false);
    expect(() => answerAssigneeFolderName(ANSWER_EVENTS_FOLDERS.heads)).toThrow();
  });

  it("replaces the writer's previous marker with a uniquely named new one per append", async () => {
    const root = createMemoryDirectory("heads1");
    await makeV2Month(root);
    await writeAssigneeSegment(root, "emp1", "a.ndjson", [savedEvent("a", 1)]);
    const events = await getAnswerEventsDir(root, "5-may-2026");
    await touchAnswerFolderHead(events, "emp1", "emp1");
    const first = await headNames(events);
    await touchAnswerFolderHead(events, "emp1", "emp1");
    const second = await headNames(events);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    expect(parseAnswerFolderHeadName(second[0]!)).toEqual({ folder: "emp1", writer: "emp1" });
  });

  it("keeps one marker per (folder, writer): an on-behalf writer never removes the owner's marker", async () => {
    const root = createMemoryDirectory("heads2");
    await makeV2Month(root);
    const events = await getAnswerEventsDir(root, "5-may-2026", true);
    await touchAnswerFolderHead(events, "emp1", "emp1");
    await touchAnswerFolderHead(events, "emp1", "admin");
    await touchAnswerFolderHead(events, "emp1", "admin");
    const map = await readAnswerFolderHeads(events);
    expect(map?.get("emp1")?.map((name) => parseAnswerFolderHeadName(name)?.writer).sort()).toEqual(["admin", "emp1"]);
  });

  it("sweeps stale markers a previous page load left for the same (folder, writer), and only those", async () => {
    const root = createMemoryDirectory("heads3");
    await makeV2Month(root);
    const events = await getAnswerEventsDir(root, "5-may-2026", true);
    await touchAnswerFolderHead(events, "emp1", "emp1");
    await touchAnswerFolderHead(events, "emp2", "emp2");
    __resetAnswerFolderHeadsForTests(); // a reload: this tab no longer remembers its previous name
    await touchAnswerFolderHead(events, "emp1", "emp1");
    const map = await readAnswerFolderHeads(events);
    expect(map?.get("emp1")).toHaveLength(1);
    expect(map?.get("emp2")).toHaveLength(1);
  });

  it("round-trips folder and writer names containing the separator and escape characters", async () => {
    const root = createMemoryDirectory("heads4");
    await makeV2Month(root);
    const events = await getAnswerEventsDir(root, "5-may-2026", true);
    const folder = answerAssigneeFolderName("a/b"); // hash-suffixed: contains "~"
    await touchAnswerFolderHead(events, folder, "x!y%z");
    const [name] = await headNames(events);
    expect(parseAnswerFolderHeadName(name!)).toEqual({ folder, writer: answerAssigneeFolderName("x!y%z") });
  });

  it("reports a month without _heads as null (pre-marker writes: callers fall back to a full scan)", async () => {
    const root = createMemoryDirectory("heads5");
    await makeV2Month(root);
    const events = await getAnswerEventsDir(root, "5-may-2026", true);
    expect(await readAnswerFolderHeads(events)).toBeNull();
  });
});
