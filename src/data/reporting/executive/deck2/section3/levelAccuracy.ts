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
import type { PortLevelAccuracy } from "../../model/aggregates";
import type { ReportModel } from "../../model/reportModel";
import { esc, fmtNum, fmtPct } from "../../primitives";
import { icon } from "../../ui/icons";
import { metricMatrix } from "../../ui/analyticsCharts";
import {
  ACCURACY_TARGET,
  BASE_ROWS_PER_PAGE,
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
  /** Whether detection's OWN (smaller) denominator — `correctSuspicion +
   *  missedSuspicion` — clears the sufficiency cut, independently of
   *  `rankable` (gated on `evaluable`, accuracy's own denominator). A port can
   *  have plenty of evaluable decisions yet very few confirmed-suspicion ones,
   *  so detection must be suppressed on ITS OWN thin base even when accuracy
   *  is shown. */
  detectionRankable: boolean;
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
    detectionRankable: isRankable(band(counts.correctSuspicion + counts.missedSuspicion)),
  };
}

function statsFromPortLevel(entry: PortLevelAccuracy | undefined): LevelStats {
  const counts: LevelCounts = entry
    ? {
        correctClean: entry.correctClean,
        correctSuspicion: entry.correctSuspicion,
        missedSuspicion: entry.missedSuspicion,
        falseSuspicion: entry.falseSuspicion,
      }
    : emptyCounts();
  return statsOf(counts);
}

/**
 * Build this page's rows from `model.portAccuracyByLevel` — the shared
 * decision-per-level fold (`aggregates.ts`'s `foldByPortAndLevel`, itself a
 * thin wrapper over `decisionFactTable.ts`'s `aggregateDecisions`). This page
 * used to run its OWN fold directly over `model.factTable`; that was the
 * THIRD independent implementation of the same L1/L2-per-port tally the
 * 2026-08-07 unification removed (see the edit log) — `statsOf` here just
 * re-derives the presentation-layer rates (`accuracy`/`detection`/`rankable`)
 * from the shared fold's raw counts, so L1 + L2 here still reconciles exactly
 * with `model.portAccuracy` (asserted in the tests) without a second count
 * loop over the fact table.
 */
