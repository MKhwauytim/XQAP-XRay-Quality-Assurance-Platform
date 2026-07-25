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

import type { ExecutiveReportRow } from "../../../executiveReportTypes";
import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import { pctCell, rateOf, v2Slide } from "../slideKit";
import type { CellTone } from "../slideKit";

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
 * comparison cannot be made. There is deliberately no "close enough" middle
 * ground: a difference of two rates each computed on <10 images is noise.
 */
function deltaChip(present: MarkStratum, absent: MarkStratum): string {
  const comparable = present.rankable && absent.rankable && present.accuracy !== null && absent.accuracy !== null;
  if (!comparable) {
    return `<div class="v2-mark-delta insufficient">
      <span class="v2-mark-delta-label">الفارق</span>
      <b class="v2-mark-delta-value"><span class="insuff">—</span></b>
      <span class="v2-mark-delta-note">${esc(INSUFFICIENT_NOTE)}</span>
    </div>`;
  }
  const effect = (present.accuracy ?? 0) - (absent.accuracy ?? 0);
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
    const share = rateOf(s.outcomes[c.key], s.n);
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
 *  absent or renamed, which makes `hasMarking` null on every row). */
function emptyState(): string {
  return `<div class="v2-mark-empty">
    <span class="v2-mark-empty-icon">${icon("flag", 24)}</span>
    <b>لا يوجد سجل لحالة التحديد في صور هذا الشهر</b>
    <p>لم تُسجَّل إجابة حقل «هل يوجد تحديد» على أي صورة مُقيَّمة، لذا تعذّرت المقارنة. تحقّق من وجود الحقل في نموذج الفحص المعتمد للشهر.</p>
  </div>`;
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

  const caveat = `<div class="v2-mark-caveat">
    <span class="v2-mark-caveat-icon">${icon("alert", 13)}</span>
    <span>${esc(CAUSAL_CAVEAT)}</span>
  </div>`;

  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 16)}</span><span><b>${fmtNum(evaluated.length)}</b><small>إجمالي الصور المُقيَّمة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("flag", 16)}</span><span><b>${fmtNum(recorded)}</b><small>صور لها سجل لحالة التحديد</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("document", 16)}</span><span><b>${fmtNum(unknown)}</b><small>صور بلا سجل لحالة التحديد</small></span></div>
  </div>`;

  const body = `<div class="v2-risk-layout v2-mark-layout">
    ${recorded > 0 ? compare : emptyState()}
    ${caveat}
    ${totals}
  </div>`;

  return v2Slide({
    id: "slide-s3-marking",
    title: "أثر وجود التحديد على الدقة",
    eyebrow: "القسم 3 — التحاليل المتقدمة",
    iconName: "flag",
    headline: "أثر وجود التحديد على الدقة",
    subhead: "مقارنة دقة القرارات في الصور التي يوجد بها تحديد مقابل التي لا يوجد بها.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS. Everything is scoped under `.v2-mark-layout` so it cannot
 * collide with the other section-3 pages built in parallel. Composed on top of
 * the deck's existing vocabulary (`.v2-risk-layout` / `.v2-risk-tile*` /
 * `.v2-prop*` / `.v2-totals-band` / `.v2-micro-arc` / `.insuff`) — these rules
 * only add what that vocabulary has no equivalent for. No raw hex literals; all
 * colors are theme tokens or alpha-composited neutrals, and every dimension is
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

/* Single empty state — no marking record on any evaluated image. */
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
`;
