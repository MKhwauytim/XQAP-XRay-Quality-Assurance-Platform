// src/data/answers/answerV2Routing.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests } from "../storage/appendOnlyEventLog";
import { __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getAssigneeAnswerEventsDir, invalidateAnswerEventsLayout } from "../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer, upsertItemAnswerOnBehalf } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { fileNames, makeV1Month, writeText } from "./v2/v2TestFixtures";

const pending = vi.hoisted(() => ({ calls: [] as Array<[string, string, string]> }));
vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return {
    ...actual,
    mirrorAnswerLocally: async () => undefined,
    markAnswerPendingLocally: async (month: string, username: string, item: ItemAnswer) => {
      pending.calls.push([month, username, item.xrayImageId]);
    },
  };
});

const MONTH = "5-may-2026";

function item(id: string, answeredBy = "emp1", status: ItemAnswer["status"] = "draft"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status };
}

/** A v1 month whose first answers.events/ listing (the v1 decide-read) races an admin migration taking its lock. */
async function racingMigrationRoot(name: string): Promise<{ root: DirectoryHandleLike; realEvents: DirectoryHandleLike; isArmed: () => boolean }> {
  const real = createMemoryDirectory(name);
  await makeV1Month(real, MONTH);
  const realEvents = await getAnswerEventsDir(real, MONTH, false);
  let armed = true;
  // The first listing of answers.events/ happens in the v1 decide step (the
  // month read); an admin migration acquires its lock right then.
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike => new Proxy(dir, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (prop === "getDirectoryHandle") {
        return async (child: string, opts?: { create?: boolean }) => wrap(await target.getDirectoryHandle(child, opts));
      }
      if (prop === "values" && target.name === "answers.events" && typeof value === "function") {
        return () => {
          const iterate = async function* () {
            if (armed) {
              armed = false;
              await writeText(realEvents, ANSWER_EVENTS_FOLDERS.migrationLock, "{}");
            }
            yield* (value as () => AsyncIterable<unknown>).call(target);
          };
          return iterate();
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { root: wrap(real), realEvents, isArmed: () => armed };
}

describe("layout v2 writer routing (spec §4, §10)", () => {
  beforeEach(() => {
    __clearWorkspaceDirCacheForTests();
    invalidateAnswerEventsLayout();
    __clearAnswerEventsCacheForTests();
    __resetAppendOnlyEventLogMemosForTests();
    pending.calls = [];
  });

  it("a brand-new month is stamped v2 and a self-save lands under answers.events/emp1/", async () => {
    const root = createMemoryDirectory("new");
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).resolves.toBeTruthy();
    expect(await fileNames(events)).toEqual([]);
    expect((await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"))).length).toBe(1);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId)).toEqual(["A"]);
  });

  it("an on-behalf save lands in the ASSIGNEE's folder, not the supervisor's", async () => {
    const root = createMemoryDirectory("onbehalf");
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("B"), "sup1", "reason")).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getDirectoryHandle("sup1")).rejects.toMatchObject({ name: "NotFoundError" });
    const saved = (await loadEmployeeAnswers(root, MONTH, "emp1")).items.find((i) => i.xrayImageId === "B");
    expect(saved?.answeredOnBehalfBy).toBe("sup1");
  });

  it("on-behalf for two assignees in one session: each folder gets its own seq-0 segment, fast (Review Focus 3)", async () => {
    const root = createMemoryDirectory("two");
    const started = Date.now();
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("C1"), "sup1", "r")).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp2", item("C2", "emp2"), "sup1", "r")).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("C3"), "sup1", "r")).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    const emp1 = await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"));
    const emp2 = await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp2"));
    expect(emp1).toHaveLength(1);
    expect(emp2).toHaveLength(1);
    expect(emp1[0]).not.toMatch(/-[1-9][0-9]*\.ndjson$/);
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId).sort()).toEqual(["C1", "C3"]);
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.map((i) => i.xrayImageId)).toEqual(["C2"]);
  }, 20_000);

  it("mixed-case assignee: Emp1 self-save and emp1 on-behalf share one folder (Review Focus 5)", async () => {
    const root = createMemoryDirectory("case");
    expect((await upsertItemAnswer(root, MONTH, "Emp1", item("D1", "Emp1"))).ok).toBe(true);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("D2"), "sup1", "r")).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    const dirs = [];
    for await (const entry of (events as unknown as { values(): AsyncIterable<{ kind: string; name: string }> }).values()) if (entry.kind === "directory") dirs.push(entry.name);
    expect(dirs).toEqual(["emp1"]);
    expect((await loadEmployeeAnswers(root, MONTH, "EMP1")).items.map((i) => i.xrayImageId).sort()).toEqual(["D1", "D2"]);
  });

  it("an existing v1 month keeps appending to the flat folder, unstamped", async () => {
    const root = createMemoryDirectory("v1");
    await makeV1Month(root, MONTH);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("E"))).ok).toBe(true);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).rejects.toMatchObject({ name: "NotFoundError" });
    expect(await fileNames(events)).toHaveLength(1);
  });

  it("while a migration lock exists, a save is deferred to the pending queue and nothing is appended", async () => {
    const root = createMemoryDirectory("lock");
    await makeV1Month(root, MONTH);
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, ANSWER_EVENTS_FOLDERS.migrationLock, "{}");
    const result = await upsertItemAnswer(root, MONTH, "emp1", item("F"));
    expect(result.ok).toBe(false);
    expect(pending.calls).toEqual([[MONTH, "emp1", "F"]]);
    expect(await fileNames(events)).toEqual([]);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("G"), "sup1", "r")).ok).toBe(false);
  });

  it("usernames that sanitize to the same text (a/b vs a_b) keep separate folders and never see each other's answers (review finding 9)", async () => {
    const root = createMemoryDirectory("collide");
    expect((await upsertItemAnswer(root, MONTH, "a/b", item("SLASH", "a/b"))).ok).toBe(true);
    expect((await upsertItemAnswer(root, MONTH, "a_b", item("UNDERSCORE", "a_b"))).ok).toBe(true);
    expect((await loadEmployeeAnswers(root, MONTH, "a/b")).items.map((i) => i.xrayImageId)).toEqual(["SLASH"]);
    expect((await loadEmployeeAnswers(root, MONTH, "a_b")).items.map((i) => i.xrayImageId)).toEqual(["UNDERSCORE"]);
  });

  it("a migration that starts between the v1 decide-read and the append defers the save instead of appending flat (review finding 4)", async () => {
    const { root, realEvents, isArmed } = await racingMigrationRoot("race");
    const result = await upsertItemAnswer(root, MONTH, "emp1", item("R"));
    expect(isArmed()).toBe(false);
    expect(result.ok).toBe(false);
    expect(pending.calls).toEqual([[MONTH, "emp1", "R"]]);
    expect(await fileNames(realEvents)).toEqual([]);
  });

  it("the same race on a v1 ON-BEHALF save refuses instead of appending flat (review finding 4)", async () => {
    const { root, realEvents, isArmed } = await racingMigrationRoot("race-ob");
    const result = await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("S"), "sup1", "r");
    expect(isArmed()).toBe(false);
    expect(result.ok).toBe(false);
    expect(await fileNames(realEvents)).toEqual([]);
  }, 30_000);
});
