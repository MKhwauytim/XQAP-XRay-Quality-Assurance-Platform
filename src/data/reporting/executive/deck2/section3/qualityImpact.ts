// Executive deck v2 — القسم 3, page: أثر جودة الصورة على الدقة.
//
// Answers one question: does image quality track with decision accuracy?
//
// GRAIN — this page folds `model.rows` (ONE row per population image), not
// `model.factTable` (one record per L1/L2 decision). `imageQuality` is a
// property of the IMAGE: both decision records for a given image carry the
// identical quality value, so folding at decision grain would count two
// perfectly-correlated observations per image and inflate every `n` by exactly
// 2×, making a thin stratum look twice as trustworthy as it is. Image grain is
// the only honest denominator here.
//
// ENUM — `ExecutiveReportRow.verificationCategory` is the row-grain enum
// (`correct-suspicious` / `correct-clean` / `missed-suspicious` /
// `excess-suspicious`). It is NOT `DecisionRecord.outcomeClass`, which spells
// the same concepts differently (`false-suspicion`, `missed-suspicion`, …).
// Everything below uses the row-grain spellings.
//
// DENOMINATORS — three distinct bases appear on this page and are deliberately
// never mixed inside one figure group:
//   1. `n_q`  = rows with `imageQuality === q` AND `verificationCategory !== null`
//              → the tiles, the trend strip and the gradient. This is the only
//                base that supports an accuracy claim.
//   2. `model.imageQuality.*Count` / `acceptableQualityRate` — computed over
//              `answerStatus === "submitted"` rows, a WIDER set than (1). Used
//              only in the clearly-labelled totals band, never beside an `n_q`.
//   3. `max(1, lowQualityCount + mediumQualityCount)` — the base behind
//              `kpis.lowQualityReasons.percentage`. Used only in the reasons
//              card, which prints that base in its own subtitle.
//
// THREE-SYSTEM FAN-OUT (2026-07-25 plan §11f, batch B3 item 4) — Ledger gets
// TWO stacked tables (the three strata + pooled totals, then the reasons
// table with its own subtitle text reused verbatim as the card title so the
// #3 base disclosure travels with it into every system). Briefing's lede IS
// `accuracyGradient` and its rank rows are the three strata in a FIXED
// عالي→متوسط→منخفض order — deliberately NEVER sorted by accuracy, unlike most
// other Briefing rank lists in this fan-out, because quality has an inherent
// order the accuracy figures don't get to override — and it deliberately
// DROPS the reasons table (one recall payload, not two). Grid gets one
// matrix (strata × {الدقة, الاشتباه الفائت, العيّنة, أساس الاشتباه}) beside
// the SAME reasons card, unchanged.

import type { ExecutiveReportRow } from "../../../executiveReportTypes";
import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import type { DataSufficiencyBand } from "../../model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import { metricMatrix } from "../../ui/analyticsCharts";
import {
  ACCURACY_TARGET,
  barCell,
  briefingLede,
  briefingRankList,
  briefingSupport,
  gridPanel,
  ledgerIdx,
  ledgerTableCard,
  maxOf,
  pctCell,
  qualCell,
  rateOf,
  v2Slide,
} from "../slideKit";
import type { BriefingRankItem, CellTone } from "../slideKit";

// ── Strata ──────────────────────────────────────────────────────────────────

/** The three image-quality levels, in reporting order (best → worst). These are
 *  the EXACT literals `ExecutiveReportRow.imageQuality` carries; comparison is
 *  strict equality, never a substring or normalisation pass. */
const QUALITY_ORDER = ["عالي", "متوسط", "منخفض"] as const;
type QualityLevel = (typeof QUALITY_ORDER)[number];

/** Tile/bar tone per level: green = best, gold = middle, coral = worst. Tone is
 *  decorative reinforcement only — every figure is also printed as text. */
const LEVEL_TONE: Record<QualityLevel, CellTone> = {
  عالي: "green",
  متوسط: "gold",
  منخفض: "coral",
};

const LEVEL_TITLE: Record<QualityLevel, string> = {
  عالي: "جودة عالية",
  متوسط: "جودة متوسطة",
  منخفض: "جودة منخفضة",
};

/** Arabic name of each sufficiency band, printed on every tile so a muted "—"
 *  always carries its own explanation (status is never colour-alone). */
const BAND_LABEL: Record<DataSufficiencyBand, string> = {
  none: "لا توجد بيانات",
  insufficient: "بيانات غير كافية",
  limited: "بيانات محدودة",
  sufficient: "بيانات كافية",
};

