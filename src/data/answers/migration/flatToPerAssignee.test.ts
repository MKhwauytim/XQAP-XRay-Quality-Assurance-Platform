// src/data/answers/migration/flatToPerAssignee.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { unwrap, wrap } from "../../storage/jsonEnvelope";
import { safeWriteJson } from "../../storage/safeWrite";
import {
  __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerArchiveV1Dir, getAnswerEventsDir,
  getAnswerEventsLayout, getAssigneeAnswerEventsDir, invalidateAnswerEventsLayout,
} from "../../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer, upsertItemAnswerOnBehalf } from "../answerStorage";
import type { ItemAnswer } from "../answerTypes";
import { fileNames, makeV1Month, readText, savedEvent, writeText } from "../v2/v2TestFixtures";
import { groupFlatSegmentLines, migrateMonthToPerAssignee, type MigrationPhase } from "./flatToPerAssignee";

const MONTH = "5-may-2026";

function item(id: string, answeredBy = "emp1", status: ItemAnswer["status"] = "draft"): ItemAnswer {
  return { xrayImageId: id, templateId: "t", templateVersion: 1, answers: [{ fieldId: "f", value: id }], lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null, answeredBy, status };
}

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

/**
 * A real v1 month: three writer chains, two assignees, one orphan line (no answeredBy).
 * The unparseable line lives in `writeBadSegment`, added only AFTER the "before" read:
 * today's v1 reader throws on any unparseable line (P0-1), so a month holding one
 * cannot also be the "still readable" baseline.
 */
async function v1Fixture(name: string): Promise<{ root: DirectoryHandleLike; flatTexts: Map<string, string> }> {
  const root = createMemoryDirectory(name);
  await makeV1Month(root, MONTH);
  expect((await upsertItemAnswer(root, MONTH, "emp1", item("A1"))).ok).toBe(true);
  expect((await upsertItemAnswer(root, MONTH, "emp2", item("B1", "emp2"))).ok).toBe(true);
  expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("A2"), "sup1", "r")).ok).toBe(true);
  const events = await getAnswerEventsDir(root, MONTH, false);
  const orphan = { ...savedEvent("orphan", 5, { eventBy: "emp2", xrayImageId: "X9" }, "emp2") };
  delete (orphan as { answeredBy?: string }).answeredBy;
  await writeText(events, "zz-ans-devz-sesz.ndjson", encodeEventLine(orphan));
  const flatTexts = new Map<string, string>();
  for (const n of await fileNames(events)) flatTexts.set(n, await readText(events, n));
  resetCaches();
  return { root, flatTexts };
}

const BAD_SEGMENT = "zz-bad-devb-sesb.ndjson";
async function writeBadSegment(root: DirectoryHandleLike, flatTexts: Map<string, string>): Promise<void> {
  const text = `${encodeEventLine(savedEvent("bad-neighbour", 6, { xrayImageId: "X8" }))}{not json\n`;
  await writeText(await getAnswerEventsDir(root, MONTH, false), BAD_SEGMENT, text);
  flatTexts.set(BAD_SEGMENT, text);
}

async function snapshotOfAll(root: DirectoryHandleLike) {
  resetCaches();
  return {
    emp1: (await loadEmployeeAnswers(root, MONTH, "emp1")).items,
    emp2: (await loadEmployeeAnswers(root, MONTH, "emp2")).items.filter((i) => i.xrayImageId !== "X9"),
  };
}

describe("groupFlatSegmentLines", () => {
  it("groups by answeredBy, falls back to eventBy, quarantines the rest", () => {
    const ok = encodeEventLine(savedEvent("a", 1));
    const noAssignee = JSON.stringify({ eventId: "n", eventType: "item-saved", eventAt: "x" });
    const { groups, quarantined } = groupFlatSegmentLines([{ name: "s.ndjson", bytes: 1, text: `${ok}{bad\n${noAssignee}\nnull\n` }]);
    expect([...groups.keys()]).toEqual(["emp1"]);
    expect(quarantined.map((q) => q.reason)).toEqual(["unparseable", "no-assignee", "unparseable"]);
  });
});

