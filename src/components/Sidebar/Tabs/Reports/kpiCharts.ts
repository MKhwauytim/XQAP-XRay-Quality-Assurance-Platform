// Hand-rolled inline-SVG chart primitives for the KPI dashboard (مؤشرات الأداء).
//
// Same discipline as `data/reporting/executive/ui/charts.ts`: every chart is a
// PURE (data, labels) => string function — no React, no DOM, no chart library
// (Recharts is deliberately not a dependency). These differ from the executive
// report's primitives in exactly one respect: they paint with the APP's design
// tokens (`var(--c-…)` from src/index.css) rather than the exported report's
// own theme variables, because they render inside the app shell.
//
// Rules kept from the report primitives:
//   • null / empty / zero-denominator data → neutral "—" state, never throw
//   • percentages clamped to 0–100
//   • every caller-supplied label routed through esc()
//   • `direction:ltr` on the <svg> so text-anchor="start|end" cannot mirror
//     under the app's dir="rtl"; RTL is expressed in the coordinate math
//   • no raw #hex: every colour is a token reference

import type { AnswerGroup, InaccuracyCalendar } from "./kpiSelectors";

const C = {
  navy: "var(--c-navy)",
  navySoft: "var(--c-navy-soft)",
  sky: "var(--c-sky)",
  ink: "var(--c-ink)",
  ink2: "var(--c-ink-2)",
  ink3: "var(--c-ink-3)",
  ink4: "var(--c-ink-4)",
  border: "var(--c-border)",
  surface: "var(--c-surface)",
  surface2: "var(--c-surface-2)",
  teal: "var(--c-teal-deep)",
  coral: "var(--c-coral)",
  gold: "var(--brand-premium)",
} as const;

/** Ordered outcome palette — سليمة صحيحة / اشتباه صحيح / اشتباه فائت / اشتباه زائد. */
export const OUTCOME_COLORS = [C.teal, C.sky, C.coral, C.gold] as const;

/** اشتباه / سليمة / غير مكتملة, in the design's series order. */
const ANSWER_COLORS = [C.coral, C.teal, C.ink4] as const;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** App standard: Latin (Western) digits, not the Arabic-Indic digits "ar-SA" yields. */
function nf(value: number): string {
  return value.toLocaleString("ar-SA-u-nu-latn");
}

