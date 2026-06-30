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

import { FONT_FAMILY, TYPE, clamp, clampPct, cssVar, seriesColor } from "./tokens";

// ── shared helpers ──────────────────────────────────────────────────────────

function escText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const w = opts.width ?? 360;
  const rowH = 26;
  const gap = 8;
  const h = opts.height ?? data.length * (rowH + gap) + gap;
  const labelW = Math.min(120, Math.max(70, w * 0.32));
  const valueW = 46;
  const trackX = valueW;
  const trackW = Math.max(10, w - labelW - valueW - 10);
  const max = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)));

  const bars = data
    .map((d, i) => {
      const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
      const frac = max > 0 ? v / max : 0; // guard divide-by-zero
      const bw = clamp(frac, 0, 1) * trackW;
      const y = gap + i * (rowH + gap);
      const cy = y + rowH / 2;
      return (
        `<rect x="${r(trackX)}" y="${r(y)}" width="${r(trackW)}" height="${r(rowH)}" rx="5" fill="${cssVar("line")}"/>` +
        // RTL: bar grows from the right edge of the track leftward
        `<rect x="${r(trackX + trackW - bw)}" y="${r(y)}" width="${r(bw)}" height="${r(rowH)}" rx="5" fill="${seriesColor(i)}"/>` +
        `<text x="${r(w - 2)}" y="${r(cy)}" text-anchor="end" dominant-baseline="middle" font-size="${TYPE.caption}" fill="${cssVar("text")}">${escText(d.label)}</text>` +
        `<text x="${r(2)}" y="${r(cy)}" text-anchor="start" dominant-baseline="middle" font-size="${TYPE.caption}" font-weight="700" fill="${cssVar("muted")}">${r(v)}</text>`
      );
    })
    .join("");

  return svgOpen(w, h) + bars + `</svg>`;
}

// ── donut ───────────────────────────────────────────────────────────────────

