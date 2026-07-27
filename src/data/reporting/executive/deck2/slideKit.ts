// Executive deck v2 — shared slide kit.
//
// The primitives every deck2 slide builder needs: the slide shell (`v2Slide`),
// its chrome (`slideControls`/`sideRail`/`pageFoot`/`renderVariants`), the
// in-cell visual vocabulary (`barCell`/`threshCell`/`qualCell`/`pctCell`), the
// port-table pagination plan (`planPortPages` + its measured budgets), and the
// per-port tally (`collectPortStats`).
//
// These all used to be module-private inside `deck2/slides.ts`. They were
// lifted here verbatim (behavior unchanged, every doc comment preserved — the
// measurement findings they record are load-bearing) so that per-section slide
// modules such as `deck2/section3/` can build on the same shell without either
// re-implementing it or forcing every new page into `slides.ts` itself.
//
// This module is the single source of truth for these symbols; `slides.ts`
// imports them and re-exports the two that were already public.

import type { ReportModel } from "../model/reportModel";
import { esc, fmtNum, fmtPct } from "../primitives";
import { icon } from "../ui/icons";

// ── In-cell visuals (pure background — never change row height/padding/font) ──
export type CellTone = "gold" | "blue" | "green" | "coral" | "neutral";

/**
 * Wrap a numeric cell's inner HTML in a <td> that paints a tone-tinted
 * proportional bar behind the text, growing from the inline-start edge (right,
 * in this RTL deck). The bar is a CSS background only (`.v2-bar-cell` in
 * theme.ts reads `--w`), so it adds ZERO layout height — the fragile
 * table pagination machinery
 * stays exactly valid. `pct` is the value's share of the column max, 0–100.
 */
