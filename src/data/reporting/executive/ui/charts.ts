// Static inline-SVG chart primitives for the executive report.
// Every chart is a PURE function (data, opts) => string — no React, no DOM, no
// runtime JS, no canvas, no npm chart deps. All geometry/path math is hand-rolled.
// Colors reference theme.ts CSS variables via tokens.ts so charts theme on brand.
//
// Discipline (master §16 / design §4.3):
//   • empty / null / zero-denominator data → small neutral "—" empty state, never throw
//   • percentages clamped to 0–100
//   • RTL: ranked-bar labels sit on the RIGHT
//   • text kept minimal; all labels passed in as params (Arabic-ready)
//   • legends/axis ticks: vertical swatch+label rows, RTL (marker right, label growing
//     left); reserved inside the existing viewBox height, never grows past opts.height
//   • every legend/axis label routes through escText() — no new unescaped interpolation

import { FONT_FAMILY, TYPE, clamp, clampPct, cssVar, seriesColor } from "./tokens";
import { esc } from "../primitives";
// Headless d3 geometry: path-string generators only (no DOM, no renderer). Used
// for smoother donut/gauge arcs (padAngle + cornerRadius), a monotone sparkline
// curve, and a smooth funnel connector — the escText/RTL/empty-state discipline
// and every public signature below are unchanged; d3 only produces the `d="…"`.
import { arc as d3arc, pie as d3pie, line as d3line, area as d3area, curveMonotoneX, curveBumpY } from "d3-shape";
import { scaleLinear } from "d3-scale";

// ── shared helpers ──────────────────────────────────────────────────────────

/** Delegates to the single hardened escaping primitive (audit C-08). Kept as a
 *  local name so the chart call sites read unchanged. */
function escText(s: string | null | undefined): string {
  return esc(s);
}

/** Round to 2dp and strip trailing zeros — keeps path strings compact. */
function r(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 100) / 100);
}

function svgOpen(w: number, h: number): string {
  return (
    `<svg viewBox="0 0 ${r(w)} ${r(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="100%" height="100%" font-family='${FONT_FAMILY}'>`
  );
}

/** Neutral empty-state SVG with a centered em-dash. Never throws. */
function emptyState(w = 320, h = 180, note?: string): string {
  const cx = w / 2;
  const cy = h / 2;
  return (
    svgOpen(w, h) +
    `<rect x="0" y="0" width="${r(w)}" height="${r(h)}" fill="none"/>` +
    `<text x="${r(cx)}" y="${r(cy)}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-size="${TYPE.title}" fill="${cssVar("muted")}">—</text>` +
    (note
      ? `<text x="${r(cx)}" y="${r(cy + 22)}" text-anchor="middle" ` +
        `font-size="${TYPE.caption}" fill="${cssVar("muted")}">${escText(note)}</text>`
      : "") +
    `</svg>`
  );
}

/** Row height (px) for one vertical legend entry (swatch + label) — derived from the
 *  micro type size so legends stay visually consistent with the smallest chart text
 *  already in use (column/group/row labels all use TYPE.micro). */
const LEGEND_ROW_H = TYPE.micro + 7;

/** Vertical space (px) a legend of `n` entries needs, including top padding. A single
 *  entry needs no legend — there is nothing to distinguish — so this returns 0 for
 *  n <= 1, letting callers skip the legend and keep the full chart area. */
function legendHeight(n: number): number {
  return n > 1 ? n * LEGEND_ROW_H + 6 : 0;
}

/**
 * Vertical legend: one "swatch + label" row per entry, colored by `seriesColor`. RTL —
 * the swatch sits flush to the right edge with the label growing leftward from it
 * (`text-anchor="end"`), mirroring the marker/label order used elsewhere in this file
 * (e.g. rankedBar's label-on-the-right row). `top` is the y-coordinate of the first
 * row's top edge. Returns raw <rect>/<text> markup to splice into an already-open
 * <svg>; every label is escText()-escaped (labels/series names are caller-supplied).
 */
