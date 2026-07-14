// Executive deck v2 — content-first rebuild of the presentation edition.
// Page structure (user spec, 2026-07-04):
//   1  الغلاف       — report name, study period, issue date, department/section, ZATCA logo
//   2  المحتويات    — the report sections and the goal of each
//   3  المعجم       — key terms and what each means
//   4  فاصل القسم الأول — مجتمع الفحص
//   5  مجتمع الصور بناءً على المخاطر — the 4 risk stages: population + sample per stage
//   6+ مجتمع صور الفحص للشهر — two tables (منافذ برية / بحرية), paginated when long
//
// Design/CSS is intentionally minimal for now: it reuses the v1 deck theme so the
// content reads clearly; the dedicated visual pass happens after content approval.

import type { ReportModel } from "../model/reportModel";
import type { StageProfile } from "../../executiveReportTypes";
import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";
import { rankedBar, funnel } from "../ui/charts";
import { coverMeshSvg, dividerPatternSvg } from "../ui/generativeArt";
import { isRankable } from "../model/dataSufficiency";
import { formatStageLabel } from "../../../population/stageHelpers";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";
import type { SourceRevisions } from "../../sourceRevisions";
import { sourceRevisionEntries } from "../../sourceRevisions";

// ── In-cell visuals (pure background — never change row height/padding/font) ──
type CellTone = "gold" | "blue" | "green" | "coral" | "neutral";

/**
 * Wrap a numeric cell's inner HTML in a <td> that paints a tone-tinted
 * proportional bar behind the text, growing from the inline-start edge (right,
 * in this RTL deck). The bar is a CSS background only (`.v2-bar-cell` in
 * theme.ts reads `--w`), so it adds ZERO layout height — the fragile
 * pixel-budget table machinery (METRICS_*, TABLE_BUDGET_PX, ghost/blank rows)
 * stays exactly valid. `pct` is the value's share of the column max, 0–100.
 */
function barCell(inner: string, pct: number, tone: CellTone = "neutral"): string {
  const w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return `<td class="v2-bar-cell ${tone}" style="--w:${w.toFixed(1)}%">${inner}</td>`;
}

/**
 * A percentage cell that doubles as a threshold-scored bar: the fill width is
 * the percentage itself, the tone is green at/above `target` and warning-amber
 * below it, and a below-target cell also carries an alert glyph (icons.ts) so
 * the status is NEVER conveyed by color alone. Null (no data) renders the muted
 * "—" like `pctCell`, with no bar.
 */
function threshCell(v: number | null, target: number): string {
  if (v === null) return `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
  const val = Math.max(0, Math.min(100, v));
  const below = val < target;
  const tone = below ? "warn" : "ok";
  const flag = below ? `<span class="v2-cell-flag" aria-hidden="true">${icon("alert", 10)}</span>` : "";
  return `<td class="v2-bar-cell ${tone}" style="--w:${val.toFixed(1)}%">${flag}${fmtPct(v)}</td>`;
}

/** Largest value in a list, floored at 1 so a proportional bar never divides by
 *  zero (an all-zero column simply yields empty bars). */
function maxOf(values: number[]): number {
  return Math.max(1, ...values.filter((v) => Number.isFinite(v)));
}

/** Display thresholds for the section-2 percent tables. Mirror the report
 *  config defaults (`DEFAULT_EXEC_CONFIG.accuracyTarget` = 90); the ReportModel
 *  doesn't carry config, so these are named constants here rather than magic
 *  numbers. Below-target cells get the warning tone + alert glyph in threshCell. */
const ACCURACY_TARGET = 90;
const MARKING_TARGET = 90;

/** A distribution percent cell (quality عالي/متوسط/منخفض): a tone-colored bar of
 *  fixed polarity (green = good share, coral = risk share), NOT threshold-scored.
 *  Null renders the muted "—". */
function qualCell(v: number | null, tone: CellTone): string {
  if (v === null) return `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
  return barCell(fmtPct(v), Math.max(0, Math.min(100, v)), tone);
}

const ARABIC_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** A slide builder that receives its final 1-based number and the deck total. */
type SlideBuilder = (num: number, total: number) => string;

/**
 * Optical-centering correction for icons placed inside a circular badge.
 * Measured via `getBBox()` on every icon in the registry, rendered inside
 * its actual circle: most glyphs sit within ~0.5 of a 24-unit viewBox from
 * true center (imperceptible), but a few don't — `gauge`'s dial is drawn in
 * the lower half of its box, `truck` and `flag` are each off by ~1 unit on
 * one axis. Values are the glyph-bbox-center offset from (12,12) as a
 * percentage of the 24-unit viewBox, so the correction holds at any render
 * size (percentage `transform` is relative to the SVG's own box).
 */
const ICON_OPTICAL_NUDGE: Record<string, { x: number; y: number }> = {
  gauge: { x: 0, y: -10.8 },
  truck: { x: 2.1, y: -8.5 },
  flag: { x: 6.3, y: 0 },
};

/** Renders an icon meant to sit centered inside a circular badge, applying
 *  the optical-centering correction above when one exists for that icon.
 *  Plain (non-badge) icon usage elsewhere in the deck is unaffected. */
function badgeIcon(name: string, size: number): string {
  const nudge = ICON_OPTICAL_NUDGE[name];
  if (!nudge) return icon(name, size);
  return `<span style="display:inline-flex;transform:translate(${nudge.x}%,${nudge.y}%)">${icon(name, size)}</span>`;
}

/**
 * Per-slide print-include switch, on-screen only. Pure CSS, no script:
 * unchecking it excludes the WHOLE slide from print/PDF output via the
 * `.slide:has(.slide-print-toggle input:not(:checked))` rule in theme.ts —
 * safe to rely on `:has()` since this app already targets Chromium only
 * (File System Access API). Defaults checked (included). Rendered inside
 * `slideControls()`, which positions it (top-right corner).
 */
function printToggle(): string {
  return `<label class="slide-print-toggle" title="تضمين هذه الصفحة عند الطباعة">
    <input type="checkbox" checked/>
    <span class="slide-print-toggle-track"><span class="slide-print-toggle-thumb"></span></span>
  </label>`;
}

/**
 * Style-variant arrow-cycle control, dev-preview only. `data-for` points at
 * the matching `.v2-variant-stack`'s `data-slide-id` (same slide, but the
 * switcher itself lives in `slideControls()`'s top-right cluster, not nested
 * inside the stack — see DECK_VARIANT_SCRIPT in index.ts for the lookup).
 */
function variantSwitcher(slideId: string): string {
  return `<div class="v2-variant-switcher" data-for="${esc(slideId)}" dir="ltr">
    <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
    <span class="v2-variant-label">1 / 4</span>
    <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
  </div>`;
}

/**
 * Top-right controls cluster for a slide: the print-include toggle, plus
 * (dev-preview only) the style-variant switcher right next to it — grouped in
 * one positioned wrapper (theme.ts's `.slide-controls`) instead of each being
 * independently absolutely-positioned.
 */
function slideControls(slideId: string, variantPreview: boolean): string {
  return `<div class="slide-controls">
    ${printToggle()}
    ${variantPreview ? variantSwitcher(slideId) : ""}
  </div>`;
}

/** Section keys shared by the side nav (deck2/index.ts) and every slide builder
 *  that belongs to that section, so the nav's list and highlight logic can be
 *  derived purely from `data-section`/`data-section-label` attributes already
 *  in the DOM — no separate section registry to keep in sync. */
export const NAV_SECTIONS = {
  cover: "الغلاف",
  toc: "المحتويات",
  summary: "الشهر في أرقام",
  glossary: "المعجم",
  section1: "القسم 1 — مجتمع الفحص",
  section2: "القسم 2 — نتائج فحص الجودة",
  closing: "مصدر البيانات",
} as const;
export type NavSectionKey = keyof typeof NAV_SECTIONS;

/**
 * Printed side tab rail (per the user's reference mockups): a vertical
 * report-title strip plus one rotated tab per section, running down every
 * content slide's inline-start edge, active section highlighted gold. Unlike
 * the on-screen deck-nav this is PART of the slide, so it prints. Arabic in
 * `writing-mode:vertical-rl` renders rotated 90° in Chromium — exactly the
 * look of the reference pages' edge tabs.
 */
function sideRail(active: NavSectionKey): string {
  const tabs: Array<{ key: NavSectionKey; label: string }> = [
    { key: "glossary", label: "المعجم" },
    { key: "section1", label: "مجتمع الفحص" },
    { key: "section2", label: "نتائج فحص الجودة" },
  ];
  return `<div class="v2-rail" aria-hidden="true">
    <div class="v2-rail-title">التقرير التنفيذي لضمان جودة الأشعة</div>
    ${tabs
      .map((t) => `<div class="v2-rail-tab${t.key === active ? " active" : ""}">${esc(t.label)}</div>`)
      .join("")}
  </div>`;
}

/** Footer page number, centered with short gold rules either side (the
 *  references' bottom-of-page device). Absolutely positioned inside the
 *  slide's existing bottom padding band — no impact on the body budget. */
