// src/data/answers/migration/flatToPerAssignee.invalidState.test.ts
//
// v154.0 field report, round 6: migrating `1-january-2026` on the owner's
// mapped share failed three times in a row with Chrome's stale-snapshot
// `InvalidStateError` ("...state had changed since it was read from disk").
// January also holds SEEDLESS chains (events, no migration-seed marker, empty
// legacy snapshot) that the v1 reader folds from an empty baseline.
//
// The migration appends each assignee's events into `{assignee}/archive/` and
// then immediately re-reads that folder for the strict snapshot rebuild. On the
// share, the first `File` handed out right after that commit can carry a stale
// (size, mtime) snapshot, so touching its bytes throws `InvalidStateError`.
// `readFile` + `rearmAfterClose` models exactly that: `getFile()` succeeds, and
// the read of the bytes fails once after every landed write of that name.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import { __resetAppendOnlyEventLogMemosForTests } from "../../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, getAnswerEventsDir, getSampleMainDir, invalidateAnswerEventsLayout } from "../../workspace/workspacePaths";
import { appendAnswerEventSegment, ANSWER_EVENT_SEGMENT_SUFFIX, type AnswerEvent } from "../answerEventStore";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers } from "../answerStorage";
import { fileNames } from "../v2/v2TestFixtures";
import { migrateMonthToPerAssignee } from "./flatToPerAssignee";

const MONTH = "1-january-2026";

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

function saved(id: string, user: string, minute: number): AnswerEvent {
  return {
    eventId: id,
    eventType: "item-saved",
    eventAt: new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString(),
    eventBy: user,
    authority: "self",
    xrayImageId: `X-${id}`,
    answers: [{ fieldId: "f", value: id }],
    status: "draft",
    answeredBy: user,
  };
}

/** A January-shaped month: two employees, both with SEEDLESS chains and no legacy file. */
async function januaryMonth(name: string) {
  const root = createMemoryDirectory(name);
  const main = await getSampleMainDir(root, MONTH, true);
  await appendAnswerEventSegment(main, [saved("a1", "hihaloraini", 0), saved("a2", "hihaloraini", 1)], { deviceId: "dev1", sessionId: "s1" });
  await appendAnswerEventSegment(main, [saved("b1", "emp2", 2)], { deviceId: "dev2", sessionId: "s2" });
  resetCaches();
  return { root, events: await getAnswerEventsDir(root, MONTH, false) };
}

describe("migration under Chrome's stale-snapshot InvalidStateError (round 6)", () => {
  beforeEach(resetCaches);

  it("a seedless January month migrates and folds exactly like the v1 reader (no AnswerFoldError)", async () => {
    const { root, events } = await januaryMonth("jan-seedless");
    const before = (await loadEmployeeAnswers(root, MONTH, "hihaloraini")).items.map((i) => i.xrayImageId).sort();
    expect(before).toEqual(["X-a1", "X-a2"]);
    resetCaches();
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    if (result.status !== "migrated") throw new Error(result.status);
    expect(result.unfolded).toEqual([]);
    expect(await fileNames(events)).toEqual([]);
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "hihaloraini")).items.map((i) => i.xrayImageId).sort()).toEqual(before);
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.map((i) => i.xrayImageId)).toEqual(["X-b1"]);
  }, 60_000);

  it("a stale File snapshot right after each archive append is re-opened and retried, not surfaced as InvalidStateError", async () => {
    const { root, events } = await januaryMonth("jan-invalid-state");
    setSimulatedFaults(root, [{
      operation: "readFile",
      nameSuffix: ANSWER_EVENT_SEGMENT_SUFFIX,
      errorName: "InvalidStateError",
      errorMessage: "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.",
      rearmAfterClose: true,
      times: 1,
    }]);
    const asked: string[][] = [];
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", onUnreadable: async (names) => { asked.push([...names]); return "postpone"; } });
    expect(asked).toEqual([]);
    if (result.status !== "migrated") throw new Error(result.status);
    expect(result.unfolded).toEqual([]);
    expect(await fileNames(events)).toEqual([]);
    setSimulatedFaults(root, []);
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "hihaloraini")).items.map((i) => i.xrayImageId).sort()).toEqual(["X-a1", "X-a2"]);
  }, 60_000);
});
