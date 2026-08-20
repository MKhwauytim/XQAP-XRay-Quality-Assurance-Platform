// Executive deck v2 — القسم 3, page: الأداء حسب حجم الأعمال.
//
// The question this page answers: *is a port's accuracy low because it handles
// too much volume?* Land and sea ports are each listed in a table, busiest
// first, comparing workload (population image count) to accuracy — the SAME
// land/sea two-up `.v2-port-col` pattern every other table page in this deck
// uses (`portTable`/`qualityTable`/`accuracyTable` in slides.ts, and Section 3's
// `levelAccuracy`/`portAgreement`), built on the shared `portTableCard` shell.
//
// Changed 2026-07-25: this page used to pair a bubble scatter with one ad-hoc
// table (owner feedback: "I want table not graph this graph make no sense
// plus why table is different design and different from other tables"). The
// scatter is gone; the underlying join/gating logic below is UNCHANGED, only
// the presentation is now two standard land/sea tables.
//
// Changed 2026-08-19 (task-7 of the executive-report-section3-analytics plan):
// reworked into an actual CORRELATION view. The land/sea tables alone never
// answered the page's own title — الدقة there just restated the section-2
// port-accuracy page (both read `model.portAccuracy`), and حجم الصور/الاشتباه
// الفائت were the only unique content. A `.v2-wa-dev` deviation strip is now
// appended below the two tables: the SAME ports, ordered busiest-first, each
// showing accuracy as a signed deviation from the month's pooled accuracy —
// so a reader can actually see whether the busiest ports (top of the list)
// skew toward a negative deviation. Built entirely from `barCell` (a `<td>`
// bar-cell, the exact idiom every other table on this page and this deck
// already uses) inside a plain `.deck-table` — deliberately NOT a new chart
// idiom, because a chart is exactly what got this page's PREVIOUS graph
// rejected (see the 2026-07-25 note above): the owner's objection was that
// the old scatter looked like nothing else in the deck, not that a graph is
// inherently wrong. A `.v2-wa-dev` table reads as one more table, not a new
// one-off visual.
//
// Because adding the strip leaves less vertical room, the land/sea tables now
// paginate at `WORKLOAD_TABLE_ROWS_PER_PAGE` (4) instead of the deck-wide
// `BASE_ROWS_PER_PAGE` (7) — that constant is specifically measured for a
// `.v2-port-col` card that owns the ENTIRE slide body; this page's cards no
// longer do, so reusing it would silently clip rows past the card's new,
// shorter, height (exactly the historical bug class this deck has hit before
// with a fixed top-N cutoff). Fit was measured live via `npm run
// report:static`, not reasoned about — see task-7-report.md.
//
// The four-system fan-out (Ledger/Briefing/Grid) this page used to render is
// GONE: `workloadAccuracySlideBuilders` now ships disabled by default (see
// `SHOW_WORKLOAD_ACCURACY_SLIDE` below), so building and maintaining three
// separate hand-tuned designs for a page nobody currently sees was not a good
// use of the rework. All four variant slots now render the SAME body
// (`[body, body, body, body]`), the same collapsed pattern other dormant
// pages in this deck use.
//
// ── Honesty discipline (non-negotiable, mirrors the rest of the deck) ────────
//   • This page shows an ASSOCIATION, never a cause. Every headline, label and
//     the permanent caveat below the tables say so explicitly; nothing on the
//     page is worded as "volume causes low accuracy".
//   • Every rate goes through `rateOf` → `null` on a zero denominator, rendered
//     as a muted "—" and NEVER as a fake 0%.
//   • Every rate is gated by `isRankable(band(n))` against ITS OWN denominator
//     — accuracy against `evaluable` (`rankable`), the missed-suspicion rate
//     against its own, smaller `correctSuspicion + missedSuspicion` base
//     (`missedRankable`), NOT `evaluable` (2026-07-30 fix: a port can have
//     plenty of evaluable decisions yet very few confirmed-suspicion ones, so
//     gating the missed-suspicion rate on `evaluable` used to let a thin-base
//     percentage through unsuppressed). Ports under the relevant cut render
//     "—" instead of a number and are excluded from every superlative/trend
//     claim. Each totals row is gated on the SAME rule against its own summed
//     base. The deviation strip reuses `rankable` unchanged for its own gate,
//     plus its OWN pooled-base gate for the month mean (`monthMeanAccuracy`).
//   • العيّنة (the evaluable base) is printed for every port, so no percentage
//     is ever shown without its denominator visible somewhere on the row —
//     though the missed-suspicion rate's OWN (smaller) denominator is not a
//     separate column; see `missedRankable` above. (Column was labelled `ن` —
//     owner, 2026-07-25: "ن is shit just say العينة".)
//
// ── Accuracy source ─────────────────────────────────────────────────────────
// Accuracy comes from `model.portAccuracy` (`KeyedAccuracy[]`, keyed by port
// name), NOT `model.population.byPort[].accuracy` — the latter hard-nulls below
// 30 verified rows and would silently disagree with the section-2 accuracy page.
//
// Pure: no Date, no Math.random, no I/O. Same input → byte-identical output.

