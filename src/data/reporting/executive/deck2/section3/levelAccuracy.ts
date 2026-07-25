// Executive deck v2 — القسم 3, page: دقة إجابات المستوى الأول والثاني.
//
// Question this page answers: we drew a sample, a reviewer recorded OUR verdict
// on each image (اشتباه / سليمة), and every image carries two X-ray inspection
// decisions — المستوى الأول and المستوى الثاني. How well did each of those two
// decisions match the reviewer's verdict, per port, and which of the two did
// better?
//
// ── Domain note (do not "fix" the wording) ──────────────────────────────────
// المستوى الأول / الثاني / الثالث / الرابع are FOUR DISTINCT DETECTION
// SCENARIOS with different purposes — they are NOT a severity ladder. Nothing
// on this page may imply "level N is worse than level N-1", and the severity
// vocabulary (منخفض / متوسط / مرتفع / حرج) is deliberately absent.
//
// Separately: on THIS page "المستوى الأول / المستوى الثاني" means the two
// X-RAY INSPECTION LEVELS whose decisions are being scored (`decisionLevel`
// LEVEL_1 / LEVEL_2 on the fact table) — a different axis from the four risk
// levels above. The column head sub-line says «مرحلتا فحص بالأشعة» so a reader
// cannot confuse the two axes.
//
// ── Honesty discipline (shared across the whole section) ────────────────────
// * Every rate goes through `rateOf` → `null` on an empty denominator, which
//   renders «—», never a fabricated 0%.
// * Every rate is additionally gated by `isRankable(band(n))`; a port below the
//   data-sufficiency cut lists its name and its `ن`, but shows «—» instead of a
//   percentage, and is excluded from the الفارق comparison.
// * `ن` is ALWAYS printed, rankable or not.
// * Status is never conveyed by colour alone: `threshCell` adds an alert glyph
//   below target, and the الفارق figure carries an explicit +/− sign.

import { band, isRankable } from "../../model/dataSufficiency";
import type { DecisionLevel, OutcomeClass } from "../../model/decisionFactTable";
import type { ReportModel } from "../../model/reportModel";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
  pctCell,
  planPortPages,
  portTableCard,
  rateOf,
  threshCell,
  v2Slide,
} from "../slideKit";
import type { SlideBuilder } from "../slideKit";

/** Matches `foldBy`'s fallback key in model/aggregates.ts, so a port with no
 *  name reconciles against `model.portAccuracy` instead of splitting into two
 *  differently-named buckets. */
const UNKNOWN_PORT = "غير محدد";

/** The muted, bar-less cell used wherever a percentage is not honest to show
 *  (no denominator, or below the data-sufficiency cut). Same markup the
 *  section-2 port tables use, so the two pages read identically. */
const INSUFF_CELL = `<td class="v2-bar-cell neutral"><span class="insuff">—</span></td>`;

type LevelCounts = {
  correctClean: number;
  correctSuspicion: number;
  missedSuspicion: number;
  falseSuspicion: number;
};

/** One inspection level's scorecard at one port. */
type LevelStats = {
  /** The raw tally this was derived from — kept so the totals row can sum
   *  integers rather than re-multiplying rounded percentages back into counts. */
  counts: LevelCounts;
  /** Decisions with a reviewer verdict — the denominator, always printed. */
  evaluable: number;
  /** (correctClean + correctSuspicion) / evaluable. */
  accuracy: number | null;
  /** correctSuspicion / (correctSuspicion + missedSuspicion) — surfaced as the
   *  port cell's tooltip; the visible columns stay at five so the table fits
   *  its half-width card. */
  detection: number | null;
  rankable: boolean;
};

type LevelAccuracyRow = {
  name: string;
  sea: boolean;
  l1: LevelStats;
  l2: LevelStats;
};

