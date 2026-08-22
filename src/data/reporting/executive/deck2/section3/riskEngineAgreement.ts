// Executive deck v2 — القسم 3 · صفحة: توافق نتائج الفحص مع محرك المخاطر.
//
// Answers ONE question: how do our X-ray screening decisions compare against
// the customs risk engine's targeting, and — where the two disagree — what did
// the study reviewer actually find?
//
// ── The correctness core: a blank is NOT سليمة ──────────────────────────────
// `targetedByRiskEngine` is free text off the risk file, with a vocabulary that
// is UNKNOWN at design time (see `ExecutiveReportRow.targetedByRiskEngine`'s
// own doc comment). `engineVerdictOf` — now shared from
// `src/data/population/riskEngineVerdict.ts`, since the employee case-queue
// filter applies the same rule — maps it to a سليمة/اشتباه verdict for a
// small, explicit recognized set; everything else — including every blank —
// maps to `null` and is excluded from every rate on this page. A blank means
// "we do not know what the engine said", never "the engine cleared it": if a
// blank quietly became سليمة, every agreement figure on this page would be
// inflated by however much of the month's risk column is unpopulated, which in
// a real workspace could be most of it. `.v2-re-coverage` prints the
// recognized/unrecognized/blank split so the FIRST real month this page runs
// against reveals the actual vocabulary in the data, instead of shipping a
// silently wrong number against a guessed one.
//
// ── Why the engine-vs-المراجع row is the headline, not a footnote ───────────
// The four `المستوى` risk levels are DEFINED partly in terms of risk-engine
// targeting (see `docs/reference/APP_AUDIT_MODEL.md` / this repo's own
// CLAUDE.md): المستوى الثاني *is* "the engine flagged it, L1/L2 did not
// suspect it". So a naive engine-vs-L1/L2 cross-tab restated on this page would
// largely just restate that definition — of course engine-targeted rows that
// L1/L2 cleared cluster in المستوى الثاني, that's what the label MEANS, not a
// finding about how good the engine is. The one comparison on this page that
// is NOT circular with `stage`'s own definition is engine-vs-المراجع (the
// independent study reviewer's verdict) — neither is defined in terms of the
// other, so agreement (or disagreement) between them is a genuine measurement.
// `.v2-re-caveat` states this structural fact verbatim; it is mandatory, not
// decorative, and a reader must not mistake the definitional part of this page
// for a discovery.
//
// ── Two footnotes this page must carry (2026-08-20 whole-branch-review fix) ─
// 1. «المستوى الثاني» is used in TWO INCOMPATIBLE senses on this one page: the
//    agreement table and the محضر table (block 1 and block 3) read it as the
//    X-RAY INSPECTION LEVEL (`levelTwoResult`); the disagreement-set heading
//    (block 2) reads it as the RISK-LEVEL CATEGORY (`getStageKey(stage) ===
//    "second"`). `sourceAgreement.ts`'s `LEVEL_FOOTNOTE` and
//    `levelAccuracy.ts`'s «مرحلتا فحص بالأشعة» sub-line disambiguate the same
//    two axes on their own pages; `LEVEL_FOOTNOTE` below does the same here,
//    and the disagreement caveat is worded to apply ONLY to block 2 so a
//    reader never applies it to the inspection-level row printed above it.
// 2. THE COMPARISON SCOPE IS ASYMMETRIC, same structural fact
//    `sourceAgreement.ts`'s `SCOPE_FOOTNOTE` states: the engine-vs-المراجع
//    headline row is scoped to the studied SAMPLE (`expertResult` is non-null
//    only for reviewed sampled images), while the engine-vs-L1/L2 rows below
//    it are scoped to the whole month's POPULATION — so their `ن` columns
//    differ by orders of magnitude for a structural reason, not an error.
//    `SCOPE_FOOTNOTE` below states this verbatim, reused unchanged from
//    `sourceAgreement.ts` since it is the exact same fact.
//
// ── Grain: IMAGE ─────────────────────────────────────────────────────────
// This page folds `model.rows` (one row per population image) — the same grain
// `targetedByRiskEngine`/`hasReport`/`stage` all live at. It never touches
// `model.factTable` (one record per L1/L2 decision): the risk-engine flag and
// the محضر flag are both properties of the IMAGE, not of an individual
// decision level, so folding at decision grain would double every count.
//
// ── Stage matching ───────────────────────────────────────────────────────
// `row.stage` carries the RAW alias the risk file used (`SECOND_STAG`,
// `المستوى الثاني`, …), never a canonical label. The المستوى الثاني
// disagreement set is therefore selected through `getStageKey` (the same
// alias-matching helper `deck2/slides.ts` already uses), never by comparing
// `row.stage` to a hard-coded Arabic string — a previous version of this deck
// shipped exactly that bug and rendered empty tables against every real
// workspace (see `deckPreviewFixture.ts`'s own comment on the same mistake).
//
// ── The four المستوى levels are categorical, never a severity ranking ───────
// No severity language appears anywhere on this page.
//
// ── Honesty discipline (shared with every other section-3 page) ─────────────
//   • every rate goes through `rateOf`, gated on `isRankable(band(n))` against
//     ITS OWN denominator — a zero or thin denominator renders muted "—", never
//     a fabricated percentage;
//   • `ن` is always printed, even when the rate above it is suppressed;
//   • every interpolated string routes through `esc()`;
//   • single-variant page (`bodyVariants` repeats one body four times) — the
//     same pattern `outcomeMatrix.ts`/`section4/coverage.ts` use for a page
//     whose content doesn't warrant a full Ledger/Briefing/Grid fan-out. Every
//     block here folds a BOUNDED, small number of categories (three agreement
//     rows, three disagreement outcomes, three محضر rows) — never a per-row
//     list that grows with the population — so nothing on this page needs
//     pagination.
//
// Pure: no `Date.now()`, no `Math.random()`, no I/O. Same input ⇒
// byte-identical output.

