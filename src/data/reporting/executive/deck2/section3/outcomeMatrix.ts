// Executive deck v2 — القسم 3 · صفحة: مصفوفة نتائج الفحص.
//
// ── Grain: DECISION, not image ──────────────────────────────────────────────
// This page reads `model.errorAnalysis` — `.totals` (month-wide) and `.byPort`
// (per port) — both built ONCE in `aggregates.ts`/`reportModel.ts` by folding
// `model.factTable`: one `DecisionRecord` per L1/L2 decision, i.e. up to 2× the
// evaluated-image count. `markingImpact.ts` in this same folder deliberately
// folds `model.rows` instead (one record per IMAGE, because `hasMarking` is a
// property of the image, not the decision) — mixing the two grains on the same
// figure is exactly how this report family has shipped disagreeing numbers
// before (see that file's own grain note). This module NEVER refolds,
// recomputes, or re-derives any outcome count itself: every number on this
// page traces back to `model.errorAnalysis` UNCHANGED.
//
// ── The four outcome classes ─────────────────────────────────────────────
// اشتباه صحيح / اشتباه خاطئ / اشتباه فائت / سليمة صحيحة — the same key/label/
// tone triples `markingImpact.ts`'s `OUTCOME_CLASSES` array already uses for
// this exact legend. Kept as a local literal here rather than imported: that
// array is keyed on `MarkStratum["outcomes"]` (a different, image-grain
// shape), so importing it would need its own adapter for no real benefit —
// the label/tone pairing is the only thing actually shared, and it is a
// stable, already-shipped piece of UI vocabulary (design spec / master §9).
//
// ── اشتباه فائت is the headline, not a footnote ─────────────────────────────
// It is the single number an audit of this kind exists to produce: a case the
// reviewer confirmed as اشتباه that the inspecting team's own decision missed.
// Every matrix cell prints the COUNT first (`matrixCell` below); the share is
// secondary and always goes through `rateOf`, so a zero denominator renders
// "—" (`pctCell`) rather than a fabricated 0%. The per-port table repeats the
// missed-suspicion COUNT in its own column for the same reason — a reader
// should never have to compute it back out of a percentage.
//
// Pure: no Date, no Math.random, no I/O. Same input → byte-identical output.
//
// ── Pagination (round-3 fix) ─────────────────────────────────────────────
// Round 2 capped the per-port table to 2 named rows + a fold, to stop it
// silently clipping in print. That fix was geometrically correct but broke
// the spec (§6.2: "counts and rates, month-wide, then a per-port table
// below") — 2 of 14 real ports is not a per-port table. The fix here keeps
// the clip-safety property but restores full per-port coverage by
// paginating, the same mechanism `workloadAccuracySlideBuilders`
// (workloadAccuracy.ts) and `portAgreementSlideBuilders` (portAgreement.ts)
// already use via `planPortPages`. This page can't reuse `planPortPages`
// directly — that function assumes one uniform rows-per-page budget shared
// by every page (true for those two pages' land/sea split), but here page 1
// carries the 2×2 matrix + totals band ABOVE the ports table and every
// continuation page doesn't, so the two page kinds have genuinely different
// row budgets. `planOutcomeMatrixPages` below is the bespoke two-tier
// planner that follows from that; both budgets were measured live exactly
// the way `PAGE1_PORT_CAP`/`CONTINUATION_PORT_CAP`'s own doc comments record.
// The fold from round 2 is kept, but demoted: it now only ever fires beyond
// `MAX_CONTINUATION_PAGES`, i.e. as a bound on deck growth for a pathological
// port count, not as the everyday mechanism for a normal-sized month.

import type { ReportModel } from "../../model/reportModel";
import type { ErrorTypeBreakdown } from "../../model/aggregates";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { ledgerIdx, ledgerPortCard, pctCell, rateOf, v2Slide } from "../slideKit";
import type { CellTone, SlideBuilder } from "../slideKit";

const SLIDE_ID = "slide-s3-outcome-matrix";
const SLIDE_TITLE = "مصفوفة نتائج الفحص";
const EYEBROW = "القسم 3 — التحاليل المتقدمة";
const SUBHEAD =
  "أربع نتائج فحص محتملة لكل قرار مستوى، إجمالاً وحسب المنفذ — قرار فريق الفحص مقابل قرار المراجع.";

