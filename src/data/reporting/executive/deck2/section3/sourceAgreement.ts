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
import { metricMatrix, percentHeatmap } from "../../ui/analyticsCharts";
import type { HeatMatrix } from "../../ui/analyticsCharts";
import {
  ACCURACY_TARGET,
  barCell,
  briefingLede,
  briefingRankList,
  briefingSupport,
  fillerRow,
  gridPanel,
  ledgerIdx,
  ledgerPortCard,
  maxOf,
  pctCell,
  rateOf,
  threshCell,
  v2Slide,
} from "../slideKit";
import type { BriefingRankItem, CellTone } from "../slideKit";

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
 * Why the pairs table (`pairsLedgerCard`) has NO totals row (2026-07-28
 * whole-branch-review fix, C6): the 6 sources form C(6,2)=15 pairs, and each
 * of the 6 sources therefore participates in 5 different pairs — so summing
 * `comparable` (or `agree`) across all 15 pair rows counts every comparable
 * image up to 5-10× over, producing a number many times the real population
 * and presenting it as if it were a genuine total. That directly violates
 * this file's own "two different bases must never be conflated" discipline
 * (see the file header). No single correct total exists for "sum of
 * pair-comparable-counts", so this note replaces the old (wrong) totals bar
 * instead of a `colspan` figure that would just be a different wrong number.
 * The reviewer table below it (`ledgerReviewerTable`) is NOT affected — its
 * 5 rows are 5 DISTINCT non-reviewer sources each compared once against the
 * reviewer, not overlapping pairs, so summing across those rows is a
 * legitimate pooled total and is left as-is.
 */
const PAIR_NO_TOTAL_NOTE =
  "لا يوجد إجمالي واحد صحيح لهذا الجدول: كل صورة تدخل في حتى 5 أزواج مقارنة، فجمع عمود العيّنة عبر الأزواج الخمسة عشر يُكرر عدّ الصور نفسها — لذلك لم يُعرض هنا.";

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

/**
 * The two rows of the default/Grid variants' levels×teams matrix — the
 * report's own primary inspection methods. `SOURCE_ORDER` above is still
 * used, unchanged, by the Ledger/Briefing variants (they still walk all 15
 * pairs); these two new groups exist only for the narrower chart.
 */
const LEVEL_SOURCES: readonly ResultSource[] = ["levelOne", "levelTwo"] as const;

/**
 * The three columns of the same chart — the OTHER inspection teams. `review`
 * is deliberately excluded: the reviewer card sitting next to this chart
 * already shows both levels vs. the reviewer, so repeating those two numbers
 * here would just duplicate information one glance away (design spec §5).
 * level-vs-level itself is also excluded — it isn't a "level vs team"
 * comparison, so it gets its own standalone stat (`levelPairStatHtml`)
 * instead of a grid cell.
 */
const TEAM_SOURCES: readonly ResultSource[] = ["manual", "opposite", "liveMeans"] as const;

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

// ── matrixCard's new levels × teams chart ────────────────────────────────────
//
// 2026-07-28 rework (owner feedback on the previously-shipped 6×6 heatmap:
// "the graph ... 123456 mean nothing and current page is hard to read"). See
// `docs/superpowers/specs/2026-07-28-deck2-source-agreement-levels-vs-teams-
// design.md` for the full rationale. The chart now answers the page's own
// stated question narrowly — how do the two X-ray levels compare against the
// other teams — instead of every one of the 15 possible source pairs. This is
// a genuine 2×3 RECTANGLE (rows ≠ columns), not a symmetric matrix, so there
// is no lower-triangle indexing, no mirrored half, and no numeric-axis
// tradeoff to document: 3 real Arabic column headers fit comfortably where 6
// didn't.
const MATRIX_TITLE = "توافق المستويين مع الفرق الأخرى";
const MATRIX_SUB = "مقارنة كل مستوى بالتفتيش اليدوي والمعاكس والوسائل الحية";

/**
 * The 2×3 chart data: rows are the two X-ray inspection levels, columns are
 * the other three inspection teams (`review` and level-vs-level are
 * deliberately excluded — see the `TEAM_SOURCES`/`LEVEL_SOURCES` doc comments
 * above). Each cell is read directly off `crossTeamMatrix`, gated by the same
 * sufficiency rule every other rate on this page uses.
 */