import { getStageKey } from "../../../../population/stageHelpers";
import { engineVerdictOf } from "../../../../population/riskEngineVerdict";
import type { ExecutiveReportRow } from "../../../executiveReportTypes";
import type { ReportModel } from "../../model/reportModel";
import { band, isRankable } from "../../model/dataSufficiency";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { briefingSupport, pctCell, rateOf, v2Slide } from "../slideKit";

const TITLE = "توافق نتائج الفحص مع محرك المخاطر";
const SUBHEAD = "كيف تقارن قرارات فحص الأشعة باستهداف محرك مخاطر الجمارك، وماذا وجد المراجع عند الاختلاف.";
const EYEBROW = "القسم 3 — التحاليل المتقدمة";

/** Guards the asymmetric-scope fact (module header note #2). Reused verbatim
 *  from `sourceAgreement.ts`'s `SCOPE_FOOTNOTE` — the same structural fact
 *  (rows involving المراجع are sample-scoped, the rest are population-scoped)
 *  applies unchanged to this page's block 1. */
const SCOPE_FOOTNOTE =
  "المقارنات التي تشمل «المراجع» تقتصر على صور العيّنة المدروسة؛ وما عداها يشمل مجتمع الشهر كاملًا.";

/** Guards the two-senses-of-«المستوى الثاني» fact (module header note #1):
 *  block 1/3 use it for the X-ray inspection level, block 2's heading uses it
 *  for the risk-level category — the SAME label, two different axes, on one
 *  page. */
const LEVEL_FOOTNOTE =
  "«المستوى الأول» و«المستوى الثاني» في جدولي التوافق والمحضر أعلاه/أدناه يعنيان مرحلتي فحص الأشعة؛ أما «المستوى الثاني» في عنوان مجموعة الاختلاف فيعني مستوى المخاطر — معنى مختلف تمامًا لنفس الاسم.";

// ── The mapping rule (the page's own correctness core) ──────────────────────

/**
 * Re-exported, not re-implemented. The vocabulary and the mapping now live in
 * `src/data/population/riskEngineVerdict.ts` — the population layer owns
 * `targetedByRiskEngine`, and the employee case-queue filter («مستهدف المؤشر»)
 * applies the exact same rule, so a second copy here would be free to drift the
 * first time a real month teaches one of them a new value. The re-export keeps
 * this module's public surface unchanged for existing importers (its own test
 * imports `engineVerdictOf` from here).
 */
export { engineVerdictOf };

// ── Coverage: recognized / unrecognized / blank ──────────────────────────────