import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import {
  ACCURACY_TARGET,
  barCell,
  maxOf,
  pctCell,
  planPortPages,
  portTableCard,
  rateOf,
  threshCell,
  v2Slide,
} from "../slideKit";
import type { SlideBuilder } from "../slideKit";

/**
 * Owner request 2026-08-19: hide الأداء حسب حجم الأعمال from the generated
 * report — its accuracy column restated the section-2 port-accuracy page from
 * the same source (`model.portAccuracy`). NOT a removal: the builder, its
 * helpers, its CSS and its tests all stay, just skipped, so it can be flipped
 * back on without rebuilding any of it. Same pattern and same intent as
 * SHOW_MONTH_NUMBERS_SLIDE in slides.ts. Do not delete this module while the
 * flag is false; it is dormant, not dead code.
 */
const SHOW_WORKLOAD_ACCURACY_SLIDE = false;

const SLIDE_ID = "slide-s3-workload";
const SLIDE_TITLE = "الأداء حسب حجم الأعمال";
const EYEBROW = "القسم 3 — التحاليل المتقدمة";
const SUBHEAD =
  "هل يرتبط انخفاض دقة المنفذ بارتفاع حجم صوره؟ مقارنة الدقة بحجم مجتمع كل منفذ.";

/** The association-not-causation caveat. Rendered on EVERY variant of this
 *  page, including the empty state — it is a property of the analysis, not of
 *  the data that happens to be present this month. */
const CAVEAT = "ارتباط وصفي بين الحجم والدقة، لا يُقرأ كعلاقة سببية.";

/** Fallback port key — the same literal `foldBy`/`collectPortStats` use, so the
 *  workload tally and `model.portAccuracy` join on identical keys. */
const UNKNOWN_PORT = "غير محدد";

/** Column count of each land/sea table — thread through `portTableCard`'s
 *  colspans. */
const TABLE_SPAN = 5;

/** Column count of the deviation strip (المنفذ | حجم الصور | الانحراف). */
const DEV_SPAN = 3;

/** The muted cell used wherever a rate is unavailable or ungated: no bar, no
 *  number, just the "—" every other deck table uses. */
