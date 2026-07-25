// Executive deck v2 — القسم 3, page: توافق النتائج بين المستويات والمصادر.
//
// The OVERALL (month-wide) source-agreement page. It answers one question:
// how often do our two X-ray inspection levels agree with each other, with the
// other inspection sources, and with the study reviewer?
//
// ─── Zero new math ──────────────────────────────────────────────────────────
// Every number here is read straight off `model.resultComparison`, which
// `model/aggregates.ts` already computed and tested:
//   • `crossTeamMatrix` — the C(6,2)=15 source-pair cells
//   • `reviewerAgreement` — one row per non-reviewer source, vs the reviewer
// `agreementRate` arrives already `null` whenever `comparable === 0`, so a
// zero-denominator can never surface as a fake 0%.
//
// ─── Two facts this page must never misrepresent ────────────────────────────
// 1. «المستوى الأول» / «المستوى الثاني» here are the two X-RAY INSPECTION
//    LEVELS — a completely different axis from the four RISK levels (which are
//    categorical detection scenarios, NOT a severity ranking). No severity
//    language appears anywhere on this page, and the footnote says so outright.
// 2. THE COMPARISON SCOPE IS ASYMMETRIC. Pairs that do not involve `review`
//    are computed over the whole month's population; pairs that DO involve
//    `review` cover only the studied sample, because the reviewer answers
//    sampled images only. `SCOPE_FOOTNOTE` states this verbatim on the slide —
//    it is a correctness requirement, not decoration.
//
// ─── Honesty discipline (shared across all six section-3 pages) ─────────────
//   • every rate goes through `rateOf`/the already-null `agreementRate`, and
//     is additionally GATED on `isRankable(band(comparable))` — below the
//     sufficiency cut the cell renders the muted "—", never a number that
//     invites a ranking the data cannot support
//   • `n` is always printed (see the ن grid + the ن column)
//   • status is never conveyed by colour alone (`threshCell` adds a glyph)
//   • every interpolated string routes through `esc()`
//
// ─── Why `n` sits in its own grid rather than inside the heatmap cells ──────
// `percentHeatmap` (ui/analyticsCharts.ts) is the shared, already-tested
// primitive this page is required to use, and its cell text is by contract the
// percentage alone — it has no per-cell annotation hook, and that module is
// owned/edited elsewhere. So the pair counts are disclosed directly beneath the
// matrix in `.s3sa-ngrid`, a triangle with the SAME 1..6 source numbering the
// matrix axes use, so every suppressed ("—") cell still has a visible ن one
// glance away. Counts, unlike rates, are printed even at 0 — a zero count is a
// true observation, not a missing measurement.

import type { CrossTeamMatrixCell, ReviewerAgreementRow } from "../../model/aggregates";
import type { ResultSource } from "../../model/decisionFactTable";
import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import { percentHeatmap } from "../../ui/analyticsCharts";
import type { HeatMatrix } from "../../ui/analyticsCharts";
import { ACCURACY_TARGET, barCell, fillerRow, maxOf, pctCell, rateOf, threshCell, v2Slide } from "../slideKit";
import type { CellTone } from "../slideKit";

// ── Page copy ───────────────────────────────────────────────────────────────

const TITLE = "توافق النتائج بين المستويات والمصادر";
const SUBHEAD = "نسبة تطابق النتيجة بين كل مصدرين، ومقارنة كل مصدر بنتيجة المراجع.";
const EYEBROW = "القسم 3 — التحاليل المتقدمة";

/** Required verbatim on the slide — the asymmetric-scope disclosure. */
const SCOPE_FOOTNOTE =
  "المقارنات التي تشمل «المراجع» تقتصر على صور العيّنة المدروسة؛ وما عداها يشمل مجتمع الشهر كاملًا.";

/** Guards fact #1: these are inspection levels, not a risk-severity ranking. */
const LEVEL_FOOTNOTE =
  "«المستوى الأول» و«المستوى الثاني» هنا هما مستويا فحص الأشعة، وليسا مستويات المخاطر الأربعة.";

/**
 * The six comparison sources, in the SAME order `aggregates.ts` builds the
 * matrix in. Order is load-bearing twice over: it fixes the matrix axes (so
 * output is deterministic) and it defines the 1..6 numbering the axis labels
 * and the ن grid share.
 */
