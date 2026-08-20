// Executive deck v2 — القسم 3, page: الاتجاه اليومي للدقة.
//
// The question this page answers: across the days of the month that carry a
// usable xrayEntryDate, is accuracy stable, or does it drift/spike on
// particular days? Two lines are plotted — دقة السليمة and دقة الاشتباه —
// each with its OWN statistical-process-control band, since the two arms have
// very different denominators and therefore very different natural noise.
//
// ── No new accuracy math ─────────────────────────────────────────────────
// Both formulas are the deck's existing accuracy page's formulas, VERBATIM
// (slides.ts:3148-3149):
//   دقة الاشتباه = correctSuspicion / (correctSuspicion + missedSuspicion)
//   دقة السليمة  = correctClean    / (correctClean    + falseSuspicion)
// A per-day figure must never be able to disagree with the port-accuracy
// page, so this module invents no accuracy math of its own.
//
// ── Control limits ────────────────────────────────────────────────────────
// Limits come from `buildPChart`, already exported and already tested in
// `reviewerKpis.ts` — NOT reimplemented or re-derived here. Each series gets
// its own p-chart against its own denominator (never a shared/pooled one
// across the two series), which is why the سليمة band comes out tight (a
// large, stable denominator) and the اشتباه band wide (a much smaller one) —
// that asymmetry is the honest picture, not a defect.
//
// ── Gaps and low-n days ──────────────────────────────────────────────────
// `model.dailyTrend.days` never carries a zero-filled day — a day with no
// evaluable decisions is simply ABSENT from the array. `bandSeriesFrom` below
// preserves that discipline: a day absent from `buildPChart`'s output (n=0)
// becomes an explicit `{ y: null }` GAP, never interpolated across by
// `timeSeriesBand`. A day that IS present but below `P_CHART_MIN_N` keeps its
// point (the rate is still real) but loses its band (`lo`/`hi` → null) — the
// control limits exist mathematically but are not trustworthy at that
// subgroup size, and drawing them would dress up noise as a measured range.
//
// ── Dated share is a headline ────────────────────────────────────────────
// A month whose entry dates are sparse would otherwise present this chart as
// a complete picture of the month when it only describes a fraction of it.
// `model.dailyTrend.datedShare` and the غير مؤرخ count are therefore printed
// as the page's OWN headline (`.v2-dt-share`), not a footnote — and below
// `CAUTION_THRESHOLD` an explicit caution line is added.
//
// Pure: no Date, no Math.random, no I/O. Same input → byte-identical output.

import { buildPChart, P_CHART_MIN_N } from "../../model/reviewerKpis";
import { timeSeriesBand } from "../../ui/analyticsCharts";
import type { BandPoint, BandSeries } from "../../ui/analyticsCharts";
import type { ReportModel } from "../../model/reportModel";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { pctCell, v2Slide } from "../slideKit";

/** Below this dated-share percentage the page renders an explicit caution
 *  line: the chart then describes a fraction of the month, and that fact has
 *  to be as visible as the chart itself. */
const CAUTION_THRESHOLD = 80;

type DayFold = ReportModel["dailyTrend"]["days"][number];

/**
 * Build one banded series from a numerator/denominator pair over the day folds.
 *
 * Both formulas come from the deck's existing accuracy page VERBATIM
 * (slides.ts:3148-3149) — this module invents no accuracy math:
 *   دقة الاشتباه = correctSuspicion / (correctSuspicion + missedSuspicion)
 *   دقة السليمة  = correctClean    / (correctClean    + falseSuspicion)
 *
 * Control limits come from `buildPChart`, already exported by reviewerKpis.ts
 * and already tested there. Each series gets its OWN p-chart against its OWN
 * denominator, which is why the سليمة band comes out tight and the اشتباه band
 * wide — that asymmetry is the honest picture, not a defect.
 */
function bandSeriesFrom(
  days: DayFold[],
  label: string,
  tone: BandSeries["tone"],
  numOf: (d: DayFold) => number,
  denOf: (d: DayFold) => number,
): BandSeries {
  const chart = buildPChart(
    days.map((d) => ({ key: String(d.day), n: denOf(d), x: numOf(d) })),
    P_CHART_MIN_N,
  );
  const byDay = new Map(chart.groups.map((g) => [Number(g.key), g]));

  const points: BandPoint[] = days.map((d): BandPoint => {
    const g = byDay.get(d.day);
    // n === 0 days are dropped by buildPChart and become an explicit GAP here.
    // A day nobody screened is not a measurement of zero accuracy.
    if (!g) return { x: d.day, y: null, n: 0, lo: null, hi: null };
    return {
      x: d.day,
      y: g.p * 100,
      n: g.n,
      // A low-n day keeps its point but loses its band: the limits exist but
      // are not trustworthy at that subgroup size, and drawing them would
      // dress up noise as a measured range.
      lo: g.lowN ? null : g.lcl * 100,
      hi: g.lowN ? null : g.ucl * 100,
    };
  });

  return { label, tone, points };
}

