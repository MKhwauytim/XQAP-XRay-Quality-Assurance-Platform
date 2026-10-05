import type { MergeStats } from "../../../../../data/workbookImport/mergeWithSystem";
import type { MappingReport } from "../../../../../data/workbookImport/workbookColumnMap";
import type { Labels } from "../../../../../data/labels/labelsStore";

interface StatsPanelProps {
  labels: Labels;
  stats: MergeStats;
  totalRows: number;
  report: MappingReport | null;
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="ce-stat">
      <dt className="ce-stat-label">{label}</dt>
      <dd className="ce-stat-value" data-testid={testId}>{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

/** Merge statistics, the workbook mapping counters, and the unknown-values table. */
export function StatsPanel({ labels, stats, totalRows, report }: StatsPanelProps) {
  const unmapped: Array<{ column: string; value: string; count: number }> = [];
  if (report) {
    for (const [column, values] of Object.entries(report.unmappedValues)) {
      for (const [value, count] of Object.entries(values)) unmapped.push({ column, value, count });
    }
  }
  return (
    <section className="ce-card" aria-label={labels.ce_stats_title}>
      <h2 className="ce-card-title">{labels.ce_stats_title}</h2>
      <dl className="ce-stats">
        <Stat label={labels.ce_stat_system_months} value={stats.systemMonths} testId="ce-stat-system-months" />
        <Stat label={labels.ce_stat_system_completed} value={stats.systemCompleted} testId="ce-stat-system-completed" />
        <Stat label={labels.ce_stat_wb_read} value={stats.workbookRead} testId="ce-stat-wb-read" />
        {report && <Stat label={labels.ce_stat_wb_incomplete} value={report.incomplete} testId="ce-stat-wb-incomplete" />}
        <Stat label={labels.ce_stat_dup_skipped} value={stats.duplicatesSkipped} testId="ce-stat-dup-skipped" />
        <Stat label={labels.ce_stat_wb_not_completed} value={stats.workbookNotCompleted} testId="ce-stat-wb-not-completed" />
        <Stat label={labels.ce_stat_wb_added} value={stats.workbookAdded} testId="ce-stat-wb-added" />
        {report && <Stat label={labels.ce_stat_skipped_no_id} value={report.skippedNoId} testId="ce-stat-skipped-no-id" />}
        {report && <Stat label={labels.ce_stat_skipped_no_month} value={report.skippedNoMonth} testId="ce-stat-skipped-no-month" />}
        {report && <Stat label={labels.ce_stat_skipped_bad_result} value={report.skippedBadResult} testId="ce-stat-skipped-bad-result" />}
        <Stat label={labels.ce_stat_total_rows} value={totalRows} testId="ce-stat-total-rows" />
      </dl>
      {unmapped.length > 0 && (
        <div className="ce-unmapped">
          <h3 className="ce-card-subtitle">{labels.ce_unmapped_title}</h3>
          <table className="ce-table">
            <thead>
              <tr>
                <th>{labels.ce_unmapped_col_column}</th>
                <th>{labels.ce_unmapped_col_value}</th>
                <th>{labels.ce_unmapped_col_count}</th>
              </tr>
            </thead>
            <tbody>
              {unmapped.map((u) => (
                <tr key={`${u.column}|${u.value}`}>
                  <td>{u.column}</td>
                  <td>{u.value}</td>
                  <td>{u.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
