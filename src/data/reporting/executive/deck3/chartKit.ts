import { esc } from "../primitives";

export type ChartBar = { label: string; value: number };

export function scalePct(value: number, min: number, max: number): number {
  const pct = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function defaultFormat(v: number): string {
  return `${v.toFixed(1)}%`;
}

function referenceLineHtml(
  referenceValue: number | undefined,
  referenceLabel: string | undefined,
  min: number,
  max: number,
): string {
  if (referenceValue == null) return "";
  const pct = scalePct(referenceValue, min, max);
  return `<div class="v3-chart-refline" style="bottom:${pct.toFixed(1)}%">${referenceLabel ? `<span>${esc(referenceLabel)}</span>` : ""}</div>`;
}

export function barChart(opts: {
  bars: ChartBar[];
  min: number;
  max: number;
  referenceValue?: number;
  referenceLabel?: string;
  valueFormat?: (v: number) => string;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const bars = opts.bars
    .map((b) => {
      const pct = scalePct(b.value, opts.min, opts.max);
      return `<div class="v3-chart-cell"><div class="v3-chart-bar" style="height:${pct.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(b.value))}</span></div></div>`;
    })
    .join("");
  const labels = opts.bars.map((b) => `<div class="v3-chart-label">${esc(b.label)}</div>`).join("");
  return `
    <div class="v3-chart-plot">
      <div class="v3-chart-bars">${bars}</div>
      ${referenceLineHtml(opts.referenceValue, opts.referenceLabel, opts.min, opts.max)}
    </div>
    <div class="v3-chart-labels">${labels}</div>
  `;
}

export function groupedBarChart(opts: {
  groups: Array<{ label: string; a: ChartBar; b: ChartBar }>;
  min: number;
  max: number;
  referenceValue?: number;
  referenceLabel?: string;
  valueFormat?: (v: number) => string;
  toneA?: string;
  toneB?: string;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const groups = opts.groups
    .map((g) => {
      const pctA = scalePct(g.a.value, opts.min, opts.max);
      const pctB = scalePct(g.b.value, opts.min, opts.max);
      return `<div class="v3-chart-group">
        <div class="v3-chart-cell"><div class="v3-chart-bar v3-chart-bar-a" style="height:${pctA.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(g.a.value))}</span></div></div>
        <div class="v3-chart-cell"><div class="v3-chart-bar v3-chart-bar-b" style="height:${pctB.toFixed(1)}%"><span class="v3-chart-value">${esc(fmt(g.b.value))}</span></div></div>
      </div>`;
    })
    .join("");
  const labels = opts.groups.map((g) => `<div class="v3-chart-label">${esc(g.label)}</div>`).join("");
  return `
    <div class="v3-chart-plot v3-chart-plot-grouped">
      <div class="v3-chart-bars">${groups}</div>
      ${referenceLineHtml(opts.referenceValue, opts.referenceLabel, opts.min, opts.max)}
    </div>
    <div class="v3-chart-labels">${labels}</div>
  `;
}
