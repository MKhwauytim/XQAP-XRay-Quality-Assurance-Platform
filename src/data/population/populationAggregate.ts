/**
 * Persisted month aggregate (owner requirement, 2026-08-07): once a month's
 * population has been processed, the Population tab must be renderable for
 * that month WITHOUT reading `population.final.json` / `risk.raw.json` /
 * `bi.raw.json` again -- especially once the month is LOCKED (see
 * `monthLock.ts`). This module owns the small, row-count-independent summary
 * file (`population.aggregate.json`, sibling to `processing.summary.json` in
 * `2-processed/`) that makes that possible.
 *
 * Field set: `ProcessingSummary` already carries every processing-time figure
 * the Population tab displays for an already-processed month (see
 * `PopulationProcessingReport.tsx` -- every `<SummaryCard>`/detail card reads
 * straight off `ProcessingSummary`, already persisted verbatim in
 * `processing.summary.json`). The ONE thing that isn't already there is the
 * "معاينة المجتمع النهائي" 10-row preview table, which reads real
 * `PreparedPopulationRow`s -- so this aggregate adds exactly that, projected
 * down to the handful of fields the preview table renders (mirrors the
 * `EMPLOYEE_MIRROR_STUB_FIELDS` precedent in `populationTypes.ts`).
 *
 * Stored on the WORKSPACE disk (not IndexedDB): an aggregate computed by one
 * admin's browser must be visible to every other user who opens this month,
 * not just recomputed locally per machine. See `populationStorage.ts`'s
 * `saveMonthRunLocked` for the (best-effort, non-fatal) write, and
 * `loadMonthForEditing` for the locked-month read path that uses this instead
 * of the row files.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import type { PreparedPopulationRow, ProcessingSummary } from "./populationTypes";

const AGGREGATE_FILE = "population.aggregate.json";
const AGGREGATE_SCHEMA_VERSION = 1;
const PREVIEW_ROW_COUNT = 10;

/**
 * The subset of `PreparedPopulationRow` fields the Population tab's Phase-2
 * "معاينة المجتمع النهائي" preview table actually renders -- read directly
 * from `PopulationProcessingReport.tsx`'s JSX (`row.xrayImageId`,
 * `row.portName`, `row.stage`, `row.xrayLevelOneResult`,
 * `row.xrayLevelTwoResult`, `row.certScanStatus`; `row.sourceRowNumber` is
 * also included because the table's React `key` is
 * `${row.xrayImageId}-${row.sourceRowNumber}`). Enforced mechanically by
 * `populationAggregate.contract.test.ts`, which scans that component's source
 * for `row.<field>` accesses -- same pattern as `EMPLOYEE_MIRROR_STUB_FIELDS`.
 */
export const POPULATION_AGGREGATE_PREVIEW_FIELDS = [
  "xrayImageId",
  "portName",
  "stage",
  "xrayLevelOneResult",
  "xrayLevelTwoResult",
  "certScanStatus",
  "sourceRowNumber",
] as const satisfies readonly (keyof PreparedPopulationRow)[];

export type PopulationAggregatePreviewField = (typeof POPULATION_AGGREGATE_PREVIEW_FIELDS)[number];
export type PopulationAggregatePreviewRow = Pick<PreparedPopulationRow, PopulationAggregatePreviewField>;

export type PopulationAggregate = {
  schemaVersion: number;
  monthFolderName: string;
  computedAt: string;
  computedBy: string;
  /** Byte-identical to what `processing.summary.json` already persists -- kept
   *  here too so the locked-month read path is a single file read. */
  summary: ProcessingSummary;
  /** First `PREVIEW_ROW_COUNT` prepared rows, projected to preview fields. */
  previewRows: PopulationAggregatePreviewRow[];
};

function toPreviewRow(row: PreparedPopulationRow): PopulationAggregatePreviewRow {
  const stub = {} as PopulationAggregatePreviewRow;
  for (const field of POPULATION_AGGREGATE_PREVIEW_FIELDS) {
    (stub as Record<PopulationAggregatePreviewField, unknown>)[field] = row[field];
  }
  return stub;
}

export function buildPopulationAggregate(params: {
  monthFolderName: string;
  computedBy: string;
  summary: ProcessingSummary;
  preparedRows: PreparedPopulationRow[];
}): PopulationAggregate {
  return {
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
    monthFolderName: params.monthFolderName,
    computedAt: new Date().toISOString(),
    computedBy: params.computedBy,
    summary: params.summary,
    previewRows: params.preparedRows.slice(0, PREVIEW_ROW_COUNT).map(toPreviewRow),
  };
}

/**
 * Best-effort write -- must never fail or block a population save (same
 * contract as the replacement-index rebuild in `populationStorage.ts`). A
 * failure here degrades to the "missing aggregate" recovery path on next
 * read, it never sinks `saveMonthRun`.
 */
export async function savePopulationAggregate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  aggregate: PopulationAggregate
): Promise<void> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, true);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
    await safeWriteJson(processedDir, AGGREGATE_FILE, aggregate);
  } catch (error) {
    logError("population:save-aggregate", error);
  }
}

export type PopulationAggregateLoadResult =
  | { status: "ok"; aggregate: PopulationAggregate }
  | { status: "missing" }
  | { status: "corrupt" };

function isValidAggregate(value: unknown): value is PopulationAggregate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PopulationAggregate>;
  return (
    typeof candidate.schemaVersion === "number" &&
    typeof candidate.summary === "object" &&
    candidate.summary !== null &&
    Array.isArray(candidate.previewRows)
  );
}

/**
 * Reads `population.aggregate.json` only -- never touches
 * `population.final.json` / `risk.raw.json` / `bi.raw.json`. Distinguishes a
 * missing aggregate (never computed, or an older month predating this
 * feature) from a corrupt one (present but structurally invalid) so the
 * caller can surface a specific recovery message rather than silently
 * falling back to reading rows (owner requirement: no silent fallback).
 */
export async function loadPopulationAggregate(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<PopulationAggregateLoadResult> {
  try {
    const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
    const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: false });
    const result = await safeReadJson<PopulationAggregate>(processedDir, AGGREGATE_FILE);
    if (!result.ok) {
      return result.reason === "corrupt" ? { status: "corrupt" } : { status: "missing" };
    }
    if (!isValidAggregate(result.value)) return { status: "corrupt" };
    return { status: "ok", aggregate: result.value };
  } catch {
    return { status: "missing" };
  }
}
