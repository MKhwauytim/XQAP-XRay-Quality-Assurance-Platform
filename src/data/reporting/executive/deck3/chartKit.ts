// The handoff's pure-CSS bar-chart pattern (design_handoff_xray_qa_deck
// README, "Chart Construction (critical)"), rebuilt 2026-08-26 to carry the
// full handoff geometry: tinted plot boxes (neutral / land / sea), bars capped
// at a per-chart max width and centered in their cells, value labels inside
// the bar top, dashed reference lines with an optional label at the plot's
// far (left) edge, and a category-label row that mirrors the bar row's
// gap/padding so labels align exactly under each bar or group.
import { esc } from "../primitives";

export type ChartTone = "gold" | "blue" | "green" | "red" | "navy";
export type PlotTint = "panel" | "land" | "sea";
export type RefTone = "muted" | "gold" | "gold-dark" | "blue-dark" | "avg-green" | "avg-red";

export type ChartBar = {
  label: string;
  /** Optional second line under the category label (rendered muted). */
  sublabel?: string;
  /** Null renders the category with no bar (an honest gap, never a 0% bar). */
  value: number | null;
  tone?: ChartTone;
};

export type ChartReference = { value: number; label?: string; tone?: RefTone };

export function scalePct(value: number, min: number, max: number): number {
  const pct = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function defaultFormat(v: number): string {
  return `${v.toFixed(1)}%`;
}

function refLinesHtml(references: ChartReference[] | undefined, min: number, max: number): string {
  if (!references?.length) return "";
  return references
    .map((ref) => {
      const bottom = scalePct(ref.value, min, max).toFixed(2);
      const tone = ref.tone ?? "muted";
      const line = `<div class="v3-refline ${tone}" style="bottom:${bottom}%"></div>`;
      const label = ref.label
        ? `<span class="v3-ref-label ${tone}" style="bottom:${bottom}%">${esc(ref.label)}</span>`
        : "";
      return line + label;
    })
    .join("");
}

function cellHtml(
  bar: ChartBar,
  min: number,
  max: number,
  maxWidth: number,
  defaultTone: ChartTone,
  fmt: (v: number) => string,
): string {
  const inner =
    bar.value === null
      ? ""
      : `<div class="v3-bar v3-tone-${bar.tone ?? defaultTone}" style="max-width:${maxWidth}px;height:${scalePct(bar.value, min, max).toFixed(1)}%"><span>${esc(fmt(bar.value))}</span></div>`;
  return `<div class="v3-cell">${inner}</div>`;
}

function catHtml(label: string, sublabel: string | undefined, flexStyle: string): string {
  const sub = sublabel ? `<br><span>${esc(sublabel)}</span>` : "";
  return `<div class="v3-cat"${flexStyle}>${esc(label)}${sub}</div>`;
}

export function barChart(opts: {
  bars: ChartBar[];
  min: number;
  max: number;
  tint?: PlotTint;
  /** Bar cap in px — the handoff uses 78–120 depending on the slide. */
  barMaxWidth?: number;
  gap?: number;
  pad?: number;
  /** Fixed plot height in px; omitted → the plot flexes (`.grow`). */
  plotHeight?: number;
  references?: ChartReference[];
  defaultTone?: ChartTone;
  valueFormat?: (v: number) => string;
  /** The mini-chart pattern (slides 13/19) captions the whole plot with one
   *  centered label instead of per-bar categories. */
  hideCats?: boolean;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const gap = opts.gap ?? 20;
  const pad = opts.pad ?? 20;
  const maxWidth = opts.barMaxWidth ?? 92;
  const tint = opts.tint && opts.tint !== "panel" ? ` ${opts.tint}` : "";
  const sizing = opts.plotHeight ? ` style="height:${opts.plotHeight}px"` : "";
  const grow = opts.plotHeight ? "" : " grow";
  const rowStyle = ` style="gap:${gap}px;padding:0 ${pad}px"`;
  const bars = opts.bars.map((b) => cellHtml(b, opts.min, opts.max, maxWidth, opts.defaultTone ?? "gold", fmt)).join("");
  const cats = opts.hideCats ? "" : `<div class="v3-cats"${rowStyle}>${opts.bars.map((b) => catHtml(b.label, b.sublabel, "")).join("")}</div>`;
  return `<div class="v3-plot${tint}${grow}"${sizing}><div class="v3-bars"${rowStyle}>${bars}</div>${refLinesHtml(opts.references, opts.min, opts.max)}</div>${cats}`;
}

export function groupedBarChart(opts: {
  groups: Array<{ label: string; sublabel?: string; a: ChartBar; b: ChartBar }>;
  min: number;
  max: number;
  tint?: PlotTint;
  barMaxWidth?: number;
  gap?: number;
  pad?: number;
  plotHeight?: number;
  /** When set, every group is a fixed slice of the plot width and the row is
   *  centered — the handoff's slide-18 trick so a 4-port chart keeps the same
   *  bar width/spacing as its 6-port sibling. */
  groupWidthPct?: number;
  references?: ChartReference[];
  toneA?: ChartTone;
  toneB?: ChartTone;
  valueFormat?: (v: number) => string;
}): string {
  const fmt = opts.valueFormat ?? defaultFormat;
  const gap = opts.gap ?? 26;
  const pad = opts.pad ?? 22;
  const maxWidth = opts.barMaxWidth ?? 96;
  const toneA = opts.toneA ?? "gold";
  const toneB = opts.toneB ?? "blue";
  const tint = opts.tint && opts.tint !== "panel" ? ` ${opts.tint}` : "";
  const sizing = opts.plotHeight ? ` style="height:${opts.plotHeight}px"` : "";
  const grow = opts.plotHeight ? "" : " grow";
  const center = opts.groupWidthPct ? " center" : "";
  const rowStyle = ` style="gap:${gap}px;padding:0 ${pad}px"`;
  const flexStyle = opts.groupWidthPct ? ` style="flex:0 0 ${opts.groupWidthPct}%"` : "";
  const groups = opts.groups
    .map(
      (g) =>
        `<div class="v3-group"${flexStyle}>${cellHtml({ tone: toneA, ...g.a }, opts.min, opts.max, maxWidth, toneA, fmt)}${cellHtml({ tone: toneB, ...g.b }, opts.min, opts.max, maxWidth, toneB, fmt)}</div>`,
    )
    .join("");
  const cats = opts.groups.map((g) => catHtml(g.label, g.sublabel, flexStyle)).join("");
  return `<div class="v3-plot${tint}${grow}"${sizing}><div class="v3-bars${center}"${rowStyle}>${groups}</div>${refLinesHtml(opts.references, opts.min, opts.max)}</div><div class="v3-cats${center}"${rowStyle}>${cats}</div>`;
}