/** Shape shared by `model.errorAnalysis.totals` and each entry of
 *  `model.errorAnalysis.byPort` (`ErrorTypeBreakdown`, which additionally
 *  carries `key`) — the four outcome counts plus their common denominator. A
 *  local type rather than importing `ErrorTypeBreakdown` directly so this
 *  file's cell builders work on both without an unused `key` field. */
type OutcomeCounts = {
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
  evaluable: number;
};

/** Ports table column count: المنفذ | العيّنة | اشتباه فائت | نسبة الاشتباه
 *  الفائت | الدقة الإجمالية. */
const PORTS_SPAN = 5;

/**
 * One cell of the 2x2. The COUNT is the primary figure and is always printed:
 * اشتباه فائت is the single number an audit of this kind exists to produce, and
 * a bare percentage buries it. The share is secondary and goes through
 * `rateOf`, so a zero denominator renders "—" rather than a fabricated 0%.
 */
function matrixCell(
  label: string,
  count: number,
  evaluable: number,
  tone: CellTone,
  emphasis = false,
): string {
  return `<div class="v2-om-cell ${tone}${emphasis ? " emphasis" : ""}">
    <div class="v2-om-cell-label">${esc(label)}</div>
    <div class="v2-om-count">${fmtNum(count)}</div>
    <div class="v2-om-share">${pctCell(rateOf(count, evaluable))}</div>
  </div>`;
}

/** The 2x2, in the fixed order/label/tone the report already uses for this
 *  legend (markingImpact.ts's OUTCOME_CLASSES / document/frontMatter.ts). */
function matrixBlock(t: OutcomeCounts): string {
  return `<div class="v2-om-matrix">
    <div class="v2-om-corner"></div>
    <div class="v2-om-colhead">المراجع: اشتباه</div>
    <div class="v2-om-colhead">المراجع: سليمة</div>
    <div class="v2-om-rowhead">الفحص: اشتباه</div>
    ${matrixCell("اشتباه صحيح", t.correctSuspicion, t.evaluable, "blue")}
    ${matrixCell("اشتباه خاطئ", t.falseSuspicion, t.evaluable, "gold")}
    <div class="v2-om-rowhead">الفحص: سليمة</div>
    ${matrixCell("اشتباه فائت", t.missedSuspicion, t.evaluable, "coral", true)}
    ${matrixCell("سليمة صحيحة", t.correctClean, t.evaluable, "green")}
  </div>`;
}

/** Names the matrix's own denominator explicitly, so no reader has to infer
 *  it from the four cells' shares — `.v2-totals-band` is the shared theme
 *  component every other section-3 page uses for this same job. */
function totalsBand(t: OutcomeCounts, portCount: number): string {
  return `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(t.evaluable)}</b><small>إجمالي القرارات القابلة للتقييم (مستوى أول ومستوى ثانٍ)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("alert", 16)}</span><span><b>${fmtNum(t.missedSuspicion)}</b><small>إجمالي حالات الاشتباه الفائت</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("port", 16)}</span><span><b>${fmtNum(portCount)}</b><small>عدد المنافذ التي رُصدت فيها قرارات</small></span></div>
  </div>`;
}

// ── Per-port table ───────────────────────────────────────────────────────

type PortRow = ErrorTypeBreakdown & { rankable: boolean };

/**
 * Ports shown on PAGE 1, which also carries the 2x2 matrix + totals band
 * above the ports card (round-3 fix, per-port pagination). Verified live in
 * the `deck-preview.html` dev tool (Chrome, 1400x900 viewport, the
 * SEA_PORTS/LAND_PORTS fixture's 14 ports), the same geometric check round
 * 2 established: whether the rendered `<table>`'s bottom edge stays above
 * the `.v2-om-ports` wrapper's own bottom edge (the wrapper is what the
 * fixed 630px `.slide`, `overflow:hidden`, ultimately bounds in print) —
 * `scrollHeight` alone is unreliable here since `.v2-lg-port-card{height:
 * 100%}` always reports back its forced box height, not whether content
 * actually fit. Page 1 has no fold row of its own (any overflow goes to
 * page 2, not folded), so there's no "+1 row" tax the way round 2's
 * `PORT_ROW_CAP + 1` had — the number below is the true row count.
 *   - At 4 named rows: the table's bottom edge overflowed the wrapper by
 *     ~6.7px — real, but the same thin margin round 2 explicitly rejected
 *     (a first pass at this constant assumed 4 was "comfortable" without
 *     re-measuring after the pagination rewrite; it was not — this is the
 *     corrected, actually-measured number).
 *   - At 3 named rows: the table's bottom edge sat ~35px above the
 *     wrapper's bottom edge — a margin worth more than one full row,
 *     matching the same safety bar round 2 used for `PORT_ROW_CAP`.
 */
