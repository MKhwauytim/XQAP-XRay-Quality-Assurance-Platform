// src/data/answers/migration/flatToPerAssignee.retry.test.ts
//
// v154.0 field report: one month's migration failed on every retry. Each case
// below is a candidate for a DETERMINISTIC failure (the same month failing the
// same way forever). Every one must converge: a retry ends in `migrated` or
// `postponed`, never the same throw again, and no file is ever deleted.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { wrap } from "../../storage/jsonEnvelope";
import { safeWriteJson } from "../../storage/safeWrite";
import {
  __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerArchiveV1Dir, getAnswerEventsDir,
  getAssigneeArchiveDir, getSampleEmployeeDir, invalidateAnswerEventsLayout,
} from "../../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "../answerStorage";
import type { ItemAnswer } from "../answerTypes";
import { fileNames, makeV1Month, readText, savedEvent, writeText } from "../v2/v2TestFixtures";
import { migrateMonthToPerAssignee } from "./flatToPerAssignee";

const MONTH = "5-may-2026";

function item(id: string, answeredBy = "emp1"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status: "draft" };
}

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

async function twoEmployeeMonth(name: string): Promise<{ root: DirectoryHandleLike; events: DirectoryHandleLike }> {
  const root = createMemoryDirectory(name);
  await makeV1Month(root, MONTH);
  expect((await upsertItemAnswer(root, MONTH, "emp1", item("A1"))).ok).toBe(true);
  expect((await upsertItemAnswer(root, MONTH, "emp2", item("B1", "emp2"))).ok).toBe(true);
  resetCaches();
  return { root, events: await getAnswerEventsDir(root, MONTH, false) };
}

