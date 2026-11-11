/**
 * What the system holds that the uploaded indicator workbook does not yet:
 * population rows of months the file has no rows for, and studied cases whose
 * image id is not in the file's `Samples` table.
 *
 * Read-only. Every figure here comes from files the app already writes:
 * `population.final.json`, `sample.master.json`, the distribution state and the
 * employees' answer files (through `buildExecutiveReportRows`, the same answer
 * mapping the executive report and the Power BI export use).
 *
 * Deciding what is "new":
 *  - Population: a row is added when the workbook has no population row at all
 *    for the row's month (the month of its entry date). A month the workbook
 *    already holds is left exactly as the owner's file has it.
 *  - Studied cases: a case is added when it is submitted, has an image, and its
 *    id (the source id, without the exceptional-case storage prefix) is not in
 *    `Samples`. This picks up cases studied after the file was produced, in any
 *    month, including exceptional cases.
 */
import { listAdhocStoreImportIds } from "../adhocImport/adhocImportStorage";
import { adhocMonthFolder } from "../adhocImport/adhocImportModel";
import { caseOriginOf, exportedXrayImageId } from "../adhocImport/caseOrigin";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { readUserManagementState } from "../../auth/userManagement";
import { loadOrDeriveDistributionCurrentStrictForRead } from "../distribution/distributionStorage";
import { loadPopulationConfig, type StageAliasMappings } from "../population/populationConfig";
import { listMonthFolders, loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { getStageKey } from "../population/stageHelpers";
import { buildExecutiveReportRows } from "../reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import { liveSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import { logError } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import { loadTemplate } from "../templates/templateStorage";
import type { TemplateSchema } from "../templates/templateTypes";
import { INDICATOR_STAGE_CODES, type IndicatorStage } from "./indicatorModel";
import {
  INDICATOR_SAMPLES_TABLE,
  POPULATION_COLUMNS,
  quarterIndexForMonth,
  SAMPLE_COLUMNS,
  type IndicatorAppend,
  type IndicatorBaseline,
} from "./indicatorTemplate";
import { excelSerial, type CellInput } from "./sheetXml";

/** A date as the wall-clock time to write into the workbook. */
export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/**
 * Reads the date formats the workspace stores: `YYYY-MM-DD`, with an optional
 * time, and full ISO timestamps. A timestamp with a zone (`Z` or an offset) is
 * converted to this machine's local time, which is what the owner's sheet shows.
 */
export function parseWallClock(text: string | null | undefined): WallClock | null {
  const trimmed = (text ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (!match) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    };
  }
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year: Number(match[1]),
    month,
    day,
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
}

export type IndicatorPopulationRow = {
  stageCode: string;
  xrayImageId: string;
  entryDate: string | null;
  /** Month of the entry date: the workbook's `Month` column. */
  month: number;
  portType: string | null;
  portName: string | null;
  declarationNumber: string | null;
  declarationDate: string | null;
  plate: string | null;
  levelOne: string;
  levelTwo: string;
};

export type IndicatorSampleRow = {
  stageCode: string;
  xrayImageId: string;
  entryDate: string | null;
  /** Month of the entry date, or `null` when the date cannot be read (then the card cannot count the case). */
  month: number | null;
  portType: string | null;
  portName: string | null;
  plate: string | null;
  levelOne: string;
  levelTwo: string;
  expert: string;
  studiedAt: string | null;
  hasImage: boolean | null;
  hasMarking: boolean | null;
  imageQuality: string | null;
  lowQualityReason: string | null;
  resultValidity: string | null;
  suspicionLevel: string | null;
  suspectedTypes: string | null;
  smuggleMethod: string | null;
  inIndicator: boolean;
};

export type IndicatorSystemData = {
  populationRows: IndicatorPopulationRow[];
  sampleRows: IndicatorSampleRow[];
  /** Rows left out, with the reason, so the page can say so instead of dropping them silently. */
  skipped: { unknownStage: number; undatedPopulation: number };
  /** Month folders / exceptional stores that could not be read. */
  failedSources: string[];
};

function stageCodeOf(stage: string | null, mappings: Partial<StageAliasMappings> | undefined): string | null {
  const key = getStageKey(stage, mappings);
  return key === "unknown" ? null : INDICATOR_STAGE_CODES[key as IndicatorStage];
}

function collectPopulation(
  rows: readonly PreparedPopulationRow[],
  baseline: IndicatorBaseline,
  mappings: Partial<StageAliasMappings> | undefined,
  out: IndicatorSystemData,
  seen: Set<string>
): void {
  for (const row of rows) {
    const date = parseWallClock(row.xrayEntryDate);
    if (!date) {
      out.skipped.undatedPopulation += 1;
      continue;
    }
    if (baseline.population[String(date.month)]) continue;
    const stageCode = stageCodeOf(row.stage, mappings);
    if (!stageCode) {
      out.skipped.unknownStage += 1;
      continue;
    }
    const id = exportedXrayImageId(row.xrayImageId);
    if (seen.has(id)) continue;
    seen.add(id);
    out.populationRows.push({
      stageCode,
      xrayImageId: id,
      entryDate: row.xrayEntryDate,
      month: date.month,
      portType: row.portType,
      portName: row.portName,
      declarationNumber: row.declarationNumber,
      declarationDate: row.declarationDate,
      plate: row.plateOrContainerNumber,
      levelOne: row.xrayLevelOneResult,
      levelTwo: row.xrayLevelTwoResult,
    });
  }
}

