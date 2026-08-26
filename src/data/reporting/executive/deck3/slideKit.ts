// Generic, data-driven slide templates for deck3 (design_handoff_xray_qa_deck
// visual language), rebuilt 2026-08-26 to the handoff's exact structures:
// grid-based contents rows, grouped glossary grids with column rules (no
// rounded cards anywhere — the handoff forbids border radius), 4-column risk
// levels with color chips, KPI bands separated by 2px navy rules, dark
// dividers with the 280px ghost numeral, tinted land/sea panels with 5px top
// rules and dot titles, the 4×4 confusion-matrix grid, and the symmetric
// impact split. Every function takes typed data and returns HTML — a future
// deck2-only section reproduced in THIS skin is a new slides.ts entry calling
// one of these with real data, not a new theme/CSS pass.
import { esc } from "../primitives";

export type SlideMeta = {
  num: number;
  total: number;
  /** Section key + Arabic label for the on-screen side nav (deck2's
   *  DECK_NAV_SCRIPT reads them off `data-section`/`data-section-label`). */
  sectionKey: string;
  sectionLabel: string;
  /** Footer's right-hand text: report name · month. */
  footText: string;
  /** Covers/dividers carry no page counter in the handoff. */
  hideFoot?: boolean;
};

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function pageFoot(meta: SlideMeta): string {
  if (meta.hideFoot) return "";
  return `<footer class="v3-page-foot"><span>${esc(meta.footText)}</span><span class="v3-page-num">${pad2(meta.num)} / ${meta.total}</span></footer>`;
}

/** The `<section>` shell every slide shares: id + data-section hooks for the
 *  side nav, `.slide` for the fullscreen script. */
export function slideShell(meta: SlideMeta, extraClass: string, inner: string): string {
  return `<section class="slide v3${extraClass ? ` ${extraClass}` : ""}" id="v3-slide-${meta.num}" data-section="${esc(meta.sectionKey)}" data-section-label="${esc(meta.sectionLabel)}" dir="rtl">
${inner}
${pageFoot(meta)}
</section>`;
}

/** Content-slide header: gold eyebrow dash+label, H2, optional muted note at
 *  the title row's far end. */
export function contentHead(opts: { eyebrow: string; title: string; note?: string; large?: boolean }): string {
  const note = opts.note ? `<span class="v3-head-note">${esc(opts.note)}</span>` : "";
  return `<header class="v3-head">
  <div class="v3-eyebrow"><span>${esc(opts.eyebrow)}</span></div>
  <div class="v3-title-row"><h2 class="v3-h2${opts.large ? " lg" : ""}">${esc(opts.title)}</h2>${note}</div>
</header>`;
}

// ── Cover / closing ─────────────────────────────────────────────────────────

export type OrgBlock = { logoUrl: string; orgName: string; lines: string[] };

export function orgBlockHtml(org: OrgBlock): string {
  const lines = org.lines.map((l) => `<span>${esc(l)}</span>`).join("");
  return `<div class="v3-org">
  <img src="${org.logoUrl}" alt="${esc(org.orgName)}"/>
  <span class="v3-org-sep"></span>
  <div class="v3-org-lines"><b>${esc(org.orgName)}</b>${lines}</div>
</div>`;
}

export function coverMetaRow(items: Array<{ label: string; value: string; end?: boolean }>): string {
  return `<div class="v3-cover-meta">${items
    .map(
      (m) =>
        `<div class="v3-cover-meta-item${m.end ? " end" : ""}"><span>${esc(m.label)}</span><b>${esc(m.value)}</b></div>`,
    )
    .join("")}</div>`;
}

export function coverSlide(opts: {
  org: OrgBlock;
  kicker: string;
  title: string;
  periodLabel: string;
  periodValue: string;
  metaRows: Array<{ label: string; value: string; end?: boolean }>;
  meta: SlideMeta;
}): string {
  return slideShell(
    { ...opts.meta, hideFoot: true },
    "v3-cover",
    `${orgBlockHtml(opts.org)}
<div class="v3-cover-mid">
  <div class="v3-kicker"><span>${esc(opts.kicker)}</span></div>
  <h1 class="v3-cover-h1">${esc(opts.title)}</h1>
  <div class="v3-cover-period"><span>${esc(opts.periodLabel)}</span><b>${esc(opts.periodValue)}</b></div>
</div>
${coverMetaRow(opts.metaRows)}`,
  );
}