const SOURCE_ORDER: readonly ResultSource[] = [
  "levelOne",
  "levelTwo",
  "manual",
  "opposite",
  "liveMeans",
  "review",
] as const;

/** Confirmed by the report owner as the source workbook's own column names. */
const SOURCE_LABELS: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "التفتيش اليدوي",
  opposite: "التفتيش المعاكس",
  liveMeans: "الوسائل الحية",
  review: "المراجع (المعيار)",
};

// ── Shared gating ───────────────────────────────────────────────────────────

/**
 * The single sufficiency gate for this page: a rate is shown only when its own
 * comparable count is rankable (`limited` or `sufficient`). Below the cut the
 * caller renders the muted "—" — the count itself is still printed elsewhere.
 */
function gatedRate(comparable: number, agreementRate: number | null): number | null {
  return isRankable(band(comparable)) ? agreementRate : null;
}

function pairKey(a: ResultSource, b: ResultSource): string {
  return `${a}|${b}`;
}

/** `crossTeamMatrix` is a flat 15-cell list; index it for O(1) lookup. */
function indexPairs(cells: CrossTeamMatrixCell[]): Map<string, CrossTeamMatrixCell> {
  const map = new Map<string, CrossTeamMatrixCell>();
  for (const cell of cells) map.set(pairKey(cell.sourceA, cell.sourceB), cell);
  return map;
}

/** The pair cell for (row source, column source), regardless of which side
 *  `aggregates.ts` stored as `sourceA` — the relation is symmetric. */
function pairAt(
  index: Map<string, CrossTeamMatrixCell>,
  a: ResultSource,
  b: ResultSource,
): CrossTeamMatrixCell | undefined {
  return index.get(pairKey(a, b)) ?? index.get(pairKey(b, a));
}

// ── Left card — the 6×6 agreement matrix ────────────────────────────────────

/**
 * 6×6 matrix, LOWER TRIANGLE ONLY: cell (row ri, col ci) is populated when
 * `ci < ri`, so each of the 15 pairs appears exactly once and the diagonal
 * (a source against itself, always trivially 100%) is blank. The upper
 * triangle and diagonal pass `null`, which `percentHeatmap` renders as its
 * dashed "—" placeholder.
 *
 * Column labels are the source NUMBER (1..6); the full Arabic name lives on
 * the row header carrying the same number. Six full Arabic labels across the
 * top would collide at this card width, and a correlation-style numeric axis
 * keyed to the named rows is both readable and unambiguous.
 */
function buildHeatMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: SOURCE_ORDER.map((source, i) => `${SOURCE_LABELS[source]} (${i + 1})`),
    cols: SOURCE_ORDER.map((_, i) => String(i + 1)),
    values: SOURCE_ORDER.map((rowSource, ri) =>
      SOURCE_ORDER.map((colSource, ci) => {
        if (ci >= ri) return null; // diagonal + mirrored upper half
        const cell = pairAt(index, colSource, rowSource);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}

/**
 * The ن companion to the matrix: the same lower triangle, same 1..6 numbering,
 * carrying `comparable` for every pair — including the pairs whose rate the
 * sufficiency gate suppressed. Structurally-empty lines (row 1 and column 6
 * hold no pairs) are omitted rather than rendered as blank filler.
 */
function comparableGrid(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const colSources = SOURCE_ORDER.slice(0, -1); // 1..5
  const rowSources = SOURCE_ORDER.slice(1); // 2..6

  const head = `<tr><th class="s3sa-void" scope="col"></th>${colSources
    .map((_, ci) => `<th scope="col">${ci + 1}</th>`)
    .join("")}</tr>`;

  const bodyRows = rowSources
    .map((rowSource, k) => {
      const ri = k + 1;
      const tds = colSources
        .map((colSource, ci) => {
          if (ci >= ri) return `<td class="s3sa-void"></td>`;
          const cell = pairAt(index, colSource, rowSource);
          return `<td>${fmtNum(cell ? cell.comparable : 0)}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${ri + 1}</th>${tds}</tr>`;
    })
    .join("");

  return `<table class="s3sa-ngrid">
    <caption>${esc("عدد الصور القابلة للمقارنة (العيّنة) لكل زوج — بترقيم المصادر نفسه أعلاه")}</caption>
    <thead>${head}</thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function matrixCard(cells: CrossTeamMatrixCell[]): string {
  const heat = percentHeatmap(buildHeatMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 140,
    caption: "مصفوفة التوافق بين المصادر",
    rowHeader: "المصدر",
    // Polarity: stronger tint = higher agreement.
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  return `<div class="v2-port-col summary s3sa-col">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${icon("scan", 18)}</span>
      <div><b>${esc("مصفوفة التوافق بين المصادر")}</b><span>${esc(
        `${fmtNum(cells.length)} زوجًا · المصفوفة متماثلة، يُعرض النصف السفلي فقط`,
      )}</span></div>
    </div>
    <div class="s3sa-body">
      <div class="s3sa-chart">${heat}</div>
      ${comparableGrid(cells)}
    </div>
  </div>`;
}

// ── Right card — every source against the reviewer ──────────────────────────

/** A count cell with a proportional bar, scaled against the shared column max. */
function countCell(value: number, max: number, tone: CellTone): string {
  return barCell(fmtNum(value), (value / max) * 100, tone);
}

function reviewerCard(rows: ReviewerAgreementRow[]): string {
  const flagged = rows.map((r) => r.teamFlaggedReviewerClean);
  const cleared = rows.map((r) => r.teamClearedReviewerFlagged);
  // One shared scale across BOTH disagreement columns: they are two halves of
  // the same disagreement total, so independent scales would misrepresent
  // which of the two dominates.
  const barMax = maxOf([...flagged, ...cleared]);

  const totalComparable = rows.reduce((s, r) => s + r.comparable, 0);
  const totalAgree = rows.reduce((s, r) => s + r.agree, 0);
  const totalFlagged = flagged.reduce((s, v) => s + v, 0);
  const totalCleared = cleared.reduce((s, v) => s + v, 0);
  const totalRate = isRankable(band(totalComparable)) ? rateOf(totalAgree, totalComparable) : null;

  const trs = rows
    .map(
      (r) =>
        `<tr><td>${esc(SOURCE_LABELS[r.source])}</td>` +
        threshCell(gatedRate(r.comparable, r.agreementRate), ACCURACY_TARGET) +
        countCell(r.teamFlaggedReviewerClean, barMax, "gold") +
        countCell(r.teamClearedReviewerFlagged, barMax, "coral") +
        `<td>${fmtNum(r.comparable)}</td></tr>`,
    )
    .join("");

  return `<div class="v2-port-col summary s3sa-col s3sa-rev">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${icon("check", 18)}</span>
      <div><b>${esc("المقارنة بنتيجة المراجع")}</b><span>${esc(
        `التوافق العام ${fmtPct(totalRate)} · العيّنة ${fmtNum(totalComparable)}`,
      )}</span></div>
    </div>
    <table class="deck-table">
      <thead><tr>
        <th>${esc("المصدر")}</th>
        <th>${esc("التوافق مع المراجع")}</th>
        <th>${esc("اشتباه لديه / سليمة للمراجع")}</th>
        <th>${esc("سليمة لديه / اشتباه للمراجع")}</th>
        <th>${esc("العيّنة")}</th>
      </tr></thead>
      <tbody>${trs}${fillerRow(5, rows.length)}</tbody>
      <tfoot><tr>
        <td>${esc("الإجمالي")}</td>
        <td>${pctCell(totalRate)}</td>
        <td>${fmtNum(totalFlagged)}</td>
        <td>${fmtNum(totalCleared)}</td>
        <td>${fmtNum(totalComparable)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

// ── Page body ───────────────────────────────────────────────────────────────

function scopeNotes(): string {
  return `<div class="s3sa-foot">
    <p><span class="s3sa-foot-icon" aria-hidden="true">${icon("alert", 11)}</span>${esc(SCOPE_FOOTNOTE)}</p>
    <p>${esc(LEVEL_FOOTNOTE)}</p>
  </div>`;
}

function pageBody(model: ReportModel): string {
  return `<div class="s3sa">
    <div class="v2-port-split s3sa-split">
      ${matrixCard(model.resultComparison.crossTeamMatrix)}
      ${reviewerCard(model.resultComparison.reviewerAgreement)}
    </div>
    ${scopeNotes()}
  </div>`;
}

/**
 * The overall source-agreement page. Pure: no `Date`, no `Math.random`, no I/O
 * — the same model always produces byte-identical HTML.
 */
export function sourceAgreementSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const body = pageBody(model);
  return v2Slide({
    id: "slide-s3-source-agreement",
    title: TITLE,
    eyebrow: EYEBROW,
    iconName: "scan",
    headline: TITLE,
    subhead: SUBHEAD,
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS. Everything reusable (`.v2-port-split`, `.v2-port-col`,
 * `.deck-table`, `.v2-bar-cell`, `.insuff`) is composed from the deck theme;
 * only the three things that do not exist there are defined here — the
 * body/footnote stack, the chart box, and the ن grid.
 *
 * No raw hex literals: colours are theme tokens, `currentColor` blends
 * (`color-mix`, safe — this app is Chromium-only), or rgba white/black veils,
 * matching the conventions already in deck2/theme.ts. `currentColor` blends in
 * particular keep the ن grid legible under `body.theme-light`, which re-colors
 * `.slide` but deliberately does NOT remap the base ink variables.
 */
export const SOURCE_AGREEMENT_CSS = `
/* ── Section 3 · source-agreement page ─────────────────────────────────────── */
.s3sa{display:flex;flex-direction:column;gap:9px;height:100%;min-height:0;}
/* Wider left column: the matrix carries 15 values, the reviewer table 5 rows. */
.s3sa-split{grid-template-columns:1.15fr .85fr;gap:16px;flex:1;min-height:0;height:auto;}
.s3sa-col{background:linear-gradient(180deg,rgba(14,50,84,.55),rgba(7,32,58,.68));}
.s3sa-col .v2-port-col-head .v2-port-col-icon{
  color:var(--gold);border-color:rgba(244,180,0,.4);background:rgba(244,180,0,.1);
}
.s3sa-rev .v2-port-col-head .v2-port-col-icon{
  color:var(--blue);border-color:rgba(107,169,248,.4);background:rgba(107,169,248,.1);
}
.s3sa-rev .deck-table th{font-size:0.62rem;white-space:normal;line-height:1.25;}
.s3sa-body{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0;padding:7px 9px 9px;}
/* The heatmap figure is width/height:100% of this box and letterboxes itself
   via preserveAspectRatio, so the box may flex freely — never a fixed width. */
.s3sa-chart{flex:1;min-height:0;}
.s3sa-chart figure{height:100%;}

/* ── ن grid: the pair counts behind every matrix cell, gate-suppressed or not ─ */
.s3sa-ngrid{
  width:100%;border-collapse:collapse;table-layout:fixed;flex-shrink:0;
  font-size:0.56rem;font-variant-numeric:tabular-nums;
}
.s3sa-ngrid caption{
  caption-side:top;text-align:center;font-size:0.55rem;font-weight:600;
  color:var(--muted);padding-bottom:3px;line-height:1.3;
}
.s3sa-ngrid th,.s3sa-ngrid td{
  padding:1.5px 2px;text-align:center;
  border:1px solid color-mix(in srgb,currentColor 15%,transparent);
}
.s3sa-ngrid th{font-weight:800;background:color-mix(in srgb,currentColor 8%,transparent);}
.s3sa-ngrid td.s3sa-void,.s3sa-ngrid th.s3sa-void{border-color:transparent;background:none;}

/* ── Scope + level-axis footnotes (both are correctness statements) ────────── */
.s3sa-foot{
  flex-shrink:0;display:flex;flex-direction:column;gap:1px;
  padding:6px 10px;border-radius:10px;
  border:1px solid color-mix(in srgb,var(--gold) 34%,transparent);
  background:color-mix(in srgb,var(--gold) 8%,transparent);
}
.s3sa-foot p{margin:0;font-size:0.6rem;font-weight:600;line-height:1.45;}
.s3sa-foot-icon{display:inline-flex;vertical-align:-1px;margin-inline-end:4px;color:var(--gold);}

@media screen and (max-width:820px){
  .s3sa{height:auto;}
  .s3sa-split{grid-template-columns:1fr;grid-template-rows:auto;height:auto;}
  .s3sa-chart{min-height:280px;}
}
@media print{
  .s3sa-foot,.s3sa-ngrid{break-inside:avoid;}
  .s3sa-foot{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`;
