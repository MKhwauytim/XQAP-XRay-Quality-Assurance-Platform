// Shared document-level render helpers for the executive Document (design §5).
// Pure HTML-string builders — no React, no DOM, no runtime JS. Every visual comes
// from `ui/charts.ts`; every glyph from `ui/icons.ts` (no emoji). Pages are sized to
// an A4 content budget and never runtime-scaled (the fitPages hack is removed).

import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";

export { esc, fmtNum, fmtPct };

const RAIL_TITLE = "التقرير التنفيذي";
const RAIL_SUB = "لضمان جودة الأشعة";

/** Right-rail markup shared by every content page. `tabs[0]` renders active. */
export function rightRail(tabs: string[]): string {
  return `<div class="right-rail">
    <div class="rail-main">${RAIL_TITLE} <em>${RAIL_SUB}</em></div>
    ${tabs
      .map((t, i) => `<div class="rail-tab${i === 0 ? " active" : ""}">${esc(t)}</div>`)
      .join("")}
  </div>`;
}

export type PageOpts = {
  id: string;
  /** Sidebar / TOC title (also `data-title`). */
  title: string;
  /** Printed page number, e.g. "05". */
  pageNo: string;
  /** Right-rail tab labels (first = active). */
  railTabs: string[];
  /** Inner page body HTML (between the eyebrow header and the page number). */
  body: string;
  /** Extra class on the `.page` element (e.g. "compact"). */
  pageClass?: string;
};

/** A standard content page shell: right rail + eyebrow + body + page number. */
export function page(opts: PageOpts): string {
  const cls = `page${opts.pageClass ? " " + opts.pageClass : ""}`;
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}">
  ${rightRail(opts.railTabs)}
  <div class="page-inner">
${opts.body}
    <div class="page-no">${esc(opts.pageNo)}</div>
  </div>
</section>`;
}

/** Eyebrow + section title + subtitle header (icon is an inline SVG, never emoji). */
export function pageHeader(opts: {
  iconName: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
}): string {
  return `<div class="doc-eyebrow"><span class="doc-eyebrow-icon">${icon(opts.iconName, 18)}</span><span>${esc(opts.eyebrow)}</span></div>
    <h2 class="section-title">${esc(opts.title)}</h2>
    ${opts.subtitle ? `<div class="section-subtitle">${esc(opts.subtitle)}</div>` : ""}`;
}

export type KpiTone = "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";

/** A single KPI card. `value` is rendered verbatim (already formatted). */
export function kpi(opts: { label: string; value: string; sub?: string; tone?: KpiTone }): string {
  const tone = opts.tone ?? "gold";
  return `<div class="card doc-kpi ${tone}">
    <div class="doc-kpi-label">${esc(opts.label)}</div>
    <div class="metric ${tone}">${esc(opts.value)}</div>
    ${opts.sub ? `<div class="doc-kpi-sub muted">${esc(opts.sub)}</div>` : ""}
  </div>`;
}

/** A strip of KPI cards (the 5-second headline numbers at the top of a page). */
export function kpiStrip(cards: string[], cols = cards.length): string {
  const n = Math.min(5, Math.max(1, cols));
  return `<div class="grid grid-${n} doc-kpi-strip">${cards.join("")}</div>`;
}

/** A titled panel wrapping arbitrary body HTML. */
export function panel(title: string, body: string, opts: { fill?: boolean; iconName?: string } = {}): string {
  const head = opts.iconName
    ? `<div class="panel-title doc-panel-title"><span>${icon(opts.iconName, 16)}</span>${esc(title)}</div>`
    : `<div class="panel-title">${esc(title)}</div>`;
  return `<div class="card doc-panel${opts.fill ? " page-fill" : ""}">${head}${body}</div>`;
}

/**
 * The fixed 3-line executive close (blueprint §1.7 / master §21): what the data
 * shows / why it matters / required action. Fed from model-derived strings — never
 * hand-written per page. Renders an icon chip per line (no emoji).
 */
export function executiveClose(opts: {
  shows: string;
  matters: string;
  action: string;
}): string {
  const line = (iconName: string, label: string, text: string): string =>
    `<div class="doc-close-line">
      <span class="doc-close-icon">${icon(iconName, 16)}</span>
      <div><b>${esc(label)}</b><span>${esc(text)}</span></div>
    </div>`;
  return `<div class="doc-close">
    ${line("chart", "ما تظهره البيانات", opts.shows)}
    ${line("shield", "لماذا يهم", opts.matters)}
    ${line("flag", "الإجراء المطلوب", opts.action)}
  </div>`;
}

/** A small note / caveat box (data-sufficiency, association-not-causation, etc.). */
export function noteBox(text: string, iconName = "alert"): string {
  return `<div class="info doc-note"><span class="doc-note-icon">${icon(iconName, 16)}</span><span>${esc(text)}</span></div>`;
}

/** Centered empty-state for a page/section that has no data this period (§3.4). */
export function emptyState(title: string, detail?: string): string {
  return `<div class="notice-centered doc-empty">
    <div class="doc-empty-icon">${icon("alert", 30)}</div>
    <div><b>${esc(title)}</b>${detail ? `<br><span class="muted">${esc(detail)}</span>` : ""}</div>
  </div>`;
}

/** Status chip mapped to the data-sufficiency / port-status vocabulary. */
export function statusChip(
  status: "excellent" | "stable" | "monitor" | "priority" | "insufficient" | "limited" | string,
): string {
  const labels: Record<string, string> = {
    excellent: "ممتاز",
    stable: "مستقر",
    monitor: "متابعة",
    priority: "أولوية",
    insufficient: "بيانات غير كافية",
    limited: "بيانات محدودة",
  };
  const tone: Record<string, string> = {
    excellent: "green",
    stable: "blue",
    monitor: "orange",
    priority: "red",
    insufficient: "",
    limited: "orange",
  };
  return `<span class="chip ${tone[status] ?? ""}">${esc(labels[status] ?? status)}</span>`;
}

/** Wrap an SVG chart in a fixed-height figure box with an optional caption. */
export function figure(svg: string, opts: { height?: number; caption?: string } = {}): string {
  const h = opts.height ?? 200;
  return `<div class="doc-figure" style="--fig-h:${h}px">
    <div class="doc-figure-svg">${svg}</div>
    ${opts.caption ? `<div class="doc-figure-cap muted">${esc(opts.caption)}</div>` : ""}
  </div>`;
}
