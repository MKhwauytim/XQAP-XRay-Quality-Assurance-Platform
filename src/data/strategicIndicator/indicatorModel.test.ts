import { describe, expect, it } from "vitest";
import { namespacedXrayImageId, adhocMonthFolder } from "../adhocImport/adhocImportModel";
import { upsertItemAnswer } from "../answers/answerStorage";
import { buildAssignEvent } from "../distribution/distributionLog";
import { appendDistributionEvents } from "../distribution/distributionStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { formatMonthFolderName } from "../population/monthFolder";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { addMonthStageCounts, buildIndicatorCard, countByMonthStage, indicatorBlockLabel } from "./indicatorModel";
import { collectIndicatorSystemData, parseWallClock, toIndicatorAppends } from "./indicatorSystemData";
import { SAMPLE_COLUMNS, type IndicatorBaseline, type IndicatorTable } from "./indicatorTemplate";
import { loadStoredIndicator, saveIndicatorTemplate } from "./indicatorStorage";

const TARGETS = { second: 2500, third: 1875, fourth: 1875 };

describe("buildIndicatorCard", () => {
  // «يناير» block of the owner's workbook (data month 12): G6:K10.
  const card = buildIndicatorCard({
    population: { "12": { FIRST_STAGE: 384, SECOND_STAG: 2829, THIRD_STAGE: 55178, FORTH_STAGE: 13628 } },
    samples: { "12": { FIRST_STAGE: 140, SECOND_STAG: 2589, THIRD_STAGE: 5310, FORTH_STAGE: 3817 } },
    targets: TARGETS,
    cardMonths: [12],
  });

  it("reproduces the workbook's figures for a month", () => {
    expect(card).toHaveLength(1);
    const [month] = card;
    expect(month.label).toBe("يناير");
    expect(month.stages.first).toEqual({ population: 384, target: 384, sample: 140, deficit: -244, ratio: 140 / 384 });
    expect(month.stages.second).toMatchObject({ target: 2500, deficit: 0 });
    expect(month.stages.third).toMatchObject({ target: 1875, sample: 5310, deficit: 0 });
    expect(month.total).toEqual({ population: 72019, target: 6634, sample: 11856, deficit: -244 });
    // AVERAGE(IF(K6:K9>100%,100%,K6:K9)) = 84.1% in the workbook.
    expect(month.achievement).toBeCloseTo(0.8411458, 6);
    expect(month.cumulative).toBeCloseTo(0.8411458, 6);
  });

  it("caps a fixed target at the population and orders months December first", () => {
    const months = buildIndicatorCard({
      population: { "1": { SECOND_STAG: 100 }, "12": { SECOND_STAG: 9000 }, "10": { THIRD_STAGE: 50 } },
      samples: { "1": { SECOND_STAG: 50 }, "12": { SECOND_STAG: 2500 } },
      targets: TARGETS,
      cardMonths: [12, 1],
    });
    expect(months.map((month) => month.dataMonth)).toEqual([12, 1, 10]);
    expect(months[1].stages.second).toMatchObject({ target: 100, ratio: 0.5 });
    expect(months[1].cumulative).toBeCloseTo((1 + 0.5) / 2, 9);
    expect(months[2].inCard).toBe(false);
    expect(months[2].label).toBe("نوفمبر");
  });

  it("leaves out a month that has studied cases but no population", () => {
    expect(buildIndicatorCard({ population: {}, samples: { "10": { FIRST_STAGE: 1 } }, targets: TARGETS, cardMonths: [] })).toEqual([]);
  });

  it("titles a block with the month after its data month", () => {
    expect([12, 1, 9, 11].map(indicatorBlockLabel)).toEqual(["يناير", "فبراير", "أكتوبر", "ديسمبر"]);
  });

  it("adds and counts month/level figures", () => {
    const counted = countByMonthStage([
      { month: 3, stageCode: "FIRST_STAGE" },
      { month: 3, stageCode: "FIRST_STAGE" },
      { month: 4, stageCode: "THIRD_STAGE" },
    ]);
    expect(counted).toEqual({ "3": { FIRST_STAGE: 2 }, "4": { THIRD_STAGE: 1 } });
    expect(addMonthStageCounts(counted, { "3": { FIRST_STAGE: 5, THIRD_STAGE: 1 } })).toEqual({
      "3": { FIRST_STAGE: 7, THIRD_STAGE: 1 },
      "4": { THIRD_STAGE: 1 },
    });
  });
});

describe("parseWallClock", () => {
  it("reads the stored date shapes and refuses anything else", () => {
    expect(parseWallClock("2026-01-05 07:31:22")).toEqual({ year: 2026, month: 1, day: 5, hour: 7, minute: 31, second: 22 });
    expect(parseWallClock("2026-09-06")).toMatchObject({ month: 9, day: 6, hour: 0 });
    expect(parseWallClock("2026-03-09T01:57:10")).toMatchObject({ month: 3, hour: 1 });
    expect(parseWallClock("05/01/2026")).toBeNull();
    expect(parseWallClock("2026-13-01")).toBeNull();
    expect(parseWallClock(null)).toBeNull();
  });
});

