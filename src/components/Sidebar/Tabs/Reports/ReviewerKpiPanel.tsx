import { useState, type ReactElement } from "react";

import { useLabels } from "../../../../data/labels/useLabels";
import type { Labels } from "../../../../data/labels/labelsStore";
import type { PChart, PChartGroup, ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import { P_CHART_MIN_N } from "../../../../data/reporting/executive/model/reviewerKpis";
import {
  buildPChartSvgGeometry,
  P_CHART_SVG,
  type SvgPoint,
} from "./pChartSvgGeometry";
import "./ReviewerKpiPanel.css";

/* ── Fixed palette (validated: CVD ΔE 73.4, ≥12 target; light mode all-PASS) ──
   Data marks carry the visual weight; the control band is recessive gray.
   in-control  → sky   (--c-sky   #009ADE)   filled dot
   out-of-ctrl → coral (--c-coral #c0392b)   filled dot + reserved ring (non-color mark)
   low-n       → muted (--c-ink-4 #8395AC)   HOLLOW dot (shape encodes, not color)
   centre p̄   → neutral dashed line;  band → light-gray fill (~12% alpha).      */
const COLOR = {
  inControl: "var(--c-sky)",
  outOfControl: "var(--c-coral)",
  lowN: "var(--c-ink-4)",
  center: "var(--c-ink-3)",
  band: "var(--c-ink-3)",
  grid: "var(--c-border)",
  axis: "var(--c-ink-3)",
} as const;

type MarkStatus = "in" | "out" | "low";

type ChartDatum = {
  key: string;
  name: string;
  /** proportion as percent (0–100) */
  pPct: number;
  uclPct: number;
  lclPct: number;
  centerPct: number;
  n: number;
  status: MarkStatus;
};

function statusOf(g: PChartGroup): MarkStatus {
  if (g.lowN) return "low";
  return g.outOfControl ? "out" : "in";
}

function colorFor(status: MarkStatus): string {
  return status === "out" ? COLOR.outOfControl : status === "low" ? COLOR.lowN : COLOR.inControl;
}

function toData(chart: PChart, resolveName: (key: string) => string): ChartDatum[] {
  const center = chart.center ?? 0;
  return chart.groups.map((g) => ({
    key: g.key,
    name: resolveName(g.key),
    pPct: g.p * 100,
    uclPct: g.ucl * 100,
    lclPct: g.lcl * 100,
    centerPct: center * 100,
    n: g.n,
    status: statusOf(g),
  }));
}

const nf = (n: number): string => n.toLocaleString("ar-SA-u-nu-latn");
const pf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
const hf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);

function statusText(datum: ChartDatum, labels: Labels): string {
  return datum.status === "out"
    ? labels.rk_status_out_of_control
    : datum.status === "low"
      ? labels.rk_status_low_n.replace("{n}", nf(P_CHART_MIN_N))
      : labels.rk_status_in_control;
}

function marker(datum: ChartDatum, point: SvgPoint): ReactElement {
  const fill = colorFor(datum.status);
  if (datum.status === "low") {
    return <circle cx={point.x} cy={point.pY} r={5} fill="var(--c-surface)" stroke={fill} strokeWidth={2} />;
  }
  if (datum.status === "out") {
    return (
      <>
        <circle cx={point.x} cy={point.pY} r={9} fill="none" stroke={fill} strokeWidth={1.6} opacity={0.9} />
        <circle cx={point.x} cy={point.pY} r={5} fill={fill} />
      </>
    );
  }
  return <circle cx={point.x} cy={point.pY} r={5} fill={fill} />;
}

