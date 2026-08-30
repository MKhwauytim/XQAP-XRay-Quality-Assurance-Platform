import { useMemo, useState } from "react";
import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { getLabels, type LabelKey } from "../../../../data/labels/labelsStore";
import Pagination from "../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../utils/paginationUtils";
import { formatDateTime, formatDuration } from "./userManagementFormatters";
import {
  aggregateSamplesByDay,
  computeAllDailyPerformance,
  filterDailyPerformance,
  flattenGaps,
  minutesOfDay,
  summarizePerformance,
} from "../../../../data/performance/performanceMetrics";
import type {
  DailyPerformance,
  GapTier,
  PerformanceScopeFilter,
} from "../../../../data/performance/performanceTypes";
import { samplesTrendSvg, workingHoursStripSvg, type DayStrip } from "./performanceCharts";

const GAP_TIER_LABEL_KEYS: Record<GapTier, LabelKey> = {
  normal: "um_perf_gap_tier_normal",
  small: "um_perf_gap_tier_small",
  medium: "um_perf_gap_tier_medium",
  large: "um_perf_gap_tier_large",
  unclassified: "um_perf_gap_tier_unclassified",
};

function emptyScope(): PerformanceScopeFilter {
  return { employee: "", from: "", to: "" };
}

type EmployeeOption = { username: string; displayName: string; count: number };