export function closingSlide(opts: {
  org: OrgBlock;
  kicker: string;
  title: string;
  closingLine: string;
  metaRows: Array<{ label: string; value: string; end?: boolean }>;
  meta: SlideMeta;
}): string {
  return slideShell(
    { ...opts.meta, hideFoot: true },
    "v3-closing",
    `${orgBlockHtml(opts.org)}
<div class="v3-cover-mid">
  <div class="v3-kicker"><span>${esc(opts.kicker)}</span></div>
  <h1 class="v3-closing-h1">${esc(opts.title)}</h1>
  <span class="v3-closing-line">${esc(opts.closingLine)}</span>
</div>
${coverMetaRow(opts.metaRows)}`,
  );
}

// ── Contents ────────────────────────────────────────────────────────────────

export function contentsSlide(opts: {
  eyebrow: string;
  title: string;
  rows: Array<{ index: number; title: string; description: string; topics: string; pages: string }>;
  meta: SlideMeta;
}): string {
  const rows = opts.rows
    .map(
      (r) => `<div class="v3-toc-row">
  <span class="v3-toc-index">${pad2(r.index)}</span>
  <div class="v3-toc-main"><b>${esc(r.title)}</b><span>${esc(r.description)}</span></div>
  <span class="v3-toc-topics">${esc(r.topics)}</span>
  <span class="v3-toc-pages">${esc(r.pages)}</span>
</div>`,
    )
    .join("\n");
  return slideShell(opts.meta, "", `${contentHead({ eyebrow: opts.eyebrow, title: opts.title, large: true })}<div class="v3-toc">${rows}</div>`);
}

// ── Glossary ────────────────────────────────────────────────────────────────

export type GlossaryGroup = {
  dotTone: "gold" | "red" | "blue" | "green";
  title: string;
  terms: Array<{ term: string; definition: string }>;
};

export function glossarySlide(opts: { eyebrow: string; title: string; groups: GlossaryGroup[]; meta: SlideMeta }): string {
  const groups = opts.groups
    .map((g) => {
      const cols = Math.min(Math.max(g.terms.length, 2), 3);
      const cells = g.terms
        .map((t) => `<div class="v3-gloss-cell"><b>${esc(t.term)}</b><p>${esc(t.definition)}</p></div>`)
        .join("");
      return `<div class="v3-gloss-group">
  <div class="v3-gloss-title"><span class="v3-gloss-dot v3-tone-${g.dotTone}"></span><span>${esc(g.title)}</span></div>
  <div class="v3-gloss-grid cols-${cols}">${cells}</div>
</div>`;
    })
    .join("\n");
  return slideShell(opts.meta, "", `${contentHead({ eyebrow: opts.eyebrow, title: opts.title, large: true })}<div class="v3-gloss">${groups}</div>`);
}

// ── Risk levels ─────────────────────────────────────────────────────────────

export type LevelTone = "gold" | "blue" | "green-soft" | "red";

export function levelDefinitionSlide(opts: {
  eyebrow: string;
  title: string;
  levels: Array<{ title: string; definition: string; measures: string; weightLine: string; tone: LevelTone }>;
  highlightValue: string;
  highlightTitle: string;
  highlightNote: string;
  meta: SlideMeta;
}): string {
  const cols = opts.levels
    .map(
      (l) => `<div class="v3-level-col">
  <span class="v3-level-chip v3-tone-${l.tone}"></span>
  <h3>${esc(l.title)}</h3>
  <span class="v3-level-def">${esc(l.definition)}</span>
  <div class="v3-level-foot">
    <span class="cap">ما يقيسه</span>
    <span class="measures">${esc(l.measures)}</span>
    <span class="v3-level-weight v3-ink-${l.tone}">${esc(l.weightLine)}</span>
  </div>
</div>`,
    )
    .join("\n");
  return slideShell(
    opts.meta,
    "",
    `${contentHead({ eyebrow: opts.eyebrow, title: opts.title })}
<div class="v3-levels">${cols}</div>
<div class="v3-callout"><b>${esc(opts.highlightValue)}</b><span class="v3-callout-lines"><b>${esc(opts.highlightTitle)}</b><span>${esc(opts.highlightNote)}</span></span></div>`,
  );
}