function pageFoot(num: number, total: number): string {
  return `<div class="v2-page-foot" dir="ltr">${pad(num)} / ${pad(total)}</div>`;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders ONLY `bodies[0]` — byte-identical
 * to the single-variant output that existed before the switcher (a dev-preview
 * feature; see docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`).
 * The arrow-cycle control that drives this lives separately in
 * `slideControls()`/`variantSwitcher()`; the inline script in deck2/index.ts
 * (DECK_VARIANT_SCRIPT) wires the two together by matching `data-for` to
 * `data-slide-id` and persists the choice.
 */
function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  if (!variantPreview) return bodies[0];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === 0 ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">${panels}</div>`;
}

// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  bodyVariants: readonly [string, string, string, string];
  variantPreview: boolean;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  const body = renderVariants(opts.id, opts.bodyVariants, opts.variantPreview);
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${slideControls(opts.id, opts.variantPreview)}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}

// ── Page 1 — الغلاف ─────────────────────────────────────────────────────────
/** Low-contrast geometric band (SVG pattern) used behind the cover + section
 *  covers — thin gold diagonals + a hairline grid, brand-amplifying, recessive.
 *  Pure decoration (aria-hidden); no data, so no esc() needed. */
function coverBand(): string {
  return `<svg class="v2-cover-band" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <pattern id="v2band-diag" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
        <line x1="0" y1="0" x2="0" y2="26" stroke="var(--gold)" stroke-width="1" stroke-opacity="0.06"/>
      </pattern>
      <linearGradient id="v2band-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--gold)" stop-opacity="0"/>
        <stop offset="1" stop-color="var(--gold)" stop-opacity="0.10"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="1200" height="400" fill="url(#v2band-diag)"/>
    <rect x="0" y="250" width="1200" height="150" fill="url(#v2band-fade)"/>
  </svg>`;
}

export function coverSlide(
  model: ReportModel,
  generatedAt: Date,
  variantPreview: boolean,
  seedBase = "",
): string {
  const [, department, section] = ORGANIZATION_PATH;
  // Seeded low-poly navy mesh behind the glow + geometric band (aria-hidden,
  // pure decoration). Deterministic on the month key so the cover is stable
  // across opens; "" on failure so the cover falls back to its gradient.
  const meshSvg = coverMeshSvg(seedBase || model.summary.periodId);
  const meshLayer = meshSvg
    ? `<div class="v2-cover-mesh" aria-hidden="true">${meshSvg}</div>`
    : "";
  const meta = [
    { label: "فترة الدراسة", value: model.summary.periodId, iconName: "layers" },
    { label: "تاريخ الإصدار", value: formatDate(generatedAt), iconName: "document" },
    { label: "الإدارة", value: department, iconName: "users" },
    { label: "القسم", value: section, iconName: "shield" },
  ]
    .map(
      (m) => `<div class="v2-cover-meta-item">
        <span class="v2-cover-meta-icon">${badgeIcon(m.iconName, 18)}</span>
        <span class="v2-cover-meta-text">
          <span class="v2-cover-meta-label">${esc(m.label)}</span>
          <span class="v2-cover-meta-value">${esc(m.value)}</span>
        </span>
      </div>`,
    )
    .join("");
  // Org header block: logo + gold divider + the organizational hierarchy lines.
  const orgBlock = `<div class="v2-org">
      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>
      <div class="v2-org-lines">
        <b>هيئة الزكاة والضريبة والجمارك</b>
        ${ORGANIZATION_PATH.map((line) => `<span>${esc(line)}</span>`).join("")}
      </div>
    </div>`;
  // Asymmetric hero: giant month lockup + title on the start side, stacked
  // issue-metadata column on the end side, gold rule system between them.
  const coverBody = `<div class="v2-cover-grid">
      <div class="v2-cover-hero">
        <div class="v2-cover-kicker"><span class="v2-cover-kicker-dot"></span>عرض تنفيذي · تقرير شهري</div>
        <h1 class="v2-cover-title">تقرير ضمان جودة<br/>فحص الأشعة</h1>
        <div class="v2-cover-rule"></div>
        <div class="v2-cover-lockup">
          <span class="v2-cover-lockup-label">فترة الدراسة (عيّنة شهر)</span>
          <span class="v2-cover-lockup-period">${esc(model.summary.periodId)}</span>
        </div>
        <div class="v2-cover-badge"><span>${icon("shield", 13)}</span>داخلي — للاستخدام التنفيذي</div>
      </div>
      <div class="v2-cover-meta-col">${meta}</div>
    </div>`;
  const body = renderVariants("slide-cover", [coverBody, coverBody, coverBody, coverBody], variantPreview);
  return `<section class="slide v2 title-slide v2-cover" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${slideControls("slide-cover", variantPreview)}
    ${meshLayer}
    <div class="slide-art" aria-hidden="true"></div>
    ${coverBand()}
    ${orgBlock}
    <div class="slide-inner">
      ${body}
    </div>
  </section>`;
}

// ── Page 2 — المحتويات ──────────────────────────────────────────────────────
export type TocItem = {
  title: string;
  goal: string;
  range: string;
  iconName: string;
  tone: string;
  figure: string;
  figureLabel: string;
};

export function tocSlide(items: TocItem[], num: number, total: number, variantPreview: boolean): string {
  const body = `<div class="v2-toc-grid">${items
    .map(
      (it, i) => `<div class="v2-toc-card ${esc(it.tone)}">
        <div class="v2-toc-num">${pad(i + 1)}</div>
        <div class="v2-toc-main">
          <h4><span class="v2-toc-icon">${icon(it.iconName, 16)}</span>${esc(it.title)}</h4>
          <p>${esc(it.goal)}</p>
        </div>
        <div class="v2-toc-side">
          <div class="v2-toc-figure">${esc(it.figure)}</div>
          <div class="v2-toc-figure-label">${esc(it.figureLabel)}</div>
          <div class="v2-toc-range" dir="ltr">${esc(it.range)}</div>
        </div>
      </div>`,
    )
    .join("")}</div>`;
  return v2Slide({
    id: "slide-toc",
    title: "المحتويات",
    eyebrow: "المحتويات",
    iconName: "layers",
    headline: "محتويات التقرير",
    subhead: "أقسام التقرير والهدف من كل قسم، ونطاق صفحاته.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "toc",
  });
}

// ── NEW — الشهر في أرقام (headline dashboard) ────────────────────────────────
/** One dominant hero number (population) plus five stat tiles pulled straight
 *  from the ReportModel. Each tile renders a graceful "—" empty state when its
 *  metric lacks data (denominator-gated rates), never a misleading zero. No
 *  prior-month I/O — the deck builders stay pure over one month's input. */
export function monthInNumbersSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const accuracy = model.summary.overallAccuracy;
  const tiles: Array<{ tone: string; icon: string; value: string; label: string; sub: string }> = [
    {
      tone: "blue",
      icon: "scan",
      value: fmtNum(model.sample.total),
      label: "حجم العيّنة",
      sub: `تغطية ${fmtPct(model.sample.coverage)} من المجتمع`,
    },
    {
      tone: "cyan",
      icon: "check",
      value: fmtNum(model.sample.studied),
      label: "الصور المدروسة",
      sub: `إنجاز ${fmtPct(model.sample.completionRate)} من العيّنة`,
    },
    {
      tone: "coral",
      icon: "alert",
      value: fmtPct(model.population.suspicionRate),
      label: "نسبة الاشتباه",
      sub: `${fmtNum(model.population.suspicious)} صورة اشتباه في المجتمع`,
    },
    {
      tone: "purple",
      icon: "flag",
      value: fmtNum(model.errorAnalysis.totals.missedSuspicion + model.errorAnalysis.totals.falseSuspicion),
      label: "صور الاختلاف مع المراجع",
      sub: "اشتباه فائت + اشتباه خاطئ",
    },
    {
      tone: "green",
      icon: "gauge",
      value: accuracy === null ? "—" : fmtPct(accuracy),
      label: "الدقة العامة",
      sub: accuracy === null ? "بيانات غير كافية للتقييم" : "مطابقة قرارات الفحص للمراجع",
    },
  ];
  const tilesHtml = tiles
    .map(
      (t) => `<div class="v2-num-tile ${t.tone}">
        <span class="v2-num-tile-icon">${badgeIcon(t.icon, 18)}</span>
        <div class="v2-num-tile-body">
          <span class="v2-num-tile-value">${esc(t.value)}</span>
          <span class="v2-num-tile-label">${esc(t.label)}</span>
          <span class="v2-num-tile-sub">${esc(t.sub)}</span>
        </div>
      </div>`,
    )
    .join("");
  const body = `<div class="v2-num-layout">
      <div class="v2-num-hero">
        <span class="v2-num-hero-label">إجمالي مجتمع الصور</span>
        <span class="v2-num-hero-value">${fmtNum(model.population.total)}</span>
        <span class="v2-num-hero-unit">صورة فحص بالأشعة خلال ${esc(model.summary.periodId)}</span>
        <div class="v2-num-hero-rule"></div>
        <div class="v2-num-hero-split">
          <span><b>${fmtNum(model.population.clean)}</b><small>سليمة</small></span>
          <span><b>${fmtNum(model.population.suspicious)}</b><small>اشتباه</small></span>
        </div>
      </div>
      <div class="v2-num-tiles">${tilesHtml}</div>
    </div>`;
  return v2Slide({
    id: "slide-month-numbers",
    title: "الشهر في أرقام",
    eyebrow: "لمحة تنفيذية",
    iconName: "chart",
    headline: "الشهر في أرقام",
    subhead: "أبرز مؤشرات الشهر في لوحة واحدة — من حجم المجتمع إلى دقة القرارات.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "summary",
  });
}