type QualityStratum = {
  level: QualityLevel;
  n: number;
  accurate: number;
  correctSuspicious: number;
  missedSuspicious: number;
  bandKey: DataSufficiencyBand;
  rankable: boolean;
  /** Null unless the stratum is rankable AND has a positive denominator. */
  accuracy: number | null;
  /** Missed-suspicion share of the confirmed-suspicious base, same gating. */
  missedRate: number | null;
  /** The missed-rate denominator, printed beside it so its size is visible. */
  suspiciousBase: number;
};

type QualityFold = {
  strata: QualityStratum[];
  /** Evaluable rows whose quality level was never recorded — reported, never
   *  folded into a stratum and never used as an accuracy denominator. */
  unknown: number;
  /** Sum of the three `n_q` — the page's own analysis base. */
  evaluated: number;
};

/**
 * Fold the month's images into the three quality strata at IMAGE grain.
 *
 * Inclusion rule: `verificationCategory !== null` (the row was actually
 * verified against an expert result, so an accuracy claim is meaningful).
 * A verified row whose `imageQuality` is null lands in `unknown` — counted,
 * never imputed into a stratum.
 */
function collectQualityStrata(rows: readonly ExecutiveReportRow[]): QualityFold {
  const tally = new Map<QualityLevel, { n: number; accurate: number; correctSusp: number; missedSusp: number }>();
  for (const level of QUALITY_ORDER) {
    tally.set(level, { n: 0, accurate: 0, correctSusp: 0, missedSusp: 0 });
  }

  let unknown = 0;
  for (const row of rows) {
    if (row.verificationCategory === null) continue;
    const level = row.imageQuality;
    if (level === null) {
      unknown += 1;
      continue;
    }
    const cur = tally.get(level);
    if (!cur) continue;
    cur.n += 1;
    if (row.imageResultAccurate === true) cur.accurate += 1;
    if (row.verificationCategory === "correct-suspicious") cur.correctSusp += 1;
    else if (row.verificationCategory === "missed-suspicious") cur.missedSusp += 1;
  }

  const strata = QUALITY_ORDER.map((level) => {
    const t = tally.get(level) ?? { n: 0, accurate: 0, correctSusp: 0, missedSusp: 0 };
    const bandKey = band(t.n);
    const rankable = isRankable(bandKey);
    const suspiciousBase = t.correctSusp + t.missedSusp;
    return {
      level,
      n: t.n,
      accurate: t.accurate,
      correctSuspicious: t.correctSusp,
      missedSuspicious: t.missedSusp,
      bandKey,
      rankable,
      // rateOf() is the ONLY division on this page: it returns null rather than
      // NaN/0% whenever the denominator is empty. The rankability gate is
      // applied on top of it, so a 1–9 stratum renders "—" even though it has
      // a mathematically valid ratio.
      accuracy: rankable ? rateOf(t.accurate, t.n) : null,
      missedRate: rankable ? rateOf(t.missedSusp, suspiciousBase) : null,
      suspiciousBase,
    } satisfies QualityStratum;
  });

  return { strata, unknown, evaluated: strata.reduce((sum, s) => sum + s.n, 0) };
}

/**
 * Accuracy gap between the best and worst quality strata, in percentage
 * points. Null unless BOTH ends are rankable — an unrankable stratum has no
 * publishable accuracy, so it can have no publishable gap either.
 */
function accuracyGradient(strata: readonly QualityStratum[]): number | null {
  const high = strata.find((s) => s.level === "عالي");
  const low = strata.find((s) => s.level === "منخفض");
  if (!high || !low || high.accuracy === null || low.accuracy === null) return null;
  return high.accuracy - low.accuracy;
}

/** Signed, one-decimal point difference, e.g. "+12.3" / "−4.0" / "0.0". Uses
 *  the proper Unicode minus sign (U+2212), not an ASCII hyphen — aligned with
 *  `markingImpact.ts`'s `fmtEffect`/`levelAccuracy.ts`'s `signedPointsText`
 *  (2026-07-28 whole-branch-review fix, C4: this used to be a plain "-",
 *  the one glyph inconsistency among this fan-out's three signed-delta
 *  pages). */