function arcPath(cx: number, cy: number, rad: number, a0: number, a1: number): string {
  const x0 = cx + rad * Math.cos(a0);
  const y0 = cy + rad * Math.sin(a0);
  const x1 = cx + rad * Math.cos(a1);
  const y1 = cy + rad * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${r(x0)} ${r(y0)} A ${r(rad)} ${r(rad)} 0 ${large} 1 ${r(x1)} ${r(y1)}`;
}

export function donut(data: LabeledValue[], opts: ChartOpts = {}): string {
  const positive = (data ?? []).filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = positive.reduce((s, d) => s + d.value, 0);
  if (positive.length === 0 || total <= 0) {
    return emptyState(opts.width, opts.height, opts.emptyNote);
  }
  const w = opts.width ?? 220;
  const h = opts.height ?? 220;
  const cx = w / 2;
  const cy = h / 2;
  const rad = Math.min(w, h) / 2 - 14;
  const stroke = Math.max(10, rad * 0.34);

  let acc = -Math.PI / 2;
  const segs = positive
    .map((d, i) => {
      const frac = d.value / total; // total > 0 guaranteed
      const a0 = acc;
      const a1 = acc + frac * Math.PI * 2;
      acc = a1;
      // full-circle single segment: draw a ring instead of a 0-length arc
      if (frac >= 0.9999) {
        return `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="none" stroke="${seriesColor(i)}" stroke-width="${r(stroke)}"/>`;
      }
      return `<path d="${arcPath(cx, cy, rad, a0, a1)}" fill="none" stroke="${seriesColor(i)}" stroke-width="${r(stroke)}" stroke-linecap="butt"/>`;
    })
    .join("");

  const centerLabel = `${Math.round((positive[0].value / total) * 100)}%`;
  return (
    svgOpen(w, h) +
    `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="none" stroke="${cssVar("line")}" stroke-width="${r(stroke)}"/>` +
    segs +
    `<text x="${r(cx)}" y="${r(cy)}" text-anchor="middle" dominant-baseline="middle" font-size="${TYPE.subtitle}" font-weight="800" fill="${cssVar("text")}">${escText(centerLabel)}</text>` +
    `</svg>`
  );
}

// ── gauge — single percentage on a 180° arc ─────────────────────────────────

export function gauge(value: number | null, opts: ChartOpts = {}): string {
  const pct = clampPct(value);
  if (pct === null) return emptyState(opts.width, opts.height ?? 150, opts.emptyNote);
  const w = opts.width ?? 240;
  const h = opts.height ?? 150;
  const cx = w / 2;
  const cy = h - 18;
  const rad = Math.min(w / 2, h - 24) - 8;
  const stroke = Math.max(10, rad * 0.22);
  // semicircle from 180° (left) to 0° (right)
  const a0 = Math.PI;
  const a1 = Math.PI + (pct / 100) * Math.PI;
  const role =
    pct >= 90 ? "success" : pct >= 75 ? "primary" : pct >= 50 ? "info" : "danger";

  return (
    svgOpen(w, h) +
    `<path d="${arcPath(cx, cy, rad, a0, 2 * Math.PI)}" fill="none" stroke="${cssVar("line")}" stroke-width="${r(stroke)}" stroke-linecap="round"/>` +
    `<path d="${arcPath(cx, cy, rad, a0, a1)}" fill="none" stroke="${cssVar(role)}" stroke-width="${r(stroke)}" stroke-linecap="round"/>` +
    `<text x="${r(cx)}" y="${r(cy - 6)}" text-anchor="middle" font-size="${TYPE.title}" font-weight="800" fill="${cssVar("text")}">${r(Math.round(pct))}%</text>` +
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
  const plotH = h - padBottom - padTop;
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
    bars += `<text x="${r(gi * groupW + groupW / 2)}" y="${r(h - 8)}" text-anchor="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(g)}</text>`;
  });

  return (
    svgOpen(w, h) +
    `<line x1="0" y1="${r(padTop + plotH)}" x2="${r(w)}" y2="${r(padTop + plotH)}" stroke="${cssVar("line")}" stroke-width="1"/>` +
    bars +
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
  const plotH = h - padBottom - padTop;
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
    bars += `<text x="${r(gi * groupW + groupW / 2)}" y="${r(h - 8)}" text-anchor="middle" font-size="${TYPE.micro}" fill="${cssVar("muted")}">${escText(g)}</text>`;
  });

  return (
    svgOpen(w, h) +
    `<line x1="0" y1="${r(padTop + plotH)}" x2="${r(w)}" y2="${r(padTop + plotH)}" stroke="${cssVar("line")}" stroke-width="1"/>` +
    bars +
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
  const cell = 34;
  const w = opts.width ?? rowLabelW + data.cols.length * cell + 4;
  const h = opts.height ?? colLabelH + data.rows.length * cell + 4;
  const gridW = w - rowLabelW - 2;
  const gridH = h - colLabelH - 2;
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

  return svgOpen(w, h) + colLabels + cells + `</svg>`;
}

// ── sparkline — compact trend line ──────────────────────────────────────────

export function sparkline(values: number[], opts: ChartOpts = {}): string {
  const data = (values ?? []).filter((v) => Number.isFinite(v));
  if (data.length === 0) return emptyState(opts.width ?? 120, opts.height ?? 32, opts.emptyNote);
  const w = opts.width ?? 120;
  const h = opts.height ?? 32;
  const pad = 3;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min; // may be 0 for a flat line
  const n = data.length;

  const xAt = (i: number) => (n === 1 ? w / 2 : pad + (i / (n - 1)) * plotW);
  const yAt = (v: number) => {
    if (range === 0) return pad + plotH / 2; // flat-line guard (no divide-by-zero)
    return pad + (1 - (v - min) / range) * plotH;
  };

  if (n === 1) {
    return (
      svgOpen(w, h) +
      `<circle cx="${r(w / 2)}" cy="${r(h / 2)}" r="2.5" fill="${cssVar("primary")}"/>` +
      `</svg>`
    );
  }

  const dPath = data
    .map((v, i) => `${i === 0 ? "M" : "L"} ${r(xAt(i))} ${r(yAt(v))}`)
    .join(" ");

  return (
    svgOpen(w, h) +
    `<path d="${dPath}" fill="none" stroke="${cssVar("primary")}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${r(xAt(n - 1))}" cy="${r(yAt(data[n - 1]))}" r="2" fill="${cssVar("primary")}"/>` +
    `</svg>`
  );
}
