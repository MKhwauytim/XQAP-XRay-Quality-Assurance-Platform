// src/data/answers/v2/assigneeEventReader.test.ts
import { loadEmployeeAnswers } from "../answerStorage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { copyFileBytesVerified } from "../../storage/safeWrite";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAssigneeAnswerEventsDir, getAssigneeArchiveDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { foldAnswerEvents, type AnswerEvent, type AnswerFoldResult } from "../answerEventStore";
import { snapshotDraftFromFold } from "./answerSnapshot";
import { writeAnswerSnapshotCas } from "./answerSnapshotStore";
import { __setAfterSnapshotReadHookForTests, readAssigneeState } from "./assigneeEventReader";
import { makeV2Month, savedEvent, seedEvent, writeAssigneeSegment, writeText, V2_MONTH } from "./v2TestFixtures";

const LEGACY = { contentHash: "", items: [] };
const loadLegacySeed = async () => LEGACY;

function items(result: AnswerFoldResult) {
  return result.file.items;
}

async function snapshotCovering(root: ReturnType<typeof createMemoryDirectory>, events: AnswerEvent[], offsets: Record<string, number>, expectedRevision = 0) {
  const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1", true);
  const fold = foldAnswerEvents(events, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH });
  const written = await writeAnswerSnapshotCas(dir, expectedRevision, snapshotDraftFromFold(fold, { assignee: "emp1", monthFolderName: V2_MONTH, legacySeed: LEGACY, foldedOffsets: offsets, compactedAt: "2026-05-03T00:00:00.000Z", compactedBy: "emp1" }), "test");
  if (!written.ok || written.status !== "written") throw new Error("snapshot write failed");
}

async function sizeOf(root: ReturnType<typeof createMemoryDirectory>, name: string): Promise<number> {
  const dir = await getAssigneeAnswerEventsDir(root, V2_MONTH, "emp1", false);
  return (await (await dir.getFileHandle(name)).getFile()).size;
}

describe("readAssigneeState (spec §5)", () => {
  beforeEach(async () => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
  });
  afterEach(() => __setAfterSnapshotReadHookForTests(null));

  it("snapshot + live past foldedOffsets == full fold, and archived segments are never listed", async () => {
    const root = createMemoryDirectory("r1");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1), savedEvent("a2", 2)];
    const b = [savedEvent("b1", 30), savedEvent("a1", 31, { answers: [{ fieldId: "f", value: "edited" }], xrayImageId: "X-a1", eventId: "a1-edit" })];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await writeAssigneeSegment(root, "emp1", "w-ans-devb-sesb.ndjson", b);
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") });
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(false);
    expect(items(read.result)).toEqual(items(foldAnswerEvents([...a, ...b], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH })));
    expect(read.deltaEvents.map((e) => e.eventId).sort()).toEqual(["a1-edit", "b1"]);
  });

  it("snapshot recovered from .bak is never served (Review Focus 1)", async () => {
    const root = createMemoryDirectory("r2");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1)];
    const assigneeDir = await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await snapshotCovering(root, [], {}, 0); // rev 1: covers nothing
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") }, 1); // rev 2
    const archive = await getAssigneeArchiveDir(root, V2_MONTH, "emp1", true);
    await copyFileBytesVerified(assigneeDir, "w-ans-deva-sesa.ndjson", archive, "w-ans-deva-sesa.ndjson");
    await assigneeDir.removeEntry!("w-ans-deva-sesa.ndjson");
    await writeText(assigneeDir, ANSWER_EVENTS_FOLDERS.assigneeSnapshot, "{ torn"); // live corrupt → .bak (rev 1) would be served
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(true);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-a1"]);
  });

  it("compaction committing mid-read is detected and retried (Review Focus 2)", async () => {
    const root = createMemoryDirectory("r3");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1)];
    const assigneeDir = await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    let fired = false;
    __setAfterSnapshotReadHookForTests(async () => {
      if (fired) return;
      fired = true; // a compaction: fold A into a new snapshot, then move A to archive/
      await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") }, 0);
      const archive = await getAssigneeArchiveDir(root, V2_MONTH, "emp1", true);
      await copyFileBytesVerified(assigneeDir, "w-ans-deva-sesa.ndjson", archive, "w-ans-deva-sesa.ndjson");
      await assigneeDir.removeEntry!("w-ans-deva-sesa.ndjson");
    });
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(fired).toBe(true);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-a1"]);
  });

  it("a delta event older than the snapshot's last folded event forces a rebuild", async () => {
    const root = createMemoryDirectory("r4");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 100)];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    await snapshotCovering(root, a, { "w-ans-deva-sesa.ndjson": await sizeOf(root, "w-ans-deva-sesa.ndjson") });
    const late = [savedEvent("b1", 5)];
    await writeAssigneeSegment(root, "emp1", "w-ans-devb-sesb.ndjson", late);
    const read = await readAssigneeState(root, V2_MONTH, "emp1", { loadLegacySeed });
    expect(read.rebuilt).toBe(true);
    expect(items(read.result)).toEqual(items(foldAnswerEvents([...a, ...late], { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH })));
  });

  it("no folder at all → the legacy items pass through, unseeded (same as v1's no-events read)", async () => {
    const root = createMemoryDirectory("r5");
    await makeV2Month(root);
    const legacyItem = { ...savedEvent("L", 0), xrayImageId: "X-L" };
    const read = await readAssigneeState(root, V2_MONTH, "emp1", {
      loadLegacySeed: async () => ({ contentHash: "h", items: [{ xrayImageId: "X-L", templateId: "t", templateVersion: 1, answers: [], lastSavedAt: legacyItem.eventAt, submittedAt: null, answeredBy: "emp1", status: "draft" }] }),
    });
    expect(read.result.seeded).toBe(false);
    expect(items(read.result).map((i) => i.xrayImageId)).toEqual(["X-L"]);
  });
});

describe("loadEmployeeAnswers on a v2 month", () => {
  it("returns the same items as a full fold of the assignee's segments", async () => {
    const root = createMemoryDirectory("r6");
    await makeV2Month(root);
    const a = [seedEvent(), savedEvent("a1", 1), savedEvent("a2", 2, { status: "submitted" })];
    await writeAssigneeSegment(root, "emp1", "w-ans-deva-sesa.ndjson", a);
    const file = await loadEmployeeAnswers(root, V2_MONTH, "emp1");
    expect(file.items).toEqual(foldAnswerEvents(a, { legacySeed: LEGACY, username: "emp1", monthFolderName: V2_MONTH }).file.items);
  });
});