async function collectSamples(
  directoryHandle: DirectoryHandleLike,
  storeFolder: string,
  template: TemplateSchema | null,
  mappings: Partial<StageAliasMappings> | undefined,
  displayNames: ReadonlyMap<string, string>,
  known: Set<string>,
  out: IndicatorSystemData
): Promise<void> {
  const sample = await loadSampleMaster(directoryHandle, storeFolder);
  const sampleRows = liveSampleRows(sample);
  if (sampleRows.length === 0) return;
  const distribution = await loadOrDeriveDistributionCurrentStrictForRead(directoryHandle, storeFolder, sampleRows);
  const employeeFiles = await loadAllEmployeeFiles(directoryHandle, storeFolder);
  const sourceById = new Map(sampleRows.map((row) => [row.xrayImageId, row]));
  const studied = buildExecutiveReportRows({
    monthFolderName: storeFolder,
    populationRows: sampleRows,
    sample: sample ?? null,
    distribution: distribution ?? null,
    employeeFiles,
    template,
    config: DEFAULT_EXEC_CONFIG,
  });
  for (const row of studied) {
    if (row.answerStatus !== "submitted" || row.imageAvailable === false) continue;
    const id = exportedXrayImageId(row.xrayImageId);
    if (known.has(id)) continue;
    const stageCode = stageCodeOf(row.stage, mappings);
    if (!stageCode) {
      out.skipped.unknownStage += 1;
      continue;
    }
    known.add(id);
    const source = sourceById.get(row.xrayImageId);
    out.sampleRows.push({
      stageCode,
      xrayImageId: id,
      entryDate: source?.xrayEntryDate ?? null,
      month: parseWallClock(source?.xrayEntryDate)?.month ?? null,
      portType: row.portType,
      portName: row.portName,
      plate: source?.plateOrContainerNumber ?? null,
      levelOne: row.levelOneOther ?? row.levelOneResult,
      levelTwo: row.levelTwoOther ?? row.levelTwoResult,
      expert: row.assignedTo ? (displayNames.get(row.assignedTo) ?? row.assignedTo) : "",
      studiedAt: row.submittedAt,
      hasImage: row.imageAvailable,
      hasMarking: row.hasMarking,
      imageQuality: row.imageQuality,
      lowQualityReason: row.lowQualityReason,
      resultValidity: row.expertResult,
      suspicionLevel: row.suspicionLevel,
      suspectedTypes: row.suspectedTypes,
      smuggleMethod: row.smuggleMethod,
      inIndicator: caseOriginOf(row.xrayImageId) === "index",
    });
  }
}

export async function collectIndicatorSystemData(
  directoryHandle: DirectoryHandleLike,
  baseline: IndicatorBaseline
): Promise<IndicatorSystemData> {
  const out: IndicatorSystemData = {
    populationRows: [],
    sampleRows: [],
    skipped: { unknownStage: 0, undatedPopulation: 0 },
    failedSources: [],
  };
  const [config, selection, monthFolders, adhocIds] = await Promise.all([
    loadPopulationConfig(directoryHandle).catch(() => null),
    loadInspectionTemplateSelection(directoryHandle).catch(() => null),
    listMonthFolders(directoryHandle),
    listAdhocStoreImportIds(directoryHandle),
  ]);
  const mappings = config?.stageMappings;
  const template = selection?.templateId ? await loadTemplate(directoryHandle, selection.templateId).catch(() => null) : null;
  const displayNames = new Map(readUserManagementState().users.map((user) => [user.username, user.displayName]));
  const knownSampleIds = new Set(baseline.sampleIds);
  const seenPopulationIds = new Set<string>();
  monthFolders.sort((a, b) => a.year - b.year || a.month - b.month);

  // One store after another: parallel month reads on the shared folder slow every other user's saves.
  for (const folder of monthFolders) {
    try {
      // A folder may be named for its data month or for the month after it (the card's own
      // convention), so it is opened when either month is missing from the workbook.
      const previous = folder.month === 1 ? 12 : folder.month - 1;
      if (!baseline.population[String(folder.month)] || !baseline.population[String(previous)]) {
        const population = await loadMonthPopulationFinal(directoryHandle, folder.folderName);
        collectPopulation((population?.rows ?? []) as PreparedPopulationRow[], baseline, mappings, out, seenPopulationIds);
      }
      await collectSamples(directoryHandle, folder.folderName, template, mappings, displayNames, knownSampleIds, out);
    } catch (error) {
      logError("indicatorSystemData:month", error);
      out.failedSources.push(folder.folderName);
    }
  }
  for (const importId of adhocIds) {
    const store = adhocMonthFolder(importId);
    try {
      await collectSamples(directoryHandle, store, template, mappings, displayNames, knownSampleIds, out);
    } catch (error) {
      logError("indicatorSystemData:adhocStore", error);
      out.failedSources.push(store);
    }
  }
  return out;
}

