// Executive deck v2 — القسم 3 · صفحة: أثر وجود التحديد على الدقة.
//
// Answers ONE question: do sampled images that carry a تحديد (a marking drawn
// by the inspecting team) end up with more or less accurate decisions than
// images that carry none?
//
// ── Grain: IMAGE, not decision ──────────────────────────────────────────────
// This page folds `model.rows` (one row per population image), NOT
// `model.factTable` (one record per L1/L2 decision). `hasMarking` is a property
// of the IMAGE: the two decision records belonging to one image always carry
// the same value. Folding at decision grain would therefore count each
// perfectly-correlated observation twice and inflate every `n` by exactly 2×,
// which would in turn make the sufficiency gate (`isRankable(band(n))`) pass on
// half the real evidence. Image grain is the only honest denominator here.
//
// ── Enum note ───────────────────────────────────────────────────────────────
// `ExecutiveReportRow.verificationCategory` uses "excess-suspicious" for the
// false-alarm class; `DecisionRecord.outcomeClass` (the fact table) calls the
// same idea "false-suspicion". They are DIFFERENT enums over different grains —
// this module only ever reads the row enum.
//
// ── Honesty ─────────────────────────────────────────────────────────────────
// The two arms are not equivalent populations (markings are not assigned at
// random — they are drawn where an inspector already saw something). The page
// therefore always carries the descriptive-comparison caveat and NEVER words
// the difference as "marking improves accuracy". The difference figure itself
// is suppressed outright unless BOTH arms clear the data-sufficiency cut.
//
// ── Three-system fan-out (2026-07-25 plan §11e, batch B3 item 3) ────────────
// Ledger/Briefing/Grid all share ONE gate for "is the difference safe to
// publish" — `comparable()` below — so slot 0's `deltaChip`, the Ledger
// table's tfoot الفارق row, and the Briefing lede's fallback can never
// silently disagree about whether a comparison is honest. They likewise share
// ONE definition of "this outcome class's share of an arm's own n" —
// `outcomeShare()` — so `outcomeBar`'s composition bars, the Ledger table's
// count-cell backgrounds, and the Grid matrix's share columns can never
// quietly compute the same idea three different ways.

import type { ExecutiveReportRow } from "../../../executiveReportTypes";
import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import { metricMatrix } from "../../ui/analyticsCharts";
import {
  barCell,
  briefingLede,
  briefingRankList,
  briefingSupport,
  gridPanel,
  ledgerIdx,
  ledgerPortCard,
  pctCell,
  qualCell,
  rateOf,
  v2Slide,
} from "../slideKit";
import type { BriefingRankItem, CellTone } from "../slideKit";

/** Shown whenever a comparison is asked for but the evidence can't support it. */
const INSUFFICIENT_NOTE = "بيانات غير كافية للمقارنة";

/** Non-negotiable caveat: the two arms are self-selected, not randomised. */
const CAUSAL_CAVEAT = "مقارنة وصفية بين مجموعتين غير متكافئتين؛ لا تُثبت أثرًا سببيًا للتحديد.";

/** The four verification outcome classes, in the fixed order/tone/label the
 *  rest of the report already uses for this legend (document/frontMatter.ts). */
const OUTCOME_CLASSES: Array<{ key: keyof MarkStratum["outcomes"]; label: string; tone: CellTone }> = [
  { key: "correctClean", label: "سليمة صحيحة", tone: "green" },
  { key: "correctSusp", label: "اشتباه صحيح", tone: "blue" },
  { key: "missedSusp", label: "اشتباه فائت", tone: "coral" },
  { key: "falseSusp", label: "اشتباه خاطئ", tone: "gold" },
];

type MarkStratum = {
  /** Group heading (يوجد تحديد / لا يوجد تحديد). */
  label: string;
  /** One-line clarification of what the group contains. */
  caption: string;
  tone: "green" | "coral";
  /** Evaluated images in this arm — always printed, never gated. */
  n: number;
  accurate: number;
  outcomes: { correctClean: number; correctSusp: number; missedSusp: number; falseSusp: number };
  /** Whether the arm clears the sufficiency cut (band `limited`/`sufficient`). */
  rankable: boolean;
  /** Accuracy %, or null when the arm is empty OR below the sufficiency cut. */
  accuracy: number | null;
  /** Suspicion-detection %, gated identically. */
  detection: number | null;
};

/** Fold one arm's rows into its tally. Every rate goes through `rateOf`, so a
 *  zero denominator yields null (rendered "—") instead of a fabricated 0%, and
 *  every rate is additionally gated on the arm being rankable. */
