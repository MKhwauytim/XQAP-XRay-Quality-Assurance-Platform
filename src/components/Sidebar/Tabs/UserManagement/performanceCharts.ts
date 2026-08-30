// Hand-rolled inline-SVG chart primitive for تقييم الأداء (employee
// performance evaluation). Scoped to UserManagement — deliberately NOT
// shared with Reports/kpiCharts.ts, which is that tab's own chart module.
// Same discipline as both kpiCharts.ts and
// data/reporting/executive/ui/charts.ts:
//   • null / empty data → neutral "—" state, never throw
//   • every caller-supplied label routed through esc()
//   • direction:ltr on the <svg>; RTL expressed in the coordinate math
//   • no raw #hex — every colour is a var(--c-…) token
//
// The working-hours strip (per-employee/per-day timeline with gap chips) is
// deliberately NOT an SVG — it needs per-segment text chips and tooltips
// that read far more naturally as plain HTML, so it is built directly in
// PerformanceSection.tsx as flex/absolute-positioned elements instead.

const C = {
  navy: "var(--c-navy)",
  ink: "var(--c-ink)",
  ink3: "var(--c-ink-3)",
  ink4: "var(--c-ink-4)",
  border: "var(--c-border)",
  gold: "var(--brand-premium)",
  goldBg: "var(--c-warning-bg)",
  sky: "var(--c-sky)",
} as const;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function r(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
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

export type DayCount = { day: string; count: number };

/** Arithmetic mean of a set of daily counts (0 for an empty set) — shared by the chart's own average line and the caller's "المتوسط اليومي" badge so both always agree. */
export function averageCount(points: readonly DayCount[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.count, 0) / points.length;
}

function formatAvgTick(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Samples-finished-per-day bar chart, with a dashed average-value reference
 * line so each bar reads against a baseline instead of in isolation. RTL:
 * the EARLIEST day sits at the right edge, most recent at the left — same
 * date-axis direction as Reports' inaccuracyCalendarSvg and the executive
 * report's timeSeriesBand.
 */
export function samplesTrendSvg(points: readonly DayCount[], emptyNote: string): string {
  const w = 760;
  const h = 300;
  if (points.length === 0) return emptyState(w, h, emptyNote);

  const plot = { top: 34, right: 730, bottom: 246, left: 30 };
  const pw = plot.right - plot.left;
  const barAreaH = plot.bottom - plot.top;
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const avg = averageCount(points);

  const slot = pw / points.length;
  const barW = Math.max(6, Math.min(42, slot * 0.6));

  let bars = "";
  points.forEach((p, i) => {
    const slotCenter = plot.right - slot * (i + 0.5);
    const barH = Math.max(3, (p.count / maxCount) * barAreaH);
    const y = plot.bottom - barH;
    bars +=
      `<rect x="${r(slotCenter - barW / 2)}" y="${r(y)}" width="${r(barW)}" height="${r(barH)}" rx="5" fill="url(#um-perf-trend-grad)"/>` +
      `<text x="${r(slotCenter)}" y="${r(y - 8)}" text-anchor="middle" font-size="12" font-weight="800" fill="${C.navy}">${p.count}</text>` +
      `<text x="${r(slotCenter)}" y="${r(plot.bottom + 18)}" text-anchor="middle" font-size="10" fill="${C.ink3}">${esc(p.day.slice(5))}</text>`;
  });

  const avgRatio = Math.max(0, Math.min(1, avg / maxCount));
  const avgY = plot.bottom - avgRatio * barAreaH;
  const avgLabel = formatAvgTick(avg);
  const avgLine =
    `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(avgY)}" y2="${r(avgY)}" stroke="${C.gold}" stroke-width="2" stroke-dasharray="5 4"/>` +
    `<rect x="${r(plot.left)}" y="${r(avgY - 15)}" width="${r(16 + avgLabel.length * 7)}" height="14" rx="4" fill="${C.goldBg}"/>` +
    `<text x="${r(plot.left + 6)}" y="${r(avgY - 5)}" font-size="10.5" font-weight="800" fill="${C.gold}">${esc(avgLabel)}</text>`;

  return (
    open(w, h, "min-width:480px;height:auto") +
    `<defs><linearGradient id="um-perf-trend-grad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${C.sky}"/><stop offset="100%" stop-color="${C.navy}"/>` +
    `</linearGradient></defs>` +
    `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(plot.bottom)}" y2="${r(plot.bottom)}" stroke="${C.border}"/>` +
    bars +
    avgLine +
    `</svg>`
  );
}
