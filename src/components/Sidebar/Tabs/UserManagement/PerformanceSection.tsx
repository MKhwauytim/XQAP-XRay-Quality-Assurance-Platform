import { useMemo, useState } from "react";
import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { getLabels, type LabelKey } from "../../../../data/labels/labelsStore";
import Pagination from "../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../utils/paginationUtils";
import {
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatClock,
  formatMonthLabel,
  formatOneDecimal,
  formatShortDayLabel,
  formatTimeOfDay,
} from "./userManagementFormatters";
import {
  aggregateGapsByMonth,
  aggregateSamplesByDay,
  computeAllDailyPerformance,
  computeEmployeeComparison,
  filterDailyPerformance,
  flattenGaps,
  minutesOfDay,
} from "../../../../data/performance/performanceMetrics";
import {
  SHIFT_END_MINUTE,
  SHIFT_START_MINUTE,
  type DailyPerformance,
  type EmployeeStatusKind,
  type GapEvent,
  type GapTier,
  type PerformanceScopeFilter,
} from "../../../../data/performance/performanceTypes";
import { averageCount, gapsByMonthSvg, samplesTrendSvg, type MonthGapPoint } from "./performanceCharts";

const GAP_TIER_ORDER: readonly GapTier[] = ["normal", "small", "medium", "large", "unclassified"];

const GAP_TIER_LABEL_KEYS: Record<GapTier, LabelKey> = {
  normal: "um_perf_gap_tier_normal",
  small: "um_perf_gap_tier_small",
  medium: "um_perf_gap_tier_medium",
  large: "um_perf_gap_tier_large",
  unclassified: "um_perf_gap_tier_unclassified",
};

const GAP_TIER_LEGEND_LABEL_KEYS: Record<GapTier, LabelKey> = {
  normal: "um_perf_tier_legend_normal",
  small: "um_perf_tier_legend_small",
  medium: "um_perf_tier_legend_medium",
  large: "um_perf_tier_legend_large",
  unclassified: "um_perf_tier_legend_unclassified",
};

const STATUS_LABEL_KEYS: Record<EmployeeStatusKind, LabelKey> = {
  above: "um_perf_status_above",
  within: "um_perf_status_within",
  below: "um_perf_status_below",
};

// Fixed reference ticks for the working-hours axis — chosen round times
// within the shift window, not evenly-spaced quartiles of it.
const HOUR_TICK_MINUTES: readonly number[] = [SHIFT_START_MINUTE, 10 * 60 + 30, 13 * 60 + 30, SHIFT_END_MINUTE];
const SHIFT_SPAN_MINUTES = SHIFT_END_MINUTE - SHIFT_START_MINUTE;

function emptyScope(): PerformanceScopeFilter {
  return { employee: "", from: "", to: "" };
}

type EmployeeOption = { username: string; displayName: string; count: number };

/** Every known employee/supervisor username → display name, plus any username that only shows up in the data (e.g. a former employee). */
function buildEmployeeNameMap(
  users: readonly ManagedLoginUser[],
  daily: readonly DailyPerformance[]
): Map<string, string> {
  const names = new Map<string, string>();
  for (const user of users) {
    if (user.role === "employee" || user.role === "supervisor") names.set(user.username, user.displayName);
  }
  for (const record of daily) {
    if (!names.has(record.employee)) names.set(record.employee, record.employee);
  }
  return names;
}

