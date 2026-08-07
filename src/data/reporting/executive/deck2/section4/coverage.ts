// Executive deck v2 — القسم 4 · صفحة: التغطية التشغيلية.
//
// R4 deck parity (2026-08-08, owner requirement: the executive deck should
// carry the same "التغطية والمساءلة التشغيلية" material the document edition
// shipped as Part 6 — see `document/partCoverageAccountability.ts`, this
// page's document-edition sibling). Reuses `model.distributionCoverage`
// (built ONCE by `computeDistributionModel`, the R2 distribution report's own
// pure model function) VERBATIM — this file never refolds
// `DistributionCurrentData` or recomputes a bucket total itself. That is the
// exact discipline the report family's per-port-accuracy-fold bug (three
// independent folds silently disagreeing) exists to prevent going forward:
// one fold function, `computeDistributionModel`, feeding every edition.
//
// ── Employee breakdown, capped, never silently dropped ─────────────────────
// `DistributionBucket.employees` already carries a full per-employee
// breakdown for every bucket. A deck slide is a fixed 630px box
// (`deckTheme.ts`'s `.slide{height:630px;overflow:hidden}`) — printing every
// employee for every port would silently clip past that box on any month
// with more than a handful of ports/employees. Each bucket row therefore
// names only its TOP contributor by volume, plus an explicit "+N آخرون" count
// when more than one employee touched that bucket — never a bare average and
// never a hidden total. The full un-capped per-employee table for every
// bucket already exists in the document edition (Part 6, no cap) and in the
// distribution report's own Excel export — this deck page is a presentation
// summary of that same source data, not a second copy of the source of
// truth.
//
// ── Port-bucket cap ──────────────────────────────────────────────────────
// Stage buckets are always ≤4 (the four risk levels) and never need capping.
// Port buckets can run into the dozens; capped to the top `PORT_BUCKET_CAP`
// by total assigned, with the remainder folded into one honest "الباقي (K
// منفذ)" row that SUMS the folded ports' own totals into the same columns —
// never silently dropped, same "state the fold, don't hide it" discipline
// `briefingRankList`'s `foldRemainder` already uses elsewhere in this deck.

import type { ReportModel } from "../../model/reportModel";
import type { DistributionBucket } from "../../../distributionReport";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { ledgerIdx, ledgerPortCard, pctCell, v2Slide } from "../slideKit";
import type { SlideBuilder } from "../slideKit";

const BUCKET_TABLE_SPAN = 4;

/** Port buckets beyond this rank (by totalAssigned, the bucket's own sort
 *  order from `computeDistributionModel`) fold into one remainder row. */
export const PORT_BUCKET_CAP = 8;

/** "أعلى مساهم: الاسم (العدد) — +N آخرون" line under a bucket's label. Empty
 *  string (no markup) when the bucket has no employees at all, so an empty
 *  bucket's cell doesn't carry a dangling empty `<div>`. */
function topEmployeeLine(b: DistributionBucket): string {
  if (b.employees.length === 0) return "";
  const [top, ...rest] = b.employees; // already sorted desc by assigned, ties → username asc
  const restNote =
    rest.length > 0
      ? ` <span class="v2-cov-emp-rest">+${fmtNum(rest.length)} آخرون</span>`
      : "";
  return `<div class="v2-cov-emp-line">أعلى مساهم: ${esc(top.displayName)} (${fmtNum(top.assigned)})${restNote}</div>`;
}

function bucketRow(b: DistributionBucket, i: number): string {
  return (
    `<tr><td><div class="v2-cov-bucket-name">${ledgerIdx(i)}${esc(b.label)}</div>${topEmployeeLine(b)}</td>` +
    `<td>${fmtNum(b.totalAssigned)}</td><td>${fmtNum(b.totalCompleted)}</td><td>${pctCell(b.completionRate)}</td></tr>`
  );
}

/** One folded remainder row — sums the folded buckets' own totals into the
 *  same columns a named row would show, never a hidden or dropped total. */
function foldedRow(folded: DistributionBucket[], rowIdx: number): string {
  const assigned = folded.reduce((s, b) => s + b.totalAssigned, 0);
  const completed = folded.reduce((s, b) => s + b.totalCompleted, 0);
  const rate = assigned > 0 ? (completed / assigned) * 100 : null;
  return (
    `<tr class="v2-cov-fold-row"><td><div class="v2-cov-bucket-name">${ledgerIdx(rowIdx)}الباقي (${fmtNum(folded.length)} منفذ)</div></td>` +
    `<td>${fmtNum(assigned)}</td><td>${fmtNum(completed)}</td><td>${pctCell(rate)}</td></tr>`
  );
}

function totalsRow(buckets: DistributionBucket[]): string {
  const assigned = buckets.reduce((s, b) => s + b.totalAssigned, 0);
  const completed = buckets.reduce((s, b) => s + b.totalCompleted, 0);
  const rate = assigned > 0 ? (completed / assigned) * 100 : null;
  return `<tr><td>الإجمالي</td><td>${fmtNum(assigned)}</td><td>${fmtNum(completed)}</td><td>${pctCell(rate)}</td></tr>`;
}