function buildLevelsTeamsMatrix(cells: CrossTeamMatrixCell[]): HeatMatrix {
  const index = indexPairs(cells);
  return {
    rows: LEVEL_SOURCES.map((s) => SOURCE_LABELS[s]),
    cols: TEAM_SOURCES.map((s) => SOURCE_LABELS[s]),
    values: LEVEL_SOURCES.map((level) =>
      TEAM_SOURCES.map((team) => {
        const cell = pairAt(index, level, team);
        return cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
      }),
    ),
  };
}

/**
 * The ن companion to `buildLevelsTeamsMatrix`: the same 2×3 shape, carrying
 * `comparable` for every cell, including cells the sufficiency gate
 * suppressed. `percentHeatmap`'s cell text is percentage-only by contract (it
 * has no per-cell annotation hook, and that module is owned/edited
 * elsewhere), so counts still need this separate table — simplified from the
 * previous triangular design since every (level, team) slot is a real,
 * non-mirrored comparison (no void cells needed except the blank top-left
 * corner).
 */
function levelsTeamsCountsTable(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const head = `<tr><th class="s3sa-void" scope="col"></th>${TEAM_SOURCES.map(
    (team) => `<th scope="col">${esc(SOURCE_LABELS[team])}</th>`,
  ).join("")}</tr>`;

  const bodyRows = LEVEL_SOURCES.map((level) => {
    const tds = TEAM_SOURCES.map((team) => {
      const cell = pairAt(index, level, team);
      return `<td>${fmtNum(cell ? cell.comparable : 0)}</td>`;
    }).join("");
    return `<tr><th scope="row">${esc(SOURCE_LABELS[level])}</th>${tds}</tr>`;
  }).join("");

  return `<table class="s3sa-ngrid">
    <caption>${esc("عدد الصور القابلة للمقارنة (العيّنة) لكل خلية")}</caption>
    <thead>${head}</thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

/**
 * The level1↔level2 agreement stat — a standalone callout, not a grid cell,
 * since it's a different comparison kind (level vs. level, not level vs.
 * team). Sits above the levels×teams grid on both the default and Grid
 * variants. Gated and counted with the exact same discipline as every other
 * rate on this page: "—" (not a fabricated number) below the sufficiency
 * cut, the comparable count always shown.
 */
function levelPairStatHtml(cells: CrossTeamMatrixCell[]): string {
  const index = indexPairs(cells);
  const cell = pairAt(index, "levelOne", "levelTwo");
  const rate = cell ? gatedRate(cell.comparable, cell.agreementRate) : null;
  const n = cell ? cell.comparable : 0;
  return `<div class="s3sa-lvl-stat">
    <span class="s3sa-lvl-stat-icon" aria-hidden="true">${icon("check", 14)}</span>
    <span>${esc("توافق المستوى الأول مع الثاني")} — <b>${pctCell(rate)}</b> · ${esc(`${fmtNum(n)} صورة`)}</span>
  </div>`;
}

function matrixCard(cells: CrossTeamMatrixCell[]): string {
  const heat = percentHeatmap(buildLevelsTeamsMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 110,
    caption: MATRIX_TITLE,
    rowHeader: "المستوى",
    // Polarity: stronger tint = higher agreement.
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  return `<div class="v2-port-col summary s3sa-col">
    <div class="v2-port-col-head">
      <span class="v2-port-col-icon">${icon("scan", 18)}</span>
      <div><b>${esc(MATRIX_TITLE)}</b><span>${esc(MATRIX_SUB)}</span></div>
    </div>
    <div class="s3sa-body">
      ${levelPairStatHtml(cells)}
      <div class="s3sa-chart">${heat}</div>
      ${levelsTeamsCountsTable(cells)}
    </div>
  </div>`;
}

// ── Right card — every source against the reviewer ──────────────────────────

/** A count cell with a proportional bar, scaled against the shared column max. */
function countCell(value: number, max: number, tone: CellTone): string {
  return barCell(fmtNum(value), (value / max) * 100, tone);
}

/**
 * The overall (pooled) reviewer-agreement figure — the single number every
 * new Briefing/Ledger/Grid slot below sources from, per the fan-out plan
 * ("lede = overall reviewer agreement rate (`totalRate` from `reviewerCard`)").
 * Extracted from `reviewerCard`'s own inline computation (2026-07-28) so the
 * slot-0 card, the new Ledger totals row, and the Briefing lede all read the
 * SAME pooled figure instead of three independent copies of this formula —
 * `reviewerCard` below calls this and renders identically to before the
 * extraction (same inputs, same formula, byte-identical output).
 */
type ReviewerTotals = {
  totalComparable: number;
  totalAgree: number;
  /** Pooled from summed counts, never averaged — null below the sufficiency cut. */
  totalRate: number | null;
  totalFlagged: number;
  totalCleared: number;
};

function reviewerTotals(rows: ReviewerAgreementRow[]): ReviewerTotals {
  const totalComparable = rows.reduce((s, r) => s + r.comparable, 0);
  const totalAgree = rows.reduce((s, r) => s + r.agree, 0);
  const totalFlagged = rows.reduce((s, r) => s + r.teamFlaggedReviewerClean, 0);
  const totalCleared = rows.reduce((s, r) => s + r.teamClearedReviewerFlagged, 0);
  const totalRate = isRankable(band(totalComparable)) ? rateOf(totalAgree, totalComparable) : null;
  return { totalComparable, totalAgree, totalRate, totalFlagged, totalCleared };
}

function reviewerCard(rows: ReviewerAgreementRow[]): string {
  const flagged = rows.map((r) => r.teamFlaggedReviewerClean);
  const cleared = rows.map((r) => r.teamClearedReviewerFlagged);
  // One shared scale across BOTH disagreement columns: they are two halves of
  // the same disagreement total, so independent scales would misrepresent
  // which of the two dominates.
  const barMax = maxOf([...flagged, ...cleared]);

  const { totalComparable, totalRate, totalFlagged, totalCleared } = reviewerTotals(rows);

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

// ════════════════════════════════════════════════════════════════════════════
// Ledger / Briefing / Grid fan-out (fan-out plan §11d, batch B3 item 2).
//
// All three slots below read the SAME two model collections slot 0 already
// reads (`crossTeamMatrix`, `reviewerAgreement`) — no new math, same honesty
// discipline documented at the top of this file (gate on `isRankable`, print
// `n` even at 0, never color-alone, `esc()` every interpolation).
// ════════════════════════════════════════════════════════════════════════════

const MUTED_CELL = `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;

/** One of the 15 unique source pairs, resolved against its real cross-team
 *  matrix cell. `a`/`b` are always `SOURCE_ORDER[ri]`/`SOURCE_ORDER[ci]` with
 *  `ci < ri`, so `a` is always the LATER source in `SOURCE_ORDER`. */
type SourcePair = { a: ResultSource; b: ResultSource; cell: CrossTeamMatrixCell };

/**
 * All 15 pairs, walked in the SAME row-major lower-triangle order
 * (row `ri` from 1..5, col `ci` from 0..ri-1) — one canonical, deterministic
 * pair order shared by the Ledger table and the Briefing rank list, tied to
 * `SOURCE_ORDER`'s own fixed sequence.
 * `buildCrossTeamMatrix` (model/aggregates.ts) always emits all 15 cells
 * regardless of data (comparable defaults to 0, never omitted), so `cell` is
 * expected to always resolve — the `if (cell)` guard is defensive only, not
 * an assumption that invariant can never change silently.
 */
function orderedPairs(cells: CrossTeamMatrixCell[]): SourcePair[] {
  const index = indexPairs(cells);
  const pairs: SourcePair[] = [];
  for (let ri = 1; ri < SOURCE_ORDER.length; ri++) {
    for (let ci = 0; ci < ri; ci++) {
      const a = SOURCE_ORDER[ri];
      const b = SOURCE_ORDER[ci];
      const cell = pairAt(index, a, b);
      if (cell) pairs.push({ a, b, cell });
    }
  }
  return pairs;
}

function pairLabel(p: SourcePair): string {
  return `${SOURCE_LABELS[p.a]} — ${SOURCE_LABELS[p.b]}`;
}

// ── Ledger (fan-out plan §11d) ───────────────────────────────────────────────
//
// Charts are banned in Ledger by contract, so the 15 source pairs are laid
// out as a table instead: الزوج | التوافق % | عدد الصور القابلة للمقارنة.
// The ن grid is DROPPED here only (plan: "Drop
// the ن grid in Ledger only — redundant once counts are a table column"); the
// pair table's own count column already carries that information.
//
// ── The 15-row budget risk, worked out (fan-out plan's own flagged risk) ────
// One packed 15-row column cannot fit here at ANY row size: even at
// `.v2-lg-port-card`'s COMPACT density (~25px/row, the figure the plan's own
// risk note cites) that's already 15 × 25 = 375px with zero room left for a
// thead. So this page splits the 15 pairs into two side-by-side SUB-columns
// (8 + 7) inside the one card sitting in the pairs slot of the outer
// `.v2-lg-split` (pairs-card | reviewer-card), per the plan's explicit
// fallback.
//
// Splitting alone was NOT enough, though — measured live in
// deck-preview.html (1120px slide width), the available height for
// `.v2-lg-split`'s content (everything above the mandatory footnote strip,
// which this page — unlike the exemplar — must always leave room for) is
// ~396px. Under the browser's own (non-`fixed`) column auto-sizing, الزوج's
// long "المصدر أ — المصدر ب" labels were starved of width and wrapped to up
// to 3 lines, pushing the pairs card to ~432px measured — 36px OVER budget,
// which didn't clip at the slide edge (nothing here uses `overflow:hidden`)
// but instead visually OVERLAPPED the footnote strip below it, a worse
// defect than a clean clip. Fixing the column widths — `table-layout:fixed`
// with explicit 60/22/18% widths (theme CSS below) so الزوج actually gets
// the room a 3-column ~240px sub-table can spare — cut real wrapping down to
// mostly 1–2 lines and measured pairsCardHeight dropped to ~290px, comfortably
// inside the ~396px budget (~106px slack). A synthetic worst case (every one
// of the 8 rows in a sub-column wraps to the full 2 lines the tightened
// column widths still allow) is 8 × 30px + a ~20px thead ≈ 260px for the
// tables alone, +title/totals/gaps (~60px) ≈ 320px — still under budget. See
// `sourceAgreement.test.ts`'s "15-row Ledger budget" describe block for the
// assertion that encodes this arithmetic instead of an eyeballed screenshot
// check, and this file's own `SOURCE_AGREEMENT_CSS` for the exact column
// widths this reasoning depends on staying in sync with.
const PAIR_COL_SPAN = 3;
/** First sub-column takes the ceiling half (8 of 15), second takes the rest
 *  (7) — see the budget note above. */
const PAIR_SPLIT_AT = Math.ceil(15 / 2);

function pairRowHtml(p: SourcePair, i: number): string {
  const rate = gatedRate(p.cell.comparable, p.cell.agreementRate);
  return (
    `<tr><td>${ledgerIdx(i)}${esc(pairLabel(p))}</td>` +
    (rate === null ? MUTED_CELL : threshCell(rate, ACCURACY_TARGET)) +
    `<td>${fmtNum(p.cell.comparable)}</td></tr>`
  );
}

function pairSubTable(chunk: SourcePair[], startIdx: number): string {
  const rows =
    chunk.length > 0
      ? chunk.map((p, i) => pairRowHtml(p, startIdx + i)).join("")
      : `<tr><td colspan="${PAIR_COL_SPAN}"><span class="insuff">—</span></td></tr>`;
  return `<table class="deck-table s3sa-lg-pair-table">
      <thead><tr><th>${esc("الزوج")}</th><th>${esc("التوافق %")}</th><th>${esc("العيّنة")}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * The Ledger pairs card: title + two side-by-side 8/7-row sub-tables (the
 * budget split above) + a `colspan`-style explanatory note in place of a
 * totals row.
 *
 * ⚠️ 2026-07-28 whole-branch-review fix (C6): this used to sum `comparable`
 * (and `agree`) across all 15 pairs and present it as "الإجمالي" — but since
 * each of the 6 sources appears in 5 different pairs, that sum counts every
 * comparable image up to 5-10× over (see `PAIR_NO_TOTAL_NOTE`'s doc comment
 * for the full reasoning). No single correct total exists for this specific
 * table, so none is shown — a `colspan` note explains why instead.
 */
function pairsLedgerCard(pairs: SourcePair[]): string {
  const colA = pairs.slice(0, PAIR_SPLIT_AT);
  const colB = pairs.slice(PAIR_SPLIT_AT);

  return `<div class="v2-lg-table-card s3sa-lg-pairs">
    <div class="v2-lg-table-card-title">${esc("التوافق بين كل زوج مصادر")}</div>
    <div class="s3sa-lg-pair-split">${pairSubTable(colA, 0)}${pairSubTable(colB, PAIR_SPLIT_AT)}</div>
    <div class="s3sa-lg-pair-totals">
      <span>${esc(PAIR_NO_TOTAL_NOTE)}</span>
    </div>
  </div>`;
}

/** Ledger reviewer table — same 5 rows/columns as `reviewerCard`, through the
 *  shared `ledgerPortCard` shell (P2) with an ordinal badge per row. */
function ledgerReviewerTable(rows: ReviewerAgreementRow[]): string {
  const flagged = rows.map((r) => r.teamFlaggedReviewerClean);
  const cleared = rows.map((r) => r.teamClearedReviewerFlagged);
  const barMax = maxOf([...flagged, ...cleared]);
  const { totalComparable, totalRate, totalFlagged, totalCleared } = reviewerTotals(rows);

  const trs = rows
    .map(
      (r, i) =>
        `<tr><td>${ledgerIdx(i)}${esc(SOURCE_LABELS[r.source])}</td>` +
        threshCell(gatedRate(r.comparable, r.agreementRate), ACCURACY_TARGET) +
        countCell(r.teamFlaggedReviewerClean, barMax, "gold") +
        countCell(r.teamClearedReviewerFlagged, barMax, "coral") +
        `<td>${fmtNum(r.comparable)}</td></tr>`,
    )
    .join("");

  const totalsRow =
    `<tr><td>${esc("الإجمالي")}</td>` +
    `<td>${pctCell(totalRate)}</td>` +
    `<td>${fmtNum(totalFlagged)}</td>` +
    `<td>${fmtNum(totalCleared)}</td>` +
    `<td>${fmtNum(totalComparable)}</td></tr>`;

  return ledgerPortCard({
    title: "المقارنة بنتيجة المراجع",
    theadCells:
      `<th>${esc("المصدر")}</th><th>${esc("التوافق مع المراجع")}</th>` +
      `<th>${esc("اشتباه لديه / سليمة للمراجع")}</th><th>${esc("سليمة لديه / اشتباه للمراجع")}</th><th>${esc("العيّنة")}</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: 5,
    rowCount: 0,
    compact: false,
  });
}

