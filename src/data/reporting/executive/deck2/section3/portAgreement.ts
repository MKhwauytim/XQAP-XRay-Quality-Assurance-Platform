// Executive deck v2 — القسم 3, per-port level agreement (توافق المستويات حسب المنفذ).
//
// The question this page answers: **which ports show the most internal
// disagreement between our two X-ray inspection levels, and how does each level
// line up with the study reviewer there?**
//
// Two facts this page is built to never misrepresent:
//
//  1. "المستوى الأول / المستوى الثاني" HERE are the two X-ray *inspection
//     levels* — the two passes every image goes through. They are a different
//     axis from the four risk levels (المستوى الأول–الرابع), which are
//     categorical detection scenarios and NOT a severity ranking. Nothing on
//     this page ranks, orders, or describes a level as more/less severe than
//     another; the only ordering applied is by agreement rate.
//
//  2. **The two denominators are different bases and the page says so.**
//     اتفاق المستويين is computed over the WHOLE month's population at that
//     port (both levels answer every image). Anything involving المراجع is
//     computed over the STUDIED SAMPLE only, because the reviewer only answers
//     sampled images. Both `n`s are printed as their own columns, and the
//     footnote strip under the tables states the caveat in full. A reader must
//     never be able to read the two rates as sharing a base.
//
// Everything here is pure: no `Date`, no `Math.random`, no I/O — the same
// (model, variantPreview) pair always yields byte-identical HTML.

import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
// `fmtPct` is intentionally NOT imported: every percentage on this page goes
// through `threshCell`/`pctCell`, which already apply the denominator gate and
// the muted "—" fallback. Formatting a rate directly would bypass both.
import { esc, fmtNum } from "../../primitives";
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
import type { BriefingRankItem, CellTone, SlideBuilder } from "../slideKit";

/** Column count of the agreement table — six, so `fillerRow`/`colspan` stay in
 *  one place rather than being retyped at each call site. */
const COL_SPAN = 6;

/** Tones for the two count columns. Deliberately different from each other so
 *  the population base and the sample base never read as one column pair.
 *  Neither is threshold-scored — these are magnitudes, not scores. */
const POP_COUNT_TONE: CellTone = "neutral";
const SAMPLE_COUNT_TONE: CellTone = "blue";

