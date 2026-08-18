import { useMemo, useState, type ReactElement } from "react";
import { BarChart2, Download, FileText, Settings2 } from "lucide-react";

import { useLabels } from "../../../../data/labels/useLabels";
import type { Labels } from "../../../../data/labels/labelsStore";
import type { ReportModel } from "../../../../data/reporting/executive/model/reportModel";
import type { KeyedAccuracy } from "../../../../data/reporting/executive/model/aggregates";
import ReviewerKpiPanel from "./ReviewerKpiPanel";
import {
  buildAnswerGroups,
  buildInaccuracyCalendar,
  buildReviewerStatuses,
  buildSampleProgress,
  fmtCount,
  fmtPct,
} from "./kpiSelectors";
import {
  gaugeSvg,
  inaccuracyCalendarSvg,
  outcomeDonutSvg,
  portMatrixSvg,
} from "./kpiCharts";
import "./KpiDashboard.css";

/*
 * مؤشرات الأداء — the department manager's KPI dashboard (2026-08 design
 * handoff rework of the Reports tab's "kpi" sub-section).
 *
 * Every figure on this screen reads from the real `ReportModel` produced by
 * `buildReportModel`; nothing here recomputes report math and nothing is
 * synthesised. Honesty discipline is inherited wholesale: a null denominator
 * renders «—» via `fmtPct`, never 0%.
 */

export type KpiSection = "overview" | "ports" | "reviewers";
export type ExportKind = "document" | "deck" | "xlsx";

type Props = {
  model: ReportModel;
  /** Short Arabic month label for the header pill. */
  monthLabel: string;
  resolveName: (username: string) => string;
  exporting: ExportKind | null;
  canExportReports: boolean;
  isAdmin: boolean;
  /** Explanation for a disabled export control; `undefined` when enabled. */
  exportDisabledTitle: string | undefined;
  exportsDisabled: boolean;
  onExport: (kind: ExportKind) => void;
  onOpenCustomizer: () => void;
};

const SOURCE_LABEL_KEYS = {
  levelOne: "kpi_source_levelOne",
  levelTwo: "kpi_source_levelTwo",
  manual: "kpi_source_manual",
  opposite: "kpi_source_opposite",
  liveMeans: "kpi_source_liveMeans",
  review: "kpi_source_review",
} as const;

const BAND_LABEL_KEYS = {
  none: "kpi_band_none",
  insufficient: "kpi_band_insufficient",
  limited: "kpi_band_limited",
  sufficient: "kpi_band_sufficient",
} as const;

function sourceLabel(source: string, labels: Labels): string {
  const key = SOURCE_LABEL_KEYS[source as keyof typeof SOURCE_LABEL_KEYS];
  return key ? labels[key] : source;
}

function bandLabel(band: string, labels: Labels): string {
  const key = BAND_LABEL_KEYS[band as keyof typeof BAND_LABEL_KEYS];
  return key ? labels[key] : band;
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [token, value]) => text.split(`{${token}}`).join(value),
    template
  );
}

/** Bar width for a possibly-null rate — a null rate draws no bar at all. */
function barWidth(rate: number | null | undefined): string {
  return rate == null || !Number.isFinite(rate)
    ? "0%"
    : `${Math.max(0, Math.min(100, rate))}%`;
}

/** Port bar tone: ≥85 sky · ≥80 amber · below that coral (design brief §6). */
function portTone(accuracy: number | null): "sky" | "amber" | "coral" {
  if (accuracy == null || !Number.isFinite(accuracy)) return "coral";
  return accuracy >= 85 ? "sky" : accuracy >= 80 ? "amber" : "coral";
}