describe("migration retry convergence (v154.0 field report)", () => {
  beforeEach(resetCaches);

  it("candidate 1: one assignee's snapshot rebuild fails deterministically (unreadable legacy answers file) — the month no longer throws forever; that assignee's segments stay flat and are asked about / named", async () => {
    const { root, events } = await twoEmployeeMonth("legacy-dead");
    const employees = await getSampleEmployeeDir(root, MONTH, true);
    await writeText(employees, "emp2.answers.json", JSON.stringify(wrap({ items: [] })));
    setSimulatedFaults(root, [{ operation: "getFile", name: "emp2.answers.json", errorName: "NotReadableError", times: 1_000_000 }]);
    const flatBefore = await fileNames(events);
    const asked: string[][] = [];
    const first = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", onUnreadable: async (names) => { asked.push([...names]); return "finish"; } });
    if (first.status !== "migrated") throw new Error(first.status);
    expect(asked.length).toBe(1);
    expect(first.unfolded.length).toBeGreaterThan(0);
    for (const name of first.unfolded) expect(await readText(events, name)).toBeTruthy(); // kept flat, never deleted
    expect(flatBefore).toEqual(expect.arrayContaining(first.unfolded));
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.map((i) => i.xrayImageId)).toContain("A1");
    // Retry with the file still unreadable: converges again instead of throwing.
    resetCaches();
    const second = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(second.status).toBe("migrated");
    // Once the file opens, a retry folds and archives them.
    setSimulatedFaults(root, []);
    resetCaches();
    const third = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    if (third.status !== "migrated") throw new Error(third.status);
    expect(third.unfolded).toEqual([]);
    expect(await fileNames(events)).toEqual([]);
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.map((i) => i.xrayImageId)).toContain("B1");
  }, 60_000);

  it("candidate 1b: postponing a snapshot-rebuild failure on a first run moves nothing (month stays plain v1)", async () => {
    const { root, events } = await twoEmployeeMonth("legacy-postpone");
    const employees = await getSampleEmployeeDir(root, MONTH, true);
    await writeText(employees, "emp2.answers.json", JSON.stringify(wrap({ items: [] })));
    setSimulatedFaults(root, [{ operation: "getFile", name: "emp2.answers.json", errorName: "NotReadableError", times: 1_000_000 }]);
    const flatBefore = await fileNames(events);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", onUnreadable: async () => "postpone" });
    expect(result.status).toBe("postponed");
    expect(await fileNames(events)).toEqual(flatBefore);
    await expect(getAnswerArchiveV1Dir(root, MONTH, false)).rejects.toThrow();
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.migrationLock)).rejects.toMatchObject({ name: "NotFoundError" });
  }, 60_000);

  it("candidate 2: a permanently unreadable segment in an assignee's archive/ (strict rebuild) on a v2 straggler re-run converges", async () => {
    const { root, events } = await twoEmployeeMonth("archive-dead");
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
    resetCaches();
    const archived = await fileNames(await getAssigneeArchiveDir(root, MONTH, "emp1"));
    expect(archived.length).toBeGreaterThan(0);
    const straggler = "late-ans-devl-sesl.ndjson";
    await writeText(events, straggler, encodeEventLine(savedEvent("late", 900, { xrayImageId: "X-late" })));
    setSimulatedFaults(root, [{ operation: "getFile", name: archived[0]!, errorName: "NotReadableError", times: 1_000_000 }]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      resetCaches();
      const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
      if (result.status !== "migrated") throw new Error(result.status);
      expect(result.unfolded).toEqual([straggler]);
      expect(await readText(events, straggler)).toContain("X-late");
    }
  }, 60_000);

  it("candidate 3: a crash after the quarantine write, then a fresh page (memos reset) — the retry's quarantine append does not conflict", async () => {
    const { root, events } = await twoEmployeeMonth("quarantine-retry");
    await writeText(events, "zz-bad-devb-sesb.ndjson", `${encodeEventLine(savedEvent("n", 6, { xrayImageId: "X8" }))}{not json\n`);
    await expect(migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: (p) => { if (p.phase === "archive") throw new Error("simulated crash"); },
    })).rejects.toThrow(/simulated crash/);
    resetCaches();
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result).toMatchObject({ status: "migrated", quarantinedLines: 1 });
  }, 60_000);

  it("candidate 4: a flat segment whose source removal keeps failing after its verified copy — retry converges, no duplicate loss", async () => {
    const { root, events } = await twoEmployeeMonth("remove-fails");
    const [stuck] = await fileNames(events);
    setSimulatedFaults(root, [{ operation: "removeEntry", name: stuck!, errorName: "NoModificationAllowedError", times: 1_000_000 }]);
    const first = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    if (first.status !== "migrated") throw new Error(first.status);
    expect(first.unmovable).toEqual([stuck]);
    expect(first.unfolded).toEqual([]);
    resetCaches();
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("nothing-to-do");
    expect(await readText(events, stuck!)).toBe(await readText(await getAnswerArchiveV1Dir(root, MONTH), stuck!));
  }, 60_000);

  it("candidate 5: a file already in _archive-v1/ under the same name with DIFFERENT bytes is never overwritten", async () => {
    const { root, events } = await twoEmployeeMonth("archive-collision");
    const [name] = await fileNames(events);
    const archive = await getAnswerArchiveV1Dir(root, MONTH, true);
    const older = encodeEventLine(savedEvent("older", 1, { xrayImageId: "X-older" }));
    await writeText(archive, name!, older);
    const flatText = await readText(events, name!);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result.status).toBe("migrated");
    expect(await readText(archive, name!)).toBe(older);
    const archivedTexts = await Promise.all((await fileNames(archive)).map((n) => readText(archive, n)));
    expect(archivedTexts).toContain(flatText);
    expect(await fileNames(events)).toEqual([]);
  }, 60_000);

  it("candidate 5b: an identical copy already in _archive-v1/ (crash between copy and remove) completes without a duplicate", async () => {
    const { root, events } = await twoEmployeeMonth("archive-identical");
    const [name] = await fileNames(events);
    const archive = await getAnswerArchiveV1Dir(root, MONTH, true);
    await writeText(archive, name!, await readText(events, name!));
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result.status).toBe("migrated");
    expect((await fileNames(archive)).filter((n) => n.startsWith(name!.replace(/\.ndjson$/, "")))).toEqual([name]);
    expect(await fileNames(events)).toEqual([]);
  }, 60_000);

  it("candidate 6: a lock left by a previous crashed run (another token) blocks only until stale, then the retry migrates", async () => {
    const { root, events } = await twoEmployeeMonth("left-lock");
    const start = Date.parse("2026-05-10T08:00:00.000Z");
    await safeWriteJson(events, ANSWER_EVENTS_FOLDERS.migrationLock, wrap({ by: "admin", deviceId: "d", startedAt: new Date(start).toISOString(), token: "crashed-run", revision: 1 }));
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => start + 60_000 })).status).toBe("locked-elsewhere");
    resetCaches();
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin", nowMs: () => start + 31 * 60_000 })).status).toBe("migrated");
  }, 60_000);
});