function ledgerBody(model: ReportModel): string {
  const pairs = orderedPairs(model.resultComparison.crossTeamMatrix);
  return `<div class="v2-sys-ledger s3sa-lg">
    <div class="v2-lg-split">
      ${pairsLedgerCard(pairs)}
      ${ledgerReviewerTable(model.resultComparison.reviewerAgreement)}
    </div>
    ${scopeNotes()}
  </div>`;
}

// ── Briefing (fan-out plan §11d) ─────────────────────────────────────────────
//
// The scope-disclosure basis text below deliberately reuses SCOPE_FOOTNOTE's
// own phrasing ("تقتصر على صور العيّنة المدروسة") rather than inventing new
// wording for the same fact, per the plan's instruction to keep the two
// consistent.
const REVIEWER_SCOPE_BASIS = "يقتصر التوافق مع المراجع على صور العيّنة المدروسة، لا مجتمع الشهر كاملًا";

function briefingBody(model: ReportModel): string {
  const pairs = orderedPairs(model.resultComparison.crossTeamMatrix);
  const totals = reviewerTotals(model.resultComparison.reviewerAgreement);

  const rankable = pairs.filter((p) => isRankable(band(p.cell.comparable)));
  const excluded = pairs.filter((p) => !isRankable(band(p.cell.comparable)));
  const comparedCount = pairs.filter((p) => p.cell.comparable > 0).length;

  // Highest/lowest agreement pair, among RANKABLE pairs only — a gate-
  // suppressed pair's rate is not shown anywhere on this page, so it cannot
  // honestly be crowned "highest" or "lowest" either.
  const sorted = [...rankable].sort((x, y) => (y.cell.agreementRate ?? 0) - (x.cell.agreementRate ?? 0));
  const highest = sorted.length > 0 ? sorted[0] : null;
  const lowest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const supportStrip = briefingSupport([
    {
      iconName: "check",
      value: highest ? pctCell(highest.cell.agreementRate) : "—",
      label: highest ? `أعلى زوج توافقًا: ${pairLabel(highest)}` : "أعلى زوج توافقًا",
    },
    {
      iconName: "alert",
      value: lowest ? pctCell(lowest.cell.agreementRate) : "—",
      label: lowest ? `أدنى زوج توافقًا: ${pairLabel(lowest)}` : "أدنى زوج توافقًا",
    },
    { iconName: "scan", value: fmtNum(comparedCount), label: "عدد الأزواج المقارَنة" },
  ]);

  // Rank rows: the rankable pairs sorted by agreement (already the intended
  // display order — briefingRankList never re-sorts), then gate-suppressed
  // pairs folded into one bar-less remainder (never a fabricated rate), same
  // pattern `briefingAgreementRank`/`briefingAccuracyRank` use elsewhere in
  // this deck.
  const rankItems: BriefingRankItem[] = sorted.map((p) => ({
    label: pairLabel(p),
    value: p.cell.agreementRate,
    valueText: pctCell(p.cell.agreementRate),
    secondaryText: `${fmtNum(p.cell.comparable)} صورة`,
  }));
  const rawForFold: Array<{ agree: number; comparable: number }> = sorted.map((p) => ({
    agree: p.cell.agree,
    comparable: p.cell.comparable,
  }));
  if (excluded.length > 0) {
    rankItems.push({
      label: `أزواج دون حد الكفاية (${fmtNum(excluded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
    });
    rawForFold.push({
      agree: excluded.reduce((s, p) => s + p.cell.agree, 0),
      comparable: excluded.reduce((s, p) => s + p.cell.comparable, 0),
    });
  }

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "green",
    scale: { kind: "fixed", max: 100 },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const foldedAgree = raw.reduce((s, r) => s + r.agree, 0);
      const foldedComparable = raw.reduce((s, r) => s + r.comparable, 0);
      const rate = rateOf(foldedAgree, foldedComparable);
      const isPureExclusion = excluded.length > 0 && folded.length === 1 && folded[0].value === null;
      return {
        label: isPureExclusion
          ? `أزواج دون حد الكفاية (${fmtNum(excluded.length)})`
          : `بقية الأزواج (${fmtNum(folded.length)})`,
        value: rate,
        valueText: pctCell(rate),
        secondaryText: foldedComparable > 0 ? `${fmtNum(foldedComparable)} صورة` : "",
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief s3sa-bf">
    ${briefingLede({
      figure: pctCell(totals.totalRate),
      tone: "green",
      label: `التوافق العام مع المراجع ${pctCell(totals.totalRate)} — ${fmtNum(totals.totalAgree)} من ${fmtNum(totals.totalComparable)} صورة`,
      basis: REVIEWER_SCOPE_BASIS,
    })}
    ${supportStrip}
    ${rankHtml}
    ${scopeNotes()}
  </div>`;
}

// ── Grid (fan-out plan §11d) ──────────────────────────────────────────────────
//
// The least work in the deck (plan's own framing): `percentHeatmap` already
// has a single genuine 0–100% scale, so it renders near-as-is, just promoted
// into the shared `gridPanel` wrapper for visual consistency with every other
// Grid page. The ن grid stays beneath it (unlike Ledger, which drops it).
// The reviewer table becomes a second `metricMatrix`, the two panels side by
// side via the shared `.v2-gd-split`.
function gridReviewerMatrix(rows: ReviewerAgreementRow[]): string {
  const flaggedMax = maxOf(rows.map((r) => r.teamFlaggedReviewerClean));
  const clearedMax = maxOf(rows.map((r) => r.teamClearedReviewerFlagged));
  const comparableMax = maxOf(rows.map((r) => r.comparable));
  return metricMatrix(
    {
      rowLabels: rows.map((r) => SOURCE_LABELS[r.source]),
      columns: [
        {
          label: "التوافق مع المراجع",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: rows.map((r) => gatedRate(r.comparable, r.agreementRate)),
        },
        {
          label: "اشتباه لديه–سليمة للمراجع",
          domain: [0, flaggedMax],
          ramp: "sequential-gold",
          values: rows.map((r) => r.teamFlaggedReviewerClean),
        },
        {
          label: "سليمة لديه–اشتباه للمراجع",
          domain: [0, clearedMax],
          ramp: "sequential-gold",
          values: rows.map((r) => r.teamClearedReviewerFlagged),
        },
        {
          label: "العيّنة",
          domain: [0, comparableMax],
          ramp: "sequential-gold",
          values: rows.map((r) => r.comparable),
        },
      ],
    },
    {
      width: 620,
      height: 320,
      caption: "مصفوفة المقارنة بنتيجة المراجع",
      rowHeader: "المصدر",
      emptyNote: "لا توجد بيانات",
    },
  );
}

function gridBody(model: ReportModel): string {
  const cells = model.resultComparison.crossTeamMatrix;
  const rows = model.resultComparison.reviewerAgreement;
  const totals = reviewerTotals(rows);

  const heat = percentHeatmap(buildLevelsTeamsMatrix(cells), {
    width: 620,
    height: 320,
    digits: 0,
    toneLow: "text",
    toneHigh: "primary",
    rowHeaderWidth: 110,
    caption: MATRIX_TITLE,
    rowHeader: "المستوى",
    legendHighLabel: "توافق أعلى",
    legendLowLabel: "توافق أقل",
    emptyNote: "لا توجد مقارنات متاحة",
  });

  const matrixPanel = gridPanel({
    title: MATRIX_TITLE,
    sub: MATRIX_SUB,
    variant: "matrix",
    chartHtml: `<div class="s3sa-gd-heat-wrap">${levelPairStatHtml(cells)}<div class="s3sa-chart">${heat}</div>${levelsTeamsCountsTable(cells)}</div>`,
  });

  const reviewerPanel = gridPanel({
    title: "المقارنة بنتيجة المراجع",
    sub: `التوافق العام ${fmtPct(totals.totalRate)} · العيّنة ${fmtNum(totals.totalComparable)}`,
    variant: "reviewer",
    chartHtml: gridReviewerMatrix(rows),
  });

  return `<div class="v2-sys-grid s3sa-gd">
    <div class="v2-gd-split">${matrixPanel}${reviewerPanel}</div>
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
  const ledgerBodyHtml = ledgerBody(model);
  const briefingBodyHtml = briefingBody(model);
  const gridBodyHtml = gridBody(model);
  return v2Slide({
    id: "slide-s3-source-agreement",
    title: TITLE,
    eyebrow: EYEBROW,
    iconName: "scan",
    headline: TITLE,
    subhead: SUBHEAD,
    bodyVariants: [body, ledgerBodyHtml, briefingBodyHtml, gridBodyHtml],
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

/* ── Level1↔Level2 stat callout — sits above the levels×teams grid, both the
   default and Grid variants (2026-07-28 rework, see the doc comment above
   buildLevelsTeamsMatrix). ──────────────────────────────────────────────── */
.s3sa-lvl-stat{
  display:flex;align-items:center;gap:6px;flex-shrink:0;
  padding:5px 9px;border-radius:8px;font-size:0.62rem;font-weight:700;
  border:1px solid color-mix(in srgb,var(--gold) 30%,transparent);
  background:color-mix(in srgb,var(--gold) 8%,transparent);
}
.s3sa-lvl-stat-icon{color:var(--gold);display:inline-flex;flex-shrink:0;}
.s3sa-lvl-stat b{font-weight:800;}

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
.s3sa-ngrid th.s3sa-void{border-color:transparent;background:none;}

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
  .s3sa-foot,.s3sa-ngrid,.s3sa-lvl-stat{break-inside:avoid;}
  .s3sa-foot,.s3sa-lvl-stat{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}

/* ── Ledger — 15-pair table (fan-out plan §11d, batch B3 item 2) ─────────────
   .v2-lg-table-card's own margin-top:14px (theme.ts) assumes it sits below a
   preceding headline block; here it's a grid CELL inside .v2-lg-split, so
   that top margin is cancelled. Everything else reuses .v2-lg-table-card's
   shared chrome (title style, card background) — only the 2-sub-column split
   and the pooled totals line are new, page-local shapes. */
/* .s3sa-lg is the DIRECT parent of both .v2-lg-split and the .s3sa-foot
   footnote strip (two children) — without this flex/min-height:0 chain,
   .v2-lg-split's own height:100% (theme.ts default) fills the WHOLE
   container on its own, and the footnote then adds its height on top,
   overflowing past the slide's bottom edge (measured live in
   deck-preview.html: the footnote's own bottom edge sat ~33px past the
   slide's — the pair table itself was never the problem). Mirrors the exact
   working pattern .v2-agree-wrap already uses for the same two-children
   shape on slide-s3-port-agreement (portAgreement.ts). */
.s3sa-lg{display:flex;flex-direction:column;gap:9px;height:100%;min-height:0;}
.s3sa-lg .v2-lg-split{flex:1 1 auto;min-height:0;height:auto;}
.s3sa-lg-pairs{margin-top:0;}
.s3sa-lg-pair-split{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;}
/* Row-budget note: see the pairsLedgerCard doc comment above (sourceAgreement.ts)
   for the worked arithmetic. table-layout:fixed + explicit column widths
   give الزوج's long "المصدر أ — المصدر ب" labels the most room a 3-column,
   ~240px-wide sub-table can spare (measured live in deck-preview.html: without
   this the browser's auto column sizing under-allocated the label column,
   causing 3-line wraps that pushed the whole card past its available flex
   budget and visually overlapped the footnote strip below it). */
.s3sa-lg-pairs .deck-table{table-layout:fixed;}
.s3sa-lg-pairs .deck-table th:first-child,.s3sa-lg-pairs .deck-table td:first-child{width:60%;}
.s3sa-lg-pairs .deck-table th:nth-child(2),.s3sa-lg-pairs .deck-table td:nth-child(2){width:22%;}
.s3sa-lg-pairs .deck-table th:nth-child(3),.s3sa-lg-pairs .deck-table td:nth-child(3){width:18%;}
.s3sa-lg-pairs .deck-table th,.s3sa-lg-pairs .deck-table td{
  padding:3px 2px;font-size:0.54rem;line-height:1.2;text-align:center;
  white-space:normal;overflow-wrap:anywhere;
}
.s3sa-lg-pairs .deck-table th:first-child,.s3sa-lg-pairs .deck-table td:first-child{text-align:right;}
.s3sa-lg-pairs .v2-lg-idx{width:13px;height:13px;font-size:.46rem;margin-inline-end:3px;}
/* 2026-07-28 fix (C6): this bar used to hold a 3-span الإجمالي row (label /
   rate / count); it now holds a single explanatory sentence (no honest total
   exists for this table — see PAIR_NO_TOTAL_NOTE), so weight/line-height are
   tuned for prose instead of a bold single-line figure. */
.s3sa-lg-pair-totals{
  display:flex;align-items:center;gap:8px;margin-top:8px;
  padding:6px 10px;border-radius:8px;font-size:0.6rem;font-weight:600;line-height:1.4;
  color:rgba(255,255,255,.72);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);
}
body.theme-light .s3sa-lg-pair-totals{
  color:rgba(10,45,74,.92);background:rgba(10,45,74,.05);border-color:rgba(10,45,74,.15);
}

/* ── Briefing — namespacing hook only (design spec §3.1); nothing bespoke
   beyond the shared lede/support/rank-list components. ──────────────────── */
.s3sa-bf{height:100%;}

/* ── Grid — the heatmap panel stacks its chart above the ن grid inside one
   gridPanel chart slot, reusing the already-shared .s3sa-chart/.s3sa-ngrid
   sizing rules above (both are plain global class names, not scoped under
   .s3sa, so they apply here unchanged). ─────────────────────────────────── */
/* Same two-children (.v2-gd-split + .s3sa-foot) flex fix as .s3sa-lg above. */
.s3sa-gd{display:flex;flex-direction:column;gap:9px;height:100%;min-height:0;}
.s3sa-gd .v2-gd-split{flex:1 1 auto;min-height:0;height:auto;}
.s3sa-gd-heat-wrap{display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;}

@media screen and (max-width:820px){
  .s3sa-lg-pair-split{grid-template-columns:1fr;}
}
@media print{
  .s3sa-lg-pair-totals{break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`;
