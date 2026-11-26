import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { encodeEventLine } from "../storage/appendOnlyEventLog";
import { getAnswerEventsDir } from "../workspace/workspacePaths";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { answerSegmentFileName, type AnswerEvent } from "./answerEventStore";
import { loadEmployeeAnswers } from "./answerStorage";
import { __resetPendingReplayLogDedupeForTests } from "./pendingAnswerReplay";
import { __resetStrayFlatAnswersForTests, adoptStrayFlatAnswers, adoptStrayFlatAnswersAllMonths } from "./strayFlatAnswers";
import { makeV1Month, makeV2Month, savedEvent, V2_MONTH, writeText } from "./v2/v2TestFixtures";

/** What a pre-v154 copy of the app does in a v2 month: a flat segment straight under `answers.events/`. */
async function writeOldClientSegment(root: DirectoryHandleLike, events: readonly AnswerEvent[], session = "s1"): Promise<void> {
  const eventsDir = await getAnswerEventsDir(root, V2_MONTH, true);
  await writeText(eventsDir, answerSegmentFileName({ deviceId: "old-pc", sessionId: session }), events.map(encodeEventLine).join(""));
}

function submitted(id: string, minute: number, assignee = "emp1", overrides: Partial<AnswerEvent> = {}): AnswerEvent {
  const event = savedEvent(id, minute, { status: "submitted", ...overrides }, assignee);
  return { ...event, lastSavedAt: event.eventAt, submittedAt: event.eventAt, templateId: "t1", templateVersion: 1 };
}

async function itemsOf(root: DirectoryHandleLike, user: string) {
  const file = await loadEmployeeAnswers(root, V2_MONTH, user);
  return file?.items ?? [];
}

describe("adoptStrayFlatAnswers", () => {
  let root: DirectoryHandleLike;

  beforeEach(() => {
    root = createMemoryDirectory();
    __resetStrayFlatAnswersForTests();
    __resetPendingReplayLogDedupeForTests();
  });
  afterEach(() => {
    __resetStrayFlatAnswersForTests();
  });

  it("lands an old client's flat answers in a v2 month so every current client sees them", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);
    expect(await itemsOf(root, "emp1")).toEqual([]);

    const summary = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(summary.adopted).toBe(1);
    expect(summary.byUser).toEqual({ emp1: 1 });
    const items = await itemsOf(root, "emp1");
    expect(items.map((i) => [i.xrayImageId, i.status, i.answers[0]?.value])).toEqual([["X-a", "submitted", "a"]]);
  });

  it("keeps only each item's latest save and separates employees", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1), { ...submitted("a", 5), eventId: "a2", answers: [{ fieldId: "f", value: "newer" }] }, submitted("b", 2, "emp2")]);

    const summary = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(summary.byUser).toEqual({ emp1: 1, emp2: 1 });
    expect((await itemsOf(root, "emp1"))[0]?.answers[0]?.value).toBe("newer");
    expect((await itemsOf(root, "emp2")).map((i) => i.xrayImageId)).toEqual(["X-b"]);
  });

  it("never overwrites a newer answer already on the share", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);
    await adoptStrayFlatAnswers(root, V2_MONTH);
    __resetStrayFlatAnswersForTests();

    const second = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(second.adopted).toBe(0);
    expect(second.alreadyOnDisk).toBe(1);
  });

  it("does not re-read an unchanged stray file on the next pass", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);
    await adoptStrayFlatAnswers(root, V2_MONTH);

    const second = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(second).toMatchObject({ adopted: 0, alreadyOnDisk: 0, scannedFiles: 0 });
  });

  it("limits a pass to one employee when asked", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1), submitted("b", 2, "emp2")]);

    const summary = await adoptStrayFlatAnswers(root, V2_MONTH, { onlyUser: "emp2" });

    expect(summary.byUser).toEqual({ emp2: 1 });
    expect(await itemsOf(root, "emp1")).toEqual([]);
  });

  it("skips on-behalf and supervisor events instead of re-landing them as self-answers", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [
      submitted("a", 1, "emp1", { authority: "supervisor", eventBy: "sup" }),
      submitted("b", 2, "emp1", { answeredOnBehalfBy: "sup" }),
    ]);

    const summary = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(summary).toMatchObject({ adopted: 0, skippedNonSelf: 2 });
  });

  it("leaves a v1 month alone: flat segments are its normal layout", async () => {
    await makeV1Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);

    const summary = await adoptStrayFlatAnswers(root, V2_MONTH);

    expect(summary).toMatchObject({ adopted: 0, scannedFiles: 0 });
  });

  it("finds strays in every sample month without being told which", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);

    const summary = await adoptStrayFlatAnswersAllMonths(root);

    expect(summary.adopted).toBe(1);
  });

  it("re-reads an unchanged stray file when forced", async () => {
    await makeV2Month(root);
    await writeOldClientSegment(root, [submitted("a", 1)]);
    await adoptStrayFlatAnswers(root, V2_MONTH);

    const forced = await adoptStrayFlatAnswers(root, V2_MONTH, { force: true });

    expect(forced).toMatchObject({ scannedFiles: 1, alreadyOnDisk: 1 });
  });
});
