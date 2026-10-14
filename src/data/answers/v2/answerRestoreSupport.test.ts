import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { classifyBackupPath } from "../../backup/restoreScope";
import { answerEventsRestoreAction, canRestoreAnswerLayoutMarker, restoredAnswerAssignees } from "./answerRestoreSupport";
import { writeText } from "./v2TestFixtures";

const MAIN = "2-samples/5-may-2026/1-main/answers.events";

describe("answer restore support", () => {
  it("classifies v2 files under answers.events only", () => {
    expect(answerEventsRestoreAction("snapshot.json", "answers.events")).toBe("skip-derived");
    expect(answerEventsRestoreAction("_migration.lock.json", "answers.events")).toBe("skip-derived");
    expect(answerEventsRestoreAction("_layout.json", "answers.events")).toBe("restore-if-absent");
    expect(answerEventsRestoreAction("x.ndjson", "answers.events")).toBeNull();
    expect(answerEventsRestoreAction("snapshot.json", null)).toBeNull();
  });

  it("finds each (month, assignee) a restore touched -- live or archive, never flat or reserved", () => {
    expect(
      restoredAnswerAssignees([
        `${MAIN}/emp1/a.ndjson`,
        `${MAIN}/emp1/archive/b.ndjson`,
        `${MAIN}/flat.ndjson`,
        `${MAIN}/_archive-v1/c.ndjson`,
        `${MAIN}/_quarantine/q.ndjson`,
        "2-samples/6-jun-2026/1-main/answers.events/emp2/d.ndjson",
      ])
    ).toEqual([
      { month: "5-may-2026", folder: "emp1" },
      { month: "6-jun-2026", folder: "emp2" },
    ]);
  });

  it("a selective restore treats snapshot.json and the migration lock as derived, segments and the marker as answers", () => {
    expect(classifyBackupPath(`${MAIN}/emp1/snapshot.json`)).toEqual({ element: "answers", month: "5-may-2026", derived: true });
    expect(classifyBackupPath(`${MAIN}/_migration.lock.json`)).toEqual({ element: "answers", month: "5-may-2026", derived: true });
    expect(classifyBackupPath(`${MAIN}/_layout.json`)).toEqual({ element: "answers", month: "5-may-2026", derived: false });
    expect(classifyBackupPath(`${MAIN}/emp1/archive/a.ndjson`)).toEqual({ element: "answers", month: "5-may-2026", derived: false });
    expect(classifyBackupPath(`${MAIN}/_archive-v1/a.ndjson`)).toEqual({ element: "answers", month: "5-may-2026", derived: false });
  });

  it("never stamps the v2 marker over a target that still holds flat v1 segments", async () => {
    const events = createMemoryDirectory("events");
    expect(await canRestoreAnswerLayoutMarker(events)).toBe(true);
    await writeText(events, "flat.ndjson", "{}\n");
    expect(await canRestoreAnswerLayoutMarker(events)).toBe(false);
  });
});