// ── Page 3 — المعجم ─────────────────────────────────────────────────────────
type Tone = "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";

/** Essential glossary, organized into two semantic categories (owner request
 *  2026-07-14): sampling vocabulary first, judgment vocabulary second — the
 *  same order the deck's own sections flow. Color follows the CATEGORY (gold =
 *  population/sample, coral = decisions/quality), not the individual card, so
 *  the accent carries meaning instead of decoration. Per-term icons stay. */
type GlossaryTerm = { term: string; def: string; icon: string };
type GlossaryCategory = { label: string; icon: string; tone: Tone; terms: GlossaryTerm[] };
const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  {
    label: "مصطلحات المجتمع والعيّنة",
    icon: "layers",
    tone: "gold",
    terms: [
      { term: "مجتمع الفحص", def: "جميع صور الفحص بالأشعة المسجّلة خلال الشهر بعد المعالجة واستبعاد السجلات غير الصالحة.", icon: "layers" },
      { term: "مستويات المخاطر", def: "تصنيف الصور وفق محرّك المخاطر إلى أربعة مستويات، من الأول (منخفض) إلى الرابع (حرج).", icon: "layers" },
      { term: "العيّنة", def: "مجموعة جزئية تُسحب عشوائيًا بطريقة طبقية من المجتمع لتخضع للدراسة التفصيلية.", icon: "scan" },
      { term: "التغطية", def: "نسبة حجم العيّنة إلى حجم المجتمع، ومدى تمثيل العيّنة للمجتمع.", icon: "gauge" },
    ],
  },
  {
    label: "مصطلحات القرارات والجودة",
    icon: "shield",
    tone: "coral",
    terms: [
      { term: "اشتباه", def: "قرار فحص يشير إلى شبهة تستدعي التحقق؛ ويقابله «سليمة» حين لا تظهر شبهة.", icon: "alert" },
      { term: "الاشتباه الفائت", def: "صورة قرّر الفحص أنها سليمة وأثبت المراجع أنها اشتباه، وهو الخطر الأمني الأول.", icon: "alert" },
      { term: "المراجع (المعيار)", def: "نتيجة خبير الجودة التي تُقاس عليها دقة قرارات الفحص وتُعتمد مرجعًا.", icon: "shield" },
      { term: "كفاية البيانات", def: "حدّ أدنى من القرارات القابلة للتقييم قبل إصدار حكم أو ترتيب؛ ما دونه يُوصف ولا يُرتّب.", icon: "document" },
    ],
  },
];

/** One glossary card: icon badge + term + definition, category-toned bottom rule. */
function termCard(g: GlossaryTerm, tone: Tone): string {
  return `<div class="v2-term-card ${tone}">
    <div class="v2-term-card-head">
      <span class="v2-term-icon">${badgeIcon(g.icon, 18)}</span>
      <b>${esc(g.term)}</b>
    </div>
    <p>${esc(g.def)}</p>
  </div>`;
}

/** One labeled category band: tone-coded chip + hairline + its four cards. */
function termBand(cat: GlossaryCategory): string {
  return `<div class="v2-term-band ${cat.tone}">
    <div class="v2-term-band-head">
      <span class="v2-term-band-chip">${badgeIcon(cat.icon, 14)}<b>${esc(cat.label)}</b></span>
      <span class="v2-term-band-rule"></span>
    </div>
    <div class="v2-term-grid">${cat.terms.map((t) => termCard(t, cat.tone)).join("")}</div>
  </div>`;
}

/** Build the المعجم slide: two labeled category bands (fits one page). */
export function glossarySlideBuilders(variantPreview: boolean): SlideBuilder[] {
  return [
    (num, total) => {
      const body = `<div class="v2-term-section">${GLOSSARY_CATEGORIES.map(termBand).join("")}</div>`;
      return v2Slide({
        id: "slide-glossary-1",
        title: "المعجم",
        eyebrow: "المعجم",
        iconName: "document",
        headline: "المعجم — المصطلحات الرئيسية",
        subhead: "توحيد المصطلحات قبل قراءة النتائج.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "glossary",
      });
    },
  ];
}

// ── Section separator — full-bleed color-blocked cover ───────────────────────
export function sectionSeparatorSlide(opts: {
  sectionNo: number;
  sectionKey: NavSectionKey;
  iconName: string;
  title: string;
  blurb: string;
  keyStatValue: string;
  keyStatLabel: string;
  takeaway: string;
  /** Optional extra visual (e.g. the results funnel), rendered in the side column. */
  extra?: string;
  tone: string;
  /** Deterministic seed base (month key) for the background pattern. */
  seedBase?: string;
  num: number;
  total: number;
  variantPreview: boolean;
}): string {
  const { sectionNo, sectionKey, iconName, title, blurb, keyStatValue, keyStatLabel, takeaway, extra, tone, seedBase, num, total, variantPreview } = opts;
  // Seeded geometric pattern overlay, tinted to the section tone at very low
  // opacity (CSS-controlled) so it never touches headline contrast. Seed =
  // month key + section id → deterministic per report.
  const patternTone = tone === "cyan" ? "#32c5d2" : "#f4b400";
  const patternSvg = dividerPatternSvg(`${seedBase ?? ""}__${sectionKey}`, patternTone);
  const patternLayer = patternSvg
    ? `<div class="v2-sep-pattern" aria-hidden="true">${patternSvg}</div>`
    : "";
  const sepBody = `<div class="v2-sep ${esc(tone)}">
      <div class="v2-sep-numeral" aria-hidden="true">${pad(sectionNo)}</div>
      <div class="v2-sep-main">
        <div class="v2-sep-eyebrow"><span class="v2-sep-eyebrow-icon">${icon(iconName, 15)}</span>القسم ${esc(String(sectionNo))}</div>
        <h2>${esc(title)}</h2>
        <div class="v2-sep-rule"></div>
        <p>${esc(blurb)}</p>
        <div class="v2-sep-takeaway"><span class="v2-sep-takeaway-icon">${icon("arrow", 14)}</span>${esc(takeaway)}</div>
      </div>
      <div class="v2-sep-side">
        <div class="v2-sep-stat">
          <span class="v2-sep-stat-value">${esc(keyStatValue)}</span>
          <span class="v2-sep-stat-label">${esc(keyStatLabel)}</span>
        </div>
        ${extra ? `<div class="v2-sep-extra">${extra}</div>` : ""}
      </div>
    </div>`;
  const body = renderVariants(`slide-sep-${sectionNo}`, [sepBody, sepBody, sepBody, sepBody], variantPreview);
  return `<section class="slide v2 v2-sep-slide ${esc(tone)}" id="slide-sep-${sectionNo}" data-title="${esc(title)}" data-section="${sectionKey}" data-section-label="${esc(NAV_SECTIONS[sectionKey])}">
  ${printToggle()}
  ${sideRail(sectionKey)}
  <div class="v2-sep-bg" aria-hidden="true"></div>
  ${patternLayer}
  ${coverBand()}
  <div class="slide-inner">
    ${body}
  </div>
  ${pageFoot(num, total)}
</section>`;
}

// ── Page 5 — مجتمع الصور بناءً على المخاطر ────────────────────────────────
const STAGE_TONES = ["gold", "blue", "green", "coral"] as const;

/** Short severity tag shown at the bottom of each card (per the reference
 *  layout's "source of truth" / "final artifact" style caption). Keyed by
 *  stage label so an unmatched/custom label just falls back to the number. */
const STAGE_SHORT_TAG: Record<string, string> = {
  "المستوى الأول": "مستوى منخفض",
  "المستوى الثاني": "مستوى متوسط",
  "المستوى الثالث": "مستوى مرتفع",
  "المستوى الرابع": "مستوى حرج",
};

/** How many ports each stage-×-port card shows individually before folding the
 *  rest into its الإجمالي row (design spec §2.3 — "curated top-N, never the
 *  full table", same convention as portTable/qualityTable/accuracyTable). */
export const STAGE_CARD_TOP_N = 5;

