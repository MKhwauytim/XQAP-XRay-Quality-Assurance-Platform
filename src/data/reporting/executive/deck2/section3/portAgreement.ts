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
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
  barCell,
  maxOf,
  pctCell,
  planPortPages,
  portTableCard,
  rateOf,
  threshCell,
  v2Slide,
} from "../slideKit";
import type { CellTone, SlideBuilder } from "../slideKit";

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
    <div class="v2-agree-note"><span class="v2-agree-note-icon">${icon("alert", 11)}</span><span>${esc(SCOPE_NOTE)}</span></div>
  </div>`;
      return v2Slide({
        id: `slide-s3-port-agreement${suffix}`,
        title: `توافق المستويات حسب المنفذ${cont}`,
        eyebrow: "القسم 3 — التحاليل المتقدمة",
        iconName: "port",
        headline: `توافق المستويات حسب المنفذ${cont}`,
        subhead:
          "نسبة اتفاق المستوى الأول والثاني على النتيجة في كل منفذ، ومطابقة كل مستوى لنتيجة المراجع.",
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
.v2-agree-wrap .v2-port-split{flex:1 1 auto;min-height:0;}
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