function foldStratum(
  rows: ExecutiveReportRow[],
  label: string,
  caption: string,
  tone: "green" | "coral",
): MarkStratum {
  const outcomes = { correctClean: 0, correctSusp: 0, missedSusp: 0, falseSusp: 0 };
  let accurate = 0;
  for (const r of rows) {
    if (r.imageResultAccurate === true) accurate += 1;
    switch (r.verificationCategory) {
      case "correct-clean":
        outcomes.correctClean += 1;
        break;
      case "correct-suspicious":
        outcomes.correctSusp += 1;
        break;
      case "missed-suspicious":
        outcomes.missedSusp += 1;
        break;
      case "excess-suspicious":
        outcomes.falseSusp += 1;
        break;
      default:
        break;
    }
  }
  const n = rows.length;
  const rankable = isRankable(band(n));
  return {
    label,
    caption,
    tone,
    n,
    accurate,
    outcomes,
    rankable,
    accuracy: rankable ? rateOf(accurate, n) : null,
    detection: rankable ? rateOf(outcomes.correctSusp, outcomes.correctSusp + outcomes.missedSusp) : null,
  };
}

/**
 * Whether the two arms have an honest, comparable accuracy figure — the ONE
 * gate `deltaChip` (slot 0's chip), `ledgerMarkTable`'s tfoot الفارق row, and
 * `briefingMarkLedeAndRank`'s lede fallback all call, so none of the three can
 * silently drift onto a looser or stricter threshold than the others. There is
 * deliberately no "close enough" middle ground: a difference of two rates each
 * computed on <10 images is noise.
 */
function comparable(present: MarkStratum, absent: MarkStratum): boolean {
  return present.rankable && absent.rankable && present.accuracy !== null && absent.accuracy !== null;
}

/** يوجد تحديد accuracy − لا يوجد تحديد accuracy, in percentage points. Only
 *  meaningful after `comparable()` has returned true — callers must check
 *  that first. */
function effectOf(present: MarkStratum, absent: MarkStratum): number {
  return (present.accuracy ?? 0) - (absent.accuracy ?? 0);
}

/**
 * Share of arm `s`'s own n that outcome class `key` accounts for — null when
 * the arm is below the sufficiency cut (a 4-way split of too few images is not
 * a distribution). ONE definition of "share", shared by `outcomeBar`'s
 * composition-bar segments, `ledgerMarkTable`'s count-cell background bars,
 * and `gridMarkMatrix`'s share columns, so the three systems can never quietly
 * compute it three different ways.
 */
function outcomeShare(s: MarkStratum, key: keyof MarkStratum["outcomes"]): number | null {
  return s.rankable ? rateOf(s.outcomes[key], s.n) : null;
}

/**
 * Compact 180° accuracy dial, same geometry/idiom as the risk-stage tiles'
 * micro arc (low→high reads left→right, a physical gauge). Decorative only —
 * the percentage is printed as text right beside it — hence aria-hidden.
 */