const MUTED_CELL = `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;

/**
 * Row budget for THIS page's land/sea tables — deliberately smaller than the
 * deck-wide `BASE_ROWS_PER_PAGE` (7). That constant is measured for a
 * `.v2-port-col` card that owns the entire ~459px slide body; on this page the
 * body is now shared with the `.v2-wa-dev` deviation strip below, so reusing
 * the full-body budget would silently clip the tables' bottom rows against
 * their new, shorter card height — exactly the "fixed top-N cutoff drops
 * rows" bug class this deck has already shipped and fixed once (see
 * `BASE_ROWS_PER_PAGE`'s own doc comment). Measured live via
 * `npm run report:static` (task-7-report.md), not reasoned about.
 */
const WORKLOAD_TABLE_ROWS_PER_PAGE = 4;

// ── Per-port join: workload (population rows) × accuracy (portAccuracy) ──────

type WorkloadPortRow = {
  name: string;
  /** Sea vs land, from the port's FIRST population row — the same rule the
   *  land/sea port tables in slides.ts use. */
  sea: boolean;
  /** Population image count for the port (the "workload"). */
  workload: number;
  evaluable: number;
  /** correctClean + correctSuspicion — the accuracy numerator. */
  correct: number;
  correctSuspicion: number;
  missedSuspicion: number;
  rankable: boolean;
  /** Whether the MISSED-SUSPICION rate's own (smaller) denominator
   *  (`correctSuspicion + missedSuspicion`) clears the sufficiency cut —
   *  independent of `rankable`, which is gated on `evaluable` (the accuracy
   *  rate's own denominator). A port can have plenty of evaluable decisions
   *  yet very few confirmed-suspicion ones, so the missed-suspicion rate must
   *  be suppressed on ITS OWN thin base even when accuracy is shown. */
  missedRankable: boolean;
};

/**
 * Join the workload tally to `model.portAccuracy`. A port present in only ONE
 * of the two still appears: population-only ports get `evaluable: 0` (so every
 * rate is "—"), accuracy-only ports get `workload: 0`.
 *
 * Ordering is an explicit total order (workload desc, then name by code unit)
 * so the output never depends on Map insertion order or on a locale collation.
 */
function collectWorkloadRows(model: ReportModel): WorkloadPortRow[] {
  const workload = new Map<string, number>();
  const sea = new Map<string, boolean>();
  for (const r of model.rows) {
    const name = r.portName ?? UNKNOWN_PORT;
    workload.set(name, (workload.get(name) ?? 0) + 1);
    if (!sea.has(name)) sea.set(name, (r.portType ?? "").includes("بحري"));
  }

  const rows = new Map<string, WorkloadPortRow>();
  for (const p of model.portAccuracy) {
    rows.set(p.key, {
      name: p.key,
      sea: sea.get(p.key) ?? false,
      workload: workload.get(p.key) ?? 0,
      evaluable: p.evaluable,
      correct: p.correctClean + p.correctSuspicion,
      correctSuspicion: p.correctSuspicion,
      missedSuspicion: p.missedSuspicion,
      rankable: isRankable(band(p.evaluable)),
      missedRankable: isRankable(band(p.correctSuspicion + p.missedSuspicion)),
    });
  }
  for (const [name, count] of workload) {
    if (rows.has(name)) continue;
    rows.set(name, {
      name,
      sea: sea.get(name) ?? false,
      workload: count,
      evaluable: 0,
      correct: 0,
      correctSuspicion: 0,
      missedSuspicion: 0,
      rankable: isRankable(band(0)),
      missedRankable: isRankable(band(0)),
    });
  }

  return [...rows.values()].sort(
    (a, b) => b.workload - a.workload || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** (correctClean + correctSuspicion) / evaluable × 100 — null when evaluable 0. */
function accuracyOf(p: WorkloadPortRow): number | null {
  return rateOf(p.correct, p.evaluable);
}

/** missedSuspicion / (correctSuspicion + missedSuspicion) × 100 — null when the
 *  reviewer flagged nothing at that port (no denominator, so no rate). */
function missedRateOf(p: WorkloadPortRow): number | null {
  return rateOf(p.missedSuspicion, p.correctSuspicion + p.missedSuspicion);
}

function caveatNote(): string {
  return `<p class="v2-wl-caveat"><span class="v2-wl-caveat-icon" aria-hidden="true">${icon(
    "alert",
    11,
  )}</span><span>${esc(CAVEAT)}</span></p>`;
}

// ── Land/sea tables — top ports by workload ─────────────────────────────────

/** The missed-suspicion column: a fixed-polarity coral bar (higher = worse), so
 *  it is never confused with the threshold-scored accuracy column beside it. */
function missedCell(v: number | null): string {
  if (v === null) return MUTED_CELL;
  return barCell(fmtPct(v), Math.max(0, Math.min(100, v)), "coral");
}

/**
 * One land/sea table, built on the shared `portTableCard` shell — the SAME
 * shell and the SAME land/sea/pagination conventions `portTable`/
 * `qualityTable`/`accuracyTable` (slides.ts) and Section 3's `levelAccuracy`/
 * `portAgreement` use, so this page's tables look and behave identically to
 * every other table in the deck:
 *   - card tint comes from `variant` alone (the shared `.v2-port-col.land`/
 *     `.sea` rules in theme.ts) — this page previously reinvented its own
 *     green/blue tint via a bespoke `extraClass` + CSS override, which is
 *     exactly why it looked different (owner, 2026-07-25: "it look nothing
 *     like others make it use same component").
 *   - overflow is handled by `planPortPages`'s compact tier, not a fixed
 *     top-N slice — the earlier top-7 cutoff silently dropped the 8th port
 *     of an 8-port group even though the OTHER land/sea pages (built on the
 *     identical row budget) show all 8 in `.compact` mode.
 * `rows` is this page's chunk (already sliced by the caller); totals are the
 * chunk's own subtotal, matching every other paginated port table — there is
 * no page in this deck where a table's totals row covers rows the table
 * itself doesn't display.
 */
function tableCard(title: string, rows: WorkloadPortRow[], variant: "land" | "sea", compact: boolean): string {
  const maxWorkload = maxOf(rows.map((p) => p.workload));
  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            const accuracy = p.rankable ? threshCell(accuracyOf(p), ACCURACY_TARGET) : MUTED_CELL;
            const missed = p.missedRankable ? missedCell(missedRateOf(p)) : MUTED_CELL;
            return (
              `<tr><td>${esc(p.name)}</td>` +
              barCell(fmtNum(p.workload), (p.workload / maxWorkload) * 100, variant === "land" ? "green" : "blue") +
              accuracy +
              missed +
              `<td>${fmtNum(p.evaluable)}</td></tr>`
            );
          })
          .join("")
      : `<tr><td colspan="${TABLE_SPAN}"><span class="insuff">—</span></td></tr>`;

  const sum = (f: (p: WorkloadPortRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totWorkload = sum((p) => p.workload);
  const totEvaluable = sum((p) => p.evaluable);
  const totCorrect = sum((p) => p.correct);
  const totCS = sum((p) => p.correctSuspicion);
  const totMS = sum((p) => p.missedSuspicion);
  // The totals row obeys the SAME sufficiency gate as the per-port rows —
  // accuracy read against the summed evaluable base, the missed-suspicion
  // rate read against ITS OWN summed (smaller) base, independently.
  const totRankable = isRankable(band(totEvaluable));
  const totMissedRankable = isRankable(band(totCS + totMS));
  const totAccuracy = totRankable ? pctCell(rateOf(totCorrect, totEvaluable)) : pctCell(null);
  const totMissed = totMissedRankable ? pctCell(rateOf(totMS, totCS + totMS)) : pctCell(null);
  const totalsRow =
    `<tr><td>الإجمالي</td><td>${fmtNum(totWorkload)}</td>` +
    `<td>${totAccuracy}</td><td>${totMissed}</td><td>${fmtNum(totEvaluable)}</td></tr>`;

  const ths = `<th>المنفذ</th><th>حجم الصور</th><th>الدقة</th><th>الاشتباه الفائت</th><th>العيّنة</th>`;
  const headSub = `${fmtNum(rows.length)} منفذ`;

  return portTableCard({
    title,
    headSub,
    headIcon: variant === "land" ? "truck" : "ship",
    variant,
    compact,
    theadCells: ths,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span: TABLE_SPAN,
    totalsRowHtml: totalsRow,
  });
}

// ── Deviation strip — the correlation view itself ────────────────────────────

/**
 * Pooled month accuracy across every RANKABLE port on this page — the
 * baseline the deviation strip compares each port to. Pooled from raw counts,
 * never averaged from each port's own percentage (this codebase has shipped
 * that exact averaging bug before — see markingImpact.ts's ledger totals row),
 * and gated on the SAME sufficiency rule as every other totals figure on this
 * page: the summed base must itself clear the cut, independent of any single
 * port's own gate. Null when no port clears the cut at all, in which case the
 * whole strip renders muted dashes instead of a fabricated comparison.
 */
function monthMeanAccuracy(rows: WorkloadPortRow[]): number | null {
  const rankableRows = rows.filter((p) => p.rankable);
  const totalCorrect = rankableRows.reduce((s, p) => s + p.correct, 0);
  const totalEvaluable = rankableRows.reduce((s, p) => s + p.evaluable, 0);
  return isRankable(band(totalEvaluable)) ? rateOf(totalCorrect, totalEvaluable) : null;
}

/** A port's accuracy expressed as a signed deviation (percentage points) from
 *  `monthMean` — null when the port itself isn't rankable OR there is no month
 *  mean to compare against. Never a fabricated comparison against a thin or
 *  missing baseline. */
function deviationOf(p: WorkloadPortRow, monthMean: number | null): number | null {
  if (!p.rankable || monthMean === null) return null;
  const acc = accuracyOf(p);
  return acc === null ? null : acc - monthMean;
}

/** Format a signed percentage-point deviation, e.g. "+3.2" / "−1.0" / "0.0".
 *  Rounds FIRST so a value like −0.04 never renders as the nonsensical "−0.0"
 *  (same fix markingImpact.ts's `fmtEffect` already applies). */
function fmtDeviation(v: number): string {
  const rounded = Number(v.toFixed(1));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * One row of the deviation strip. `data-port` on the `<tr>` makes ordering
 * assertable — the strip's whole reason to exist is showing whether the
 * busiest ports (top of the list) skew toward a negative deviation, so order
 * is part of the claim, not just cosmetic.
 *
 * The bar's magnitude is ALWAYS |deviation| (never the signed value itself —
 * a negative CSS width is meaningless and `barCell` clamps it to 0 anyway).
 * The SIGN is carried entirely by tone (green = at/above the month mean,
 * coral = below) and by the printed signed figure, so status is never
 * conveyed by bar length alone. The signed figure gets its own `dir="ltr"`
 * isolation — a bare signed number inside RTL prose renders its sign on the
 * wrong side of the digit (measured 2026-07-28, C4, markingImpact.ts).
 */
function deviationRow(p: WorkloadPortRow, monthMean: number | null, maxAbsDev: number): string {
  const dev = deviationOf(p, monthMean);
  const devCell =
    dev === null
      ? MUTED_CELL
      : barCell(
          `<span dir="ltr">${esc(fmtDeviation(dev))}</span>`,
          maxAbsDev > 0 ? (Math.abs(dev) / maxAbsDev) * 100 : 0,
          dev >= 0 ? "green" : "coral",
        );
  return `<tr data-port="${esc(p.name)}"><td>${esc(p.name)}</td><td>${fmtNum(p.workload)}</td>${devCell}</tr>`;
}

/**
 * The correlation view itself (2026-08-19 rework): ports on THIS page's
 * chunk, ordered busiest-first, each showing accuracy as a signed deviation
 * from the month's pooled accuracy. `landChunk`/`seaChunk` are each
 * individually workload-desc (`collectWorkloadRows` sorts once, before the
 * land/sea split) but their concatenation is NOT — the same fact
 * `briefingWorkloadRank` used to have to re-sort for before it was deleted in
 * this rework — so `combined` is explicitly re-sorted here rather than trusting
 * `[...landChunk, ...seaChunk]`'s own order.
 *
 * Built entirely on `barCell` inside a plain `.deck-table` — the SAME in-cell
 * bar idiom every other table on this page (and this deck) uses. Deliberately
 * NOT a bespoke chart: see this module's file-level doc comment for why a new
 * one-off visual here would repeat the exact mistake the 2026-07-25 scatter
 * rejection was about.
 */
function deviationStrip(landChunk: WorkloadPortRow[], seaChunk: WorkloadPortRow[], monthMean: number | null): string {
  const combined = [...landChunk, ...seaChunk].sort(
    (a, b) => b.workload - a.workload || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const maxAbsDev = maxOf(
    combined.map((p) => {
      const d = deviationOf(p, monthMean);
      return d === null ? 0 : Math.abs(d);
    }),
  );
  const rowsHtml = combined.length
    ? combined.map((p) => deviationRow(p, monthMean, maxAbsDev)).join("")
    : `<tr><td colspan="${DEV_SPAN}"><span class="insuff">—</span></td></tr>`;
  const meanText = monthMean === null ? `<span class="insuff">—</span>` : fmtPct(monthMean);

  return `<div class="v2-wa-dev">
    <div class="v2-wa-dev-head">
      <span class="v2-wa-dev-head-icon" aria-hidden="true">${icon("chart", 13)}</span>
      <b>الانحراف عن متوسط دقة الشهر</b>
      <span class="v2-wa-dev-mean">المتوسط ${meanText}</span>
    </div>
    <table class="deck-table v2-wa-dev-table">
      <thead><tr><th>المنفذ</th><th>حجم الصور</th><th>الانحراف (نقطة مئوية)</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

