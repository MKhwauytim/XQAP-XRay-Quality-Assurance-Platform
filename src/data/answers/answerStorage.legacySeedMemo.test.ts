/* @vitest-environment jsdom */
// A3 (answer-save perf): the legacy `{user}.answers.json` is FROZEN once an
// employee is seeded, yet every save re-read it (4 serial share round trips).
// Once this tab has read it successfully for a seeded employee, the seed
// (hash + items) is memoized per (root, month, user). The FIRST read is
// unchanged: an unreadable legacy file still throws (P0-1) and never memoizes.
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearReadLog,
  createMemoryDirectory,
  getReadLog,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";
import {
  clearAnswerEventsCache,
  __clearAnswerEventsCacheForTests,
  loadEmployeeAnswers,
  saveEmployeeAnswers,
  upsertItemAnswer,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";
const LEGACY = "emp1.answers.json";

function item(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t",
    templateVersion: 1,
    answers: [{ fieldId: "f", value: id }],
    lastSavedAt: "2026-05-02T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

const makeRoot = (): DirectoryHandleLike =>
  createMemoryDirectory("memo", { trackReads: true }) as unknown as DirectoryHandleLike;
const legacyReads = (root: DirectoryHandleLike): number =>
  getReadLog(root).filter((e) => e.endsWith(LEGACY)).length;

describe("legacy seed memo (A3)", () => {
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
  });

  it("re-reads the frozen legacy file on every save today; with the memo only until the employee is seeded", async () => {
    const root = makeRoot();
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true); // seeds
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("B"))).ok).toBe(true);
    // First save after seeding reads it once (populates the memo)...
    expect(legacyReads(root)).toBe(1);
    clearReadLog(root);
    for (const id of ["C", "D", "E"]) {
      expect((await upsertItemAnswer(root, MONTH, "emp1", item(id))).ok).toBe(true);
    }
    // ...and the following saves not at all.
    expect(legacyReads(root)).toBe(0);
  });

  it("clearAnswerEventsCache (restore) drops the memo", async () => {
    const root = makeRoot();
    for (const id of ["A", "B", "C"]) await upsertItemAnswer(root, MONTH, "emp1", item(id));
    clearReadLog(root);
    clearAnswerEventsCache();
    await upsertItemAnswer(root, MONTH, "emp1", item("D"));
    expect(legacyReads(root)).toBe(1);
  });

  it("a manual refresh broadcast drops the memo", async () => {
    const root = makeRoot();
    for (const id of ["A", "B", "C"]) await upsertItemAnswer(root, MONTH, "emp1", item(id));
    clearReadLog(root);
    broadcastDataRefresh("manual");
    await upsertItemAnswer(root, MONTH, "emp1", item("D"));
    expect(legacyReads(root)).toBe(1);
  });

  it("a periodic tick does not drop it", async () => {
    const root = makeRoot();
    for (const id of ["A", "B", "C"]) await upsertItemAnswer(root, MONTH, "emp1", item(id));
    clearReadLog(root);
    broadcastDataRefresh("periodic");
    await upsertItemAnswer(root, MONTH, "emp1", item("D"));
    expect(legacyReads(root)).toBe(0);
  });

  it("saveEmployeeAnswers (the only other legacy writer) drops the memo", async () => {
    const root = makeRoot();
    for (const id of ["A", "B", "C"]) await upsertItemAnswer(root, MONTH, "emp1", item(id));
    expect((await saveEmployeeAnswers(root, MONTH, "emp1", [item("Z")])).ok).toBe(true);
    clearReadLog(root);
    await upsertItemAnswer(root, MONTH, "emp1", item("D"));
    expect(legacyReads(root)).toBe(1);
  });

  it("P0-1: an unreadable legacy file on the first read still fails the save and is never memoized as empty", async () => {
    const root = makeRoot();
    for (const id of ["A", "B", "C"]) await upsertItemAnswer(root, MONTH, "emp1", item(id));
    clearAnswerEventsCache(); // a fresh session: nothing memoized
    setSimulatedFaults(root, [
      { operation: "getFile", name: LEGACY, errorName: "NotReadableError", times: Number.POSITIVE_INFINITY },
    ]);
    const failed = await upsertItemAnswer(root, MONTH, "emp1", item("D"));
    expect(failed.ok).toBe(false);
    setSimulatedFaults(root, []);
    clearReadLog(root);
    // The failure must not have poisoned a memo: the next save reads it for real.
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("D"))).ok).toBe(true);
    expect(legacyReads(root)).toBe(1);
  }, 60_000);

  it("does not memoize before the employee is seeded (the first-ever save still reads/creates the legacy shell)", async () => {
    const root = makeRoot();
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    expect(legacyReads(root)).toBeGreaterThanOrEqual(1);
  });

  it("a transient NotFound on the legacy file is never memoized as an absent (empty) seed", async () => {
    const root = makeRoot();
    expect((await saveEmployeeAnswers(root, MONTH, "emp1", [item("L1"), item("L2")])).ok).toBe(true);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A1"))).ok).toBe(true); // seeds with a non-empty hash
    clearAnswerEventsCache(); // a fresh session
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: LEGACY, errorName: "NotFoundError", times: 1 } as never,
    ]);
    await upsertItemAnswer(root, MONTH, "emp1", item("A2")); // may fail or succeed; must not poison the session
    setSimulatedFaults(root, []);
    for (const id of ["A3", "A4"]) expect((await upsertItemAnswer(root, MONTH, "emp1", item(id))).ok).toBe(true);
    const ids = (await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId);
    for (const id of ["A1", "A3", "A4", "L1", "L2"]) expect(ids).toContain(id);
  }, 60_000);

  it("after the tab has read the frozen file once, a save succeeds from the memo and all answers survive; views still throw on corruption", async () => {
    const root = makeRoot();
    for (let i = 0; i < 20; i += 1) expect((await upsertItemAnswer(root, MONTH, "emp1", item(`X${i}`))).ok).toBe(true);
    // corrupt the frozen file in place (torn payload, no .bak/.tmp)
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    const raw = JSON.parse(await (await (await answersDir.getFileHandle(LEGACY)).getFile()).text()) as { metadata: unknown; data: Record<string, unknown> };
    const w = await (await answersDir.getFileHandle(LEGACY)).createWritable!();
    await w.write(JSON.stringify({ metadata: raw.metadata, data: { ...raw.data, __torn: true } }));
    await w.close();
    for (const n of [`${LEGACY}.bak`, `${LEGACY}.tmp`]) await answersDir.removeEntry?.(n).catch(() => undefined);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("X-new"))).ok).toBe(true);
    // the view path reads the file for real and still reports the damage
    clearAnswerEventsCache();
    await expect(loadEmployeeAnswers(root, MONTH, "emp1")).rejects.toThrow();
  }, 60_000);
});
