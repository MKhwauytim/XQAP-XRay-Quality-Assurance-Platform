import { isRowStudied } from "../reporting/executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../reporting/executiveReportTypes";
import type { MappedWorkbookRow } from "./workbookColumnMap";
import { formatMonthFolderName, parseMonthFolderName } from "../population/monthFolder";

/** Month label carried by the comprehensive (all-months) report input. */
export const COMPREHENSIVE_MONTH_LABEL = "جميع_الأشهر";

export type MergeStats = {
  systemMonths: number;
  systemCompleted: number;
  workbookRead: number;
  duplicatesSkipped: number;
  workbookAdded: number;
  /** Workbook rows rejected because they are not completed samples (not submitted / no image). */
  workbookNotCompleted: number;
};

/**
 * Canonical month key: system folders keep their on-disk spelling (`5-May-2026`)
 * while workbook months are always lowercase (`5-may-2026`), so both are
 * re-formatted through the shared month-folder helpers (also folds `05-...`).
 * Unparseable labels fall back to trim + lowercase.
 */
export function normalizeMonthKey(month: string): string {
  const info = parseMonthFolderName(month.trim());
  return info ? formatMonthFolderName(info.month, info.year) : month.trim().toLowerCase();
}

/** The one "completed sample" predicate, shared by the page loader and the merge. */
export function isCompletedSampleRow(row: ExecutiveReportRow): boolean {
  return row.selectedInSample && isRowStudied(row);
}

const key = (id: string, month: string) => `${id}|${normalizeMonthKey(month)}`;

/** The only workspace-wide fields the combined input needs from a month's input. */
export type ComprehensiveBase = Pick<ExecutiveReportInput, "template" | "config" | "stageMappings">;

/**
 * Merge completed system rows with workbook rows. System wins on the same
 * `id|month`; the same id in a different month is kept. Ids repeated across
 * months get the `@month` suffix on later occurrences so rows never collapse.
 */
export function mergeCompletedRows(
  systemByMonth: Array<{ month: string; rows: ExecutiveReportRow[] }>,
  workbook: MappedWorkbookRow[],
): { rows: ExecutiveReportRow[]; stats: MergeStats } {
  const entries: Array<{ row: ExecutiveReportRow; month: string }> = [];
  const systemKeys = new Set<string>();
  for (const { month, rows } of systemByMonth) {
    for (const row of rows) {
      if (!isCompletedSampleRow(row)) continue;
      entries.push({ row, month });
      systemKeys.add(key(row.xrayImageId, month));
    }
  }
  const systemCompleted = entries.length;

  let duplicatesSkipped = 0;
  let workbookNotCompleted = 0;
  for (const w of workbook) {
    if (!isCompletedSampleRow(w.row)) {
      workbookNotCompleted++;
      continue;
    }
    if (systemKeys.has(key(w.row.xrayImageId, w.month))) {
      duplicatesSkipped++;
      continue;
    }
    entries.push({ row: w.row, month: w.month });
  }

  // Every id already present is "taken"; a later repeat gets `@month`, then
  // `@month#2`, `@month#3`... until unique, so a suffixed id can never collide.
  const taken = new Set(entries.map((e) => e.row.xrayImageId));
  const seen = new Set<string>();
  const rows = entries.map(({ row, month }) => {
    if (!seen.has(row.xrayImageId)) {
      seen.add(row.xrayImageId);
      return row;
    }
    const base = `${row.xrayImageId}@${month}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
    taken.add(id);
    seen.add(id);
    return { ...row, xrayImageId: id };
  });

  return {
    rows,
    stats: {
      systemMonths: systemByMonth.length,
      systemCompleted,
      workbookRead: workbook.length,
      duplicatesSkipped,
      workbookAdded: workbook.length - duplicatesSkipped - workbookNotCompleted,
      workbookNotCompleted,
    },
  };
}

/**
 * Only the workspace-wide fields (config, template, stageMappings) come from
 * `base`. Built field-by-field, never spread, so a per-month artefact
 * (processingSummary, sourceRevisions, distributionEvents, replacementReasons,
 * or any future one) cannot leak into an all-months report.
 */
export function buildComprehensiveInput(rows: ExecutiveReportRow[], base: ComprehensiveBase): ExecutiveReportInput {
  return {
    monthFolderName: COMPREHENSIVE_MONTH_LABEL,
    populationRows: [],
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: base.template,
    config: base.config,
    stageMappings: base.stageMappings,
    processingSummary: null,
    rowsOverride: rows,
  };
}
