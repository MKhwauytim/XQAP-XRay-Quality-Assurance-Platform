import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { __resetAnswerEventsCacheForTests, loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { appendDistributionEvents, loadDistributionLog } from "../distribution/distributionStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { closeMonth, invalidateMonthLockCache } from "../population/monthLock";
import type { MonthManifestData, PopulationFinalData } from "../population/monthTypes";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getPopulationMonthDir, getSampleMainDir, getSystemRoot, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { ARCHIVED_MONTHS_DIR } from "./archiveMonthFolders";
import { executeMonthTransfer, planMonthTransfer } from "./monthTransfer";

const TARGET = "1-January-2026";
const SOURCE = "10-October-2025";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id, portName: "ميناء", certScanStatus: "NonCertscan", stage: null, xrayEntryDate: null,
    portCode: null, portType: null, declarationNumber: null, declarationDate: null, plateOrContainerNumber: null,
    chassisNumber: null, xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة", movementType: "LAND",
    reportNumber: null, targetedByRiskEngine: null, riskMessage: null, levelOneEmployee: null, levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null, certScanSnippet: null, originalCertScanSnippet: null, biEnrichmentStatus: "BI Not Provided",
    biMatched: false, biFilledFields: [], sourceSheetName: "بري", sourceRowNumber: 1,
  };
}

const sample = (rows: PreparedPopulationRow[]): SampleMasterData => ({
  rngSeed: "seed", totalRequested: rows.length, totalActual: rows.length, certScanRequested: 0,
  nonCertScanRequested: rows.length, certScanActual: 0, nonCertScanActual: rows.length,
  portAllocations: [], stageAllocations: [], drawnAt: "2026-01-01T00:00:00.000Z", drawnBy: "admin", rows,
});

const answer = (id: string): ItemAnswer => ({
  xrayImageId: id, templateId: "tpl", templateVersion: 1, answers: [{ fieldId: "note", value: "ok" }],
  lastSavedAt: "2025-10-05T10:00:00.000Z", submittedAt: "2025-10-05T10:00:00.000Z", answeredBy: "emp1", status: "submitted",
});

async function seedMonth(root: DirectoryHandleLike, month: string, ids: string[], answered: string[] = []): Promise<void> {
  const manifest: MonthManifestData = {
    monthFolderName: month, month: 1, year: 2026, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false, templateVersion: null, rngSeed: null,
    totalRawRows: 0, totalProcessedRows: ids.length, status: "distributed",
  };
  const monthDir = await getPopulationMonthDir(root, month, true);
  await safeWriteJson(monthDir, "month.manifest.json", manifest);
  const rows = ids.map(makeRow);
  const final: PopulationFinalData = {
    sourceMonthFolder: month, processedAt: "2026-01-01T00:00:00.000Z", processedBy: "admin",
    totalRows: rows.length, certScanRows: 0, nonCertScanRows: rows.length,
    rows: rows as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true }), "population.final.json", final);
  expect((await saveSampleMaster(root, month, sample(rows))).ok).toBe(true);
  const assigned = await appendDistributionEvents(root, month, ids.map((id) => buildAssignEvent({ xrayImageId: id, assignedTo: "emp1", eventBy: "admin" })));
  expect(assigned.ok).toBe(true);
  for (const id of answered) expect((await upsertItemAnswer(root, month, "emp1", answer(id))).ok).toBe(true);
  __resetAnswerEventsCacheForTests();
}

const exists = (open: () => Promise<unknown>): Promise<boolean> => open().then(() => true, () => false);

