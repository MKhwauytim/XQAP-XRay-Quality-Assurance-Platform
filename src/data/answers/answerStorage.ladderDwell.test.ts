// A7 (answer-save perf, telemetry only): a slow save gives the next field report no
// hint WHICH retry ladder ate the time (the append's pre-write re-read, its write
// ladder, the post-close verify, the decision read...). Ladder sleeps are now
// accumulated per step on the action's deadline, and a save whose total ladder dwell
// reaches LADDER_DWELL_LOG_THRESHOLD_MS writes one error-log entry naming each step.
// No behaviour change: the sleeps themselves are exactly what they were.
import { beforeEach, describe, expect, it } from "vitest";

import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createDeadline, nextRetryDelayMs, recordLadderDwell, totalLadderDwellMs } from "../storage/operationDeadline";
import { __clearAnswerEventsCacheForTests, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";

function item(id: string): ItemAnswer {
  return {
    xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }],
    lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy: "emp1", status: "draft",
  };
}

describe("recordLadderDwell (A7)", () => {
  it("accumulates per step, ignores non-positive sleeps and tolerates no deadline", () => {
    const deadline = createDeadline(10_000, "t");
    recordLadderDwell(deadline, "a", 100);
    recordLadderDwell(deadline, "a", 50);
    recordLadderDwell(deadline, "b", 30);
    recordLadderDwell(deadline, "b", 0);
    recordLadderDwell(undefined, "a", 5);
    expect(deadline.dwellMs).toEqual({ a: 150, b: 30 });
    expect(totalLadderDwellMs(deadline)).toBe(180);
    expect(totalLadderDwellMs(undefined)).toBe(0);
  });

  it("is telemetry only: nextRetryDelayMs decisions are unchanged and record nothing", () => {
    const deadline = createDeadline(10_000, "t");
    expect(nextRetryDelayMs(100, deadline)).toBe(100);
    expect(deadline.dwellMs).toEqual({});
    expect(nextRetryDelayMs(100, createDeadline(-1, "spent"))).toBeNull();
  });
});

describe("a slow answer save logs which ladder it waited on (A7)", () => {
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    clearErrors();
  });

  it("logs one entry per slow save, with the per-step dwell, and stays silent for a healthy one", async () => {
    const root = createMemoryDirectory("dwell") as unknown as DirectoryHandleLike;
    for (const id of ["A", "B", "C"]) expect((await upsertItemAnswer(root, MONTH, "emp1", item(id))).ok).toBe(true);
    expect(getRecentErrors().filter((e) => e.context.includes("ladder-dwell"))).toHaveLength(0);

    // The append's pre-write re-read of the open segment (which this session wrote) rides the
    // patient ladder: 20+60+150+400+800 ms before the 6th read succeeds.
    setSimulatedFaults(root, [
      { operation: "getFile", nameSuffix: ".ndjson", errorName: "NotReadableError", times: 5 },
    ]);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("D"))).ok).toBe(true);
    const entries = getRecentErrors().filter((e) => e.context.includes("ladder-dwell"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.context).toBe("answerStorage:answer-save:ladder-dwell");
    expect(entries[0]!.message).toContain("outcome=ok");
    expect(entries[0]!.message).toMatch(/append\.reread=1430/);
    expect(entries[0]!.message).toMatch(/total=1430/);
    expect(entries[0]!.message).toMatch(/elapsed=\d+/);
  }, 30_000);
});
