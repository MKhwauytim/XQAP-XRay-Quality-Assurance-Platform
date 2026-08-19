// Advanced analytics chart primitives for the executive deck (deck2).
// Companion to ./charts.ts — SAME discipline, two chart types that file lacks:
//
//   • bubbleScatter()   — workload (x) × accuracy (y) × magnitude (bubble area)
//   • percentHeatmap()  — rows × cols percentage matrix on a two-tone tint scale
//
// Kept in its own module (rather than appended to charts.ts) so several slide
// authors can build on these concurrently without editing one shared file.
//
// Inherited discipline (see charts.ts header, master §16 / design §4.3):
//   • PURE functions (data, opts) => string — no React, no DOM, no runtime JS,
//     no canvas, no npm chart deps. Geometry is hand-rolled + d3-scale.
//   • empty / null / zero-denominator data → neutral "—" empty state, never throw
//   • percentages clamped to 0–100; a missing cell renders "—", NEVER a fake 0%
//   • every caller-supplied string routes through escText() (delegates to esc())
//   • charts never grow past opts.width/opts.height — legends/axes/labels are
//     reserved OUT of the same box, exactly like donut/groupedBars do.
//
// ─── RTL notes (the easiest thing to get wrong — read before editing) ────────
// The report document is dir="rtl". Three separate things had to be handled:
//
// 1. NO `direction="rtl"` ON THE <svg>. In SVG, `text-anchor:start|end` resolves
//    against the *inline base direction*: under direction=rtl, "start" becomes
//    the RIGHT edge and "end" the LEFT — silently mirroring every anchor.
//    The report document root is `<html dir="rtl">` — every element inherits
//    that unless something stops it, INCLUDING an <svg> with no RTL ancestor
//    OF ITS OWN. The `<figure dir="rtl">` wrapper below is A sufficient cause
//    here (the nearest RTL ancestor for this module's charts), but it is not
//    the ONLY one — the document root is sufficient on its own, which is why
//    charts.ts (no `<figure>` wrapper anywhere in that file) had the
//    identical bug. Both this module's svgOpen() and charts.ts's own
//    svgOpen() therefore set `style="direction:ltr"` directly on the <svg>
//    (2026-07-25 fix — a peer review caught that an earlier version of this
//    note named only the `<figure dir="rtl">` wrapper, which left
//    charts.ts's own text-anchor="end"/"start" sites — `heatmap`'s row
//    labels, `funnel`'s label/value pair, `gauge`'s scale ticks, and
//    `legendRows`' legend text, 8 sites total — mirrored in production with
//    no `<figure>` in sight to blame; see charts.ts's own svgOpen for the
//    matching fix and the full site list). Coordinate math (points 2/3
//    below) is a SEPARATE, correct RTL technique and was never the issue
//    here — it's orthogonal to text-anchor resolution, not a substitute for it.
//    (Arabic glyph shaping/bidi inside a single <text> run is unaffected — the
//    bidi algorithm still lays the Arabic run out right-to-left.)
// 2. SCATTER X AXIS RUNS RIGHT → LEFT. The x scale's *range* is reversed
//    ([plotRight, plotLeft]), so domain-min sits at the right edge — the RTL
//    reading start — and larger workloads grow leftward. Same flip charts.ts
//    quadrantScatter does with `(1 - px/100)`. The Y axis, its ticks and the
//    axis titles therefore live in the RIGHT gutter (the RTL "start" side,
//    mirroring an LTR chart's left gutter), and horizontal reference lines are
//    labelled at their RIGHT end so the label is read first.
// 3. HEATMAP COLUMN ORDER IS REVERSED. cols[0] is painted at the RIGHT-most
//    slot (`gridRight - (ci+1)*cw`) so the matrix reads right-to-left like the
//    surrounding tables; row headers sit in the right gutter. The screen-reader
//    <table> keeps the natural DOM order and carries dir="rtl", which is what
//    assistive tech and print both expect.
//
// ─── Theme awareness ────────────────────────────────────────────────────────
// The deck ships a dark default plus `body.theme-light` (deck2/theme.ts). That
// light block re-colors components but does NOT remap the base ink variables
// (--white / --muted / --line stay dark-theme values), so chrome painted with
// cssVar("text")/cssVar("muted")/cssVar("line") would be invisible on the light
// slides. Every piece of CHROME here (axes, grid, ticks, headers, legend text)
// therefore paints with `currentColor` — which inherits `.slide`'s color, i.e.
// --white in the dark theme and #0a2d4a under body.theme-light — de-emphasised
// with *-opacity rather than a second color. DATA marks still use the brand
// role tokens via cssVar(), which are theme-invariant by design.
// No raw hex literals anywhere (see scripts/check-hex-literals.mjs).
//
// ─── Print safety ───────────────────────────────────────────────────────────
// Every returned <svg> carries `-webkit-print-color-adjust:exact;
// print-color-adjust:exact` so tinted heatmap cells and bubble fills survive
// print-to-PDF, matching the deck CSS convention (deck2/theme.ts .v2-bar-cell).
//
// ─── Accessibility ──────────────────────────────────────────────────────────
// Each primitive returns a <figure> pairing the (aria-hidden) SVG with a
// semantically equivalent, visually-hidden <table> — the same "native
// responsive SVG plus a semantic screen-reader table" pattern the Reviewer KPI
// p-charts use (ReviewerKpiPanel.tsx + .rk-sr-only). The clip styles are
// inlined because the exported report has no stylesheet hook of its own.

import { FONT_FAMILY, TYPE, clamp, clampPct, cssVar } from "./tokens";
import type { ColorRole } from "./tokens";
import { esc } from "../primitives";
import { scaleLinear } from "d3-scale";

// ── shared helpers (mirror charts.ts — duplicated deliberately so this module
//    stays independently editable while five slides are built in parallel) ────

/** Delegates to the single hardened escaping primitive (audit C-08). */
function escText(s: string | null | undefined): string {
  return esc(s);
}

/** Round to 2dp and strip trailing zeros — keeps path/attr strings compact. */
function r(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 100) / 100);
}

/** Fills must survive print-to-PDF — same declaration the deck CSS uses. */
const PRINT_EXACT = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";