function accuracyArc(pct: number): string {
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

/** One large comparison tile. `n` is always printed (in the head badge and the
 *  footer); the accuracy figure degrades to a muted "—" plus an explicit
 *  Arabic note when the arm is empty or below the sufficiency cut, so status is
 *  never carried by tone alone. */
function markTile(s: MarkStratum): string {
  const figure =
    s.accuracy === null
      ? `<b><span class="insuff">—</span></b><span>${esc(s.n === 0 ? "لا توجد صور مُقيَّمة" : INSUFFICIENT_NOTE)}</span>`
      : `<b>${fmtPct(s.accuracy)}</b><span>دقة قرارات الفحص</span>`;
  const arc = s.accuracy === null ? "" : accuracyArc(s.accuracy);
  return `<div class="v2-risk-tile ${s.tone}">
    <div class="v2-risk-tile-head">
      <span class="v2-mark-tile-icon">${icon("flag", 15)}</span>
      <span class="v2-risk-tile-titles"><b>${esc(s.label)}</b><small>${esc(s.caption)}</small></span>
      <span class="v2-risk-tile-share"><b>العيّنة ${fmtNum(s.n)}</b><small>صورة مُقيَّمة</small></span>
    </div>
    <div class="v2-risk-tile-main">
      <div class="v2-risk-tile-figure">${figure}</div>
      ${arc}
    </div>
    <div class="v2-risk-tile-foot">
      <span><b>${fmtNum(s.n)}</b><small>عدد الصور</small></span>
      <span class="accent"><b>${pctCell(s.detection)}</b><small>كشف الاشتباه</small></span>
    </div>
  </div>`;
}

/** Format the signed difference in percentage points. Rounds FIRST so a value
 *  like −0.04 can never render as the nonsensical "−0.0". */
function fmtEffect(effect: number): string {
  const rounded = Number(effect.toFixed(1));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * The centred الفارق chip that sits between the two tiles. Renders a figure
 * ONLY when both arms are rankable — otherwise it states, in words, that the
 * comparison cannot be made — via the shared `comparable()` gate (see that
 * function's doc comment).
 */
function deltaChip(present: MarkStratum, absent: MarkStratum): string {
  if (!comparable(present, absent)) {
    return `<div class="v2-mark-delta insufficient">
      <span class="v2-mark-delta-label">الفارق</span>
      <b class="v2-mark-delta-value"><span class="insuff">—</span></b>
      <span class="v2-mark-delta-note">${esc(INSUFFICIENT_NOTE)}</span>
    </div>`;
  }
  const effect = effectOf(present, absent);
  return `<div class="v2-mark-delta">
    <span class="v2-mark-delta-label">الفارق</span>
    <b class="v2-mark-delta-value"><span dir="ltr">${esc(fmtEffect(effect))}</span> نقطة مئوية</b>
    <span class="v2-mark-delta-note">${esc("يوجد تحديد − لا يوجد تحديد")}</span>
  </div>`;
}

/** One 100%-stacked composition bar for an arm, in the deck's shared
 *  `.v2-prop` vocabulary. Gated on rankability for the same reason the tile's
 *  accuracy is: a 4-way split of six images is not a distribution. */
function outcomeBar(s: MarkStratum): string {
  const head = `<div class="v2-mark-prop-head"><b>${esc(s.label)}</b><small>العيّنة ${fmtNum(s.n)}</small></div>`;
  if (!s.rankable) {
    const why = s.n === 0 ? "لا توجد صور مُقيَّمة" : INSUFFICIENT_NOTE;
    return `<div class="v2-prop v2-mark-prop">
      ${head}
      <div class="v2-prop-bar v2-mark-bar-empty"><span class="insuff">${esc(why)}</span></div>
    </div>`;
  }
  const segs = OUTCOME_CLASSES.map((c) => {
    const share = outcomeShare(s, c.key);
    if (share === null || share <= 0) return "";
    return `<div class="v2-prop-seg ${c.tone}" style="width:${share.toFixed(3)}%">${
      share >= 6 ? `<span class="v2-prop-seg-pct">${fmtPct(share, 0)}</span>` : ""
    }</div>`;
  }).join("");
  return `<div class="v2-prop v2-mark-prop">
    ${head}
    <div class="v2-prop-bar">${segs}</div>
  </div>`;
}

/** Shared four-key legend for both composition bars (class names only — the
 *  per-class counts differ per arm and are encoded in the bars themselves). */
function outcomeLegend(): string {
  const keys = OUTCOME_CLASSES.map(
    (c) => `<span class="v2-prop-key ${c.tone}"><i></i>${esc(c.label)}</span>`,
  ).join("");
  return `<div class="v2-prop-legend">${keys}</div>`;
}

/** Single honest empty state — shown when NO evaluated image carries a marking
 *  record at all (the usual cause is the template's «هل يوجد تحديد» field being
 *  absent or renamed, which makes `hasMarking` null on every row). Shared
 *  VERBATIM across all four design-system slots (fan-out plan's standing rule:
 *  "empty states are shared across all 4 slots"). */
function emptyState(): string {
  return `<div class="v2-mark-empty">
    <span class="v2-mark-empty-icon">${icon("flag", 24)}</span>
    <b>لا يوجد سجل لحالة التحديد في صور هذا الشهر</b>
    <p>لم تُسجَّل إجابة حقل «هل يوجد تحديد» على أي صورة مُقيَّمة، لذا تعذّرت المقارنة. تحقّق من وجود الحقل في نموذج الفحص المعتمد للشهر.</p>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// Ledger — one full-width table, rows = the two arms (fan-out plan §11e).
// ════════════════════════════════════════════════════════════════════════════

/** Column count: الفئة (ordinal folded in) | العيّنة | الدقة | كشف الاشتباه |
 *  the four outcome classes. */
const LEDGER_SPAN = 8;

/**
 * Ledger-system comparison table — rows = the two arms, ordinal folded into
 * الفئة's own `<td>` (the same "`ledgerIdx()` + label in one cell" convention
 * every port card in this fan-out uses). الدقة/كشف الاشتباه reuse `qualCell`
 * with the arm's OWN tone (green/coral — already this page's tone identity,
 * not a new colour introduced here). The four outcome columns print the RAW
 * COUNT — never gated, the same "n is always printed" discipline
 * `foldStratum`'s own tallies already follow — with a background bar sized to
 * `outcomeShare` purely as a cosmetic composition cue.
 *
 * The totals row POOLS raw counts across both arms — accuracy/detection are
 * recomputed from the SUMMED integer tallies, never averaged from the two
 * arms' own percentage figures (this codebase has shipped that exact
 * averaging bug before) — gated on the COMBINED n's OWN sufficiency band,
 * independent of either arm's individual gate: a small arm pooled with a
 * larger one can clear the cut even when neither alone does.
 *
 * The tfoot's SECOND row is «الفارق (يوجد − لا يوجد)», gated by the exact
 * SAME `comparable()` function `deltaChip` (slot 0) calls — not a parallel or
 * looser reimplementation, so this row and slot 0's chip can never disagree
 * about whether a difference is safe to publish.
 */
function ledgerMarkTable(present: MarkStratum, absent: MarkStratum, recorded: number): string {
  const arms: MarkStratum[] = [present, absent];
  const bodyRowsHtml = arms
    .map((s, i) => {
      const outcomeCells = OUTCOME_CLASSES.map((c) => {
        const share = outcomeShare(s, c.key);
        return barCell(fmtNum(s.outcomes[c.key]), share ?? 0, c.tone);
      }).join("");
      return (
        `<tr><td>${ledgerIdx(i)}${esc(s.label)}</td><td>${fmtNum(s.n)}</td>` +
        `${qualCell(s.accuracy, s.tone)}${qualCell(s.detection, s.tone)}${outcomeCells}</tr>`
      );
    })
    .join("");

  const combinedN = present.n + absent.n;
  const combinedRankable = isRankable(band(combinedN));
  const combinedAccuracy = combinedRankable ? rateOf(present.accurate + absent.accurate, combinedN) : null;
  const combinedCS = present.outcomes.correctSusp + absent.outcomes.correctSusp;
  const combinedMS = present.outcomes.missedSusp + absent.outcomes.missedSusp;
  const combinedDetection = combinedRankable ? rateOf(combinedCS, combinedCS + combinedMS) : null;
  const combinedCounts = OUTCOME_CLASSES.map((c) => present.outcomes[c.key] + absent.outcomes[c.key]);
  const totalsRow =
    `<tr><td>الإجمالي</td><td>${fmtNum(combinedN)}</td><td>${pctCell(combinedAccuracy)}</td><td>${pctCell(combinedDetection)}</td>` +
    combinedCounts.map((n) => `<td>${fmtNum(n)}</td>`).join("") +
    `</tr>`;

  const deltaFigure = comparable(present, absent)
    ? `<span dir="ltr">${esc(fmtEffect(effectOf(present, absent)))}</span>`
    : `<span class="insuff">—</span>`;
  const deltaRow =
    `<tr class="v2-lg-delta-row"><td>الفارق (يوجد − لا يوجد)</td><td>—</td><td>${deltaFigure}</td>` +
    `<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;

  return ledgerPortCard({
    title: `يوجد تحديد مقابل لا يوجد تحديد — ${fmtNum(recorded)} صورة لها سجل تحديد`,
    theadCells:
      `<th>الفئة</th><th>العيّنة</th><th>الدقة</th><th>كشف الاشتباه</th>` +
      `<th>سليمة صحيحة</th><th>اشتباه صحيح</th><th>اشتباه فائت</th><th>اشتباه خاطئ</th>`,
    bodyRowsHtml,
    totalsRowHtml: `${totalsRow}${deltaRow}`,
    span: LEDGER_SPAN,
    rowCount: 0,
    compact: false,
    extraClass: "mark-8col",
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Briefing — lede IS the الفارق figure; rank rows = the two arms.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Briefing-system lede + support strip + rank list. The lede is الفارق
 * itself — this page's literal point — via the SAME `comparable()` gate
 * `deltaChip`/the Ledger delta row use: not comparable renders the same "—"
 * + `INSUFFICIENT_NOTE` fallback, never a parallel/looser threshold. Rank
 * rows are the two arms on a FIXED 0–100 scale (never each other's magnitude
 * — a fixed scale is the only way "80%" reads the same bar width on every
 * page of this deck), per-row tone = that arm's OWN tone (green for يوجد
 * تحديد, coral for لا يوجد), never a re-derived pass/fail colour.
 *
 * `supportStrip` is slot 0's totals band, reused VERBATIM via `briefingSupport`
 * — passed in (not built here) so the caller can render the SAME markup as
 * its own hand-rolled `.v2-totals-band` div, byte-for-byte. Returns lede,
 * THEN support, THEN rank — the SAME order every other Briefing page in this
 * fan-out uses.
 *
 * ⚠️ 2026-07-28 whole-branch-review fix (B1): this used to return only
 * lede+rank, with the caller then appending the totals band AFTER (i.e.
 * lede → rank → support), the only 2 pages (this one and s3-quality) that
 * diverged from every other page's lede → support → rank order. Fixed by
 * threading the support strip through this function so it renders in the
 * right position.
 */
function briefingMarkLedeAndRank(present: MarkStratum, absent: MarkStratum, supportStrip: string): string {
  const isComparable = comparable(present, absent);
  const figure = isComparable
    ? `<span dir="ltr">${esc(fmtEffect(effectOf(present, absent)))}</span>`
    : `<span class="insuff">—</span>`;
  // The signed figure embedded in this Arabic sentence needs its OWN
  // dir="ltr" isolation, same as the standalone `figure` above — measured
  // 2026-07-28 (C4): a signed value sitting bare inside RTL prose renders
  // its sign on the WRONG SIDE of the digit (Unicode's bidi algorithm treats
  // "−20.0" as a weak numeric run with no strong LTR context to anchor it),
  // even though the exact same value correctly reads left-to-right when
  // wrapped, as `figure` already is.
  const label = isComparable
    ? `فارق الدقة <span dir="ltr">${esc(fmtEffect(effectOf(present, absent)))}</span> نقطة — بتحديد ${pctCell(present.accuracy)} مقابل بلا تحديد ${pctCell(absent.accuracy)}`
    : `فارق الدقة — ${esc(INSUFFICIENT_NOTE)}`;

  const rankItems: BriefingRankItem[] = [present, absent].map((s) => ({
    label: s.label,
    value: s.accuracy,
    valueText: pctCell(s.accuracy),
    secondaryText: `العيّنة ${fmtNum(s.n)} · كشف ${pctCell(s.detection)}`,
    tone: s.tone,
  }));

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "gold",
    scale: { kind: "fixed", max: 100 },
    // Never fires: exactly 2 named rows, always well inside briefingRankPlan's
    // smallest tier (cap 5) — required by the type contract only, same
    // unreachable-stub pattern `riskStagesBriefing` (slides.ts) uses.
    foldRemainder: (folded) => ({
      label: `بقية الفئات (${fmtNum(folded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
      rest: true,
    }),
  });

  return `${briefingLede({
    figure,
    tone: "gold",
    label,
    basis: "مقارنة وصفية بين مجموعتين غير متكافئتين",
  })}
    ${supportStrip}
    ${rankHtml}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Grid — one full-width matrix, rows = the two arms.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Grid-system outcome matrix — rows = the two arms, columns الدقة/كشف
 * الاشتباه plus the four outcome classes, ALL `sequential-gold` on a
 * `[0,100]` domain (a share is a share regardless of which figure it names —
 * no diverging polarity here, this is a side-by-side comparison, not a
 * pass/fail split). Every outcome-class value is that class's SHARE of the
 * arm's OWN n (`outcomeShare`, shared with `outcomeBar`/`ledgerMarkTable`
 * above) — never a raw count, since a `metricMatrix` column has one shared
 * domain and raw counts would need a `[0,max]` domain instead of `[0,100]`.
 * An unrankable arm's accuracy/detection are already null from `foldStratum`,
 * and `outcomeShare` is null too under the same `!s.rankable` check — so an
 * ungated arm's row is null across ALL SIX columns together, never a mix of
 * some real, some missing.
 */
function gridMarkMatrix(present: MarkStratum, absent: MarkStratum): string {
  const arms: MarkStratum[] = [present, absent];
  const shareColumn = (key: keyof MarkStratum["outcomes"]) => arms.map((s) => outcomeShare(s, key));
  const matrix = metricMatrix(
    {
      rowLabels: arms.map((s) => s.label),
      columns: [
        { label: "الدقة", domain: [0, 100], ramp: "sequential-gold", values: arms.map((s) => s.accuracy) },
        {
          label: "كشف الاشتباه",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: arms.map((s) => s.detection),
        },
        ...OUTCOME_CLASSES.map((c) => ({
          label: c.label,
          domain: [0, 100] as [number, number],
          ramp: "sequential-gold" as const,
          values: shareColumn(c.key),
        })),
      ],
    },
    {
      width: 1160,
      height: 260,
      caption: "مصفوفة أثر التحديد",
      rowHeader: "الفئة",
      emptyNote: "لا توجد بيانات",
    },
  );
  return gridPanel({
    title: "أثر التحديد على مخرجات الفحص",
    sub: `${fmtNum(present.n + absent.n)} صورة مُقيَّمة · النسب حصة من عيّنة كل فئة`,
    chartHtml: matrix,
  });
}

/**
 * Page: أثر وجود التحديد على الدقة.
 *
 * Pure — no Date, no Math.random, no I/O. Same input ⇒ byte-identical output.
 */
export function markingImpactSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  // Evaluated = the reviewer recorded a verdict for the image. Rows without a
  // verdict carry no accuracy signal at all and are out of scope for every
  // figure on this page (including the "no marking record" count).
  const evaluated = model.rows.filter((r) => r.verificationCategory !== null);
  const present = foldStratum(
    evaluated.filter((r) => r.hasMarking === true),
    "يوجد تحديد",
    "صور سُجّل عليها تحديد",
    "green",
  );
  const absent = foldStratum(
    evaluated.filter((r) => r.hasMarking === false),
    "لا يوجد تحديد",
    "صور لم يُسجّل عليها تحديد",
    "coral",
  );
  const unknown = evaluated.filter((r) => r.hasMarking === null).length;
  const recorded = present.n + absent.n;

  const compare = `<div class="v2-mark-compare">
      ${markTile(present)}
      ${deltaChip(present, absent)}
      ${markTile(absent)}
    </div>
    <div class="v2-mark-props">
      ${outcomeBar(present)}
      ${outcomeBar(absent)}
      ${outcomeLegend()}
    </div>`;

  // Mandatory prose — carries VERBATIM into all 4 slots (fan-out plan's
  // standing rule). Built once so every slot renders byte-identical markup.
  const caveat = `<div class="v2-mark-caveat">
    <span class="v2-mark-caveat-icon">${icon("alert", 13)}</span>
    <span>${esc(CAUSAL_CAVEAT)}</span>
  </div>`;

  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(evaluated.length)}</b><small>إجمالي الصور المُقيَّمة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("flag", 16)}</span><span><b>${fmtNum(recorded)}</b><small>صور لها سجل لحالة التحديد</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("document", 16)}</span><span><b>${fmtNum(unknown)}</b><small>صور بلا سجل لحالة التحديد</small></span></div>
  </div>`;

  // Same 3 stats as `totals` above, built through the shared `briefingSupport`
  // primitive so the Briefing slot renders IDENTICAL `.v2-totals-band` markup
  // in the right position (lede → support → rank, 2026-07-28 fix, B1) instead
  // of the hand-rolled div appended after the rank list.
  const supportStrip = briefingSupport([
    { iconName: "layers", value: fmtNum(evaluated.length), label: "إجمالي الصور المُقيَّمة" },
    { iconName: "flag", value: fmtNum(recorded), label: "صور لها سجل لحالة التحديد" },
    { iconName: "document", value: fmtNum(unknown), label: "صور بلا سجل لحالة التحديد" },
  ]);

  const body = `<div class="v2-risk-layout v2-mark-layout">
    ${recorded > 0 ? compare : emptyState()}
    ${caveat}
    ${totals}
  </div>`;

  // Ledger: table (or the shared empty state) + caveat. No totals band — the
  // table's own العيّنة column and totals row already carry that figure.
  const ledgerBody = `<div class="v2-sys-ledger v2-lg-marking">
    ${recorded > 0 ? ledgerMarkTable(present, absent, recorded) : emptyState()}
    ${caveat}
  </div>`;

  // Briefing: lede, then slot 0's totals band REUSED VERBATIM as the support
  // strip, then the rank list (or the shared empty state), then the caveat —
  // lede → support → rank, the SAME order every other Briefing page in this
  // fan-out uses (2026-07-28 whole-branch-review fix, B1 — this used to
  // render lede → rank → support instead).
  const briefingBody = `<div class="v2-sys-brief v2-bf-marking">
    ${recorded > 0 ? briefingMarkLedeAndRank(present, absent, supportStrip) : emptyState()}
    ${caveat}
  </div>`;

  // Grid: one full-width matrix (or the shared empty state), plus the totals
  // band AND the caveat both carried verbatim (unlike some other Grid pages
  // in this fan-out, this one keeps the totals band too — per the plan).
  const gridBody = `<div class="v2-sys-grid v2-gd-marking">
    ${recorded > 0 ? gridMarkMatrix(present, absent) : emptyState()}
    ${totals}
    ${caveat}
  </div>`;

  return v2Slide({
    id: "slide-s3-marking",
    title: "أثر وجود التحديد على الدقة",
    eyebrow: "القسم 3 — التحاليل المتقدمة",
    iconName: "flag",
    headline: "أثر وجود التحديد على الدقة",
    subhead: "مقارنة دقة القرارات في الصور التي يوجد بها تحديد مقابل التي لا يوجد بها.",
    bodyVariants: [body, ledgerBody, briefingBody, gridBody],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS. Everything is scoped under `.v2-mark-layout` (slot 0) or the
 * three new `.v2-lg-marking`/`.v2-bf-marking`/`.v2-gd-marking` hooks so it
 * cannot collide with the other section-3 pages built in parallel. Composed on
 * top of the deck's existing vocabulary (`.v2-risk-layout` / `.v2-risk-tile*` /
 * `.v2-prop*` / `.v2-totals-band` / `.v2-micro-arc` / `.insuff` /
 * `.v2-lg-port-card` / `.v2-sys-brief` / `.v2-sys-grid`) — these rules only add
 * what that vocabulary has no equivalent for. No raw hex literals; all colors
 * are theme tokens or alpha-composited neutrals, and every dimension is
 * relative so the page scales with the viewport (the 459×~1008 body budget is a
 * design width, not a fixed container).
 */
export const MARKING_IMPACT_CSS = `
/* ── القسم 3 · أثر وجود التحديد على الدقة ─────────────────────────────────── */
.v2-mark-layout{gap:11px;justify-content:stretch;}
/* .insuff is only styled inside .deck-table upstream; this page uses it outside
   tables, so give it the same muted treatment here. */
.v2-mark-layout .insuff{color:var(--slate);font-weight:800;}

/* Two comparison tiles with the الفارق chip centred between them. */
.v2-mark-compare{display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:12px;flex:1;min-height:0;}
.v2-mark-compare .v2-risk-tile{min-height:0;}
.v2-mark-compare .v2-risk-tile-figure b{font-size:1.9rem;}
.v2-mark-tile-icon{
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  width:27px;height:27px;border-radius:9px;color:var(--green);
  border:1.3px solid rgba(139,195,74,.38);background:rgba(139,195,74,.1);
}
.v2-risk-tile.coral .v2-mark-tile-icon{color:var(--coral);border-color:rgba(255,118,95,.38);background:rgba(255,118,95,.1);}
.v2-mark-compare .v2-risk-tile-share b{font-variant-numeric:tabular-nums;}

.v2-mark-delta{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  align-self:center;text-align:center;min-width:9.5em;max-width:16em;padding:12px 14px;
  border:1px dashed rgba(255,255,255,.24);border-radius:14px;background:rgba(255,255,255,.03);
}
.v2-mark-delta-label{font-size:.62rem;font-weight:800;color:var(--slate);letter-spacing:.02em;}
.v2-mark-delta-value{
  font-size:1.02rem;font-weight:900;line-height:1.25;color:rgba(255,255,255,.96);
  font-variant-numeric:tabular-nums;
}
.v2-mark-delta-note{font-size:.58rem;font-weight:700;color:var(--slate);line-height:1.45;}
.v2-mark-delta.insufficient{border-style:solid;border-color:rgba(255,255,255,.14);}

/* One 100%-stacked composition bar per arm, plus a shared legend. */
.v2-mark-props{display:flex;flex-direction:column;gap:7px;}
.v2-mark-prop{gap:4px;}
.v2-mark-prop-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.v2-mark-prop-head b{font-size:.7rem;font-weight:800;color:rgba(255,255,255,.9);}
.v2-mark-prop-head small{font-size:.62rem;font-weight:800;color:var(--slate);font-variant-numeric:tabular-nums;}
.v2-mark-layout .v2-prop-bar{height:23px;}
.v2-mark-bar-empty{align-items:center;justify-content:center;background:rgba(255,255,255,.03);}
.v2-mark-bar-empty .insuff{font-size:.64rem;}
.v2-mark-layout .v2-prop-legend{gap:3px 16px;}

/* Always-on descriptive-comparison caveat. */
.v2-mark-caveat{
  display:flex;align-items:center;justify-content:center;gap:7px;text-align:center;
  font-size:.65rem;font-weight:700;line-height:1.5;color:var(--slate);
}
.v2-mark-caveat-icon{display:inline-flex;flex-shrink:0;color:var(--gold);}
.v2-mark-caveat-icon svg{display:block;}

/* Single empty state — no marking record on any evaluated image. Shared
   across all 4 slots, so it must behave inside all 4 wrapper flex contexts
   (.v2-risk-layout / .v2-lg-marking / .v2-sys-brief / .v2-gd-marking) —
   flex:1/min-height:0 lets it fill whatever space its container gives it. */
.v2-mark-empty{
  display:flex;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;
  gap:9px;text-align:center;padding:20px 18px;
  border:1px dashed rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.02);
}
.v2-mark-empty-icon{display:inline-flex;color:var(--gold);opacity:.75;}
.v2-mark-empty-icon svg{display:block;}
.v2-mark-empty b{font-size:.95rem;font-weight:900;color:rgba(255,255,255,.96);}
.v2-mark-empty p{margin:0;max-width:62ch;font-size:.74rem;line-height:1.65;color:var(--slate);}

body.theme-light .v2-mark-delta{border-color:rgba(10,45,74,.22);background:rgba(10,45,74,.03);}
body.theme-light .v2-mark-delta.insufficient{border-color:rgba(10,45,74,.14);}
body.theme-light .v2-mark-delta-value,
body.theme-light .v2-mark-empty b,
body.theme-light .v2-mark-prop-head b{color:rgba(10,45,74,.95);}
body.theme-light .v2-mark-empty{border-color:rgba(10,45,74,.2);background:rgba(10,45,74,.02);}
body.theme-light .v2-mark-bar-empty{background:rgba(10,45,74,.03);}

@media print{
  .v2-mark-compare,.v2-mark-delta,.v2-mark-empty,.v2-mark-prop{break-inside:avoid;}
}

/* ── Ledger — يوجد/لا يوجد تحديد table (fan-out plan §11e, batch B3 item 3) ─ */
.v2-lg-marking{display:flex;flex-direction:column;gap:9px;height:100%;min-height:0;}
.v2-lg-marking .v2-lg-port-card{flex:1 1 auto;min-height:0;}
/* 8 columns is more than any other Ledger port card in this deck carries —
   mirrors .v2-lg-agree's 6-column squeeze one step further. Scoped to
   .mark-8col so it never bleeds onto any other .v2-lg-port-card. */
.v2-lg-port-card.mark-8col .deck-table th{
  white-space:normal;line-height:1.15;font-size:.6rem;padding:6px 4px;vertical-align:middle;
}
.v2-lg-port-card.mark-8col .deck-table td{font-size:.68rem;padding:9px 4px;}
.v2-lg-port-card.mark-8col .deck-table th:first-child,
.v2-lg-port-card.mark-8col .deck-table td:first-child{text-align:right;overflow-wrap:anywhere;}
/* The tfoot's SECOND row — الفارق — reads as a distinct derived figure, not a
   second totals row: a dashed gold top border instead of the base tfoot
   rule's solid one, gold ink on the delta cell only. */
.v2-lg-port-card.mark-8col .deck-table tfoot tr.v2-lg-delta-row td{
  font-weight:800;border-top:1px dashed rgba(244,180,0,.4);background:rgba(244,180,0,.05);
}
.v2-lg-port-card.mark-8col .deck-table tfoot tr.v2-lg-delta-row td:first-child{color:var(--slate);font-weight:700;}
.v2-lg-port-card.mark-8col .deck-table tfoot tr.v2-lg-delta-row td:nth-child(3){color:var(--gold);}
body.theme-light .v2-lg-port-card.mark-8col .deck-table tfoot tr.v2-lg-delta-row td{
  border-top-color:rgba(244,180,0,.5);background:rgba(244,180,0,.08);
}
body.theme-light .v2-lg-port-card.mark-8col .deck-table tfoot tr.v2-lg-delta-row td:first-child{color:color-mix(in srgb, var(--navy) 74%, transparent);}

/* ── Briefing/Grid namespacing hooks — "nothing bespoke beyond the shared
   components" role, same as every other fanned-out page's page-local hook. */
.v2-bf-marking{height:100%;}
.v2-gd-marking{display:flex;flex-direction:column;gap:9px;height:100%;min-height:0;}
.v2-gd-marking .v2-gd-panel{flex:1 1 auto;min-height:0;}
.v2-gd-marking .v2-totals-band{margin-top:0;gap:10px;}
`;
