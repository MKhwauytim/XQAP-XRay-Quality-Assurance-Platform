// Hand-rolled inline-SVG chart primitives for تقييم الأداء (employee
// performance evaluation). Scoped to UserManagement — deliberately NOT
// shared with Reports/kpiCharts.ts, which is that tab's own chart module.
// Same discipline as both kpiCharts.ts and
// data/reporting/executive/ui/charts.ts:
//   • null / empty data → neutral "—" state, never throw
//   • every caller-supplied label routed through esc()
//   • direction:ltr on the <svg>; RTL expressed in the coordinate math
//   • no raw #hex — every colour is a var(--c-…) token

const C = {
  navy: "var(--c-navy)",
  navySoft: "var(--c-navy-soft)",
  ink: "var(--c-ink)",
  ink3: "var(--c-ink-3)",
  ink4: "var(--c-ink-4)",
  border: "var(--c-border)",
  teal: "var(--c-teal-deep)",
  coral: "var(--c-coral)",
  gold: "var(--brand-premium)",
  sky: "var(--c-sky)",
} as const;

const GAP_TIER_COLORS: Record<string, string> = {
  normal: C.teal,
  small: C.sky,
  medium: C.gold,
  large: C.coral,
  unclassified: C.ink4,
};

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

/**
 * Samples-finished-per-day trend line. RTL: the EARLIEST day sits at the
 * right edge, most recent at the left — same date-axis direction as
 * Reports' inaccuracyCalendarSvg and the executive report's timeSeriesBand.
 */
export function samplesTrendSvg(points: readonly DayCount[], emptyNote: string): string {
  const w = 720;
  const h = 220;
  if (points.length === 0) return emptyState(w, h, emptyNote);
  const plot = { top: 16, right: 690, bottom: 180, left: 30 };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? pw / (points.length - 1) : 0;
  const xFor = (index: number) => plot.right - index * stepX;
  const yFor = (count: number) => plot.bottom - (count / maxCount) * ph;

  let gridAndAxis = "";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = Math.round((maxCount / 4) * tick);
    const y = yFor(value);
    gridAndAxis +=
      `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(y)}" y2="${r(y)}" stroke="${C.border}" stroke-dasharray="2 4"/>` +
      `<text x="${r(plot.right + 8)}" y="${r(y + 4)}" font-size="11" fill="${C.ink3}">${value}</text>`;
  }

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${r(xFor(i))} ${r(yFor(p.count))}`)
    .join(" ");

  const labelStride = Math.max(1, Math.ceil(points.length / 10));
  let dots = "";
  points.forEach((p, i) => {
    const x = xFor(i);
    const y = yFor(p.count);
    dots += `<circle cx="${r(x)}" cy="${r(y)}" r="3.5" fill="${C.navy}"/>`;
    if (i === 0 || i === points.length - 1 || i % labelStride === 0) {
      dots += `<text x="${r(x)}" y="${r(plot.bottom + 18)}" text-anchor="middle" font-size="10" fill="${C.ink3}">${esc(p.day.slice(5))}</text>`;
    }
  });

  return (
    open(w, h, "min-width:480px;height:auto") +
    gridAndAxis +
    `<line x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(plot.bottom)}" y2="${r(plot.bottom)}" stroke="${C.ink3}"/>` +
    `<path d="${path}" fill="none" stroke="${C.navy}" stroke-width="2.5" stroke-linejoin="round"/>` +
    dots +
    `</svg>`
  );
}

export type DayStrip = {
  day: string;
  /** Minutes since local midnight, or null when unknown. */
  signInMinute: number | null;
  lastFinishMinute: number | null;
  gapSegments: { startMinute: number; endMinute: number; tier: string }[];
};

/**
 * One horizontal 24h strip per day: a base bar from sign-in to last finish,
 * with each non-"normal" gap overlaid in its tier colour. RTL: 00:00 at the
 * right edge, 24:00 at the left, matching samplesTrendSvg's date-axis
 * direction. A "normal" gap is not drawn — it is expected pacing, not
 * something worth highlighting on the strip.
 */
export function workingHoursStripSvg(days: readonly DayStrip[], emptyNote: string): string {
  const w = 720;
  const rowH = 30;
  const labelW = 90;
  const h = 24 + days.length * rowH + 8;
  if (days.length === 0) return emptyState(w, 120, emptyNote);

  const trackW = w - labelW - 10;
  const minutesPerPx = 1440 / trackW;
  const xFor = (minute: number) => w - labelW - minute / minutesPerPx;

  let out = "";
  days.forEach((day, index) => {
    const y = 20 + index * rowH;
    out += `<text x="${r(w)}" y="${r(y + rowH / 2 + 4)}" text-anchor="end" font-size="12" font-weight="700" fill="${C.ink}">${esc(day.day)}</text>`;
    out += `<rect x="10" y="${r(y + 4)}" width="${r(trackW)}" height="${r(rowH - 12)}" rx="4" fill="${C.navySoft}" fill-opacity="0.15"/>`;
    if (
      day.signInMinute !== null &&
      day.lastFinishMinute !== null &&
      day.lastFinishMinute > day.signInMinute
    ) {
      const x1 = xFor(day.lastFinishMinute);
      const x2 = xFor(day.signInMinute);
      out += `<rect x="${r(x1)}" y="${r(y + 4)}" width="${r(x2 - x1)}" height="${r(rowH - 12)}" rx="4" fill="${C.navy}" fill-opacity="0.35"/>`;
    }
    for (const gap of day.gapSegments) {
      if (gap.tier === "normal" || gap.tier === "unclassified") continue;
      const x1 = xFor(gap.endMinute);
      const x2 = xFor(gap.startMinute);
      const color = GAP_TIER_COLORS[gap.tier] ?? C.ink4;
      out += `<rect x="${r(x1)}" y="${r(y + 4)}" width="${r(Math.max(1, x2 - x1))}" height="${r(rowH - 12)}" rx="3" fill="${color}"/>`;
    }
  });

  return open(w, h, "min-width:480px;height:auto") + out + `</svg>`;
}