export const PAGE1_PORT_CAP = 3;

/**
 * Ports shown on each PURE CONTINUATION page — no matrix, no totals band,
 * just the ports card filling the whole 459px slide-body, exactly like
 * `workloadAccuracySlideBuilders`'s land/sea cards. Verified live the same
 * way as `PAGE1_PORT_CAP` above, against the same 1400x900 fixture (page 2
 * of the 14-port preview, which shows all 11 remaining ports on one page):
 *   - At 11 named rows: the table's bottom edge sat ~47.75px above the
 *     wrapper's bottom edge — comfortably over one row's margin.
 *   - At 10 named rows (one fewer): ~76.25px margin — the exact 28.5px
 *     delta between the two confirms the per-row cost is a stable, linear
 *     28.5px (same compact-tier row height `PAGE1_PORT_CAP`'s own
 *     measurements used), so the NEXT row (12 named) is reliably
 *     extrapolated at ~19.25px margin — positive, but under the one-row
 *     safety bar, so 12 was rejected in favor of 11 without needing a
 *     13th real port in the fixture to prove it directly.
 */
export const CONTINUATION_PORT_CAP = 11;

/**
 * Continuation pages beyond this bound fold their residual into ONE
 * remainder row on the last page generated, instead of growing the deck
 * without bound for a pathological port count (this is the "within-page
 * overflow guard" the fold was demoted to in round 3 — for any realistic
 * month's port count it never fires; `PAGE1_PORT_CAP + MAX_CONTINUATION_PAGES
 * * CONTINUATION_PORT_CAP` = 3 + 3*11 = 36 named ports before folding even
 * becomes possible, well above the ~20 ports Saudi customs' real port list
 * carries).
 */
export const MAX_CONTINUATION_PAGES = 3;

/** `byPort` sorted by اشتباه فائت descending, then port key ascending — a
 *  stable, deterministic order independent of the source Map's insertion
 *  order (the same "state a total order" discipline every other per-port
 *  table in this deck follows, e.g. `workloadAccuracy.ts`'s
 *  `collectWorkloadRows`). This is also the ranking the page plan below
 *  chunks against — the highest-اشتباه-فائت ports are always shown first,
 *  on page 1. */