describe("migrateMonthToPerAssignee (spec §6)", () => {
  beforeEach(resetCaches);

  it("migrates: marker last, originals archived byte-identical, answers unchanged, bad line quarantined", async () => {
    const { root, flatTexts } = await v1Fixture("m1");
    const before = await snapshotOfAll(root);
    await writeBadSegment(root, flatTexts);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result).toMatchObject({ status: "migrated", quarantinedLines: 1 });
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v2");
    const events = await getAnswerEventsDir(root, MONTH, false);
    expect(await fileNames(events)).toEqual([]);
    await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.migrationLock)).rejects.toMatchObject({ name: "NotFoundError" });
    const archive = await getAnswerArchiveV1Dir(root, MONTH, false);
    for (const [n, text] of flatTexts) expect(await readText(archive, n)).toBe(text);
    expect(await fileNames(await getAssigneeAnswerEventsDir(root, MONTH, "emp1"))).toEqual([]); // no live segments created
    const after = await snapshotOfAll(root);
    // The bad segment's parseable neighbour line (X8) is kept; only the bad line is quarantined.
    expect({ ...after, emp1: after.emp1.filter((i) => i.xrayImageId !== "X8") }).toEqual(before);
    expect(after.emp1.some((i) => i.xrayImageId === "X8")).toBe(true);
    // spec §6 step 2: an event with no answeredBy is attributed to its eventBy
    expect((await loadEmployeeAnswers(root, MONTH, "emp2")).items.some((i) => i.xrayImageId === "X9")).toBe(true);
  });

  const phases: MigrationPhase[] = ["read", "archive", "snapshot", "move", "commit"];
  for (const phase of phases) {
    it(`crash at "${phase}": still v1, still readable, re-run completes (Review Focus 4)`, async () => {
      const { root } = await v1Fixture(`crash-${phase}`);
      const before = await snapshotOfAll(root);
      let thrown = false;
      await expect(
        migrateMonthToPerAssignee(root, MONTH, {
          actor: "admin",
          onProgress: (p) => {
            if (!thrown && p.phase === phase && (phase === "commit" || p.done >= 1)) {
              thrown = true;
              throw new Error(`simulated crash at ${phase}`);
            }
          },
        })
      ).rejects.toThrow(/simulated crash/);
      resetCaches();
      const events = await getAnswerEventsDir(root, MONTH, false);
      await expect(events.getFileHandle(ANSWER_EVENTS_FOLDERS.layoutMarker)).rejects.toMatchObject({ name: "NotFoundError" });
      expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
      expect(await snapshotOfAll(root)).toEqual(before);
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("deferred"))).ok).toBe(false);
      expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
      expect(await snapshotOfAll(root)).toEqual(before);
    }, 30_000);
  }

  it("a segment written during the migration is picked up by the straggler pass", async () => {
    const { root } = await v1Fixture("straggler");
    let injected = false;
    const result = await migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: async (p) => {
        if (injected || p.phase !== "move") return;
        injected = true;
        const events = await getAnswerEventsDir(root, MONTH, false);
        await writeText(events, "late-ans-devl-sesl.ndjson", encodeEventLine(savedEvent("late", 900, { xrayImageId: "X-late" })));
      },
    });
    expect(result.status).toBe("migrated");
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.some((i) => i.xrayImageId === "X-late")).toBe(true);
    await expect((await getAnswerArchiveV1Dir(root, MONTH)).getFileHandle("late-ans-devl-sesl.ndjson")).resolves.toBeTruthy();
  }, 30_000);

  it("a fresh lock held by another admin aborts without touching anything", async () => {
    const { root, flatTexts } = await v1Fixture("busy");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await safeWriteJson(events, ANSWER_EVENTS_FOLDERS.migrationLock, wrap({ by: "admin2", deviceId: "other", startedAt: new Date().toISOString(), token: "t", revision: 1 }));
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result).toMatchObject({ status: "locked-elsewhere", by: "admin2" });
    expect(await fileNames(events)).toEqual([...flatTexts.keys()].sort());
  });

  it("a lock older than 30 minutes is taken over", async () => {
    const { root } = await v1Fixture("stale");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await safeWriteJson(events, ANSWER_EVENTS_FOLDERS.migrationLock, wrap({ by: "admin2", deviceId: "other", startedAt: new Date(Date.now() - 31 * 60_000).toISOString(), token: "t", revision: 1 }));
    expect((await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" })).status).toBe("migrated");
  });

  it("an unopenable segment stays flat, is listed as unmovable, and the migration still commits", async () => {
    const { root } = await v1Fixture("dead");
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, "dead-ans-devd-sesd.ndjson", encodeEventLine(savedEvent("dead", 1)));
    setSimulatedFaults(root, [{ operation: "getFile", name: "dead-ans-devd-sesd.ndjson", errorName: "NotReadableError", times: 10_000 }]);
    const result = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(result.status).toBe("migrated");
    if (result.status === "migrated") expect(result.marker.unmovable).toContain("dead-ans-devd-sesd.ndjson");
    const markerText = await readText(events, ANSWER_EVENTS_FOLDERS.layoutMarker);
    expect(unwrap<{ unmovable: string[] }>(JSON.parse(markerText)).unmovable).toContain("dead-ans-devd-sesd.ndjson");
  }, 60_000);

  it("a v2 month with flat stragglers (e.g. a v1 backup restored into it) migrates just those", async () => {
    const { root } = await v1Fixture("v2stragglers");
    await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    resetCaches();
    const events = await getAnswerEventsDir(root, MONTH, false);
    await writeText(events, "restored-ans-devr-sesr.ndjson", encodeEventLine(savedEvent("restored", 950, { xrayImageId: "X-restored" })));
    const second = await migrateMonthToPerAssignee(root, MONTH, { actor: "admin" });
    expect(second.status).toBe("migrated");
    resetCaches();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items.some((i) => i.xrayImageId === "X-restored")).toBe(true);
    expect(await fileNames(events)).toEqual([]);
  }, 30_000);
});
