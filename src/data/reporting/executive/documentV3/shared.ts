// A4 page-shaped chrome in deck3's visual language. Parallels deck3/slideKit's
// cover/closing/section-divider builders but wraps deck3's canvas-size-agnostic
// CONTENT builders (contentHead, tintedPanel, dataTable, kpiBand, orgBlockHtml,
// coverMetaRow — none of which call slideShell) in a flowing <section class="docpage v3">
// shell instead of slideShell's fixed 1920x1080 <section class="slide v3">.
import { esc } from "../primitives";
import { contentHead, tintedPanel, dataTable, kpiBand, orgBlockHtml, coverMetaRow } from "../deck3/slideKit";
import type { OrgBlock, TableCell, KpiCell } from "../deck3/slideKit";

export type DocPageOpts = { id: string; title: string; pageNo: string; body: string; extraClass?: string };

export function docPage(opts: DocPageOpts): string {
  const extra = opts.extraClass ? ` ${esc(opts.extraClass)}` : "";
  return `<section id="${esc(opts.id)}" data-title="${esc(opts.title)}" class="docpage v3${extra}">
${opts.body}
<div class="docpage-foot"><span>${esc(opts.title)}</span><span>${esc(opts.pageNo)}</span></div>
</section>`;
}

export function docPageHeader(opts: { eyebrow: string; title: string; note?: string }): string {
  return contentHead(opts);
}

export function docKpiStrip(cells: KpiCell[]): string {
  return kpiBand(cells, "solo");
}

export function docPanel(title: string, body: string): string {
  return tintedPanel({ variant: "land", title, body, padLg: true });
}

export function docTwoColumn(opts: {
  land: { title: string; note?: string; body: string };
  sea: { title: string; note?: string; body: string };
}): string {
  return `<div class="v3-two-col">
${tintedPanel({ variant: "land", title: opts.land.title, note: opts.land.note, body: opts.land.body })}
${tintedPanel({ variant: "sea", title: opts.sea.title, note: opts.sea.note, body: opts.sea.body })}
</div>`;
}

export type DocCoverOpts = {
  org: OrgBlock;
  title: string;
  periodLabel: string;
  periodValue: string;
  metaRows: Array<{ label: string; value: string; end?: boolean }>;
};

export function docCover(opts: DocCoverOpts): string {
  return `<section class="docpage v3 docpage-cover" data-title="${esc(opts.title)}">
${orgBlockHtml(opts.org)}
<div>
  <div class="v3-eyebrow">${esc(opts.periodLabel)}</div>
  <h1 class="doc-cover-title">${esc(opts.title)}</h1>
  <div>${esc(opts.periodValue)}</div>
</div>
${coverMetaRow(opts.metaRows)}
</section>`;
}

export function docClosing(opts: { org: OrgBlock; title: string; closingLine: string }): string {
  return `<section class="docpage v3 docpage-cover" data-title="${esc(opts.title)}">
${orgBlockHtml(opts.org)}
<div><h1 class="doc-cover-title">${esc(opts.title)}</h1><p>${esc(opts.closingLine)}</p></div>
</section>`;
}

export function docSectionDivider(opts: {
  ghost: string;
  kicker: string;
  title: string;
  description: string;
}): string {
  return `<section class="docpage v3 docpage-divider" data-title="${esc(opts.title)}">
<div class="doc-div-ghost">${esc(opts.ghost)}</div>
<div class="doc-div-kicker">${esc(opts.kicker)}</div>
<h1 class="doc-div-h1">${esc(opts.title)}</h1>
<p class="doc-div-desc">${esc(opts.description)}</p>
</section>`;
}

export type PaginateTableOpts = {
  headers: string[];
  rows: TableCell[][];
  totals?: TableCell[];
  rowsPerPage?: number;
};

export function docPaginateTable(opts: PaginateTableOpts): string[] {
  const rowsPerPage = opts.rowsPerPage ?? 20;
  if (opts.rows.length === 0) {
    return [dataTable({ headers: opts.headers, rows: [], totals: opts.totals })];
  }
  const chunks: string[] = [];
  for (let i = 0; i < opts.rows.length; i += rowsPerPage) {
    const slice = opts.rows.slice(i, i + rowsPerPage);
    const isLast = i + rowsPerPage >= opts.rows.length;
    chunks.push(dataTable({ headers: opts.headers, rows: slice, totals: isLast ? opts.totals : undefined }));
  }
  return chunks;
}
