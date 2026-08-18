import { useState, type ReactElement } from "react";

import { useLabels } from "../../../../data/labels/useLabels";
import type { Labels } from "../../../../data/labels/labelsStore";
import type { ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import type { AnswerGroups, ReviewerControlStatus } from "./kpiSelectors";
import { answersBarsSvg } from "./kpiCharts";
import "./ReviewerKpiPanel.css";

/*
 * المراجعون tab of the reworked KPI dashboard.
 *
 * The SPC p-chart that used to live here was replaced by a grouped bar chart of
 * the reviewers' «دقة الاشتباه» answers (design handoff, 2026-08). The p-chart
 * MATH in `reviewerKpis.ts` is unchanged and still the model behind the الحالة
 * pill (ضمن الضبط / خارج الضبط / عيّنة صغيرة) — only the rendering changed. The
 * caller derives the statuses via `buildReviewerStatuses`, which reads the
 * existing p-chart groups verbatim.
 */

const nf = (n: number): string => n.toLocaleString("ar-SA-u-nu-latn");
const pf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
const hf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);

function statusLabel(status: ReviewerControlStatus, labels: Labels): string {
  return status === "out-of-control"
    ? labels.rk_status_out_of_control
    : status === "low-n"
      ? labels.rk_legend_low_n
      : labels.rk_status_in_control;
}

export default function ReviewerKpiPanel(props: {
  model: ReviewerKpiModel;
  resolveName: (username: string) => string;
  answers: AnswerGroups;
  statuses: Map<string, ReviewerControlStatus>;
}): ReactElement {
  const { model, resolveName, answers, statuses } = props;
  const labels = useLabels();
  const [view, setView] = useState<"reviewer" | "port">("reviewer");

  if (model.rows.length === 0) {
    return (
      <section className="rk-panel" dir="rtl">
        <div className="rk-empty">
          <strong>{labels.rk_empty_title}</strong>
          <span>{labels.rk_empty_desc}</span>
        </div>
      </section>
    );
  }

  const groups = view === "reviewer" ? answers.reviewer : answers.port;
  const chartTitle =
    view === "reviewer" ? labels.kpi_answers_title_reviewer : labels.kpi_answers_title_port;

  return (
    <div className="rk-panel" dir="rtl">
      <section className="rk-card">
        <h3 className="rk-card-title">{labels.kpi_reviewers_title}</h3>
        <p className="rk-card-sub">{labels.kpi_reviewers_sub}</p>
        <div className="rk-table-wrap">
          <table className="rk-table">
            <caption className="rk-sr-only">{labels.rk_table_caption}</caption>
            <thead>
              <tr>
                <th>{labels.rk_col_reviewer}</th>
                <th>{labels.rk_col_assigned}</th>
                <th>{labels.rk_col_completed}</th>
                <th>{labels.rk_col_completion}</th>
                <th>{labels.rk_col_turnaround_median}</th>
                <th>{labels.rk_col_suspicion_rate}</th>
                <th>{labels.kpi_reviewers_col_status}</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => {
                const status = statuses.get(row.reviewerId) ?? "low-n";
                return (
                  <tr key={row.reviewerId}>
                    <td className="rk-cell-name">{resolveName(row.reviewerId)}</td>
                    <td className="rk-num">{nf(row.assigned)}</td>
                    <td className="rk-num">{nf(row.completed)}</td>
                    <td className="rk-cell-completion">
                      <span className="rk-progress">
                        <span
                          className="rk-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, row.completionRate ?? 0))}%` }}
                        />
                      </span>
                      <span className="rk-num rk-progress-value">{pf(row.completionRate)}</span>
                    </td>
                    <td className="rk-num">{hf(row.turnaroundMedianHours)}</td>
                    <td className="rk-num">{pf(row.suspicionOrReferralRate)}</td>
                    <td>
                      <span className={`rk-status rk-status-${status}`}>
                        {statusLabel(status, labels)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rk-card">
        <div className="rk-chart-topbar">
          <h3 className="rk-card-title">{chartTitle}</h3>
          <div className="rk-toggle" role="group" aria-label={chartTitle}>
            <button
              type="button"
              aria-pressed={view === "reviewer"}
              className={view === "reviewer" ? "active" : ""}
              onClick={() => setView("reviewer")}
            >
              {labels.rk_toggle_reviewer}
            </button>
            <button
              type="button"
              aria-pressed={view === "port"}
              className={view === "port" ? "active" : ""}
              onClick={() => setView("port")}
            >
              {labels.rk_toggle_port}
            </button>
          </div>
        </div>
        <p className="rk-card-sub">{labels.kpi_answers_desc}</p>

        {/* Semantic screen-reader equivalent of the SVG — the chart itself is
            aria-hidden, matching the accessibility pattern the p-chart used. */}
        <table className="rk-sr-only">
          <caption>{chartTitle}</caption>
          <thead>
            <tr>
              <th>{labels.rk_pchart_sr_col_group}</th>
              <th>{labels.kpi_answers_series_suspicion}</th>
              <th>{labels.kpi_answers_series_clean}</th>
              <th>{labels.kpi_answers_series_incomplete}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td>{group.label}</td>
                <td>{nf(group.suspicion)}</td>
                <td>{nf(group.clean)}</td>
                <td>{nf(group.incomplete)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          className="rk-chart"
          dir="ltr"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: answersBarsSvg(groups, labels.kpi_answers_empty) }}
        />

        <div className="rk-legend" aria-hidden="true">
          <span className="rk-legend-item">
            <span className="rk-legend-swatch rk-swatch-suspicion" />
            {labels.kpi_answers_series_suspicion}
          </span>
          <span className="rk-legend-item">
            <span className="rk-legend-swatch rk-swatch-clean" />
            {labels.kpi_answers_series_clean}
          </span>
          <span className="rk-legend-item">
            <span className="rk-legend-swatch rk-swatch-incomplete" />
            {labels.kpi_answers_series_incomplete}
          </span>
        </div>
      </section>
    </div>
  );
}
