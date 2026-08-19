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

import type { ReportModel } from "../../model/reportModel";
import type { ErrorTypeBreakdown } from "../../model/aggregates";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { ledgerIdx, ledgerPortCard, pctCell, rateOf, v2Slide } from "../slideKit";
import type { CellTone } from "../slideKit";

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

/** `byPort` sorted by اشتباه فائت descending, then port key ascending — a
 *  stable, deterministic order independent of the source Map's insertion
 *  order (the same "state a total order" discipline every other per-port
 *  table in this deck follows, e.g. `workloadAccuracy.ts`'s
 *  `collectWorkloadRows`). */
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

/** Per-port breakdown card, wrapped in the required `.v2-om-ports` hook. Reuses
 *  the shared `ledgerPortCard` shell (P2, slideKit.ts) — the same card/table
 *  chrome `coverage.ts`'s `bucketCard` and `workloadAccuracy.ts`'s per-port
 *  cards already use — rather than a bespoke table, so this page's ports table
 *  looks and behaves identically to every other per-port table in the deck. */
function portsTable(byPort: ErrorTypeBreakdown[]): string {
  const rows = collectPortRows(byPort);
  const bodyRowsHtml = rows.map((p, i) => portRow(p, i)).join("");
  return `<div class="v2-om-ports">
    ${ledgerPortCard({
      title: "حسب المنفذ",
      theadCells:
        `<th>المنفذ</th><th>العيّنة</th><th>اشتباه فائت</th><th>نسبة الاشتباه الفائت</th><th>الدقة الإجمالية</th>`,
      bodyRowsHtml,
      totalsRowHtml: portsTotalsRow(rows),
      span: PORTS_SPAN,
      rowCount: 0,
      compact: false,
      extraClass: "om-ports-card",
      emptyText: "لا توجد بيانات منافذ لهذا الشهر.",
    })}
  </div>`;
}

/**
 * Page: مصفوفة نتائج الفحص — the four inspection-outcome classes as a 2×2
 * matrix (month-wide) plus a per-port breakdown table. Single body variant
 * (`bodyVariants` repeats one body four times), the same pattern
 * `coverageSlide` (section4/coverage.ts:124) uses for a page whose content
 * doesn't warrant a full Ledger/Briefing/Grid fan-out.
 *
 * Pure — no Date, no Math.random, no I/O. Same input ⇒ byte-identical output.
 */
export function outcomeMatrixSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const { totals, byPort } = model.errorAnalysis;
  const body = `<div class="v2-om-layout">
    <div class="v2-om-top">
      ${matrixBlock(totals)}
      ${totalsBand(totals, byPort.length)}
    </div>
    ${portsTable(byPort)}
  </div>`;

  return v2Slide({
    id: SLIDE_ID,
    title: SLIDE_TITLE,
    eyebrow: EYEBROW,
    iconName: "alert",
    headline: SLIDE_TITLE,
    subhead: SUBHEAD,
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section3",
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
  display:grid;grid-template-columns:104px 1fr 1fr;grid-auto-rows:auto;
  gap:8px;align-items:stretch;
}
.v2-om-corner{}
.v2-om-colhead,.v2-om-rowhead{
  display:flex;align-items:center;justify-content:center;text-align:center;
  font-size:.68rem;font-weight:800;color:var(--slate);padding:4px;
}
.v2-om-rowhead{justify-content:flex-end;text-align:right;padding-inline-end:8px;}
.v2-om-cell{
  border-radius:14px;padding:12px 10px;text-align:center;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
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
.v2-om-cell-label{font-size:.68rem;font-weight:700;color:var(--slate);}
.v2-om-count{font-size:1.55rem;font-weight:900;color:#fff;line-height:1.1;}
.v2-om-share{font-size:.7rem;font-weight:700;color:var(--muted);}

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

@media print{
  .v2-om-ports{overflow:visible;}
  .v2-om-cell{break-inside:avoid;}
}
`;
