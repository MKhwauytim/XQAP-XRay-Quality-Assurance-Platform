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
// ── Honesty discipline (non-negotiable, mirrors the rest of the deck) ────────
//   • This page shows an ASSOCIATION, never a cause. Every headline, label and
//     the permanent caveat below the tables say so explicitly; nothing on the
//     page is worded as "volume causes low accuracy".
//   • Every rate goes through `rateOf` → `null` on a zero denominator, rendered
//     as a muted "—" and NEVER as a fake 0%.
//   • Every rate is gated by `isRankable(band(evaluable))` — ports under the
//     data-sufficiency cut render "—" instead of a number and are excluded from
//     every superlative/trend claim. The totals row is gated on the SAME rule
//     against the summed evaluable count.
//   • العيّنة (the evaluable base) is printed for every port, so no percentage
//     is ever shown without its denominator. (Column was labelled `ن` —
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
import { metricMatrix } from "../../ui/analyticsCharts";
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
  barCell,
  briefingLede,
  briefingRankList,
  briefingSupport,
  gridPanel,
  ledgerIdx,
  ledgerPortCard,
  maxOf,
  pctCell,
  planPortPages,
  portCountPhrase,
  portTableCard,
  rateOf,
  threshCell,
  v2Slide,
} from "../slideKit";
import type { BriefingRankItem, SlideBuilder } from "../slideKit";

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

/** Column count of each table — thread through `portTableCard`'s colspans. */
const TABLE_SPAN = 5;

/** The muted cell used wherever a rate is unavailable or ungated: no bar, no
 *  number, just the "—" every other deck table uses. */