// ── Body ────────────────────────────────────────────────────────────────────

/** Explicit Arabic empty state — never a blank card, never a 0%/NaN table. */
function emptyBody(): string {
  return `<div class="v2-wl-layout">
    <div class="v2-wl-empty">
      <span class="v2-wl-empty-icon" aria-hidden="true">${icon("chart", 34)}</span>
      <b>لا توجد بيانات منافذ لهذا الشهر</b>
      <span>لم تُسجَّل صور أو قرارات قابلة للتقييم على مستوى المنافذ، فلا يمكن عرض العلاقة بين حجم الأعمال والدقة.</span>
    </div>
    ${caveatNote()}
  </div>`;
}

/**
 * Build one or more slides — paginated land/sea in parallel, at
 * `WORKLOAD_TABLE_ROWS_PER_PAGE` (this page's own, smaller budget; see that
 * constant's doc comment for why it differs from the deck-wide
 * `BASE_ROWS_PER_PAGE`).
 *
 * UNGATED — exported so the correlation-view tests can exercise this page's
 * real content directly. `workloadAccuracySlideBuilders` below is the gated
 * entry point every OTHER caller (section3/index.ts) uses; it returns `[]`
 * while `SHOW_WORKLOAD_ACCURACY_SLIDE` is false. Splitting the two was a
 * deliberate ruling (task-7-report.md): a single gated function cannot both
 * return real slides for its own tests AND return `[]` for the "disabled by
 * default" test.
 */