function legendRows(items: { label: string; colorIndex: number }[], w: number, top: number): string {
  return items
    .map((it, i) => {
      const cy = top + i * LEGEND_ROW_H + LEGEND_ROW_H / 2;
      const swatchX = w - 12;
      return (
        `<rect x="${r(swatchX - 8)}" y="${r(cy - 4)}" width="8" height="8" rx="2" fill="${seriesColor(it.colorIndex)}"/>` +
        `<text x="${r(swatchX - 12)}" y="${r(cy)}" text-anchor="end" dominant-baseline="middle" font-size="${TYPE.micro}" fill="${cssVar("text")}">${escText(it.label)}</text>`
      );
    })
    .join("");
}

// ── types ─────────────────────────────────────────────────────────────────

export type LabeledValue = { label: string; value: number };
export type SeriesGroup = {
  groups: string[];
  series: { label: string; values: number[] }[];
};
export type ScatterPoint = { label: string; x: number; y: number };
export type Matrix = {
  rows: string[];
  cols: string[];
  values: (number | null)[][];
};

export type ChartOpts = {
  width?: number;
  height?: number;
  emptyNote?: string;
};

// ── rankedBar — horizontal bars, labels on the RIGHT (RTL) ──────────────────

export function rankedBar(data: LabeledValue[], opts: ChartOpts = {}): string {
  if (!data || data.length === 0) return emptyState(opts.width, opts.height, opts.emptyNote);
  // Rendered as HTML/CSS (not SVG): Arabic <text> inside SVG shapes unreliably across
  // renderers, so labels + values live in HTML where RTL Arabic always shapes correctly.
  // RTL row order (right → left): label · bar track (fills from right) · value.
  const max = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)));
  const rows = data
    .map((d, i) => {
      const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
      const pct = max > 0 ? clamp((v / max) * 100, 0, 100) : 0;
      const w = pct > 0 ? Math.max(3, pct) : 0;
      return (
        `<div style="display:flex;align-items:center;gap:12px;width:100%">` +
        `<span style="flex:0 0 auto;min-width:96px;max-width:40%;text-align:right;font-weight:600;font-size:14px;color:${cssVar("text")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escText(d.label)}</span>` +
        `<span style="flex:1 1 auto;height:26px;border-radius:8px;background:${cssVar("line")};position:relative;overflow:hidden">` +
        `<i style="position:absolute;inset-inline-end:0;top:0;height:100%;width:${r(w)}%;background:${seriesColor(i)};border-radius:8px"></i></span>` +
        `<span style="flex:0 0 auto;min-width:38px;text-align:left;font-weight:800;font-size:14px;color:${cssVar("primary")}">${r(v)}</span>` +
        `</div>`
      );
    })
    .join("");
  // Axis reference row: frames the shared 0→max scale every bar is drawn against (bars
  // are proportional to the same `max`, so the scale is meaningful even though each row
  // also prints its own value). Reuses the exact label/track/value column widths so the
  // "0" / max ticks line up under the track they describe. RTL: "0" (baseline) sits by
  // the label column on the right, the ceiling value by the value column on the left —
  // same right→left order as the rows above.
  const axis =
    max > 0
      ? `<div style="display:flex;align-items:center;gap:12px;width:100%;margin-top:-2px">` +
        `<span style="flex:0 0 auto;min-width:96px;max-width:40%"></span>` +
        `<span style="flex:1 1 auto;display:flex;justify-content:space-between;font-size:${TYPE.micro}px;color:${cssVar("muted")}">` +
        `<span>0</span><span>${r(max)}</span></span>` +
        `<span style="flex:0 0 auto;min-width:38px"></span>` +
        `</div>`
      : "";
  return `<div style="display:flex;flex-direction:column;justify-content:center;gap:12px;width:100%;height:100%">${rows}${axis}</div>`;
}

// ── donut ───────────────────────────────────────────────────────────────────