function buildSeries(days: DayFold[]): BandSeries[] {
  return [
    bandSeriesFrom(
      days,
      "دقة السليمة",
      "success",
      (d) => d.correctClean,
      (d) => d.correctClean + d.falseSuspicion,
    ),
    bandSeriesFrom(
      days,
      "دقة الاشتباه",
      "info",
      (d) => d.correctSuspicion,
      (d) => d.correctSuspicion + d.missedSuspicion,
    ),
  ];
}

/** Share headline: dated share, the غير مؤرخ evaluable count, and — below
 *  `CAUTION_THRESHOLD` — an explicit caution line. Always rendered, even in
 *  the empty state, so an all-undated month still explains itself via this
 *  same headline rather than a bare empty box. */
function shareHeadline(model: ReportModel): string {
  const { datedShare, undated } = model.dailyTrend;
  const caution =
    datedShare !== null && datedShare < CAUTION_THRESHOLD
      ? `<div class="v2-dt-caution">${icon("alert", 13)}<span>${esc(
          "نسبة كبيرة من القرارات هذا الشهر بلا تاريخ دخول — يصف هذا الاتجاه جزءًا من الشهر لا كله.",
        )}</span></div>`
      : "";
  return `<div class="v2-dt-share">
    <div class="v2-dt-share-figure"><b>${pctCell(datedShare)}</b><span>نسبة القرارات المؤرخة</span></div>
    <div class="v2-dt-share-figure"><b>${fmtNum(undated.evaluable)}</b><span>قرار غير مؤرخ</span></div>
    ${caution}
  </div>`;
}

/** Per-day n strip — so no percentage on the chart appears without its
 *  denominator (the two series' own denominators, دقة السليمة then دقة
 *  الاشتباه) visible somewhere on the page. */
function nStrip(days: DayFold[]): string {
  if (days.length === 0) return "";
  const cells = days
    .map(
      (d) =>
        `<div class="v2-dt-n-cell"><b>${d.day}</b><span>${fmtNum(
          d.correctClean + d.falseSuspicion,
        )} / ${fmtNum(d.correctSuspicion + d.missedSuspicion)}</span></div>`,
    )
    .join("");
  return `<div class="v2-dt-n-strip">
    <div class="v2-dt-n-strip-head">العيّنة اليومية (دقة السليمة / دقة الاشتباه)</div>
    <div class="v2-dt-n-strip-row">${cells}</div>
  </div>`;
}

/** Legend explaining the shaded band and the hollow (low-n) point marker. */
function legend(): string {
  return `<div class="v2-dt-legend">
    <span class="v2-dt-legend-item"><i class="v2-dt-swatch band"></i>${esc(
      "النطاق المظلل = حدود الضبط الإحصائي (±3σ) حول المعدل العام",
    )}</span>
    <span class="v2-dt-legend-item"><i class="v2-dt-swatch lown"></i>${esc(
      "نقطة بلا نطاق = يوم بعيّنة صغيرة، الحدود غير موثوقة",
    )}</span>
  </div>`;
}

/** Honest empty state: no evaluable decision this month carries a usable
 *  entry date, so there is no day axis to plot at all. Names the غير مؤرخ
 *  count so an all-undated month explains itself rather than looking broken. */
function emptyState(model: ReportModel): string {
  const count = model.dailyTrend.undated.evaluable;
  return `<div class="v2-dt-empty">
    <span class="v2-dt-empty-icon">${icon("chart", 24)}</span>
    <b>لا يوجد قرار مؤرخ هذا الشهر</b>
    <p>${esc(
      `لم يحمل أي من قرارات هذا الشهر (${count.toLocaleString(
        "ar-SA-u-nu-latn",
      )} قرارًا) تاريخ دخول قابل للاستخدام، لذا تعذّر رسم الاتجاه اليومي. تحقّق من حقل تاريخ الدخول في بيانات هذا الشهر.`,
    )}</p>
  </div>`;
}

/**
 * Page: الاتجاه اليومي للدقة.
 *
 * Pure — no Date, no Math.random, no I/O. Same input ⇒ byte-identical output.
 */