/** Vertical budget (px) for one stage-×-port card's thead+rows+tfoot, at
 *  METRICS_COMPACT row heights.
 *
 *  Task 4 (v41.1) originally set this to 177 — the full 5-row `usedPx` under
 *  METRICS_COMPACT — reasoning that `.v2-stage-card` "stretches to its
 *  CSS-grid row regardless of this value." That check only verified the
 *  TABLE fits within its own CARD (which trivially holds once the card's
 *  height is driven by the table itself) — it never checked whether the
 *  2-row `.v2-stage-port-grid` as a whole fits within `.slide-body`'s fixed
 *  458.8px, so it missed that 2×256.8px (the card height that 177px produces)
 *  plus the row gap overflows the slide by ~46-127px, silently clipped by
 *  `.slide{overflow:hidden}`. Re-measured (this pass): available height per
 *  row = `(458.8 − 14px gap) / 2 ≈ 222.4px`; per-card non-table overhead
 *  (padding 12+10px, border 0.8px×2, header 28px + 8px margin) ≈ 59.6px;
 *  so the table budget is `222.4 − 59.6 ≈ 162.8px`. Set to 160 for a small
 *  safety margin against sub-pixel rounding. Requires `.v2-stage-port-grid`
 *  to have `grid-template-rows:1fr 1fr` (added alongside this fix) so both
 *  rows actually split the available height evenly instead of each sizing to
 *  its own content. */
export const STAGE_CARD_TABLE_BUDGET_PX = 160;

/** Compact 180° coverage arc for a stage tile — a micro SVG dial that inherits
 *  the tile's tone via `currentColor`. Low→high reads left→right (a physical
 *  gauge), same convention as ui/charts.ts `gauge`. Decorative (the percentage
 *  is printed beside it as text), so aria-hidden and no interpolated data. */
function microArc(pct: number): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const W = 58;
  const H = 34;
  const cx = W / 2;
  const cy = H - 4;
  const rad = 23;
  const sw = 5;
  const at = (ang: number): [number, number] => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  const [x0, y0] = at(Math.PI);
  const [x1, y1] = at(Math.PI + (p / 100) * Math.PI);
  const track = `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rad} ${rad} 0 0 1 ${(cx + rad).toFixed(1)} ${cy.toFixed(1)}`;
  const val = `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  return `<svg class="v2-micro-arc" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${track}" fill="none" stroke="var(--line)" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="${val}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>`;
}

/** Full-width stacked proportion bar: population share by risk stage, tone-coded,
 *  with the percentage printed inside each segment (dark ink, never the series
 *  color) and a direct-label legend below (the secondary encoding that keeps the
 *  brand stage tones legible under CVD). Pure HTML/CSS, RTL-native. */
function stageProportionBar(stages: StageProfile[]): string {
  const total = stages.reduce((s, x) => s + x.population, 0) || 1;
  const segs = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const pct = (s.population / total) * 100;
      return `<div class="v2-prop-seg ${tone}" style="width:${pct.toFixed(3)}%">${pct >= 6 ? `<span class="v2-prop-seg-pct">${fmtPct(pct, 0)}</span>` : ""}</div>`;
    })
    .join("");
  const legend = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      return `<span class="v2-prop-key ${tone}"><i></i>${esc(s.stageLabel)} · ${fmtNum(s.population)}</span>`;
    })
    .join("");
  return `<div class="v2-prop">
    <div class="v2-prop-bar">${segs}</div>
    <div class="v2-prop-legend">${legend}</div>
  </div>`;
}

export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const stages = model.population.byStage;
  const tiles = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const tag = STAGE_SHORT_TAG[s.stageLabel] ?? `المستوى ${i + 1}`;
      return `<div class="v2-stage-card ${tone}">
        <div class="v2-stage-head">
          <span class="v2-stage-num">${i + 1}</span>
          <b>${esc(s.stageLabel)}</b>
        </div>
        <div class="v2-stage-body">
          <div class="v2-stage-figs">
            <div class="v2-stage-fig"><b>${fmtNum(s.population)}</b><small>الصور</small></div>
            <div class="v2-stage-fig"><b>${fmtNum(s.sampleSize)}</b><small>العيّنة</small></div>
          </div>
          <div class="v2-stage-gauge">
            ${microArc(s.coverage)}
            <span class="v2-stage-gauge-pct">${fmtPct(s.coverage)}</span>
            <span class="v2-stage-gauge-label">التغطية</span>
          </div>
        </div>
        <div class="v2-stage-tag">${esc(tag)}</div>
      </div>`;
    })
    .join("");
  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع (صورة)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 16)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 16)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>التغطية الكلية</small></span></div>
  </div>`;
  const body = `<div class="v2-risk-layout">${stageProportionBar(stages)}<div class="kpi-band n${Math.min(4, Math.max(2, stages.length))}">${tiles}</div>${totals}</div>`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الصور بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الصور بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

// ── Page 6+ — مجتمع صور الفحص للشهر (جداول المنافذ) ───────────────────────
type PortPopRow = {
  name: string;
  total: number;
  clean: number;
  suspicious: number;
  sampleTotal: number;
  sampleClean: number;
  sampleSuspicious: number;
};

