import { useState, type ReactElement } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useLabels } from "../../../../data/labels/useLabels";
import type { Labels } from "../../../../data/labels/labelsStore";
import type { PChart, PChartGroup, ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import { P_CHART_MIN_N } from "../../../../data/reporting/executive/model/reviewerKpis";
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
  /** [lcl, ucl] percent tuple → recharts range Area (the control band). */
  band: [number, number];
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
    band: [g.lcl * 100, g.ucl * 100],
    n: g.n,
    status: statusOf(g),
  }));
}

const nf = (n: number): string => n.toLocaleString("ar-SA-u-nu-latn");
const pf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
const hf = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);

/** Custom scatter mark: colour + a redundant non-colour cue per status. */
function MarkShape(props: { cx?: number; cy?: number; payload?: ChartDatum }): ReactElement {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return <g />;
  const fill = colorFor(payload.status);
  if (payload.status === "low") {
    // hollow marker — shape encodes "small sample", not colour alone
    return <circle cx={cx} cy={cy} r={5} fill="var(--c-surface)" stroke={fill} strokeWidth={2} />;
  }
  if (payload.status === "out") {
    // filled dot + reserved outer ring (redundant with the danger colour)
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill="none" stroke={fill} strokeWidth={1.6} opacity={0.9} />
        <circle cx={cx} cy={cy} r={5} fill={fill} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={5} fill={fill} />;
}

function ChartTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
  labels: Labels;
}): ReactElement | null {
  const { active, payload, labels } = props;
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]!.payload;
  const statusText =
    d.status === "out"
      ? labels.rk_status_out_of_control
      : d.status === "low"
        ? labels.rk_status_low_n.replace("{n}", nf(P_CHART_MIN_N))
        : labels.rk_status_in_control;
  return (
    <div className="rk-tip" dir="rtl">
      <div className="rk-tip-title">{d.name}</div>
      <dl className="rk-tip-list">
        <div><dt>{labels.rk_tooltip_proportion}</dt><dd>{pf(d.pPct)}</dd></div>
        <div><dt>{labels.rk_tooltip_cases}</dt><dd>{nf(d.n)}</dd></div>
        <div><dt>{labels.rk_tooltip_center}</dt><dd>{pf(d.centerPct)}</dd></div>
        <div><dt>{labels.rk_tooltip_ucl}</dt><dd>{pf(d.uclPct)}</dd></div>
        <div><dt>{labels.rk_tooltip_lcl}</dt><dd>{pf(d.lclPct)}</dd></div>
        <div className={`rk-tip-status rk-tip-status-${d.status}`}><dt>{labels.rk_tooltip_status}</dt><dd>{statusText}</dd></div>
      </dl>
    </div>
  );
}

function PChartView(props: { chart: PChart; resolveName: (key: string) => string; labels: Labels }): ReactElement {
  const { chart, resolveName, labels } = props;
  if (chart.center === null || chart.groups.length === 0) {
    return <div className="rk-chart-empty">{labels.rk_pchart_empty}</div>;
  }
  const data = toData(chart, resolveName);
  const centerPct = chart.center * 100;
  return (
    // recharts is LTR-internal: wrap in dir="ltr" so its layout math is correct,
    // then re-establish RTL reading order via XAxis `reversed` (first category on
    // the right) and place the Y axis on the right (orientation="right").
    <div className="rk-chart" dir="ltr">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 40, left: 8 }}>
          <CartesianGrid stroke={COLOR.grid} strokeDasharray="2 4" vertical={false} />
          {/* Control band (recessive gray range area, stepped) */}
          <Area
            dataKey="band"
            type="stepAfter"
            fill={COLOR.band}
            fillOpacity={0.12}
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            legendType="none"
          />
          {/* Crisp band edges */}
          <Line dataKey="uclPct" type="stepAfter" stroke={COLOR.band} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} legendType="none" />
          <Line dataKey="lclPct" type="stepAfter" stroke={COLOR.band} strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} legendType="none" />
          {/* Pooled centre line p̄ */}
          <ReferenceLine y={centerPct} stroke={COLOR.center} strokeDasharray="6 4" strokeWidth={1.4} ifOverflow="extendDomain" />
          <XAxis
            dataKey="name"
            type="category"
            reversed
            interval={0}
            tick={{ fontSize: 11, fill: COLOR.axis }}
            angle={-30}
            textAnchor="end"
            height={56}
            stroke={COLOR.axis}
          />
          <YAxis
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(v: number) => nf(v)}
            tick={{ fontSize: 11, fill: COLOR.axis }}
            label={{ value: labels.rk_axis_proportion, angle: -90, position: "insideRight", fill: COLOR.axis, fontSize: 11 }}
            stroke={COLOR.axis}
          />
          <Tooltip content={<ChartTooltip labels={labels} />} cursor={{ stroke: COLOR.grid }} />
          {/* Data marks (carry the visual weight) */}
          <Scatter dataKey="pPct" shape={<MarkShape />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
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
        <h3>{labels.rk_section_title}</h3>
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
          <h4>{chartTitle}</h4>
          <div className="rk-toggle" role="tablist" aria-label={labels.rk_section_title}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "reviewer"}
              className={view === "reviewer" ? "active" : ""}
              onClick={() => setView("reviewer")}
            >
              {labels.rk_toggle_reviewer}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "port"}
              className={view === "port" ? "active" : ""}
              onClick={() => setView("port")}
            >
              {labels.rk_toggle_port}
            </button>
          </div>
        </div>
        <p className="rk-chart-desc">{labels.rk_pchart_desc}</p>
        <PChartView chart={activeChart} resolveName={chartResolve} labels={labels} />
        <ChartLegend labels={labels} />
      </div>
    </section>
  );
}