function collectLevelAccuracyRows(model: ReportModel): {
  land: LevelAccuracyRow[];
  sea: LevelAccuracyRow[];
} {
  const seaByPort = new Map<string, boolean>();
  for (const rec of model.factTable) {
    const name = rec.portName ?? UNKNOWN_PORT;
    if (!seaByPort.has(name)) seaByPort.set(name, (rec.portType ?? "").includes("بحري"));
  }

  const byPort = new Map<string, { l1?: PortLevelAccuracy; l2?: PortLevelAccuracy }>();
  for (const entry of model.portAccuracyByLevel) {
    const bucket = byPort.get(entry.portName) ?? {};
    if (entry.level === "LEVEL_1") bucket.l1 = entry;
    else bucket.l2 = entry;
    byPort.set(entry.portName, bucket);
  }

  const all: LevelAccuracyRow[] = [...byPort.entries()]
    .map(([name, b]) => ({
      name,
      sea: seaByPort.get(name) ?? false,
      l1: statsFromPortLevel(b.l1),
      l2: statsFromPortLevel(b.l2),
    }))
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
  // Gated on `detectionRankable` (detection's OWN correctSuspicion+
  // missedSuspicion base), NOT `rankable` (accuracy's evaluable base) — a
  // port can clear the accuracy cut while its confirmed-suspicion base stays
  // too thin to publish a detection rate (2026-07-30 fix).
  const show = (s: LevelStats) => (s.detectionRankable ? fmtPct(s.detection) : "—");
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

/** Whether both levels have an honest, comparable rate at this port — the
 *  same gate `deltaCell` already applies (evaluable > 0 on both levels AND
 *  both above the data-sufficiency cut). Named so the Briefing/Grid variants
 *  below share one definition of "rankable" with the Ledger table instead of
 *  re-deriving it. */
function levelDelta(p: LevelAccuracyRow): number | null {
  if (p.l1.accuracy === null || p.l2.accuracy === null || !p.l1.rankable || !p.l2.rankable) {
    return null;
  }
  return p.l2.accuracy - p.l1.accuracy;
}

/**
 * Signed points figure for Briefing's `valueText` — same rounding/sign
 * convention as `deltaSpan` (the Ledger figure above: round to 0.1, "+"/"−"
 * sign always printed), but WITHOUT `deltaSpan`'s `.v2-lvlacc-delta` tone
 * class — the row's colour comes from `briefingRankList`'s own per-item
 * `tone` override (green/coral), not from this span. `dir="ltr"` is still
 * needed on its own: a signed Latin-numeral run inside an RTL rank row would
 * otherwise reorder.
 */
function signedPointsText(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `<span dir="ltr">${sign}${Math.abs(rounded).toFixed(1)}</span>`;
}

/**
 * Ledger-system level-accuracy table (fan-out plan §11b, batch B2b) —
 * near-clone of `levelTable`'s columns through the shared `ledgerPortCard`
 * (P2), plus an ordinal badge. `deltaSpan` and the detection tooltip carry
 * over unchanged — a signed figure is data, not a chart, and per-port
 * detection rate has nowhere else to go without growing the column count.
 */
function ledgerLevelTable(
  title: string,
  rows: LevelAccuracyRow[],
  compact: boolean,
): string {
  const span = 5;
  const trs = rows
    .map(
      (p, i) =>
        `<tr><td title="${esc(detectionTooltip(p))}">${ledgerIdx(i)}${esc(p.name)}</td>` +
        `${accuracyCell(p.l1)}${accuracyCell(p.l2)}${deltaCell(p.l1, p.l2)}` +
        `<td><span class="v2-lvlacc-n" dir="ltr">${esc(nText(p.l1.evaluable, p.l2.evaluable))}</span></td></tr>`,
    )
    .join("");

  const totalL1 = statsOf(sumCounts(rows.map((p) => p.l1.counts)));
  const totalL2 = statsOf(sumCounts(rows.map((p) => p.l2.counts)));
  const totalDelta =
    totalL1.accuracy !== null && totalL2.accuracy !== null
      ? deltaSpan(totalL2.accuracy - totalL1.accuracy)
      : `<span class="insuff">—</span>`;
  const totalsRow =
    `<tr><td>الإجمالي</td><td>${pctCell(totalL1.accuracy)}</td><td>${pctCell(totalL2.accuracy)}</td>` +
    `<td>${totalDelta}</td><td><span class="v2-lvlacc-n" dir="ltr">${esc(nText(totalL1.evaluable, totalL2.evaluable))}</span></td></tr>`;

  return ledgerPortCard({
    title,
    theadCells:
      `<th>المنفذ</th><th>دقة المستوى الأول</th><th>دقة المستوى الثاني</th>` +
      `<th title="الفارق بالنقاط المئوية (المستوى الثاني ناقص المستوى الأول)">الفارق</th><th>العيّنة</th>`,
    bodyRowsHtml: trs,
    totalsRowHtml: totalsRow,
    span,
    rowCount: 0,
    compact,
  });
}

/**
 * Briefing-system level-accuracy rank list (fan-out plan §11b) — the one
 * page in this batch with a genuinely SIGNED bar magnitude. Rank rows are
 * sorted by `|الفارق| desc` among RANKABLE ports only (`levelDelta` !== null);
 * `scale: {kind:"auto"}` is computed by `briefingRankList` over `item.value`,
 * which this function fills with `Math.abs(delta)` — never the signed value —
 * because a negative magnitude would break the scale/bar-width math (a bar
 * cannot have a negative percentage width). The DISPLAYED `valueText` still
 * carries the real signed number (`signedPointsText`), and the row's `tone`
 * is overridden per-row: green when `delta > 0` (level 2 more accurate),
 * coral when `delta < 0` — the sign is always printed too, never colour alone.
 *
 * Unrankable ports (`levelDelta(p) === null`) are excluded from ranking and
 * folded into a bar-less remainder, pooled from SUMMED raw counts via
 * `statsOf(sumCounts(...))` — never averaging each folded port's own delta —
 * same anti-averaging discipline, and the same `rawForFold`-parallel-to-
 * `rankItems` technique, every other exclusion in this fan-out uses.
 */
function briefingLevelRank(landChunk: LevelAccuracyRow[], seaChunk: LevelAccuracyRow[]): string {
  const combinedAll = [...landChunk, ...seaChunk];
  if (combinedAll.length === 0) {
    return `<div class="v2-sys-brief v2-bf-level-accuracy">
      <div class="v2-bf-lede"><div class="v2-bf-lede-figure blue"><span class="insuff">—</span></div></div>
    </div>`;
  }

  // Pooled lede delta: from SUMMED integer counts, never from averaging each
  // port's own (already-rounded) rate — same discipline `levelTable`'s own
  // totals row already follows.
  const totalL1 = statsOf(sumCounts(combinedAll.map((p) => p.l1.counts)));
  const totalL2 = statsOf(sumCounts(combinedAll.map((p) => p.l2.counts)));
  const pooledDelta =
    totalL1.accuracy !== null && totalL2.accuracy !== null ? totalL2.accuracy - totalL1.accuracy : null;

  const supportStrip = briefingSupport([
    { iconName: "gauge", value: pctCell(totalL1.accuracy), label: "دقة المستوى الأول" },
    { iconName: "gauge", value: pctCell(totalL2.accuracy), label: "دقة المستوى الثاني" },
    { iconName: "scan", value: fmtNum(totalL1.evaluable), label: "العيّنة الإجمالية" },
  ]);
  const basis = `${portCountPhrase(combinedAll.length)} · ${fmtNum(totalL1.evaluable)} قرار قابل للتقييم`;

  const rankable = combinedAll
    .map((p) => ({ p, delta: levelDelta(p) }))
    .filter((x): x is { p: LevelAccuracyRow; delta: number } => x.delta !== null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const excluded = combinedAll.filter((p) => levelDelta(p) === null);

  const rankItems: BriefingRankItem[] = rankable.map(({ p, delta }) => ({
    label: p.name,
    value: Math.abs(delta),
    valueText: signedPointsText(delta),
    secondaryText: `الأول ${pctCell(p.l1.accuracy)} · الثاني ${pctCell(p.l2.accuracy)}`,
    tone: delta > 0 ? "green" : delta < 0 ? "coral" : undefined,
  }));
  // Raw per-item L1/L2 counts, PARALLEL to rankItems (plus one synthetic slot
  // pooling the whole excluded group), so foldRemainder can recover a real
  // pooled delta for whatever tail actually gets folded — same technique
  // briefingQualityRank/briefingAccuracyRank use (slides.ts).
  const rawForFold: Array<{ l1: LevelCounts; l2: LevelCounts }> = rankable.map((r) => ({
    l1: r.p.l1.counts,
    l2: r.p.l2.counts,
  }));
  if (excluded.length > 0) {
    rankItems.push({
      label: `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`,
      value: null,
      valueText: "—",
      secondaryText: "",
    });
    rawForFold.push({
      l1: sumCounts(excluded.map((p) => p.l1.counts)),
      l2: sumCounts(excluded.map((p) => p.l2.counts)),
    });
  }

  const rankHtml = briefingRankList({
    items: rankItems,
    tone: "blue",
    scale: { kind: "auto" },
    foldRemainder: (folded) => {
      const raw = rawForFold.slice(rawForFold.length - folded.length);
      const totL1 = statsOf(sumCounts(raw.map((r) => r.l1)));
      const totL2 = statsOf(sumCounts(raw.map((r) => r.l2)));
      const delta = totL1.accuracy !== null && totL2.accuracy !== null ? totL2.accuracy - totL1.accuracy : null;
      const isPureExclusion = excluded.length > 0 && folded.length === 1 && folded[0].value === null;
      return {
        label: isPureExclusion
          ? `منافذ دون حد الكفاية (${fmtNum(excluded.length)})`
          : `بقية المنافذ (${fmtNum(folded.length)})`,
        value: delta !== null ? Math.abs(delta) : null,
        valueText: delta !== null ? signedPointsText(delta) : "—",
        secondaryText: totL1.evaluable > 0 ? `الأول ${pctCell(totL1.accuracy)} · الثاني ${pctCell(totL2.accuracy)}` : "",
        rest: true,
      };
    },
  });

  return `<div class="v2-sys-brief v2-bf-level-accuracy">
    ${briefingLede({
      figure: pooledDelta !== null ? signedPointsText(pooledDelta) : `<span class="insuff">—</span>`,
      tone: "blue",
      label:
        pooledDelta !== null
          ? `فارق المستويين ${signedPointsText(pooledDelta)} نقطة — الثاني ${pctCell(totalL2.accuracy)} مقابل الأول ${pctCell(totalL1.accuracy)}`
          : `فارق المستويين — لا تتوفر بيانات كافية للمقارنة`,
      basis,
    })}
    ${supportStrip}
    ${rankHtml}
  </div>`;
}

/**
 * Grid-system level-accuracy matrix (fan-out plan §11b) — rows = ports,
 * columns دقة الأول / دقة الثاني (`[0,100] sequential-gold`), الفارق, and
 * العيّنة (`[0,max] sequential-gold`). الفارق is the ONE column in this
 * fan-out with a genuine midpoint (zero: neither level is "better" by
 * default) — it uses `diverging-green-coral` with a REVERSED symmetric
 * domain `[m, -m]` (`m` = max `|delta|` among this panel's OWN rankable
 * rows), per `metricMatrix`'s documented reversed-domain contract (P0, see
 * that function's doc comment and its "reversed domain … inverts polarity"
 * test): a NORMAL domain `[-m, m]` would tint a positive delta (level 2 more
 * accurate — the reading this page wants readers to see as "good") CORAL,
 * because `tintOf` paints values near the domain's high endpoint (`d1`)
 * coral and values near the low endpoint (`d0`) green. Reversing the
 * endpoints to `[m, -m]` swaps which raw value sits near `d0` vs `d1`
 * without touching `tintOf`'s math at all, so a positive delta (near `+m`,
 * now `d0`) tints green and a negative delta (near `-m`, now `d1`) tints
 * coral — verified against `metricMatrix`'s own "a reversed domain … inverts
 * … polarity" unit test in `analyticsCharts.test.ts`, not just read off the
 * plan doc's notation.
 * Unrankable ports pass `null` for both accuracy columns AND الفارق (never a
 * fabricated delta) while still showing العيّنة.
 */
function gridLevelMatrix(
  title: string,
  rows: LevelAccuracyRow[],
  variant: "land" | "sea",
  compact: boolean,
): string {
  const deltas = rows.map((p) => levelDelta(p)).filter((d): d is number => d !== null);
  const m = Math.max(1, ...deltas.map((d) => Math.abs(d)));
  const sampleOf = (p: LevelAccuracyRow) => Math.max(p.l1.evaluable, p.l2.evaluable);
  const matrix = metricMatrix(
    {
      rowLabels: rows.map((p) => p.name),
      columns: [
        {
          label: "دقة الأول",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: rows.map((p) => (p.l1.rankable ? p.l1.accuracy : null)),
        },
        {
          label: "دقة الثاني",
          domain: [0, 100],
          ramp: "sequential-gold",
          values: rows.map((p) => (p.l2.rankable ? p.l2.accuracy : null)),
        },
        {
          label: "الفارق",
          // Reversed domain — see this function's doc comment above.
          domain: [m, -m],
          ramp: "diverging-green-coral",
          values: rows.map((p) => levelDelta(p)),
        },
        {
          label: "العيّنة",
          domain: [0, maxOf(rows.map(sampleOf))],
          ramp: "sequential-gold",
          values: rows.map(sampleOf),
        },
      ],
    },
    { width: 620, height: 320, compact, caption: `مصفوفة ${title}`, rowHeader: "المنفذ", emptyNote: "لا توجد بيانات" },
  );
  return gridPanel({
    title,
    sub: `${fmtNum(rows.length)} منفذ · الفارق: أخضر = الثاني أدق`,
    variant,
    chartHtml: matrix,
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
      const ledgerBody = isEmpty
        ? emptyState()
        : `<div class="v2-sys-ledger v2-lg-level-accuracy"><div class="v2-lg-split">${ledgerLevelTable("المنافذ البرية", landChunk, plan.compact)}${ledgerLevelTable("المنافذ البحرية", seaChunk, plan.compact)}</div></div>`;
      const briefingBody = isEmpty
        ? emptyState()
        : briefingLevelRank(landChunk, seaChunk);
      const gridBody = isEmpty
        ? emptyState()
        : `<div class="v2-sys-grid v2-gd-level-accuracy"><div class="v2-gd-split">${gridLevelMatrix("المنافذ البرية", landChunk, "land", plan.compact)}${gridLevelMatrix("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div></div>`;
      return v2Slide({
        id,
        title: `دقة إجابات المستوى الأول والثاني${cont}`,
        eyebrow: "القسم 3 — التحاليل المتقدمة",
        iconName: "layers",
        headline: `دقة إجابات المستوى الأول والثاني${cont}`,
        subhead: "مقارنة قرار كل مستوى بنتيجة المراجع، لكل منفذ.",
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
/* Ledger/Briefing/Grid namespacing hooks (fan-out plan §11b, batch B2b) —
   "nothing bespoke beyond the shared components" role, same as every other
   fanned-out page's page-local hook (see theme.ts's .v2-lg-port-sample etc.). */
.v2-lg-level-accuracy,.v2-bf-level-accuracy,.v2-gd-level-accuracy{height:100%;}
/* deltaSpan's tone classes, re-scoped for the Ledger card: the original rule
   above targets .v2-port-split.v2-lvlacc (slot 0's shell), which the Ledger
   card (.v2-lg-port-card, via ledgerPortCard) never sits inside. */
.v2-lg-level-accuracy .v2-lvlacc-delta{display:inline-block;font-weight:800;font-variant-numeric:tabular-nums;}
.v2-lg-level-accuracy .v2-lvlacc-delta.up{color:var(--green);}
.v2-lg-level-accuracy .v2-lvlacc-delta.down{color:var(--coral);}
.v2-lg-level-accuracy .v2-lvlacc-delta.flat{color:var(--slate);}
.v2-lg-level-accuracy .v2-lvlacc-n{font-variant-numeric:tabular-nums;}
/* Grid land/sea accent, matching every other fanned-out Grid page's panel
   border/sub-line tint convention (theme.ts's .v2-gd-port-population etc.). */
.v2-gd-level-accuracy .v2-gd-panel.land{border-color:rgba(139,195,74,.35);}
.v2-gd-level-accuracy .v2-gd-panel.sea{border-color:rgba(107,169,248,.35);}
.v2-gd-level-accuracy .v2-gd-panel.land .v2-gd-panel-head span{color:var(--green);}
.v2-gd-level-accuracy .v2-gd-panel.sea .v2-gd-panel-head span{color:var(--blue);}
body.theme-light .v2-gd-level-accuracy .v2-gd-panel.land .v2-gd-panel-head span{color:color-mix(in srgb, var(--green) 70%, black);}
body.theme-light .v2-gd-level-accuracy .v2-gd-panel.sea .v2-gd-panel-head span{color:color-mix(in srgb, var(--blue) 70%, black);}
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