type Coverage = { recognized: number; unrecognized: number; blank: number };

/** Classifies every row's RAW `targetedByRiskEngine` value into exactly one of
 *  the three buckets — the vocabulary-discovery counter this page's own
 *  correctness note requires. Blank and unrecognized are tallied SEPARATELY
 *  here (unlike `engineVerdictOf`, which collapses both to `null`) precisely
 *  so a reader can tell "the column is empty" apart from "the column has
 *  values we don't recognize yet". */
function coverageOf(rows: readonly ExecutiveReportRow[]): Coverage {
  let recognized = 0;
  let unrecognized = 0;
  let blank = 0;
  for (const row of rows) {
    const trimmed = (row.targetedByRiskEngine ?? "").trim();
    if (trimmed === "") {
      blank += 1;
      continue;
    }
    if (engineVerdictOf(row.targetedByRiskEngine) !== null) recognized += 1;
    else unrecognized += 1;
  }
  return { recognized, unrecognized, blank };
}

// ── Block 1: agreement — engine vs L1, vs L2, vs المراجع (headline) ─────────

type AgreementRow = { label: string; n: number; agree: number; rate: number | null; headline: boolean };

/**
 * Folds engine-verdict agreement against one other result field, gated on
 * ITS OWN comparable count (rows where BOTH the engine verdict and the other
 * field are non-null) clearing the sufficiency cut — the same
 * `isRankable(band(n))` gate every rate on this page shares. `n` is always
 * returned even when `rate` is suppressed, so the caller can print the
 * denominator regardless.
 */
function agreementFold(
  rows: readonly ExecutiveReportRow[],
  otherOf: (row: ExecutiveReportRow) => "سليمة" | "اشتباه" | null,
  label: string,
  headline: boolean,
): AgreementRow {
  let n = 0;
  let agree = 0;
  for (const row of rows) {
    const engine = engineVerdictOf(row.targetedByRiskEngine);
    if (engine === null) continue;
    const other = otherOf(row);
    if (other === null) continue;
    n += 1;
    if (engine === other) agree += 1;
  }
  const rankable = isRankable(band(n));
  return { label, n, agree, rate: rankable ? rateOf(agree, n) : null, headline };
}

function buildAgreementRows(rows: readonly ExecutiveReportRow[]): AgreementRow[] {
  return [
    // Headline FIRST: the one comparison independent of stage's own
    // definition (see the module header's non-circularity note).
    agreementFold(rows, (r) => r.expertResult, "محرك المخاطر مقابل المراجع (الحكم المستقل)", true),
    agreementFold(rows, (r) => r.levelOneResult, "محرك المخاطر مقابل المستوى الأول", false),
    agreementFold(rows, (r) => r.levelTwoResult, "محرك المخاطر مقابل المستوى الثاني", false),
  ];
}