export function dailyTrendSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const { days } = model.dailyTrend;

  const body =
    days.length === 0
      ? `<div class="v2-dt-layout">
          ${shareHeadline(model)}
          ${emptyState(model)}
        </div>`
      : `<div class="v2-dt-layout">
          ${shareHeadline(model)}
          ${timeSeriesBand(buildSeries(days), { caption: "الاتجاه اليومي للدقة" })}
          ${nStrip(days)}
          ${legend()}
        </div>`;

  return v2Slide({
    id: "slide-s3-daily-trend",
    title: "الاتجاه اليومي للدقة",
    eyebrow: "القسم 3 — التحاليل المتقدمة",
    iconName: "chart",
    headline: "الاتجاه اليومي للدقة",
    subhead: "دقة القرارات اليومية عبر أيام الشهر، مع نطاقات ضبط إحصائية لكل من دقة السليمة ودقة الاشتباه.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS. Everything scoped under `.v2-dt-` so it cannot collide with
 * the other section-3 pages built alongside it. Composed on top of the deck's
 * existing vocabulary (`.insuff`, chart chrome from analyticsCharts.ts) —
 * these rules only add what that vocabulary has no equivalent for.
 */
export const DAILY_TREND_CSS = `
/* ── القسم 3 · الاتجاه اليومي للدقة ───────────────────────────────────────── */
.v2-dt-layout{display:flex;flex-direction:column;gap:11px;height:100%;min-height:0;}

/* Share headline — a headline, not a footnote, per the page's own honesty rule. */
.v2-dt-share{
  display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);
}
.v2-dt-share-figure{display:flex;flex-direction:column;gap:1px;}
.v2-dt-share-figure b{font-size:1.05rem;font-weight:900;color:rgba(255,255,255,.96);font-variant-numeric:tabular-nums;}
.v2-dt-share-figure span{font-size:.62rem;font-weight:700;color:var(--slate);}
.v2-dt-caution{
  display:flex;align-items:center;gap:6px;margin-inline-start:auto;max-width:32em;
  font-size:.66rem;font-weight:800;line-height:1.5;color:var(--gold);
}
.v2-dt-caution svg{display:block;flex-shrink:0;}

/* Chart wrapper fills the remaining space in the body — measured live via
   report:static against a populated fixture (2026-08-20): the original rule
   here targeted the inner figure element (analyticsCharts.ts's timeSeriesBand
   wrapper), but that figure is a grandchild of this flex column, not a
   direct flex item of it — .v2-ts-wrap (a plain block div) is the actual
   flex item, so flex:1 on figure was a no-op and the chart rendered at its
   unconstrained intrinsic height (~487px), pushing the per-day n-strip and
   legend entirely past the slide's fixed 630px box. Targeting the real flex
   item — with min-height:0 so it can shrink below the SVG's own intrinsic
   size — lets flexbox allocate it only the space left after the share
   headline, n-strip, and legend, and the height:100% chain (.v2-ts-wrap to
   figure to svg) resolves against that now-definite height. */
.v2-dt-layout .v2-ts-wrap{flex:1;min-height:0;display:flex;}
.v2-dt-layout .v2-ts-wrap figure{flex:1;min-height:0;}

/* Per-day n strip. */
.v2-dt-n-strip{display:flex;flex-direction:column;gap:4px;}
.v2-dt-n-strip-head{font-size:.62rem;font-weight:800;color:var(--slate);}
.v2-dt-n-strip-row{display:flex;flex-wrap:wrap;gap:4px;}
.v2-dt-n-cell{
  display:flex;flex-direction:column;align-items:center;gap:1px;min-width:2.6em;
  padding:3px 4px;border-radius:6px;background:rgba(255,255,255,.04);
}
.v2-dt-n-cell b{font-size:.6rem;font-weight:800;color:rgba(255,255,255,.85);font-variant-numeric:tabular-nums;}
.v2-dt-n-cell span{font-size:.52rem;font-weight:700;color:var(--slate);font-variant-numeric:tabular-nums;}

/* Legend — band shading + low-n hollow-point explanation. */
.v2-dt-legend{display:flex;flex-wrap:wrap;gap:6px 18px;}
.v2-dt-legend-item{display:flex;align-items:center;gap:6px;font-size:.62rem;font-weight:700;color:var(--slate);}
.v2-dt-swatch{display:inline-block;width:10px;height:10px;border-radius:3px;flex-shrink:0;}
.v2-dt-swatch.band{background:var(--blue);opacity:.4;}
.v2-dt-swatch.lown{border:1.5px solid var(--slate);background:transparent;border-radius:50%;}

/* Empty state — no dated decision at all this month. */
.v2-dt-empty{
  display:flex;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;
  gap:9px;text-align:center;padding:20px 18px;
  border:1px dashed rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.02);
}
.v2-dt-empty-icon{display:inline-flex;color:var(--gold);opacity:.75;}
.v2-dt-empty-icon svg{display:block;}
.v2-dt-empty b{font-size:.95rem;font-weight:900;color:rgba(255,255,255,.96);}
.v2-dt-empty p{margin:0;max-width:62ch;font-size:.74rem;line-height:1.65;color:var(--slate);}

body.theme-light .v2-dt-share{border-color:rgba(10,45,74,.16);background:rgba(10,45,74,.02);}
body.theme-light .v2-dt-share-figure b,
body.theme-light .v2-dt-empty b{color:rgba(10,45,74,.95);}
body.theme-light .v2-dt-n-cell{background:rgba(10,45,74,.04);}
body.theme-light .v2-dt-n-cell b{color:rgba(10,45,74,.85);}
body.theme-light .v2-dt-empty{border-color:rgba(10,45,74,.2);background:rgba(10,45,74,.02);}

@media print{
  .v2-dt-share,.v2-dt-empty,.v2-dt-n-strip{break-inside:avoid;}
}
`;