// ── KPI bands ───────────────────────────────────────────────────────────────

export type KpiCell = {
  label: string;
  value: string;
  valueTone?: "navy" | "gold" | "green" | "red";
  aside?: string;
  sub?: string;
};

export function kpiBand(cells: KpiCell[], variant: "top" | "bottom" | "solo", compact = false): string {
  const cellsHtml = cells
    .map((c) => {
      const aside = c.aside ? `<span class="v3-kpi-aside">${esc(c.aside)}</span>` : "";
      const sub = c.sub ? `<span class="v3-kpi-sub">${esc(c.sub)}</span>` : "";
      return `<div class="v3-kpi-cell">
  <span class="v3-kpi-label">${esc(c.label)}</span>
  <div class="v3-kpi-row"><span class="v3-kpi-value v3-ink-${c.valueTone ?? "navy"}">${esc(c.value)}</span>${aside}</div>
  ${sub}
</div>`;
    })
    .join("");
  return `<div class="v3-kpi-band ${variant}${compact ? " compact" : ""}">${cellsHtml}</div>`;
}

// ── Section dividers ────────────────────────────────────────────────────────

export function sectionDivider(opts: {
  eyebrow: string;
  ghost: string;
  kicker: string;
  title: string;
  description: string;
  footItems: string[];
  meta: SlideMeta;
}): string {
  const foot = opts.footItems.map((f) => `<span>${esc(f)}</span>`).join("");
  return slideShell(
    { ...opts.meta, hideFoot: true },
    "v3-divider",
    `<div class="v3-div-eyebrow"><span>${esc(opts.eyebrow)}</span></div>
<div class="v3-div-main">
  <span class="v3-div-ghost">${esc(opts.ghost)}</span>
  <div class="v3-div-body">
    <span class="v3-div-kicker">${esc(opts.kicker)}</span>
    <h2 class="v3-div-h1">${esc(opts.title)}</h2>
    <p class="v3-div-desc">${esc(opts.description)}</p>
  </div>
</div>
<div class="v3-div-foot">${foot}</div>`,
  );
}

// ── Land/sea tinted panels ──────────────────────────────────────────────────

/** A tinted land/sea panel (5px top rule + dot title) holding arbitrary
 *  content — usually a `v3-table`. */
export function tintedPanel(opts: { variant: "land" | "sea"; title: string; note?: string; padLg?: boolean; body: string }): string {
  const note = opts.note ? `<span class="v3-panel-note">${esc(opts.note)}</span>` : "";
  return `<div class="v3-panel ${opts.variant}${opts.padLg ? " pad-lg" : ""}">
  <div class="v3-panel-head"><span class="v3-panel-title">${esc(opts.title)}</span>${note}</div>
  ${opts.body}
</div>`;
}

export type TableCell = { html: string; cls?: string };

export function dataTable(opts: {
  headers: string[];
  rows: TableCell[][];
  totals?: TableCell[];
  firstColWidth?: 26 | 28 | 36;
  /** Pad the body with empty rows up to this count so sibling panels align
   *  (the handoff does this with literal &nbsp; rows). */
  padToRows?: number;
}): string {
  const widthCls = opts.firstColWidth && opts.firstColWidth !== 28 ? ` first-${opts.firstColWidth}` : "";
  const head = opts.headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tr = (cells: TableCell[]) => `<tr>${cells.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ""}>${c.html}</td>`).join("")}</tr>`;
  const bodyRows = opts.rows.map(tr);
  if (opts.padToRows) {
    while (bodyRows.length < opts.padToRows) {
      bodyRows.push(`<tr>${opts.headers.map(() => "<td>&nbsp;</td>").join("")}</tr>`);
    }
  }
  const foot = opts.totals ? `<tfoot>${tr(opts.totals)}</tfoot>` : "";
  return `<table class="v3-table${widthCls}"><thead><tr>${head}</tr></thead><tbody>${bodyRows.join("")}</tbody>${foot}</table>`;
}

// ── Confusion matrix ────────────────────────────────────────────────────────

export type MatrixCell = { value: string; caption: string; tone: "pos" | "neg" };
export type MatrixSide = { label: string; value: string; sub: string; gold?: boolean };

export function matrixGrid(opts: {
  colHeads: [string, string];
  rowLabels: [string, string];
  cells: [MatrixCell, MatrixCell, MatrixCell, MatrixCell];
  rowSides: [MatrixSide, MatrixSide];
  totalsLabel: string;
  colTotals: [MatrixSide, MatrixSide];
  grandTotal: MatrixSide;
}): string {
  const cell = (c: MatrixCell, last: boolean) =>
    `<div class="v3-mx v3-mx-cell ${c.tone}${last ? " col-last" : ""}"><b>${esc(c.value)}</b><span>${esc(c.caption)}</span></div>`;
  const side = (s: MatrixSide, lastRow: boolean, lastCol: boolean) =>
    `<div class="v3-mx v3-mx-side${s.gold ? " gold" : ""}${lastRow ? " row-last" : ""}${lastCol ? " col-last" : ""}"><span>${esc(s.label)}</span><b>${esc(s.value)}${s.sub ? ` <span class="v3-sub">(${esc(s.sub)})</span>` : ""}</b></div>`;
  return `<div class="v3-matrix">