function agreementBlock(rows: AgreementRow[]): string {
  const trs = rows
    .map(
      (r) =>
        `<tr class="${r.headline ? "v2-re-headline" : ""}"><td>${esc(r.label)}</td>` +
        `<td>${pctCell(r.rate)}</td><td>${fmtNum(r.n)}</td></tr>`,
    )
    .join("");
  return `<div class="v2-re-agree">
    <div class="v2-re-block-head"><b>${esc("نسبة التوافق مع محرك المخاطر")}</b><span>${esc(
      "التوافق مقيّد بالصور التي لها قيمة معروفة لاستهداف المحرك ولقيمة المقارنة كلتيهما",
    )}</span></div>
    <table class="deck-table">
      <thead><tr><th>${esc("المقارنة")}</th><th>${esc("نسبة التوافق")}</th><th>${esc("العيّنة (ن)")}</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

// ── Block 2: المستوى الثاني disagreement set ────────────────────────────────

type DisagreementFold = {
  /** All rows whose `stage` maps to المستوى الثاني — by definition the engine
   *  flagged them and L1/L2 cleared them. This is a POPULATION-wide count
   *  (every image the risk file marks stage-2, sampled or not), never the
   *  studied-sample count — see `total`'s use in `disagreementBlock` below. */
  total: number;
  /** Of those, how many the reviewer has actually recorded a verdict for. */
  reviewed: number;
  /** Reviewer sided with the engine (اشتباه) — a case our screening missed. */
  confirmed: number;
  /** Reviewer sided with our screening (سليمة) — the engine's flag itself
   *  did not hold up under independent review. */
  cleared: number;
  /** Never drawn into the studied sample at all (`selectedInSample === false`)
   *  — cannot carry a reviewer verdict BY DESIGN, not because one is overdue.
   *  On a real month this is the overwhelming majority of `total` (a ~1–2%
   *  sample rate), which is exactly why it must never be folded into "pending
   *  review" (2026-08-20 whole-branch-review fix, Important 3: «بلا حكم
   *  مراجع بعد» previously mislabeled this as "not yet reviewed"). */
  outsideSample: number;
  /** Drawn into the sample (`selectedInSample === true`) but the reviewer has
   *  not yet recorded a verdict — genuinely "pending", unlike `outsideSample`. */
  awaitingReview: number;
  /** Share of REVIEWED cases the reviewer confirmed, gated on `reviewed`'s
   *  own sufficiency band — independent of `total`'s band. */
  confirmedRate: number | null;
};

/**
 * Selects the المستوى الثاني rows through `getStageKey`, the canonical
 * alias-matching helper — NEVER by comparing `row.stage` to a hard-coded
 * Arabic label (see the module header's stage-matching note for the bug this
 * avoids), then breaks them down by what the independent study reviewer
 * found. The un-reviewed remainder is further split by `selectedInSample`
 * (2026-08-20 fix) — a row never drawn into the sample cannot be "pending",
 * only a sampled-but-unanswered row can.
 */
function foldDisagreementSet(rows: readonly ExecutiveReportRow[]): DisagreementFold {
  const level2 = rows.filter((r) => getStageKey(r.stage) === "second");
  let confirmed = 0;
  let cleared = 0;
  let outsideSample = 0;
  let awaitingReview = 0;
  for (const row of level2) {
    if (row.expertResult === "اشتباه") confirmed += 1;
    else if (row.expertResult === "سليمة") cleared += 1;
    else if (row.selectedInSample) awaitingReview += 1;
    else outsideSample += 1;
  }
  const reviewed = confirmed + cleared;
  const rankable = isRankable(band(reviewed));
  return {
    total: level2.length,
    reviewed,
    confirmed,
    cleared,
    outsideSample,
    awaitingReview,
    confirmedRate: rankable ? rateOf(confirmed, reviewed) : null,
  };
}

function disagreementBlock(fold: DisagreementFold): string {
  const stats = briefingSupport([
    { iconName: "check", value: fmtNum(fold.confirmed), label: "أكّد المراجع الاشتباه (فاتته شاشتنا)" },
    { iconName: "shield", value: fmtNum(fold.cleared), label: "وافق المراجع فحصنا (سليمة فعلًا)" },
    { iconName: "document", value: fmtNum(fold.awaitingReview), label: "ضمن العيّنة، بانتظار إجابة المراجع" },
  ]);
  return `<div class="v2-re-disagree">
    <div class="v2-re-block-head">
      <b>${esc("مجموعة الاختلاف: المستوى الثاني")}</b>
      <span>${esc(
        `استهدفها محرك المخاطر ولم تشتبه بها شاشتنا — ماذا وجد المراجع؟ إجمالي صور مجتمع الشهر: ${fmtNum(fold.total)}؛ خارج العيّنة المدروسة (لم تُسحب أصلًا): ${fmtNum(fold.outsideSample)}.`,
      )}</span>
    </div>
    ${stats}
    <div class="v2-re-disagree-rate">
      ${esc("نسبة تأكيد المراجع من بين ما رُوجع")}: <b>${pctCell(fold.confirmedRate)}</b>
      <span class="v2-re-disagree-n">(${esc("ن")}=${fmtNum(fold.reviewed)})</span>
    </div>
  </div>`;
}

// ── Block 3: محضر — hasReport === true ──────────────────────────────────────

type ReportFold = {
  n: number;
  l1Suspected: number;
  l2Suspected: number;
  reviewed: number;
  reviewConfirmed: number;
  l1Rate: number | null;
  l2Rate: number | null;
  reviewRate: number | null;
};

/** Folds every row with a recorded محضر number — what our own two levels
 *  concluded, and separately what the independent reviewer concluded (gated
 *  on ITS OWN, usually smaller, reviewed-count denominator). */
function foldReportRows(rows: readonly ExecutiveReportRow[]): ReportFold {
  const reported = rows.filter((r) => r.hasReport === true);
  let l1Suspected = 0;
  let l2Suspected = 0;
  let reviewed = 0;
  let reviewConfirmed = 0;
  for (const row of reported) {
    if (row.levelOneResult === "اشتباه") l1Suspected += 1;
    if (row.levelTwoResult === "اشتباه") l2Suspected += 1;
    if (row.expertResult !== null) {
      reviewed += 1;
      if (row.expertResult === "اشتباه") reviewConfirmed += 1;
    }
  }
  const n = reported.length;
  const rankable = isRankable(band(n));
  const reviewRankable = isRankable(band(reviewed));
  return {
    n,
    l1Suspected,
    l2Suspected,
    reviewed,
    reviewConfirmed,
    l1Rate: rankable ? rateOf(l1Suspected, n) : null,
    l2Rate: rankable ? rateOf(l2Suspected, n) : null,
    reviewRate: reviewRankable ? rateOf(reviewConfirmed, reviewed) : null,
  };
}

function reportBlock(fold: ReportFold): string {
  const trs =
    `<tr><td>${esc("المستوى الأول اشتباه")}</td><td>${pctCell(fold.l1Rate)}</td><td>${fmtNum(fold.n)}</td></tr>` +
    `<tr><td>${esc("المستوى الثاني اشتباه")}</td><td>${pctCell(fold.l2Rate)}</td><td>${fmtNum(fold.n)}</td></tr>` +
    `<tr><td>${esc("المراجع اشتباه")}</td><td>${pctCell(fold.reviewRate)}</td><td>${fmtNum(fold.reviewed)}</td></tr>`;
  return `<div class="v2-re-report">
    <div class="v2-re-block-head">
      <b>${esc("الحالات التي صدر فيها محضر ضبط")}</b>
      <span>${esc(`ماذا استنتج المستوى الأول والثاني والمراجع في هذه الحالات (إجمالي ${fmtNum(fold.n)})`)}</span>
    </div>
    <table class="deck-table">
      <thead><tr><th>${esc("الجهة")}</th><th>${esc("نسبة الاشتباه")}</th><th>${esc("العيّنة (ن)")}</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

// ── Coverage line + mandatory caveat ─────────────────────────────────────────

function coverageBlock(cov: Coverage): string {
  const stats = briefingSupport([
    { iconName: "check", value: fmtNum(cov.recognized), label: "قيم معروفة (نعم/لا أو ما يعادلها)" },
    { iconName: "alert", value: fmtNum(cov.unrecognized), label: "قيم غير معروفة (غير مصنَّفة بعد)" },
    { iconName: "document", value: fmtNum(cov.blank), label: "بلا قيمة (فارغة) — لا تُحتسب سليمة" },
  ]);
  return `<div class="v2-re-coverage">${stats}</div>`;
}

/** Mandatory, non-negotiable footnotes (design requirement, not decoration).
 *  Three lines, each guarding a distinct correctness fact (2026-08-20
 *  whole-branch-review fix — see the module header's two-footnote note):
 *   1. `SCOPE_FOOTNOTE` — block 1's headline row is sample-scoped, the rows
 *      beneath it are population-scoped.
 *   2. `LEVEL_FOOTNOTE` — «المستوى الثاني» means two different things on this
 *      one page.
 *   3. The definitional-overlap caveat — reworded to scope explicitly to
 *      block 2 (the disagreement set) so a reader never applies it to the
 *      inspection-level row printed in block 1, which it does NOT describe. */
function caveatBlock(): string {
  return `<div class="v2-re-caveat">
    <p><span class="v2-re-caveat-icon" aria-hidden="true">${icon("alert", 11)}</span>${esc(SCOPE_FOOTNOTE)}</p>
    <p>${esc(LEVEL_FOOTNOTE)}</p>
    <p>${esc(
      "مجموعة الاختلاف أدناه: المستوى الثاني هنا هو مستوى المخاطر، وهو مُعرَّف أصلًا بأن محرك المخاطر استهدف الصورة ولم تشتبه بها شاشتنا؛ لذلك فإن جزءًا من هذه العلاقة تحديدًا نتيجة تعريف إحصائي وليس اكتشافًا. توافق محرك المخاطر مع المراجع (أعلاه) هو المقياس الوحيد المستقل عن هذا التعريف.",
    )}</p>
  </div>`;
}

/** Honest empty state: no row carries a usable (recognized) engine verdict at
 *  all, so every comparison on this page would divide by zero. The coverage
 *  line still renders below this (unconditionally) so the reader can see
 *  exactly what the risk column DID contain instead of just "no data". */
function emptyState(cov: Coverage): string {
  return `<div class="v2-re-empty">
    <span class="v2-re-empty-icon" aria-hidden="true">${icon("shield", 22)}</span>
    <b>${esc("لا توجد قيم معروفة لاستهداف محرك المخاطر هذا الشهر")}</b>
    <p>${esc(
      `لم تحمل أي صورة قيمة يمكن تصنيفها (نعم/لا أو ما يعادلها) في عمود استهداف محرك المخاطر، لذلك تعذّر حساب أي مقارنة على هذه الصفحة. عدد الصور الفارغة القيمة: ${fmtNum(
        cov.blank,
      )}، وعدد الصور بقيمة غير معروفة: ${fmtNum(cov.unrecognized)}.`,
    )}</p>
  </div>`;
}

/**
 * Page: توافق نتائج الفحص مع محرك المخاطر.
 *
 * Pure — no `Date`, no `Math.random`, no I/O. Same input ⇒ byte-identical
 * output. Single-variant page (`bodyVariants` repeats one body four times) —
 * every block folds a small, bounded number of categories, so there is no
 * per-port/per-row list that could grow with the population and nothing here
 * needs pagination (see the module header).
 */
export function riskEngineAgreementSlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const rows = model.rows;
  const cov = coverageOf(rows);
  const hasUsableVerdict = cov.recognized > 0;

  const content = hasUsableVerdict
    ? `${agreementBlock(buildAgreementRows(rows))}
    ${disagreementBlock(foldDisagreementSet(rows))}
    ${reportBlock(foldReportRows(rows))}`
    : emptyState(cov);

  const body = `<div class="v2-re-layout">
    ${content}
    ${coverageBlock(cov)}
    ${caveatBlock()}
  </div>`;

  return v2Slide({
    id: "slide-s3-risk-engine",
    title: TITLE,
    eyebrow: EYEBROW,
    iconName: "shield",
    headline: TITLE,
    subhead: SUBHEAD,
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section3",
  });
}