describe("month transfer", () => {
  beforeEach(() => {
    __resetAnswerEventsCacheForTests();
    invalidateMonthLockCache();
  });

  it("plans duplicates without writing", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, TARGET, ["T1", "S2"]);
    await seedMonth(root, SOURCE, ["S1", "S2"], ["S1", "S2"]);

    const planned = await planMonthTransfer(root, SOURCE, TARGET);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.rows.map((r) => r.xrayImageId)).toEqual(["S1"]);
    expect(planned.plan.duplicates).toEqual(["S2"]);
    expect(planned.plan.answerCount).toBe(1);
    expect((await loadSampleMaster(root, TARGET))?.rows).toHaveLength(2);
  });

  it("moves sample, assignments, answers and population, then archives the source", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, TARGET, ["T1", "S2"]);
    await seedMonth(root, SOURCE, ["S1", "S2"], ["S1"]);

    const result = await executeMonthTransfer(root, SOURCE, TARGET, "admin");
    expect(result).toMatchObject({ ok: true, movedRows: 1, movedAnswers: 1, movedPopulationRows: 1, duplicates: ["S2"] });

    const merged = await loadSampleMaster(root, TARGET);
    expect(merged?.rows.map((r) => r.xrayImageId).sort()).toEqual(["S1", "S2", "T1"]);
    expect(merged?.totalActual).toBe(3);
    const log = await loadDistributionLog(root, TARGET);
    expect(log.events.filter((e) => e.xrayImageId === "S1")).toHaveLength(1);
    __resetAnswerEventsCacheForTests();
    const answers = await loadEmployeeAnswers(root, TARGET, "emp1");
    expect(answers.items.map((i) => i.xrayImageId)).toEqual(["S1"]);
    expect((await loadMonthPopulationFinal(root, TARGET))?.totalRows).toBe(3);

    expect(await exists(() => getPopulationMonthDir(root, SOURCE, false))).toBe(false);
    expect(await exists(() => getSampleMainDir(root, SOURCE, false))).toBe(false);
    if (!result.ok) return;
    const archive = await (await (await getSystemRoot(root, false)).getDirectoryHandle(ARCHIVED_MONTHS_DIR))
      .getDirectoryHandle(result.archiveName);
    expect(await exists(() => archive.getDirectoryHandle("2-samples"))).toBe(true);
    expect(await exists(() => archive.getDirectoryHandle("1-population"))).toBe(true);
  });

  it("refuses a closed month and leaves both months untouched", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, TARGET, ["T1"]);
    await seedMonth(root, SOURCE, ["S1"]);
    expect((await closeMonth(root, TARGET, "admin")).ok).toBe(true);
    invalidateMonthLockCache();

    expect(await executeMonthTransfer(root, SOURCE, TARGET, "admin")).toMatchObject({ ok: false, reason: "target-closed" });
    expect(await exists(() => getSampleMainDir(root, SOURCE, false))).toBe(true);
  });

  it("moves an ad-hoc sample (no population) into a month and empties the ad-hoc folder", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const ADHOC = "adhoc-imp1";
    await seedMonth(root, TARGET, ["T1"]);
    const rows = [makeRow("ADHOC-imp1-X1")];
    expect((await saveSampleMaster(root, ADHOC, sample(rows))).ok).toBe(true);
    expect((await appendDistributionEvents(root, ADHOC, [buildAssignEvent({ xrayImageId: "ADHOC-imp1-X1", assignedTo: "emp2", eventBy: "admin" })])).ok).toBe(true);
    expect((await upsertItemAnswer(root, ADHOC, "emp2", { ...answer("ADHOC-imp1-X1"), answeredBy: "emp2" })).ok).toBe(true);
    __resetAnswerEventsCacheForTests();

    const result = await executeMonthTransfer(root, ADHOC, TARGET, "admin");
    expect(result).toMatchObject({ ok: true, movedRows: 1, movedAnswers: 1, movedPopulationRows: 1 });
    expect((await loadSampleMaster(root, TARGET))?.rows.map((r) => r.xrayImageId)).toContain("ADHOC-imp1-X1");
    __resetAnswerEventsCacheForTests();
    expect((await loadEmployeeAnswers(root, TARGET, "emp2")).items).toHaveLength(1);
    expect(await exists(() => getSampleMainDir(root, ADHOC, false))).toBe(false);
  });

  it("refuses a target without a sample", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    await seedMonth(root, SOURCE, ["S1"]);
    expect(await planMonthTransfer(root, SOURCE, TARGET)).toMatchObject({ ok: false, reason: "target-no-sample" });
  });
});