function Chart({ svg, className }: { svg: string; className?: string }): ReactElement {
  return (
    <div
      className={`kpi-chart${className ? ` ${className}` : ""}`}
      dir="ltr"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function KpiDashboard(props: Props): ReactElement {
  const {
    model,
    monthLabel,
    resolveName,
    exporting,
    canExportReports,
    isAdmin,
    exportDisabledTitle,
    exportsDisabled,
    onExport,
    onOpenCustomizer,
  } = props;
  const labels = useLabels();
  const [section, setSection] = useState<KpiSection>("overview");
  const [selectedPortKey, setSelectedPortKey] = useState<string | null>(null);

  const summary = model.summary;
  const totals = model.errorAnalysis.totals;
  const dq = model.dataQuality;

  const progress = useMemo(() => buildSampleProgress(model), [model]);
  const answers = useMemo(
    () => buildAnswerGroups(model, resolveName, labels.kpi_unknown_key),
    [model, resolveName, labels.kpi_unknown_key]
  );
  const statuses = useMemo(() => buildReviewerStatuses(model), [model]);
  const calendar = useMemo(() => buildInaccuracyCalendar(model), [model]);

  // Ports, best first — the design's default selection is the best port.
  const ports = useMemo<KeyedAccuracy[]>(
    () =>
      model.portAccuracy
        .filter((port) => port.evaluable > 0)
        .slice()
        .sort((a, b) => (b.accuracyByDecision ?? 0) - (a.accuracyByDecision ?? 0)),
    [model.portAccuracy]
  );
  const selectedPort =
    ports.find((port) => port.key === selectedPortKey) ?? ports[0] ?? null;

  // Agreement bars, strongest first. Sources with no comparable image are
  // dropped rather than drawn at 0% (honesty discipline).
  const agreement = useMemo(
    () =>
      model.resultComparison.reviewerAgreement
        .filter((row) => row.comparable > 0 && row.agreementRate != null)
        .slice()
        .sort((a, b) => (b.agreementRate ?? 0) - (a.agreementRate ?? 0)),
    [model.resultComparison.reviewerAgreement]
  );

  // «اتفاق المستويين مع المرجع» — the comparable-weighted mean of the L1 and L2
  // agreement rows. Null (renders «—») when neither level has a comparable image.
  const levelAgreement = useMemo(() => {
    let weighted = 0;
    let comparable = 0;
    for (const row of model.resultComparison.reviewerAgreement) {
      if (row.source !== "levelOne" && row.source !== "levelTwo") continue;
      if (row.comparable <= 0 || row.agreementRate == null) continue;
      weighted += row.agreementRate * row.comparable;
      comparable += row.comparable;
    }
    return comparable > 0 ? weighted / comparable : null;
  }, [model.resultComparison.reviewerAgreement]);

  const reviewerSuspicious = totals.correctSuspicion + totals.missedSuspicion;

  const outcomeSlices = [
    { label: labels.kpi_outcome_correct_clean, value: totals.correctClean },
    { label: labels.kpi_outcome_correct_suspicion, value: totals.correctSuspicion },
    { label: labels.kpi_outcome_missed, value: totals.missedSuspicion },
    { label: labels.kpi_outcome_false, value: totals.falseSuspicion },
  ];

  const weekdays = [
    labels.kpi_calendar_weekday_sat,
    labels.kpi_calendar_weekday_sun,
    labels.kpi_calendar_weekday_mon,
    labels.kpi_calendar_weekday_tue,
    labels.kpi_calendar_weekday_wed,
    labels.kpi_calendar_weekday_thu,
    labels.kpi_calendar_weekday_fri,
  ];

  const calendarMonthLabel = calendar
    ? `${labels[`kpi_cal_month_${calendar.month}` as keyof Labels]} ${fmtCount(calendar.year)}`
    : "";

  const exportBusy = exporting !== null;

  function renderTab(id: KpiSection, text: string): ReactElement {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={section === id}
        className={`kpi-tab${section === id ? " active" : ""}`}
        onClick={() => setSection(id)}
      >
        {text}
      </button>
    );
  }

  return (
    <div className="kpi-dash" dir="rtl">
      {/* ── Top line: month + data quality, and the export actions ────────── */}
      <div className="kpi-topline">
        <div className="kpi-topline-meta">
          <span className="kpi-month-pill">{monthLabel}</span>
          <span className={`kpi-dq-chip kpi-dq-${dq.overallBand}`}>
            <span className="kpi-dq-dot" />
            {fill(labels.kpi_dq_chip, {
              band: bandLabel(dq.overallBand, labels),
              n: fmtCount(dq.evaluableDecisionRecords),
            })}
          </span>
        </div>
        <div className="kpi-actions" role="group" aria-label={labels.kpi_exports_aria}>
          <button
            type="button"
            className="kpi-btn kpi-btn-sky"
            disabled={exportBusy || exportsDisabled || !canExportReports}
            title={exportDisabledTitle}
            aria-label={labels.kpi_export_document_aria}
            onClick={() => onExport("document")}
          >
            {exporting === "document" ? <span className="kpi-spinner" /> : <FileText size={14} strokeWidth={2} />}
            {labels.kpi_export_document}
          </button>
          <button
            type="button"
            className="kpi-btn kpi-btn-navy"
            disabled={exportBusy || exportsDisabled || !canExportReports}
            title={exportDisabledTitle}
            aria-label={labels.kpi_export_deck_aria}
            onClick={() => onExport("deck")}
          >
            {exporting === "deck" ? <span className="kpi-spinner" /> : <BarChart2 size={14} strokeWidth={2} />}
            {labels.kpi_export_deck}
          </button>
          <button
            type="button"
            className="kpi-btn kpi-btn-plain"
            disabled={exportBusy || exportsDisabled || !canExportReports}
            title={exportDisabledTitle}
            aria-label={labels.kpi_export_xlsx_aria}
            onClick={() => onExport("xlsx")}
          >
            {exporting === "xlsx" ? <span className="kpi-spinner" /> : <Download size={14} strokeWidth={2} />}
            {labels.kpi_export_xlsx}
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="kpi-btn kpi-btn-plain"
              disabled={exportBusy || exportsDisabled || !canExportReports}
              title={labels.kpi_export_customize_title}
              onClick={onOpenCustomizer}
            >
              <Settings2 size={14} strokeWidth={2} />
              {labels.kpi_export_customize}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── 2. Headline KPI cards ─────────────────────────────────────────── */}
      <div className="kpi-cards">
        <article className="kpi-card">
          <span className="kpi-card-accent kpi-accent-sky" />
          <span className="kpi-card-label">{labels.kpi_card_accuracy}</span>
          <strong className="kpi-card-value">{fmtPct(summary.overallAccuracy)}</strong>
          <span className="kpi-card-bar">
            <span
              className="kpi-card-bar-fill kpi-fill-sky"
              style={{ width: barWidth(summary.overallAccuracy) }}
            />
          </span>
          <span className="kpi-card-note">
            {fill(labels.kpi_card_accuracy_note, { n: fmtCount(dq.evaluableDecisionRecords) })}
          </span>
        </article>

        <article className="kpi-card">
          <span className="kpi-card-accent kpi-accent-teal" />
          <span className="kpi-card-label">{labels.kpi_card_detection}</span>
          <strong className="kpi-card-value">{fmtPct(summary.detectionRate)}</strong>
          <span className="kpi-card-bar">
            <span
              className="kpi-card-bar-fill kpi-fill-teal"
              style={{ width: barWidth(summary.detectionRate) }}
            />
          </span>
          <span className="kpi-card-note">
            {fill(labels.kpi_card_detection_note, {
              a: fmtCount(totals.correctSuspicion),
              b: fmtCount(reviewerSuspicious),
            })}
          </span>
        </article>

        <article className="kpi-card kpi-card-risk">
          <span className="kpi-card-accent kpi-accent-coral" />
          <span className="kpi-card-label">{labels.kpi_card_missed}</span>
          <span className="kpi-card-value-row">
            <strong className="kpi-card-value kpi-value-risk">{fmtPct(summary.missedSuspicionRate)}</strong>
            <span className="kpi-card-badge">
              {fill(labels.kpi_card_missed_badge, { n: fmtCount(totals.missedSuspicion) })}
            </span>
          </span>
          <span className="kpi-card-bar kpi-card-bar-risk">
            {/* The missed-suspicion rate is small by design; the bar is drawn at
                10× the rate purely so a 1–2% value stays visible. The number
                above it is the truth — the bar is an at-a-glance cue only. */}
            <span
              className="kpi-card-bar-fill kpi-fill-coral"
              style={{
                width:
                  summary.missedSuspicionRate == null
                    ? "0%"
                    : `${Math.max(0, Math.min(100, summary.missedSuspicionRate * 10))}%`,
              }}
            />
          </span>
          <span className="kpi-card-note">{labels.kpi_card_missed_note}</span>
        </article>

        <article className="kpi-card">
          <span className="kpi-card-accent kpi-accent-gold" />
          <span className="kpi-card-label">{labels.kpi_card_agreement}</span>
          <strong className="kpi-card-value">{fmtPct(levelAgreement)}</strong>
          <span className="kpi-card-bar">
            <span
              className="kpi-card-bar-fill kpi-fill-gold"
              style={{ width: barWidth(levelAgreement) }}
            />
          </span>
          <span className="kpi-card-note">{labels.kpi_card_agreement_note}</span>
        </article>
      </div>

      {/* ── 3. تقدّم دراسة العينة ──────────────────────────────────────────── */}
      <section className="kpi-panel kpi-progress">
        <div className="kpi-panel-head">
          <div>
            <h2 className="kpi-panel-title">{labels.kpi_progress_title}</h2>
            <p className="kpi-panel-sub">{labels.kpi_progress_sub}</p>
          </div>
          <span className="kpi-chip">
            {fill(labels.kpi_progress_remaining_chip, { n: fmtCount(progress.overall.remaining) })}
          </span>
        </div>
        {progress.overall.total === 0 ? (
          <p className="kpi-note">{labels.kpi_progress_empty}</p>
        ) : (
          <div className="kpi-progress-grid">
            <div className="kpi-progress-overall">
              <div
                className="kpi-ring"
                style={{
                  background:
                    "radial-gradient(circle at center, var(--c-surface) 0 62%, transparent 63%), " +
                    `conic-gradient(var(--c-navy) ${progress.overall.completionRate ?? 0}%, var(--c-navy-soft) 0)`,
                }}
              >
                <strong className="kpi-ring-value">{fmtPct(progress.overall.completionRate)}</strong>
                <span className="kpi-ring-label">{labels.kpi_progress_overall}</span>
              </div>
              <div className="kpi-progress-count">
                {fmtCount(progress.overall.studied)}{" "}
                <span>{labels.kpi_progress_of}</span> {fmtCount(progress.overall.total)}{" "}
                <span>{labels.kpi_progress_unit}</span>
              </div>
            </div>
            <div className="kpi-level-grid">
              {progress.levels.map((level) => (
                <article className="kpi-level" key={level.key}>
                  <div className="kpi-level-head">
                    <span className="kpi-level-name">{level.label}</span>
                    <span className={`kpi-level-pct kpi-tone-${level.tone}`}>
                      {fmtPct(level.completionRate)}
                    </span>
                  </div>
                  <div className="kpi-level-body">
                    <div
                      className="kpi-mini-ring"
                      style={{
                        background:
                          "radial-gradient(circle at center, var(--c-surface-2) 0 60%, transparent 61%), " +
                          `conic-gradient(var(--kpi-tone) ${level.completionRate ?? 0}%, var(--c-navy-soft) 0)`,
                      }}
                      data-tone={level.tone}
                    >
                      <strong>
                        {level.completionRate == null ? "—" : `${Math.round(level.completionRate)}%`}
                      </strong>
                    </div>
                    <div className="kpi-level-counts">
                      <strong>
                        {fmtCount(level.studied)}{" "}
                        <span>
                          {labels.kpi_progress_of} {fmtCount(level.assigned)}
                        </span>
                      </strong>
                      <span>
                        {fill(labels.kpi_progress_level_remaining, { n: fmtCount(level.remaining) })}
                      </span>
                    </div>
                  </div>
                  <span className="kpi-level-bar">
                    <span
                      className={`kpi-level-bar-fill kpi-tone-bg-${level.tone}`}
                      style={{ width: barWidth(level.completionRate) }}
                    />
                  </span>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 4. Section switcher ───────────────────────────────────────────── */}
      <div className="kpi-switcher" role="tablist" aria-label={labels.kpi_tabs_aria}>
        {renderTab("overview", labels.kpi_tab_overview)}
        {renderTab("ports", labels.kpi_tab_ports)}
        {renderTab("reviewers", labels.kpi_tab_reviewers)}
      </div>

      {/* ── 5. نظرة عامة ───────────────────────────────────────────────────── */}
      {section === "overview" && (
        <div className="kpi-section">
          <div className="kpi-chart-grid">
            <div className="kpi-panel">
              <h3 className="kpi-chart-title">{labels.kpi_chart_accuracy_title}</h3>
              <Chart svg={gaugeSvg(summary.overallAccuracy, labels.kpi_band_insufficient)} className="kpi-chart-gauge" />
            </div>
            <div className="kpi-panel">
              <h3 className="kpi-chart-title">{labels.kpi_chart_detection_title}</h3>
              <Chart svg={gaugeSvg(summary.detectionRate, labels.kpi_band_insufficient)} className="kpi-chart-gauge" />
            </div>
            <div className="kpi-panel">
              <h3 className="kpi-chart-title">{labels.kpi_chart_outcome_title}</h3>
              <Chart svg={outcomeDonutSvg(outcomeSlices, labels.kpi_band_insufficient)} className="kpi-chart-donut" />
            </div>
          </div>

          <section className="kpi-panel">
            <h3 className="kpi-panel-title">{labels.kpi_agreement_title}</h3>
            <p className="kpi-panel-sub">{labels.kpi_agreement_sub}</p>
            {agreement.length === 0 ? (
              <p className="kpi-note">{labels.kpi_agreement_empty}</p>
            ) : (
              <div className="kpi-bars">
                {agreement.map((row, index) => {
                  const tone =
                    index === 0 ? "navy" : index === agreement.length - 1 ? "muted" : "sky";
                  return (
                    <div className="kpi-bar-row" key={row.source}>
                      <span className="kpi-bar-label">{sourceLabel(row.source, labels)}</span>
                      <span className="kpi-bar-track">
                        <span
                          className={`kpi-bar-fill kpi-bar-${tone}`}
                          style={{ width: barWidth(row.agreementRate) }}
                        />
                        <b className="kpi-bar-value">{fmtPct(row.agreementRate)}</b>
                      </span>
                      <span className="kpi-bar-detail">
                        {fill(labels.kpi_agreement_comparable, { n: fmtCount(row.comparable) })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {calendar && (
            <section className="kpi-panel">
              <h3 className="kpi-panel-title">{labels.kpi_calendar_title}</h3>
              <p className="kpi-panel-sub">
                {fill(labels.kpi_calendar_sub, { month: calendarMonthLabel })}
              </p>
              <table className="kpi-sr-only">
                <caption>{labels.kpi_calendar_title}</caption>
                <tbody>
                  {calendar.cells
                    .filter((cell) => cell.day > 0 && !cell.isHoliday)
                    .map((cell) => (
                      <tr key={cell.day}>
                        <td>{fmtCount(cell.day)}</td>
                        <td>{fmtCount(cell.count)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <Chart
                className="kpi-chart-calendar"
                svg={inaccuracyCalendarSvg(calendar, weekdays, labels.kpi_calendar_holiday, {
                  high: labels.kpi_calendar_legend_high,
                  low: labels.kpi_calendar_legend_low,
                })}
              />
            </section>
          )}
        </div>
      )}

      {/* ── 6. المنافذ ─────────────────────────────────────────────────────── */}
      {section === "ports" && (
        <div className="kpi-section">
          <section className="kpi-panel">
            <h3 className="kpi-panel-title">{labels.kpi_ports_title}</h3>
            <p className="kpi-panel-sub">{labels.kpi_ports_sub}</p>
            {ports.length === 0 || selectedPort === null ? (
              <p className="kpi-note">{labels.kpi_ports_empty}</p>
            ) : (
              <div className="kpi-ports-grid">
                <div className="kpi-port-list" role="listbox" aria-label={labels.kpi_ports_list_aria}>
                  {ports.map((port) => {
                    const active = port.key === selectedPort.key;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        key={port.key}
                        className={`kpi-port-row${active ? " active" : ""}`}
                        onClick={() => setSelectedPortKey(port.key)}
                      >
                        <span className="kpi-port-name">{port.key}</span>
                        <span className="kpi-bar-track">
                          <span
                            className={`kpi-bar-fill kpi-bar-${portTone(port.accuracyByDecision)}`}
                            style={{ width: barWidth(port.accuracyByDecision) }}
                          />
                          <b className="kpi-bar-value">{fmtPct(port.accuracyByDecision)}</b>
                        </span>
                        <span className="kpi-port-count">
                          {fill(labels.kpi_ports_decisions, { n: fmtCount(port.evaluable) })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <aside className="kpi-port-detail" aria-label={labels.kpi_port_detail_aria}>
                  <div className="kpi-port-detail-head">
                    <strong>{selectedPort.key}</strong>
                    <span className={`kpi-band-pill kpi-band-${selectedPort.band}`}>
                      {bandLabel(selectedPort.band, labels)}
                    </span>
                  </div>
                  <div className="kpi-stat-grid">
                    <div className="kpi-stat">
                      <span>{labels.kpi_port_detail_accuracy}</span>
                      <strong>{fmtPct(selectedPort.accuracyByDecision)}</strong>
                    </div>
                    <div className="kpi-stat">
                      <span>{labels.kpi_port_detail_evaluable}</span>
                      <strong>{fmtCount(selectedPort.evaluable)}</strong>
                    </div>
                    <div className="kpi-stat kpi-stat-risk">
                      <span>{labels.kpi_port_detail_missed}</span>
                      <strong>{fmtPct(selectedPort.missedSuspicionRateByDecision)}</strong>
                    </div>
                    <div className="kpi-stat">
                      <span>{labels.kpi_port_detail_false}</span>
                      <strong>{fmtCount(selectedPort.falseSuspicion)}</strong>
                    </div>
                  </div>
                  <div className="kpi-mix">
                    <span className="kpi-mix-title">{labels.kpi_port_mix_title}</span>
                    {(() => {
                      const mix = [
                        selectedPort.correctClean,
                        selectedPort.correctSuspicion,
                        selectedPort.missedSuspicion,
                        selectedPort.falseSuspicion,
                      ];
                      const mixTotal = mix.reduce((sum, value) => sum + value, 0);
                      const classNames = ["clean", "correct", "missed", "false"];
                      return (
                        <div className="kpi-mix-bar">
                          {mixTotal > 0 &&
                            mix.map((value, index) => {
                              const share = (value / mixTotal) * 100;
                              // The missed segment keeps a 1.5% floor so a
                              // genuinely non-zero count is never invisible.
                              const width =
                                index === 2 && value > 0 ? Math.max(1.5, share) : share;
                              return (
                                <span
                                  key={classNames[index]}
                                  className={`kpi-mix-seg kpi-mix-${classNames[index]}`}
                                  style={{ width: `${width}%` }}
                                />
                              );
                            })}
                        </div>
                      );
                    })()}
                    <div className="kpi-mix-legend">
                      <span><i className="kpi-mix-clean" />{labels.kpi_outcome_correct_clean}</span>
                      <span><i className="kpi-mix-correct" />{labels.kpi_outcome_correct_suspicion}</span>
                      <span><i className="kpi-mix-missed" />{labels.kpi_outcome_missed}</span>
                      <span><i className="kpi-mix-false" />{labels.kpi_outcome_false}</span>
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </section>

          {model.errorAnalysis.byPort.length > 0 && (
            <section className="kpi-panel">
              <h3 className="kpi-panel-title">{labels.kpi_errors_title}</h3>
              <p className="kpi-panel-sub">{labels.kpi_errors_sub}</p>
              <Chart
                className="kpi-chart-matrix"
                svg={portMatrixSvg(
                  {
                    rows: model.errorAnalysis.byPort.map((port) => port.key),
                    cols: [
                      labels.kpi_outcome_correct_clean,
                      labels.kpi_outcome_correct_suspicion,
                      labels.kpi_outcome_missed,
                      labels.kpi_outcome_false,
                    ],
                    values: model.errorAnalysis.byPort.map((port) => [
                      port.correctClean,
                      port.correctSuspicion,
                      port.missedSuspicion,
                      port.falseSuspicion,
                    ]),
                  },
                  { high: labels.kpi_calendar_legend_high, low: labels.kpi_calendar_legend_low },
                  labels.kpi_band_insufficient
                )}
              />
            </section>
          )}
        </div>
      )}

      {/* ── 7. المراجعون ───────────────────────────────────────────────────── */}
      {section === "reviewers" && (
        <div className="kpi-section">
          <ReviewerKpiPanel
            model={model.reviewerKpis}
            resolveName={resolveName}
            answers={answers}
            statuses={statuses}
          />
        </div>
      )}
    </div>
  );
}