export function barCell(inner: string, pct: number, tone: CellTone = "neutral"): string {
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
export function threshCell(v: number | null, target: number): string {
  if (v === null) return `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
  const val = Math.max(0, Math.min(100, v));
  const below = val < target;
  const tone = below ? "warn" : "ok";
  const flag = below ? `<span class="v2-cell-flag" aria-hidden="true">${icon("alert", 10)}</span>` : "";
  return `<td class="v2-bar-cell ${tone}" style="--w:${val.toFixed(1)}%">${flag}${fmtPct(v)}</td>`;
}

/** Largest value in a list, floored at 1 so a proportional bar never divides by
 *  zero (an all-zero column simply yields empty bars). */
export function maxOf(values: number[]): number {
  return Math.max(1, ...values.filter((v) => Number.isFinite(v)));
}

/** Display thresholds for the section-2 percent tables. Mirror the report
 *  config defaults (`DEFAULT_EXEC_CONFIG.accuracyTarget` = 90); the ReportModel
 *  doesn't carry config, so these are named constants here rather than magic
 *  numbers. Below-target cells get the warning tone + alert glyph in threshCell. */
export const ACCURACY_TARGET = 90;
export const MARKING_TARGET = 90;

/** A distribution percent cell (quality عالي/متوسط/منخفض): a tone-colored bar of
 *  fixed polarity (green = good share, coral = risk share), NOT threshold-scored.
 *  Null renders the muted "—". */
export function qualCell(v: number | null, tone: CellTone): string {
  if (v === null) return `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;
  return barCell(fmtPct(v), Math.max(0, Math.min(100, v)), tone);
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A slide builder that receives its final 1-based number and the deck total. */
export type SlideBuilder = (num: number, total: number) => string;

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
export function badgeIcon(name: string, size: number): string {
  const nudge = ICON_OPTICAL_NUDGE[name];
  if (!nudge) return icon(name, size);
  return `<span style="display:inline-flex;transform:translate(${nudge.x}%,${nudge.y}%)">${icon(name, size)}</span>`;
}

/**
 * Compact 180° coverage arc for a stage tile — a micro SVG dial that inherits
 * its caller's tone via `currentColor`. Low→high reads left→right (a physical
 * gauge), same convention as ui/charts.ts `gauge`. Decorative (the percentage
 * is printed beside it as text), so aria-hidden and no interpolated data.
 * Lifted here from `slides.ts` (2026-07-25, deck2-design-systems Task 1) so
 * Briefing's lede gauge (design spec §2, slot 2) can reuse it too — same
 * cross-file sharing convention this module already uses for `STAGE_TONES`/
 * `badgeIcon`/`fmtPct`: defined once here, imported everywhere else.
 */
export function microArc(pct: number): string {
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

/**
 * Per-slide print-include switch, on-screen only. Pure CSS, no script:
 * unchecking it excludes the WHOLE slide from print/PDF output via the
 * `.slide:has(.slide-print-toggle input:not(:checked))` rule in theme.ts —
 * safe to rely on `:has()` since this app already targets Chromium only
 * (File System Access API). Defaults checked (included). Rendered inside
 * `slideControls()`, which positions it (top-right corner).
 */
export function printToggle(): string {
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
export function variantSwitcher(slideId: string): string {
  const label = resolveVariantIndex(slideId) + 1;
  return `<div class="v2-variant-switcher" data-for="${esc(slideId)}" dir="ltr">
    <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
    <span class="v2-variant-label">${label} / 4</span>
    <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
  </div>`;
}

/**
 * Top-right controls cluster for a slide: the print-include toggle, plus
 * (dev-preview only) the style-variant switcher right next to it — grouped in
 * one positioned wrapper (theme.ts's `.slide-controls`) instead of each being
 * independently absolutely-positioned.
 */
export function slideControls(slideId: string, variantPreview: boolean): string {
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
  summary: "مؤشرات الشهر",
  glossary: "المعجم",
  section1: "القسم 1 — مجتمع الفحص",
  section2: "القسم 2 — نتائج فحص الجودة",
  section3: "القسم 3 — التحاليل المتقدمة",
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
export function sideRail(active: NavSectionKey): string {
  const tabs: Array<{ key: NavSectionKey; label: string }> = [
    { key: "glossary", label: "المعجم" },
    { key: "section1", label: "مجتمع الفحص" },
    { key: "section2", label: "نتائج فحص الجودة" },
    { key: "section3", label: "التحاليل المتقدمة" },
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
export function pageFoot(num: number, total: number): string {
  return `<div class="v2-page-foot" dir="ltr">${pad(num)} / ${pad(total)}</div>`;
}

/**
 * Module-level "active style choices" for the duration of one
 * `buildExecutiveDeckV2` call — set once at the top of that function, read by
 * `renderVariants` below. Deliberately NOT a parameter threaded through every
 * one of the ~18 slide-builder functions: `renderVariants` is already the
 * single choke point every slide (via `v2Slide`, plus the two direct callers
 * `coverSlide`/`sectionSeparatorSlide`) funnels through, so scoping the state
 * here confines this whole feature to this file + deck2/index.ts. Reports are
 * always built synchronously within one JS turn (no concurrent
 * `buildExecutiveDeckV2` calls can interleave), so there's no cross-call
 * interference risk. See
 * docs/superpowers/specs/2026-07-25-admin-report-customization-design.md.
 */
let activeStyleChoices: Record<string, number> | null = null;

export function setActiveStyleChoices(choices: Record<string, number> | null): void {
  activeStyleChoices = choices;
}

export function getActiveStyleChoices(): Record<string, number> | null {
  return activeStyleChoices;
}

/**
 * Strips a trailing `-<digits>` page-number suffix, e.g. `slide-port-population-3`
 * → `slide-port-population`. Paginated builders use 3 different suffix
 * conventions (always-suffixed from page 1; bare on page 0, suffixed from
 * page 1) — this normalizes all of them to one stable "family" key so a
 * saved style choice survives the deck's page count changing month to month
 * (see docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md §3).
 * A no-op for non-paginated slide ids (no trailing page number to strip).
 */
function familyKeyOf(slideId: string): string {
  return slideId.replace(/-\d+$/, "");
}

/** Clamps a valid-shape choice to a 0-3 slot; returns null for anything
 *  missing, non-numeric, or out of range. */
function clampChoice(choice: unknown): number | null {
  return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice <= 3
    ? choice
    : null;
}

/**
 * Resolves the variant index to render for a given slide id: exact id match
 * first (so an already-saved per-page-id choice from before the family-key
 * fix keeps working), then the slide's family key (a choice saved without a
 * page-number suffix applies to every page count), then the deck-wide
 * default key `"*"`, then 0. Never throws — a choice saved against a slide
 * id that no longer exists, or a stale/corrupt file, silently falls through
 * to the next tier instead.
 */
function resolveVariantIndex(slideId: string): number {
  const exact = clampChoice(activeStyleChoices?.[slideId]);
  if (exact !== null) return exact;
  const family = clampChoice(activeStyleChoices?.[familyKeyOf(slideId)]);
  if (family !== null) return family;
  const deckDefault = clampChoice(activeStyleChoices?.["*"]);
  return deckDefault !== null ? deckDefault : 0;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders `bodies[resolveVariantIndex(slideId)]`
 * — `bodies[0]` when no admin choice is saved for this slide, byte-identical
 * to the single-variant output that existed before the switcher (a
 * dev-preview feature; see
 * docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md — and now
 * also the production selection mechanism for the in-app admin customizer,
 * docs/superpowers/specs/2026-07-25-admin-report-customization-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`),
 * initially the saved choice (or panel 0) instead of always panel 0, so
 * re-opening the customizer shows what's currently saved.
 * The arrow-cycle control that drives interactive switching lives separately
 * in `slideControls()`/`variantSwitcher()`; the inline script in
 * deck2/index.ts (DECK_VARIANT_SCRIPT) wires the two together by matching
 * `data-for` to `data-slide-id` and persists the choice.
 */
export function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  const initialIndex = resolveVariantIndex(slideId);
  if (!variantPreview) return bodies[initialIndex];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === initialIndex ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="${initialIndex}">${panels}</div>`;
}

// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
export function v2Slide(opts: {
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

// ── Risk-stage tones ────────────────────────────────────────────────────────
export const STAGE_TONES = ["gold", "blue", "green", "coral"] as const;

// ── Per-port tallies + port-table pagination ────────────────────────────────
export type PortPopRow = {
  name: string;
  total: number;
  clean: number;
  suspicious: number;
  sampleTotal: number;
  sampleClean: number;
  sampleSuspicious: number;
};

export function collectPortStats(model: ReportModel): { land: PortPopRow[]; sea: PortPopRow[] } {
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
export function frac(sampleN: number, popN: number): string {
  return `<span class="v2-frac"><b>${fmtNum(sampleN)}</b><span>من ${fmtNum(popN)}</span></span>`;
}

/**
 * One invisible `<tr>` between a table's real rows and its totals row, so
 * الإجمالي can be pinned flush to the bottom of its fixed-height card. Its
 * height is left at 0 here — `DECK_TABLE_FILL_SCRIPT` (deck2/index.ts)
 * measures each card's real rendered leftover space live in the browser and
 * sets it, the same "measure, don't estimate" discipline the row-height
 * tuning in theme.ts already follows.
 *
 * Emitted for EVERY non-empty table, not just short ones: the row budget is
 * a clipping ceiling, not a fill guarantee — a compact-tier table at its full
 * planned row count still leaves ~140px unused, because `compact` shrinks
 * rows well below the height the base budget was sized against. Gating on
 * "fewer rows than planned" therefore misses the most common floating-totals
 * case. When a table genuinely does fill its card the measured leftover is
 * ≤0 and the row stays at 0px, so this is a no-op there.
 */
export function fillerRow(span: number, rowCount: number): string {
  return rowCount > 0 ? `<tr class="v2-fill-row" aria-hidden="true"><td colspan="${span}"></td></tr>` : "";
}

/**
 * The one card+table shell every land/sea (or single) port table in this deck
 * renders through — `.v2-port-col` head + `.deck-table`, with `fillerRow`
 * wired in automatically. Introduced 2026-07-25 (owner: "why is this table a
 * different design from other tables") — `portTable`/`qualityTable`/
 * `accuracyTable` in slides.ts, and Section 3's `levelAccuracy`/
 * `portAgreement`, had each hand-rolled their own copy of this markup, which
 * is exactly how they drifted (Section 3's tables shipped their own CSS-scoped
 * variants instead of the shared `.v2-port-col`/`.deck-table` classes).
 *
 * This is deliberately a SHELL, not a generic data-grid — the header cells,
 * row cells, and totals row are still built by the caller with whatever
 * page-specific columns/values/tones it needs (`barCell`/`threshCell`/etc.),
 * because that logic is genuinely different per page. What this guarantees is
 * that the OUTER markup — card classes, head layout, table structure, the
 * filler-row totals-pinning mechanism — is identical everywhere, so every
 * table in the deck looks and behaves like the same component.
 */
export function portTableCard(opts: {
  title: string;
  headSub: string;
  headIcon: string;
  variant: "land" | "sea";
  compact?: boolean;
  /** Adds the `.sample-mode` padding variant (stacked "N من M" cells need more room). */
  sampleMode?: boolean;
  /** Extra card classes for a page-specific tone/summary variant, e.g. "summary". */
  extraClass?: string;
  /** Header cell markup WITHOUT the surrounding `<tr>` — e.g. `<th>...</th><th>...</th>`. */
  theadCells: string;
  /** Concatenated `<tr>...</tr>` markup for the data rows, or the single
   *  colspan `—` placeholder row when there are none. */
  bodyRowsHtml: string;
  /** Real data-row count (NOT counting a placeholder row) — feeds `fillerRow`. */
  rowCount: number;
  /** Column count — the `colspan` for both the placeholder row and the filler row. */
  span: number;
  /** Totals `<tr>...</tr>` markup. */
  totalsRowHtml: string;
}): string {
  const cls = [
    "v2-port-col",
    opts.variant,
    opts.sampleMode ? "sample-mode" : "",
    opts.compact ? "compact" : "",
    opts.extraClass ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${badgeIcon(opts.headIcon, 26)}</span>
      <div><b>${esc(opts.title)}</b><span>${esc(opts.headSub)}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>${opts.theadCells}</tr></thead>
      <tbody>${opts.bodyRowsHtml}${fillerRow(opts.span, opts.rowCount)}</tbody>
      <tfoot>${opts.totalsRowHtml}</tfoot>
    </table>
  </div>`;
}

/**
 * A general-purpose table-card shell for the "Ledger" design system (spec's
 * slot 1 — verifiability: tables and figure-strips only). Generalizes
 * `portTableCard`'s shape (table/totals-row/filler-row/span) so any
 * table-only page can render through the same mechanism without hand-rolling
 * its own `<table>` markup — the same motivation `portTableCard` itself
 * documents, one level more generic: this one has no icon+title card head
 * (that shape is specific to the per-port land/sea cards), just an optional
 * plain title line, since most Ledger tables sit inside a page that already
 * has its own headline/section title.
 *
 * `cardClass` defaults to the new shared `.v2-lg-table-card` class (theme.ts).
 * `levelFiguresTable` (slides.ts) passes the legacy `.v2-level-table-card`
 * name instead so `slide-risk-stages`'s already-shipped variant-1 markup never
 * churns — `.v2-level-table-card` is kept as a `theme.ts` alias of
 * `.v2-lg-table-card`'s rules (design spec §4), so both class names render
 * identically; this override exists purely to keep that one page's
 * byte-for-byte output stable, not because the two classes style differently.
 *
 * `rowCount` also gates the filler row exactly like `portTableCard` does (via
 * `fillerRow`) — a caller whose card CENTERS its fixed content instead of
 * pinning a totals row flush to the bottom (like `levelFiguresTable`'s small
 * 4-row table) passes `rowCount: 0` to opt out of that pinning trick, since
 * `DECK_TABLE_FILL_SCRIPT` (deck2/index.ts) only ever measures/sizes
 * `.v2-port-col`/`.v2-stage-port-card` cards — an unmeasured filler row would
 * just be dead markup anywhere else.
 */
export function ledgerTableCard(opts: {
  /** Optional plain title line above the table. Omitted entirely (no markup,
   *  not even an empty wrapper) when not supplied — callers whose page
   *  headline already names the table don't pay for an empty title slot. */
  title?: string;
  /** Header cell markup WITHOUT the surrounding `<tr>` — same convention as
   *  `portTableCard.theadCells`. */
  theadCells: string;
  /** Concatenated `<tr>...</tr>` markup for the data rows. */
  bodyRowsHtml: string;
  /** Totals `<tr>...</tr>` markup. */
  totalsRowHtml: string;
  /** Column count — the `colspan` fillerRow uses when `rowCount > 0`. */
  span: number;
  /** Real data-row count, feeding `fillerRow` exactly like `portTableCard`.
   *  Pass 0 to opt out of the filler row entirely (see doc comment above). */
  rowCount: number;
  /** Wrapper `<div>` class. Default `"v2-lg-table-card"`. */
  cardClass?: string;
}): string {
  const cls = opts.cardClass ?? "v2-lg-table-card";
  const titleHtml = opts.title
    ? `\n    <div class="v2-lg-table-card-title">${esc(opts.title)}</div>`
    : "";
  return `<div class="${cls}">${titleHtml}
    <table class="deck-table">
      <thead><tr>${opts.theadCells}</tr></thead>
      <tbody>${opts.bodyRowsHtml}${fillerRow(opts.span, opts.rowCount)}</tbody>
      <tfoot>${opts.totalsRowHtml}</tfoot>
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
export const BASE_ROWS_PER_PAGE = 7;

/**
 * If a table overflows its base budget by only 1–3 rows, compress row height
 * slightly (the `compact` CSS variant) so everyone fits on one page instead
 * of spilling those 1–3 rows onto a near-empty continuation page. Beyond a
 * 3-row overflow, paginate normally at the base row size. The shared compact
 * tier was measured to comfortably fit BASE+3 for both modes (12 population
 * rows, 9 sample rows) with 80px+ of slack to spare.
 */
export const COMPRESS_OVERFLOW_MAX = 3;

type PortPagePlan = { pages: number; rowsPerPage: number; compact: boolean };

export function planPortPages(landCount: number, seaCount: number, baseRowsPerPage: number): PortPagePlan {
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
 * Briefing system (slot 2 — الإحاطة)'s ranked-list density plan — a
 * page-agnostic contract every Briefing page calls instead of re-deriving its
 * own row budget (2026-07-25 fix; see
 * docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md and the
 * design-advisor ruling that replaced this task's first, buggy attempt,
 * which borrowed `planPortPages`'s PER-COLUMN table-geometry budget for a
 * COMBINED ranked list and silently dropped rows past it).
 *
 * Budget (measured against the real 459px `.slide-body`, per the design
 * ruling): 459 − 112 (lede) − 55 (support strip) − 2×14 (flex gaps) = 264.
 * Row gap is 5px at every tier, so per-column capacity is
 * floor((264+5)/(rowH+5)) — see `capFor` below, the single place this
 * arithmetic actually lives (a peer review, 2026-07-25, caught this comment's
 * first draft stating "181...278" — arithmetic that didn't reconcile with
 * the shipped 264 constant; corrected here, and `BRIEFING_RANK_DENSEST_CAP`
 * below is now derived from `capFor` instead of a second hardcoded copy of
 * the same number, so the two can no longer drift out of sync).
 *
 * The ladder tries, in order: 1 col @44px (cap 5) → 1 col @36px (cap 6) →
 * 2 cols @44px (cap 10) → 2 cols @36px (cap 12) → 2 cols @30px (cap 14,
 * the floor — Arabic descenders/nuqat start colliding with the row below
 * this size, a geometric fact, not a taste call). Beyond 14, the tail folds
 * into one aggregating remainder row (never exactly 1 folded item — the
 * densest tier's capacity is sized so folding only ever starts at a 2+
 * remainder). Two columns is a hard cap: a third would shorten the bar
 * tracks past the point where magnitude comparison works, which would make
 * this Grid, not Briefing.
 */
export type BriefingRankPlan = {
  tier: "comfortable" | "compact" | "dense";
  rowH: 44 | 36 | 30;
  columns: 1 | 2;
  rowsPerColumn: number;
  /** How many items get their own named row. */
  named: number;
  /** How many items fold into the single trailing remainder row (0 = none). */
  folded: number;
};

export const BRIEFING_RANK_BUDGET_PX = 264;
const BRIEFING_RANK_ROW_GAP_PX = 5;

function capFor(rowH: number, columns: 1 | 2): number {
  const perColumn = Math.floor((BRIEFING_RANK_BUDGET_PX + BRIEFING_RANK_ROW_GAP_PX) / (rowH + BRIEFING_RANK_ROW_GAP_PX));
  return perColumn * columns;
}

// Derived from capFor (not a second hardcoded copy of the same number, per
// the 2026-07-25 peer-review fix) — the densest tier's own capacity.
const BRIEFING_RANK_DENSEST_CAP = capFor(30, 2);
const BRIEFING_RANK_NAMED_WHEN_FOLDED = BRIEFING_RANK_DENSEST_CAP - 1;

export function briefingRankPlan(n: number): BriefingRankPlan {
  const ladder: Array<{ tier: BriefingRankPlan["tier"]; rowH: 44 | 36 | 30; columns: 1 | 2 }> = [
    { tier: "comfortable", rowH: 44, columns: 1 },
    { tier: "compact", rowH: 36, columns: 1 },
    { tier: "comfortable", rowH: 44, columns: 2 },
    { tier: "compact", rowH: 36, columns: 2 },
    { tier: "dense", rowH: 30, columns: 2 },
  ];
  for (const step of ladder) {
    const cap = capFor(step.rowH, step.columns);
    if (n <= cap) {
      return {
        tier: step.tier,
        rowH: step.rowH,
        columns: step.columns,
        rowsPerColumn: Math.ceil(n / step.columns),
        named: n,
        folded: 0,
      };
    }
  }
  // Beyond the densest tier's capacity: fold the tail into one remainder row.
  const named = BRIEFING_RANK_NAMED_WHEN_FOLDED;
  return {
    tier: "dense",
    rowH: 30,
    columns: 2,
    rowsPerColumn: Math.ceil(BRIEFING_RANK_DENSEST_CAP / 2),
    named,
    folded: n - named,
  };
}

/** Arabic تمييز (numeral-noun agreement) for "N ports" — 1/2/3-10/11+ each
 *  take a different noun form; getting this wrong reads as sloppy to a
 *  fluent reader in a way an English "N port(s)" mistake never would. */
export function portCountPhrase(n: number): string {
  if (n === 1) return "منفذ واحد";
  if (n === 2) return "منفذان";
  if (n >= 3 && n <= 10) return `${n} منافذ`;
  return `${n} منفذًا`;
}

/** Denominator-gated rate — null (renders "—") when there's nothing to divide by. */
export function rateOf(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/** A percentage cell, muted (`.insuff`, matching the v1 deck's own port
 *  tables) when there's nothing to show rather than plain white "—" text. */
export function pctCell(v: number | null): string {
  return v === null ? `<span class="insuff">—</span>` : fmtPct(v);
}