function svgOpen(w: number, h: number, title: string): string {
  return (
    `<svg viewBox="0 0 ${r(w)} ${r(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="100%" height="100%" font-family='${FONT_FAMILY}' ` +
    // aria-hidden: the paired <table> below carries the semantics (see header).
    `aria-hidden="true" focusable="false" ` +
    // direction:ltr is load-bearing, not decorative (2026-07-25 fix): the
    // document root is <html dir="rtl">, and SVG's own `text-anchor:
    // start|end` resolves against the *inline base direction* (header note
    // 1) — with nothing on the <svg> itself to stop the inheritance, every
    // text-anchor="end"/"start" in this file silently mirrored, rendering
    // row/column labels off-canvas. Confirmed live: without this, the
    // shipped percentHeatmap AND this module's other charts were already
    // rendering clipped labels in production — and so was ui/charts.ts's
    // svgOpen(), fixed the same way, since the document root alone is
    // sufficient to cause this regardless of whether an intermediate
    // wrapper (like the <figure> below) also carries dir="rtl". This one
    // declaration is what actually enforces the header comment's rule, not
    // just documents it.
    `style="${PRINT_EXACT}display:block;direction:ltr" data-chart="${escText(title)}">`
  );
}

/** Visually-hidden style for the paired screen-reader table (inlined: the
 *  exported single-file report has no class hook of its own to rely on). */
const SR_ONLY =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
  "overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0";

/**
 * Semantic, visually-hidden data table paired with each SVG. `rows` cells are
 * escaped here; pass raw text. Carries dir="rtl" so assistive tech announces the
 * Arabic headers/labels in document order.
 */
function srTable(caption: string, headers: string[], rows: string[][]): string {
  const head = headers
    .map((hd) => `<th scope="col">${escText(hd)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>` +
        row
          .map((cell, i) =>
            i === 0
              ? `<th scope="row">${escText(cell)}</th>`
              : `<td>${escText(cell)}</td>`,
          )
          .join("") +
        `</tr>`,
    )
    .join("");
  return (
    `<table dir="rtl" style="${SR_ONLY}">` +
    `<caption>${escText(caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}

/** Wrap an SVG + its screen-reader table into one figure element. */
function figure(svg: string, table: string): string {
  return (
    `<figure dir="rtl" style="margin:0;padding:0;width:100%;height:100%;position:relative">` +
    svg +
    table +
    `</figure>`
  );
}

/**
 * Neutral empty state — centered em-dash + optional note, in currentColor so it
 * is legible in both themes. Still paired with an (empty) sr table so the
 * figure's contract never changes shape between the empty and populated cases.
 */
function emptyState(w: number, h: number, title: string, note?: string): string {
  const cx = w / 2;
  const cy = h / 2;
  const svg =
    svgOpen(w, h, title) +
    `<text x="${r(cx)}" y="${r(cy)}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-size="${TYPE.title}" fill="currentColor" fill-opacity="0.55">—</text>` +
    (note
      ? `<text x="${r(cx)}" y="${r(cy + 22)}" text-anchor="middle" ` +
        `font-size="${TYPE.caption}" fill="currentColor" fill-opacity="0.55">${escText(note)}</text>`
      : "") +
    `</svg>`;
  return figure(svg, srTable(note ?? title, ["—"], []));
}

/** Row height (px) for one vertical legend entry — same derivation as charts.ts. */
const LEGEND_ROW_H = TYPE.micro + 7;

/** Vertical space a legend of `n` entries needs (0 entries → 0, no strip). */
function legendHeight(n: number): number {
  return n > 0 ? n * LEGEND_ROW_H + 6 : 0;
}

/**
 * Vertical legend rows. RTL: the swatch sits flush to the RIGHT edge with the
 * label growing leftward from it (text-anchor="end"), the marker/label order
 * charts.ts legendRows established. `top` is the first row's top edge.
 */
function legendRows(
  items: { label: string; color: string }[],
  w: number,
  top: number,
): string {
  return items
    .map((it, i) => {
      const cy = top + i * LEGEND_ROW_H + LEGEND_ROW_H / 2;
      const swatchX = w - 12;
      return (
        `<rect x="${r(swatchX - 8)}" y="${r(cy - 4)}" width="8" height="8" rx="2" ` +
        `fill="${it.color}" style="${PRINT_EXACT}"/>` +
        `<text x="${r(swatchX - 12)}" y="${r(cy)}" text-anchor="end" dominant-baseline="middle" ` +
        `font-size="${TYPE.micro}" fill="currentColor">${escText(it.label)}</text>`
      );
    })
    .join("");
}

/** Latin-digit tick text — matches the axis/tick formatting already in charts.ts. */
function fmtTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000) return String(Math.round(v / 1000)) + "k";
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10) / 10);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. bubbleScatter — workload (x) × accuracy (y) × magnitude (bubble area)
// ════════════════════════════════════════════════════════════════════════════

/** One plotted entity (a port, a reviewer, …). */
export type BubblePoint = {
  /** Category name — legend/label/sr-table text. Escaped on render. */
  label: string;
  /** Horizontal magnitude (e.g. inspected rows). Non-finite → point unplotted. */
  x: number | null;
  /** Vertical magnitude (e.g. accuracy %). Non-finite → point unplotted. */
  y: number | null;
  /** Third magnitude driving bubble AREA (sqrt-scaled). Missing → mid radius. */
  size?: number | null;
  /** Per-point tone override; falls back to opts.tone. */
  tone?: ColorRole;
};

/** A horizontal target/threshold rule drawn across the plot. */
export type ReferenceLine = {
  /** Value in the same units as BubblePoint.y. */
  value: number;
  /** Optional Arabic caption drawn at the line's RIGHT (RTL start) end. */
  label?: string;
  /** Tone token for the rule + its caption. Default "danger". */
  tone?: ColorRole;
};

export type BubbleScatterOpts = {
  /** Explicit box — these charts share a 459×~1275 slide body, never full-bleed. */
  width?: number;
  height?: number;
  /** Note shown under the em-dash when there is nothing to plot. */
  emptyNote?: string;
  /** Axis titles (Arabic). x sits centered under the axis, y at the top-right. */
  xLabel?: string;
  yLabel?: string;
  /** Uniform bubble tone. Default "info". */
  tone?: ColorRole;
  /** Horizontal target/threshold rules. */
  refLines?: ReferenceLine[];
  /** Extra legend rows (tone swatch + text). Point tones are NOT auto-legended —
   *  one row per port would blow the height budget; describe the encoding here. */
  legend?: { label: string; tone?: ColorRole }[];
  /** Bubble radius bounds (px). Defaults 4 → 16. */
  minRadius?: number;
  maxRadius?: number;
  /** Y axis is a percentage: domain locked to 0–100 and values clamped. Default true. */
  yIsPercent?: boolean;
  /** Explicit y domain; overrides yIsPercent's 0–100. */
  yDomain?: [number, number];
  /** Explicit x domain; default [0, max(x)] (niced). */
  xDomain?: [number, number];
  /** Draw each point's label beside its bubble. Default: auto (≤ 6 points). */
  showPointLabels?: boolean;
  /** Tick counts (hints passed to d3-scale). Defaults 4 / 4. */
  xTickCount?: number;
  yTickCount?: number;
  /** Screen-reader table caption + column headers. */
  caption?: string;
  srColumns?: { label?: string; x?: string; y?: string; size?: string };
  /** Header for the size column / legend hint, e.g. "حجم الدائرة = عدد الصور". */
  sizeLabel?: string;
};

