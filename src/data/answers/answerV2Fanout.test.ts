// Layout v2 (Plan 2 Task 10): every month-wide reader — the supervisor fan-out
// (`loadAllEmployeeFiles`, which reports, exports, the integrity scan and the
// population-overwrite guard all consume), the per-item history — must see a v2
// month's per-assignee answers, and the in-tab cache must keep warm reads cheap.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, clearReadLog, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, getAnswerEventsDir, getSampleEmployeeDir, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import {
  __clearAnswerEventsCacheForTests,
  AnswersUnreadableError,
  loadAllEmployeeFiles,
  loadEmployeeAnswers,
  upsertItemAnswer,
  upsertItemAnswerOnBehalf,
} from "./answerStorage";
import { loadAnswerActionHistory } from "../history/actionHistoryReaders";
import type { ItemAnswer } from "./answerTypes";
import { makeV2Month, savedEvent, seedEvent, writeAssigneeSegment, writeText } from "./v2/v2TestFixtures";

const MONTH = "5-may-2026";
function item(id: string, answeredBy = "emp1"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status: "draft" };
}
function reset(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

type Iterable = { entries?: () => unknown; values?: () => unknown; keys?: () => unknown };
function iterators(dir: DirectoryHandleLike): Iterable {
  const d = dir as unknown as Iterable;
  return { entries: d.entries?.bind(dir), values: d.values?.bind(dir), keys: d.keys?.bind(dir) };
}

/** Same proxy shape as answersScanUnreadable.test.ts: one child name raises NotReadableError. */
function withUnreadableDir(root: DirectoryHandleLike, unreadableName: string): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    ({
      ...dir,
      kind: "directory",
      name: dir.name,
      getFileHandle: (...args: Parameters<DirectoryHandleLike["getFileHandle"]>) => dir.getFileHandle(...args),
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        if (name === unreadableName) {
          const error = new Error(`Simulated NotReadableError for "${name}".`);
          error.name = "NotReadableError";
          throw error;
        }
        return wrap(await dir.getDirectoryHandle(name, options));
      },
      ...iterators(dir),
    }) as DirectoryHandleLike;
  return wrap(root);
}