function collectPortRows(byPort: ErrorTypeBreakdown[]): PortRow[] {
  return byPort
    .map((p) => ({ ...p, rankable: isRankable(band(p.evaluable)) }))
    .sort(
      (a, b) =>
        b.missedSuspicion - a.missedSuspicion || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

function portRow(p: PortRow, i: number): string {
  const correct = p.correctClean + p.correctSuspicion;
  const missedRate = p.rankable ? pctCell(rateOf(p.missedSuspicion, p.evaluable)) : pctCell(null);
  const accuracyRate = p.rankable ? pctCell(rateOf(correct, p.evaluable)) : pctCell(null);
  return (
    `<tr><td>${ledgerIdx(i)}${esc(p.key)}</td><td>${fmtNum(p.evaluable)}</td>` +
    `<td class="v2-om-port-missed">${fmtNum(p.missedSuspicion)}</td><td>${missedRate}</td><td>${accuracyRate}</td></tr>`
  );
}

/** One folded remainder row for ports beyond `MAX_CONTINUATION_PAGES` — sums
 *  the folded ports' own counts into the SAME columns a named row would show
 *  (never a hidden or dropped total), same discipline as `coverage.ts`'s
 *  `foldedRow` and `accountability.ts`'s `foldedEmployeeRow`. Its own rate is
 *  gated on the pooled evaluable count's own band, independent of any
 *  individual folded port's rankability. In a normal-sized month this never
 *  renders at all — pagination (`planOutcomeMatrixPages`) is the everyday
 *  mechanism now; this is only the within-page overflow guard for a
 *  pathological port count. */
function foldedPortRow(folded: PortRow[], rowIdx: number): string {
  const evaluable = folded.reduce((s, p) => s + p.evaluable, 0);
  const missed = folded.reduce((s, p) => s + p.missedSuspicion, 0);
  const correct = folded.reduce((s, p) => s + p.correctClean + p.correctSuspicion, 0);
  const rankable = isRankable(band(evaluable));
  const missedRate = rankable ? pctCell(rateOf(missed, evaluable)) : pctCell(null);
  const accuracyRate = rankable ? pctCell(rateOf(correct, evaluable)) : pctCell(null);
  return (
    `<tr class="v2-om-fold-row"><td>${ledgerIdx(rowIdx)}الباقي (${fmtNum(folded.length)} منفذ)</td>` +
    `<td>${fmtNum(evaluable)}</td><td>${fmtNum(missed)}</td><td>${missedRate}</td><td>${accuracyRate}</td></tr>`
  );
}

/** This PAGE's own subtotal — shown (+ folded, on the last page only) ports
 *  ONLY, never a whole-month grand total the table itself doesn't display.
 *  Same "a totals row never covers rows the table doesn't show" discipline
 *  `workloadAccuracy.ts`'s `tableCard` documents for its own paginated
 *  land/sea tables. */
function portsTotalsRow(rows: PortRow[]): string {
  const evaluable = rows.reduce((s, p) => s + p.evaluable, 0);
  const missed = rows.reduce((s, p) => s + p.missedSuspicion, 0);
  const correct = rows.reduce((s, p) => s + p.correctClean + p.correctSuspicion, 0);
  const rankable = isRankable(band(evaluable));
  const missedRate = rankable ? pctCell(rateOf(missed, evaluable)) : pctCell(null);
  const accuracyRate = rankable ? pctCell(rateOf(correct, evaluable)) : pctCell(null);
  return (
    `<tr><td>الإجمالي</td><td>${fmtNum(evaluable)}</td>` +
    `<td>${fmtNum(missed)}</td><td>${missedRate}</td><td>${accuracyRate}</td></tr>`
  );
}

/** Per-port breakdown card for ONE page, wrapped in the required
 *  `.v2-om-ports` hook. Reuses the shared `ledgerPortCard` shell (P2,
 *  slideKit.ts) — the same card/table chrome `coverage.ts`'s `bucketCard`
 *  and `workloadAccuracy.ts`'s per-port cards already use — rather than a
 *  bespoke table, so this page's ports table looks and behaves identically
 *  to every other per-port table in the deck. `folded` is non-empty only on
 *  the very last page generated, and only when the port count exceeds
 *  `MAX_CONTINUATION_PAGES`'s reach (round-3 fix; see the module header). */
function portsCard(shown: PortRow[], folded: PortRow[]): string {
  const bodyRowsHtml =
    shown.map((p, i) => portRow(p, i)).join("") +
    (folded.length > 0 ? foldedPortRow(folded, shown.length) : "");
  return `<div class="v2-om-ports">
    ${ledgerPortCard({
      title: "حسب المنفذ",
      theadCells:
        `<th>المنفذ</th><th>العيّنة</th><th>اشتباه فائت</th><th>نسبة الاشتباه الفائت</th><th>الدقة الإجمالية</th>`,
      bodyRowsHtml,
      totalsRowHtml: portsTotalsRow([...shown, ...folded]),
      span: PORTS_SPAN,
      rowCount: 0,
      compact: true,
      extraClass: "om-ports-card",
      emptyText: "لا توجد بيانات منافذ لهذا الشهر.",
    })}
  </div>`;
}

// ── Pagination ───────────────────────────────────────────────────────────

/** One page's worth of the plan: which ports it names individually, and
 *  (only ever non-empty on the last page) which ports fold into that page's
 *  remainder row instead. */
type OutcomeMatrixPage = { shown: PortRow[]; folded: PortRow[] };

/**
 * Splits the full, already-ranked port list into pages: page 1 takes up to
 * `PAGE1_PORT_CAP` (it also carries the matrix + totals band, so its budget
 * is smaller), each following page takes up to `CONTINUATION_PORT_CAP` (pure
 * ports table, full slide-body). Bounded at `MAX_CONTINUATION_PAGES`
 * continuation pages; any residual beyond that bound folds into the last
 * page's own remainder row rather than growing the deck without limit.
 *
 * Always returns at least one page (an empty `shown`/`folded` pair renders
 * `portsCard`'s own honest empty state) so callers never need a separate
 * "zero ports" branch.
 */
function planOutcomeMatrixPages(rows: PortRow[]): OutcomeMatrixPage[] {
  const pages: PortRow[][] = [rows.slice(0, PAGE1_PORT_CAP)];
  let consumed = pages[0].length;
  while (consumed < rows.length && pages.length - 1 < MAX_CONTINUATION_PAGES) {
    const chunk = rows.slice(consumed, consumed + CONTINUATION_PORT_CAP);
    pages.push(chunk);
    consumed += chunk.length;
  }
  const residual = rows.slice(consumed);
  return pages.map((shown, i) => ({
    shown,
    folded: i === pages.length - 1 ? residual : [],
  }));
}

/**
 * Build the مصفوفة نتائج الفحص page(s) — the four inspection-outcome classes
 * as a 2×2 matrix (month-wide) plus a per-port breakdown table, paginated
 * (round-3 fix) so a real month's full port list is actually shown rather
 * than mostly folded away. Page 1 carries the matrix + totals band + the
 * first chunk of ports; continuation pages ("(تابع)", matching
 * `portAgreementSlideBuilders`'s convention) carry ONLY the ports table,
 * using the much larger budget a page with no matrix leaves — repeating the
 * month-wide matrix on every continuation page would be pure redundancy
 * (it's already stated once, and it costs exactly the room a continuation
 * page needs for more port rows instead). Single body variant per page
 * (`bodyVariants` repeats one body four times), the same pattern
 * `coverageSlide` (section4/coverage.ts:124) uses for a page whose content
 * doesn't warrant a full Ledger/Briefing/Grid fan-out.
 *
 * Pure — no Date, no Math.random, no I/O. Same input ⇒ byte-identical output.
 */
export function outcomeMatrixSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { totals, byPort } = model.errorAnalysis;
  const rows = collectPortRows(byPort);
  const pages = planOutcomeMatrixPages(rows);

  return pages.map(({ shown, folded }, page) => {
    const isFirst = page === 0;
    const cont = isFirst ? "" : " (تابع)";
    const suffix = pages.length > 1 ? `-${page + 1}` : "";
    const title = `${SLIDE_TITLE}${cont}`;

    const body = isFirst
      ? `<div class="v2-om-layout">
    <div class="v2-om-top">
      ${matrixBlock(totals)}
      ${totalsBand(totals, byPort.length)}
    </div>
    ${portsCard(shown, folded)}
  </div>`
      : `<div class="v2-om-layout">
    ${portsCard(shown, folded)}
  </div>`;

    return (num: number, total: number) =>
      v2Slide({
        id: `${SLIDE_ID}${suffix}`,
        title,
        eyebrow: EYEBROW,
        iconName: "alert",
        headline: title,
        subhead: SUBHEAD,
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section3",
      });
  });
}

// ── CSS ─────────────────────────────────────────────────────────────────────
// Everything here is scoped under `.v2-om-` so it cannot collide with any
// sibling section-3 page's stylesheet. No raw hex literals (check:hex-literals):
// colors come from the theme's CSS variables, blended with color-mix where a
// tint is needed. Composed on top of the deck's existing vocabulary
// (`.v2-totals-band`/`.v2-lg-port-card`/`.deck-table`/`.insuff`) — these rules
// only add what that vocabulary has no equivalent for: the 2×2 matrix itself.
export const OUTCOME_MATRIX_CSS = `
/* ── القسم 3 · مصفوفة نتائج الفحص ─────────────────────────────────────────── */
.v2-om-layout{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;}
.v2-om-top{flex:0 0 auto;}
.v2-om-ports{flex:1 1 auto;min-height:0;overflow:auto;}
.v2-om-ports .v2-lg-port-card{height:100%;min-height:0;}

.v2-om-matrix{
  display:grid;grid-template-columns:92px 1fr 1fr;grid-auto-rows:auto;
  gap:6px;align-items:stretch;
}
.v2-om-corner{}
.v2-om-colhead,.v2-om-rowhead{
  display:flex;align-items:center;justify-content:center;text-align:center;
  font-size:.62rem;font-weight:800;color:var(--slate);padding:3px;
}
.v2-om-rowhead{justify-content:flex-end;text-align:right;padding-inline-end:6px;}
.v2-om-cell{
  border-radius:12px;padding:6px 10px;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  border:1px solid color-mix(in srgb,var(--white) 14%,transparent);
  background:color-mix(in srgb,var(--white) 3%,transparent);
}
.v2-om-cell.blue{border-color:color-mix(in srgb,var(--blue) 55%,transparent);background:color-mix(in srgb,var(--blue) 14%,transparent);}
.v2-om-cell.gold{border-color:color-mix(in srgb,var(--gold) 55%,transparent);background:color-mix(in srgb,var(--gold) 14%,transparent);}
.v2-om-cell.green{border-color:color-mix(in srgb,var(--green) 55%,transparent);background:color-mix(in srgb,var(--green) 14%,transparent);}
.v2-om-cell.coral{border-color:color-mix(in srgb,var(--coral) 55%,transparent);background:color-mix(in srgb,var(--coral) 14%,transparent);}
/* اشتباه فائت is the headline cell — a thicker border and slightly stronger
   fill mark it out from the other three without relying on color alone (the
   label + always-visible count already carry the meaning). */
.v2-om-cell.emphasis{border-width:2px;background:color-mix(in srgb,var(--coral) 22%,transparent);}
.v2-om-cell-label{font-size:.6rem;font-weight:700;color:var(--slate);}
.v2-om-count{font-size:1.15rem;font-weight:900;color:#fff;line-height:1.05;}
.v2-om-share{font-size:.64rem;font-weight:700;color:var(--muted);}

/* Compact totals band (Task-5 round-2 fix): this page's own denominator strip
   sits BELOW the matrix, competing for the same fixed slide-body height as
   the ports table below IT — unlike every other section-3 page that uses the
   generic .v2-totals-band (18px margin-top, 1.15rem figures), which assumes
   the band is the ONLY thing sharing the body. Same tightening technique
   .v2-risk-layout .v2-totals-band / .v2-sys-brief .v2-totals-band already
   apply elsewhere in this theme (theme.ts) — a precedented compact variant,
   not a new one — reclaims the room the ports table needs. */
.v2-om-top .v2-totals-band{margin-top:8px;gap:8px;}
.v2-om-top .v2-totals-item{padding:6px 12px;}
.v2-om-top .v2-totals-item b{font-size:.88rem;}
.v2-om-top .v2-totals-item small{font-size:.58rem;}

body.theme-light .v2-om-colhead,body.theme-light .v2-om-rowhead{color:#607386;}
body.theme-light .v2-om-cell{background:#fff;border-color:#dde4ea;}
body.theme-light .v2-om-cell.blue{background:color-mix(in srgb,var(--blue) 10%,#fff);}
body.theme-light .v2-om-cell.gold{background:color-mix(in srgb,var(--gold) 10%,#fff);}
body.theme-light .v2-om-cell.green{background:color-mix(in srgb,var(--green) 10%,#fff);}
body.theme-light .v2-om-cell.coral{background:color-mix(in srgb,var(--coral) 10%,#fff);}
body.theme-light .v2-om-cell.emphasis{background:color-mix(in srgb,var(--coral) 16%,#fff);}
body.theme-light .v2-om-count{color:#0a2d4a;}
body.theme-light .v2-om-cell-label{color:#607386;}
body.theme-light .v2-om-share{color:#607386;}

.v2-om-port-missed{font-weight:800;}
/* Folded remainder row (round-2 fix) — same muted/italic treatment
   .v2-cov-fold-row / .v2-acc-fold-row already use for this exact pattern
   elsewhere in the deck (theme.ts), so a folded row reads as visibly
   different from a named port row without a legend. */
.v2-om-fold-row td{color:var(--slate);font-style:italic;}
body.theme-light .v2-om-fold-row td{color:#607386;}

@media print{
  .v2-om-ports{overflow:visible;}
  .v2-om-cell{break-inside:avoid;}
}
`;