function collectPortStats(model: ReportModel): { land: PortPopRow[]; sea: PortPopRow[] } {
  const map = new Map<string, PortPopRow & { sea: boolean }>();
  for (const r of model.rows) {
    const name = r.portName ?? "غير محدد";
    let cur = map.get(name);
    if (!cur) {
      cur = {
        name,
        total: 0,
        clean: 0,
        suspicious: 0,
        sampleTotal: 0,
        sampleClean: 0,
        sampleSuspicious: 0,
        sea: (r.portType ?? "").includes("بحري"),
      };
      map.set(name, cur);
    }
    cur.total += 1;
    if (r.imageResult === "اشتباه") cur.suspicious += 1;
    else cur.clean += 1;
    if (r.selectedInSample) {
      cur.sampleTotal += 1;
      if (r.imageResult === "اشتباه") cur.sampleSuspicious += 1;
      else cur.sampleClean += 1;
    }
  }
  const all = [...map.values()].sort((a, b) => b.total - a.total);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

/** A stacked cell: the sample figure (big) over its population base (small). */
function frac(sampleN: number, popN: number): string {
  return `<span class="v2-frac"><b>${fmtNum(sampleN)}</b><span>من ${fmtNum(popN)}</span></span>`;
}

/** Row metrics, measured live in the browser with sub-pixel precision
 *  (v39.9/v39.10, retuned v39.16, re-measured v39.29 after the side-rail
 *  width change subtly shifted text-metric rounding). The sample table's
 *  stacked "N من M" cells (`.v2-frac`) are tuned in CSS to land close to the
 *  population table's plain single-line row height, but NOT identically —
 *  v39.29 found the compact tier's frac cells measure ~1.1-1.5px shorter
 *  than plain cells at the current layout width, so compact tier needs its
 *  own metrics for `mode === "sample"` rather than assuming parity. */
type ModeMetrics = { rowH: number; theadH: number; tfootH: number };
const METRICS_NORMAL: ModeMetrics = { rowH: 41.6, theadH: 41.2, tfootH: 41.2 };
const METRICS_COMPACT: ModeMetrics = { rowH: 25.4, theadH: 25, tfootH: 25 };
// Re-measured 2026-07-14 after the theme-v3 type-scale change shifted text-metric
// rounding (same phenomenon as the v39.29 re-measure): the previous values (rowH
// 23.925 / theadH 25 / tfootH 23.525) under-estimated all three, clipping the
// sample tables' totals row ~10px past the card bottom on screen.
const METRICS_COMPACT_SAMPLE: ModeMetrics = { rowH: 25.125, theadH: 24.5, tfootH: 24.625 };

/** Vertical budget for one card's thead+rows+tfoot together, measured live:
 *  the 16:9 slide's `.slide-body` renders at 458.8px, a card header at 70px
 *  (388.8px), minus a small safety margin for the border-box + sub-pixel
 *  rounding that otherwise causes a 1-2px overflow in `.v2-port-col`'s own
 *  clipping (its 1px border eats into the content box on each side). */
const TABLE_BUDGET_PX = 387;

/** The pixel-exact tfoot-pinning spacer, carrying this tier's exact row height
 *  (--ghost-row-h) so the CSS can paint faint row separators inside it — the
 *  leftover space reads as continued empty grid, not a void. Deliberately ONE
 *  pixel-sized row, NOT real ghost <tr>s: plain-cell ghosts render taller than
 *  the sample table's stacked frac rows and would break the measured budget
 *  math (see METRICS_* notes above), clipping the totals row. */
function blankFillerRow(fillerPx: number, span: number, rowH: number): string {
  if (fillerPx <= 0) return "";
  return `<tr class="v2-blank" style="height:${fillerPx}px;--ghost-row-h:${rowH}px"><td colspan="${span}">&nbsp;</td></tr>`;
}

/**
 * One land/sea table as a tinted card (per the reference design). `population`
 * = plain month numbers (الصور/سليمة/اشتباه). `sample` = same shape, but every
 * numeric cell stacks the drawn-sample figure over `من {population}`, plus a
 * التغطية column. The gap before الإجمالي is ONE spacer row sized to the
 * EXACT leftover pixels in the card's budget (not a fixed row count — a fixed
 * count left visible slack that showed as a gap, or as dead space below the
 * totals row once `compact` mode shrank real rows below the padded target).
 * This way the totals row always sits flush against the bottom of the card,
 * for any port count, in either tier.
 */
function portTable(
  title: string,
  rows: PortPopRow[],
  mode: "population" | "sample",
  variant: "land" | "sea",
  compact: boolean,
): string {
  const span = mode === "population" ? 4 : 5;
  const dataRowCount = rows.length > 0 ? rows.length : 1; // the "—" placeholder counts as one row
  // Magnitude-column data bars (pure CSS background, zero added row height): the
  // الصور column in population mode, the العيّنة column in sample mode, each
  // scaled to the largest value in this chunk. Tone tracks the port variant
  // (green = land, blue = sea) so the bar reads as "size of this port".
  const magTone: CellTone = variant === "land" ? "green" : "blue";
  const maxMag = maxOf(rows.map((p) => (mode === "population" ? p.total : p.sampleTotal)));
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            if (mode === "population") {
              return `<tr><td>${esc(p.name)}</td>${barCell(fmtNum(p.total), (p.total / maxMag) * 100, magTone)}<td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td></tr>`;
            }
            const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
            return `<tr><td>${esc(p.name)}</td>${barCell(frac(p.sampleTotal, p.total), (p.sampleTotal / maxMag) * 100, magTone)}<td>${frac(p.sampleClean, p.clean)}</td><td>${frac(p.sampleSuspicious, p.suspicious)}</td><td>${fmtPct(coverage)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? (mode === "sample" ? METRICS_COMPACT_SAMPLE : METRICS_COMPACT) : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow = blankFillerRow(fillerPx, span, metrics.rowH);

  const sum = (f: (p: PortPopRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalPop = sum((p) => p.total);
  const totalSample = sum((p) => p.sampleTotal);
  const totalsRow =
    mode === "population"
      ? `<tr><td>الإجمالي</td><td>${fmtNum(totalPop)}</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td></tr>`
      : `<tr><td>الإجمالي</td><td>${frac(totalSample, totalPop)}</td><td>${frac(sum((p) => p.sampleClean), sum((p) => p.clean))}</td><td>${frac(sum((p) => p.sampleSuspicious), sum((p) => p.suspicious))}</td><td>${fmtPct(totalPop > 0 ? (totalSample / totalPop) * 100 : 0)}</td></tr>`;

  const headSub =
    mode === "population"
      ? `${fmtNum(rows.length)} منفذ · ${fmtNum(totalPop)} صورة`
      : `${fmtNum(rows.length)} منفذ · ${fmtNum(totalSample)} عيّنة من ${fmtNum(totalPop)} صورة`;
  const ths =
    mode === "population"
      ? `<th>المنفذ</th><th>الصور</th><th>سليمة</th><th>اشتباه</th>`
      : `<th>المنفذ</th><th>العيّنة</th><th>سليمة</th><th>اشتباه</th><th>التغطية</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${mode === "sample" ? " sample-mode" : ""}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/**
 * Row budget, measured live (v39.10, recomputed v39.16 for the taller,
 * ink-safe row height) — each `.v2-port-col` card clips its own overflow, so
 * a table taller than its card silently loses its bottom rows (the totals
 * row first). The 16:9 slide's `.slide-body` renders at 459px and a card
 * header at 71px, leaving a 388px budget for thead+rows+tfoot together →
 * (388 − 41 − 41) / 41 ≈ 7 rows. Both port-table modes share this budget
 * since the sample table's stacked cells are tuned to the exact same row
 * height as the population table's plain cells.
 */
const BASE_ROWS_PER_PAGE = 7;

/**
 * If a table overflows its base budget by only 1–3 rows, compress row height
 * slightly (the `compact` CSS variant) so everyone fits on one page instead
 * of spilling those 1–3 rows onto a near-empty continuation page. Beyond a
 * 3-row overflow, paginate normally at the base row size. The shared compact
 * tier was measured to comfortably fit BASE+3 for both modes (12 population
 * rows, 9 sample rows) with 80px+ of slack to spare.
 */
const COMPRESS_OVERFLOW_MAX = 3;

type PortPagePlan = { pages: number; rowsPerPage: number; compact: boolean };

function planPortPages(landCount: number, seaCount: number, baseRowsPerPage: number): PortPagePlan {
  const maxCount = Math.max(landCount, seaCount);
  if (maxCount <= baseRowsPerPage) {
    return { pages: 1, rowsPerPage: baseRowsPerPage, compact: false };
  }
  const overflow = maxCount - baseRowsPerPage;
  if (overflow <= COMPRESS_OVERFLOW_MAX) {
    return { pages: 1, rowsPerPage: maxCount, compact: true };
  }
  return { pages: Math.ceil(maxCount / baseRowsPerPage), rowsPerPage: baseRowsPerPage, compact: false };
}

/**
 * Chart-first overview that LEADS the port section: two ranked bars (top land
 * ports · top sea ports) at full size on their own slide. This is the "split
 * composition" the overhaul asks for, delivered as a dedicated slide rather
 * than stacked above the port tables — the land/sea tables run on a fixed,
 * measured pixel budget (TABLE_BUDGET_PX, METRICS_*, ghost/blank rows) that
 * leaves no vertical room for a ~150px 5-bar chart above them without clipping
 * the totals row in the many-port production case. A separate slide touches
 * none of that machinery and gives the chart the space it needs. (Deviation
 * from the spec's "same page as the table", made for production safety.) */
export function portsOverviewSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const { land, sea } = collectPortStats(model);
  const top = (rows: PortPopRow[]) =>
    rows
      .slice()
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map((p) => ({ label: p.name, value: p.total }));
  const body = `<div class="v2-port-ovr">
      <div class="v2-port-ovr-col land">
        <div class="v2-port-ovr-head"><span class="v2-port-ovr-icon">${badgeIcon("truck", 22)}</span><div><b>المنافذ البرية</b><span>أعلى المنافذ حجمًا في المجتمع</span></div></div>
        <div class="v2-port-ovr-chart">${rankedBar(top(land), {})}</div>
      </div>
      <div class="v2-port-ovr-col sea">
        <div class="v2-port-ovr-head"><span class="v2-port-ovr-icon">${badgeIcon("ship", 22)}</span><div><b>المنافذ البحرية</b><span>أعلى المنافذ حجمًا في المجتمع</span></div></div>
        <div class="v2-port-ovr-chart">${rankedBar(top(sea), {})}</div>
      </div>
    </div>`;
  return v2Slide({
    id: "slide-port-overview",
    title: "أبرز المنافذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "chart",
    headline: `أبرز المنافذ في مجتمع ${model.summary.periodId}`,
    subhead: "ترتيب المنافذ البرية والبحرية بحسب حجم الصور، قبل الجداول التفصيلية.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

/** Build one or more port-population slides (paginated land/sea in parallel). */
export function portPopulationSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "population", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "population", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-population-${page + 1}`,
        title: `مجتمع صور الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع صور الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الصورة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}

/** Sample mirror of the population page: sample figures stacked over their population base + coverage. */
export function portSampleSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "sample", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "sample", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-sample-${page + 1}`,
        title: `عيّنة الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `عيّنة الفحص المسحوبة لشهر ${model.summary.periodId}${cont}`,
        subhead: "الصفحة نفسها بأرقام العيّنة: كل رقم عيّنة وتحته أساسه من المجتمع، مع نسبة التغطية.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}

/**
 * Same tallying logic as collectPortStats (line 432), keyed by risk stage
 * instead of land/sea. Returns ports sorted by population descending within
 * each stage — the same sort key collectPortStats uses — so "top port" means
 * the same thing on the land/sea pages and these stage/port pages.
 *
 * `collectStagePortStats` itself is always internally correct — it's a
 * straightforward tally over the `model.rows` it's given, so `total`/
 * `sampleTotal` always reflect the actual rows for that (stage, port) pair.
 *
 * The caveat is whether its per-stage sums match `model.population.byStage`'s
 * `population`/`sampleSize` for the same stage, and that depends on how
 * `StageProfile` was built in `calculateExecutiveKPIs`
 * (`src/data/reporting/executiveReportData.ts`):
 * - Fallback branch (no sample, or no `stageAllocations`): `population`/
 *   `sampleSize` are computed by grouping `model.rows` by `row.stage` at
 *   report-generation time — the same rows this collector tallies — so the
 *   sums are guaranteed to match (asserted in stagePortStats.test.ts).
 * - Production branch (`sample.stageAllocations` present — the normal case
 *   after Phase 3 sampling): `population`/`sampleSize` come from a
 *   `StageAllocation` record frozen at sample-draw time
 *   (`src/data/sampling/sampleTypes.ts`). That snapshot is NOT recomputed
 *   from `model.rows`, so it is not guaranteed to match a fresh tally if
 *   data was reprocessed or a row's `stage` changed since the sample was
 *   drawn (also asserted in stagePortStats.test.ts, to document the
 *   divergence rather than hide it).
 */
export function collectStagePortStats(model: ReportModel): Map<string, PortPopRow[]> {
  const byStage = new Map<string, Map<string, PortPopRow>>();
  for (const r of model.rows) {
    // Canonicalize: real rows carry the RAW Excel stage alias (e.g. "SECOND_STAG",
    // "2", "الثاني"), while StageProfile.stageLabel is the canonical Arabic label
    // frozen at sample-draw time. Raw-key grouping made every card lookup miss on
    // real data (empty port tables, zero سليمة/اشتباه sums) — the synthetic
    // preview fixture used canonical labels and masked it. formatStageLabel maps
    // known aliases to the canonical label and echoes unknown strings unchanged,
    // so the fallback branch (raw StageProfile labels) still matches too.
    const stageKey = r.stage ? formatStageLabel(r.stage) : "غير محدد";
    const portName = r.portName ?? "غير محدد";
    let portMap = byStage.get(stageKey);
    if (!portMap) {
      portMap = new Map<string, PortPopRow>();
      byStage.set(stageKey, portMap);
    }
    let cur = portMap.get(portName);
    if (!cur) {
      cur = { name: portName, total: 0, clean: 0, suspicious: 0, sampleTotal: 0, sampleClean: 0, sampleSuspicious: 0 };
      portMap.set(portName, cur);
    }
    cur.total += 1;
    if (r.imageResult === "اشتباه") cur.suspicious += 1;
    else cur.clean += 1;
    if (r.selectedInSample) {
      cur.sampleTotal += 1;
      if (r.imageResult === "اشتباه") cur.sampleSuspicious += 1;
      else cur.sampleClean += 1;
    }
  }
  const result = new Map<string, PortPopRow[]>();
  for (const [stageKey, portMap] of byStage) {
    result.set(stageKey, [...portMap.values()].sort((a, b) => b.total - a.total));
  }
  return result;
}

/** Muted placeholder rows padding a stage card's table up to the fixed
 *  STAGE_CARD_TOP_N body-row count. Real row height/borders (they are ordinary
 *  `<tr>`s), so the table grid reads as deliberate rather than truncated. */
function ghostRows(count: number): string {
  if (count <= 0) return "";
  return `<tr class="v2-ghost"><td>—</td><td></td><td></td><td></td></tr>`.repeat(count);
}

/** One stage's card on the population page: المنفذ | سليمة | اشتباه | الإجمالي,
 *  top STAGE_CARD_TOP_N ports by population, with a stage-wide totals row.
 *
 *  IMPORTANT (found in Task 1 review, see design spec §2.2's "Consistency
 *  caveat"): the totals row's الإجمالي column is pinned to `stage.population`
 *  (the StageProfile figure — same source as riskStagesSlide and this card's
 *  own data), NOT a fresh sum over `ports`. In the normal production case
 *  (sample.stageAllocations present), StageProfile's population comes from a
 *  frozen sample-draw-time snapshot, which is not guaranteed to equal a fresh
 *  count of `ports` (built from *current* model.rows) — summing `ports` here
 *  could visibly disagree with the number shown on the "مجتمع الصور بناءً
 *  على المخاطر" page for the same stage. سليمة/اشتباه have no equivalent on
 *  StageProfile, so those two columns still sum from `ports` — the best
 *  available breakdown, and in the rare case population changed after
 *  sampling, not guaranteed to add up to exactly the pinned الإجمالي. */
function stagePortPopulationCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  // Always render exactly STAGE_CARD_TOP_N body rows: stages with fewer ports
  // get muted "ghost" rows so all four cards share identical table geometry —
  // otherwise short cards showed a large blank void between the last data row
  // and the pinned totals row (owner-reported inconsistency, 2026-07-14).
  const dataRowCount = STAGE_CARD_TOP_N;
  const maxTotal = maxOf(top.map((p) => p.total));
  const trs =
    top
      .map(
        (p) =>
          `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.clean)}</td><td>${fmtNum(p.suspicious)}</td>${barCell(fmtNum(p.total), (p.total / maxTotal) * 100, tone)}</tr>`,
      )
      .join("") + ghostRows(STAGE_CARD_TOP_N - top.length);

  const usedPx = METRICS_COMPACT.theadH + METRICS_COMPACT.tfootH + dataRowCount * METRICS_COMPACT.rowH;
  const fillerPx = Math.max(0, STAGE_CARD_TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="4">&nbsp;</td></tr>` : "";

  const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(sum((p) => p.clean))}</td><td>${fmtNum(sum((p) => p.suspicious))}</td><td>${fmtNum(stage.population)}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** One stage's card on the sample page: المنفذ | مجتمع المرحلة | العيّنة المستهدفة |
 *  نسبة التغطية, as plain numbers (not the land/sea page's stacked "N من M"
 *  frac cell — the reference design uses two separate plain columns here).
 *
 *  IMPORTANT (same caveat as stagePortPopulationCard above): all three
 *  totals-row cells are pinned to `stage.population`/`stage.sampleSize` (the
 *  same StageProfile figures already shown in the card header), not fresh
 *  sums over `ports` — this keeps the header figure and the totals row
 *  internally consistent by construction and matching the rest of the deck,
 *  regardless of whether a fresh row tally would agree with the frozen
 *  sample-draw-time allocation. */
function stagePortSampleCard(stage: StageProfile, i: number, ports: PortPopRow[]): string {
  const tone = STAGE_TONES[i % STAGE_TONES.length];
  const top = ports.slice(0, STAGE_CARD_TOP_N);
  // Same fixed-geometry rule as stagePortPopulationCard: exactly TOP_N body
  // rows, ghost-padded, so the totals row sits at the same height in all cards.
  const dataRowCount = STAGE_CARD_TOP_N;
  const maxSample = maxOf(top.map((p) => p.sampleTotal));
  const trs =
    top
      .map((p) => {
        const coverage = p.total > 0 ? (p.sampleTotal / p.total) * 100 : 0;
        return `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}</td>${barCell(fmtNum(p.sampleTotal), (p.sampleTotal / maxSample) * 100, tone)}<td>${fmtPct(coverage)}</td></tr>`;
      })
      .join("") + ghostRows(STAGE_CARD_TOP_N - top.length);

  const usedPx = METRICS_COMPACT.theadH + METRICS_COMPACT.tfootH + dataRowCount * METRICS_COMPACT.rowH;
  const fillerPx = Math.max(0, STAGE_CARD_TABLE_BUDGET_PX - usedPx);
  const blankRow =
    fillerPx > 0 ? `<tr class="v2-blank" style="height:${fillerPx}px"><td colspan="4">&nbsp;</td></tr>` : "";

  const totalsRow = `<tr><td>الإجمالي</td><td>${fmtNum(stage.population)}</td><td>${fmtNum(stage.sampleSize)}</td><td>${fmtPct(stage.coverage)}</td></tr>`;

  return `<div class="v2-stage-card ${tone} v2-stage-port-card">
    <div class="v2-stage-head">
      <span class="v2-stage-num">${i + 1}</span>
      <b>${esc(stage.stageLabel)}</b>
      <span class="v2-stage-port-figure" dir="ltr">${fmtNum(stage.sampleSize)} / ${fmtNum(stage.population)}</span>
    </div>
    <table class="deck-table">
      <thead><tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العيّنة المستهدفة</th><th>نسبة التغطية</th></tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Population page: مجتمع صور الفحص حسب المستوى والمنفذ. Never paginated —
 *  top-N is fixed, so row count doesn't grow with the port list the way the
 *  land/sea tables' does. */
export function stagePortPopulationSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortPopulationCard(s, i, byStage.get(formatStageLabel(s.stageLabel)) ?? []))
    .join("");
  const body = `<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-population",
    title: "مجتمع صور الفحص حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `مجتمع صور الفحص حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، مع إجمالي شامل لجميع المنافذ.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

/** Sample page: عيّنة الفحص المسحوبة حسب المستوى والمنفذ. Same non-paginated shape. */
export function stagePortSampleSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const byStage = collectStagePortStats(model);
  const cards = model.population.byStage
    .map((s, i) => stagePortSampleCard(s, i, byStage.get(formatStageLabel(s.stageLabel)) ?? []))
    .join("");
  const body = `<div class="v2-stage-port-grid">${cards}</div>`;
  return v2Slide({
    id: "slide-stage-port-sample",
    title: "عيّنة الفحص المسحوبة حسب المستوى والمنفذ",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "layers",
    headline: `عيّنة الفحص المسحوبة حسب المستوى والمنفذ لشهر ${model.summary.periodId}`,
    subhead: "أعلى 5 منافذ بالحجم لكل مستوى مخاطر، بأرقام العيّنة ونسبة التغطية، مع إجمالي شامل.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}

// ── Section 2, page A — نتائج جودة الصور في المنافذ ─────────────────────────
type PortQualityRow = {
  name: string;
  imageAvailable: number;
  imageMissing: number;
  markingPresent: number;
  markingMissing: number;
  highQ: number;
  medQ: number;
  lowQ: number;
};

/** Denominator-gated rate — null (renders "—") when there's nothing to divide by. */
function rateOf(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/** A percentage cell, muted (`.insuff`, matching the v1 deck's own port
 *  tables) when there's nothing to show rather than plain white "—" text. */
function pctCell(v: number | null): string {
  return v === null ? `<span class="insuff">—</span>` : fmtPct(v);
}

/**
 * Per-port image-quality tallies, computed fresh from `model.rows` using the
 * EXACT same predicates as the global KPI calculator
 * (`calculateExecutiveKPIs` in `executiveReportData.ts`): submitted answers
 * only, then `imageAvailable`/`hasMarking`/`imageQuality`. No per-port
 * version of these existed on the model before this page.
 */
function collectPortQualityStats(model: ReportModel): { land: PortQualityRow[]; sea: PortQualityRow[] } {
  const map = new Map<string, PortQualityRow & { sea: boolean }>();
  for (const r of model.rows) {
    if (r.answerStatus !== "submitted") continue;
    const name = r.portName ?? "غير محدد";
    let cur = map.get(name);
    if (!cur) {
      cur = {
        name,
        imageAvailable: 0,
        imageMissing: 0,
        markingPresent: 0,
        markingMissing: 0,
        highQ: 0,
        medQ: 0,
        lowQ: 0,
        sea: (r.portType ?? "").includes("بحري"),
      };
      map.set(name, cur);
    }
    if (r.imageAvailable === true) cur.imageAvailable += 1;
    else if (r.imageAvailable === false) cur.imageMissing += 1;
    if (r.hasMarking === true) cur.markingPresent += 1;
    else if (r.hasMarking === false) cur.markingMissing += 1;
    if (r.imageQuality === "عالي") cur.highQ += 1;
    else if (r.imageQuality === "متوسط") cur.medQ += 1;
    else if (r.imageQuality === "منخفض") cur.lowQ += 1;
  }
  const all = [...map.values()].sort(
    (a, b) => b.imageAvailable + b.imageMissing - (a.imageAvailable + a.imageMissing),
  );
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

function qualityTable(title: string, rows: PortQualityRow[], variant: "land" | "sea", compact: boolean): string {
  const span = 5;
  const dataRowCount = rows.length > 0 ? rows.length : 1;
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            // One shared denominator for the three level columns (quality-evaluated
            // images at this port), so عالي+متوسط+منخفض sum to ~100% per row.
            const evaluated = p.highQ + p.medQ + p.lowQ;
            const high = rateOf(p.highQ, evaluated);
            const med = rateOf(p.medQ, evaluated);
            const low = rateOf(p.lowQ, evaluated);
            const marking = rateOf(p.markingPresent, p.markingPresent + p.markingMissing);
            return `<tr><td>${esc(p.name)}</td>${qualCell(high, "green")}${qualCell(med, "gold")}${qualCell(low, "coral")}${threshCell(marking, MARKING_TARGET)}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? METRICS_COMPACT : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow = blankFillerRow(fillerPx, span, metrics.rowH);

  const sum = (f: (p: PortQualityRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalMarkP = sum((p) => p.markingPresent);
  const totalMarkM = sum((p) => p.markingMissing);
  const totalHigh = sum((p) => p.highQ);
  const totalMed = sum((p) => p.medQ);
  const totalLow = sum((p) => p.lowQ);
  const totalEvaluated = totalHigh + totalMed + totalLow;
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalHigh, totalEvaluated))}</td><td>${pctCell(rateOf(totalMed, totalEvaluated))}</td><td>${pctCell(rateOf(totalLow, totalEvaluated))}</td><td>${pctCell(rateOf(totalMarkP, totalMarkP + totalMarkM))}</td></tr>`;

  const headSub = `${fmtNum(rows.length)} منفذ`;
  const ths = `<th>المنفذ</th><th>عالي</th><th>متوسط</th><th>منخفض</th><th>التحديد</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Build one or more image-quality slides (paginated land/sea in parallel). */
export function qualityPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortQualityStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${qualityTable("المنافذ البرية", landChunk, "land", plan.compact)}${qualityTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-ports-${page + 1}`,
        title: `نتائج جودة الصور${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "scan",
        headline: `نتائج جودة الصور في المنافذ${cont}`,
        subhead: "توزيع مستويات جودة الصورة (عالي / متوسط / منخفض) ونسبة وجود التحديد في كل منفذ.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}

// ── Section 2, page B — نتائج دقة نتائج المنافذ (اشتباه / سليمة) ───────────
type PortAccuracyRow = {
  name: string;
  evaluable: number;
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
  rankable: boolean;
};

/**
 * Per-port accuracy, from `model.portAccuracy` — the SAME aggregate the old
 * v1 deck's port-ranking slide already consumes (`Aggregates["byPort"]`), so
 * no new accuracy math is invented here. دقة السليمة is the one derived
 * value not already named on that aggregate: correctClean / (correctClean +
 * falseSuspicion). Ports below the data-sufficiency threshold are flagged
 * `rankable:false` — the table still lists them but shows "—" for their
 * rates rather than a misleading number (same `isRankable(band)` gate used
 * everywhere else in this report).
 */
function collectPortAccuracyRows(model: ReportModel): { land: PortAccuracyRow[]; sea: PortAccuracyRow[] } {
  const seaByPort = new Map<string, boolean>();
  for (const r of model.rows) {
    const name = r.portName ?? "غير محدد";
    if (!seaByPort.has(name)) seaByPort.set(name, (r.portType ?? "").includes("بحري"));
  }
  const items = model.portAccuracy.map((p) => ({
    name: p.key,
    evaluable: p.evaluable,
    correctClean: p.correctClean,
    correctSuspicion: p.correctSuspicion,
    missedSuspicion: p.missedSuspicion,
    falseSuspicion: p.falseSuspicion,
    rankable: isRankable(p.band),
    sea: seaByPort.get(p.key) ?? false,
  }));
  const all = items.sort((a, b) => b.evaluable - a.evaluable);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

function accuracyTable(title: string, rows: PortAccuracyRow[], variant: "land" | "sea", compact: boolean): string {
  const span = 4;
  const dataRowCount = rows.length > 0 ? rows.length : 1;
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            const accuracy = rateOf(p.correctClean + p.correctSuspicion, p.evaluable);
            const detection = rateOf(p.correctSuspicion, p.correctSuspicion + p.missedSuspicion);
            const clean = rateOf(p.correctClean, p.correctClean + p.falseSuspicion);
            // Below-target rows carry the warning tone + alert glyph (never color
            // alone). Unrankable ports (insufficient data) show muted "—", no bar.
            const show = (v: number | null) =>
              p.rankable ? threshCell(v, ACCURACY_TARGET) : `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
            return `<tr><td>${esc(p.name)}</td>${show(accuracy)}${show(detection)}${show(clean)}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">—</span></td></tr>`;

  const metrics = compact ? METRICS_COMPACT : METRICS_NORMAL;
  const usedPx = metrics.theadH + metrics.tfootH + dataRowCount * metrics.rowH;
  const fillerPx = Math.max(0, TABLE_BUDGET_PX - usedPx);
  const blankRow = blankFillerRow(fillerPx, span, metrics.rowH);

  const sum = (f: (p: PortAccuracyRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalEvaluable = sum((p) => p.evaluable);
  const totalCC = sum((p) => p.correctClean);
  const totalCS = sum((p) => p.correctSuspicion);
  const totalMS = sum((p) => p.missedSuspicion);
  const totalFS = sum((p) => p.falseSuspicion);
  const totalsRow = `<tr><td>الإجمالي</td><td>${pctCell(rateOf(totalCC + totalCS, totalEvaluable))}</td><td>${pctCell(rateOf(totalCS, totalCS + totalMS))}</td><td>${pctCell(rateOf(totalCC, totalCC + totalFS))}</td></tr>`;

  const headSub = `${fmtNum(rows.length)} منفذ`;
  const ths = `<th>المنفذ</th><th>الدقة العامة</th><th>دقة الاشتباه</th><th>دقة السليمة</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  const cls = `v2-port-col ${variant}${compact ? " compact" : ""}`;

  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(headIcon, 26)}</span>
      <div><b>${esc(title)}</b><span>${headSub}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}${blankRow}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>`;
}

/** Build one or more port-accuracy slides (paginated land/sea in parallel). */
export function accuracyPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortAccuracyRows(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${accuracyTable("المنافذ البرية", landChunk, "land", plan.compact)}${accuracyTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-accuracy-${page + 1}`,
        title: `دقة نتائج المنافذ${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "gauge",
        headline: `نتائج دقة نتائج المنافذ (اشتباه / سليمة)${cont}`,
        subhead: "الدقة العامة، ودقة اكتشاف الاشتباه، ودقة تأكيد السليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}

// ── NEW — closing slide (data provenance + classification + organization) ─────
/** Elevates the source-revisions footer into a designed provenance block, paired
 *  with the classification reminder and the organization line. When no revisions
 *  are supplied it renders a graceful note rather than an empty block. Does NOT
 *  use the legacy `.srev-*` markup, so the footer-omission test (no `.srev-file`
 *  when revisions are absent) stays valid — the on-screen footer contract is
 *  untouched, this slide is an additional designed presentation. */
export function closingSlide(
  model: ReportModel,
  sourceRevisions: SourceRevisions | undefined,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const entries = sourceRevisionEntries(sourceRevisions);
  const provenance =
    entries.length > 0
      ? `<div class="v2-prov-list">${entries
          .map(
            ([file, rev]) =>
              `<div class="v2-prov-item"><span class="v2-prov-file" dir="ltr">${esc(file)}</span><span class="v2-prov-rev">مراجعة ${esc(String(rev))}</span></div>`,
          )
          .join("")}</div>`
      : `<div class="v2-prov-empty">لم تُسجَّل مراجعات لملفات المصدر مع هذا التقرير.</div>`;
  // Source attribution (owner request): which upload sources fed this month —
  // the risk-agency base file (always, every row originates from it) and the
  // optional BI supporting file, detected from the processor's row flags.
  const src = model.dataSources;
  const sourcesBlock = `<div class="v2-src-grid">
    <div class="v2-src-card gold">
      <div class="v2-src-head">${badgeIcon("layers", 15)}<b>بيانات وكالة المخاطر</b><span class="v2-src-tag">المصدر الأساسي</span></div>
      <p>${fmtNum(src.riskRowCount)} صورة مسجّلة هذا الشهر</p>
    </div>
    <div class="v2-src-card ${src.biProvided ? "blue" : "off"}">
      <div class="v2-src-head">${badgeIcon("scan", 15)}<b>بيانات ذكاء الأعمال</b><span class="v2-src-tag">مصدر داعم</span></div>
      <p>${src.biProvided ? `مُقدَّم — أثرى ${fmtNum(src.biMatchedCount)} صورة بالمطابقة` : "غير مُقدَّم هذا الشهر"}</p>
    </div>
  </div>`;
  const body = `<div class="v2-closing">
      <div class="v2-closing-main">
        <div class="v2-closing-icon">${badgeIcon("document", 26)}</div>
        <h2>مصدر البيانات والاعتماد</h2>
        <div class="v2-sep-rule"></div>
        <p>يربط هذا التقرير بنسخة البيانات المحدَّدة وقت التوليد؛ رقم المراجعة لكل ملف مصدر يضمن إمكانية التتبّع والمراجعة.</p>
        <div class="v2-prov-block">
          <div class="v2-prov-title"><span class="v2-prov-title-icon">${icon("layers", 14)}</span>مصادر البيانات المُدخلة</div>
          ${sourcesBlock}
          <div class="v2-prov-title"><span class="v2-prov-title-icon">${icon("document", 14)}</span>مراجعات ملفات المصدر</div>
          <div class="v2-prov-body">${provenance}</div>
        </div>
      </div>
      <div class="v2-closing-side">
        <div class="v2-closing-badge"><span>${icon("shield", 13)}</span>داخلي — للاستخدام التنفيذي</div>
        <div class="v2-closing-org">
          <b>هيئة الزكاة والضريبة والجمارك</b>
          ${ORGANIZATION_PATH.map((l) => `<span>${esc(l)}</span>`).join("")}
        </div>
        <div class="v2-closing-period">${esc(model.summary.periodId)}</div>
      </div>
    </div>`;
  return v2Slide({
    id: "slide-closing",
    title: "مصدر البيانات",
    eyebrow: "خاتمة",
    iconName: "shield",
    headline: "مصدر البيانات والاعتماد",
    subhead: "تتبّع نسخة البيانات، والتصنيف، والجهة المُصدِرة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "closing",
  });
}

// ── Assembly ─────────────────────────────────────────────────────────────────
/**
 * Build all v2 slides in order. Section page ranges on the المحتويات slide are
 * computed from the real build sequence (never hand-typed), so the TOC cannot
 * drift as pages are added, removed, or paginated differently month to month.
 */
export function buildDeckV2Slides(
  model: ReportModel,
  generatedAt = new Date(),
  variantPreview = false,
  sourceRevisions?: SourceRevisions,
  seedBase = "",
): string {
  const glossaryBuilders = glossarySlideBuilders(variantPreview); // 1..N pages, paginated by term count

  // Section-2 opener funnel: population → sample → studied → اشتباه (studied
  // cases flagged as اشتباه), computed once from the model.
  const studiedSuspicion = model.rows.filter(
    (r) => r.answerStatus === "submitted" && r.imageResult === "اشتباه",
  ).length;
  const resultsFunnel = funnel(
    [
      { label: "المجتمع", value: model.population.total },
      { label: "العيّنة", value: model.sample.total },
      { label: "المدروسة", value: model.sample.studied },
      { label: "اشتباه", value: studiedSuspicion },
    ],
    { width: 340, height: 200 },
  );

  // Section 1 — مجتمع الفحص: separator + risk stages + port tables (1..N pages).
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 1,
        sectionKey: "section1",
        iconName: "layers",
        title: "مجتمع الفحص",
        blurb:
          "التعريف بمجتمع الصور لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية، وهو الأساس الذي سُحبت منه العيّنة.",
        keyStatValue: fmtNum(model.population.total),
        keyStatLabel: "صورة في مجتمع الشهر",
        takeaway: `عيّنة ${fmtNum(model.sample.total)} صورة بتغطية ${fmtPct(model.sample.coverage)} تمثّل هذا المجتمع.`,
        tone: "gold",
        seedBase,
        num,
        total,
        variantPreview,
      }),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    (num, total) => portsOverviewSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
    (num, total) => stagePortPopulationSlide(model, num, total, variantPreview),
    (num, total) => stagePortSampleSlide(model, num, total, variantPreview),
  ];

  // Section 2 — نتائج فحص الجودة: separator (with funnel) + image-quality + accuracy.
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide({
        sectionNo: 2,
        sectionKey: "section2",
        iconName: "gauge",
        title: "نتائج فحص الجودة",
        blurb:
          "جودة الصور المفحوصة في كل منفذ (التوفّر والتحديد والجودة المقبولة)، ودقة قرارات الفحص بين الاشتباه والسليمة.",
        keyStatValue: model.summary.overallAccuracy === null ? "—" : fmtPct(model.summary.overallAccuracy),
        keyStatLabel: "الدقة العامة لقرارات الفحص",
        takeaway: "المسار من المجتمع إلى الصور المدروسة ثم المشتبه بها.",
        extra: resultsFunnel,
        tone: "cyan",
        seedBase,
        num,
        total,
        variantPreview,
      }),
    ...qualityPortSlideBuilders(model, variantPreview),
    ...accuracyPortSlideBuilders(model, variantPreview),
  ];

  // Page order: cover(1) · toc(2) · month-in-numbers(3) · glossary(N) ·
  // section 1 · section 2 · closing(last).
  const total =
    3 + glossaryBuilders.length + sectionOne.length + sectionTwo.length + 1; // +cover+toc+summary, +closing
  const glossaryStart = 4;
  const glossaryEnd = 3 + glossaryBuilders.length;
  const sectionOneStart = glossaryEnd + 1;
  const sectionOneEnd = sectionOneStart + sectionOne.length - 1;
  const sectionTwoStart = sectionOneEnd + 1;
  const sectionTwoEnd = sectionTwoStart + sectionTwo.length - 1;
  const closingNum = total;

  const accuracyFig =
    model.summary.overallAccuracy === null ? "—" : fmtPct(model.summary.overallAccuracy);
  const tocItems: TocItem[] = [
    {
      title: "الشهر في أرقام",
      goal: "أبرز مؤشرات الشهر في لوحة واحدة.",
      range: pad(3),
      iconName: "chart",
      tone: "gold",
      figure: fmtNum(model.population.total),
      figureLabel: "صورة",
    },
    {
      title: "المعجم",
      goal: "توحيد المصطلحات الرئيسية قبل قراءة النتائج.",
      range: glossaryEnd > glossaryStart ? `${pad(glossaryStart)}–${pad(glossaryEnd)}` : pad(glossaryStart),
      iconName: "document",
      tone: "blue",
      figure: fmtNum(GLOSSARY_CATEGORIES.reduce((s, c) => s + c.terms.length, 0)),
      figureLabel: "مصطلح",
    },
    {
      title: "القسم الأول — مجتمع الفحص",
      goal: "التعريف بمجتمع الصور وتوزيعه بحسب المخاطر والمنافذ، وأساس سحب العيّنة.",
      range: `${pad(sectionOneStart)}–${pad(sectionOneEnd)}`,
      iconName: "layers",
      tone: "green",
      figure: fmtNum(model.sample.total),
      figureLabel: "عيّنة",
    },
    {
      title: "القسم الثاني — نتائج فحص الجودة",
      goal: "جودة الصور المفحوصة، ودقة قرارات الفحص بين الاشتباه والسليمة، لكل منفذ.",
      range: `${pad(sectionTwoStart)}–${pad(sectionTwoEnd)}`,
      iconName: "gauge",
      tone: "coral",
      figure: accuracyFig,
      figureLabel: "الدقة",
    },
  ];

  const slides: string[] = [
    coverSlide(model, generatedAt, variantPreview, seedBase),
    tocSlide(tocItems, 2, total, variantPreview),
    monthInNumbersSlide(model, 3, total, variantPreview),
  ];
  let num = glossaryStart;
  for (const build of glossaryBuilders) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionOne) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionTwo) {
    slides.push(build(num, total));
    num += 1;
  }
  slides.push(closingSlide(model, sourceRevisions, closingNum, total, variantPreview));
  return slides.join("\n");
}
