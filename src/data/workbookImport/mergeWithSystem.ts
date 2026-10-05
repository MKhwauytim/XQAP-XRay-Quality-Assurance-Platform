import { isRowStudied } from "../reporting/executiveReportTypes";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../reporting/executiveReportTypes";
import type { MappedWorkbookRow } from "./workbookColumnMap";

/** Month label carried by the comprehensive (all-months) report input. */
export const COMPREHENSIVE_MONTH_LABEL = "جميع_الأشهر";

export type MergeStats = {
  systemMonths: number;
  systemCompleted: number;
  workbookRead: number;
  duplicatesSkipped: number;
  workbookAdded: number;
};

const key = (id: string, month: string) => `${id}|${month}`;

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
      if (!row.selectedInSample || !isRowStudied(row)) continue;
      entries.push({ row, month });
      systemKeys.add(key(row.xrayImageId, month));
    }
  }
  const systemCompleted = entries.length;

  let duplicatesSkipped = 0;
  for (const w of workbook) {
    if (systemKeys.has(key(w.row.xrayImageId, w.month))) {
      duplicatesSkipped++;
      continue;
    }
    entries.push({ row: w.row, month: w.month });
  }

  const seen = new Set<string>();
  const rows = entries.map(({ row, month }) => {
    if (!seen.has(row.xrayImageId)) {
      seen.add(row.xrayImageId);
      return row;
    }
    return { ...row, xrayImageId: `${row.xrayImageId}@${month}` };
  });

  return {
    rows,
    stats: {
      systemMonths: systemByMonth.length,
      systemCompleted,
      workbookRead: workbook.length,
      duplicatesSkipped,
      workbookAdded: workbook.length - duplicatesSkipped,
    },
  };
}

/** `base` supplies config, template and stageMappings; rows replace the per-month sources. */
export function buildComprehensiveInput(rows: ExecutiveReportRow[], base: ExecutiveReportInput): ExecutiveReportInput {
  return {
    ...base,
    monthFolderName: COMPREHENSIVE_MONTH_LABEL,
    populationRows: [],
    sample: null,
    distribution: null,
    employeeFiles: [],
    rowsOverride: rows,
  };
}