const MUTED_CELL = `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;

/** The scope caveat. Rendered on every page of this slide (continuations
 *  included) because a continuation page is read on its own just as often. */
const SCOPE_NOTE =
  "اتفاق المستويين محسوب على مجتمع الشهر كاملًا في المنفذ (عمود المجتمع)، " +
  "أمّا مطابقة كل مستوى لنتيجة المراجع فتُحسب على العيّنة المدروسة فقط (عمود العيّنة) " +
  "لأن المراجع لا يبدي نتيجته إلا على الصور المسحوبة في العيّنة — الأساسان مختلفان، " +
  "ولا تصحّ المقارنة المباشرة بين النسبتين.";

const UNNAMED_PORT = "غير محدد";

type PortAgreementRow = {
  name: string;
  sea: boolean;
  /** Images at this port where BOTH inspection levels have a result. */
  l1l2Comparable: number;
  l1l2Agree: number;
  /** Images at this port where level one AND the reviewer both have a result. */
  l1RevComparable: number;
  l1RevAgree: number;
  /** Same for level two. Normally equal to `l1RevComparable` (population entry
   *  requires both level results), but gated independently so a future source
   *  with a missing level result cannot silently borrow the other level's base. */
  l2RevComparable: number;
  l2RevAgree: number;
  /** Images at this port carrying a reviewer result at all — the sample base
   *  printed in the العيّنة column. */
  reviewed: number;
};

function emptyRow(name: string, sea: boolean): PortAgreementRow {
  return {
    name,
    sea,
    l1l2Comparable: 0,
    l1l2Agree: 0,
    l1RevComparable: 0,
    l1RevAgree: 0,
    l2RevComparable: 0,
    l2RevAgree: 0,
    reviewed: 0,
  };
}

/**
 * Fold `model.resultComparison.images` into one tally per port.
 *
 * Land/sea is derived from `model.rows[].portType` (`includes("بحري")`), exactly
 * how the section-2 port tables split their columns — the comparison records
 * carry only `portName`, so the port-type lookup has to come from the rows.
 */
function collectPortAgreementRows(model: ReportModel): { land: PortAgreementRow[]; sea: PortAgreementRow[] } {
  const seaByPort = new Map<string, boolean>();
  for (const r of model.rows) {
    const name = r.portName ?? UNNAMED_PORT;
    if (!seaByPort.has(name)) seaByPort.set(name, (r.portType ?? "").includes("بحري"));
  }

  const map = new Map<string, PortAgreementRow>();
  for (const img of model.resultComparison.images) {
    const name = img.portName ?? UNNAMED_PORT;
    let cur = map.get(name);
    if (!cur) {
      cur = emptyRow(name, seaByPort.get(name) ?? false);
      map.set(name, cur);
    }
    const { levelOne, levelTwo, review } = img.results;

    // Whole-population axis: the two inspection levels against each other.
    if (levelOne !== null && levelTwo !== null) {
      cur.l1l2Comparable += 1;
      if (levelOne === levelTwo) cur.l1l2Agree += 1;
    }

    // Studied-sample axis: each level against the reviewer, each on its own base.
    if (review !== null) {
      cur.reviewed += 1;
      if (levelOne !== null) {
        cur.l1RevComparable += 1;
        if (levelOne === review) cur.l1RevAgree += 1;
      }
      if (levelTwo !== null) {
        cur.l2RevComparable += 1;
        if (levelTwo === review) cur.l2RevAgree += 1;
      }
    }
  }

  const all = orderRows([...map.values()]);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

/**
 * Lowest level-agreement first — the disagreement ports are the story. Only
 * RANKABLE ports (data-sufficiency `limited`/`sufficient` on their OWN L1↔L2
 * comparable count) take part in that ordering; everything below the cut is
 * parked after them, largest base first, since its rate is not shown at all.
 * The final tiebreak is the port name, so the order is total and deterministic.
 */
function orderRows(rows: PortAgreementRow[]): PortAgreementRow[] {
  return [...rows].sort((a, b) => {
    const aRank = isRankable(band(a.l1l2Comparable));
    const bRank = isRankable(band(b.l1l2Comparable));
    if (aRank !== bRank) return aRank ? -1 : 1;
    if (aRank && bRank) {
      const aRate = a.l1l2Agree / a.l1l2Comparable;
      const bRate = b.l1l2Agree / b.l1l2Comparable;
      if (aRate !== bRate) return aRate - bRate;
    }
    if (a.l1l2Comparable !== b.l1l2Comparable) return b.l1l2Comparable - a.l1l2Comparable;
    return a.name.localeCompare(b.name, "ar");
  });
}

function agreementTable(
  title: string,
  rows: PortAgreementRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const popMax = maxOf(rows.map((p) => p.l1l2Comparable));
  const sampleMax = maxOf(rows.map((p) => p.reviewed));

  const trs =
    rows.length > 0
      ? rows
          .map((p) => {
            // Every rate is gated on ITS OWN denominator's sufficiency band, so a
            // port with a solid population base but a thin sample still shows its
            // level-agreement and mutes only the reviewer-match columns.
            const gate = (rankable: boolean, num: number, den: number) =>
              rankable ? threshCell(rateOf(num, den), ACCURACY_TARGET) : MUTED_CELL;
            return (
              `<tr><td>${esc(p.name)}</td>` +
              gate(isRankable(band(p.l1l2Comparable)), p.l1l2Agree, p.l1l2Comparable) +
              barCell(fmtNum(p.l1l2Comparable), (p.l1l2Comparable / popMax) * 100, POP_COUNT_TONE) +
              gate(isRankable(band(p.l1RevComparable)), p.l1RevAgree, p.l1RevComparable) +
              gate(isRankable(band(p.l2RevComparable)), p.l2RevAgree, p.l2RevComparable) +
              barCell(fmtNum(p.reviewed), (p.reviewed / sampleMax) * 100, SAMPLE_COUNT_TONE) +
              `</tr>`
            );
          })
          .join("")
      : `<tr><td colspan="${COL_SPAN}"><span class="insuff">—</span></td></tr>`;

  const sum = (f: (p: PortAgreementRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalL1L2 = sum((p) => p.l1l2Comparable);
  const totalL1Rev = sum((p) => p.l1RevComparable);
  const totalL2Rev = sum((p) => p.l2RevComparable);
  const totalsRow =
    `<tr><td>الإجمالي</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l1l2Agree), totalL1L2))}</td>` +
    `<td>${fmtNum(totalL1L2)}</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l1RevAgree), totalL1Rev))}</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l2RevAgree), totalL2Rev))}</td>` +
    `<td>${fmtNum(sum((p) => p.reviewed))}</td></tr>`;

  const ths =
    `<th>المنفذ</th><th>اتفاق المستويين</th><th>المجتمع</th>` +
    `<th>مطابقة الأول للمراجع</th><th>مطابقة الثاني للمراجع</th><th>العيّنة</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  // `land`/`sea` drive the shared theme.ts card rules (`.v2-port-col.sea` is the
  // blue treatment); `green`/`blue` are the section-3 colour names. Both are
  // emitted so the card looks exactly like its section-2 siblings.
  const tone = variant === "land" ? "green" : "blue";

  return portTableCard({
    title,
    headSub: `${fmtNum(rows.length)} منفذ`,
    headIcon,
    variant,
    compact,
    extraClass: tone,
    theadCells: ths,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span: COL_SPAN,
    totalsRowHtml: totalsRow,
  });
}