export function donut(data: LabeledValue[], opts: ChartOpts = {}): string {
  const positive = (data ?? []).filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = positive.reduce((s, d) => s + d.value, 0);
  if (positive.length === 0 || total <= 0) {
    return emptyState(opts.width, opts.height, opts.emptyNote);
  }
  const w = opts.width ?? 220;
  const h = opts.height ?? 220;
  // Category legend reserves a bottom strip inside the SAME viewBox height (opts.height
  // keeps its external meaning) — the ring shrinks to make room, same pattern used by
  // the other chart primitives. Capped so a long category list can't collapse the ring.
  const legendH = Math.min(h * 0.5, legendHeight(positive.length));
  const ringAreaH = Math.max(60, h - legendH);
  const cx = w / 2;
  const cy = ringAreaH / 2;
  const rad = Math.min(w, ringAreaH) / 2 - 14;
  const stroke = Math.max(10, rad * 0.34);
  const rOuter = rad + stroke / 2;
  const rInner = Math.max(0, rad - stroke / 2);

  // d3-pie lays out the segments (start at 12 o'clock, clockwise — same as the
  // hand-rolled `-π/2` start), d3-arc renders each as a true filled annulus with
  // a small padAngle gap and rounded corners. A lone full-circle segment gets no
  // pad/corner so it stays a clean ring.
  const single = positive.length === 1;
  const arcGen = d3arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(rInner)
    .outerRadius(rOuter)
    .padAngle(single ? 0 : 0.02)
    .cornerRadius(single ? 0 : Math.min(6, stroke / 2));
  const layout = d3pie<LabeledValue>()
    .sort(null)
    .value((d) => d.value)(positive);
  const segs = layout
    .map((sliceArc, i) => {
      const d = arcGen({ startAngle: sliceArc.startAngle, endAngle: sliceArc.endAngle }) ?? "";
      return `<path d="${d}" fill="${seriesColor(i)}" transform="translate(${r(cx)},${r(cy)})"/>`;
    })
    .join("");

  const centerLabel = `${Math.round((positive[0].value / total) * 100)}%`;
  // Category legend — one row per segment, RTL (swatch on the right, label growing
  // left from it). Skipped for a single-category donut: nothing to distinguish.
  const legend =
    positive.length > 1
      ? legendRows(
          positive.map((d, i) => ({
            label: `${d.label} · ${Math.round((d.value / total) * 100)}%`,
            colorIndex: i,
          })),
          w,
          h - legendH + 4,
        )
      : "";

  return (
    svgOpen(w, h) +
    `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="none" stroke="${cssVar("line")}" stroke-width="${r(stroke)}"/>` +
    segs +
    `<text x="${r(cx)}" y="${r(cy)}" text-anchor="middle" dominant-baseline="middle" font-size="${TYPE.subtitle}" font-weight="800" fill="${cssVar("text")}">${escText(centerLabel)}</text>` +
    legend +
    `</svg>`
  );
}

// ── gauge — single percentage on a 180° arc ─────────────────────────────────

export function gauge(value: number | null, opts: ChartOpts = {}): string {
  const pct = clampPct(value);
  if (pct === null) return emptyState(opts.width, opts.height ?? 150, opts.emptyNote);
  const w = opts.width ?? 240;
  const h = opts.height ?? 150;
  // Reserve a thin strip under the dial for 0%/100% axis-reference ticks, inside the
  // SAME viewBox height (opts.height keeps meaning what callers expect) — the dial
  // shrinks slightly to make room, same pattern used by the other chart primitives.
  const tickAreaH = TYPE.micro + 8;
  const dialH = h - tickAreaH;
  const cx = w / 2;
  const cy = dialH - 18;
  const rad = Math.min(w / 2, dialH - 24) - 8;
  const stroke = Math.max(10, rad * 0.22);
  // Upper semicircle, low→high reading left→right (a physical dial). In d3-arc's
  // convention (0 = 12 o'clock, clockwise +), the left end is −π/2 and the right
  // end is +π/2, so the value sweeps −π/2 → −π/2 + (pct/100)·π.
  const A_START = -Math.PI / 2;
  const A_END = Math.PI / 2;
  const aVal = A_START + (pct / 100) * Math.PI;
  const role =
    pct >= 90 ? "success" : pct >= 75 ? "primary" : pct >= 50 ? "info" : "danger";
  const dialArc = d3arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(rad - stroke / 2)
    .outerRadius(rad + stroke / 2)
    .cornerRadius(stroke / 2);
  // Axis reference labels at the two ends of the dial's scale. The dial itself stays
  // geometric (a semicircle always reads low→high left→right, like a physical gauge) —
  // only the tick text-anchors are RTL-tuned so neither label runs past the viewBox.
  const tickY = h - 4;
  const axis =
    `<text x="${r(cx - rad)}" y="${r(tickY)}" text-anchor="start" font-size="${TYPE.micro}" fill="${cssVar("muted")}">0%</text>` +
    `<text x="${r(cx + rad)}" y="${r(tickY)}" text-anchor="end" font-size="${TYPE.micro}" fill="${cssVar("muted")}">100%</text>`;

  const trackPath = dialArc({ startAngle: A_START, endAngle: A_END }) ?? "";
  const valuePath = dialArc({ startAngle: A_START, endAngle: aVal }) ?? "";
  return (
    svgOpen(w, h) +
    `<g transform="translate(${r(cx)},${r(cy)})">` +
    `<path d="${trackPath}" fill="${cssVar("line")}"/>` +
    (pct > 0 ? `<path d="${valuePath}" fill="${cssVar(role)}"/>` : "") +
    `</g>` +
    `<text x="${r(cx)}" y="${r(cy - 6)}" text-anchor="middle" font-size="${TYPE.title}" font-weight="800" fill="${cssVar("text")}">${r(Math.round(pct))}%</text>` +
    axis +
    `</svg>`
  );
}