function emptyCounts(): LevelCounts {
  return { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
}

function tally(counts: LevelCounts, outcome: Exclude<OutcomeClass, null>): void {
  if (outcome === "correct-clean") counts.correctClean += 1;
  else if (outcome === "correct-suspicion") counts.correctSuspicion += 1;
  else if (outcome === "missed-suspicion") counts.missedSuspicion += 1;
  else counts.falseSuspicion += 1;
}

function sumCounts(all: LevelCounts[]): LevelCounts {
  return all.reduce((acc, c) => {
    acc.correctClean += c.correctClean;
    acc.correctSuspicion += c.correctSuspicion;
    acc.missedSuspicion += c.missedSuspicion;
    acc.falseSuspicion += c.falseSuspicion;
    return acc;
  }, emptyCounts());
}

function statsOf(counts: LevelCounts): LevelStats {
  const evaluable =
    counts.correctClean + counts.correctSuspicion + counts.missedSuspicion + counts.falseSuspicion;
  return {
    counts,
    evaluable,
    accuracy: rateOf(counts.correctClean + counts.correctSuspicion, evaluable),
    detection: rateOf(counts.correctSuspicion, counts.correctSuspicion + counts.missedSuspicion),
    rankable: isRankable(band(evaluable)),
  };
}

type PortBucket = { name: string; sea: boolean } & Record<DecisionLevel, LevelCounts>;

/**
 * Fold `model.factTable` on (portName, decisionLevel).
 *
 * Records with `outcomeClass === null` are skipped — the reviewer recorded no
 * verdict for that image, so scoring the inspection decision against nothing
 * would invent an outcome. This is the SAME filter `aggregates.foldBy` applies
 * when it builds `model.portAccuracy`, which is why L1 + L2 counts here
 * reconcile exactly with that aggregate (asserted in the tests).
 */
function collectLevelAccuracyRows(model: ReportModel): {
  land: LevelAccuracyRow[];
  sea: LevelAccuracyRow[];
} {
  const buckets = new Map<string, PortBucket>();
  for (const rec of model.factTable) {
    if (rec.outcomeClass === null) continue;
    const name = rec.portName ?? UNKNOWN_PORT;
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = {
        name,
        sea: (rec.portType ?? "").includes("بحري"),
        LEVEL_1: emptyCounts(),
        LEVEL_2: emptyCounts(),
      };
      buckets.set(name, bucket);
    }
    tally(bucket[rec.decisionLevel], rec.outcomeClass);
  }

  const all: LevelAccuracyRow[] = [...buckets.values()]
    .map((b) => ({ name: b.name, sea: b.sea, l1: statsOf(b.LEVEL_1), l2: statsOf(b.LEVEL_2) }))
    // Busiest ports first. The name tiebreak is a plain codepoint compare (not
    // `localeCompare`) so the order cannot drift with the host's ICU data —
    // this deck must be byte-deterministic for the same model.
    .sort((a, b) => {
      const av = a.l1.evaluable + a.l2.evaluable;
      const bv = b.l1.evaluable + b.l2.evaluable;
      if (av !== bv) return bv - av;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

/** The signed points figure itself. `dir="ltr"` because a signed decimal is a
 *  Latin-numeral run inside an RTL table and would otherwise reorder. Tone is
 *  supplementary — the +/− sign carries the meaning on its own. */
function deltaSpan(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const tone = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `<span class="v2-lvlacc-delta ${tone}" dir="ltr">${sign}${Math.abs(rounded).toFixed(1)}</span>`;
}

/** الفارق = المستوى الثاني − المستوى الأول, in percentage points. Shown ONLY
 *  when both levels have an honest percentage to compare (non-null AND above
 *  the sufficiency cut); otherwise the muted «—». */
function deltaCell(l1: LevelStats, l2: LevelStats): string {
  if (l1.accuracy === null || l2.accuracy === null || !l1.rankable || !l2.rankable) {
    return INSUFF_CELL;
  }
  return `<td class="v2-bar-cell neutral">${deltaSpan(l2.accuracy - l1.accuracy)}</td>`;
}

/** العيّنة — evaluable decisions per level (column was labelled `ن`; owner,
 *  2026-07-25: "ن is shit just say العينة"). The two are structurally equal (a
 *  record's outcome is null exactly when the reviewer verdict is missing, which
 *  is a per-image fact, not a per-level one), so a single figure is printed;
 *  the split form is a defensive fallback, never a silent average. */
function nText(a: number, b: number): string {
  return a === b ? fmtNum(a) : `${fmtNum(a)} / ${fmtNum(b)}`;
}

function accuracyCell(s: LevelStats): string {
  return s.rankable ? threshCell(s.accuracy, ACCURACY_TARGET) : INSUFF_CELL;
}

function detectionTooltip(row: LevelAccuracyRow): string {
  const show = (s: LevelStats) => (s.rankable ? fmtPct(s.detection) : "—");
  return `دقة اكتشاف الاشتباه — المستوى الأول: ${show(row.l1)} · المستوى الثاني: ${show(row.l2)}`;
}

function levelTable(
  title: string,
  rows: LevelAccuracyRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const span = 5;
  const trs =
    rows.length > 0
      ? rows
          .map(
            (p) =>
              `<tr><td title="${esc(detectionTooltip(p))}">${esc(p.name)}</td>` +
              `${accuracyCell(p.l1)}${accuracyCell(p.l2)}${deltaCell(p.l1, p.l2)}` +
              `<td><span class="v2-lvlacc-n" dir="ltr">${esc(nText(p.l1.evaluable, p.l2.evaluable))}</span></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="${span}"><span class="insuff">لا توجد منافذ بهذه الفئة</span></td></tr>`;

  // Totals re-fold the SAME integer tallies the rows were built from, so the
  // column total can never disagree with its own rows (and never inherits the
  // rounding of a displayed percentage). Unrankable ports still count towards
  // the total — the sufficiency cut governs what is safe to show PER PORT, not
  // what the month actually contained.
  const totalL1 = statsOf(sumCounts(rows.map((p) => p.l1.counts)));
  const totalL2 = statsOf(sumCounts(rows.map((p) => p.l2.counts)));
  const totalDelta =
    totalL1.accuracy !== null && totalL2.accuracy !== null
      ? deltaSpan(totalL2.accuracy - totalL1.accuracy)
      : `<span class="insuff">—</span>`;
  const totalsRow =
    `<tr><td>الإجمالي</td><td>${pctCell(totalL1.accuracy)}</td><td>${pctCell(totalL2.accuracy)}</td>` +
    `<td>${totalDelta}</td><td><span class="v2-lvlacc-n" dir="ltr">${esc(nText(totalL1.evaluable, totalL2.evaluable))}</span></td></tr>`;

  // Sub-line disambiguates the axis (inspection stages, not the four risk
  // levels) in one short line — it must not wrap, or the card header grows and
  // the row budget below it stops holding.
  const headSub = `${fmtNum(rows.length)} منفذ · مرحلتا فحص بالأشعة`;
  const ths =
    `<th>المنفذ</th><th>دقة المستوى الأول</th><th>دقة المستوى الثاني</th>` +
    `<th title="الفارق بالنقاط المئوية (المستوى الثاني ناقص المستوى الأول)">الفارق</th><th>العيّنة</th>`;
  const headIcon = variant === "land" ? "truck" : "ship";
  // `land`/`sea` drive the existing card tints in theme.ts; `green`/`blue` are
  // the section-3 tone tokens the sibling pages use for the same two columns.
  const tone = variant === "land" ? "green" : "blue";

  return portTableCard({
    title,
    headSub,
    headIcon,
    variant,
    compact,
    extraClass: tone,
    theadCells: ths,
    bodyRowsHtml: trs,
    rowCount: rows.length,
    span,
    totalsRowHtml: totalsRow,
  });
}

/** Shown when NOT ONE decision in the month carries a reviewer verdict. States
 *  the situation in words and prints no figure at all — the alternative (a
 *  table of «—» rows, or worse a wall of 0%) would read as a measured result. */
function emptyState(): string {
  return `<div class="v2-lvlacc-empty">
    <span class="v2-lvlacc-empty-icon">${icon("layers", 26)}</span>
    <b>لا توجد إجابات مُعتمدة بعد لقياس الدقة</b>
    <p>لم تُسجَّل نتيجة المراجع لأي صورة في هذا الشهر، ولا يمكن مقارنة قرار المستوى الأول أو الثاني بغير نتيجة مُعتمدة. تظهر النسب في هذه الصفحة فور اعتماد إجابات المراجعة.</p>
  </div>`;
}

/**
 * Build the page — one slide, or several when either port column overruns the
 * row budget. Both columns paginate in lockstep (same slice index), matching
 * `accuracyPortSlideBuilders`, so a reader compares the same page position on
 * both sides.
 */
export function levelAccuracySlideBuilders(
  model: ReportModel,
  variantPreview: boolean,
): SlideBuilder[] {
  const { land, sea } = collectLevelAccuracyRows(model);
  const isEmpty = land.length === 0 && sea.length === 0;
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];

  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    const id = plan.pages > 1 ? `slide-s3-level-accuracy-${page + 1}` : "slide-s3-level-accuracy";
    builders.push((num, total) => {
      const body = isEmpty
        ? emptyState()
        : `<div class="v2-port-split v2-lvlacc">${levelTable("المنافذ البرية", landChunk, "land", plan.compact)}${levelTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id,
        title: `دقة إجابات المستوى الأول والثاني${cont}`,
        eyebrow: "القسم 3 — التحاليل المتقدمة",
        iconName: "layers",
        headline: `دقة إجابات المستوى الأول والثاني${cont}`,
        subhead: "مقارنة قرار كل مستوى بنتيجة المراجع، لكل منفذ.",
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
 * Page-local CSS. Everything structural is composed from existing classes
 * (`.v2-port-split`, `.v2-port-col`, `.deck-table`, `.v2-bar-cell`, `.insuff`,
 * `.v2-fill-row`); these rules only (a) keep a 5-column head on ONE line inside
 * a half-width card — a wrapped head would grow `.v2-port-col-head` and push
 * the totals row past the card's `overflow:hidden` edge — and (b) style the
 * الفارق figure and the empty state.
 *
 * Height-affecting properties are deliberately untouched on `td`: only
 * `padding-inline` is narrowed, so the measured 41px / 25px row heights that
 * `BASE_ROWS_PER_PAGE` is derived from still hold. Selectors are prefixed with
 * `.v2-port-split.v2-lvlacc` so they outrank theme.ts's `.v2-port-col.compact`
 * rules on specificity rather than on injection order.
 *
 * Colours come from the deck's own custom properties, or from `color-mix` on
 * `currentColor` so the empty state adapts to the light theme without a
 * second rule set. No raw hex literals.
 */
export const LEVEL_ACCURACY_CSS = `
/* Section 3 — دقة إجابات المستوى الأول والثاني */
.v2-port-split.v2-lvlacc .v2-port-col .deck-table th{
  font-size:0.62rem;white-space:nowrap;padding-inline:6px;
}
.v2-port-split.v2-lvlacc .v2-port-col.compact .deck-table th{font-size:0.55rem;}
.v2-port-split.v2-lvlacc .v2-port-col .deck-table td{padding-inline:6px;}
.v2-port-split.v2-lvlacc .v2-port-col .deck-table td:first-child{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.v2-port-split.v2-lvlacc .v2-lvlacc-delta{
  display:inline-block;font-weight:800;font-variant-numeric:tabular-nums;
}
.v2-port-split.v2-lvlacc .v2-lvlacc-delta.up{color:var(--green);}
.v2-port-split.v2-lvlacc .v2-lvlacc-delta.down{color:var(--coral);}
.v2-port-split.v2-lvlacc .v2-lvlacc-delta.flat{color:var(--slate);}
.v2-port-split.v2-lvlacc .v2-lvlacc-n{font-variant-numeric:tabular-nums;}
.v2-lvlacc-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;height:100%;width:100%;padding:0 10%;text-align:center;
  border:1px dashed color-mix(in srgb, currentColor 22%, transparent);border-radius:14px;
}
.v2-lvlacc-empty .v2-lvlacc-empty-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:56px;height:56px;border-radius:50%;color:var(--slate);
  border:1.5px solid color-mix(in srgb, currentColor 40%, transparent);
  background:color-mix(in srgb, currentColor 10%, transparent);
}
.v2-lvlacc-empty b{font-size:1rem;font-weight:800;}
.v2-lvlacc-empty p{
  margin:0;max-width:62ch;font-size:0.8rem;line-height:1.8;
  color:color-mix(in srgb, currentColor 70%, transparent);
}
`;
