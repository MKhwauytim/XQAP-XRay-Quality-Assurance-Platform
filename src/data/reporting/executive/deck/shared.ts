// Shared slide-render helpers for the executive Presentation (design §6).
// Pure HTML-string builders — no React, no DOM, no runtime JS. Every visual comes
// from `ui/charts.ts`; every glyph from `ui/icons.ts` (no emoji). Slides are sized
// to a fixed 16:9 landscape box and never runtime-scaled.

import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";

export { esc, fmtNum, fmtPct };

export type Tone = "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";

export type SlideOpts = {
  /** Anchor / data-title id (used by the viewer TOC). */
  id: string;
  /** TOC title. */
  title: string;
  /** 1-based slide number, shown top-left of the slide. */
  num: number;
  /** Total slide count, for the "N / M" indicator. */
  total: number;
  /** Eyebrow line (small caps label above the headline). */
  eyebrow: string;
  iconName: string;
  /** The single headline message (the one-liner per blueprint §3). */
  headline: string;
  subhead?: string;
  /** Hero body HTML (the one supporting visual / content). */
  body: string;
  /** "The decision this supports" footer text. */
  decision: string;
  /** Extra class on the `.slide` element (e.g. "title-slide"). */
  slideClass?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A standard content slide: eyebrow + headline + hero body + decision footer. */
export function slide(opts: SlideOpts): string {
  const cls = `slide${opts.slideClass ? " " + opts.slideClass : ""}`;
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}">
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
      <span class="slide-num">${pad(opts.num)} / ${pad(opts.total)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${opts.body}</div>
  </div>
  <div class="slide-footer">
    <span class="foot-icon">${icon("flag", 16)}</span>
    <span class="foot-label">القرار المدعوم</span>
    <span class="foot-text">${esc(opts.decision)}</span>
  </div>
</section>`;
}

/** Two-column split body: hero on one side, supporting on the other. */
export function split(
  left: string,
  right: string,
  variant: "" | "wide-left" | "even" = "",
): string {
  const cls = `slide-split${variant ? " " + variant : ""}`;
  return `<div class="${cls}"><div>${left}</div><div>${right}</div></div>`;
}

/** A big hero number with caption + optional sub-line (the layered headline). */
export function heroNumber(opts: {
  value: string;
  caption: string;
  sub?: string;
  tone?: Tone;
}): string {
  const tone = opts.tone ?? "gold";
  return `<div class="hero-figure">
    <div class="hero-number ${tone}">${esc(opts.value)}</div>
    <div class="hero-caption">${esc(opts.caption)}</div>
    ${opts.sub ? `<div class="hero-sub">${esc(opts.sub)}</div>` : ""}
  </div>`;
}

/** Wrap an SVG chart as the slide's hero visual at a fixed height. */
export function heroChart(svg: string, opts: { height?: number; caption?: string } = {}): string {
  const h = opts.height ?? 320;
  return `<div class="hero-chart" style="--hero-h:${h}px">${svg}</div>${
    opts.caption ? `<div class="hero-chart-cap">${esc(opts.caption)}</div>` : ""
  }`;
}

/** A KPI band tile (one of the headline numbers). `value` is pre-formatted. */
export function kpiTile(opts: { label: string; value: string; sub?: string; tone?: Tone }): string {
  const tone = opts.tone ?? "gold";
  return `<div class="kpi-tile ${tone}">
    <div class="kpi-tile-label">${esc(opts.label)}</div>
    <div class="kpi-tile-value">${esc(opts.value)}</div>
    ${opts.sub ? `<div class="kpi-tile-sub">${esc(opts.sub)}</div>` : ""}
  </div>`;
}

/** A band (row) of KPI tiles. */
export function kpiBand(tiles: string[]): string {
  const n = Math.min(5, Math.max(2, tiles.length));
  return `<div class="kpi-band n${n}">${tiles.join("")}</div>`;
}

/** A curated mini-table (top-N rows only — never a full table, per blueprint §3). */
export function miniTable(opts: { headers: string[]; rows: (string | number | null)[][] }): string {
  const th = opts.headers.map((h) => `<th>${esc(String(h))}</th>`).join("");
  const trs = opts.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c) => `<td>${c === null ? '<span class="insuff">—</span>' : esc(String(c))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="deck-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** A grid of finding/action cards. */
export function cards(
  items: { iconName?: string; title: string; text: string; tone?: Tone }[],
  cols: 2 | 3 = 3,
): string {
  const body = items
    .map((c) => {
      const tone = c.tone && c.tone !== "gold" ? ` ${c.tone}` : "";
      return `<div class="deck-card${tone}">
        ${c.iconName ? `<span class="deck-card-icon">${icon(c.iconName, 20)}</span>` : ""}
        <h4>${esc(c.title)}</h4>
        <p>${esc(c.text)}</p>
      </div>`;
    })
    .join("");
  return `<div class="deck-cards n${cols}">${body}</div>`;
}

/** A numbered list (decisions required / priority actions). */
export function numberedList(items: string[]): string {
  const li = items
    .map((t, i) => `<li><span class="deck-list-num">${i + 1}</span><span>${esc(t)}</span></li>`)
    .join("");
  return `<ul class="deck-list">${li}</ul>`;
}

/** A simple timeline (next-period cadence). */
export function timeline(steps: { when: string; what: string }[]): string {
  const body = steps
    .map(
      (s) =>
        `<div class="tl-step"><div class="tl-when">${esc(s.when)}</div><div class="tl-what">${esc(
          s.what,
        )}</div></div>`,
    )
    .join("");
  return `<div class="deck-timeline">${body}</div>`;
}

/** Centered "insufficient data this period" state for a slide (honesty, §3.7). */
export function emptyHero(title: string, detail: string): string {
  return `<div class="deck-empty">
    <span class="deck-empty-icon">${icon("alert", 36)}</span>
    <b>${esc(title)}</b>
    <span>${esc(detail)}</span>
  </div>`;
}
