// Generic, data-driven slide templates for deck3 (design_handoff_xray_qa_deck
// visual language). Every function here takes typed data and returns HTML —
// a future deck2-only section (workloadAccuracy, dailyTrend, section4)
// reproduced in THIS skin is a new slides.ts entry calling one of these
// functions with real data, not a new theme/CSS pass. See
// docs/superpowers/specs/2026-08-25-executive-report-design-toggle-design.md.
import { esc } from "../primitives";

export function pageFoot(num: number, total: number): string {
  return `<div class="v3-page-foot"><span>تقرير ضمان جودة فحص الأشعة</span><span dir="ltr">${num} / ${total}</span></div>`;
}

export function coverSlide(opts: {
  kicker: string;
  title: string;
  periodLabel: string;
  metaRows: Array<{ label: string; value: string }>;
  num: number;
  total: number;
}): string {
  const meta = opts.metaRows
    .map((m) => `<div class="v3-cover-meta-item"><span class="v3-cover-meta-label">${esc(m.label)}</span><b>${esc(m.value)}</b></div>`)
    .join("");
  return `<section class="slide v3 v3-cover">
    <div class="slide-inner">
      <span class="v3-kicker">${esc(opts.kicker)}</span>
      <h1 class="v3-cover-h1">${esc(opts.title)}</h1>
      <div class="v3-cover-period">${esc(opts.periodLabel)}</div>
      <div class="v3-cover-meta">${meta}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function closingSlide(opts: {
  kicker: string;
  title: string;
  closingLine: string;
  num: number;
  total: number;
}): string {
  return `<section class="slide v3 v3-closing">
    <div class="slide-inner">
      <span class="v3-kicker">${esc(opts.kicker)}</span>
      <h1 class="v3-closing-h1">${esc(opts.title)}</h1>
      <p class="v3-closing-line">${esc(opts.closingLine)}</p>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function contentsSlide(opts: {
  rows: Array<{ index: number; title: string; description: string; pageRange: string }>;
  num: number;
  total: number;
}): string {
  const rows = opts.rows
    .map(
      (r) => `<div class="v3-toc-row">
        <span class="v3-toc-index">${r.index}</span>
        <span class="v3-toc-title">${esc(r.title)}</span>
        <span class="v3-toc-desc">${esc(r.description)}</span>
        <span class="v3-toc-pages" dir="ltr">${esc(r.pageRange)}</span>
      </div>`,
    )
    .join("");
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">المحتويات</h2>
      <div class="v3-toc">${rows}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function glossaryCard(opts: {
  term: string;
  definition: string;
  tone?: "gold" | "blue" | "green" | "coral" | "slate" | "purple" | "cyan";
}): string {
  return `<div class="v3-term-card${opts.tone ? ` ${opts.tone}` : ""}"><b>${esc(opts.term)}</b><p>${esc(opts.definition)}</p></div>`;
}

export function glossarySlide(opts: { title: string; cards: string[]; num: number; total: number }): string {
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-term-grid">${opts.cards.join("")}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function levelDefinitionCard(opts: {
  ordinal: string;
  title: string;
  definition: string;
  samplingWeight: string;
  tone: "gold" | "blue" | "green" | "coral";
}): string {
  return `<div class="v3-level-card ${opts.tone}">
    <span class="v3-level-num">${esc(opts.ordinal)}</span>
    <h4>${esc(opts.title)}</h4>
    <p>${esc(opts.definition)}</p>
    <div class="v3-level-goal"><span>وزن العينة</span><b>${esc(opts.samplingWeight)}</b></div>
  </div>`;
}

export function levelDefinitionSlide(opts: {
  title: string;
  cards: string[];
  highlightValue: string;
  highlightNote: string;
  num: number;
  total: number;
}): string {
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-level-grid">${opts.cards.join("")}</div>
      <div class="v3-level-highlight"><b>${esc(opts.highlightValue)}</b><span>${esc(opts.highlightNote)}</span></div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function kpiGrid(opts: { title: string; cells: Array<{ label: string; value: string }>; num: number; total: number }): string {
  const cells = opts.cells
    .map((c) => `<div class="v3-kpi-cell"><span class="v3-kpi-label">${esc(c.label)}</span><b class="v3-kpi-value">${esc(c.value)}</b></div>`)
    .join("");
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-kpi-grid">${cells}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function sectionDivider(opts: { ordinal: string; title: string; description: string; pageList: string; num: number; total: number }): string {
  return `<section class="slide v3 v3-divider">
    <div class="slide-inner">
      <span class="v3-divider-num">${esc(opts.ordinal)}</span>
      <h1 class="v3-divider-h1">${esc(opts.title)}</h1>
      <p class="v3-divider-desc">${esc(opts.description)}</p>
      <span class="v3-divider-pages" dir="ltr">${esc(opts.pageList)}</span>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function twoPanelTable(opts: {
  title: string;
  landTitle: string; landSub: string; landRowsHtml: string; landTotalsHtml: string;
  seaTitle: string; seaSub: string; seaRowsHtml: string; seaTotalsHtml: string;
  theadCells: string;
  num: number; total: number;
}): string {
  const panel = (variant: "land" | "sea", title: string, sub: string, rows: string, totals: string) => `
    <div class="v3-panel v3-panel-${variant}">
      <div class="v3-panel-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
      <table class="v3-table"><thead><tr>${opts.theadCells}</tr></thead><tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-two-panel">
        ${panel("land", opts.landTitle, opts.landSub, opts.landRowsHtml, opts.landTotalsHtml)}
        ${panel("sea", opts.seaTitle, opts.seaSub, opts.seaRowsHtml, opts.seaTotalsHtml)}
      </div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function matrixSlide(opts: {
  title: string;
  topLeft: { label: string; value: string };
  topRight: { label: string; value: string };
  bottomLeft: { label: string; value: string };
  bottomRight: { label: string; value: string };
  totalLabel: string;
  totalValue: string;
  num: number;
  total: number;
}): string {
  const cell = (c: { label: string; value: string }) => `<div class="v3-matrix-cell"><b>${esc(c.value)}</b><span>${esc(c.label)}</span></div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-matrix">
        ${cell(opts.topLeft)}${cell(opts.topRight)}
        ${cell(opts.bottomLeft)}${cell(opts.bottomRight)}
        <div class="v3-matrix-total"><b>${esc(opts.totalValue)}</b><span>${esc(opts.totalLabel)}</span></div>
      </div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function comparisonPanels(opts: {
  title: string;
  leftTitle: string; leftRows: Array<{ label: string; value: string }>;
  rightTitle: string; rightRows: Array<{ label: string; value: string }>;
  num: number; total: number;
}): string {
  const panel = (title: string, rows: Array<{ label: string; value: string }>) => `
    <div class="v3-cmp-panel">
      <b class="v3-cmp-panel-title">${esc(title)}</b>
      ${rows.map((r) => `<div class="v3-cmp-row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join("")}
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-cmp-grid">${panel(opts.leftTitle, opts.leftRows)}${panel(opts.rightTitle, opts.rightRows)}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}

export function impactSplitSlide(opts: {
  title: string;
  left: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string };
  right: { title: string; chartHtml: string; calloutValue: string; calloutLabel: string };
  num: number;
  total: number;
}): string {
  const col = (c: typeof opts.left) => `
    <div class="v3-impact-col">
      <b class="v3-impact-col-title">${esc(c.title)}</b>
      <div class="v3-impact-chart">${c.chartHtml}</div>
      <div class="v3-impact-callout"><b>${esc(c.calloutValue)}</b><span>${esc(c.calloutLabel)}</span></div>
    </div>`;
  return `<section class="slide v3">
    <div class="slide-inner">
      <h2 class="v3-h2">${esc(opts.title)}</h2>
      <div class="v3-impact-split">${col(opts.left)}${col(opts.right)}</div>
      ${pageFoot(opts.num, opts.total)}
    </div>
  </section>`;
}