export function workloadAccuracyPageBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const rows = collectWorkloadRows(model);
  if (rows.length === 0) {
    return [
      (num, total) =>
        v2Slide({
          id: SLIDE_ID,
          title: SLIDE_TITLE,
          eyebrow: EYEBROW,
          iconName: "chart",
          headline: SLIDE_TITLE,
          subhead: SUBHEAD,
          bodyVariants: [emptyBody(), emptyBody(), emptyBody(), emptyBody()],
          variantPreview,
          num,
          total,
          section: "section3",
        }),
    ];
  }

  const monthMean = monthMeanAccuracy(rows);
  const land = rows.filter((p) => !p.sea);
  const sea = rows.filter((p) => p.sea);
  const plan = planPortPages(land.length, sea.length, WORKLOAD_TABLE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-wl-layout">
        <div class="v2-port-split v2-wl-split">${tableCard("المنافذ البرية", landChunk, "land", plan.compact)}${tableCard("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
        ${deviationStrip(landChunk, seaChunk, monthMean)}
        ${caveatNote()}
      </div>`;
      // Collapsed single-variant pattern (2026-08-19 rework): this page used
      // to fan out into four hand-tuned design-system bodies (Ledger/
      // Briefing/Grid), but it now ships dormant (`SHOW_WORKLOAD_ACCURACY_
      // SLIDE` below), so maintaining three extra designs for a page nobody
      // currently sees was not a good use of the rework. All four variant
      // slots render the SAME body; see fanoutB2b.test.ts for the updated
      // assertions.
      return v2Slide({
        id: page === 0 ? SLIDE_ID : `${SLIDE_ID}-${page + 1}`,
        title: `${SLIDE_TITLE}${cont}`,
        eyebrow: EYEBROW,
        iconName: "chart",
        headline: `${SLIDE_TITLE}${cont}`,
        subhead: SUBHEAD,
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section3",
      });
    });
  }
  return builders;
}