/**
 * Scatter / bubble plot.
 *
 * Bubble AREA (not radius) is proportional to `size` — radius is sqrt-scaled,
 * the only honest encoding for a magnitude. Larger bubbles paint first so small
 * ones stay visible on top.
 *
 * Degenerate input is handled explicitly rather than by accident:
 *   • 0 plottable points          → neutral "—" empty state
 *   • 1 point                     → domain padded, point centered on its value
 *   • every x (or y) identical    → the scale's domain is padded by ±1 before
 *                                   any division, so no 0-width domain and no
 *                                   NaN coordinates
 *   • every size 0 / all missing  → all bubbles get the mid radius
 *   • null / non-finite x or y    → point omitted from the plot but still
 *                                   listed in the screen-reader table as "—"
 */
export function bubbleScatter(
  points: BubblePoint[] | null | undefined,
  opts: BubbleScatterOpts = {},
): string {
  const w = opts.width ?? 620;
  const h = opts.height ?? 360;
  const title = opts.caption ?? "مخطط الانتشار";
  const all = points ?? [];
  const plotted = all.filter((p) => p && isNum(p.x) && isNum(p.y));
  if (plotted.length === 0) return emptyState(w, h, title, opts.emptyNote);

  const yIsPercent = opts.yIsPercent ?? true;
  const minR = Math.max(1, opts.minRadius ?? 4);
  const maxR = Math.max(minR, opts.maxRadius ?? 16);
  const tone = opts.tone ?? "info";

  // ── reserved strips (all carved OUT of w×h; the plot never overflows) ──────
  const legendItems = (opts.legend ?? []).map((l) => ({
    label: l.label,
    color: cssVar(l.tone ?? tone),
  }));
  const legendH = legendHeight(legendItems.length);
  const xTitleH = opts.xLabel ? TYPE.micro + 6 : 0;
  const xAxisH = TYPE.micro + 10 + xTitleH;
  const yTitleH = opts.yLabel ? TYPE.micro + 6 : 0;
  // RTL: y-axis ticks live in the RIGHT gutter (mirror of an LTR left gutter).
  const yGutter = 42;
  const plotLeft = 10 + maxR;
  const plotRight = Math.max(plotLeft + 20, w - yGutter);
  const plotTop = yTitleH + 6 + maxR;
  const plotBottom = Math.max(plotTop + 20, h - legendH - xAxisH);

  // ── scales (d3-scale, same dependency charts.ts sparkline uses) ────────────
  const xs = plotted.map((p) => p.x as number);
  const ysRaw = plotted.map((p) => p.y as number);
  const ys = yIsPercent ? ysRaw.map((v) => clamp(v, 0, 100)) : ysRaw;

  const xMaxRaw = Math.max(...xs);
  const xMinRaw = Math.min(...xs);
  // Divide-by-zero guard: a 0-width domain (single point, or every x identical)
  // is widened before d3 ever computes (v-min)/(max-min).
  const xDomain: [number, number] =
    opts.xDomain ??
    (xMaxRaw === xMinRaw
      ? [Math.min(0, xMinRaw - 1), xMaxRaw + 1]
      : [Math.min(0, xMinRaw), xMaxRaw]);
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yDomain: [number, number] =
    opts.yDomain ??
    (yIsPercent
      ? [0, 100]
      : yMaxRaw === yMinRaw
        ? [yMinRaw - 1, yMaxRaw + 1]
        : [yMinRaw, yMaxRaw]);

  // RTL: the RANGE is reversed — domain-min lands on the RIGHT edge and values
  // grow leftward, so the axis reads right-to-left with the document.
  const xScale = scaleLinear().domain(xDomain).range([plotRight, plotLeft]).nice();
  const yScale = scaleLinear().domain(yDomain).range([plotBottom, plotTop]).nice();
  const xTicks = xScale.ticks(opts.xTickCount ?? 4);
  const yTicks = yScale.ticks(opts.yTickCount ?? 4);

  // ── bubble radius: AREA-proportional (sqrt), zero-safe ────────────────────
  const sizes = plotted.map((p) => (isNum(p.size) ? Math.max(0, p.size) : 0));
  const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
  const radiusOf = (s: number): number =>
    maxSize > 0 ? minR + Math.sqrt(s / maxSize) * (maxR - minR) : (minR + maxR) / 2;

  // ── chrome: grid + axes (currentColor, so both themes stay legible) ───────
  let grid = "";
  for (const t of yTicks) {
    const y = yScale(t);
    grid +=
      `<line x1="${r(plotLeft)}" y1="${r(y)}" x2="${r(plotRight)}" y2="${r(y)}" ` +
      `stroke="currentColor" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="3 3"/>` +
      `<text x="${r(plotRight + 6)}" y="${r(y)}" text-anchor="start" dominant-baseline="middle" ` +
      `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.62">${escText(
        fmtTick(t) + (yIsPercent ? "%" : ""),
      )}</text>`;
  }
  let xAxis = "";
  for (const t of xTicks) {
    const x = xScale(t);
    xAxis +=
      `<line x1="${r(x)}" y1="${r(plotBottom)}" x2="${r(x)}" y2="${r(plotBottom + 3)}" ` +
      `stroke="currentColor" stroke-opacity="0.28" stroke-width="1"/>` +
      `<text x="${r(x)}" y="${r(plotBottom + TYPE.micro + 7)}" text-anchor="middle" ` +
      `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.62">${escText(fmtTick(t))}</text>`;
  }
  const axes =
    `<line x1="${r(plotLeft)}" y1="${r(plotBottom)}" x2="${r(plotRight)}" y2="${r(plotBottom)}" ` +
    `stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>` +
    `<line x1="${r(plotRight)}" y1="${r(plotTop)}" x2="${r(plotRight)}" y2="${r(plotBottom)}" ` +
    `stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>`;

  // ── reference lines — labelled at the RIGHT (RTL reading start) end ───────
  const refs = (opts.refLines ?? [])
    .filter((l) => l && isNum(l.value))
    .map((l) => {
      const v = yIsPercent ? clamp(l.value, 0, 100) : l.value;
      const y = yScale(v);
      const color = cssVar(l.tone ?? "danger");
      return (
        `<line x1="${r(plotLeft)}" y1="${r(y)}" x2="${r(plotRight)}" y2="${r(y)}" ` +
        `stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4" stroke-opacity="0.9"/>` +
        (l.label
          ? `<text x="${r(plotRight - 6)}" y="${r(y - 4)}" text-anchor="end" ` +
            `font-size="${TYPE.micro}" font-weight="700" fill="${color}">${escText(l.label)}</text>`
          : "")
      );
    })
    .join("");

  // ── bubbles — largest first so small ones are never buried ────────────────
  const showLabels = opts.showPointLabels ?? plotted.length <= 6;
  const midX = (plotLeft + plotRight) / 2;
  const ordered = plotted
    .map((p, i) => ({ p, i, rad: radiusOf(sizes[i]) }))
    .sort((a, b) => b.rad - a.rad);
  const bubbles = ordered
    .map(({ p, i, rad }) => {
      const cx = xScale(p.x as number);
      const cy = yScale(ys[i]);
      const color = cssVar(p.tone ?? tone);
      const dot =
        `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${color}" fill-opacity="0.5" ` +
        `stroke="${color}" stroke-width="1.5" style="${PRINT_EXACT}"/>`;
      if (!showLabels) return dot;
      // RTL: the label prefers the RIGHT of its bubble (reading start), and
      // flips to the left only when it would run past the right-hand gutter.
      const toRight = cx <= midX;
      const lx = toRight ? cx + rad + 4 : cx - rad - 4;
      return (
        dot +
        `<text x="${r(lx)}" y="${r(cy)}" text-anchor="${toRight ? "start" : "end"}" ` +
        `dominant-baseline="middle" font-size="${TYPE.micro}" fill="currentColor" ` +
        `fill-opacity="0.85">${escText(p.label)}</text>`
      );
    })
    .join("");

  // ── axis titles: x centered under the axis, y at the TOP-RIGHT (RTL start).
  //    Horizontal, never rotated — rotated Arabic is unreadable in print.
  const titles =
    (opts.xLabel
      ? `<text x="${r(midX)}" y="${r(h - legendH - 3)}" text-anchor="middle" ` +
        `font-size="${TYPE.micro}" font-weight="700" fill="currentColor" fill-opacity="0.72">${escText(opts.xLabel)}</text>`
      : "") +
    (opts.yLabel
      ? `<text x="${r(w - 4)}" y="${r(TYPE.micro + 4)}" text-anchor="end" ` +
        `font-size="${TYPE.micro}" font-weight="700" fill="currentColor" fill-opacity="0.72">${escText(opts.yLabel)}</text>`
      : "");

  const legend = legendItems.length > 0 ? legendRows(legendItems, w, h - legendH + 4) : "";

  const svg = svgOpen(w, h, title) + grid + axes + refs + bubbles + xAxis + titles + legend + `</svg>`;

  // ── paired screen-reader table (every point, including unplotted ones) ─────
  const cols = opts.srColumns ?? {};
  const headers = [
    cols.label ?? "العنصر",
    cols.x ?? opts.xLabel ?? "المحور الأفقي",
    cols.y ?? opts.yLabel ?? "المحور الرأسي",
    cols.size ?? opts.sizeLabel ?? "الحجم",
  ];
  const srRows = all.map((p) => [
    p?.label ?? "—",
    isNum(p?.x) ? fmtTick(p.x as number) : "—",
    isNum(p?.y)
      ? fmtTick(yIsPercent ? (clampPct(p.y) as number) : (p.y as number)) + (yIsPercent ? "%" : "")
      : "—",
    isNum(p?.size) ? fmtTick(p.size as number) : "—",
  ]);
  return figure(svg, srTable(title, headers, srRows));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. percentHeatmap — rows × cols percentage matrix, two-tone continuous tint
// ════════════════════════════════════════════════════════════════════════════

export type HeatMatrix = {
  /** Row labels, top → bottom. */
  rows: string[];
  /** Column labels in LOGICAL order — cols[0] is painted RIGHT-most (RTL). */
  cols: string[];
  /** values[rowIndex][colIndex] as percentages. null/undefined/NaN → "—" cell. */
  values: (number | null | undefined)[][];
};

export type PercentHeatmapOpts = {
  /** Explicit box — the slide body is 459px tall and usually shared. */
  width?: number;
  height?: number;
  emptyNote?: string;
  /** Tint endpoints. The cell fill is a true linear blend of the two (a base
   *  rect of `toneLow` under an alpha-ramped `toneHigh` overlay — no
   *  color-mix(), so the fill is identical in every renderer and in print).
   *  Both must be MID-to-LIGHT brand tones: cell ink is a fixed dark navy
   *  which keeps ≥4.5:1 against every role in SERIES_ROLES plus "text". */
  toneLow?: ColorRole;
  toneHigh?: ColorRole;
  /** Tint domain. Default [0, 100]. Equal endpoints → every present cell at mid tint. */
  domain?: [number, number];
  /** Force the compact tier. Default: auto for cols > 6 or rows > 8. */
  compact?: boolean;
  /** Decimals printed in each cell. Default 0. */
  digits?: number;
  /** Width (px) of the right-hand row-header gutter. */
  rowHeaderWidth?: number;
  /** Screen-reader caption + the row-header column's name. */
  caption?: string;
  rowHeader?: string;
  /** Intensity-legend end captions. RTL: high on the left, low on the right. */
  legendHighLabel?: string;
  legendLowLabel?: string;
};

/**
 * Percentage heatmap matrix.
 *
 *   • RTL: cols[0] is the RIGHT-most column, row headers sit in the right gutter.
 *   • A missing cell renders "—" on an unfilled, dashed outline — never a
 *     misleading 0%, which a viewer cannot distinguish from a real zero.
 *   • Values are clamped to 0–100 (clampPct) before both tint and print.
 *   • Compact tier (auto for larger matrices): micro type, square corners,
 *     hairline separators, and the row gutter narrows — so a 10×12 matrix still
 *     fits the slide budget instead of overflowing it.
 *   • An all-identical matrix (or an explicit zero-width domain) tints every
 *     present cell at the scale midpoint instead of dividing by zero.
 */
export function percentHeatmap(
  data: HeatMatrix | null | undefined,
  opts: PercentHeatmapOpts = {},
): string {
  const w = opts.width ?? 620;
  const h = opts.height ?? 320;
  const title = opts.caption ?? "مصفوفة النسب";
  const rows = data?.rows ?? [];
  const cols = data?.cols ?? [];
  if (rows.length === 0 || cols.length === 0) {
    return emptyState(w, h, title, opts.emptyNote);
  }

  const compact = opts.compact ?? (cols.length > 6 || rows.length > 8);
  const fs = compact ? TYPE.micro : TYPE.caption;
  const digits = Math.max(0, Math.min(2, opts.digits ?? 0));
  const toneLow = cssVar(opts.toneLow ?? "text");
  const toneHigh = cssVar(opts.toneHigh ?? "primary");
  // Cell ink is deliberately NOT currentColor: the cell fill is opaque and
  // theme-invariant, so the ink must be too. Dark navy clears 4.5:1 on every
  // brand tone (and 15:1 on the near-white default low tone) in both themes.
  const ink = cssVar("surface");

  const rowHeaderW = Math.max(40, opts.rowHeaderWidth ?? (compact ? 72 : 96));
  const colHeaderH = fs + 8;
  const legendH = fs + 14;
  const gridLeft = 2;
  const gridRight = Math.max(gridLeft + 20, w - rowHeaderW);
  const gridTop = colHeaderH;
  const gridBottom = Math.max(gridTop + 20, h - legendH);
  const cw = (gridRight - gridLeft) / cols.length;
  const ch = (gridBottom - gridTop) / rows.length;
  const pad = compact ? 0.5 : 1;
  const rx = compact ? 0 : 3;

  const [d0, d1] = opts.domain ?? [0, 100];
  const span = d1 - d0;
  // Divide-by-zero guard: a zero-width (or non-finite) domain means every
  // present value sits at the same place on the scale → the midpoint.
  const tintOf = (v: number): number =>
    Number.isFinite(span) && span !== 0 ? clamp((v - d0) / span, 0, 1) : 0.5;

  // RTL: logical column ci is painted at the (cols.length-1-ci)-th slot from
  // the left, i.e. cols[0] lands flush against the right-hand row gutter.
  const colX = (ci: number): number => gridRight - (ci + 1) * cw;

  let cells = "";
  rows.forEach((rowLabel, ri) => {
    const y = gridTop + ri * ch;
    cells +=
      `<text x="${r(w - 4)}" y="${r(y + ch / 2)}" text-anchor="end" dominant-baseline="middle" ` +
      `font-size="${fs}" fill="currentColor" fill-opacity="0.78">${escText(rowLabel)}</text>`;
    cols.forEach((_, ci) => {
      const x = colX(ci);
      const raw = data?.values?.[ri]?.[ci];
      const v = isNum(raw) ? (clampPct(raw) as number) : null;
      const cx = x + pad;
      const cy = y + pad;
      const cwi = Math.max(0, cw - pad * 2);
      const chi = Math.max(0, ch - pad * 2);
      if (v === null) {
        // Missing data — outlined, unfilled, em-dash. Never a fake 0%.
        cells +=
          `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
          `fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="3 3"/>` +
          `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${fs}" fill="currentColor" fill-opacity="0.55">—</text>`;
        return;
      }
      const t = tintOf(v);
      // Two stacked rects = a literal sRGB blend toneLow→toneHigh. Opaque, so
      // the cell looks identical in the dark and light themes and in print.
      cells +=
        `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
        `fill="${toneLow}" style="${PRINT_EXACT}"/>` +
        `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
        `fill="${toneHigh}" fill-opacity="${r(t)}" style="${PRINT_EXACT}"/>` +
        `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-size="${fs}" font-weight="700" fill="${ink}">${escText(v.toFixed(digits) + "%")}</text>`;
    });
  });

  // Column headers along the top — same RTL slot mapping as the cells.
  const colLabels = cols
    .map(
      (c, ci) =>
        `<text x="${r(colX(ci) + cw / 2)}" y="${r(colHeaderH - 6)}" text-anchor="middle" ` +
        `font-size="${fs}" font-weight="700" fill="currentColor" fill-opacity="0.78">${escText(c)}</text>`,
    )
    .join("");

  // Intensity legend — 5 swatches. RTL follows charts.ts heatmap: the HIGH end
  // and its caption sit on the LEFT, the LOW end on the RIGHT.
  const steps = 5;
  const swW = compact ? 14 : 18;
  const swGap = 2;
  const legendW = steps * swW + (steps - 1) * swGap;
  const legendX0 = w / 2 - legendW / 2;
  const legendY = h - legendH + 5;
  let swatches = "";
  for (let i = 0; i < steps; i++) {
    const t = (steps - 1 - i) / (steps - 1); // leftmost swatch = highest tint
    const x = legendX0 + i * (swW + swGap);
    swatches +=
      `<rect x="${r(x)}" y="${r(legendY)}" width="${r(swW)}" height="8" rx="2" fill="${toneLow}" style="${PRINT_EXACT}"/>` +
      `<rect x="${r(x)}" y="${r(legendY)}" width="${r(swW)}" height="8" rx="2" fill="${toneHigh}" fill-opacity="${r(t)}" style="${PRINT_EXACT}"/>`;
  }
  const legend =
    `<text x="${r(legendX0 - 6)}" y="${r(legendY + 7)}" text-anchor="end" font-size="${TYPE.micro}" ` +
    `fill="currentColor" fill-opacity="0.62">${escText(opts.legendHighLabel ?? "الأعلى")}</text>` +
    swatches +
    `<text x="${r(legendX0 + legendW + 6)}" y="${r(legendY + 7)}" text-anchor="start" font-size="${TYPE.micro}" ` +
    `fill="currentColor" fill-opacity="0.62">${escText(opts.legendLowLabel ?? "أقل")}</text>`;

  const svg = svgOpen(w, h, title) + colLabels + cells + legend + `</svg>`;

  // Screen-reader table keeps the LOGICAL order (cols[0] first) and carries
  // dir="rtl" — assistive tech and print both expect document order here.
  const headers = [opts.rowHeader ?? "الصف", ...cols];
  const srRows = rows.map((rowLabel, ri) => [
    rowLabel,
    ...cols.map((_, ci) => {
      const raw = data?.values?.[ri]?.[ci];
      return isNum(raw) ? (clampPct(raw) as number).toFixed(digits) + "%" : "—";
    }),
  ]);
  return figure(svg, srTable(title, headers, srRows));
}

// ════════════════════════════════════════════════════════════════════════════
// 3. metricMatrix — rows × MIXED-UNIT metric columns, each normalized to its
//    own domain (a sibling of percentHeatmap, not a generalization of it — see
//    design spec §4: "percentHeatmap: do not stretch to mixed units. Add a
//    sibling metricMatrix() … for Grid's port/stage matrices. Source-agreement's
//    own Grid variant keeps using percentHeatmap near-as-is [it already has] a
//    single genuine 0-100 scale.")
// ════════════════════════════════════════════════════════════════════════════

/** One metric column of a `metricMatrix` — e.g. "الصور" (a volume column) or
 *  "نسبة الاشتباه %" (a rate column) sitting beside it. Every column is tinted
 *  and labelled independently; nothing here is ever compared across columns. */
export type MetricColumn = {
  /** Column header text. Escaped on render. */
  label: string;
  /** This column's OWN normalization domain `[min, max]` — printed in the
   *  header (never a shared scale across unlike units — the whole reason this
   *  component exists instead of stretching percentHeatmap to fit). */
  domain: [number, number];
  /**
   * Tint family for this column:
   *   • "sequential-gold" — one direction, low(neutral)→high(gold). The right
   *     choice for plain magnitudes/rates with no "good"/"bad" polarity (e.g.
   *     a volume column, or a rate with no fixed target to diverge around).
   *   • "diverging-green-coral" — the domain MIDPOINT is neutral; values below
   *     it tint green (toward the domain min), values above tint coral
   *     (toward the domain max). The right choice when the column has a
   *     meaningful center (e.g. a signed delta, or a rate with a known
   *     good/bad split point).
   */
  ramp: "sequential-gold" | "diverging-green-coral";
  /** One value per row, aligned by index with `rowLabels`. A column shorter
   *  than `rowLabels` (including a genuinely empty `[]`) simply reads as
   *  missing for the remaining rows — never a crash. null/undefined/NaN →
   *  "—" cell, never a fake value. */
  values: (number | null | undefined)[];
};

export type MetricMatrixData = {
  /** Row labels, top → bottom (right-aligned in the RTL row gutter). */
  rowLabels: string[];
  columns: MetricColumn[];
};

export type MetricMatrixOpts = {
  /** Explicit box — the slide body is 459px tall and usually shared. */
  width?: number;
  height?: number;
  emptyNote?: string;
  /** Force the compact tier. Default: auto for cols > 6 or rows > 8 (same
   *  threshold percentHeatmap uses). */
  compact?: boolean;
  /** Width (px) of the right-hand row-header gutter. */
  rowHeaderWidth?: number;
  /** Screen-reader caption + the row-header column's name. */
  caption?: string;
  rowHeader?: string;
};

/**
 * Mixed-unit metric matrix: rows × N columns, each column tinted on its OWN
 * domain/ramp — never a shared scale, since unlike units (a volume next to a
 * rate) cannot honestly share one. Cell ink is always `var(--navy)`
 * (`cssVar("surface")`) rather than currentColor: exactly percentHeatmap's own
 * reasoning — every fill here is opaque and theme-invariant by construction,
 * so the ink must be too (dark navy clears 4.5:1 on every brand tone in both
 * themes).
 *
 *   • 0 rows or 0 columns                → neutral "—" empty state
 *   • a column shorter than rows (including `values: []`), or a
 *     null/undefined/NaN entry        → "—" cell, outlined/unfilled, never a
 *     fake value
 *   • an all-identical column (or a zero-width domain) → every present value
 *     in that column tints at the ramp's neutral point instead of dividing by
 *     zero
 *
 * **A reversed `domain: [hi, lo]` inverts a `diverging-green-coral` column's
 * polarity — this is an intentional, stable contract, not an accident.**
 * `tintOf`'s midpoint/half-span math (`mid = (d0+d1)/2`, `half = (d1-d0)/2`,
 * `signed = (v-mid)/half`) divides by `half`, so swapping the domain's two
 * endpoints negates `half` and therefore flips the sign of every `signed`
 * value — whatever tinted green under `[lo, hi]` tints coral under `[hi, lo]`
 * for the exact same input values, and vice versa. A caller who wants "the
 * larger raw value reads as the good outcome" (green) passes the domain in
 * the order that makes that true for their column's own semantics — e.g. a
 * "level 2 more accurate than level 1" delta column wants a positive delta to
 * read green, which this ramp gives you by simply choosing which endpoint is
 * `d0` vs `d1`, with no separate "invert" flag needed. See
 * `analyticsCharts.test.ts`'s "a reversed domain … inverts … polarity" test
 * for the reference case, and
 * `docs/superpowers/specs/2026-07-25-deck2-fanout-remaining-pages-plan.md` §11b
 * (`slide-s3-level-accuracy`'s الفارق column) for the first real page that
 * depends on this.
 */
export function metricMatrix(
  data: MetricMatrixData | null | undefined,
  opts: MetricMatrixOpts = {},
): string {
  const w = opts.width ?? 620;
  const h = opts.height ?? 320;
  const title = opts.caption ?? "مصفوفة المؤشرات";
  const rows = data?.rowLabels ?? [];
  const cols = data?.columns ?? [];
  if (rows.length === 0 || cols.length === 0) {
    return emptyState(w, h, title, opts.emptyNote);
  }

  const compact = opts.compact ?? (cols.length > 6 || rows.length > 8);
  const fs = compact ? TYPE.micro : TYPE.caption;
  // Ink is deliberately NOT currentColor — see doc comment above.
  const ink = cssVar("surface");

  const rowHeaderW = Math.max(40, opts.rowHeaderWidth ?? (compact ? 72 : 96));
  // Column header carries two lines: the label, then this column's own domain
  // range beneath it in a smaller face — the mixed-unit equivalent of
  // percentHeatmap's single shared legend, but per-column since the scales
  // themselves differ.
  const headLine1H = fs + 4;
  const headLine2H = TYPE.micro + 4;
  const colHeaderH = headLine1H + headLine2H;
  const gridLeft = 2;
  const gridRight = Math.max(gridLeft + 20, w - rowHeaderW);
  const gridTop = colHeaderH;
  const gridBottom = Math.max(gridTop + 20, h - 4);
  const cw = (gridRight - gridLeft) / cols.length;
  const ch = (gridBottom - gridTop) / rows.length;
  const pad = compact ? 0.5 : 1;
  const rx = compact ? 0 : 3;

  // RTL: logical column ci is painted at the (cols.length-1-ci)-th slot from
  // the left, i.e. cols[0] lands flush against the right-hand row gutter —
  // same convention percentHeatmap uses.
  const colX = (ci: number): number => gridRight - (ci + 1) * cw;

  /** This column's two-stacked-opaque-rect tint for value `v` (percentHeatmap's
   *  blend technique — no color-mix(), identical in every renderer and print).
   *  Returns the base (bottom) fill, the overlay (top) fill, and the overlay's
   *  fill-opacity `t`. */
  function tintOf(v: number, col: MetricColumn): { base: string; overlay: string; t: number } {
    const [d0, d1] = col.domain;
    const span = d1 - d0;
    const base = cssVar("text");
    if (col.ramp === "sequential-gold") {
      // Divide-by-zero guard: a zero-width (or non-finite) domain means every
      // present value sits at the same place on the scale → the midpoint.
      const t = Number.isFinite(span) && span !== 0 ? clamp((v - d0) / span, 0, 1) : 0.5;
      return { base, overlay: cssVar("primary"), t };
    }
    // diverging-green-coral: the domain MIDPOINT is neutral; below it tints
    // green (toward d0), above it tints coral (toward d1).
    const mid = (d0 + d1) / 2;
    const half = span / 2;
    if (!Number.isFinite(half) || half === 0) return { base, overlay: cssVar("primary"), t: 0.5 };
    const signed = clamp((v - mid) / half, -1, 1);
    return signed >= 0
      ? { base, overlay: cssVar("danger"), t: signed }
      : { base, overlay: cssVar("success"), t: -signed };
  }

  let cells = "";
  rows.forEach((rowLabel, ri) => {
    const y = gridTop + ri * ch;
    cells +=
      `<text x="${r(w - 4)}" y="${r(y + ch / 2)}" text-anchor="end" dominant-baseline="middle" ` +
      `font-size="${fs}" fill="currentColor" fill-opacity="0.78">${escText(rowLabel)}</text>`;
    cols.forEach((col, ci) => {
      const x = colX(ci);
      const raw = col.values[ri];
      const v = isNum(raw) ? raw : null;
      const cx = x + pad;
      const cy = y + pad;
      const cwi = Math.max(0, cw - pad * 2);
      const chi = Math.max(0, ch - pad * 2);
      if (v === null) {
        // Missing data — outlined, unfilled, em-dash. Never a fake value.
        cells +=
          `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
          `fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="1" stroke-dasharray="3 3"/>` +
          `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${fs}" fill="currentColor" fill-opacity="0.55">—</text>`;
        return;
      }
      const { base, overlay, t } = tintOf(v, col);
      // Two stacked rects = a literal sRGB blend base→overlay. Opaque, so the
      // cell looks identical in the dark and light themes and in print.
      cells +=
        `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
        `fill="${base}" style="${PRINT_EXACT}"/>` +
        `<rect x="${r(cx)}" y="${r(cy)}" width="${r(cwi)}" height="${r(chi)}" rx="${rx}" ` +
        `fill="${overlay}" fill-opacity="${r(t)}" style="${PRINT_EXACT}"/>` +
        `<text x="${r(x + cw / 2)}" y="${r(y + ch / 2)}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-size="${fs}" font-weight="700" fill="${ink}">${escText(fmtTick(v))}</text>`;
    });
  });

  // Column headers along the top: label, then this column's own domain range
  // beneath it — same RTL slot mapping as the cells.
  const colHeads = cols
    .map((col, ci) => {
      const cxm = colX(ci) + cw / 2;
      return (
        `<text x="${r(cxm)}" y="${r(headLine1H - 2)}" text-anchor="middle" ` +
        `font-size="${fs}" font-weight="700" fill="currentColor" fill-opacity="0.82">${escText(col.label)}</text>` +
        `<text x="${r(cxm)}" y="${r(headLine1H + headLine2H - 3)}" text-anchor="middle" ` +
        `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.55">${escText(
          `${fmtTick(col.domain[0])}–${fmtTick(col.domain[1])}`,
        )}</text>`
      );
    })
    .join("");

  const svg = svgOpen(w, h, title) + colHeads + cells + `</svg>`;

  // Screen-reader table keeps the LOGICAL column order and carries dir="rtl"
  // — assistive tech and print both expect document order here.
  const headers = [opts.rowHeader ?? "الصف", ...cols.map((c) => c.label)];
  const srRows = rows.map((rowLabel, ri) => [
    rowLabel,
    ...cols.map((col) => {
      const raw = col.values[ri];
      return isNum(raw) ? fmtTick(raw) : "—";
    }),
  ]);
  return figure(svg, srTable(title, headers, srRows));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. timeSeriesBand — day-of-month series, each carrying a shaded control band
// ════════════════════════════════════════════════════════════════════════════

/**
 * One day's point for one series.
 *
 * `y === null` is a GAP — no evaluable decisions that day — and must never be
 * interpolated across; a quiet day is not a measurement. `lo`/`hi` are that
 * day's control-band bounds (independent of `y`, since a band can exist even
 * where the series itself has no data, e.g. a fixed threshold). `n` is the
 * day's sample size, surfaced only in the screen-reader table (the SVG never
 * encodes it visually — a 31-day strip has no room for a second numeral per
 * point without hurting legibility).
 */
export type BandPoint = {
  x: number;
  y: number | null;
  n: number;
  lo: number | null;
  hi: number | null;
};

export type BandSeries = {
  /** Series name — legend/sr-table text. Escaped on render (a real injection
   *  surface: labels can originate from BI-imported free text). */
  label: string;
  tone: ColorRole;
  points: BandPoint[];
};

export type TimeSeriesBandOpts = {
  width?: number;
  height?: number;
  caption?: string;
  /** Fixed axis maximum. Defaults to 31 — the axis is the MONTH, not the
   *  data, so a sparse month (e.g. only 3 days with results so far) must not
   *  silently compress into a chart that looks like a dense, complete one. */
  xMax?: number;
  emptyNote?: string;
};

/**
 * Day-of-month percentage trend, one polyline per series, each series
 * carrying its own shaded control band (e.g. ±2σ around a target rate). A
 * point that falls outside its OWN band gets an explicit marker — that
 * signal is the entire reason the band is drawn, and per the deck's no-
 * colour-only-encoding rule it is a size/stroke difference, not just a hue,
 * so it still reads in print and to colour-blind viewers.
 *
 * RTL: this module's x axes run right → left (header note 2) so numeric
 * domains read in the document's natural direction — day 1 sits at the RIGHT
 * edge (the RTL reading start) and day `xMax` at the LEFT, mirroring
 * bubbleScatter's reversed range. The y-axis gutter therefore lives on the
 * RIGHT, same as bubbleScatter's y ticks.
 *
 * A `null` y ends the current run without closing the series: each
 * contiguous stretch of plottable points becomes its own <polyline> (and, if
 * every point in that stretch has a band, its own shaded <polygon>) — two
 * runs separated by a gap day render as two disconnected segments, never one
 * line drawn straight across the gap.
 *
 * Pure SVG string, built once at render time — no runtime layout
 * recomputation, per the deck's standing rule.
 */
export function timeSeriesBand(series: BandSeries[], opts: TimeSeriesBandOpts = {}): string {
  const w = opts.width ?? 620;
  const h = opts.height ?? 300;
  const xMax = Math.max(1, opts.xMax ?? 31);
  const title = opts.caption ?? "الاتجاه اليومي";
  const plottable = series.filter((s) => s.points.some((p) => isNum(p.y)));

  // data-x-max carries the fixed axis bound onto the DOM even in the empty
  // case, so a caller/test can confirm the axis never silently shrank to fit
  // whatever the (possibly sparse) data happened to contain.
  if (plottable.length === 0) {
    return `<div class="v2-ts-wrap" data-x-max="${xMax}">${emptyState(w, h, title, opts.emptyNote)}</div>`;
  }

  // ── reserved strips (all carved OUT of w×h; the plot never overflows) ──────
  const legendH = TYPE.micro + 12; // one horizontal legend row above the plot
  const xAxisH = TYPE.micro + 10; // day-number tick labels below the plot
  const yGutter = 28; // RIGHT-hand gutter for the 0/25/50/75/100 tick labels
  const gridLeft = 14;
  const gridRight = Math.max(gridLeft + 20, w - yGutter);
  const gridTop = legendH + 6;
  const gridBottom = Math.max(gridTop + 20, h - xAxisH);
  const plotW = gridRight - gridLeft;
  const plotH = gridBottom - gridTop;
  // Guard a 1-day domain (xMax === 1) so (x-1)/(xMax-1) never divides by 0.
  const xSpan = xMax > 1 ? xMax - 1 : 1;

  // RTL: range reversed — day 1 → gridRight, day xMax → gridLeft (see doc
  // comment above; matches bubbleScatter's `.range([plotRight, plotLeft])`).
  const sx = (x: number): number => gridRight - ((x - 1) / xSpan) * plotW;
  const sy = (y: number): number => gridTop + (1 - clamp(y, 0, 100) / 100) * plotH;

  // Horizontal gridlines + y labels at 0/25/50/75/100, ticks in the RIGHT
  // gutter (RTL reading start) — same placement bubbleScatter's y axis uses.
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${r(gridLeft)}" y1="${r(sy(v))}" x2="${r(gridRight)}" y2="${r(sy(v))}" ` +
        `stroke="currentColor" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="3 3"/>` +
        `<text x="${r(gridRight + 6)}" y="${r(sy(v))}" text-anchor="start" dominant-baseline="middle" ` +
        `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.62">${v}</text>`,
    )
    .join("");

  // X ticks every 5 days plus day 1 and the last day — enough to orient
  // without cluttering a 31-slot axis.
  const xTicks = [1, 5, 10, 15, 20, 25, 30, xMax].filter((d, i, a) => d <= xMax && a.indexOf(d) === i);
  const ticks = xTicks
    .map((d) => {
      const x = sx(d);
      return (
        `<line x1="${r(x)}" y1="${r(gridBottom)}" x2="${r(x)}" y2="${r(gridBottom + 3)}" ` +
        `stroke="currentColor" stroke-opacity="0.28" stroke-width="1"/>` +
        `<text x="${r(x)}" y="${r(gridBottom + TYPE.micro + 7)}" text-anchor="middle" ` +
        `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.62">${d}</text>`
      );
    })
    .join("");

  const body = plottable
    .map((s) => {
      const color = cssVar(s.tone);
      // Contiguous runs of plottable points — a null y ENDS the run without
      // closing the series, so each run becomes its own polyline/polygon.
      const runs: BandPoint[][] = [];
      let run: BandPoint[] = [];
      for (const p of s.points) {
        if (isNum(p.y)) run.push(p);
        else if (run.length > 0) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length > 0) runs.push(run);

      // Shaded control band — only for runs where every point carries one;
      // a run with a partial band would draw a misleading polygon edge.
      const bands = runs
        .filter((rn) => rn.every((p) => isNum(p.lo) && isNum(p.hi)))
        .map((rn) => {
          const top = rn.map((p) => `${r(sx(p.x))},${r(sy(p.hi as number))}`).join(" ");
          const bottom = [...rn]
            .reverse()
            .map((p) => `${r(sx(p.x))},${r(sy(p.lo as number))}`)
            .join(" ");
          return `<polygon points="${top} ${bottom}" fill="${color}" fill-opacity="0.14" style="${PRINT_EXACT}"/>`;
        })
        .join("");

      const lines = runs
        .map(
          (rn) =>
            `<polyline points="${rn
              .map((p) => `${r(sx(p.x))},${r(sy(p.y as number))}`)
              .join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`,
        )
        .join("");

      // Out-of-band points get a bigger radius PLUS a stroke ring — a
      // shape/stroke difference, not just a colour swap, so the signal
      // survives print and colour-blind viewing (deck rule: no colour-only
      // encoding).
      const dots = s.points
        .filter((p) => isNum(p.y))
        .map((p) => {
          const y = p.y as number;
          const out = isNum(p.lo) && isNum(p.hi) && (y > (p.hi as number) || y < (p.lo as number));
          return out
            ? `<circle class="ts-out" cx="${r(sx(p.x))}" cy="${r(sy(y))}" r="4.5" fill="${color}" ` +
                `stroke="currentColor" stroke-width="1.5" style="${PRINT_EXACT}"/>`
            : `<circle class="ts-dot" cx="${r(sx(p.x))}" cy="${r(sy(y))}" r="2.5" fill="${color}" ` +
                `style="${PRINT_EXACT}"/>`;
        })
        .join("");

      return bands + lines + dots;
    })
    .join("");

  // Horizontal legend above the plot — one row, RTL: first series flush to
  // the RIGHT edge (reading start), each subsequent series' slot growing
  // leftward. Swatch-then-label-to-its-left mirrors legendRows' per-row
  // pattern (swatch flush to the slot's right edge, text-anchor="end").
  const legendItemW = 150;
  const legend = plottable
    .map((s, i) => {
      const slotRight = gridRight - i * legendItemW;
      const swatchX = slotRight - 4;
      return (
        `<rect x="${r(swatchX - 8)}" y="4" width="8" height="8" rx="2" fill="${cssVar(
          s.tone,
        )}" style="${PRINT_EXACT}"/>` +
        `<text x="${r(swatchX - 12)}" y="11" text-anchor="end" ` +
        `font-size="${TYPE.micro}" fill="currentColor" fill-opacity="0.78">${escText(s.label)}</text>`
      );
    })
    .join("");

  const svg = svgOpen(w, h, title) + grid + ticks + body + legend + `</svg>`;

  // Screen-reader table: one row per day 1..xMax, one column per INPUT
  // series (not just the plottable ones — an all-gap series is still
  // meaningful information, same as bubbleScatter listing unplotted points).
  const cellFor = (p: BandPoint | undefined): string => {
    if (!p || !isNum(p.y)) return "—";
    const val = `${fmtTick(clamp(p.y, 0, 100))}%`;
    const band = isNum(p.lo) && isNum(p.hi) ? ` (${fmtTick(p.lo)}–${fmtTick(p.hi)}%)` : "";
    return `${val}${band} ن=${p.n}`;
  };
  const byDay = series.map((s) => {
    const m = new Map<number, BandPoint>();
    for (const p of s.points) m.set(p.x, p);
    return m;
  });
  const headers = ["اليوم", ...series.map((s) => s.label)];
  const srRows: string[][] = [];
  for (let d = 1; d <= xMax; d++) {
    srRows.push([String(d), ...byDay.map((m) => cellFor(m.get(d)))]);
  }

  return `<div class="v2-ts-wrap" data-x-max="${xMax}">${figure(svg, srTable(title, headers, srRows))}</div>`;
}