// ── groupedBars ─────────────────────────────────────────────────────────────

function seriesMax(s: SeriesGroup): number {
  let m = 0;
  for (const ser of s.series) {
    for (const v of ser.values) if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

export function groupedBars(data: SeriesGroup, opts: ChartOpts = {}): string {
  if (!data || data.groups.length === 0 || data.series.length === 0) {
    return emptyState(opts.width, opts.height, opts.emptyNote);
  }
  const w = opts.width ?? 360;
  const h = opts.height ?? 200;
  const padBottom = 24;
  const padTop = 10;
  // Series legend reserves a bottom strip inside the SAME viewBox height — the plot
  // shrinks to make room, same pattern used by the other chart primitives. Skipped for
  // a single series (legendHeight returns 0): nothing to distinguish, so behavior is
  // identical to before this change.
  const legendH = legendHeight(data.series.length);
  const plotH = Math.max(20, h - padBottom - padTop - legendH);
  const max = seriesMax(data);
  const groupW = w / data.groups.length;
  const sCount = data.series.length;
  const barW = Math.max(4, (groupW * 0.7) / sCount);

  let bars = "";
  data.groups.forEach((g, gi) => {
    const gx = gi * groupW + groupW * 0.15;
    data.series.forEach((ser, si) => {
      const v = Number.isFinite(ser.values[gi]) ? Math.max(0, ser.values[gi]) : 0;
      const frac = max > 0 ? v / max : 0; // divide-by-zero guard
      const bh = clamp(frac, 0, 1) * plotH;
      const x = gx + si * barW;
      const y = padTop + (plotH - bh);
      bars += `<rect x="${r(x)}" y="${r(y)}" width="${r(barW - 1)}" height="${r(bh)}" rx="2" fill="${seriesColor(si)}"/>`;
    });
    bars += `<text x="${r(gi * groupW + groupW / 2)}" y="${r(padTop + plotH + 16)}" text-anchor="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(g)}</text>`;
  });

  const legend =
    data.series.length > 1
      ? legendRows(
          data.series.map((s, i) => ({ label: s.label, colorIndex: i })),
          w,
          h - legendH + 4,
        )
      : "";

  return (
    svgOpen(w, h) +
    `<line x1="0" y1="${r(padTop + plotH)}" x2="${r(w)}" y2="${r(padTop + plotH)}" stroke="${cssVar("line")}" stroke-width="1"/>` +
    bars +
    legend +
    `</svg>`
  );
}

// ── stackedBars ─────────────────────────────────────────────────────────────

export function stackedBars(data: SeriesGroup, opts: ChartOpts = {}): string {
  if (!data || data.groups.length === 0 || data.series.length === 0) {
    return emptyState(opts.width, opts.height, opts.emptyNote);
  }
  const w = opts.width ?? 360;
  const h = opts.height ?? 200;
  const padBottom = 24;
  const padTop = 10;
  // Series legend reserves a bottom strip inside the SAME viewBox height — see
  // groupedBars for the identical pattern (kept consistent between the two).
  const legendH = legendHeight(data.series.length);
  const plotH = Math.max(20, h - padBottom - padTop - legendH);
  // tallest stack total across groups
  let max = 0;
  data.groups.forEach((_, gi) => {
    let sum = 0;
    for (const ser of data.series) {
      const v = ser.values[gi];
      if (Number.isFinite(v) && v > 0) sum += v;
    }
    if (sum > max) max = sum;
  });
  const groupW = w / data.groups.length;
  const barW = Math.max(6, groupW * 0.55);

  let bars = "";
  data.groups.forEach((g, gi) => {
    const x = gi * groupW + (groupW - barW) / 2;
    let yCursor = padTop + plotH;
    data.series.forEach((ser, si) => {
      const v = Number.isFinite(ser.values[gi]) ? Math.max(0, ser.values[gi]) : 0;
      const frac = max > 0 ? v / max : 0; // divide-by-zero guard
      const bh = clamp(frac, 0, 1) * plotH;
      yCursor -= bh;
      if (bh > 0) {
        bars += `<rect x="${r(x)}" y="${r(yCursor)}" width="${r(barW)}" height="${r(bh)}" fill="${seriesColor(si)}"/>`;
      }
    });
    bars += `<text x="${r(gi * groupW + groupW / 2)}" y="${r(padTop + plotH + 16)}" text-anchor="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(g)}</text>`;
  });

  const legend =
    data.series.length > 1
      ? legendRows(
          data.series.map((s, i) => ({ label: s.label, colorIndex: i })),
          w,
          h - legendH + 4,
        )
      : "";

  return (
    svgOpen(w, h) +
    `<line x1="0" y1="${r(padTop + plotH)}" x2="${r(w)}" y2="${r(padTop + plotH)}" stroke="${cssVar("line")}" stroke-width="1"/>` +
    bars +
    legend +
    `</svg>`
  );
}

// ── quadrantScatter — accuracy (x) × detection (y), 4 quadrants ──────────────

export function quadrantScatter(data: ScatterPoint[], opts: ChartOpts = {}): string {
  if (!data || data.length === 0) return emptyState(opts.width, opts.height, opts.emptyNote);
  const w = opts.width ?? 280;
  const h = opts.height ?? 280;
  const pad = 16;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const midX = pad + plotW / 2;
  const midY = pad + plotH / 2;

  // x,y are 0–100 percentages → clamp into plot box. RTL: higher x to the LEFT.
  const dots = data
    .map((p, i) => {
      const px = clamp(Number.isFinite(p.x) ? p.x : 0, 0, 100);
      const py = clamp(Number.isFinite(p.y) ? p.y : 0, 0, 100);
      const cx = pad + (1 - px / 100) * plotW; // RTL flip
      const cy = pad + (1 - py / 100) * plotH; // higher y = up
      return `<circle cx="${r(cx)}" cy="${r(cy)}" r="4" fill="${seriesColor(i)}" fill-opacity="0.85"/>`;
    })
    .join("");

  return (
    svgOpen(w, h) +
    `<rect x="${r(pad)}" y="${r(pad)}" width="${r(plotW)}" height="${r(plotH)}" fill="none" stroke="${cssVar("line")}" stroke-width="1"/>` +
    `<line x1="${r(midX)}" y1="${r(pad)}" x2="${r(midX)}" y2="${r(pad + plotH)}" stroke="${cssVar("line")}" stroke-width="1" stroke-dasharray="3 3"/>` +
    `<line x1="${r(pad)}" y1="${r(midY)}" x2="${r(pad + plotW)}" y2="${r(midY)}" stroke="${cssVar("line")}" stroke-width="1" stroke-dasharray="3 3"/>` +
    dots +
    `</svg>`
  );
}

// ── heatmap — labeled N×M matrix, intensity = value share ───────────────────

export function heatmap(data: Matrix, opts: ChartOpts = {}): string {
  if (!data || data.rows.length === 0 || data.cols.length === 0) {
    return emptyState(opts.width, opts.height, opts.emptyNote);
  }
  const rowLabelW = 96;
  const colLabelH = 20;
  const legendH = TYPE.micro + 14; // intensity-scale strip reserved at the bottom
  const cell = 34;
  const w = opts.width ?? rowLabelW + data.cols.length * cell + 4;
  const h = opts.height ?? colLabelH + data.rows.length * cell + legendH + 4;
  const gridW = w - rowLabelW - 2;
  const gridH = h - colLabelH - legendH - 2;
  const cw = gridW / data.cols.length;
  const ch = gridH / data.rows.length;

  // max for intensity normalization (ignore null/non-finite)
  let max = 0;
  for (const row of data.values) {
    for (const v of row ?? []) {
      if (v !== null && Number.isFinite(v) && (v as number) > max) max = v as number;
    }
  }

  let cells = "";
  data.rows.forEach((rowLabel, ri) => {
    const y = colLabelH + ri * ch;
    cells += `<text x="${r(w - 2)}" y="${r(y + ch / 2)}" text-anchor="end" dominant-baseline="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(rowLabel)}</text>`;
    data.cols.forEach((_, ci) => {
      const x = ci * cw;
      const raw = data.values?.[ri]?.[ci];
      const isNull = raw === null || raw === undefined || !Number.isFinite(raw as number);
      const v = isNull ? 0 : (raw as number);
      const intensity = max > 0 ? clamp(v / max, 0, 1) : 0; // divide-by-zero guard
      const fillOpacity = isNull ? 0 : 0.12 + intensity * 0.78;
      const cellFill = isNull ? "none" : cssVar("info");
      cells +=
        `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(cw - 2)}" height="${r(ch - 2)}" rx="3" fill="${cellFill}" fill-opacity="${r(fillOpacity)}" stroke="${cssVar("line")}" stroke-width="0.5"/>` +
        `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" font-size="${TYPE.micro}" fill="${cssVar("text")}">${isNull ? "—" : r(v)}</text>`;
    });
  });

  // column labels along the top
  let colLabels = "";
  data.cols.forEach((c, ci) => {
    colLabels += `<text x="${r(ci * cw + cw / 2)}" y="${r(colLabelH - 6)}" text-anchor="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(c)}</text>`;
  });

  // Intensity legend — a short 4-step opacity ramp explaining the cell color-coding.
  // RTL: "الأعلى" (highest) sits on the left next to the darkest swatch, "أقل" (lowest)
  // on the right next to the lightest — mirrors the right=baseline/left=ceiling
  // convention used by rankedBar's axis row above.
  const steps = 4;
  const swW = 16;
  const swGap = 2;
  const legendW = steps * swW + (steps - 1) * swGap;
  const legendX0 = w / 2 - legendW / 2;
  const legendY = h - legendH + 6;
  let legendSwatches = "";
  for (let i = 0; i < steps; i++) {
    const op = 0.12 + ((steps - 1 - i) / (steps - 1)) * 0.78;
    const x = legendX0 + i * (swW + swGap);
    legendSwatches += `<rect x="${r(x)}" y="${r(legendY)}" width="${r(swW)}" height="8" rx="2" fill="${cssVar("info")}" fill-opacity="${r(op)}"/>`;
  }
  const legend =
    max > 0
      ? `<text x="${r(legendX0 - 6)}" y="${r(legendY + 7)}" text-anchor="end" font-size="${TYPE.micro}" fill="${cssVar("muted")}">الأعلى (${r(max)})</text>` +
        legendSwatches +
        `<text x="${r(legendX0 + legendW + 6)}" y="${r(legendY + 7)}" text-anchor="start" font-size="${TYPE.micro}" fill="${cssVar("muted")}">أقل</text>`
      : "";

  return svgOpen(w, h) + colLabels + cells + legend + `</svg>`;
}

// ── funnel — sequential stage-conversion bars (population → … → اشتباه) ───────
// Vertically stacked, horizontally centered bars whose width is proportional to
// each stage's value against the FIRST (widest) stage — the classic conversion
// funnel. RTL-native: the stage label sits on the right, the value on the left,
// both outside the bar so they never collide with the fill color (anti-slop rule:
// text never in a chart-series color). Each bar is directly labeled and separated
// by a vertical gap, which is the secondary encoding that makes the brand stage
// tones legible under CVD. Pure SVG, no runtime JS, empty-state safe.
export function funnel(data: LabeledValue[], opts: ChartOpts = {}): string {
  const clean = (data ?? []).filter((d) => Number.isFinite(d.value) && d.value >= 0);
  if (clean.length === 0) return emptyState(opts.width, opts.height, opts.emptyNote);
  const w = opts.width ?? 360;
  const h = opts.height ?? 240;
  const max = Math.max(1, ...clean.map((d) => d.value));
  const n = clean.length;
  const padTop = 6;
  const padBottom = 6;
  const rowH = (h - padTop - padBottom) / n;
  const barH = Math.max(14, rowH * 0.62);
  const cx = w / 2;
  const maxBarW = w * 0.5; // leave room for label (right) + value (left)
  const minBarW = 26;

  // Smooth connector between a stage and the next (narrower) one: a d3-area whose
  // left/right edges bump-curve from this bar's half-width to the next bar's, so
  // the "flow" reads as an organic funnel rather than a hard trapezoid.
  const wedge = d3area<{ y: number; hw: number }>()
    .x0((p) => cx - p.hw)
    .x1((p) => cx + p.hw)
    .y((p) => p.y)
    .curve(curveBumpY);

  let bars = "";
  clean.forEach((d, i) => {
    const frac = d.value / max;
    const bw = Math.max(minBarW, frac * maxBarW);
    const x = cx - bw / 2;
    const y = padTop + i * rowH + (rowH - barH) / 2;
    const midY = y + barH / 2;
    // Connector to the next (narrower) stage — a faint neutral wedge that reads
    // as "flow" without competing with the tone-coded bars.
    if (i < n - 1) {
      const nextFrac = clean[i + 1].value / max;
      const nbw = Math.max(minBarW, nextFrac * maxBarW);
      const y2 = padTop + (i + 1) * rowH + (rowH - barH) / 2;
      const gapTop = y + barH;
      const wedgePath =
        wedge([
          { y: gapTop, hw: bw / 2 },
          { y: y2, hw: nbw / 2 },
        ]) ?? "";
      bars += `<path d="${wedgePath}" fill="${cssVar("line")}" fill-opacity="0.5"/>`;
    }
    bars +=
      `<rect x="${r(x)}" y="${r(y)}" width="${r(bw)}" height="${r(barH)}" rx="6" fill="${seriesColor(i)}"/>` +
      // stage label — right side (RTL start), neutral text color
      `<text x="${r(cx + maxBarW / 2 + 10)}" y="${r(midY)}" text-anchor="start" dominant-baseline="middle" font-size="${TYPE.caption}" font-weight="700" fill="${cssVar("text")}">${escText(d.label)}</text>` +
      // value — left side (RTL end), primary accent
      `<text x="${r(cx - maxBarW / 2 - 10)}" y="${r(midY)}" text-anchor="end" dominant-baseline="middle" font-size="${TYPE.body}" font-weight="800" fill="${cssVar("text")}">${escText(fmtCompact(d.value))}</text>`;
  });

  return svgOpen(w, h) + bars + `</svg>`;
}

/** Compact integer for chart labels: thousands as "k" so long funnel counts
 *  don't overrun the reserved label gutter. Latin digits (matches chart axes). */
function fmtCompact(v: number): string {
  const n = Math.round(v);
  if (n >= 10000) return String(Math.round(n / 1000)) + "k";
  return String(n);
}

// ── sparkline — compact trend line ──────────────────────────────────────────

export function sparkline(values: number[], opts: ChartOpts = {}): string {
  const data = (values ?? []).filter((v) => Number.isFinite(v));
  if (data.length === 0) return emptyState(opts.width ?? 120, opts.height ?? 32, opts.emptyNote);
  const w = opts.width ?? 120;
  const h = opts.height ?? 32;
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min; // may be 0 for a flat line
  const n = data.length;

  // d3 scales map index→x and value→y; a flat series widens the domain by ±1 so
  // the line centers vertically (no divide-by-zero). curveMonotoneX renders a
  // smooth trend that never overshoots the data points.
  const x = scaleLinear()
    .domain([0, Math.max(1, n - 1)])
    .range([pad, w - pad]);
  const y = scaleLinear()
    .domain(range === 0 ? [min - 1, max + 1] : [min, max])
    .range([h - pad, pad]);
  const yAt = (v: number) => y(v);

  if (n === 1) {
    return (
      svgOpen(w, h) +
      `<circle cx="${r(w / 2)}" cy="${r(h / 2)}" r="2.5" fill="${cssVar("primary")}"/>` +
      `</svg>`
    );
  }

  const dPath =
    d3line<number>()
      .x((_, i) => x(i))
      .y((v) => y(v))
      .curve(curveMonotoneX)(data) ?? "";

  return (
    svgOpen(w, h) +
    `<path d="${dPath}" fill="none" stroke="${cssVar("primary")}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${r(x(n - 1))}" cy="${r(yAt(data[n - 1]))}" r="2" fill="${cssVar("primary")}"/>` +
    `</svg>`
  );
}