function r(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function clampPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function open(w: number, h: number, extraStyle = ""): string {
  return (
    `<svg viewBox="0 0 ${r(w)} ${r(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="100%" style="direction:ltr;display:block;${extraStyle}">`
  );
}

function emptyState(w: number, h: number, note: string): string {
  return (
    open(w, h) +
    `<text x="${r(w / 2)}" y="${r(h / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-size="24" font-weight="800" fill="${C.ink4}">—</text>` +
    `<text x="${r(w / 2)}" y="${r(h / 2 + 22)}" text-anchor="middle" font-size="11" ` +
    `fill="${C.ink3}">${esc(note)}</text>` +
    `</svg>`
  );
}

// ── gauge ───────────────────────────────────────────────────────────────────

/** Value colour by threshold, per the design brief. */
function gaugeTone(pct: number): string {
  return pct >= 90 ? C.teal : pct >= 75 ? C.sky : pct >= 50 ? C.gold : C.coral;
}

/**
 * 180° semicircle gauge, 320×200, round caps. The dial radius is inset by
 * `stroke/2` (plus a 2px margin) so the round caps stay INSIDE the viewBox
 * instead of being clipped at the left/right ends.
 */
export function gaugeSvg(value: number | null, emptyNote: string): string {
  const pct = clampPct(value);
  const w = 320;
  const h = 200;
  if (pct === null) return emptyState(w, h, emptyNote);
  const dialH = 182;
  const cx = w / 2;
  const cy = dialH - 18;
  const rad0 = Math.min(w / 2, dialH - 24) - 10;
  const stroke = Math.max(12, rad0 * 0.2);
  const rad = rad0 - stroke / 2 - 2;
  const theta = Math.PI * (pct / 100);
  const ex = cx - rad * Math.cos(theta);
  const ey = cy - rad * Math.sin(theta);
  const track = `M ${r(cx - rad)} ${r(cy)} A ${r(rad)} ${r(rad)} 0 0 1 ${r(cx + rad)} ${r(cy)}`;
  const val = `M ${r(cx - rad)} ${r(cy)} A ${r(rad)} ${r(rad)} 0 0 1 ${r(ex)} ${r(ey)}`;
  return (
    open(w, h) +
    `<path d="${track}" fill="none" stroke="${C.navySoft}" stroke-width="${r(stroke)}" stroke-linecap="round"/>` +
    (pct > 0
      ? `<path d="${val}" fill="none" stroke="${gaugeTone(pct)}" stroke-width="${r(stroke)}" stroke-linecap="round"/>`
      : "") +
    `<text x="${r(cx)}" y="${r(cy - 10)}" text-anchor="middle" font-size="38" font-weight="900" fill="${C.navy}">${esc(`${pct.toFixed(1)}%`)}</text>` +
    `<text x="${r(cx - rad)}" y="${r(h - 4)}" text-anchor="start" font-size="11" fill="${C.ink4}">0%</text>` +
    `<text x="${r(cx + rad)}" y="${r(h - 4)}" text-anchor="end" font-size="11" fill="${C.ink4}">100%</text>` +
    `</svg>`
  );
}

// ── outcome donut ───────────────────────────────────────────────────────────

export type DonutSlice = { label: string; value: number };

/** Ring on the left, 4-row legend on the right; centre shows the dominant share. */
export function outcomeDonutSvg(data: DonutSlice[], emptyNote: string): string {
  const w = 320;
  const h = 200;
  const positive = data.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = positive.reduce((sum, d) => sum + d.value, 0);
  if (positive.length === 0 || total <= 0) return emptyState(w, h, emptyNote);

  const cx = 110;
  const cy = h / 2;
  const rad = 72;
  const stroke = 30;
  const rOuter = rad + stroke / 2;
  const rInner = rad - stroke / 2;
  let angle = -Math.PI / 2;
  let segments = "";
  if (positive.length === 1) {
    // A lone slice sweeps the full 2π, so its arc would start and end on the same point
    // — SVG omits an arc whose endpoints coincide, collapsing the ring to nothing. Draw
    // the same annulus as a stroked circle instead, which is always visible.
    segments =
      `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="none" ` +
      `stroke="${OUTCOME_COLORS[0]}" stroke-width="${r(stroke)}"/>`;
  } else {
    positive.forEach((slice, index) => {
      const sweep = (slice.value / total) * Math.PI * 2;
      const start = angle + 0.015;
      const end = angle + sweep - 0.015;
      angle += sweep;
      const large = end - start > Math.PI ? 1 : 0;
      const point = (radius: number, a: number) =>
        `${r(cx + radius * Math.cos(a))} ${r(cy + radius * Math.sin(a))}`;
      segments +=
        `<path d="M ${point(rOuter, start)} A ${r(rOuter)} ${r(rOuter)} 0 ${large} 1 ${point(rOuter, end)} ` +
        `L ${point(rInner, end)} A ${r(rInner)} ${r(rInner)} 0 ${large} 0 ${point(rInner, start)} Z" ` +
        `fill="${OUTCOME_COLORS[index % OUTCOME_COLORS.length]}"/>`;
    });
  }

  // Legend anchored to the right edge (RTL: swatch outermost, label growing left).
  let legend = "";
  const rowGap = 34;
  const legendTop = cy - ((positive.length - 1) * rowGap) / 2;
  positive.forEach((slice, index) => {
    const y = legendTop + index * rowGap;
    const share = (slice.value / total) * 100;
    legend +=
      `<rect x="${r(w - 14)}" y="${r(y - 9)}" width="10" height="10" rx="3" fill="${OUTCOME_COLORS[index % OUTCOME_COLORS.length]}"/>` +
      `<text x="${r(w - 30)}" y="${r(y)}" text-anchor="end" font-size="12" font-weight="700" fill="${C.ink}">${esc(slice.label)}</text>` +
      `<text x="${r(w - 30)}" y="${r(y + 14)}" text-anchor="end" font-size="11" fill="${C.ink3}">${esc(`${nf(slice.value)} · ${share.toFixed(1)}%`)}</text>`;
  });

  const dominant = positive.reduce((best, d) => (d.value > best.value ? d : best), positive[0]!);
  return (
    open(w, h) +
    segments +
    `<text x="${r(cx)}" y="${r(cy - 4)}" text-anchor="middle" font-size="26" font-weight="900" fill="${C.navy}">${esc(`${Math.round((dominant.value / total) * 100)}%`)}</text>` +
    `<text x="${r(cx)}" y="${r(cy + 16)}" text-anchor="middle" font-size="11" fill="${C.ink3}">${esc(dominant.label)}</text>` +
    legend +
    `</svg>`
  );
}

// ── grouped answer bars ─────────────────────────────────────────────────────

/** Round `value` up to a "nice" axis maximum divisible into four clean steps. */
function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const step = magnitude / 2 || 1;
  return Math.max(4, Math.ceil(value / (step * 4)) * step * 4);
}

