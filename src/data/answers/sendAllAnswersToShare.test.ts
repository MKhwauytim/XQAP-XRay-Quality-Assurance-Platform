/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "../../test-utils/freshIndexedDb";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { encodeEventLine } from "../storage/appendOnlyEventLog";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getAnswerEventsDir } from "../workspace/workspacePaths";
import { answerSegmentFileName } from "./answerEventStore";
import { mirrorAnswerLocally } from "./answerLocalMirror";
import { __resetAnswerOutboxForTests, sendAllAnswersToShare } from "./answerOutbox";
import { loadEmployeeAnswers } from "./answerStorage";
import { __resetPendingReplayLogDedupeForTests } from "./pendingAnswerReplay";
import { __resetStrayFlatAnswersForTests } from "./strayFlatAnswers";
import type { ItemAnswer } from "./answerTypes";
import { makeV2Month, savedEvent, V2_MONTH, writeText } from "./v2/v2TestFixtures";

const item = (id: string, savedAt = "2026-05-02T09:00:00.000Z"): ItemAnswer => ({
  xrayImageId: id, templateId: "t1", templateVersion: 1, answers: [{ fieldId: "f", value: id }],
  lastSavedAt: savedAt, submittedAt: savedAt, answeredBy: "emp1", status: "submitted",
});

async function shareIds(root: DirectoryHandleLike): Promise<string[]> {
  return ((await loadEmployeeAnswers(root, V2_MONTH, "emp1"))?.items ?? []).map((i) => i.xrayImageId).sort();
}

describe("sendAllAnswersToShare", () => {
  let root: DirectoryHandleLike;

  beforeEach(async () => {
    installFreshIndexedDb();
    __resetAnswerOutboxForTests();
    __resetPendingReplayLogDedupeForTests();
    __resetStrayFlatAnswersForTests();
    root = createMemoryDirectory();
    await makeV2Month(root);
  });

  it("re-sends a copy this browser marked as sent that the share does not hold", async () => {
    await mirrorAnswerLocally(V2_MONTH, "emp1", item("X-copy"));
    expect(await shareIds(root)).toEqual([]);

    const summary = await sendAllAnswersToShare(root, "emp1");

    expect(summary.replayed).toBe(1);
    expect(await shareIds(root)).toEqual(["X-copy"]);
  });

  it("recovers answers an outdated app copy wrote, in the same press", async () => {
    const stray = { ...savedEvent("old", 1, { status: "submitted" }), lastSavedAt: "2026-05-02T08:01:00.000Z", templateId: "t1", templateVersion: 1 };
    const eventsDir = await getAnswerEventsDir(root, V2_MONTH, true);
    await writeText(eventsDir, answerSegmentFileName({ deviceId: "old-pc", sessionId: "s1" }), encodeEventLine(stray));

    const summary = await sendAllAnswersToShare(root, "emp1");

    expect(summary.strayAdopted).toBe(1);
    expect(await shareIds(root)).toEqual(["X-old"]);
  });

  it("leaves an answer the share already holds alone", async () => {
    await mirrorAnswerLocally(V2_MONTH, "emp1", item("X-copy"));
    await sendAllAnswersToShare(root, "emp1");
    __resetPendingReplayLogDedupeForTests();

    const second = await sendAllAnswersToShare(root, "emp1");

    expect(second).toMatchObject({ replayed: 0, alreadyOnDisk: 1, strayAdopted: 0 });
  });
});
