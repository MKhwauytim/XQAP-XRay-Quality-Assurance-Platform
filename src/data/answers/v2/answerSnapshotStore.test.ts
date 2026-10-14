// src/data/answers/v2/answerSnapshotStore.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { ANSWER_EVENTS_FOLDERS } from "../../workspace/workspacePaths";
import { ANSWER_SNAPSHOT_SCHEMA_VERSION, type AnswerSnapshotDraft } from "./answerSnapshot";
import { AnswerSnapshotCorruptError, readAnswerSnapshot, statAnswerSnapshot, writeAnswerSnapshotCas } from "./answerSnapshotStore";

function draft(note: string): AnswerSnapshotDraft {
  return {
    schemaVersion: ANSWER_SNAPSHOT_SCHEMA_VERSION, assignee: "emp1", monthFolderName: "5-may-2026", items: [],
    legacySeed: { contentHash: "", items: [] }, foldedOffsets: { [note]: 1 }, foldedEventCount: 0,
    compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: "emp1", seeded: true, markers: {}, foldedEventIds: [],
  };
}

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await writable.write(text);
  await writable.close();
}

describe("answer snapshot store", () => {
  it("absent → kind absent, stat null; first CAS write gets revision 1", async () => {
    const dir = createMemoryDirectory("snap");
    expect(await readAnswerSnapshot(dir)).toEqual({ kind: "absent" });
    expect(await statAnswerSnapshot(dir)).toBeNull();
    const written = await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    expect(written).toMatchObject({ ok: true, status: "written", snapshot: { revision: 1 } });
    const read = await readAnswerSnapshot(dir);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") expect(read.snapshot.foldedOffsets).toEqual({ a: 1 });
    expect(await statAnswerSnapshot(dir)).not.toBeNull();
  });

  it("a stale expected revision is a conflict and writes nothing", async () => {
    const dir = createMemoryDirectory("cas");
    await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    await writeAnswerSnapshotCas(dir, 1, draft("b"), "test");
    const lost = await writeAnswerSnapshotCas(dir, 1, draft("c"), "test");
    expect(lost).toEqual({ ok: true, status: "conflict", currentRevision: 2 });
    const read = await readAnswerSnapshot(dir);
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(read.snapshot.foldedOffsets).toEqual({ b: 1 });
  });

  it("a corrupt live file recovered from .bak is reported as recovered-from-bak (never as ok)", async () => {
    const dir = createMemoryDirectory("bak");
    await writeAnswerSnapshotCas(dir, 0, draft("a"), "test");
    await writeAnswerSnapshotCas(dir, 1, draft("b"), "test");
    await writeRaw(dir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, "{ torn");
    const read = await readAnswerSnapshot(dir);
    expect(read.kind).toBe("recovered-from-bak");
  });

  it("a structurally wrong payload throws AnswerSnapshotCorruptError", async () => {
    const dir = createMemoryDirectory("bad");
    await writeRaw(dir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, JSON.stringify({ hello: "world" }));
    await expect(readAnswerSnapshot(dir)).rejects.toBeInstanceOf(AnswerSnapshotCorruptError);
  });
});