/**
 * Page-local CSS, scoped entirely under `.v2-re-` so it cannot collide with
 * any sibling section-3 page's stylesheet. Composed on top of the deck's
 * existing vocabulary (`.deck-table`, `.v2-totals-band`/`.v2-totals-item` via
 * `briefingSupport`, `.insuff`) — these rules only add what that vocabulary
 * has no equivalent for: the block headers, the headline agreement row, and
 * the disagreement-rate line. No raw hex literals — colors are theme tokens
 * or `color-mix` blends, matching every other page in this fan-out.
 */
export const RISK_ENGINE_CSS = `
/* ── القسم 3 · توافق نتائج الفحص مع محرك المخاطر ──────────────────────────── */
.v2-re-layout{display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;justify-content:center;}
.v2-re-layout .insuff{color:var(--slate);font-weight:800;}

.v2-re-agree,.v2-re-disagree,.v2-re-report{
  border:1px solid rgba(255,255,255,.12);border-radius:10px;
  padding:6px 10px;background:rgba(2,20,37,.32);
  display:flex;flex-direction:column;gap:4px;
}
.v2-re-block-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.v2-re-block-head b{font-size:.7rem;font-weight:900;color:rgba(255,255,255,.95);}
.v2-re-block-head span{font-size:.56rem;font-weight:700;color:var(--slate);line-height:1.3;}

.v2-re-agree .deck-table th,.v2-re-agree .deck-table td,
.v2-re-report .deck-table th,.v2-re-report .deck-table td{
  padding:3px 7px;font-size:.66rem;text-align:center;line-height:1.2;
}
.v2-re-agree .deck-table th:first-child,.v2-re-agree .deck-table td:first-child,
.v2-re-report .deck-table th:first-child,.v2-re-report .deck-table td:first-child{text-align:right;}
/* The engine-vs-المراجع row is the page's headline figure — the one
   comparison independent of how المستوى is defined (see module header).
   Marked visually, never by color alone: a gold left rule plus bold text. */
.v2-re-agree .deck-table tr.v2-re-headline td{
  font-weight:900;background:color-mix(in srgb,var(--gold) 10%,transparent);
  border-inline-start:2px solid var(--gold);
}

/* Both stat bands below (disagree + coverage) are shrunk from the shared
   theme's hero-sized .v2-totals-band default (18px margin-top, 1.15rem
   figures — meant for a slide's single headline stat strip) down to a
   compact inline variant, the same pattern outcomeMatrix.ts's .v2-om-top
   override uses: this page needs THREE stat-bearing blocks in one slide, not
   one, so none of them can afford the hero sizing. Measured live via
   report:static against a populated fixture — see module header. */
.v2-re-disagree .v2-totals-band,.v2-re-report .v2-totals-band,.v2-re-coverage .v2-totals-band{
  margin-top:0;gap:6px;
}
.v2-re-disagree .v2-totals-item,.v2-re-coverage .v2-totals-item{padding:4px 8px;}
.v2-re-disagree .v2-totals-item b,.v2-re-coverage .v2-totals-item b{font-size:.8rem;}
.v2-re-disagree .v2-totals-item small,.v2-re-coverage .v2-totals-item small{font-size:.54rem;}
.v2-re-disagree-rate{
  font-size:.64rem;font-weight:700;color:rgba(255,255,255,.88);
  display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;
}
.v2-re-disagree-rate b{font-size:.74rem;font-weight:900;color:var(--gold);}
.v2-re-disagree-n{font-size:.56rem;font-weight:700;color:var(--slate);font-variant-numeric:tabular-nums;}

/* ── Coverage line — the vocabulary-discovery counter ─────────────────────── */
.v2-re-coverage{flex-shrink:0;}

/* ── Mandatory footnotes: scope + level-axis + definitional-overlap caveat ───
   Three lines now (2026-08-20 whole-branch-review fix), not one — stacked
   and right-flush (RTL) rather than centered, the same layout
   sourceAgreement.ts's .s3sa-foot uses for its own two-line footnote, since
   a centered multi-line block reads worse than a stacked one. */
.v2-re-caveat{
  flex-shrink:0;display:flex;flex-direction:column;gap:1px;text-align:right;
  font-size:.56rem;font-weight:700;line-height:1.3;color:var(--slate);
}
.v2-re-caveat p{margin:0;}
.v2-re-caveat-icon{
  display:inline-flex;vertical-align:-1px;margin-inline-end:4px;flex-shrink:0;color:var(--gold);
}
.v2-re-caveat-icon svg{display:block;}

/* ── Empty state — no recognized engine verdict this month ───────────────── */
.v2-re-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:9px;text-align:center;padding:20px 18px;flex:1;min-height:0;
  border:1px dashed rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.02);
}
.v2-re-empty-icon{display:inline-flex;color:var(--gold);opacity:.75;}
.v2-re-empty-icon svg{display:block;}
.v2-re-empty b{font-size:.92rem;font-weight:900;color:rgba(255,255,255,.96);}
.v2-re-empty p{margin:0;max-width:64ch;font-size:.72rem;line-height:1.65;color:var(--slate);}

body.theme-light .v2-re-agree,body.theme-light .v2-re-disagree,body.theme-light .v2-re-report{
  background:rgba(10,45,74,.035);border-color:rgba(10,45,74,.12);
}
body.theme-light .v2-re-block-head b{color:rgba(10,45,74,.92);}
body.theme-light .v2-re-disagree-rate{color:rgba(10,45,74,.85);}
body.theme-light .v2-re-empty{border-color:rgba(10,45,74,.2);background:rgba(10,45,74,.02);}
body.theme-light .v2-re-empty b{color:rgba(10,45,74,.95);}

@media print{
  .v2-re-agree,.v2-re-disagree,.v2-re-report,.v2-re-coverage,.v2-re-caveat,.v2-re-empty{break-inside:avoid;}
  .v2-re-agree .deck-table tr.v2-re-headline td{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`;