function makeRow(id: string, stage: string, entryDate: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "جديدة عرعر",
    certScanStatus: "NonCertscan",
    stage,
    xrayEntryDate: entryDate,
    portCode: null,
    portType: "منفذ بري",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: "1234",
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

async function seedStore(
  root: DirectoryHandleLike,
  folder: string,
  rows: PreparedPopulationRow[],
  submitted: readonly string[]
): Promise<void> {
  await saveSampleMaster(root, folder, makeSample(rows));
  const assigned = await appendDistributionEvents(
    root,
    folder,
    rows.map((row) => buildAssignEvent({ xrayImageId: row.xrayImageId, assignedTo: "emp-1", eventBy: "admin" }))
  );
  if (!assigned.ok) throw new Error(assigned.error);
  for (const row of rows) {
    const done = submitted.includes(row.xrayImageId);
    const saved = await upsertItemAnswer(root, folder, "emp-1", {
      xrayImageId: row.xrayImageId,
      templateId: "t1",
      templateVersion: 1,
      answers: [],
      lastSavedAt: "2026-10-12T09:00:00.000Z",
      submittedAt: done ? "2026-10-12T09:00:00.000Z" : null,
      answeredBy: "emp-1",
      status: done ? "submitted" : "draft",
    });
    if (!saved.ok) throw new Error(saved.error);
  }
}

const emptyTable = (tableName: string, columns: string[]): IndicatorTable => ({
  tableName,
  tablePath: "",
  sheetName: "",
  sheetPath: "",
  range: { startColumn: 0, startRow: 2, endColumn: columns.length - 1, endRow: 10 },
  columns,
  lastRowCells: [],
});

function makeBaseline(sampleIds: string[]): IndicatorBaseline {
  return {
    fileName: "model.xlsx",
    sizeBytes: 1,
    scannedAt: "2026-11-10T00:00:00.000Z",
    populationTables: ["Q1_", "Q2_", "Q3_", "Q4_"].map((name) => emptyTable(name, [])),
    samplesTable: emptyTable("Samples", Object.values(SAMPLE_COLUMNS)),
    population: { "9": { THIRD_STAGE: 10 } },
    samples: {},
    sampleIds,
    targets: TARGETS,
    cardMonths: [9],
  };
}

describe("indicator storage", () => {
  it("stores the workbook and its summary, and refuses a pair that does not match", async () => {
    const root = createMemoryDirectory("root");
    expect(await loadStoredIndicator(root)).toBeNull();

    const bytes = new Uint8Array(20_000).map((_, index) => index % 251);
    const template = new Blob([bytes]);
    await saveIndicatorTemplate(root, template, { ...makeBaseline(["A"]), sizeBytes: template.size });
    const stored = await loadStoredIndicator(root);
    expect(stored?.baseline.sampleIds).toEqual(["A"]);
    expect(new Uint8Array(await (stored as { template: Blob }).template.arrayBuffer())).toEqual(bytes);

    // A summary written for a different workbook size is an interrupted upload.
    await saveIndicatorTemplate(root, template, { ...makeBaseline([]), sizeBytes: template.size + 1 });
    expect(await loadStoredIndicator(root)).toBeNull();
  });
});

describe("collectIndicatorSystemData", () => {
  it("collects submitted cases the workbook does not hold, under their source id", async () => {
    const root = createMemoryDirectory("root");
    const september = formatMonthFolderName(9, 2026);
    // A month is listed from its population folder.
    await getPopulationMonthDir(root, september, true);
    await seedStore(
      root,
      september,
      [
        makeRow("IMG-DONE", "THIRD_STAGE", "2026-09-06 10:00:00"),
        makeRow("IMG-DRAFT", "THIRD_STAGE", "2026-09-07 10:00:00"),
        makeRow("IMG-IN-FILE", "THIRD_STAGE", "2026-09-08 10:00:00"),
      ],
      ["IMG-DONE", "IMG-IN-FILE"]
    );
    const importId = "adh-3f8a1c2e-1111-4222-b335-fb1422722179";
    const exceptionalId = namespacedXrayImageId(importId, "IMG-EXC");
    await seedStore(root, adhocMonthFolder(importId), [makeRow(exceptionalId, "FIRST_STAGE", "2026-08-20 08:00:00")], [exceptionalId]);

    const baseline = makeBaseline(["IMG-IN-FILE"]);
    const data = await collectIndicatorSystemData(root, baseline);

    expect(data.failedSources).toEqual([]);
    expect(data.sampleRows.map((row) => [row.xrayImageId, row.stageCode, row.month, row.inIndicator])).toEqual([
      ["IMG-DONE", "THIRD_STAGE", 9, true],
      ["IMG-EXC", "FIRST_STAGE", 8, false],
    ]);

    const samples = toIndicatorAppends(data, baseline).find((append) => append.tableName === "Samples");
    expect(samples?.rows).toHaveLength(2);
    expect(samples?.rows[1][SAMPLE_COLUMNS.imageId]).toEqual({ kind: "text", value: "IMG-EXC" });
    expect(samples?.rows[1][SAMPLE_COLUMNS.inIndicator]).toEqual({ kind: "text", value: "لا" });
    expect(samples?.rows[0][SAMPLE_COLUMNS.captureMonth]).toEqual({ kind: "number", value: 9 });
    expect(samples?.rows[0][SAMPLE_COLUMNS.completion]).toEqual({ kind: "text", value: "مكتمل" });
  });
});