/**
 * Gated entry point — every caller outside this module's own tests should use
 * this, not `workloadAccuracyPageBuilders` directly. Returns `[]` immediately
 * while `SHOW_WORKLOAD_ACCURACY_SLIDE` is false, contributing zero slides,
 * zero TOC rows and zero page numbers to the deck (section3/index.ts spreads
 * this array, so an empty result is already fully supported there — no
 * separate page-count bookkeeping needed, unlike `SHOW_MONTH_NUMBERS_SLIDE`'s
 * TOC-range arithmetic in slides.ts).
 */
export function workloadAccuracySlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  if (!SHOW_WORKLOAD_ACCURACY_SLIDE) return [];
  return workloadAccuracyPageBuilders(model, variantPreview);
}

// ── CSS ─────────────────────────────────────────────────────────────────────
// Everything here is SCOPED to this page's own wrappers (`.v2-wl-*`/`.v2-wa-*`)
// so it can neither alter the existing land/sea port pages nor collide with a
// sibling section-3 page's stylesheet. No raw hex literals (check:hex-literals):
// colors come from the theme's CSS variables, blended with color-mix where a
// tint is needed.
// NOTE: this page does NOT define its own land/sea card tint — `variant` alone
// (passed to `portTableCard`) is enough to pick up the shared `.v2-port-col
// .land`/`.sea` rules in theme.ts, the same ones every other land/sea page in
// the deck uses. A bespoke `.v2-port-col.blue` override used to live here and
// is exactly why this page's sea card looked different from every other sea
// card in the deck — removed rather than fixed in place.
export const WORKLOAD_ACCURACY_CSS = `
/* ── Section 3 · الأداء حسب حجم الأعمال ───────────────────────────────────── */
/* Headers stay on one line: a wrapped th would eat a row of the row budget
   and push the totals row out of the clipped card. */
.v2-wl-split .v2-port-col .deck-table th{white-space:nowrap;}
.v2-wl-split .v2-port-col .deck-table td:first-child{overflow-wrap:anywhere;}
/* Association-not-causation caveat — permanent, on every variant, whether the
   page shows the two tables or the empty state. */
.v2-wl-caveat{
  display:flex;align-items:center;gap:6px;margin:0;padding:7px 14px 9px;
  font-size:0.62rem;font-weight:700;line-height:1.35;color:var(--muted);
  border-top:1px solid color-mix(in srgb,var(--white) 10%,transparent);
}
.v2-wl-caveat .v2-wl-caveat-icon{display:inline-flex;flex-shrink:0;color:var(--gold);}
body.theme-light .v2-wl-caveat{
  color:color-mix(in srgb,var(--navy) 78%,transparent);
  border-top-color:color-mix(in srgb,var(--navy) 14%,transparent);
}
/* Page shell: wraps the tables, the deviation strip, and the caveat strip.
   The land/sea split no longer owns the whole body (flex:1 1 auto still, but
   sharing the column with the strip below) — this is exactly why
   WORKLOAD_TABLE_ROWS_PER_PAGE had to shrink from BASE_ROWS_PER_PAGE. */
.v2-wl-layout{display:flex;flex-direction:column;gap:7px;height:100%;min-height:0;}
.v2-wl-layout .v2-wl-caveat{border-top:0;padding:0 2px;}
.v2-wl-layout .v2-port-split{flex:0 0 auto;}
.v2-wl-empty{
  flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:24px;text-align:center;border-radius:14px;
  border:1px dashed color-mix(in srgb,var(--white) 18%,transparent);
}
.v2-wl-empty-icon{display:inline-flex;color:var(--slate);}
.v2-wl-empty b{font-size:1rem;font-weight:800;color:var(--white);}
.v2-wl-empty span{font-size:0.76rem;font-weight:600;color:var(--muted);max-width:56ch;line-height:1.55;}
body.theme-light .v2-wl-empty{border-color:color-mix(in srgb,var(--navy) 20%,transparent);}
body.theme-light .v2-wl-empty b{color:var(--navy);}
body.theme-light .v2-wl-empty span{color:color-mix(in srgb,var(--navy) 72%,transparent);}

/* ── Deviation strip (2026-08-19 rework) — the correlation view itself ──── */
.v2-wa-dev{
  flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:4px;
  border-radius:12px;border:1px solid color-mix(in srgb,var(--white) 12%,transparent);
  background:color-mix(in srgb,var(--white) 3%,transparent);padding:8px 10px;overflow:hidden;
}
.v2-wa-dev-head{display:flex;align-items:center;gap:6px;font-size:0.66rem;font-weight:800;color:var(--white);}
.v2-wa-dev-head-icon{display:inline-flex;flex-shrink:0;color:var(--gold);}
.v2-wa-dev-mean{margin-inline-start:auto;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums;}
.v2-wa-dev-table{width:100%;}
.v2-wa-dev-table th,.v2-wa-dev-table td{padding:2.5px 6px;font-size:0.62rem;}
.v2-wa-dev-table th{white-space:nowrap;}
.v2-wa-dev-table td:first-child{overflow-wrap:anywhere;}
body.theme-light .v2-wa-dev{
  border-color:color-mix(in srgb,var(--navy) 16%,transparent);
  background:color-mix(in srgb,var(--navy) 3%,transparent);
}
body.theme-light .v2-wa-dev-head{color:var(--navy);}
body.theme-light .v2-wa-dev-mean{color:color-mix(in srgb,var(--navy) 72%,transparent);}
`;