function signedPoints(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}`;
}

// ── Visual atoms ────────────────────────────────────────────────────────────

/**
 * Compact 180° accuracy dial for a tile — a micro SVG that inherits the tile's
 * tone through `currentColor` (`.v2-risk-tile-main .v2-micro-arc` in theme.ts).
 * Low→high reads left→right, the same convention as the section-1 stage tiles.
 * Decorative: the percentage is printed beside it as text, so this is
 * aria-hidden and carries no interpolated data.
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

/** Below-target alert glyph, so "under the accuracy target" is legible without
 *  relying on colour (mirrors `threshCell`'s own flag in slideKit.ts). */
function targetFlag(accuracy: number | null): string {
  if (accuracy === null || accuracy >= ACCURACY_TARGET) return "";
  return `<span class="v2-qi-flag" aria-hidden="true">${icon("alert", 11)}</span>`;
}

/** One quality tile: accuracy large + العيّنة + micro arc + missed-suspicion
 *  footnote + the stratum's sufficiency band in words. */
function qualityTile(s: QualityStratum): string {
  const tone = LEVEL_TONE[s.level];
  const accuracyHtml = s.accuracy === null ? pctCell(null) : `${targetFlag(s.accuracy)}${fmtPct(s.accuracy)}`;
  const missedHtml = s.missedRate === null ? pctCell(null) : fmtPct(s.missedRate);
  return `<div class="v2-risk-tile ${tone}">
    <div class="v2-risk-tile-head">
      <span class="v2-risk-tile-titles"><b>${esc(LEVEL_TITLE[s.level])}</b><small>${esc(s.level)}</small></span>
      <span class="v2-risk-tile-share"><b>العيّنة ${fmtNum(s.n)}</b><small>صورة مُقيَّمة</small></span>
    </div>
    <div class="v2-risk-tile-main">
      <div class="v2-risk-tile-figure">
        <b>${accuracyHtml}</b>
        <span>دقة القرار</span>
      </div>
      ${accuracyArc(s.accuracy ?? 0)}
    </div>
    <div class="v2-risk-tile-foot">
      <span class="accent"><b>${missedHtml}</b><small>الاشتباه الفائت من ${fmtNum(s.suspiciousBase)}</small></span>
      <span><b>${esc(BAND_LABEL[s.bandKey])}</b><small>كفاية البيانات</small></span>
    </div>
  </div>`;
}

/** Ordered accuracy trend (عالي → متوسط → منخفض) with the high↔low gap called
 *  out. Bars scale against the largest RANKABLE accuracy only, so an
 *  unrankable stratum can never stretch or compress the scale. */
function trendPanel(strata: readonly QualityStratum[]): string {
  const scale = maxOf(strata.filter((s) => s.accuracy !== null).map((s) => s.accuracy ?? 0));
  const steps = strata
    .map((s) => {
      const width = s.accuracy === null ? 0 : Math.max(0, Math.min(100, (s.accuracy / scale) * 100));
      const value = s.accuracy === null ? pctCell(null) : fmtPct(s.accuracy);
      return `<div class="v2-qi-step ${LEVEL_TONE[s.level]}">
        <span class="v2-qi-step-label">${esc(s.level)}<span class="v2-qi-step-n">العيّنة ${fmtNum(s.n)}</span></span>
        <span class="v2-qi-step-track"><i style="width:${width.toFixed(1)}%"></i></span>
        <span class="v2-qi-step-val">${value}</span>
      </div>`;
    })
    .join("");

  const gradient = accuracyGradient(strata);
  const gradientHtml =
    gradient === null
      ? `فارق عالي↔منخفض: ${pctCell(null)}`
      : `فارق عالي↔منخفض: <span dir="ltr">${signedPoints(gradient)}</span> نقطة`;

  return `<div class="v2-qi-panel v2-qi-trend">
    <div class="v2-qi-panel-head">
      <b>تدرّج الدقة حسب مستوى الجودة</b>
      <small>هدف الدقة ${fmtPct(ACCURACY_TARGET)}</small>
    </div>
    <div class="v2-qi-steps">${steps}</div>
    <div class="v2-qi-grad">${gradientHtml}</div>
  </div>`;
}

/**
 * Top-3 low-quality reasons. Its percentages divide by
 * `lowQualityCount + mediumQualityCount` (the base `kpis.lowQualityReasons`
 * itself uses) — a DIFFERENT base from the tiles' `n_q`, which is why the base
 * is spelled out in the card subtitle and the two never share a row.
 * Returns "" when the month recorded no reasons at all.
 */
function reasonsPanel(model: ReportModel): string {
  const top = model.kpis.lowQualityReasons.slice(0, 3);
  if (top.length === 0) return "";
  const base = model.imageQuality.lowQualityCount + model.imageQuality.mediumQualityCount;
  const scale = maxOf(top.map((r) => r.count));
  const rows = top
    .map(
      (r) =>
        `<tr><td>${esc(r.reason)}</td>${barCell(fmtNum(r.count), (r.count / scale) * 100, "coral")}<td>${pctCell(
          rateOf(r.count, base),
        )}</td></tr>`,
    )
    .join("");
  return `<div class="v2-qi-panel v2-qi-reasons">
    <div class="v2-qi-panel-head">
      <b>أبرز أسباب انخفاض الجودة</b>
      <small>من الصور منخفضة/متوسطة الجودة (${fmtNum(base)})</small>
    </div>
    <table class="deck-table">
      <thead><tr><th>السبب</th><th>العدد</th><th>النسبة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** Context band. `نسبة الجودة المقبولة` comes from the submitted-answer base,
 *  NOT from `n_q` — the label says so explicitly. */