function buildEmployeeOptions(
  users: readonly ManagedLoginUser[],
  daily: readonly DailyPerformance[]
): EmployeeOption[] {
  const counts = new Map<string, number>();
  for (const record of daily) {
    counts.set(record.employee, (counts.get(record.employee) ?? 0) + record.samplesFinished);
  }
  const names = new Map<string, string>();
  for (const user of users) {
    if (user.role === "employee" || user.role === "supervisor") names.set(user.username, user.displayName);
  }
  for (const username of counts.keys()) {
    if (!names.has(username)) names.set(username, username);
  }
  return [...names.entries()]
    .map(([username, displayName]) => ({ username, displayName, count: counts.get(username) ?? 0 }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
}

export function PerformanceSection(props: {
  users: ManagedLoginUser[];
  activityEntries: AuthActivityLogEntry[];
  actionEntries: WorkspaceActionEntry[];
  isLoading: boolean;
  hasWorkspace: boolean;
  onRefresh: () => void;
}) {
  const labels = getLabels();
  const [filter, setFilter] = useState<PerformanceScopeFilter>(emptyScope);

  const allDaily = useMemo(
    () => computeAllDailyPerformance(props.activityEntries, props.actionEntries),
    [props.activityEntries, props.actionEntries]
  );
  const filtered = useMemo(() => filterDailyPerformance(allDaily, filter), [allDaily, filter]);
  const summary = useMemo(() => summarizePerformance(filtered), [filtered]);
  const trendPoints = useMemo(() => aggregateSamplesByDay(filtered), [filtered]);
  const gaps = useMemo(() => flattenGaps(filtered), [filtered]);
  const gapsForDisplay = useMemo(() => [...gaps].reverse(), [gaps]);
  const employeeOptions = useMemo(() => buildEmployeeOptions(props.users, allDaily), [props.users, allDaily]);
  const totalSamples = useMemo(() => allDaily.reduce((sum, d) => sum + d.samplesFinished, 0), [allDaily]);

  const hourStripsSource: DailyPerformance[] = useMemo(() => {
    if (filter.employee === "") return [];
    return filtered.filter((d) => d.employee === filter.employee);
  }, [filtered, filter.employee]);

  const hourStrips: DayStrip[] = useMemo(
    () =>
      hourStripsSource.map((d) => ({
        day: d.day,
        signInMinute: d.signInAt ? minutesOfDay(d.signInAt) : null,
        lastFinishMinute: d.lastFinishAt ? minutesOfDay(d.lastFinishAt) : null,
        gapSegments: d.gaps.map((g) => ({
          startMinute: minutesOfDay(g.startAt),
          endMinute: minutesOfDay(g.endAt),
          tier: g.tier,
        })),
      })),
    [hourStripsSource]
  );

  const pageKey = `${filter.employee}:${filter.from}:${filter.to}`;
  const [pageState, setPageState] = useState<{ key: string; page: number }>(() => ({ key: pageKey, page: 1 }));
  const page = clampPage(pageState.key === pageKey ? pageState.page : 1, gaps.length);
  const pagedGaps = pageSlice(gapsForDisplay, page);

  const emptyMessage = !props.hasWorkspace
    ? labels.um_perf_no_workspace
    : allDaily.length === 0 || filtered.length === 0
      ? labels.um_perf_empty
      : null;

  return (
    <div className="um-section">
      <h3 className="um-add-form-title">{labels.um_perf_tab_label}</h3>
      <div className="um-matrix-desc">{labels.um_perf_desc}</div>
      <div className="um-activity-toolbar">
        <button type="button" className="um-add-btn" onClick={props.onRefresh}>{labels.um_perf_refresh_btn}</button>
        {props.isLoading && <span>{labels.um_perf_loading}</span>}
      </div>

      <div className="um-perf-filters" role="group" aria-label={labels.um_perf_filters_title}>
        <div className="um-perf-filter-row">
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_employee}</span>
            <select value={filter.employee} onChange={(e) => setFilter((f) => ({ ...f, employee: e.target.value }))}>
              <option value="">{labels.um_perf_filter_employee_all.replace("{count}", String(totalSamples))}</option>
              {employeeOptions.map((option) => (
                <option key={option.username} value={option.username}>
                  {`${option.displayName} (${option.count})`}
                </option>
              ))}
            </select>
          </label>
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_from}</span>
            <input type="date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
          </label>
          <label className="um-actions-filter-field">
            <span>{labels.um_perf_filter_to}</span>
            <input type="date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
          </label>
          <button type="button" className="um-actions-filter-reset" onClick={() => setFilter(emptyScope())}>{labels.um_perf_filter_reset}</button>
        </div>
      </div>

      {emptyMessage ? (
        <div className="um-empty">{emptyMessage}</div>
      ) : (
        <>
          <div className="um-perf-summary-grid">
            <article className="um-perf-card"><span>{labels.um_perf_summary_samples}</span><strong>{summary.totalSamples.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_effective}</span><strong>{summary.totalEffectiveMs === null ? "—" : formatDuration(summary.totalEffectiveMs)}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_pace}</span><strong>{summary.medianGapMs === null ? "—" : formatDuration(summary.medianGapMs)}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_normal}</span><strong>{summary.gapCountsByTier.normal.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_small}</span><strong>{summary.gapCountsByTier.small.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_medium}</span><strong>{summary.gapCountsByTier.medium.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
            <article className="um-perf-card"><span>{labels.um_perf_summary_gaps_large}</span><strong>{summary.gapCountsByTier.large.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
          </div>

          <div className="um-perf-chart">
            <h4>{labels.um_perf_trend_title}</h4>
            {trendPoints.length === 0 ? (
              <div className="um-empty">{labels.um_perf_trend_empty}</div>
            ) : (
              <>
                <div dir="ltr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: samplesTrendSvg(trendPoints, labels.um_perf_trend_empty) }} />
                <table className="um-perf-sr-only">
                  <caption>{labels.um_perf_trend_title}</caption>
                  <thead>
                    <tr>
                      <th>{labels.um_perf_gaps_col_day}</th>
                      <th>{labels.um_perf_summary_samples}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendPoints.map((p) => (
                      <tr key={p.day}>
                        <td>{p.day}</td>
                        <td>{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="um-perf-chart">
            <h4>{labels.um_perf_hours_title}</h4>
            {hourStrips.length === 0 ? (
              <div className="um-empty">{labels.um_perf_hours_empty}</div>
            ) : (
              <>
                <div dir="ltr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: workingHoursStripSvg(hourStrips, labels.um_perf_hours_empty) }} />
                <table className="um-perf-sr-only">
                  <caption>{labels.um_perf_hours_title}</caption>
                  <thead>
                    <tr>
                      <th>{labels.um_perf_gaps_col_day}</th>
                      <th>{labels.um_perf_hours_col_signin}</th>
                      <th>{labels.um_perf_hours_col_finish}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourStripsSource.map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td>{d.signInAt ? formatDateTime(d.signInAt) : "—"}</td>
                        <td>{d.lastFinishAt ? formatDateTime(d.lastFinishAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <h4>{labels.um_perf_gaps_title}</h4>
          {gaps.length === 0 ? (
            <div className="um-empty">{labels.um_perf_gaps_empty}</div>
          ) : (
            <>
              <div className="um-activity-table-wrap">
                <table className="um-activity-table">
                  <thead>
                    <tr>
                      <th>{labels.um_perf_gaps_col_employee}</th>
                      <th>{labels.um_perf_gaps_col_day}</th>
                      <th>{labels.um_perf_gaps_col_start}</th>
                      <th>{labels.um_perf_gaps_col_end}</th>
                      <th>{labels.um_perf_gaps_col_duration}</th>
                      <th>{labels.um_perf_gaps_col_tier}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGaps.map((gap, index) => (
                      <tr key={`${gap.employee}-${gap.startAt}-${index}`}>
                        <td>{gap.employee}</td>
                        <td>{gap.day}</td>
                        <td>{formatDateTime(gap.startAt)}</td>
                        <td>{formatDateTime(gap.endAt)}</td>
                        <td>{formatDuration(gap.durationMs)}</td>
                        <td>{labels[GAP_TIER_LABEL_KEYS[gap.tier]]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalItems={gaps.length} onPageChange={(nextPage) => setPageState({ key: pageKey, page: nextPage })} itemLabel="فجوة" />
            </>
          )}
        </>
      )}
    </div>
  );
}