/** The `SCOPE_NOTE` strip, extracted so all 4 body variants (slot 0 plus the
 *  Ledger/Briefing/Grid fan-out below) render the exact same verbatim markup —
 *  the plan's standing rule for mandatory prose. */
function scopeNote(): string {
  return `<div class="v2-agree-note"><span class="v2-agree-note-icon">${icon("alert", 11)}</span><span>${esc(SCOPE_NOTE)}</span></div>`;
}

/**
 * Ledger-system agreement table (fan-out plan §11c, batch B2b) — keeps ALL SIX
 * columns (the plan is explicit: Ledger must not drop a column to fit), plus
 * an ordinal badge, through the shared `ledgerPortCard` (P2). Rendered under
 * the page-specific `.v2-lg-agree` scope class (this file's own CSS export,
 * below) so the 6-column squeeze this page needs never leaks onto any other
 * Ledger port card in the deck — a MIRROR of the slot-0 squeeze
 * (`.v2-agree-split .v2-port-col`, below) re-targeted at `.v2-lg-port-card`,
 * not an inherited, unscoped, "hope it fits" reuse.
 */
function ledgerAgreementTable(
  title: string,
  rows: PortAgreementRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const popMax = maxOf(rows.map((p) => p.l1l2Comparable));
  const sampleMax = maxOf(rows.map((p) => p.reviewed));

  const trs = rows
    .map((p, i) => {
      const gate = (rankable: boolean, num: number, den: number) =>
        rankable ? threshCell(rateOf(num, den), ACCURACY_TARGET) : MUTED_CELL;
      return (
        `<tr><td>${ledgerIdx(i)}${esc(p.name)}</td>` +
        gate(isRankable(band(p.l1l2Comparable)), p.l1l2Agree, p.l1l2Comparable) +
        barCell(fmtNum(p.l1l2Comparable), (p.l1l2Comparable / popMax) * 100, POP_COUNT_TONE) +
        gate(isRankable(band(p.l1RevComparable)), p.l1RevAgree, p.l1RevComparable) +
        gate(isRankable(band(p.l2RevComparable)), p.l2RevAgree, p.l2RevComparable) +
        barCell(fmtNum(p.reviewed), (p.reviewed / sampleMax) * 100, SAMPLE_COUNT_TONE) +
        `</tr>`
      );
    })
    .join("");

  const sum = (f: (p: PortAgreementRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const totalL1L2 = sum((p) => p.l1l2Comparable);
  const totalL1Rev = sum((p) => p.l1RevComparable);
  const totalL2Rev = sum((p) => p.l2RevComparable);
  const totalsRow =
    `<tr><td>الإجمالي</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l1l2Agree), totalL1L2))}</td>` +
    `<td>${fmtNum(totalL1L2)}</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l1RevAgree), totalL1Rev))}</td>` +
    `<td>${pctCell(rateOf(sum((p) => p.l2RevAgree), totalL2Rev))}</td>` +
    `<td>${fmtNum(sum((p) => p.reviewed))}</td></tr>`;

  return ledgerPortCard({
    title,
    theadCells:
      `<th>المنفذ</th><th>اتفاق المستويين</th><th>المجتمع</th>` +
      `<th>مطابقة الأول للمراجع</th><th>مطابقة الثاني للمراجع</th><th>العيّنة</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span: COL_SPAN,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing-system agreement rank list (fan-out plan §11c) — the lede is
 * pooled اتفاق المستويين on the POPULATION basis («على المجتمع»), while the
 * support strip's two match-rate items are explicitly labelled «(على
 * العيّنة)» — the two are DIFFERENT denominators and must never read as one
 * figure, per this page's whole reason for existing (see the file's own doc
 * comment, point 2). Rank rows are kept in the page's OWN existing ordering
 * (`orderRows`'s ascending, disagreement-first order — `landChunk`/
 * `seaChunk` are already sorted that way before pagination), so `combinedAll`
 * below is a plain concatenation with NO added `.sort()`, same as
 * `briefingWorkloadRank`. Ports below the l1↔l2 sufficiency cut are excluded
 * from ranking and folded into a bar-less remainder, pooled from summed
 * agree/comparable counts — never averaged. `SCOPE_NOTE` is rendered
 * verbatim as this variant's last child, same placement as slot 0.
 */
function briefingAgreementRank(landChunk: PortAgreementRow[], seaChunk: PortAgreementRow[]): string {
  const combinedAll = [...landChunk, ...seaChunk];
  if (combinedAll.length === 0) {
    return `<div class="v2-sys-brief v2-bf-agree">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure gold"><span class="insuff">—</span></div></div>
      ${scopeNote()}
    </div>`;
  }

  const sum = (f: (p: PortAgreementRow) => number) => combinedAll.reduce((s, p) => s + f(p), 0);
  const totalL1L2 = sum((p) => p.l1l2Comparable);
  const totalL1L2Agree = sum((p) => p.l1l2Agree);
  const totalL1Rev = sum((p) => p.l1RevComparable);
  const totalL1RevAgree = sum((p) => p.l1RevAgree);
  const totalL2Rev = sum((p) => p.l2RevComparable);
  const totalL2RevAgree = sum((p) => p.l2RevAgree);
  const totalReviewed = sum((p) => p.reviewed);
  const pooledAgreement = rateOf(totalL1L2Agree, totalL1L2);

  const supportStrip = briefingSupport([
    { iconName: "check", value: pctCell(rateOf(totalL1RevAgree, totalL1Rev)), label: "مطابقة الأول (على العيّنة)" },
    { iconName: "check", value: pctCell(rateOf(totalL2RevAgree, totalL2Rev)), label: "مطابقة الثاني (على العيّنة)" },
    { iconName: "scan", value: fmtNum(totalReviewed), label: "العيّنة المراجَعة" },
  ]);
  const basis = `${portCountPhrase(combinedAll.length)} · أساس المجتمع`;

  const rankable = combinedAll.filter((p) => isRankable(band(p.l1l2Comparable)));
  const excluded = combinedAll.filter((p) => !isRankable(band(p.l1l2Comparable)));

  const rankItems: BriefingRankItem[] = rankable.map((p) => {
    const rate = rateOf(p.l1l2Agree, p.l1l2Comparable);
    return {
      label: p.name,
      value: rate,
      valueText: pctCell(rate),
      secondaryText: `المجتمع ${fmtNum(p.l1l2Comparable)}`,
    };
  });
  // Raw per-item agree/comparable counts, PARALLEL to rankItems (plus one
  // synthetic slot pooling the whole excluded group), so foldRemainder can
  // recover a real pooled rate for whatever tail actually gets folded — same
  // technique briefingQualityRank/briefingAccuracyRank use (slides.ts).
  const rawForFold: Array<{ agree: number; comparable: number }> = rankable.map((p) => ({
    agree: p.l1l2Agree,
    comparable: p.l1l2Comparable,
  }));
  if (excluded.length > 0) {
    rankItems.push({
      label: `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
    });
    rawForFold.push({
      agree: excluded.reduce((s, p) => s + p.l1l2Agree, 0),
      comparable: excluded.reduce((s, p) => s + p.l1l2Comparable, 0),
    });
  }

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "gold",
    scale: { kind: "fixed", max: 100 },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const foldedAgree = raw.reduce((s, r) => s + r.agree, 0);
      const foldedComparable = raw.reduce((s, r) => s + r.comparable, 0);
      const rate = rateOf(foldedAgree, foldedComparable);
      const isPureExclusion = excluded.length > 0 && folded.length === 1 && folded[0].value === null;
      return {
        label: isPureExclusion
          ? `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`
          : `بقية المنافذ (${fmtNum(folded.length)})`,
        value: rate,
        valueText: pctCell(rate),
        secondaryText: foldedComparable > 0 ? `المجتمع ${fmtNum(foldedComparable)}` : "",
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-agree">
    ${briefingLede({
      figure: pctCell(pooledAgreement),
      tone: "gold",
      label: `اتفاق المستويين ${pctCell(pooledAgreement)} — ${fmtNum(totalL1L2Agree)} من ${fmtNum(totalL1L2)} صورة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
    ${scopeNote()}
  </div>`;
}

/**
 * Grid-system agreement matrix (fan-out plan §11c) — only FOUR columns
 * (اتفاق المستويين / مطابقة الأول / مطابقة الثاني / العيّنة): المجتمع is
 * dropped as an independent column because it is column 1's DENOMINATOR, not
 * a separate metric — encoding it as a fifth column would double-count the
 * same figure `metricMatrix` already implies via اتفاق المستويين's own scale.
 * Both denominators (population for اتفاق المستويين, sample for the two
 * مطابقة columns) are instead disclosed in the panel head sub-line, so
 * nothing about the basis split is hidden — just not double-encoded as a
 * column, per the plan.
 */
function gridAgreementMatrix(
  title: string,
  rows: PortAgreementRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const l1l2Rate = (p: PortAgreementRow) =>
    isRankable(band(p.l1l2Comparable)) ? rateOf(p.l1l2Agree, p.l1l2Comparable) : null;
  const l1RevRate = (p: PortAgreementRow) =>
    isRankable(band(p.l1RevComparable)) ? rateOf(p.l1RevAgree, p.l1RevComparable) : null;
  const l2RevRate = (p: PortAgreementRow) =>
    isRankable(band(p.l2RevComparable)) ? rateOf(p.l2RevAgree, p.l2RevComparable) : null;
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        { label: "اتفاق المستويين", domain: [0, 100], ramp: "sequential-gold", values: rows.map(l1l2Rate) },
        { label: "مطابقة الأول", domain: [0, 100], ramp: "sequential-gold", values: rows.map(l1RevRate) },
        { label: "مطابقة الثاني", domain: [0, 100], ramp: "sequential-gold", values: rows.map(l2RevRate) },
        {
          label: "العيّنة",
          domain: [0, maxOf(rows.map((p) => p.reviewed))],
          ramp: "sequential-gold",
          values: rows.map((p) => p.reviewed),
        },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ · اتفاق المستويين على المجتمع، والمطابقة على العيّنة`,
    variant,
    chartHtml: matrix,
  });
}

/**
 * Build the per-port level-agreement page(s). Land and sea paginate in parallel
 * on the shared port-page plan (`planPortPages`), same as the section-2 port
 * tables, and continuation pages carry the "(تابع)" suffix in their title and
 * headline so a page pulled out of context still reads correctly.
 *
 * NOTE: this is the PER-PORT view. The overall 6×6 source-agreement matrix is a
 * separate section-3 page — nothing here duplicates it.
 */
export function portAgreementSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortAgreementRows(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];

  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    const suffix = plan.pages > 1 ? `-${page + 1}` : "";

    builders.push((num, total) => {
      const body = `<div class="v2-agree-wrap">
    <div class="v2-port-split v2-agree-split">${agreementTable("المنافذ البرية", landChunk, "land", plan.compact)}${agreementTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
    ${scopeNote()}
  </div>`;
      const ledgerBody = `<div class="v2-sys-ledger v2-lg-agree">
    <div class="v2-agree-wrap">
      <div class="v2-lg-split">${ledgerAgreementTable("المنافذ البرية", landChunk, "land", plan.compact)}${ledgerAgreementTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
      ${scopeNote()}
    </div>
  </div>`;
      const briefingBody = briefingAgreementRank(landChunk, seaChunk);
      const gridBody = `<div class="v2-sys-grid v2-gd-agree">
    <div class="v2-agree-wrap">
      <div class="v2-gd-split">${gridAgreementMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridAgreementMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>
      ${scopeNote()}
    </div>
  </div>`;
      return v2Slide({
        id: `slide-s3-port-agreement${suffix}`,
        title: `توافق المستويات حسب المنفذ${cont}`,
        eyebrow: "القسم 3 — التحاليل المتقدمة",
        iconName: "port",
        headline: `توافق المستويات حسب المنفذ${cont}`,
        subhead:
          "نسبة اتفاق المستوى الأول والثاني على النتيجة في كل منفذ، ومطابقة كل مستوى لنتيجة المراجع.",
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

/**
 * Page-local CSS. Six columns per card is double what the section-2 port tables
 * carry, in the same two-up `.v2-port-split` inside the same 459px body, so the
 * shared `.v2-port-col` padding/font would overflow horizontally. Everything
 * here is a fluid override of metrics only (no widths, no colours outside the
 * deck's own variables) — layout stays driven by the shared classes.
 *
 * Header cells wrap to two short lines rather than one long one: that is
 * NARROWER, and at `line-height:1.15` a two-line head still lands under the
 * ~41px thead height that `BASE_ROWS_PER_PAGE` was measured against, so the row
 * budget stays valid.
 */
export const PORT_AGREEMENT_CSS = `
/* ── Section 3 — توافق المستويات حسب المنفذ ──────────────────────────────── */
.v2-agree-wrap{display:flex;flex-direction:column;gap:7px;height:100%;min-height:0;}
.v2-agree-wrap .v2-port-split,
.v2-agree-wrap .v2-lg-split,
.v2-agree-wrap .v2-gd-split{flex:1 1 auto;min-height:0;}
.v2-agree-split .v2-port-col .deck-table th{
  white-space:normal;line-height:1.15;font-size:0.6rem;padding:6px 4px;vertical-align:middle;
}
.v2-agree-split .v2-port-col .deck-table td{font-size:0.68rem;padding:9px 4px;}
.v2-agree-split .v2-port-col.compact .deck-table th{font-size:0.54rem;padding:3px 3px;}
.v2-agree-split .v2-port-col.compact .deck-table td{font-size:0.58rem;padding:3px 3px;}
/* Long Arabic port names break instead of forcing the numeric columns out of
   the card (which clips its own overflow). */
.v2-agree-split .v2-port-col .deck-table th:first-child,
.v2-agree-split .v2-port-col .deck-table td:first-child{overflow-wrap:anywhere;}
/* ── Ledger 6-column squeeze, MIRRORED for .v2-lg-port-card (fan-out plan
   §11c, batch B2b) ───────────────────────────────────────────────────────
   Scoped to .v2-lg-agree so this tight sizing never bleeds onto any other
   Ledger port card in the deck (every other one carries 4-5 columns at the
   larger default .v2-lg-port-card sizing in theme.ts: 9px/12px padding,
   .78rem/.68rem font). The numeric ratios below mirror the slot-0 squeeze
   immediately above it, just re-based off the Ledger card's own (larger)
   defaults instead of .v2-port-col's. */
.v2-lg-agree .v2-lg-port-card .deck-table th{
  white-space:normal;line-height:1.15;font-size:0.62rem;padding:6px 5px;vertical-align:middle;
}
.v2-lg-agree .v2-lg-port-card .deck-table td{font-size:0.7rem;padding:8px 5px;}
.v2-lg-agree .v2-lg-port-card.compact .deck-table th{font-size:0.56rem;padding:3px 4px;}
.v2-lg-agree .v2-lg-port-card.compact .deck-table td{font-size:0.6rem;padding:3px 4px;}
.v2-lg-agree .v2-lg-port-card .deck-table th:first-child,
.v2-lg-agree .v2-lg-port-card .deck-table td:first-child{overflow-wrap:anywhere;}
.v2-lg-agree .v2-lg-port-card .v2-lg-idx{width:16px;height:16px;font-size:.56rem;margin-inline-end:5px;}
.v2-lg-agree .v2-lg-port-card.compact .v2-lg-idx{width:14px;height:14px;font-size:.5rem;margin-inline-end:4px;}
/* Briefing/Grid namespacing hooks — "nothing bespoke beyond the shared
   components" role, same as every other fanned-out page's page-local hook. */
.v2-bf-agree,.v2-gd-agree{height:100%;}
.v2-gd-agree .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-agree .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-agree .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-agree .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-agree .v2-gd-panel.land .v2-gd-panel-head span{color:color-mix(in srgb, var(--green) 70%, black);}
body.theme-light .v2-gd-agree .v2-gd-panel.sea .v2-gd-panel-head span{color:color-mix(in srgb, var(--blue) 70%, black);}
/* Scope caveat strip: the two n columns on this page are DIFFERENT bases. */
.v2-agree-note{
  display:flex;align-items:flex-start;gap:7px;flex:0 0 auto;
  padding:5px 10px;border-radius:9px;
  border:1px solid rgba(244,180,0,.28);background:rgba(244,180,0,.08);
  color:var(--muted);font-size:0.6rem;font-weight:600;line-height:1.35;
}
.v2-agree-note-icon{display:inline-flex;color:var(--gold);flex-shrink:0;margin-top:1px;}
@media print{.v2-agree-note{break-inside:avoid;}}
@media (max-width:900px){
  .v2-agree-wrap{height:auto;}
  .v2-agree-split .v2-port-col .deck-table th{font-size:0.66rem;}
  .v2-agree-split .v2-port-col .deck-table td{font-size:0.72rem;}
}
`;