<div class="v3-mx v3-mx-head"></div>
<div class="v3-mx v3-mx-head">${esc(opts.colHeads[0])}</div>
<div class="v3-mx v3-mx-head">${esc(opts.colHeads[1])}</div>
<div class="v3-mx v3-mx-head muted col-last">الإجمالي</div>
<div class="v3-mx v3-mx-label">${esc(opts.rowLabels[0])}</div>
${cell(opts.cells[0], false)}${cell(opts.cells[1], false)}${side(opts.rowSides[0], false, true)}
<div class="v3-mx v3-mx-label">${esc(opts.rowLabels[1])}</div>
${cell(opts.cells[2], false)}${cell(opts.cells[3], false)}${side(opts.rowSides[1], false, true)}
<div class="v3-mx v3-mx-label row-last">${esc(opts.totalsLabel)}</div>
${side(opts.colTotals[0], true, false)}${side(opts.colTotals[1], true, false)}${side(opts.grandTotal, true, true)}
</div>`;
}

// ── Chart-slide furniture ───────────────────────────────────────────────────

export function chartTitleRow(opts: {
  title: string;
  dot?: "land" | "sea";
  asideDash?: { tone: "gold" | "avg-green" | "avg-red" | "muted"; text: string };
  asideText?: string;
}): string {
  const dot = opts.dot ? ` dot-${opts.dot}` : "";
  let aside = "";
  if (opts.asideDash) {
    aside = `<span class="v3-chart-aside"><span class="v3-dashline ${opts.asideDash.tone}"></span>${esc(opts.asideDash.text)}</span>`;
  } else if (opts.asideText) {
    aside = `<span class="v3-chart-aside">${esc(opts.asideText)}</span>`;
  }
  return `<div class="v3-chart-title-row"><span class="v3-chart-title${dot}">${esc(opts.title)}</span>${aside}</div>`;
}

export type LegendItem =
  | { swatch: "gold" | "blue" | "green" | "red"; text: string }
  | { dash: "gold" | "avg-green" | "avg-red" | "muted"; text: string };

export function legendRow(items: LegendItem[], endText?: string): string {
  const parts = items
    .map((i) =>
      "swatch" in i
        ? `<div class="v3-legend-item"><span class="v3-swatch v3-tone-${i.swatch}"></span><span>${esc(i.text)}</span></div>`
        : `<div class="v3-legend-item muted"><span class="v3-dashline ${i.dash}"></span><span>${esc(i.text)}</span></div>`,
    )
    .join("");
  const end = endText ? `<span class="v3-legend-end">${esc(endText)}</span>` : "";
  return `<div class="v3-legend">${parts}${end}</div>`;
}

// ── Impact split (slide 20) ─────────────────────────────────────────────────

export function impactColumn(opts: {
  title: string;
  note: string;
  chartHtml: string;
  calloutValue: string;
  calloutText: string;
}): string {
  return `<div class="v3-impact-col">
  ${chartTitleRow({ title: opts.title, asideText: opts.note })}
  ${opts.chartHtml}
  <div class="v3-impact-callout"><b>${esc(opts.calloutValue)}</b><span>${esc(opts.calloutText)}</span></div>
</div>`;
}