function buildEmployeeOptions(
  employeeNames: ReadonlyMap<string, string>,
  daily: readonly DailyPerformance[]
): EmployeeOption[] {
  const counts = new Map<string, number>();
  for (const record of daily) {
    counts.set(record.employee, (counts.get(record.employee) ?? 0) + record.samplesFinished);
  }
  return [...employeeNames.entries()]
    .map(([username, displayName]) => ({ username, displayName, count: counts.get(username) ?? 0 }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
}

function positionPct(minute: number): number {
  const clamped = Math.max(SHIFT_START_MINUTE, Math.min(SHIFT_END_MINUTE, minute));
  return ((clamped - SHIFT_START_MINUTE) / SHIFT_SPAN_MINUTES) * 100;
}

type HourChartSegment = {
  key: string;
  tier: GapTier;
  leftPct: number;
  widthPct: number;
  rangeLabel: string;
  durationLabel: string;
};

type HourChartRow = { key: string; label: string; segments: HourChartSegment[] };

/**
 * Gap segments for one working-hours row, positioned against the fixed
 * 7:30–17:30 shift window. "normal" and "unclassified" gaps are never
 * drawn — a normal gap is expected pacing, and an unclassified one has no
 * reliable baseline to be flagged against, so neither should visually read
 * as an anomaly (mirrors the pre-rework workingHoursStripSvg convention).
 */
function buildHourSegments(gaps: readonly GapEvent[], includeDayInLabel: boolean): HourChartSegment[] {
  return gaps
    .filter((gap) => gap.tier !== "normal" && gap.tier !== "unclassified")
    .map((gap, index) => {
      const left = positionPct(minutesOfDay(gap.startAt));
      const width = Math.max(0.6, positionPct(minutesOfDay(gap.endAt)) - left);
      const timeRange = `${formatTimeOfDay(gap.startAt)}–${formatTimeOfDay(gap.endAt)}`;
      return {
        key: `${gap.employee}-${gap.startAt}-${index}`,
        tier: gap.tier,
        leftPct: left,
        widthPct: width,
        rangeLabel: includeDayInLabel ? `${formatShortDayLabel(gap.day)} · ${timeRange}` : timeRange,
        durationLabel: formatDuration(gap.durationMs),
      };
    });
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
  const trendPoints = useMemo(() => aggregateSamplesByDay(filtered), [filtered]);
  const gaps = useMemo(() => flattenGaps(filtered), [filtered]);
  const gapsForDisplay = useMemo(() => [...gaps].reverse(), [gaps]);
  const employeeNames = useMemo(() => buildEmployeeNameMap(props.users, allDaily), [props.users, allDaily]);
  const employeeOptions = useMemo(() => buildEmployeeOptions(employeeNames, allDaily), [employeeNames, allDaily]);
  const totalSamples = useMemo(() => allDaily.reduce((sum, d) => sum + d.samplesFinished, 0), [allDaily]);

  // The comparison table (and the team-mode hours chart) is scoped only to
  // the shared date range, never to the employee dropdown — selecting one
  // employee there should not collapse the comparison away.
  const dateOnlyFiltered = useMemo(
    () => filterDailyPerformance(allDaily, { employee: "", from: filter.from, to: filter.to }),
    [allDaily, filter.from, filter.to]
  );
  const comparison = useMemo(
    () => computeEmployeeComparison(dateOnlyFiltered, employeeNames),
    [dateOnlyFiltered, employeeNames]
  );
  // Notable-gap duration per calendar month, across every employee in the
  // shared date range — the team view's working-hours chart. A bar per
  // month stays readable regardless of how many days a month accumulates,
  // unlike the old one-row-per-(employee, day) rendering it replaces.
  const monthGapPoints: MonthGapPoint[] = useMemo(() => {
    const months = aggregateGapsByMonth(flattenGaps(dateOnlyFiltered));
    return months.map((m) => ({
      label: formatMonthLabel(m.month),
      durationMsByTier: m.durationMsByTier,
      totalDurationMs: m.totalDurationMs,
    }));
  }, [dateOnlyFiltered]);

  const trendAvg = useMemo(() => averageCount(trendPoints), [trendPoints]);
  const selectedDisplayName = filter.employee !== "" ? (employeeNames.get(filter.employee) ?? filter.employee) : "";
  const trendScopeLabel =
    filter.employee === ""
      ? labels.um_perf_trend_scope_team
      : labels.um_perf_trend_scope_employee.replace("{name}", selectedDisplayName);
  const hoursScopeLabel =
    filter.employee === ""
      ? labels.um_perf_hours_scope_team
      : labels.um_perf_hours_scope_employee.replace("{name}", selectedDisplayName);

  // Per-day working-hours rows — only rendered when one employee is
  // selected, where a month's worth of rows stays readable.
  const hourRows: HourChartRow[] = useMemo(() => {
    if (filter.employee === "") return [];
    return filtered
      .filter((record) => record.employee === filter.employee)
      .map((record) => ({
        key: record.day,
        label: formatShortDayLabel(record.day),
        segments: buildHourSegments(record.gaps, false),
      }));
  }, [filter.employee, filtered]);

  const rangeLabel =
    filter.from || filter.to
      ? `${filter.from || labels.um_perf_range_start_fallback} → ${filter.to || labels.um_perf_range_end_fallback}`
      : labels.um_perf_range_full;

  const pageKey = `${filter.employee}:${filter.from}:${filter.to}`;
  const [pageState, setPageState] = useState<{ key: string; page: number }>(() => ({ key: pageKey, page: 1 }));
  const page = clampPage(pageState.key === pageKey ? pageState.page : 1, gaps.length);
  const pagedGaps = pageSlice(gapsForDisplay, page);

  const emptyMessage = !props.hasWorkspace
    ? labels.um_perf_no_workspace
    : allDaily.length === 0 || dateOnlyFiltered.length === 0
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
          <span className="um-perf-range-label">{labels.um_perf_range_label.replace("{range}", rangeLabel)}</span>
        </div>
      </div>

      {emptyMessage ? (
        <div className="um-empty">{emptyMessage}</div>
      ) : (
        <>
          <div className="um-perf-compare">
            <div className="um-perf-compare-head">
              <h4>{labels.um_perf_compare_title}</h4>
              <span className="um-perf-compare-meta">
                {labels.um_perf_compare_team_avg.replace("{avg}", String(comparison.teamAvgSamples))}
                {" · "}
                {labels.um_perf_compare_team_pace.replace(
                  "{pace}",
                  comparison.teamMedianPaceMs === null ? "—" : formatDuration(comparison.teamMedianPaceMs)
                )}
              </span>
            </div>

            {comparison.rows.length === 0 ? (
              <div className="um-empty">{labels.um_perf_compare_empty}</div>
            ) : (
              <>
                <div className="um-activity-table-wrap">
                  <table className="um-activity-table um-perf-compare-table">
                    <thead>
                      <tr>
                        <th>{labels.um_perf_compare_col_rank}</th>
                        <th>{labels.um_perf_gaps_col_employee}</th>
                        <th>{labels.um_perf_summary_samples}</th>
                        <th>{labels.um_perf_summary_effective}</th>
                        <th>{labels.um_perf_summary_pace}</th>
                        <th>{labels.um_perf_compare_col_gaps}</th>
                        <th>{labels.um_perf_compare_col_status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((row) => (
                        <tr
                          key={row.username}
                          className={filter.employee === row.username ? "um-perf-compare-row is-selected" : "um-perf-compare-row"}
                          onClick={() => setFilter((f) => ({ ...f, employee: row.username }))}
                        >
                          <td>{row.rank}</td>
                          <td>
                            <strong>{row.displayName}</strong>
                            <span>
                              {labels.um_perf_compare_last_active.replace(
                                "{day}",
                                row.lastActiveDay ? formatDayLabel(row.lastActiveDay) : "—"
                              )}
                            </span>
                          </td>
                          <td>{row.samples}</td>
                          <td>{row.effectiveMs === null ? "—" : formatDuration(row.effectiveMs)}</td>
                          <td>{row.paceMs === null ? "—" : formatDuration(row.paceMs)}</td>
                          <td>
                            <div className="um-perf-gap-bar">
                              <span className="um-perf-gap-seg um-perf-gap-seg--normal" style={{ width: `${row.gapPercents.normal}%` }} />
                              <span className="um-perf-gap-seg um-perf-gap-seg--small" style={{ width: `${row.gapPercents.small}%` }} />
                              <span className="um-perf-gap-seg um-perf-gap-seg--medium" style={{ width: `${row.gapPercents.medium}%` }} />
                              <span className="um-perf-gap-seg um-perf-gap-seg--large" style={{ width: `${row.gapPercents.large}%` }} />
                            </div>
                            <div className="um-perf-gap-caption">
                              {labels.um_perf_compare_gap_caption
                                .replace("{count}", String(row.gapCounts.medium + row.gapCounts.large))
                                .replace("{total}", String(row.totalGaps))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`um-perf-status-chip um-perf-status-chip--${row.hasFrequentLargeGaps ? "warning" : row.statusKind}`}
                            >
                              {labels[STATUS_LABEL_KEYS[row.statusKind]]}
                              {row.hasFrequentLargeGaps ? ` · ${labels.um_perf_status_frequent_large_suffix}` : ""}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="um-perf-legend">
                  {(["normal", "small", "medium", "large"] as const).map((tier) => (
                    <span className="um-perf-legend-item" key={tier}>
                      <span className={`um-perf-legend-dot um-perf-legend-dot--${tier}`} /> {labels[GAP_TIER_LABEL_KEYS[tier]]}
                    </span>
                  ))}
                  <span className="um-perf-legend-note">{labels.um_perf_compare_legend_note}</span>
                </div>
              </>
            )}
          </div>

          <div className="um-perf-charts-grid">
            <div className="um-perf-chart um-perf-chart--trend">
              <div className="um-perf-trend-head">
                <div>
                  <h4>{labels.um_perf_trend_title}</h4>
                  <p className="um-perf-chart-sub">{trendScopeLabel}</p>
                </div>
                <span className="um-perf-trend-avg-badge">
                  {labels.um_perf_trend_avg_label.replace("{avg}", formatOneDecimal(trendAvg))}
                </span>
              </div>
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

            <div className="um-perf-chart um-perf-chart--hours">
              <div>
                <h4>{labels.um_perf_hours_title}</h4>
                <p className="um-perf-chart-sub">{hoursScopeLabel}</p>
              </div>
              {filter.employee === "" ? (
                monthGapPoints.length === 0 ? (
                  <div className="um-empty">{labels.um_perf_hours_empty}</div>
                ) : (
                  <>
                    <div dir="ltr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: gapsByMonthSvg(monthGapPoints, labels.um_perf_hours_empty) }} />
                    <div className="um-perf-legend">
                      {(["small", "medium", "large"] as const).map((tier) => (
                        <span className="um-perf-legend-item" key={tier}>
                          <span className={`um-perf-legend-dot um-perf-legend-dot--${tier}`} /> {labels[GAP_TIER_LABEL_KEYS[tier]]}
                        </span>
                      ))}
                    </div>
                    <table className="um-perf-sr-only">
                      <caption>{labels.um_perf_hours_title}</caption>
                      <thead>
                        <tr>
                          <th>{labels.um_perf_hours_col_month}</th>
                          <th>{labels[GAP_TIER_LABEL_KEYS.small]}</th>
                          <th>{labels[GAP_TIER_LABEL_KEYS.medium]}</th>
                          <th>{labels[GAP_TIER_LABEL_KEYS.large]}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthGapPoints.map((point) => (
                          <tr key={point.label}>
                            <td>{point.label}</td>
                            <td>{formatDuration(point.durationMsByTier.small)}</td>
                            <td>{formatDuration(point.durationMsByTier.medium)}</td>
                            <td>{formatDuration(point.durationMsByTier.large)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )
              ) : hourRows.length === 0 ? (
                <div className="um-empty">{labels.um_perf_hours_empty}</div>
              ) : (
                <div className="um-perf-hours-body">
                  <div className="um-perf-hour-ticks" aria-hidden="true">
                    <span className="um-perf-hour-row-label-spacer" />
                    <div className="um-perf-hour-ticks-row" dir="ltr">
                      {HOUR_TICK_MINUTES.map((minute) => (
                        <span key={minute}>{formatClock(minute)}</span>
                      ))}
                    </div>
                  </div>
                  {hourRows.map((row) => (
                    <div className="um-perf-hour-row-block" key={row.key}>
                      <div className="um-perf-hour-row">
                        <span className="um-perf-hour-row-label">{row.label}</span>
                        <div className="um-perf-hour-track" dir="ltr" aria-hidden="true">
                          <div className="um-perf-hour-track-base" />
                          {row.segments.map((seg) => (
                            <div
                              key={seg.key}
                              className={`um-perf-hour-seg um-perf-hour-seg--${seg.tier}`}
                              style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                              title={seg.rangeLabel}
                            />
                          ))}
                        </div>
                      </div>
                      {row.segments.length > 0 && (
                        <div className="um-perf-hour-chips">
                          {row.segments.map((seg) => (
                            <span className={`um-perf-hour-chip um-perf-hour-chip--${seg.tier}`} key={seg.key}>
                              <span className="um-perf-hour-chip-dot" />
                              <span dir="ltr">{seg.rangeLabel}</span> · {seg.durationLabel}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="um-perf-legend">
                    <span className="um-perf-legend-item">
                      <span className="um-perf-legend-dot um-perf-legend-dot--shift" /> {labels.um_perf_hours_shift_legend}
                    </span>
                    {(["small", "medium", "large"] as const).map((tier) => (
                      <span className="um-perf-legend-item" key={tier}>
                        <span className={`um-perf-legend-dot um-perf-legend-dot--${tier}`} /> {labels[GAP_TIER_LABEL_KEYS[tier]]}
                      </span>
                    ))}
                  </div>
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
                      {filtered.filter((d) => d.employee === filter.employee).map((d) => (
                        <tr key={`${d.employee}-${d.day}`}>
                          <td>{d.day}</td>
                          <td>{d.signInAt ? formatDateTime(d.signInAt) : "—"}</td>
                          <td>{d.lastFinishAt ? formatDateTime(d.lastFinishAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="um-perf-gaps">
            <h4>{labels.um_perf_gaps_title}</h4>
            <p className="um-perf-chart-sub">{labels.um_perf_gaps_desc}</p>
            <div className="um-perf-tier-legend">
              {GAP_TIER_ORDER.map((tier) => (
                <span className={`um-perf-tier-legend-item um-perf-tier-legend-item--${tier}`} key={tier}>
                  <span className="um-perf-legend-dot" /> {labels[GAP_TIER_LEGEND_LABEL_KEYS[tier]]}
                </span>
              ))}
            </div>
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
                          <td>{employeeNames.get(gap.employee) ?? gap.employee}</td>
                          <td>{formatDayLabel(gap.day)}</td>
                          <td>{formatTimeOfDay(gap.startAt)}</td>
                          <td>{formatTimeOfDay(gap.endAt)}</td>
                          <td>{formatDuration(gap.durationMs)}</td>
                          <td>
                            <span className={`um-perf-tier-badge um-perf-tier-badge--${gap.tier}`}>
                              {labels[GAP_TIER_LABEL_KEYS[gap.tier]]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} totalItems={gaps.length} onPageChange={(nextPage) => setPageState({ key: pageKey, page: nextPage })} itemLabel="فجوة" />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
