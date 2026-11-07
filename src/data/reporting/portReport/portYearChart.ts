// Year-by-year bar chart for the port report: one block per year, side by side
// (the first year on the right, as the page reads), each block divided from the
// next by one solid black vertical line, the year written under its block, and
// the legend under the years. Built from deck3's own chart classes (v3-plot,
// v3-bars, v3-group, v3-cell, v3-bar, v3-cats) so it looks like the other
// charts and the PowerPoint export reads it as a native chart.

import { esc } from "../executive/primitives";
import type { ChartTone } from "../executive/deck3/chartKit";
import { legendRow } from "../executive/deck3/slideKit";
import type { LegendItem } from "../executive/deck3/slideKit";

export type YearBlock = {
  year: string;
  /** One group per measure; every group has the same bars in the same order (one per series). */
  groups: Array<{ label: string; bars: Array<{ value: number | null; tone: ChartTone }> }>;
};

/** The one solid black line between two years. */
export const YEAR_RULE = "border-inline-start:3px solid black;";

const bar = (v: number | null, tone: ChartTone, min: number, max: number, w: number, fmt: (v: number) => string) =>
  `<div class="v3-cell">${v === null ? "" : `<div class="v3-bar v3-tone-${tone}" style="max-width:${w}px;height:${(Math.max(0, Math.min(1, (v - min) / (max - min))) * 100).toFixed(1)}%"><span>${esc(fmt(v))}</span></div>`}</div>`;

export function yearBlocksChart(blocks: YearBlock[], opts: { min: number; max: number; plotHeight: number; barWidth: number; legend: LegendItem[]; valueFormat?: (v: number) => string }): string {
  const fmt = opts.valueFormat ?? ((v: number) => `${v.toFixed(1)}%`);
  const single = blocks.every((b) => b.groups.length === 1);
  const html = blocks
    .map((b, k) => {
      // A block with one group draws its bars as plain cells (one series, a colour per bar); several groups as v3-group clusters.
      const bars = single
        ? b.groups[0].bars.map((x) => bar(x.value, x.tone, opts.min, opts.max, opts.barWidth, fmt)).join("")
        : b.groups.map((g) => `<div class="v3-group" style="gap:4px">${g.bars.map((x) => bar(x.value, x.tone, opts.min, opts.max, opts.barWidth, fmt)).join("")}</div>`).join("");
      const cats = single ? "" : `<div class="v3-cats" style="gap:28px;padding:0 18px">${b.groups.map((g) => `<div class="v3-cat" style="font-size:21px;padding-top:8px;white-space:nowrap">${esc(g.label)}</div>`).join("")}</div>`;
      return `<div class="pr-yb${single ? " pr-yb1" : ""}" style="flex:1;min-width:0;display:flex;flex-direction:column;padding:0 14px;${k > 0 ? YEAR_RULE : ""}">
  <div class="v3-plot" style="height:${opts.plotHeight}px;min-height:0;flex:none"><div class="v3-bars" style="gap:${single ? 12 : 28}px;padding:0 ${single ? 8 : 18}px">${bars}</div></div>${cats}
  <div style="text-align:center;font-size:30px;font-weight:700;color:var(--v3-navy);padding-top:6px">${esc(b.year)}</div>
</div>`;
    })
    .join("");
  const legend = legendRow(opts.legend).replace('<div class="v3-legend">', '<div class="v3-legend" style="justify-content:center;margin-top:10px;white-space:nowrap">');
  return `<div style="display:flex;align-items:stretch">${html}</div>${legend}`;
}