function PChartView(props: {
  chart: PChart;
  resolveName: (key: string) => string;
  labels: Labels;
  title: string;
}): ReactElement {
  const { chart, resolveName, labels, title } = props;
  if (chart.center === null || chart.groups.length === 0) {
    return <div className="rk-chart-empty">{labels.rk_pchart_empty}</div>;
  }
  const data = toData(chart, resolveName);
  const centerPct = chart.center * 100;
  const geometry = buildPChartSvgGeometry(data, centerPct);
  const yTicks = [0, 25, 50, 75, 100];
  const { width: svgWidth, height: svgHeight, plot } = P_CHART_SVG;
  const yForTick = (value: number) =>
    plot.top + ((100 - value) / 100) * (plot.bottom - plot.top);
  return (
    <>
      <table className="rk-sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>المجموعة</th>
            <th>النسبة</th>
            <th>عدد الحالات</th>
            <th>{labels.rk_tooltip_center}</th>
            <th>{labels.rk_tooltip_ucl}</th>
            <th>{labels.rk_tooltip_lcl}</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <td>{datum.name}</td>
              <td>{pf(datum.pPct)}</td>
              <td>{nf(datum.n)}</td>
              <td>{pf(datum.centerPct)}</td>
              <td>{pf(datum.uclPct)}</td>
              <td>{pf(datum.lclPct)}</td>
              <td>{statusText(datum, labels)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rk-chart" dir="ltr" aria-hidden="true">
        <svg
          className="rk-native-chart"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          focusable="false"
          preserveAspectRatio="xMidYMid meet"
        >
          {yTicks.map((tick) => {
            const y = yForTick(tick);
            return (
              <g key={tick}>
                <line x1={plot.left} x2={plot.right} y1={y} y2={y} stroke={COLOR.grid} strokeDasharray="2 4" />
                <text x={plot.right + 10} y={y + 4} className="rk-axis-label">{nf(tick)}</text>
              </g>
            );
          })}
          <line x1={plot.right} x2={plot.right} y1={plot.top} y2={plot.bottom} stroke={COLOR.axis} />
          <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={COLOR.axis} />
          <path d={geometry.bandPath} fill={COLOR.band} fillOpacity={0.12} stroke="none" />
          <path d={geometry.upperPath} fill="none" stroke={COLOR.band} strokeWidth={1} strokeDasharray="4 3" />
          <path d={geometry.lowerPath} fill="none" stroke={COLOR.band} strokeWidth={1} strokeDasharray="4 3" />
          <line
            x1={plot.left}
            x2={plot.right}
            y1={geometry.centerY}
            y2={geometry.centerY}
            stroke={COLOR.center}
            strokeWidth={1.4}
            strokeDasharray="6 4"
          />
          <text
            className="rk-axis-title"
            x={svgWidth - 12}
            y={(plot.top + plot.bottom) / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${svgWidth - 12} ${(plot.top + plot.bottom) / 2})`}
          >
            {labels.rk_axis_proportion}
          </text>
          {data.map((datum, index) => {
            const point = geometry.points[index]!;
            const tooltip = [
              datum.name,
              `${labels.rk_tooltip_proportion} ${pf(datum.pPct)}`,
              `${labels.rk_tooltip_cases} ${nf(datum.n)}`,
              `${labels.rk_tooltip_center} ${pf(datum.centerPct)}`,
              `${labels.rk_tooltip_ucl} ${pf(datum.uclPct)}`,
              `${labels.rk_tooltip_lcl} ${pf(datum.lclPct)}`,
              statusText(datum, labels),
            ].join("، ");
            return (
              <g key={datum.key}>
                <title>{tooltip}</title>
                {marker(datum, point)}
                <text
                  x={point.x}
                  y={plot.bottom + 18}
                  className="rk-x-label"
                  textAnchor="end"
                  transform={`rotate(-30 ${point.x} ${plot.bottom + 18})`}
                  direction="rtl"
                >
                  {datum.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function ChartLegend({ labels }: { labels: Labels }): ReactElement {
  return (
    <div className="rk-legend" aria-hidden="true">
      <span className="rk-legend-item"><span className="rk-legend-dot rk-dot-in" />{labels.rk_legend_in_control}</span>
      <span className="rk-legend-item"><span className="rk-legend-dot rk-dot-out" />{labels.rk_legend_out_of_control}</span>
      <span className="rk-legend-item"><span className="rk-legend-dot rk-dot-low" />{labels.rk_legend_low_n}</span>
      <span className="rk-legend-item"><span className="rk-legend-swatch rk-swatch-center" />{labels.rk_legend_center}</span>
      <span className="rk-legend-item"><span className="rk-legend-swatch rk-swatch-band" />{labels.rk_legend_limits}</span>
    </div>
  );
}

export default function ReviewerKpiPanel(props: {
  model: ReviewerKpiModel;
  resolveName: (username: string) => string;
}): ReactElement {
  const { model, resolveName } = props;
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

  const activeChart = view === "reviewer" ? model.reviewerPChart : model.portPChart;
  const chartTitle = view === "reviewer" ? labels.rk_pchart_reviewer_title : labels.rk_pchart_port_title;
  // Ports are already Arabic names; only reviewer keys need username→display resolution.
  const chartResolve = view === "reviewer" ? resolveName : (k: string) => k;

  return (
    <section className="rk-panel" dir="rtl">
      <header className="rk-head">
        <h2>{labels.rk_section_title}</h2>
        <p>{labels.rk_section_desc}</p>
      </header>

      {/* Reviewer KPI table */}
      <div className="rk-table-wrap">
        <table className="rk-table">
          <caption className="rk-sr-only">{labels.rk_table_caption}</caption>
          <thead>
            <tr>
              <th>{labels.rk_col_reviewer}</th>
              <th>{labels.rk_col_assigned}</th>
              <th>{labels.rk_col_completed}</th>
              <th>{labels.rk_col_completion}</th>
              <th>{labels.rk_col_throughput}</th>
              <th>{labels.rk_col_turnaround_median}</th>
              <th>{labels.rk_col_turnaround_p90}</th>
              <th>{labels.rk_col_suspicion_rate}</th>
              <th>{labels.rk_col_referral_rate}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => (
              <tr key={r.reviewerId}>
                <td className="rk-cell-name">{resolveName(r.reviewerId)}</td>
                <td>{nf(r.assigned)}</td>
                <td>{nf(r.completed)}</td>
                <td>{pf(r.completionRate)}</td>
                <td>{pf(r.throughputVsQuota)}</td>
                <td>{hf(r.turnaroundMedianHours)}</td>
                <td>{hf(r.turnaroundP90Hours)}</td>
                <td>{pf(r.suspicionOrReferralRate)}</td>
                <td>{pf(r.referralRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* p-chart with reviewer/port toggle */}
      <div className="rk-chart-block">
        <div className="rk-chart-topbar">
          <h3>{chartTitle}</h3>
          <div className="rk-toggle" role="group" aria-label={labels.rk_section_title}>
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
        <p className="rk-chart-desc">{labels.rk_pchart_desc}</p>
        <PChartView
          chart={activeChart}
          resolveName={chartResolve}
          labels={labels}
          title={chartTitle}
        />
        <ChartLegend labels={labels} />
      </div>
    </section>
  );
}