/** One bucket table card (stage or port). `cap === null` renders every
 *  bucket (safe for the ≤4 stage buckets); a numeric cap folds the tail. */
function bucketCard(title: string, buckets: DistributionBucket[], cap: number | null): string {
  const shown = cap !== null ? buckets.slice(0, cap) : buckets;
  const folded = cap !== null ? buckets.slice(cap) : [];
  const bodyRowsHtml =
    shown.map((b, i) => bucketRow(b, i)).join("") +
    (folded.length > 0 ? foldedRow(folded, shown.length) : "");
  return ledgerPortCard({
    title,
    theadCells: `<th>البند</th><th>المعيّنة</th><th>المكتملة</th><th>الإنجاز</th>`,
    bodyRowsHtml,
    totalsRowHtml: totalsRow(buckets),
    span: BUCKET_TABLE_SPAN,
    rowCount: 0,
    compact: false,
    extraClass: "cov-bucket",
    emptyText: "لا توجد بيانات توزيع بعد.",
  });
}

/** No distribution exists yet for the month — the honest empty state, same
 *  wording family as the document edition's `emptyState()` helper. Rendered
 *  instead of the two-panel layout so the deck still builds cleanly for a
 *  month that has only been sampled, never distributed. */
function emptyCoverageBody(): string {
  return `<div class="v2-cov-empty">
    <span class="v2-cov-empty-icon">${icon("layers", 24)}</span>
    <b>لا يوجد توزيع لهذا الشهر بعد</b>
    <p>يُبنى هذا القسم من بيانات تقرير التوزيع — وزّع العيّنة على الموظفين أولاً ليظهر هنا.</p>
  </div>`;
}

/**
 * Page: التغطية التشغيلية (R2 reuse) — per-stage and per-port assignment +
 * completion, each bucket naming its top contributing employee. Single
 * variant (`bodyVariants` repeats one body four times) — the same pattern
 * `monthInNumbersSlide` (slides.ts) already uses for a page whose content
 * doesn't warrant a full Ledger/Briefing/Grid fan-out.
 */
export function coverageSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const cov = model.distributionCoverage;
  const body =
    cov === null
      ? emptyCoverageBody()
      : `<div class="v2-cov-split">
      ${bucketCard("حسب المستوى", cov.byStage, null)}
      ${bucketCard("حسب المنفذ", cov.byPort, PORT_BUCKET_CAP)}
    </div>`;
  return v2Slide({
    id: "slide-s4-coverage",
    title: "التغطية التشغيلية",
    eyebrow: "القسم 4 — التغطية والمساءلة التشغيلية",
    iconName: "layers",
    headline: "التغطية التشغيلية",
    subhead:
      "توزيع العيّنة وإنجازها حسب المستوى والمنفذ، مع أعلى مساهم لكل بند — من تقرير التوزيع (R2)، بلا إعادة احتساب.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section4",
  });
}

export function coverageSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  return [(num, total) => coverageSlide(model, num, total, variantPreview)];
}

export const COVERAGE_CSS = `
/* ── القسم 4 · التغطية التشغيلية ──────────────────────────────────────────── */
.v2-cov-split{display:grid;grid-template-columns:1fr 1fr;gap:14px;height:100%;min-height:0;}
.v2-cov-split .v2-lg-port-card{height:100%;min-height:0;overflow:auto;}
.v2-cov-split .v2-lg-port-card.cov-bucket .deck-table td:first-child{text-align:right;}
.v2-cov-bucket-name{display:flex;align-items:center;gap:6px;font-weight:800;}
.v2-cov-emp-line{
  margin-top:2px;font-size:.62rem;font-weight:700;color:var(--slate);
  text-align:right;line-height:1.5;
}
.v2-cov-emp-rest{color:var(--gold);font-weight:800;}
.v2-cov-fold-row td{color:var(--slate);font-style:italic;}
.v2-cov-fold-row .v2-cov-bucket-name{font-weight:700;}

.v2-cov-empty{
  display:flex;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;
  gap:9px;text-align:center;padding:20px 18px;
  border:1px dashed rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.02);
}
.v2-cov-empty-icon{display:inline-flex;color:var(--gold);opacity:.75;}
.v2-cov-empty-icon svg{display:block;}
.v2-cov-empty b{font-size:.95rem;font-weight:900;color:rgba(255,255,255,.96);}
.v2-cov-empty p{margin:0;max-width:62ch;font-size:.74rem;line-height:1.65;color:var(--slate);}

body.theme-light .v2-cov-emp-line{color:#607386;}
body.theme-light .v2-cov-fold-row td{color:#607386;}
body.theme-light .v2-cov-empty b{color:rgba(10,45,74,.95);}
body.theme-light .v2-cov-empty{border-color:rgba(10,45,74,.2);background:rgba(10,45,74,.02);}

@media screen and (max-width:900px){
  .v2-cov-split{grid-template-columns:1fr;}
}
@media print{
  .v2-cov-split .v2-lg-port-card{break-inside:avoid;}
}
`;
