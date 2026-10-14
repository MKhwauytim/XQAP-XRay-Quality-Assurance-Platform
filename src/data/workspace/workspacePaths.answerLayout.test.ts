// src/data/workspace/workspacePaths.answerLayout.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  ANSWER_EVENTS_FOLDERS,
  __clearWorkspaceDirCacheForTests,
  answerAssigneeFolderName,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  getAssigneeArchiveDir,
  invalidateAnswerEventsLayout,
  isAnswerAssigneeFolderName,
} from "./workspacePaths";

const MONTH = "5-may-2026";

async function touch(dir: DirectoryHandleLike, name: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{}");
  await writable.close();
}

describe("answer events layout v2 — paths and detector", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });

  it("maps a username to one lowercase, path-safe folder and refuses reserved names", () => {
    expect(answerAssigneeFolderName("  Emp1 ")).toBe("emp1");
    expect(answerAssigneeFolderName("a/b:c")).toBe("a_b_c");
    expect(() => answerAssigneeFolderName("_archive-v1")).toThrow();
    expect(() => answerAssigneeFolderName("_QUARANTINE")).toThrow();
    expect(() => answerAssigneeFolderName("   ")).toThrow();
    expect(isAnswerAssigneeFolderName("_quarantine")).toBe(false);
    expect(isAnswerAssigneeFolderName("emp1")).toBe(true);
  });

  it("resolves {assignee}/archive under 2-samples/{month}/1-main/answers.events", async () => {
    const root = createMemoryDirectory("paths");
    const archive = await getAssigneeArchiveDir(root, MONTH, "Emp1", true);
    expect(archive.name).toBe(ANSWER_EVENTS_FOLDERS.assigneeArchive);
    const main = await (await (await root.getDirectoryHandle("2-samples")).getDirectoryHandle(MONTH)).getDirectoryHandle("1-main");
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.root);
    await expect(events.getDirectoryHandle("emp1")).resolves.toBeTruthy();
  });

  it("detects absent / v1 / v1-migrating (lock) / v1-migrating (archive) / v2", async () => {
    const root = createMemoryDirectory("layout");
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("absent");
    const events = await getAnswerEventsDir(root, MONTH, true);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
    await touch(events, ANSWER_EVENTS_FOLDERS.migrationLock);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
    await events.removeEntry!(ANSWER_EVENTS_FOLDERS.migrationLock);
    await events.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: true });
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
    await touch(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
  });

  it("v2 is monotone within a tab; v1 is never served from cache", async () => {
    const root = createMemoryDirectory("mono");
    const events = await getAnswerEventsDir(root, MONTH, true);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
    await touch(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    await events.removeEntry!(ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    invalidateAnswerEventsLayout(root, MONTH);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
  });

  it("a non-NotFound probe failure propagates instead of reading as v1", async () => {
    const root = createMemoryDirectory("fault");
    await getAnswerEventsDir(root, MONTH, true);
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: ANSWER_EVENTS_FOLDERS.layoutMarker, errorName: "NotReadableError", times: 1 },
    ]);
    await expect(getAnswerEventsLayout(root, MONTH)).rejects.toMatchObject({ name: "NotReadableError" });
  });
});