describe("v2 fan-out readers", () => {
  beforeEach(reset);

  it("loadAllEmployeeFiles returns exactly what each per-employee read returns", async () => {
    const root = createMemoryDirectory("fan");
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp2", item("B", "emp2"));
    await upsertItemAnswerOnBehalf(root, MONTH, "emp3", item("C", "emp3"), "sup1", "r");
    reset();
    const all = await loadAllEmployeeFiles(root, MONTH);
    expect(all.map((f) => f.username)).toEqual(["emp1", "emp2", "emp3"]);
    expect(all.map((f) => f.items.map((i) => i.xrayImageId))).toEqual([["A"], ["B"], ["C"]]);
    for (const file of all) {
      reset();
      expect(file.items).toEqual((await loadEmployeeAnswers(root, MONTH, file.username)).items);
    }
  });

  it("strict mode still throws on an unreadable assignee folder; lenient skips only that employee", async () => {
    const seeded = createMemoryDirectory("strict");
    await upsertItemAnswer(seeded, MONTH, "emp1", item("A"));
    await upsertItemAnswer(seeded, MONTH, "emp2", item("B", "emp2"));
    reset();
    const root = withUnreadableDir(seeded, "emp2");
    await expect(loadAllEmployeeFiles(root, MONTH, { strict: true })).rejects.toBeInstanceOf(AnswersUnreadableError);
    reset();
    expect((await loadAllEmployeeFiles(root, MONTH)).map((f) => f.username)).toEqual(["emp1"]);
  });

  it("an assignee folder with no 2-employees file is still reported, under the username its events name", async () => {
    const root = createMemoryDirectory("orphan");
    await makeV2Month(root, MONTH);
    // `a/b` sanitizes, so its folder carries a hash suffix — not invertible from the name.
    await writeAssigneeSegment(root, "a/b", "ans-dev1-x.ndjson", [seedEvent("a/b"), savedEvent("e1", 1, {}, "a/b")], MONTH);
    await writeAssigneeSegment(root, "plain", "ans-dev1-x.ndjson", [seedEvent("plain"), savedEvent("e2", 2, {}, "plain")], MONTH);
    reset();
    const all = await loadAllEmployeeFiles(root, MONTH);
    expect(all.map((f) => [f.username, f.items.map((i) => i.xrayImageId)])).toEqual([
      ["a/b", ["X-e1"]],
      ["plain", ["X-e2"]],
    ]);
  });

  it("a sanitized 2-employees stem (a_b, from a/b) and the real a/b~hash folder are ONE employee (v154.0 review finding 5)", async () => {
    const root = createMemoryDirectory("stem-dedupe");
    await makeV2Month(root, MONTH);
    expect((await upsertItemAnswer(root, MONTH, "a/b", item("AB", "a/b"))).ok).toBe(true);
    const employees = await getSampleEmployeeDir(root, MONTH, true);
    await writeText(employees, "a_b.answers.json", JSON.stringify({ username: "a/b", monthFolderName: MONTH, revision: 0, items: [] }));
    reset();
    const all = await loadAllEmployeeFiles(root, MONTH);
    expect(all.map((f) => [f.username, f.items.map((i) => i.xrayImageId)])).toEqual([["a/b", ["AB"]]]);
  });

  it("a folder whose owner cannot be determined is skipped leniently and refused strictly", async () => {
    const root = createMemoryDirectory("anon");
    await makeV2Month(root, MONTH);
    const events = await getAnswerEventsDir(root, MONTH, false);
    const folder = await events.getDirectoryHandle("x~zz", { create: true });
    await writeText(folder, "ans-dev1-x.ndjson", "");
    reset();
    expect(await loadAllEmployeeFiles(root, MONTH)).toEqual([]);
    reset();
    await expect(loadAllEmployeeFiles(root, MONTH, { strict: true })).rejects.toBeInstanceOf(AnswersUnreadableError);
  });

  it("an employee's load never opens another assignee's folder", async () => {
    const root = createMemoryDirectory("scope", { trackReads: true });
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp2", item("B", "emp2"));
    reset();
    clearReadLog(root);
    await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(getReadLog(root).filter((path) => path.includes("answers.events/emp2/"))).toEqual([]);
  });

  it("a warm second load re-reads no segment the cache already consumed", async () => {
    const root = createMemoryDirectory("warm", { trackReads: true });
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    reset();
    await loadEmployeeAnswers(root, MONTH, "emp1");
    clearReadLog(root);
    const again = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(again.items.map((i) => i.xrayImageId)).toEqual(["A"]);
    expect(getReadLog(root).filter((path) => path.endsWith("snapshot.json"))).toEqual([]);
  });

  it("history reads the assignee's own events on a v2 month", async () => {
    const root = createMemoryDirectory("hist");
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await upsertItemAnswer(root, MONTH, "emp1", { ...item("A"), answers: [{ fieldId: "f", value: "v2" }] });
    reset();
    const history = await loadAnswerActionHistory(root, MONTH, "emp1", "A");
    expect(history).toHaveLength(2);
  });
});

describe("v2 blind append (review finding 7)", () => {
  beforeEach(reset);

  it("a warm plain self-save skips the assignee read and still lands", async () => {
    const root = createMemoryDirectory("blind-v2", { trackReads: true });
    await upsertItemAnswer(root, MONTH, "emp1", item("A")); // seeds + stamps v2
    await loadEmployeeAnswers(root, MONTH, "emp1"); // warms the per-assignee cache
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("B"))).ok).toBe(true);
    // No assignee read: the frozen legacy seed once, then only the append's own
    // probe-ahead + pre-write re-read of its open segment (same bound as v1's A5 test).
    expect(getReadLog(root).filter((p) => p.endsWith(".ndjson")).length).toBeLessThanOrEqual(2);
    expect(getReadLog(root).length).toBeLessThanOrEqual(3);
    reset();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId).sort()).toEqual(["A", "B"]);
  });

  it("this tab's own append is visible to the next warm load without a cache drop", async () => {
    const root = createMemoryDirectory("reflect-v2");
    await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    await loadEmployeeAnswers(root, MONTH, "emp1");
    await upsertItemAnswer(root, MONTH, "emp1", item("B"));
    await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("C"), "sup1", "r");
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId).sort()).toEqual(["A", "B", "C"]);
  });

  it("an unseeded assignee never takes the blind path (first save writes the seed)", async () => {
    const root = createMemoryDirectory("unseeded-v2");
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    reset();
    const loaded = await loadEmployeeAnswers(root, MONTH, "emp1");
    expect(loaded.items.map((i) => i.xrayImageId)).toEqual(["A"]);
  });
});