function totalsBand(model: ReportModel, fold: QualityFold): string {
  return `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 16)}</span><span><b>${pctCell(
      model.imageQuality.acceptableQualityRate,
    )}</b><small>نسبة الجودة المقبولة · أساس مستقل: الإجابات المُسلَّمة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(
      fold.evaluated,
    )}</b><small>صورة بمستوى جودة محدّد ضمن التحليل</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("alert", 16)}</span><span><b>${fmtNum(
      fold.unknown,
    )}</b><small>صورة بلا تقييم لمستوى الجودة</small></span></div>
  </div>`;
}

/** Non-negotiable interpretation guard: these strata are self-selected and
 *  unequal in size, so the page describes an association, never a cause. */
function caveat(): string {
  return `<div class="v2-qi-caveat">
    <span class="v2-qi-caveat-icon" aria-hidden="true">${icon("alert", 12)}</span>
    <span>مقارنة وصفية بين مجموعات غير متكافئة؛ لا تُثبت أثرًا سببيًا لجودة الصورة.</span>
  </div>`;
}

/** Honest single empty state: no strata means no accuracy, no bars, no gap. */
function emptyState(fold: QualityFold): string {
  return `<div class="v2-qi-empty">
    <span class="v2-qi-empty-icon" aria-hidden="true">${icon("alert", 20)}</span>
    <span>لم تُسجَّل أي صورة بمستوى جودة محدّد ضمن القرارات القابلة للتقييم لهذا الشهر، لذلك لا يمكن عرض دقة القرارات حسب مستوى الجودة. عدد الصور بلا تقييم لمستوى الجودة: ${fmtNum(
      fold.unknown,
    )}.</span>
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// Ledger — two stacked tables (fan-out plan §11f, batch B3 item 4).
// ════════════════════════════════════════════════════════════════════════════

/** Column count: المستوى | العيّنة | الدقة | الاشتباه الفائت | أساس الاشتباه |
 *  كفاية البيانات. */
const LEDGER_STRATA_SPAN = 6;

/**
 * Ledger-system strata table — rows = the three quality levels, ordinal
 * folded into المستوى's own cell (`ledgerIdx` + the level name, the same
 * convention every other Ledger table in this fan-out uses). الدقة and
 * الاشتباه الفائت both use `qualCell` with the row's OWN `LEVEL_TONE` — a
 * fixed green/gold/coral quality-tier identity this file already defines and
 * uses on the tiles, not a re-derived pass/fail colour, and Ledger's plain
 * percent-bar cell rather than `threshCell` since neither figure has a
 * target it diverges around on this page. أساس الاشتباه and كفاية البيانات
 * are plain cells: the missed-suspicion denominator and the sufficiency band
 * IN WORDS, so a muted "—" in either rate column always has a visible reason
 * sitting right beside it — the same discipline `qualityTile`'s own
 * `BAND_LABEL` footer already follows.
 *
 * The totals row POOLS raw counts across all three strata — accuracy and the
 * missed-suspicion rate are both recomputed from SUMMED integer tallies,
 * never averaged from the three strata's own percentages (the averaging bug
 * this codebase has shipped before) — gated on the POOLED n's own
 * sufficiency band, exactly mirroring `collectQualityStrata`'s own
 * `rankable ? rateOf(...) : null` gate at combined grain, not a looser or
 * stricter parallel check.
 */
function ledgerStrataTable(strata: readonly QualityStratum[]): string {
  const bodyRowsHtml = strata
    .map((s, i) => {
      const tone = LEVEL_TONE[s.level];
      return (
        `<tr><td>${ledgerIdx(i)}${esc(s.level)}</td><td>${fmtNum(s.n)}</td>` +
        `${qualCell(s.accuracy, tone)}${qualCell(s.missedRate, tone)}` +
        `<td>${fmtNum(s.suspiciousBase)}</td><td>${esc(BAND_LABEL[s.bandKey])}</td></tr>`
      );
    })
    .join("");

  const combinedN = strata.reduce((sum, s) => sum + s.n, 0);
  const combinedRankable = isRankable(band(combinedN));
  const combinedAccurate = strata.reduce((sum, s) => sum + s.accurate, 0);
  const combinedMissed = strata.reduce((sum, s) => sum + s.missedSuspicious, 0);
  const combinedSuspBase = strata.reduce((sum, s) => sum + s.suspiciousBase, 0);
  const combinedAccuracy = combinedRankable ? rateOf(combinedAccurate, combinedN) : null;
  const combinedMissedRate = combinedRankable ? rateOf(combinedMissed, combinedSuspBase) : null;
  const totalsRowHtml =
    `<tr><td>الإجمالي</td><td>${fmtNum(combinedN)}</td><td>${pctCell(combinedAccuracy)}</td>` +
    `<td>${pctCell(combinedMissedRate)}</td><td>${fmtNum(combinedSuspBase)}</td>` +
    `<td>${esc(BAND_LABEL[band(combinedN)])}</td></tr>`;

  return ledgerTableCard({
    title: "الدقة والاشتباه الفائت حسب مستوى جودة الصورة",
    theadCells:
      `<th>المستوى</th><th>العيّنة</th><th>الدقة</th><th>الاشتباه الفائت</th>` +
      `<th>أساس الاشتباه</th><th>كفاية البيانات</th>`,
    bodyRowsHtml,
    totalsRowHtml,
    span: LEDGER_STRATA_SPAN,
    rowCount: 0,
    cardClass: "v2-lg-table-card v2-qi-lg-strata",
  });
}

/**
 * Ledger-system reasons table — the exact same top-3 rows and base as
 * `reasonsPanel`, through `ledgerTableCard` instead of the bespoke
 * `.v2-qi-reasons` card shape. `title` REUSES `reasonsPanel`'s own subtitle
 * text VERBATIM ("من الصور منخفضة/متوسطة الجودة (N)") rather than inventing
 * new wording — that text already discloses this table's own base, denominator
 * #3 in this file's header doc comment, a DIFFERENT base from
 * `ledgerStrataTable`'s `n_q` above, so the disclosure must travel with the
 * table into every design system, not just slot 0.
 */
function ledgerReasonsTable(model: ReportModel): string {
  const top = model.kpis.lowQualityReasons.slice(0, 3);
  const base = model.imageQuality.lowQualityCount + model.imageQuality.mediumQualityCount;
  const scale = maxOf(top.map((r) => r.count));
  const bodyRowsHtml =
    top.length > 0
      ? top
          .map(
            (r) =>
              `<tr><td>${esc(r.reason)}</td>${barCell(fmtNum(r.count), (r.count / scale) * 100, "coral")}<td>${pctCell(
                rateOf(r.count, base),
              )}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3"><span class="insuff">لا توجد أسباب مسجَّلة لانخفاض الجودة</span></td></tr>`;

  return ledgerTableCard({
    title: `من الصور منخفضة/متوسطة الجودة (${fmtNum(base)})`,
    theadCells: `<th>السبب</th><th>العدد</th><th>النسبة</th>`,
    bodyRowsHtml,
    totalsRowHtml: "",
    span: 3,
    rowCount: 0,
    cardClass: "v2-lg-table-card v2-qi-lg-reasons",
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Briefing — lede IS the accuracy gradient; rank rows = the 3 strata, FIXED
// عالي→متوسط→منخفض order (fan-out plan §11f).
// ════════════════════════════════════════════════════════════════════════════

/** Shown whenever the gradient can't be published — mirrors `trendPanel`'s
 *  own "فارق عالي↔منخفض: —" fallback, gated by the EXACT SAME
 *  `accuracyGradient` null check, never a parallel/looser threshold. */
const GRADIENT_INSUFFICIENT_NOTE = "بيانات غير كافية لعالي أو منخفض الجودة";

/**
 * Briefing-system lede + rank list. The lede figure IS `accuracyGradient` —
 * this page's own point — through the exact SAME null gate `trendPanel`
 * already applies (mirrored, not re-derived). Rank rows are the three strata
 * in FIXED عالي→متوسط→منخفض order — `items` is passed to `briefingRankList`
 * in that order and NEVER sorted by accuracy or any other value, unlike most
 * other Briefing rank lists in this fan-out: quality strata have an inherent
 * order that must survive display regardless of which stratum happens to
 * score highest. Bar = accuracy on a FIXED 0–100 scale (a rate page, not a
 * page ranked by each other's magnitude); per-row tone = `LEVEL_TONE`, this
 * file's own existing quality-tier identity, reused verbatim.
 * `foldRemainder` is required by the type contract but never actually fires:
 * 3 named rows never exceeds `briefingRankPlan`'s smallest tier (cap 5) — the
 * same unreachable-stub pattern `markingImpactSlide`'s own 2-row rank list
 * uses.
 *
 * `supportStrip` is slot 0's totals band, reused VERBATIM via `briefingSupport`
 * — passed in so this returns lede, THEN support, THEN rank, the SAME order
 * every other Briefing page in this fan-out uses.
 *
 * ⚠️ 2026-07-28 whole-branch-review fixes on this function:
 *   (B1) used to return only lede+rank, with the caller appending the totals
 *        band AFTER (lede → rank → support) — the only 2 pages in this
 *        fan-out (this one and s3-marking) that diverged from every other
 *        page's lede → support → rank order.
 *   (C4) the signed gradient embedded in `label` (below) had no bidi
 *        isolation — measured to render its sign on the wrong side of the
 *        digit in this RTL sentence, even though the standalone `figure`
 *        above (same value) was already correctly `dir="ltr"`-wrapped.
 */
function briefingQualityLedeAndRank(
  strata: readonly QualityStratum[],
  evaluated: number,
  supportStrip: string,
): string {
  const gradient = accuracyGradient(strata);
  const high = strata.find((s) => s.level === "عالي");
  const low = strata.find((s) => s.level === "منخفض");
  const figure =
    gradient === null ? `<span class="insuff">—</span>` : `<span dir="ltr">${signedPoints(gradient)}</span>`;
  const label =
    gradient === null || !high || !low
      ? `تدرّج الدقة — ${esc(GRADIENT_INSUFFICIENT_NOTE)}`
      : `تدرّج الدقة <span dir="ltr">${signedPoints(gradient)}</span> نقطة — عالي ${pctCell(high.accuracy)} مقابل منخفض ${pctCell(low.accuracy)}`;

  const rankItems: BriefingRankItem[] = strata.map((s) => ({
    label: s.level,
    value: s.accuracy,
    valueText: pctCell(s.accuracy),
    secondaryText: `العيّنة ${fmtNum(s.n)} · فائت ${pctCell(s.missedRate)}`,
    tone: LEVEL_TONE[s.level],
  }));

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "coral",
    scale: { kind: "fixed", max: 100 },
    foldRemainder: (folded) => ({
      label: `بقية المستويات (${fmtNum(folded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
      rest: true,
    }),
  });

  return `${briefingLede({
    figure,
    tone: "coral",
    label,
    basis: `${fmtNum(evaluated)} صورة بمستوى جودة محدّد`,
  })}
    ${supportStrip}
    ${rankHtml}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Grid — one matrix, rows = the 3 strata (fan-out plan §11f).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Grid-system strata matrix — rows = the three quality levels, columns
 * الدقة/الاشتباه الفائت (both `[0,100]`) and العيّنة/أساس الاشتباه (both
 * `[0,max]`), all `sequential-gold` — plain magnitudes/rates with no
 * meaningful midpoint here, unlike a signed delta column elsewhere in this
 * fan-out. An unrankable stratum's accuracy/missedRate are already null from
 * `collectQualityStrata`'s own gate; its n/suspiciousBase are NEVER gated, so
 * the two count columns keep showing that stratum's real numbers even when
 * the rate columns read "—" — never a fully-nulled row for a partially
 * insufficient stratum.
 */
function gridQualityMatrix(strata: readonly QualityStratum[], evaluated: number): string {
  const matrix = metricMatrix(
    {
      rowLabels: strata.map((s) => s.level),
      columns: [
        { label: "الدقة", domain: [0, 100], ramp: "sequential-gold", values: strata.map((s) => s.accuracy) },
        {
          label: "الاشتباه الفائت",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: strata.map((s) => s.missedRate),
        },
        {
          label: "العيّنة",
          domain: [0, maxOf(strata.map((s) => s.n))],
          ramp: "sequential-gold",
          values: strata.map((s) => s.n),
        },
        {
          label: "أساس الاشتباه",
          domain: [0, maxOf(strata.map((s) => s.suspiciousBase))],
          ramp: "sequential-gold",
          values: strata.map((s) => s.suspiciousBase),
        },
      ],
    },
    { width: 620, height: 320, caption: "مصفوفة جودة الصورة", rowHeader: "المستوى", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title: "دقة القرارات حسب مستوى جودة الصورة",
    sub: `${fmtNum(evaluated)} صورة بمستوى جودة محدّد`,
    chartHtml: matrix,
  });
}

// ── Slide ───────────────────────────────────────────────────────────────────

export function qualityImpactSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const fold = collectQualityStrata(model.rows);

  const body =
    fold.evaluated === 0
      ? `<div class="v2-risk-layout v2-qi">
    ${emptyState(fold)}
    ${totalsBand(model, fold)}
    ${caveat()}
  </div>`
      : `<div class="v2-risk-layout v2-qi">
    <div class="v2-risk-tile-grid v2-qi-tiles">${fold.strata.map(qualityTile).join("")}</div>
    <div class="v2-qi-mid">${trendPanel(fold.strata)}${reasonsPanel(model)}</div>
    ${totalsBand(model, fold)}
    ${caveat()}
  </div>`;

  // Ledger: two stacked tables (or the shared empty state) + the caveat. No
  // totals band — the strata table's own العيّنة column and pooled totals row
  // already carry that figure (same "the table subsumes it" reasoning every
  // other Ledger page in this fan-out follows).
  const ledgerBody = `<div class="v2-sys-ledger v2-lg-quality">
    ${
      fold.evaluated > 0
        ? `<div class="v2-lg-split stack">${ledgerStrataTable(fold.strata)}${ledgerReasonsTable(model)}</div>`
        : emptyState(fold)
    }
    ${caveat()}
  </div>`;

  // Briefing: lede, then slot 0's totals band REUSED VERBATIM (via
  // `briefingSupport`) as the support strip, then the rank list (or the
  // shared empty state), then the caveat — lede → support → rank, the SAME
  // order every other Briefing page in this fan-out uses (2026-07-28
  // whole-branch-review fix, B1 — this used to render lede → rank → support
  // instead, via a hand-rolled `.v2-totals-band` div appended after the rank
  // list rather than the shared `briefingSupport` primitive). The reasons
  // table is deliberately absent — Briefing carries one recall payload (the
  // strata), not completeness.
  const briefingSupportStrip = briefingSupport([
    {
      iconName: "gauge",
      value: pctCell(model.imageQuality.acceptableQualityRate),
      label: "نسبة الجودة المقبولة · أساس مستقل: الإجابات المُسلَّمة",
    },
    { iconName: "layers", value: fmtNum(fold.evaluated), label: "صورة بمستوى جودة محدّد ضمن التحليل" },
    { iconName: "alert", value: fmtNum(fold.unknown), label: "صورة بلا تقييم لمستوى الجودة" },
  ]);
  const briefingBody = `<div class="v2-sys-brief v2-bf-quality">
    ${
      fold.evaluated > 0
        ? briefingQualityLedeAndRank(fold.strata, fold.evaluated, briefingSupportStrip)
        : emptyState(fold)
    }
    ${caveat()}
  </div>`;

  // Grid: one matrix beside the SAME reasons card (or the shared empty
  // state), plus the caveat. No totals band on Grid — matches the plan's
  // page-by-page shape for this page (unlike slide-s3-marking's Grid, which
  // keeps one).
  const gridBody = `<div class="v2-sys-grid v2-gd-quality">
    ${
      fold.evaluated > 0
        ? `<div class="v2-gd-split">${gridQualityMatrix(fold.strata, fold.evaluated)}${reasonsPanel(model)}</div>`
        : emptyState(fold)
    }
    ${caveat()}
  </div>`;

  return v2Slide({
    id: "slide-s3-quality",
    title: "أثر جودة الصورة على الدقة",
    eyebrow: "القسم 3 — التحاليل المتقدمة",
    iconName: "gauge",
    headline: "أثر جودة الصورة على الدقة",
    subhead: "دقة القرارات حسب مستوى جودة الصورة: عالي، متوسط، منخفض.",
    bodyVariants: [body, ledgerBody, briefingBody, gridBody],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS. Everything structural is composed from classes DECK_V2_CSS
 * already ships (`.v2-risk-layout`, `.v2-risk-tile*`, `.v2-totals-band`,
 * `.v2-micro-arc`, `.deck-table`, `.insuff`); only the three-across tile row,
 * the trend/reasons split and the caveat line are new. The tile-grid override
 * is written at two-class specificity so it wins over `.v2-risk-tile-grid`'s
 * 2×2 default regardless of where this block is concatenated.
 */
export const QUALITY_IMPACT_CSS = `
/* ── Section 3 — أثر جودة الصورة على الدقة (slide-s3-quality) ─────────────── */
.v2-qi .insuff{color:var(--slate);font-weight:800;}
.v2-risk-tile-grid.v2-qi-tiles{grid-template-columns:repeat(3,1fr);grid-template-rows:1fr;}
.v2-qi-flag{display:inline-flex;vertical-align:middle;margin-inline-end:4px;color:var(--gold);}
.v2-qi-mid{display:flex;gap:12px;align-items:stretch;flex:0 0 auto;min-height:0;}
.v2-qi-panel{
  display:flex;flex-direction:column;gap:7px;min-width:0;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;
  padding:9px 12px;background:rgba(2,20,37,.32);
}
.v2-qi-trend{flex:1.35;}
.v2-qi-reasons{flex:1;}
.v2-qi-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.v2-qi-panel-head b{font-size:.72rem;font-weight:900;color:rgba(255,255,255,.95);}
.v2-qi-panel-head small{font-size:.55rem;font-weight:700;color:var(--slate);white-space:nowrap;}
.v2-qi-steps{display:flex;flex-direction:column;gap:5px;}
.v2-qi-step{display:flex;align-items:center;gap:8px;}
.v2-qi-step-label{
  flex:0 0 96px;display:flex;align-items:baseline;gap:6px;
  font-size:.63rem;font-weight:800;color:rgba(255,255,255,.88);
}
.v2-qi-step-n{font-size:.54rem;font-weight:700;color:var(--slate);font-variant-numeric:tabular-nums;}
.v2-qi-step-track{
  flex:1;min-width:0;height:10px;border-radius:5px;
  background:rgba(255,255,255,.08);overflow:hidden;
}
.v2-qi-step-track i{
  display:block;height:100%;border-radius:5px;background:var(--gold);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.v2-qi-step.green .v2-qi-step-track i{background:var(--green);}
.v2-qi-step.coral .v2-qi-step-track i{background:var(--coral);}
.v2-qi-step-val{
  flex:0 0 62px;text-align:start;font-size:.7rem;font-weight:900;
  color:rgba(255,255,255,.95);font-variant-numeric:tabular-nums;
}
.v2-qi-grad{
  margin-top:auto;font-size:.65rem;font-weight:800;color:var(--gold);
  font-variant-numeric:tabular-nums;
}
.v2-qi-reasons .deck-table{width:100%;table-layout:fixed;}
.v2-qi-reasons .deck-table th,.v2-qi-reasons .deck-table td{padding:2.5px 6px;font-size:.58rem;overflow-wrap:anywhere;}
.v2-qi-reasons .deck-table th{font-size:.56rem;}
.v2-qi-empty{
  display:flex;align-items:center;gap:12px;flex:1;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:16px 18px;
  background:rgba(2,20,37,.32);color:var(--slate);
  font-size:.78rem;font-weight:700;line-height:1.7;
}
.v2-qi-empty-icon{display:inline-flex;color:var(--gold);flex-shrink:0;}
.v2-qi-caveat{
  display:flex;align-items:center;justify-content:center;gap:7px;
  font-size:.6rem;font-weight:700;color:var(--slate);line-height:1.45;text-align:center;
}
.v2-qi-caveat-icon{display:inline-flex;color:var(--gold);flex-shrink:0;}
body.theme-light .v2-qi-panel,body.theme-light .v2-qi-empty{
  background:rgba(10,45,74,.035);border-color:rgba(10,45,74,.12);
}
body.theme-light .v2-qi-panel-head b,
body.theme-light .v2-qi-step-val,
body.theme-light .v2-qi-step-label{color:rgba(10,45,74,.92);}
body.theme-light .v2-qi-step-track{background:rgba(10,45,74,.08);}
@media screen and (max-width:820px){
  .v2-risk-tile-grid.v2-qi-tiles{grid-template-columns:1fr;grid-template-rows:repeat(3,auto);}
  .v2-qi-mid{flex-direction:column;}
}

/* ── Ledger — two stacked tables (fan-out plan §11f, batch B3 item 4) ────── */
.v2-lg-quality{height:100%;}
/* Both cards share the flex-grow .v2-lg-table-card already gives them, so a
   3-row strata table and a 3-row reasons table divide the stacked column's
   height fairly instead of one collapsing to its intrinsic (shorter) size. */
.v2-qi-lg-strata,.v2-qi-lg-reasons{margin-top:0;}

/* ── Briefing/Grid namespacing hooks — nothing bespoke beyond the shared
   components, same "hook only" role every other fanned-out page's page-local
   class plays. ────────────────────────────────────────────────────────── */
.v2-bf-quality{height:100%;}
/* 2026-07-28 whole-branch-review fix (C5): .v2-gd-quality used to be bare
   height:100% with TWO block children (.v2-gd-split, which itself claims
   height:100%, then the mandatory caveat strip stacked below it) — with no
   flex context, the split alone filled the wrapper's full height and the
   caveat had nowhere left to go, overflowing both the 14px body padding and
   the slide's own overflow:hidden box (measured: 3px clipped). Fixed with
   the SAME flex-wrapper pattern every sibling with this caveat+split shape
   already uses (.v2-gd-workload / .v2-gd-marking / .v2-agree-wrap in this
   fan-out): make this class itself the flex column, and let the split
   shrink via flex:1 1 auto so the caveat gets its own row. */
.v2-gd-quality{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;}
.v2-gd-quality .v2-gd-split{flex:1 1 auto;min-height:0;}
/* The reasons card (.v2-qi-reasons, unchanged) sits beside the new matrix
   panel inside the shared .v2-gd-split grid — give it the same full-row
   stretch .v2-gd-panel gets by default so the two don't visually mismatch
   in height. */
.v2-gd-quality .v2-qi-reasons{height:100%;}
`;
