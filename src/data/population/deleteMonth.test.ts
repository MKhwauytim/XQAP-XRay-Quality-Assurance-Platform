import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { __resetAnswerEventsCacheForTests, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { getPopulationMonthDir, getSampleMainDir } from "../workspace/workspacePaths";
import { closeMonth, invalidateMonthLockCache } from "./monthLock";
import type { MonthManifestData } from "./monthTypes";
import { assessMonthDeletion, deleteMonth } from "./deleteMonth";

const MONTH = "10-October-2026";
const OTHER = "9-September-2026";

const answer = (id: string): ItemAnswer => ({
  xrayImageId: id, templateId: "tpl", templateVersion: 1, answers: [{ fieldId: "note", value: "ok" }],
  lastSavedAt: "2026-10-01T10:00:00.000Z", submittedAt: "2026-10-01T10:00:00.000Z", answeredBy: "emp1", status: "submitted",
});

async function seedMonth(root: DirectoryHandleLike, month: string, answers: number): Promise<void> {
  const manifest: MonthManifestData = {
    monthFolderName: month, month: 10, year: 2026, processedAt: "2026-10-01T00:00:00.000Z", processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false, templateVersion: null, rngSeed: null,
    totalRawRows: 0, totalProcessedRows: 1, status: "distributed",
  };
  await safeWriteJson(await getPopulationMonthDir(root, month, true), "month.manifest.json", manifest);
  await getSampleMainDir(root, month, true);
  for (let i = 0; i < answers; i += 1) {
    const saved = await upsertItemAnswer(root, month, "emp1", answer(`A${i}`));
    if (!saved.ok) throw new Error(saved.error);
  }
  __resetAnswerEventsCacheForTests();
}

const exists = async (open: () => Promise<unknown>): Promise<boolean> => open().then(() => true, () => false);

describe("deleteMonth", () => {
  beforeEach(() => {
    __resetAnswerEventsCacheForTests();
    invalidateMonthLockCache();
  });

  it("removes the month's population and sample folders and leaves other months alone", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, MONTH, 0);
    await seedMonth(root, OTHER, 1);

    const result = await deleteMonth(root, MONTH, 0);

    expect(result.ok).toBe(true);
    expect(await exists(() => getPopulationMonthDir(root, MONTH, false))).toBe(false);
    expect(await exists(() => getSampleMainDir(root, MONTH, false))).toBe(false);
    expect(await exists(() => getPopulationMonthDir(root, OTHER, false))).toBe(true);
    expect(await exists(() => getSampleMainDir(root, OTHER, false))).toBe(true);
  });

  it("counts the month's answers and deletes only when at least that many were acknowledged", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, MONTH, 2);

    expect((await assessMonthDeletion(root, MONTH)).answerCount).toBe(2);
    const refused = await deleteMonth(root, MONTH, 1);
    expect(refused).toMatchObject({ ok: false, reason: "answers-changed" });
    expect(await exists(() => getSampleMainDir(root, MONTH, false))).toBe(true);

    expect((await deleteMonth(root, MONTH, 2)).ok).toBe(true);
    expect(await exists(() => getSampleMainDir(root, MONTH, false))).toBe(false);
  });

  it("never deletes a closed month", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, MONTH, 0);
    expect((await closeMonth(root, MONTH, "admin")).ok).toBe(true);
    invalidateMonthLockCache();

    expect(await deleteMonth(root, MONTH, 0)).toMatchObject({ ok: false, reason: "closed" });
    expect(await exists(() => getPopulationMonthDir(root, MONTH, false))).toBe(true);
  });

  it("reports a month that is already gone", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    expect(await deleteMonth(root, MONTH, 0)).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("viewing a deleted month's answers no longer recreates its folder", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, MONTH, 1);
    await deleteMonth(root, MONTH, 1);
    const { readAllAnswerEventsForMonth } = await import("../answers/answerStorage");
    expect(await readAllAnswerEventsForMonth(root, MONTH)).toEqual([]);
    expect(await exists(() => getSampleMainDir(root, MONTH, false))).toBe(false);
  });
});