const MUTED_CELL = `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;

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
            const missed = p.rankable ? missedCell(missedRateOf(p)) : MUTED_CELL;
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
  // The totals row obeys the SAME sufficiency gate as the per-port rows, read
  // against the summed evaluable base.
  const totRankable = isRankable(band(totEvaluable));
  const totAccuracy = totRankable ? pctCell(rateOf(totCorrect, totEvaluable)) : pctCell(null);
  const totMissed = totRankable ? pctCell(rateOf(totMS, totCS + totMS)) : pctCell(null);
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

/**
 * Ledger-system workload table (fan-out plan §11a, batch B2b) — near-clone of
 * `tableCard`'s columns/tones through the shared `ledgerPortCard` (P2), plus
 * an ordinal badge. The caveat strip is appended by the caller below both
 * land/sea cards, exactly where slot 0 places it.
 */
function ledgerWorkloadTable(
  title: string,
  rows: WorkloadPortRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const maxWorkload = maxOf(rows.map((p) => p.workload));
  const trs = rows
    .map((p, i) => {
      const accuracy = p.rankable ? threshCell(accuracyOf(p), ACCURACY_TARGET) : MUTED_CELL;
      const missed = p.rankable ? missedCell(missedRateOf(p)) : MUTED_CELL;
      return (
        `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>` +
        barCell(fmtNum(p.workload), (p.workload / maxWorkload) * 100, variant === "land" ? "green" : "blue") +
        accuracy +
        missed +
        `<td>${fmtNum(p.evaluable)}</td></tr>`
      );
    })
    .join("");

  const sum = (f: (p: WorkloadPortRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totWorkload = sum((p) => p.workload);
  const totEvaluable = sum((p) => p.evaluable);
  const totCorrect = sum((p) => p.correct);
  const totCS = sum((p) => p.correctSuspicion);
  const totMS = sum((p) => p.missedSuspicion);
  const totRankable = isRankable(band(totEvaluable));
  const totAccuracy = totRankable ? pctCell(rateOf(totCorrect, totEvaluable)) : pctCell(null);
  const totMissed = totRankable ? pctCell(rateOf(totMS, totCS + totMS)) : pctCell(null);
  const totalsRow =
    `<tr><td>الإجمالي</td><td>${fmtNum(totWorkload)}</td>` +
    `<td>${totAccuracy}</td><td>${totMissed}</td><td>${fmtNum(totEvaluable)}</td></tr>`;

  return ledgerPortCard({
    title,
    theadCells: `<th>المنفذ</th><th>حجم الصور</th><th>الدقة</th><th>الاشتباه الفائت</th><th>العيّنة</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: TABLE_SPAN,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing-system workload rank list (fan-out plan §11a) — the bar magnitude
 * is WORKLOAD (population image count), never accuracy: this is a volume
 * ranking with accuracy riding along as descriptive context in the secondary
 * line, deliberately NOT the "worst/best accuracy first" pattern the section-2
 * accuracy pages use. Rows are kept in the page's OWN existing
 * workload-descending order: `landChunk`/`seaChunk` are each already
 * workload-desc slices of this page's ports (`collectWorkloadRows` sorts the
 * whole list once, before the land/sea split), so `combinedAll` below is
 * simply their concatenation with NO added `.sort()` — re-sorting here would
 * blur the "which port is busiest" reading this page exists to answer.
 *
 * The association-not-causation `CAVEAT` is rendered by the caller, verbatim,
 * in every one of the 4 body variants (the plan's standing rule) — it is
 * appended here as the last child of `.v2-sys-brief`, after the rank list.
 */
function briefingWorkloadRank(landChunk: WorkloadPortRow[], seaChunk: WorkloadPortRow[]): string {
  const combinedAll = [...landChunk, ...seaChunk];
  if (combinedAll.length === 0) {
    return `<div class="v2-sys-brief v2-bf-workload">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure gold"><span class="insuff">—</span></div></div>
      ${caveatNote()}
    </div>`;
  }

  // Busiest port ON THIS PAGE — max by workload, not combinedAll[0]: land and
  // sea are each individually workload-desc, but concatenating them does not
  // itself produce one workload-desc order across both groups combined.
  const busiest = combinedAll.reduce((a, b) => (b.workload > a.workload ? b : a));
  const busiestAccuracy = busiest.rankable ? accuracyOf(busiest) : null;

  const sum = (f: (p: WorkloadPortRow) => number) => combinedAll.reduce((s, p) => s + f(p), 0);
  const totWorkload = sum((p) => p.workload);
  const totEvaluable = sum((p) => p.evaluable);
  const totCorrect = sum((p) => p.correct);
  const totCS = sum((p) => p.correctSuspicion);
  const totMS = sum((p) => p.missedSuspicion);
  const totRankable = isRankable(band(totEvaluable));
  const pooledAccuracy = totRankable ? rateOf(totCorrect, totEvaluable) : null;
  const pooledMissed = totRankable ? rateOf(totMS, totCS + totMS) : null;

  const supportStrip = briefingSupport([
    { iconName: "chart", value: fmtNum(totWorkload), label: "إجمالي حجم الصور" },
    { iconName: "check", value: pctCell(pooledAccuracy), label: "الدقة المجمّعة" },
    { iconName: "alert", value: pctCell(pooledMissed), label: "الاشتباه الفائت المجمّع" },
  ]);
  const basis = `${portCountPhrase(combinedAll.length)} · ارتباط وصفي لا سببي`;

  const rankItems: BriefingRankItem[] = combinedAll.map((p) => ({
    label: p.name,
    value: p.workload,
    valueText: fmtNum(p.workload),
    secondaryText: `دقة ${pctCell(p.rankable ? accuracyOf(p) : null)}`,
  }));
  // Raw per-item workload/correct/evaluable, PARALLEL to rankItems, so
  // foldRemainder can pool the folded tail's workload sum and accuracy
  // correctly (never averaging each folded port's own rate) — same technique
  // every other pooled figure in this fan-out uses.
  const rawForFold = combinedAll.map((p) => ({
    workload: p.workload,
    correct: p.correct,
    evaluable: p.evaluable,
  }));

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "gold",
    scale: { kind: "auto" },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const foldedWorkload = raw.reduce((s, r) => s + r.workload, 0);
      const foldedCorrect = raw.reduce((s, r) => s + r.correct, 0);
      const foldedEvaluable = raw.reduce((s, r) => s + r.evaluable, 0);
      const foldedAccuracy = isRankable(band(foldedEvaluable)) ? rateOf(foldedCorrect, foldedEvaluable) : null;
      return {
        label: `بقية المنافذ (${fmtNum(folded.length)})`,
        value: foldedWorkload,
        valueText: fmtNum(foldedWorkload),
        secondaryText: `دقة ${pctCell(foldedAccuracy)}`,
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-workload">
    ${briefingLede({
      figure: pctCell(busiestAccuracy),
      tone: "gold",
      label: `أعلى المنافذ حجمًا: ${esc(busiest.name)} — دقة ${pctCell(busiestAccuracy)} على ${fmtNum(busiest.evaluable)} صورة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
    ${caveatNote()}
  </div>`;
}

/**
 * Grid-system workload matrix (fan-out plan §11a) — rows = ports, columns
 * حجم الصور / الدقة / الاشتباه الفائت / العيّنة, ALL `sequential-gold` (no
 * diverging ramp: this page's whole point is an association claim, not a
 * pass/fail split with a meaningful midpoint). Unrankable ports pass `null`
 * for the two rate columns while still showing حجم الصور/العيّنة — the same
 * "state what you can, omit what you can't" pattern the section-2 quality/
 * accuracy Grids use.
 */
function gridWorkloadMatrix(
  title: string,
  rows: WorkloadPortRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const accuracy = (p: WorkloadPortRow) => (p.rankable ? accuracyOf(p) : null);
  const missed = (p: WorkloadPortRow) => (p.rankable ? missedRateOf(p) : null);
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        {
          label: "حجم الصور",
          domain: [0, maxOf(rows.map((p) => p.workload))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.workload),
        },
        { label: "الدقة", domain: [0, 100], ramp: "sequential-gold", values: rows.map(accuracy) },
        { label: "الاشتباه الفائت", domain: [0, 100], ramp: "sequential-gold", values: rows.map(missed) },
        {
          label: "العيّنة",
          domain: [0, maxOf(rows.map((p) => p.evaluable))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.evaluable),
        },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ`,
    variant,
    chartHtml: matrix,
  });
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

/** Build one or more slides — paginated land/sea in parallel, exactly the
 *  `planPortPages`/`BASE_ROWS_PER_PAGE` convention every other land/sea page
 *  in this deck uses (`portPopulationSlideBuilders` et al. in slides.ts). */
export function workloadAccuracySlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
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

  const land = rows.filter((p) => !p.sea);
  const sea = rows.filter((p) => p.sea);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-wl-layout">
        <div class="v2-port-split v2-wl-split">${tableCard("المنافذ البرية", landChunk, "land", plan.compact)}${tableCard("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
        ${caveatNote()}
      </div>`;
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-workload">
        <div class="v2-lg-split">${ledgerWorkloadTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerWorkloadTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
        ${caveatNote()}
      </div>`;
      const briefingBody = briefingWorkloadRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-workload">
        <div class="v2-gd-split">${gridWorkloadMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridWorkloadMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
        ${caveatNote()}
      </div>`;
      return v2Slide({
        id: page === 0 ? SLIDE_ID : `${SLIDE_ID}-${page + 1}`,
        title: `${SLIDE_TITLE}${cont}`,
        eyebrow: EYEBROW,
        iconName: "chart",
        headline: `${SLIDE_TITLE}${cont}`,
        subhead: SUBHEAD,
        bodyVariants: [body, ledgerBody, briefingBody, gridBody],
        variantPreview,
        num,
        total,
        section: "section3",
      });
    });
  }
  return builders;
}

// ── CSS ─────────────────────────────────────────────────────────────────────
// Everything here is SCOPED to this page's own wrappers (`.v2-wl-*`) so it can
// neither alter the existing land/sea port pages nor collide with a sibling
// section-3 page's stylesheet. No raw hex literals (check:hex-literals): colors
// come from the theme's CSS variables, blended with color-mix where a tint is
// needed.
// NOTE: this page does NOT define its own land/sea card tint — `variant` alone
// (passed to `portTableCard`) is enough to pick up the shared `.v2-port-col
// .land`/`.sea` rules in theme.ts, the same ones every other land/sea page in
// the deck uses. A bespoke `.v2-port-col.blue` override used to live here and
// is exactly why this page's sea card looked different from every other sea
// card in the deck — removed rather than fixed in place.
export const WORKLOAD_ACCURACY_CSS = `
/* ── Section 3 · الأداء حسب حجم الأعمال ───────────────────────────────────── */
/* Ledger/Grid namespacing hooks (fan-out plan §11a, batch B2b) — each wraps
   its land/sea split PLUS the mandatory caveat strip in a flex column so the
   split grows to fill the slide body and the caveat sits pinned below it,
   mirroring slot 0's .v2-wl-layout above. Briefing needs no such wrapper:
   .v2-sys-brief is already a flex column (theme.ts), so the caveat simply
   joins the lede/support/rank list as its last flex child. */
.v2-lg-workload,.v2-gd-workload{display:flex;flex-direction:column;height:100%;gap:7px;min-height:0;}
.v2-lg-workload .v2-lg-split,.v2-gd-workload .v2-gd-split{flex:1 1 auto;min-height:0;}
.v2-bf-workload{height:100%;}
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
/* Page shell: wraps the tables (or the empty state) plus the caveat strip
   below them. The caveat's own top border is dropped here since the wrapper
   already separates it visually with its flex gap. */
.v2-wl-layout{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;}
.v2-wl-layout .v2-wl-caveat{border-top:0;padding:0 2px;}
.v2-wl-layout .v2-port-split{flex:1 1 auto;min-height:0;}
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
`;