/**
 * Grouped vertical bars — اشتباه / سليمة / غير مكتملة per reviewer (or port).
 * RTL: the FIRST group sits at the right edge, and within each group اشتباه is
 * the rightmost bar.
 */
export function answersBarsSvg(groups: AnswerGroup[], emptyNote: string): string {
  const W = 960;
  const H = 340;
  if (groups.length === 0) return emptyState(W, H, emptyNote);
  const plot = { top: 24, right: 916, bottom: 268, left: 44 };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const dataMax = groups.reduce(
    (max, g) => Math.max(max, g.suspicion, g.clean, g.incomplete),
    0
  );
  const axisMax = niceMax(dataMax);
  const yFor = (v: number) => plot.bottom - (v / axisMax) * ph;
  const groupW = pw / groups.length;
  const barW = Math.min(34, (groupW * 0.66) / 3);
  const gap = Math.min(6, barW * 0.25);

  let out = "";
  for (let tick = 0; tick <= 4; tick += 1) {
    const v = (axisMax / 4) * tick;
    const y = yFor(v);
    out +=
      `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(y)}" y2="${r(y)}" stroke="${C.border}" stroke-dasharray="2 4"/>` +
      `<text x="${r(plot.right + 8)}" y="${r(y + 4)}" font-size="11" fill="${C.ink3}">${esc(nf(v))}</text>`;
  }
  out += `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(plot.bottom)}" y2="${r(plot.bottom)}" stroke="${C.ink3}"/>`;

  groups.forEach((group, gi) => {
    const gx = plot.right - (gi + 1) * groupW;
    const centre = gx + groupW / 2;
    const totalBarsW = 3 * barW + 2 * gap;
    [group.suspicion, group.clean, group.incomplete].forEach((value, si) => {
      const x = centre + totalBarsW / 2 - (si + 1) * barW - si * gap;
      const y = yFor(value);
      const barH = Math.max(0, plot.bottom - y);
      out +=
        `<rect x="${r(x)}" y="${r(y)}" width="${r(barW)}" height="${r(barH)}" rx="4" fill="${ANSWER_COLORS[si]}"/>` +
        `<text x="${r(x + barW / 2)}" y="${r(y - 6)}" text-anchor="middle" font-size="10.5" font-weight="800" fill="${C.ink2}">${esc(nf(value))}</text>`;
    });
    out += `<text x="${r(centre)}" y="${r(plot.bottom + 20)}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink}" direction="rtl">${esc(group.label)}</text>`;
  });
  return open(W, H, "min-width:720px;height:auto") + out + `</svg>`;
}

// ── port × outcome matrix ───────────────────────────────────────────────────

export type Matrix = { rows: string[]; cols: string[]; values: number[][] };

export function portMatrixSvg(
  data: Matrix,
  legend: { high: string; low: string },
  emptyNote: string
): string {
  if (data.rows.length === 0 || data.cols.length === 0) {
    return emptyState(560, 200, emptyNote);
  }
  const rowLabelW = 150;
  const colLabelH = 26;
  const legendH = 28;
  const cell = 52;
  const w = rowLabelW + data.cols.length * cell * 2 + 4;
  const h = colLabelH + data.rows.length * cell + legendH + 4;
  const gridW = w - rowLabelW - 2;
  const gridH = h - colLabelH - legendH - 2;
  const cw = gridW / data.cols.length;
  const ch = gridH / data.rows.length;
  let max = 0;
  for (const row of data.values) for (const v of row) if (v > max) max = v;

  let out = "";
  data.cols.forEach((col, ci) => {
    out += `<text x="${r(ci * cw + cw / 2)}" y="${r(colLabelH - 8)}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink3}">${esc(col)}</text>`;
  });
  data.rows.forEach((label, ri) => {
    const y = colLabelH + ri * ch;
    out += `<text x="${r(w - 2)}" y="${r(y + ch / 2)}" text-anchor="end" dominant-baseline="middle" font-size="12" font-weight="700" fill="${C.ink}">${esc(label)}</text>`;
    data.cols.forEach((_, ci) => {
      const x = ci * cw;
      const value = data.values[ri]?.[ci] ?? 0;
      const opacity = 0.1 + (max > 0 ? value / max : 0) * 0.8;
      out +=
        `<rect x="${r(x + 2)}" y="${r(y + 2)}" width="${r(cw - 4)}" height="${r(ch - 4)}" rx="6" fill="${C.navy}" fill-opacity="${opacity.toFixed(2)}"/>` +
        `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="800" fill="${opacity > 0.5 ? C.surface : C.ink}">${esc(nf(value))}</text>`;
    });
  });
  out += intensityLegend(w, h, legendH, C.navy, 0.1, 0.8, legend, max);
  return open(w, h) + out + `</svg>`;
}