const text = (value: string | null | undefined): CellInput => {
  const trimmed = (value ?? "").trim();
  return trimmed ? { kind: "text", value: trimmed } : null;
};

const yesNo = (value: boolean | null): CellInput => (value === null ? null : { kind: "text", value: value ? "نعم" : "لا" });

/** A date cell: an Excel serial when the text is a readable date, otherwise the text as it is. */
function dateCell(value: string | null): CellInput {
  const date = parseWallClock(value);
  if (!date) return text(value);
  return { kind: "number", value: excelSerial(date.year, date.month, date.day, date.hour, date.minute, date.second) };
}

/** The system's new rows as rows of the workbook's tables. */
export function toIndicatorAppends(data: IndicatorSystemData, baseline: IndicatorBaseline): IndicatorAppend[] {
  const byQuarter: Array<Array<Record<string, CellInput>>> = [[], [], [], []];
  for (const row of data.populationRows) {
    byQuarter[quarterIndexForMonth(row.month)].push({
      [POPULATION_COLUMNS.stage]: text(row.stageCode),
      [POPULATION_COLUMNS.imageId]: text(row.xrayImageId),
      [POPULATION_COLUMNS.entryDate]: dateCell(row.entryDate),
      [POPULATION_COLUMNS.portType]: text(row.portType),
      [POPULATION_COLUMNS.portName]: text(row.portName),
      [POPULATION_COLUMNS.month]: { kind: "number", value: row.month },
      [POPULATION_COLUMNS.declarationNumber]: text(row.declarationNumber),
      [POPULATION_COLUMNS.declarationDate]: dateCell(row.declarationDate),
      [POPULATION_COLUMNS.plate]: text(row.plate),
      [POPULATION_COLUMNS.levelOne]: text(row.levelOne),
      [POPULATION_COLUMNS.levelTwo]: text(row.levelTwo),
    });
  }
  const samples = data.sampleRows.map((row): Record<string, CellInput> => {
    const captured = parseWallClock(row.entryDate);
    const studied = parseWallClock(row.studiedAt);
    return {
      [SAMPLE_COLUMNS.stage]: text(row.stageCode),
      [SAMPLE_COLUMNS.imageId]: text(row.xrayImageId),
      [SAMPLE_COLUMNS.portType]: text(row.portType),
      [SAMPLE_COLUMNS.portName]: text(row.portName),
      [SAMPLE_COLUMNS.entryDate]: dateCell(row.entryDate),
      [SAMPLE_COLUMNS.levelOne]: text(row.levelOne),
      [SAMPLE_COLUMNS.levelTwo]: text(row.levelTwo),
      [SAMPLE_COLUMNS.plate]: text(row.plate),
      [SAMPLE_COLUMNS.completion]: { kind: "text", value: "مكتمل" },
      [SAMPLE_COLUMNS.expert]: text(row.expert),
      [SAMPLE_COLUMNS.studiedAt]: dateCell(row.studiedAt),
      [SAMPLE_COLUMNS.hasImage]: yesNo(row.hasImage),
      [SAMPLE_COLUMNS.hasMarking]: yesNo(row.hasMarking),
      [SAMPLE_COLUMNS.imageQuality]: text(row.imageQuality),
      [SAMPLE_COLUMNS.lowQualityReason]: text(row.lowQualityReason),
      [SAMPLE_COLUMNS.resultValidity]: text(row.resultValidity),
      [SAMPLE_COLUMNS.suspicionLevel]: text(row.suspicionLevel),
      [SAMPLE_COLUMNS.suspectedTypes]: text(row.suspectedTypes),
      [SAMPLE_COLUMNS.smuggleMethod]: text(row.smuggleMethod),
      [SAMPLE_COLUMNS.inIndicator]: yesNo(row.inIndicator),
      // Calculated columns: these are only the values shown until Excel recalculates.
      [SAMPLE_COLUMNS.captureYear]: captured ? { kind: "number", value: captured.year } : null,
      [SAMPLE_COLUMNS.captureMonth]: captured ? { kind: "number", value: captured.month } : null,
      [SAMPLE_COLUMNS.studyMonth]: studied ? { kind: "number", value: studied.month } : null,
    };
  });
  return [
    ...baseline.populationTables.map((table, index) => ({ tableName: table.tableName, rows: byQuarter[index] })),
    { tableName: INDICATOR_SAMPLES_TABLE, rows: samples },
  ];
}