/** Shared 5-step intensity legend used by the matrix and the calendar. */
function intensityLegend(
  w: number,
  h: number,
  legendH: number,
  color: string,
  base: number,
  span: number,
  legend: { high: string; low: string },
  max: number
): string {
  const steps = 5;
  const swW = 26;
  const swGap = 3;
  const legendW = steps * swW + (steps - 1) * swGap;
  const lx0 = w / 2 - legendW / 2;
  const ly = h - legendH + 10;
  let out = "";
  for (let i = 0; i < steps; i += 1) {
    const opacity = base + ((steps - 1 - i) / (steps - 1)) * span;
    out += `<rect x="${r(lx0 + i * (swW + swGap))}" y="${r(ly)}" width="${swW}" height="10" rx="3" fill="${color}" fill-opacity="${opacity.toFixed(2)}"/>`;
  }
  out += `<text x="${r(lx0 - 8)}" y="${r(ly + 9)}" text-anchor="end" font-size="11" fill="${C.ink3}">${esc(legend.high.replace("{n}", nf(max)))}</text>`;
  out += `<text x="${r(lx0 + legendW + 8)}" y="${r(ly + 9)}" text-anchor="start" font-size="11" fill="${C.ink3}">${esc(legend.low)}</text>`;
  return out;
}

// ── month inaccuracy calendar ───────────────────────────────────────────────

/**
 * Month calendar heatmap, 7 RTL columns (السبت rightmost). Fridays render as a
 * flat "عطلة" cell — no review work is recorded on them.
 */
export function inaccuracyCalendarSvg(
  calendar: InaccuracyCalendar,
  weekdays: string[],
  holidayLabel: string,
  legend: { high: string; low: string }
): string {
  const cell = 62;
  const gap = 6;
  const headerH = 26;
  const legendH = 30;
  const cols = 7;
  const w = cols * cell + (cols - 1) * gap;
  const h = headerH + calendar.weeks * cell + (calendar.weeks - 1) * gap + legendH;
  const max = calendar.max;

  let out = "";
  weekdays.forEach((name, i) => {
    const x = w - i * (cell + gap) - cell / 2;
    out += `<text x="${r(x)}" y="${r(headerH - 10)}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink3}">${esc(name)}</text>`;
  });
  calendar.cells.forEach((entry, slot) => {
    if (entry.day === 0) return;
    const dow = slot % 7;
    const week = Math.floor(slot / 7);
    const x = w - dow * (cell + gap) - cell;
    const y = headerH + week * (cell + gap);
    const opacity = entry.isHoliday ? 0 : 0.06 + (max > 0 ? entry.count / max : 0) * 0.84;
    const fill = entry.isHoliday ? C.surface2 : C.coral;
    out +=
      `<rect x="${r(x)}" y="${r(y)}" width="${cell}" height="${cell}" rx="8" fill="${fill}" ` +
      `fill-opacity="${entry.isHoliday ? "1" : opacity.toFixed(2)}" stroke="${C.border}" stroke-width="1"/>` +
      `<text x="${r(x + cell - 8)}" y="${r(y + 16)}" text-anchor="end" font-size="10" font-weight="600" fill="${opacity > 0.5 ? C.surface : C.ink4}">${esc(nf(entry.day))}</text>` +
      (entry.isHoliday
        ? `<text x="${r(x + cell / 2)}" y="${r(y + cell / 2 + 6)}" text-anchor="middle" font-size="10" fill="${C.ink4}">${esc(holidayLabel)}</text>`
        : `<text x="${r(x + cell / 2)}" y="${r(y + cell / 2 + 7)}" text-anchor="middle" font-size="17" font-weight="900" fill="${opacity > 0.5 ? C.surface : C.ink}">${esc(nf(entry.count))}</text>`);
  });
  out += intensityLegend(w, h, legendH, C.coral, 0.06, 0.84, legend, max);
  return open(w, h) + out + `</svg>`;
}
