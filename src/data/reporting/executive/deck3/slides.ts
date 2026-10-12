// The 21 handoff slides (design_handoff_xray_qa_deck, rebuilt 2026-08-26 to
// the handoff's exact layouts), wired to real report data. Every figure comes
// from the shared ReportModel folds or deck2's exported section-3 helpers —
// nothing is re-tallied here beyond presentation-layer rates, and the
// handoff's placeholder numbers never appear. Static Arabic prose (glossary
// definitions, level definitions, section descriptions) is the handoff's own
// locked wording, hardcoded the same way deck2 hardcodes its one-off slide
// copy.
import { getStageKey } from "../../../population/stageHelpers";
import { yieldToMain } from "../../../storage/yieldToMain";
import { esc, fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import { getLabels } from "../../../labels/labelsStore";
import type { KeyedAccuracy } from "../model/aggregates";
import { collectPortStats, type PortPopRow } from "../deck2/slideKit";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import { populationScopedRows } from "../../executiveReportTypes";
import { engineVerdictOf } from "../deck2/section3/riskEngineAgreement";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";
import {
  coverSlide, closingSlide, contentsSlide, glossarySlide, levelDefinitionSlide,
  kpiBand, sectionDivider, tintedPanel, dataTable, chartTitleRow,
  legendRow, slideShell, contentHead, pad2, qualityMatrix, statementList,
  type OrgBlock, type SlideMeta, type TableCell, type QualityCell, type QualityRow,
} from "./slideKit";
import { aggregateDecisions, buildDecisionRecords } from "../model/decisionFactTable";
import { barChart, fitAxis, scaleCaption } from "./chartKit";

/**
 * Max port rows one `.v3-panel` table page can hold without spilling past the
 * fixed 1920×1080 slide (measured live in deck-preview.html against a
 * synthetic 15-land-port fixture, 2026-09-03 — the handoff's own port count
 * fit inside one page and never surfaced this): available row budget = slide
 * content height (1080 − 84 top / 56 bottom padding = 940) − `.v3-head`
 * (122 + 30 margin) − `.v3-page-foot` (60) = 728 for `.v3-two-col`; inside
 * each panel, padding (24×2) + `.v3-panel-head` (49 + 14 margin) + `thead`
 * (63) + `tfoot` (67) = 241 fixed overhead, leaving 487 for body rows at the
 * table's own 58px row height. The port tables are one full-width page per
 * port type listing every port, so instead of splitting into `(يتبع)`
 * continuation slides the rows shrink (`portRowPx`) to fit that body budget
 * rather than silently overflow the slide's `overflow:hidden` bottom edge.
 */
const PORT_BODY_BUDGET_PX = 487;
/** Height the one-line weighted-agreement formula note takes under a port table. */
const FORMULA_NOTE_PX = 40;
/** The group-label header row above a port table's column headers. */
const TOP_HEADER_PX = 40;
/** Body-row height (px) that fits `n` port rows in the budget: 56px max, 24px floor. */
function portRowPx(n: number, reservedPx = 0): number {
  return Math.max(24, Math.min(56, Math.floor((PORT_BODY_BUDGET_PX - reservedPx) / Math.max(1, n))));
}

const REPORT_NAME = "تقرير ضمان جودة فحص الأشعة";
const ORG_NAME = "هيئة الزكاة والضريبة والجمارك";
const CLASSIFICATION = "سري";
/** Deck-local cover wording (the shared ORGANIZATION_PATH is left as-is: deck2 and other surfaces still read it). */
const LEGAL_SECTOR = `قطاع ${ORGANIZATION_PATH[0]}`;
const DEPARTMENT = "إدارة الرقابة على الامتثال للمنافذ الجمركية";

const EYEBROW_S1 = "القسم الأول - مجتمع الفحص والعيّنة";
const EYEBROW_S2 = "القسم الثاني — نتائج فحص الجودة";
const EYEBROW_S3 = "القسم الثالث - الإفادات";

export type StatementPriority = "عالية" | "متوسطة" | "للعلم";
/** A key statement drafted from the report's results (see statements.ts); `basis` and `page` trace its figures. */
export type Statement = { priority: StatementPriority; topic: string; text: string; /** Same statement in words only, no figures. */ plain: string; basis: string; page: string };
const STATEMENTS_PER_PAGE = 5;
const STATEMENT_PLACEHOLDER = "اكتب الإفادة هنا…";

// ── Presentation-layer rate helpers ─────────────────────────────────────────

export function pct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

/** "98.2% (12,021)" — a rate with its bracketed denominator, muted. */
function rateCell(rate: number | null, count: number): string {
  return `${fmtPct(rate)}<span class="v3-sub"> (${fmtNum(count)})</span>`;
}

/** "22,514 (27.9%)" — a count with its bracketed share. */
function countRateCell(count: number, rate: number | null): string {
  return `${fmtNum(count)}<span class="v3-sub"> (${fmtPct(rate)})</span>`;
}

// One definition per measure, shared by every page that shows it so the wording can never drift.
const RESULT_ACCURACY_DEFINITION = "الحالات التي تم الاتفاق على نتيجتها بين الوسائل الآلية وأخصائي ضمان الجودة";
const MISSED_SUSPICION_DEFINITION = "نتيجة أخصائي الوسائل الآلية بأن الإرسالية سليمة ورأي أخصائي ضمان الجودة بأنها اشتباه.";
/** How معدل الاتفاق العام is calculated (one line, no worked weights). */
const AGREEMENT_FORMULA_NOTE = "معدل الاتفاق العام = (دقة السليمة × وزن السليمة) + (دقة الاشتباه × وزن الاشتباه)";
const FALSE_SUSPICION_DEFINITION = "نتيجة أخصائي الوسائل الآلية بأن الإرسالية اشتباه، ورأى أخصائي الجودة أنها سليمة.";

/** "21,480 (1,031)" — population figure with its bracketed sample figure. */
function popCell(population: number, sample: number, stacked = false): string {
  // Stacked (5-column port tables of a summary-backed report): the sample figure sits under the population one.
  if (stacked) return `${fmtNum(population)}<br><span class="v3-sub v3-sub-sm">(${fmtNum(sample)})</span>`;
  return `${fmtNum(population)}<span class="v3-sub"> (${fmtNum(sample)})</span>`;
}

export type FourCounts = { correctClean: number; correctSuspicion: number; missedSuspicion: number; falseSuspicion: number };

export function accuracyOf(c: FourCounts): {
  evaluable: number;
  cleanResults: number;
  suspResults: number;
  cleanAcc: number | null;
  suspAcc: number | null;
  overall: number | null;
} {
  const cleanResults = c.correctClean + c.missedSuspicion;
  const suspResults = c.correctSuspicion + c.falseSuspicion;
  const evaluable = cleanResults + suspResults;
  return {
    evaluable,
    cleanResults,
    suspResults,
    cleanAcc: pct(c.correctClean, cleanResults),
    suspAcc: pct(c.correctSuspicion, suspResults),
    overall: pct(c.correctClean + c.correctSuspicion, evaluable),
  };
}

export function sumCounts(all: FourCounts[]): FourCounts {
  return all.reduce(
    (acc, c) => ({
      correctClean: acc.correctClean + c.correctClean,
      correctSuspicion: acc.correctSuspicion + c.correctSuspicion,
      missedSuspicion: acc.missedSuspicion + c.missedSuspicion,
      falseSuspicion: acc.falseSuspicion + c.falseSuspicion,
    }),
    { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 },
  );
}

/** Deterministic port order: busiest first, then plain codepoint compare (the
 *  same no-ICU-drift rule collectLevelAccuracyRows documents). */
function byEvaluableDesc<T extends { evaluable: number; name: string }>(a: T, b: T): number {
  if (a.evaluable !== b.evaluable) return b.evaluable - a.evaluable;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export type PortAccuracyRow = { name: string; sea: boolean; counts: FourCounts; evaluable: number };

/** model.portAccuracy (the shared decision-combined per-port fold) split into
 *  land/sea using the rows' own portType — mirrors collectPortStats's rule. */
export function collectPortAccuracy(model: ReportModel): { land: PortAccuracyRow[]; sea: PortAccuracyRow[] } {
  const seaByPort = new Map<string, boolean>();
  for (const r of model.rows) {
    const name = r.portName ?? "غير محدد";
    if (!seaByPort.has(name)) seaByPort.set(name, (r.portType ?? "").includes("بحري"));
  }
  const all: PortAccuracyRow[] = model.portAccuracy.map((p: KeyedAccuracy) => ({
    name: p.key,
    sea: seaByPort.get(p.key) ?? false,
    counts: {
      correctClean: p.correctClean,
      correctSuspicion: p.correctSuspicion,
      missedSuspicion: p.missedSuspicion,
      falseSuspicion: p.falseSuspicion,
    },
    evaluable: p.evaluable,
  }));
  all.sort(byEvaluableDesc);
  return { land: all.filter((p) => !p.sea), sea: all.filter((p) => p.sea) };
}

/** Suspicion images per port: how many, how many carry a marking («هل يوجد تحديد؟» = نعم), and their image quality. */
export type MarkingCounts = { images: number; marked: number; unmarked: number; low: number; mid: number; high: number; unstudied: number };

export const emptyMarking = (): MarkingCounts => ({ images: 0, marked: 0, unmarked: 0, low: 0, mid: 0, high: 0, unstudied: 0 });

/**
 * Marking follow-up per port, counted on IMAGES (one report row = one image). The workbook records the marking
 * on the image and not per level, so no level split is made. Base = images whose result is اشتباه.
 * `images` counts only images with BOTH answers («هل يوجد تحديد؟» and the quality level), so marked + unmarked
 * and low + medium + high each add up to it; the rest are `unstudied` (shown in the page footer).
 */
export function collectPortMarking(model: ReportModel): Map<string, MarkingCounts> {
  const byPort = new Map<string, MarkingCounts>();
  for (const r of model.rows) {
    if (r.imageResult !== "اشتباه") continue;
    const key = r.portName ?? "غير محدد";
    const c = byPort.get(key) ?? emptyMarking();
    byPort.set(key, c);
    if (r.hasMarking === null || r.imageQuality === null) { c.unstudied++; continue; }
    c.images++;
    if (r.hasMarking === true) c.marked++;
    else c.unmarked++;
    if (r.imageQuality === "منخفض") c.low++;
    else if (r.imageQuality === "متوسط") c.mid++;
    else if (r.imageQuality === "عالي") c.high++;
  }
  return byPort;
}

/** Image-quality follow-up per port. Unlike marking, quality applies to EVERY evaluated image, whatever its L1/L2 result. */
export type QualityCounts = { images: number; low: number; mid: number; high: number };

export const emptyQuality = (): QualityCounts => ({ images: 0, low: 0, mid: 0, high: 0 });

export function collectPortQuality(model: ReportModel): Map<string, QualityCounts> {
  const byPort = new Map<string, QualityCounts>();
  for (const r of model.rows) {
    if (r.imageQuality === null) continue;
    const key = r.portName ?? "غير محدد";
    const c = byPort.get(key) ?? emptyQuality();
    byPort.set(key, c);
    c.images++;
    if (r.imageQuality === "منخفض") c.low++;
    else if (r.imageQuality === "متوسط") c.mid++;
    else c.high++;
  }
  return byPort;
}

export function sumQuality(list: QualityCounts[]): QualityCounts {
  return list.reduce((a, c) => ({ images: a.images + c.images, low: a.low + c.low, mid: a.mid + c.mid, high: a.high + c.high }), emptyQuality());
}

/** «هل يوجد تحديد؟» per port, on suspicion images only (L1 or L2 = اشتباه): a marking is only drawn where something was seen. */
export type MarkingOnlyCounts = { images: number; marked: number; unmarked: number };

export function collectPortMarkingOnly(model: ReportModel): Map<string, MarkingOnlyCounts> {
  const byPort = new Map<string, MarkingOnlyCounts>();
  for (const r of model.rows) {
    if (r.imageResult !== "اشتباه" || r.hasMarking === null) continue;
    const key = r.portName ?? "غير محدد";
    const c = byPort.get(key) ?? { images: 0, marked: 0, unmarked: 0 };
    byPort.set(key, c);
    c.images++;
    if (r.hasMarking) c.marked++;
    else c.unmarked++;
  }
  return byPort;
}

export function sumMarking(list: MarkingCounts[]): MarkingCounts {
  return list.reduce((a, c) => ({
    images: a.images + c.images, marked: a.marked + c.marked, unmarked: a.unmarked + c.unmarked,
    low: a.low + c.low, mid: a.mid + c.mid, high: a.high + c.high, unstudied: a.unstudied + c.unstudied,
  }), emptyMarking());
}

/** model.stageAccuracy ordered by the population profile's stage order, so
 *  the accuracy table lists levels 1→4 the way every other slide does. */
export function orderedStageAccuracy(model: ReportModel): Array<{ label: string; counts: FourCounts; evaluable: number }> {
  const order = model.population.byStage.map((s) => s.stageLabel);
  const indexOf = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return [...model.stageAccuracy]
    .sort((a, b) => {
      const ai = indexOf(a.key);
      const bi = indexOf(b.key);
      if (ai !== bi) return ai - bi;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map((s) => ({
      label: s.key,
      counts: {
        correctClean: s.correctClean,
        correctSuspicion: s.correctSuspicion,
        missedSuspicion: s.missedSuspicion,
        falseSuspicion: s.falseSuspicion,
      },
      evaluable: s.evaluable,
    }));
}

const LEVEL_TONES = ["gold", "blue", "green-soft", "red"] as const;

// ── The deck ────────────────────────────────────────────────────────────────

/** Scope-dependent wording and figures for deck3 — one object per scope, so the
 *  slide assembly reads `copy.x` instead of branching on the scope at every use. */
type Deck3Copy = {
  eyebrowS2: string;
  eyebrowS3: string;
  kpiTitle: string;
  kpiEyebrow: string;
  coverKicker: string;
  coverPeriodLabel: string;
  weightLines: readonly [string, string, string, string];
  highlightValue: string;
  highlightTitle: string;
  highlightNote: string;
  s2Ghost: string;
  s2Kicker: string;
  s2Description: string;
  s2FootLead: string;
  s3Ghost: string;
  s3Kicker: string;
  levelsChartNote: string;
  engineEmpty: string;
  closingLine: string;
};

function deck3Copy(completedOnly: boolean, monthlyTarget: number, completedTotal: string, withPopulation = false): Deck3Copy {
  if (completedOnly) {
    const ceLabels = getLabels();
    return {
      eyebrowS2: withPopulation ? EYEBROW_S2 : "القسم الأول — نتائج فحص الجودة",
      eyebrowS3: withPopulation ? EYEBROW_S3 : "القسم الثاني - الإفادات",
      kpiTitle: "المؤشرات الرئيسية",
      kpiEyebrow: "خلاصة التقرير",
      coverKicker: "عرض تنفيذي · تقرير شامل",
      coverPeriodLabel: "فترة الدراسة",
      // No draw weights or monthly target behind completed-only rows.
      weightLines: ["", "", "", ""],
      highlightValue: completedTotal,
      // Empty title → the level-definitions slide omits the callout entirely.
      highlightTitle: withPopulation ? "" : ceLabels.ce_completed_samples,
      highlightNote: withPopulation ? "" : ceLabels.ce_scope_note,
      s2Ghost: withPopulation ? "02" : "01",
      s2Kicker: withPopulation ? "القسم الثاني" : "القسم الأول",
      s2Description: "دقة النتائج وتحديد موقع الاشتباه والاشتباهات الفائتة على مستوى التقرير والمنافذ والمستويات.",
      s2FootLead: "النتائج العامة",
      s3Ghost: withPopulation ? "03" : "02",
      s3Kicker: withPopulation ? "القسم الثالث" : "القسم الثاني",
      levelsChartNote: "الأعمدة بنفس أرقام صفحة دقة الرصد العامة — الخطان المتقطعان متوسطا التقرير",
      engineEmpty: "لا توجد صور مستهدفة من محرك المخاطر في العيّنات المكتملة.",
      closingLine: "نرحّب بالملاحظات والأسئلة على نتائج التقرير.",
    };
  }
  const fixedShare = (weight: number) => fmtNum(Math.round(monthlyTarget * weight));
  return {
    eyebrowS2: EYEBROW_S2,
    eyebrowS3: EYEBROW_S3,
    kpiTitle: "مؤشرات الشهر",
    kpiEyebrow: "خلاصة الشهر",
    coverKicker: "عرض تنفيذي · تقرير شهري",
    coverPeriodLabel: "فترة الدراسة (عيّنة شهر)",
    weightLines: [
      "وزن السحب: 100% — حصر كامل لمجتمع المستوى",
      `وزن السحب: 40% من حصة العدد الثابت — ${fixedShare(0.4)} صورة`,
      `وزن السحب: 30% من حصة العدد الثابت — ${fixedShare(0.3)} صورة`,
      `وزن السحب: 30% من حصة العدد الثابت — ${fixedShare(0.3)} صورة`,
    ],
    highlightValue: fmtNum(monthlyTarget),
    highlightTitle: "العيّنة المستهدفة الأساسية شهريًا (صورة)",
    highlightNote: "أوزان المستويات الثاني–الرابع تُسحب من هذا العدد (40% + 30% + 30%)؛ المستوى الأول حصر كامل من مجتمعه خارج هذه الحصة.",
    s2Ghost: "02",
    s2Kicker: "القسم الثاني",
    s2Description: "دقة النتائج وتحديد موقع الاشتباه والاشتباهات الفائتة على مستوى الشهر والمنافذ والمستويات.",
    s2FootLead: "النتائج العامة للشهر",
    s3Ghost: "03",
    s3Kicker: "القسم الثالث",
    levelsChartNote: "الأعمدة بنفس أرقام صفحة دقة الرصد العامة — الخطان المتقطعان متوسطا الشهر",
    engineEmpty: "لا توجد صور مستهدفة من محرك المخاطر في عيّنة هذا الشهر.",
    closingLine: "نرحّب بالملاحظات والأسئلة على نتائج الشهر والتقرير.",
  };
}

export async function buildDeck3Slides(
  model: ReportModel,
  monthLabel: string,
  monthlyTarget: number,
  now: Date = new Date(),
  /** Statements for section 3 (built by statements.ts, which imports this file — so they are passed in). */
  statements: Statement[] = [],
): Promise<string> {
  const parts: string[] = [];
  // Statement pages (five per page) plus one blank page to write on.
  const statementPages = Math.ceil(statements.length / STATEMENTS_PER_PAGE) + 1;
  const footText = `${REPORT_NAME} · ${monthLabel}`;
  const org: OrgBlock = {
    logoUrl: ZATCA_LOGO_URL,
    orgName: ORG_NAME,
    lines: [`${LEGAL_SECTOR} - ${ORGANIZATION_PATH[1]}`, DEPARTMENT],
  };
  const t = model.errorAnalysis.totals;
  const overallStats = accuracyOf(t);
  // Rows whose L1/L2 result is neither سليمة nor اشتباه: counted in the sample, never scored.
  const otherL1 = model.rows.filter((r) => r.levelOneOther !== undefined).length;
  const otherL2 = model.rows.filter((r) => r.levelTwoOther !== undefined).length;

  // Completed-only scope (comprehensive report): no population, sample master
  // or monthly target lies behind the rows, so section 1 (population) is
  // omitted, the remaining sections are renumbered from 1, and the cover, KPI
  // and risk-level slides state the completed-sample count instead of
  // population / sample / coverage / target figures. Full scope is unchanged.
  const co = model.scope === "completed-only";
  // A comprehensive report whose workbook carried the risk population: section 1 (population) is shown
  // from those totals, so the deck is structured like the full scope (numbering, contents, KPI band).
  const withPop = co && model.population.fromSummary === true;
  const coNoPop = co && !withPop;
  const ceLabels = getLabels();
  const completedTotal = fmtNum(model.sample.studied);
  const copy = deck3Copy(co, monthlyTarget, completedTotal, withPop);
  const { eyebrowS2, eyebrowS3, kpiTitle } = copy;
  // One description per section, shared by the contents page and the section divider so they can never differ.
  const sectionDesc = {
    s1: withPop
      ? "حجم مجتمع الفترة وتوزيعه على أساس مستويات المخاطر والمنفذ ونتائج المستوى الأول والثاني."
      : "حجم مجتمع الشهر وتوزيعه على المستويات والمنافذ، والأساس الذي سُحبت منه العيّنة.",
    s2: !co
      ? "دقة النتائج على مستوى الشهر وحسب المنفذ ومستوى المخاطر."
      : withPop ? "دقة النتائج على مستوى الفترة وحسب المنفذ ومستوى المخاطر." : "دقة النتائج على مستوى التقرير وحسب المنفذ ومستوى المخاطر.",
    s3: "أهم الإفادات المستخلصة من نتائج التقرير، ومساحة لكتابة إفادات إضافية، والتوافق مع الفرق الأمنية ومحرك المخاطر.",
  };

  // Port lists + pagination, computed up front — slides 8 and 11 (population
  // and accuracy by port) each split into `(يتبع)`-titled continuation pages
  // when a real workspace has more land or sea ports than ROWS_PER_PORT_PAGE
  // fits on one slide (see that constant's doc comment). Hoisted here (rather
  // than left where they used to sit, inline in slides 8/11) because TOTAL —
  // baked into every slide's `meta.total` footer — has to be known before the
  // first slide is built.
  const { land: popLand, sea: popSea } = collectPortStats(model);
  const portAcc = collectPortAccuracy(model);
  // Population by port: one full-width page per port type (land, sea) listing ALL of its ports, never `(يتبع)` chunks.
  const popPortGroups = ([
    { variant: "land", title: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: popLand },
    { variant: "sea", title: "المنافذ البحرية", totalLabel: "إجمالي البحرية", ports: popSea },
  ] as const).filter((g) => g.ports.length > 0);
  const popPages = Math.max(1, popPortGroups.length);
  // Accuracy by port: one full-width page per port type (land, sea) listing ALL of its ports, never `(يتبع)` chunks.
  const accGroups = ([
    { variant: "land", title: "للمنافذ البرية", panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: portAcc.land },
    { variant: "sea", title: "للمنافذ البحرية", panelTitle: "المنافذ البحرية", totalLabel: "إجمالي البحرية", ports: portAcc.sea },
  ] as const).filter((g) => g.ports.length > 0);
  const accPages = Math.max(1, accGroups.length);
  // Standalone follow-up pages after the combined marking/quality ones: one «هل يوجد تحديد» page, then one image-quality page per port type.
  const markQualityPages = 1 + accPages;
  // Level 1/2 accuracy per port, one table page per port type (same grouping rule as accGroups).
  const levelRows = collectLevelAccuracyRows(model);
  const levelGroups = ([
    { variant: "land", panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", rows: levelRows.land },
    { variant: "sea", panelTitle: "المنافذ البحرية", totalLabel: "إجمالي البحرية", rows: levelRows.sea },
  ] as const).filter((g) => g.rows.length > 0);
  const levelPages = Math.max(1, levelGroups.length);
  const levelShown = levelGroups.length > 0 ? levelGroups : [{ variant: "land" as const, panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", rows: levelRows.land }];
  // Section 1 = its divider + the per-level slide + `popPages` port pages.
  // No other-team results and no risk-engine targeting on the sampled images (e.g. the examined-sample workbook
  // carries none): the two agreement slides would be empty charts, so they collapse into one explanatory slide.
  const agreementEmpty =
    model.resultComparison.crossTeamMatrix
      .filter((c) => [c.sourceA, c.sourceB].some((s) => s === "manual" || s === "opposite" || s === "liveMeans"))
      .every((c) => (c.comparable ?? 0) === 0) &&
    !populationScopedRows(model.rows).some((r) => engineVerdictOf(r.targetedByRiskEngine) === "اشتباه");
  // The population-results slide (L1/L2 results across the population) exists only for a summary-backed comprehensive report.
  const popResultsPages = withPop ? 1 : 0;
  const sectionOnePages = 2 + popPages;
  // +1: the per-port accuracy chart is one slide per port type (land, then sea).
  // `+ accPages`: one marking-follow-up page per port type, right after the port-results pages.
  // `- 2 + (levelPages - 2)`: the two per-port bar charts are gone and the level-per-port pages are now tables, one per port type.
  // `- 2` (last): the two marking/quality impact pages were removed (the quality-by-port-type page replaces them).
  // `statementPages`: the section-3 statement pages (generated + one blank) sit between its divider and the agreement page.
  const TOTAL = 23 + statementPages + (popPages - 1) + (accPages - 1) + accPages - 2 + (levelPages - 2) + popResultsPages + markQualityPages - (coNoPop ? sectionOnePages : 0) - (agreementEmpty ? 1 : 0);
  const YITBA = " (يتبع)";

  let nextNum = 1;
  const meta = (sectionKey: string, sectionLabel: string): SlideMeta => ({
    num: nextNum++, total: TOTAL, sectionKey, sectionLabel, footText,
  });

  // 1 — Cover
  parts.push(coverSlide({
    org,
    kicker: copy.coverKicker,
    title: REPORT_NAME,
    periodLabel: copy.coverPeriodLabel,
    periodValue: monthLabel,
    metaRows: [
      // The scope note itself is on the KPI and risk-level slides; it is too long for a cover cell.
      ...(co ? [{ label: withPop ? "العيّنة المفحوصة" : ceLabels.ce_completed_samples, value: completedTotal }] : []),
      {
        label: "تاريخ التقرير",
        value: now.toLocaleDateString("ar-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric" }),
      },
      { label: "الإدارة", value: ORGANIZATION_PATH[1] },
      { label: "القسم", value: DEPARTMENT },
      { label: "التصنيف", value: CLASSIFICATION, end: true },
    ],
    meta: meta("cover", "الغلاف"),
  }));

  // 2 — Contents. Page ranges below section 1 shift with popPages/accPages
  // (slides 8 and 11's own port-table pagination) — derived from the same
  // arithmetic that produces TOTAL above, not re-hardcoded per range.
  const s1End = 7 + popPages + popResultsPages;
  const s2Start = coNoPop ? 6 : s1End + 1;
  const s2End = s2Start + 5 + 2 * accPages + levelPages + markQualityPages;
  const s3Start = s2End + 1;
  const s3End = s3Start + 2 + statementPages - (agreementEmpty ? 1 : 0);
  parts.push(contentsSlide({
    eyebrow: "التقرير التنفيذي",
    title: "محتويات التقرير",
    rows: coNoPop ? [
      { index: 1, title: "المعجم", description: "تعريف مستويات المخاطر والمصطلحات المستخدمة في التقرير.", pages: "ص 03–04" },
      { index: 2, title: kpiTitle, description: "خلاصة أرقام العيّنات المكتملة في صفحة واحدة.", pages: "ص 05" },
      { index: 3, title: eyebrowS2, description: sectionDesc.s2, pages: `ص ${pad2(s2Start)}–${pad2(s2End)}` },
      { index: 4, title: eyebrowS3, description: sectionDesc.s3, pages: `ص ${pad2(s3Start)}–${pad2(s3End)}` },
    ] : [
      { index: 1, title: "المعجم", description: "تعريف مستويات المخاطر والمصطلحات المستخدمة في التقرير.", pages: "ص 03–04" },
      { index: 2, title: withPop ? kpiTitle : "مؤشرات الشهر", description: withPop ? "نتائج الأداء بالأرقام خلال فترة التقرير" : "خلاصة أرقام الشهر في صفحة واحدة.", pages: "ص 05" },
      { index: 3, title: EYEBROW_S1, description: sectionDesc.s1, pages: `ص ${pad2(6)}–${pad2(s1End)}` },
      { index: 4, title: "القسم الثاني — نتائج فحص الجودة", description: sectionDesc.s2, pages: `ص ${pad2(s2Start)}–${pad2(s2End)}` },
      { index: 5, title: EYEBROW_S3, description: sectionDesc.s3, pages: `ص ${pad2(s3Start)}–${pad2(s3End)}` },
    ],
    meta: meta("contents", "المحتويات"),
  }));

  await yieldToMain();

  // 3 — Glossary: key terms (handoff's own five, in its two labeled groups)
  parts.push(glossarySlide({
    eyebrow: "المعجم",
    title: "المصطلحات الرئيسية",
    groups: [
      {
        dotTone: "gold",
        title: "مصطلحات المجتمع والعيّنة",
        terms: [
          { term: "مجتمع الفحص", definition: "صور أشعة الشهر المصنَّفة إلى مستويات المخاطر الأربعة المعتمدة من وكالة تحليل المخاطر." },
          { term: "العيّنة", definition: "الصور المسحوبة للدراسة وفق وزن سحب محدَّد مسبقًا لكل مستوى، مع اختيار عشوائي داخل حصة المستوى الواحد." },
          // Coverage is not reported for the completed-only scope, so its term is not defined there.
          ...(coNoPop ? [] : [{ term: "التغطية الرقابية", definition: "نسبة حجم العيّنة المسحوبة إلى حجم المجتمع؛ مقياس حجم لا يدل على تمثيل العيّنة للمجتمع." }]),
        ],
      },
      {
        dotTone: "red",
        title: "مصطلحات النتائج والجودة",
        terms: [
          { term: "الإجابة", definition: "نتيجة فحص مستوى واحد (الأول أو الثاني) لصورة واحدة؛ لكل صورة إجابتان، وتُحسب أرقام الدقة والاشتباهات على الإجابات لا على الصور." },
          { term: "الاشتباه الخاطئ", definition: "نتيجة أخصائي الوسائل الآلية بأن الإرسالية اشتباه، ورأى أخصائي الجودة أنها سليمة." },
          { term: "الاشتباه الفائت", definition: "نتيجة أخصائي الوسائل الآلية بأن الإرسالية سليمة ورأي أخصائي ضمان الجودة بأنها اشتباه." },
        ],
      },
    ],
    meta: meta("glossary", "المعجم"),
  }));

  // 4 — Glossary: risk levels. Locked wording — copied verbatim from the
  // handoff's own HTML (slide 4). Do not paraphrase or shorten. Only the
  // fixed-count figures are live: they derive from the real monthlyTarget
  // (40/30/30%), NOT the handoff's placeholder 6,250.
  parts.push(levelDefinitionSlide({
    eyebrow: "المعجم",
    title: "مستويات المخاطر",
    levels: [
      {
        title: "المستوى الأول",
        definition: "الصور التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون استهداف من محرك المخاطر.",
        measures: "انفراد الفحص بالاشتباه دون مؤشرات أخرى.",
        weightLine: copy.weightLines[0],
        tone: "gold",
      },
      {
        title: "المستوى الثاني",
        definition: "الصور التي استهدفها محرك المخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.",
        measures: "ما يلتقطه محرك المخاطر ولا يُلتقط من قبل أخصائي الوسائل الآلية.",
        weightLine: copy.weightLines[1],
        tone: "blue",
      },
      {
        title: "المستوى الثالث",
        definition: "الصور التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى.",
        measures: "ما تلتقطه الفرق الأمنية الأخرى ولا يلتقطه الفحص.",
        weightLine: copy.weightLines[2],
        tone: "green-soft",
      },
      {
        title: "المستوى الرابع",
        definition: "الصور التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين.",
        measures: "ما ثبت فواته بضبط أمني أو باكتشاف خارجي.",
        weightLine: copy.weightLines[3],
        tone: "red",
      },
    ],
    highlightValue: copy.highlightValue,
    highlightTitle: copy.highlightTitle,
    highlightNote: copy.highlightNote,
    meta: meta("glossary", "المعجم"),
  }));

  await yieldToMain();

  // 5 — Month KPIs (two 3-cell bands; decision-grain accuracy figures come
  // from errorAnalysis.totals so slides 5/10/15 can never disagree)
  {
    const m = meta("kpis", kpiTitle);
    // Each rate uses the denominator its label names: a missed suspicion is a سليمة result, a false one an اشتباه result.
    const missedShare = pct(t.missedSuspicion, overallStats.cleanResults);
    const falseShare = pct(t.falseSuspicion, overallStats.suspResults);
    const inner = `${contentHead({ eyebrow: copy.kpiEyebrow, title: kpiTitle, large: true })}
${kpiBand(coNoPop ? [
      { label: ceLabels.ce_completed_samples, value: completedTotal, sub: ceLabels.ce_scope_note },
      { label: "الاشتباه الصحيح", value: fmtNum(t.correctSuspicion), valueTone: "green", sub: "نتائج اشتباه أكّدها أخصائي الجودة" },
      { label: "الاشتباه الخاطئ", value: fmtNum(t.falseSuspicion), valueTone: "gold", sub: "نتائج اشتباه رأى أخصائي الجودة أنها سليمة" },
    ] : [
      { label: "مجتمع الفحص", value: fmtNum(model.population.total), sub: "مجتمع الصور الواردة من وكالة تحليل المخاطر" },
      { label: withPop ? "العيّنة المفحوصة" : "العيّنة المسحوبة", value: fmtNum(model.sample.total), sub: withPop ? "صورة مكتملة الفحص في التقرير" : "صورة موزّعة على أخصائيي الجودة" },
      { label: "التغطية الرقابية", value: fmtPct(model.sample.coverage ?? null), valueTone: "gold", sub: "نسبة العينة من المجتمع" },
    ], "top")}
${kpiBand([
      { label: "نسبة التوائم", value: fmtPct(overallStats.overall), valueTone: "green", aside: `من ${fmtNum(t.evaluable)} إجابة مدروسة`, sub: RESULT_ACCURACY_DEFINITION },
      { label: "نسبة تحديد موقع الاشتباه", value: fmtPct(model.imageQuality.markingRate), valueTone: "red", sub: "التزام الفاحصين بتحديد مواقع الاشتباه" },
      { label: "الاشتباهات الفائتة", value: fmtNum(t.missedSuspicion), aside: missedShare === null ? undefined : `${fmtPct(missedShare)} من إجابات السليمة`, sub: MISSED_SUSPICION_DEFINITION,
        extra: { label: "الاشتباهات الخاطئة", value: fmtNum(t.falseSuspicion), valueTone: "gold", aside: falseShare === null ? undefined : `${fmtPct(falseShare)} من إجابات الاشتباه`, sub: FALSE_SUSPICION_DEFINITION } },
    ], "bottom")}`;
    parts.push(slideShell(m, "", inner));
  }

  // 6–8 — Section 1 (population); omitted for the completed-only scope unless the workbook carried its population.
  if (!coNoPop) {
  // 6 — Section 1 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: "01",
    kicker: "القسم الأول",
    title: "مجتمع الفحص والعيّنة",
    description: sectionDesc.s1,
    footItems: [],
    meta: meta("s1", EYEBROW_S1),
  }));

  await yieldToMain();

  // 7 — Population & sample per risk level (stat column + share-bar rows)
  {
    const m = meta("s1", EYEBROW_S1);
    const stages = model.population.byStage;
    const maxPop = Math.max(1, ...stages.map((s) => s.population));
    const rows = stages
      .map((s, i) => {
        const tone = LEVEL_TONES[i % LEVEL_TONES.length];
        const census = s.population > 0 && s.sampleSize >= s.population;
        const width = Math.max(2, (s.population / maxPop) * 100);
        return [
          { html: esc(s.stageLabel) },
          { html: `<div class="v3-pop-bar"><i class="v3-tone-${tone}" style="width:${width.toFixed(1)}%"></i></div>` },
          { html: fmtNum(s.population), cls: "v-muted" },
          { html: fmtNum(s.sampleSize), cls: "v-navy" },
          { html: withPop ? fmtPct(s.coverage) : census ? "حصر كامل" : "عدد ثابت", cls: census ? "v-green" : "v-gold" },
        ] as TableCell[];
      });
    const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: "مجتمع الفحص والعيّنة حسب المستوى", large: true })}
<div class="v3-pop-grid">
  <div class="v3-pop-stats">
    <div class="v3-pop-stat"><span>إجمالي المجتمع</span><b>${fmtNum(model.population.total)}</b></div>
    <div class="v3-pop-stat"><span>إجمالي العيّنة</span><b>${fmtNum(model.sample.total)}</b></div>
    <div class="v3-pop-stat"><span>التغطية الرقابية الكلية</span><b class="v3-ink-gold">${fmtPct(model.sample.coverage ?? null)}</b></div>
  </div>
  <div class="v3-pop-table">
    ${dataTable({ headers: ["المستوى", "", "المجتمع", "العيّنة", withPop ? "التغطية الرقابية" : "أسلوب السحب"], rows, groupStart: 2, firstColWidth: 26, size: "lg" })}
    <p class="v3-pop-note">${withPop ? "التغطية الرقابية = العيّنة المفحوصة ÷ مجتمع المستوى؛ ولا يعكس حجم المستوى أهميته — لكل مستوى هدف مختلف." : "الاختيار عشوائي داخل حصة كل مستوى؛ ولا يعكس حجم الحصة أهمية المستوى — لكل مستوى هدف مختلف."}</p>
  </div>
</div>`;
    parts.push(slideShell(m, "", inner));
  }

  // 7b — L1/L2 results across the population (comprehensive report with a workbook population only).
  // «نتائج أخرى» = a result that is neither سليمة nor اشتباه; it is shown, never folded into either.
  if (withPop && model.population.summary) {
    const s = model.population.summary;
    const m = meta("s1", EYEBROW_S1);
    // One row per level (المستوى) — the same four rows as the previous page — with that level's own L1 and L2 answers.
    // Each cell: the count with its share of the level's images beneath it.
    type Tally = { clean: number; suspicious: number; other: number };
    const zero = (): Tally => ({ clean: 0, suspicious: 0, other: 0 });
    const perStage = new Map<string, { n: number; l1: Tally; l2: Tally }>();
    for (const [raw, lv] of Object.entries(s.byStageLevels)) {
      const key = getStageKey(raw);
      const cur = perStage.get(key) ?? { n: 0, l1: zero(), l2: zero() };
      for (const k of ["clean", "suspicious", "other"] as const) { cur.l1[k] += lv.levelOne[k]; cur.l2[k] += lv.levelTwo[k]; }
      cur.n += lv.levelOne.clean + lv.levelOne.suspicious + lv.levelOne.other;
      perStage.set(key, cur);
    }
    const cell = (n: number, of: number) => `${fmtNum(n)}<br><span class="v3-sub v3-sub-sm">(${fmtPct(pct(n, of))})</span>`;
    const rowFor = (label: string, n: number, l1: Tally, l2: Tally): TableCell[] => [
      { html: label },
      { html: fmtNum(n), cls: "v-navy" },
      { html: cell(l1.clean, n), cls: "v-green" },
      { html: cell(l2.clean, n), cls: "v-green" },
      { html: cell(l1.suspicious, n), cls: "v-red" },
      { html: cell(l2.suspicious, n), cls: "v-red" },
      { html: cell(l1.other, n), cls: "v-gold" },
      { html: cell(l2.other, n), cls: "v-gold" },
    ];
    const stageRows = model.population.byStage.map((st) => {
      const cur = perStage.get(st.stageKey) ?? { n: 0, l1: zero(), l2: zero() };
      return rowFor(st.stageLabel, cur.n, cur.l1, cur.l2);
    });
    const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: "نتائج المستويين في المجتمع", note: `${fmtNum(s.total)} صورة — مجموع أشهر الفترة · إجابات المستوى الأول والثاني لكل مستوى` })}
${dataTable({
      headers: ["المستوى", "الإجمالي", "الأول", "الثاني", "الأول", "الثاني", "الأول", "الثاني"],
      topHeader: [{ label: "", span: 2 }, { label: "سليمة", span: 2, group: true }, { label: "اشتباه", span: 2, group: true }, { label: "أخرى", span: 2, group: true }],
      groupStart: [2, 4, 6],
      rows: stageRows,
      totals: rowFor("الإجمالي", s.total, s.levelOne, s.levelTwo),
      firstColWidth: 26,
    })}`;
    parts.push(slideShell(m, "", inner));
  }

  // 8 — Port distribution (land/sea tinted panels, population (sample) cells)
  // Split into `popPages` `(يتبع)` continuation slides when either column has
  // more ports than ROWS_PER_PORT_PAGE fits (see that constant's doc
  // comment) — a real workspace easily has more ports than the handoff's own
  // 6 sea / 8 land fixture, and an unpaginated table silently overflows past
  // the slide's `overflow:hidden` bottom edge.
  {
    const portRows = (ports: PortPopRow[]): TableCell[][] =>
      ports.map((p) => [
        { html: esc(p.name) },
        { html: popCell(p.total, p.sampleTotal), cls: "v-navy" },
        { html: popCell(p.clean, p.sampleClean), cls: "v-green" },
        { html: popCell(p.suspicious, p.sampleSuspicious), cls: "v-red" },
        ...(withPop ? [{ html: fmtNum(p.other ?? 0), cls: "v-gold" }] : []),
      ]);
    const totalsOf = (label: string, ports: PortPopRow[]): TableCell[] => {
      const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
      return [
        { html: label },
        { html: popCell(sum((p) => p.total), sum((p) => p.sampleTotal)), cls: "v-navy" },
        { html: popCell(sum((p) => p.clean), sum((p) => p.sampleClean)), cls: "v-green" },
        { html: popCell(sum((p) => p.suspicious), sum((p) => p.sampleSuspicious)), cls: "v-red" },
        ...(withPop ? [{ html: fmtNum(sum((p) => p.other ?? 0)), cls: "v-gold" }] : []),
      ];
    };
    const coverageNote = (ports: PortPopRow[]) => {
      const total = ports.reduce((s, p) => s + p.total, 0);
      const sample = ports.reduce((s, p) => s + p.sampleTotal, 0);
      return `التغطية الرقابية ${fmtPct(pct(sample, total))}`;
    };
    const headers = withPop ? ["المنفذ", "الإجمالي", "سليمة", "اشتباه", "نتائج أخرى"] : ["المنفذ", "الإجمالي", "سليمة", "اشتباه"];
    const groups = popPortGroups.length > 0 ? popPortGroups : [{ variant: "land" as const, title: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: popLand }];
    for (const g of groups) {
      const m = meta("s1", EYEBROW_S1);
      const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: `التوزيع على ${g.title}`, note: "المجتمع والرقم بين قوسين العيّنة المسحوبة، مفصولة إلى سليمة واشتباه" })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: g.variant, title: g.title, note: coverageNote(g.ports), body: dataTable({ headers, rows: portRows(g.ports), totals: totalsOf(g.totalLabel, g.ports), topHeader: [{ label: "", span: 2 }, { label: "حسب النتيجة", span: withPop ? 3 : 2, group: true }], groupStart: 2, rowPx: portRowPx(g.ports.length, TOP_HEADER_PX) }) })}
</div>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  }

  await yieldToMain();

  // 9 — Section 2 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: copy.s2Ghost,
    kicker: copy.s2Kicker,
    title: "نتائج فحص الجودة",
    description: sectionDesc.s2,
    footItems: [],
    meta: meta("s2", eyebrowS2),
  }));

  // 10 — Overall detection accuracy: three-tile band + per-risk-level table
  {
    const m = meta("s2", eyebrowS2);
    const stages = orderedStageAccuracy(model);
    const stageRows: TableCell[][] = stages.map((s) => {
      const a = accuracyOf(s.counts);
      return [
        { html: esc(s.label) },
        { html: fmtNum(s.evaluable), cls: "v-muted" },
        { html: fmtPct(a.overall), cls: "v-navy" },
        { html: countRateCell(s.counts.missedSuspicion, pct(s.counts.missedSuspicion, s.evaluable)), cls: "v-red" },
        { html: countRateCell(s.counts.falseSuspicion, pct(s.counts.falseSuspicion, s.evaluable)), cls: "v-gold" },
      ];
    });
    const totals: TableCell[] = [
      { html: "الإجمالي" },
      { html: fmtNum(t.evaluable), cls: "v-navy" },
      { html: fmtPct(overallStats.overall), cls: "v-gold" },
      { html: countRateCell(t.missedSuspicion, pct(t.missedSuspicion, t.evaluable)), cls: "v-red" },
      { html: countRateCell(t.falseSuspicion, pct(t.falseSuspicion, t.evaluable)), cls: "v-gold" },
    ];
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "نسبة التوائم",
    })}
${kpiBand([
      { label: "نسبة التوائم العامة", value: fmtPct(overallStats.overall), sub: RESULT_ACCURACY_DEFINITION },
      { label: "الاشتباهات الفائتة", value: fmtNum(t.missedSuspicion), valueTone: "red", aside: `${fmtPct(pct(t.missedSuspicion, overallStats.cleanResults))} من إجابات السليمة`, sub: MISSED_SUSPICION_DEFINITION },
      { label: "الاشتباهات الخاطئة", value: fmtNum(t.falseSuspicion), valueTone: "gold", aside: `${fmtPct(pct(t.falseSuspicion, overallStats.suspResults))} من إجابات الاشتباه`, sub: FALSE_SUSPICION_DEFINITION },
    ], "solo", true)}
<div class="v3-note" style="margin-top:18px;font-weight:700;color:var(--v3-navy);">الإجابات حسب مستويات المخاطر — النسبة بين قوسين من الإجابات المدروسة في كل مستوى</div>
${dataTable({ headers: ["المستوى", "الإجابات المدروسة", "نسبة التوائم العامة", "الاشتباهات الفائتة", "الاشتباهات الخاطئة"], topHeader: [{ label: "", span: 2 }, { label: "النسبة", span: 1, group: true }, { label: "الأخطاء", span: 2, group: true }], groupStart: [2, 3], rows: stageRows, totals })}`;
    parts.push(slideShell(m, "", inner));
  }


  await yieldToMain();

  // 11 — Accuracy per port (three accuracy columns with bracketed counts).
  // Same `(يتبع)` pagination as slide 8 — portAcc/landTotals/seaTotals are
  // shared with slides 12/17/18 (the dashed "متوسط النوع" is the pooled type
  // accuracy, exactly this slide's own totals row — never an average of
  // averages), and were hoisted above so accPages/TOTAL could be computed
  // before the first slide was built.
  {
    // One full-width page per port type (busiest port first), each listing ALL of its ports.
    const cellsOf = (label: string, c: FourCounts, tone?: string): TableCell[] => {
      const a = accuracyOf(c);
      return [
        { html: label },
        { html: fmtNum(a.evaluable), cls: tone ?? "v-muted" },
        { html: fmtPct(a.overall), cls: "v-navy" },
        { html: fmtPct(a.cleanAcc), cls: "v-green" },
        { html: fmtPct(a.suspAcc), cls: "v-green" },
        { html: fmtPct(pct(c.missedSuspicion, a.cleanResults)), cls: "v-red" },
        { html: fmtPct(pct(c.falseSuspicion, a.suspResults)), cls: "v-gold" },
      ];
    };
    const headers = ["المنفذ", "إجمالي الإجابات", "معدل الاتفاق العام", "دقة السليمة", "دقة الاشتباه", "الاشتباهات الفائتة", "الاشتباهات الخاطئة"];
    const accShown = accGroups.length > 0 ? accGroups : [{ variant: "land" as const, title: "للمنافذ البرية", panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: portAcc.land }];
    for (const g of accShown) {
      const m = meta("s2", eyebrowS2);
      const inner = `${contentHead({
        eyebrow: eyebrowS2,
        title: `نتائج الأداء ${g.title}`,
      })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: g.variant, title: g.panelTitle, body: dataTable({ headers, rows: g.ports.map((p) => cellsOf(esc(p.name), p.counts)), totals: cellsOf(g.totalLabel, sumCounts(g.ports.map((p) => p.counts)), "v-navy"), firstColWidth: 26, topHeader: [{ label: "", span: 1 }, { label: "النتيجة العامة", span: 2 }, { label: "الدقة", span: 2, group: true }, { label: "الأخطاء", span: 2, group: true }], groupStart: [3, 5], rowPx: portRowPx(g.ports.length, FORMULA_NOTE_PX + TOP_HEADER_PX) }) })}
</div>
<p class="v3-note v3-formula-note">${AGREEMENT_FORMULA_NOTE}</p>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  // Level 1 vs Level 2 answers — sits right under the overall result accuracy (section 2) (all ports pooled, five metric rows each)
  const allLevelRows = [...levelRows.land, ...levelRows.sea];
  const l1All = accuracyOf(sumCounts(allLevelRows.map((r) => r.l1.counts)));
  const l2All = accuracyOf(sumCounts(allLevelRows.map((r) => r.l2.counts)));
  {
    const m = meta("s2", eyebrowS2);
    const l1Missed = allLevelRows.reduce((s, r) => s + r.l1.counts.missedSuspicion, 0);
    const l2Missed = allLevelRows.reduce((s, r) => s + r.l2.counts.missedSuspicion, 0);
    const panel = (variant: "land" | "sea", title: string, a: typeof l1All, missed: number, other: number) =>
      tintedPanel({
        variant, title, padLg: true,
        body: `<div class="v3-cmp-rows">
  <div class="v3-cmp-row"><span>الإجابات المدروسة</span><b>${fmtNum(a.evaluable)}</b></div>
  <div class="v3-cmp-row"><span>دقة السليمة</span><b class="v-green">${fmtPct(a.cleanAcc)}</b></div>
  <div class="v3-cmp-row"><span>دقة الاشتباه</span><b class="v-red">${fmtPct(a.suspAcc)}</b></div>
  <div class="v3-cmp-row"><span>الدقة العامة</span><b>${fmtPct(a.overall)}</b></div>
  <div class="v3-cmp-row"><span>اشتباهات فائتة</span><b>${fmtNum(missed)} إجابة</b></div>
  <div class="v3-cmp-row"><span>نتائج أخرى (غير مدروسة)</span><b>${fmtNum(other)}</b></div>
</div>`,
      });
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "دقة إجابات المستوى الأول والثاني",
      note: "لكل صورة إجابتان مستقلّتان — إجابة لكل مستوى",
    })}
<div class="v3-two-col">
  ${panel("land", "المستوى الأول", l1All, l1Missed, otherL1)}
  ${panel("sea", "المستوى الثاني", l2All, l2Missed, otherL2)}
</div>`;
    parts.push(slideShell(m, "", inner));
  }

  // 11a — Level 1 vs Level 2 per port, as tables (one full-width page per port type), right under the
  // port-results pages. Same metrics as those pages, once per level.
  {
    const cellsOf = (label: string, c1: FourCounts, c2: FourCounts, tone?: string): TableCell[] => {
      const part = (c: FourCounts): TableCell[] => {
        const a = accuracyOf(c);
        return [
          { html: fmtNum(a.evaluable), cls: tone ?? "v-muted" },
          { html: fmtPct(a.overall), cls: "v-navy" },
          { html: fmtPct(a.cleanAcc), cls: "v-green" },
          { html: fmtPct(a.suspAcc), cls: "v-green" },
          { html: fmtPct(pct(c.missedSuspicion, a.cleanResults)), cls: "v-red" },
          { html: fmtPct(pct(c.falseSuspicion, a.suspResults)), cls: "v-gold" },
        ];
      };
      return [{ html: label }, ...part(c1), ...part(c2)];
    };
    // Twelve data columns share the slide, so each header must stay on ONE line: short names, same terms as elsewhere.
    const sub = ["الإجابات", "الاتفاق العام", "دقة السليمة", "دقة الاشتباه", "اشتباه فائت", "اشتباه خاطئ"];
    const headers = ["المنفذ", ...sub, ...sub];
    const topHeader = [{ label: "", span: 1 }, { label: "المستوى الأول", span: 6 }, { label: "المستوى الثاني", span: 6, group: true }];
    const answers = (c: FourCounts) => c.correctClean + c.correctSuspicion + c.missedSuspicion + c.falseSuspicion;
    for (const g of levelShown) {
      const m = meta("s2", eyebrowS2);
      const rows = [...g.rows].sort((a, b) =>
        answers(b.l1.counts) + answers(b.l2.counts) - answers(a.l1.counts) - answers(a.l2.counts)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const inner = `${contentHead({
        eyebrow: eyebrowS2,
        title: `دقة المستويين في ${g.panelTitle}`,
      })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: g.variant, title: g.panelTitle, body: dataTable({ headers, topHeader, rows: rows.map((r) => cellsOf(esc(r.name), r.l1.counts, r.l2.counts)), totals: cellsOf(g.totalLabel, sumCounts(rows.map((r) => r.l1.counts)), sumCounts(rows.map((r) => r.l2.counts)), "v-navy"), firstColWidth: 14, compactHeaders: true, groupStart: [2, 7, 8], rowPx: portRowPx(rows.length, 40 + FORMULA_NOTE_PX) }) })}
</div>
<p class="v3-note v3-formula-note">${AGREEMENT_FORMULA_NOTE}</p>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  // 11b0 — Land vs sea summary of the marking / image-quality follow-up (same two-panel look as the level-answers page).
  {
    const m = meta("s2", eyebrowS2);
    const marking = collectPortMarking(model);
    const totalOf = (ports: PortAccuracyRow[]) => sumMarking(ports.map((p) => marking.get(p.name) ?? emptyMarking()));
    const panel = (variant: "land" | "sea", title: string, c: MarkingCounts) =>
      tintedPanel({
        variant, title, padLg: true,
        body: `<div class="v3-cmp-rows">
  <div class="v3-cmp-row"><span>عدد صور الأشعة</span><b>${fmtNum(c.images)}</b></div>
  <div class="v3-cmp-row"><span>صور بتحديد</span><b class="v-green">${fmtNum(c.marked)}</b></div>
  <div class="v3-cmp-row"><span>صور بدون تحديد</span><b class="v-red">${fmtNum(c.unmarked)}</b></div>
  <div class="v3-cmp-row"><span>جودة منخفضة</span><b class="v-red">${fmtNum(c.low)}</b></div>
  <div class="v3-cmp-row"><span>جودة متوسطة</span><b class="v-gold">${fmtNum(c.mid)}</b></div>
  <div class="v3-cmp-row"><span>جودة عالية</span><b class="v-green">${fmtNum(c.high)}</b></div>
</div>`,
      });
    const land = totalOf(portAcc.land);
    const sea = totalOf(portAcc.sea);
    const inner = `${contentHead({ eyebrow: eyebrowS2, title: "متابعة تحديد موقع الاشتباه وجودة الصور" })}
<div class="v3-two-col">
  ${panel("land", "المنافذ البرية", land)}
  ${panel("sea", "المنافذ البحرية", sea)}
</div>`;
    parts.push(slideShell(m, "", inner));
  }

  // 11b — Suspicion-marking follow-up per port, same layout as the port-results pages above
  // (one full-width page per port type, busiest first).
  {
    const marking = collectPortMarking(model);
    const cellsOf = (label: string, c: MarkingCounts, tone?: string): TableCell[] => [
      { html: label },
      { html: fmtNum(c.images), cls: tone ?? "v-muted" },
      { html: fmtNum(c.marked), cls: "v-green" },
      { html: fmtNum(c.unmarked), cls: "v-red" },
      { html: fmtNum(c.low), cls: "v-red" },
      { html: fmtNum(c.mid), cls: "v-gold" },
      { html: fmtNum(c.high), cls: "v-green" },
    ];
    const headers = ["المنفذ", "عدد صور الأشعة", "صور بتحديد", "صور بدون تحديد", "جودة منخفضة", "جودة متوسطة", "جودة عالية"];
    const markShown = accGroups.length > 0 ? accGroups : [{ variant: "land" as const, title: "للمنافذ البرية", panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: portAcc.land }];
    for (const g of markShown) {
      const m = meta("s2", eyebrowS2);
      const rows = g.ports
        .map((p) => ({ name: p.name, c: marking.get(p.name) ?? emptyMarking() }))
        .sort((a, b) => b.c.images - a.c.images || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const total = sumMarking(rows.map((r) => r.c));
      const inner = `${contentHead({
        eyebrow: eyebrowS2,
        title: `متابعة تحديد موقع الاشتباه وجودة الصور ${g.title}`,
      })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: g.variant, title: g.panelTitle, body: dataTable({ headers, rows: rows.map((r) => cellsOf(esc(r.name), r.c)), totals: cellsOf(g.totalLabel, total, "v-navy"), firstColWidth: 26, topHeader: [{ label: "", span: 2 }, { label: "التحديد", span: 2, group: true }, { label: "جودة الصورة", span: 3, group: true }], groupStart: [2, 4], rowPx: portRowPx(rows.length, FORMULA_NOTE_PX + TOP_HEADER_PX) }) })}
</div>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  // 11b+ — «هل يوجد تحديد»: its own page. It applies only to suspicion images (L1 or L2 = اشتباه), so the base is those images alone.
  {
    const m = meta("s2", eyebrowS2);
    const marking = collectPortMarkingOnly(model);
    const cellsOf = (label: string, c: MarkingOnlyCounts, tone?: string): TableCell[] => [
      { html: label },
      { html: fmtNum(c.images), cls: tone ?? "v-muted" },
      { html: countRateCell(c.marked, pct(c.marked, c.images)), cls: "v-green" },
      { html: countRateCell(c.unmarked, pct(c.unmarked, c.images)), cls: "v-red" },
    ];
    const headers = ["المنفذ", "صور الاشتباه المدروسة", "صور بتحديد", "صور بدون تحديد"];
    const sumOf = (list: MarkingOnlyCounts[]): MarkingOnlyCounts =>
      list.reduce((a, c) => ({ images: a.images + c.images, marked: a.marked + c.marked, unmarked: a.unmarked + c.unmarked }), { images: 0, marked: 0, unmarked: 0 });
    const groups = accGroups.length > 0 ? accGroups : [{ variant: "land" as const, panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: portAcc.land }];
    const rows = groups
      .flatMap((g) => g.ports.map((p) => ({ name: p.name, c: marking.get(p.name) ?? { images: 0, marked: 0, unmarked: 0 } })))
      .sort((a, b) => b.c.images - a.c.images || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const total = sumOf(rows.map((r) => r.c));
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "هل يوجد تحديد؟",
      note: "يُسأل عن التحديد في الصور التي فيها اشتباه عند المستوى الأول أو الثاني فقط",
    })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: "land", title: "جميع المنافذ", body: dataTable({ headers, rows: rows.map((r) => cellsOf(esc(r.name), r.c)), totals: cellsOf("الإجمالي", total, "v-navy"), firstColWidth: 28, rowPx: portRowPx(rows.length, 0) }) })}
</div>`;
    parts.push(slideShell(m, "", inner));
  }

  // 11b++ — Image quality of the evaluated images, one page per port type. Quality applies to every evaluated image.
  {
    const quality = collectPortQuality(model);
    const cellsOf = (label: string, c: QualityCounts, tone?: string): TableCell[] => [
      { html: label },
      { html: fmtNum(c.images), cls: tone ?? "v-muted" },
      { html: countRateCell(c.low, pct(c.low, c.images)), cls: "v-red" },
      { html: countRateCell(c.mid, pct(c.mid, c.images)), cls: "v-gold" },
      { html: countRateCell(c.high, pct(c.high, c.images)), cls: "v-green" },
    ];
    const headers = ["المنفذ", "الصور المقيّمة", "جودة منخفضة", "جودة متوسطة", "جودة عالية"];
    const qualityShown = accGroups.length > 0 ? accGroups : [{ variant: "land" as const, title: "للمنافذ البرية", panelTitle: "المنافذ البرية", totalLabel: "إجمالي البرية", ports: portAcc.land }];
    for (const g of qualityShown) {
      const m = meta("s2", eyebrowS2);
      const rows = g.ports
        .map((p) => ({ name: p.name, c: quality.get(p.name) ?? emptyQuality() }))
        .sort((a, b) => b.c.images - a.c.images || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const total = sumQuality(rows.map((r) => r.c));
      const inner = `${contentHead({ eyebrow: eyebrowS2, title: `جودة الصور المقيّمة ${g.title}` })}
<div class="v3-two-col" style="grid-template-columns:1fr">
  ${tintedPanel({ variant: g.variant, title: g.panelTitle, body: dataTable({ headers, rows: rows.map((r) => cellsOf(esc(r.name), r.c)), totals: cellsOf(g.totalLabel, total, "v-navy"), firstColWidth: 26, rowPx: portRowPx(rows.length, 0) }) })}
</div>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  // 11c — Agreement and the two error counts by image quality (low → high), on ANSWERS from the shared decision fold,
  // all on ONE page: quality levels as columns, rows for all ports / land / sea.
  {
    const m = meta("s2", eyebrowS2);
    const records = buildDecisionRecords(model.rows, "quality");
    const kindOf = (r: { portType: string | null }) => ((r.portType ?? "").includes("بحري") ? "sea" : "land");
    const byQuality = aggregateDecisions(records, "decision", (r) => `all|${r.imageQuality}`);
    const byKindQuality = aggregateDecisions(records, "decision", (r) => `${kindOf(r)}|${r.imageQuality}`);
    const levels = [
      { key: "منخفض", label: "جودة منخفضة", tone: "red" },
      { key: "متوسط", label: "جودة متوسطة", tone: "gold" },
      { key: "عالي", label: "جودة عالية", tone: "green" },
    ] as const;
    const groupRows: Array<{ label: string; variant: "all" | "land" | "sea" }> = [
      { label: "جميع المنافذ", variant: "all" },
      ...accGroups.map((g) => ({ label: g.panelTitle, variant: g.variant })),
    ];
    const rows: QualityRow[] = groupRows.map((g) => ({
      label: g.label,
      variant: g.variant,
      cells: levels.map((level): QualityCell => {
        const c = (g.variant === "all" ? byQuality : byKindQuality).get(`${g.variant}|${level.key}`);
        const four: FourCounts = c ?? { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
        const a = accuracyOf(four);
        return {
          tone: level.tone,
          value: fmtPct(a.overall),
          caption: `معدل الاتفاق العام · من ${fmtNum(a.evaluable)} إجابة`,
          fill: a.overall,
          stats: [
            { label: "الاشتباهات الفائتة", value: fmtNum(four.missedSuspicion), share: `${fmtPct(pct(four.missedSuspicion, a.evaluable))} من الإجابات` },
            { label: "الاشتباهات الخاطئة", value: fmtNum(four.falseSuspicion), share: `${fmtPct(pct(four.falseSuspicion, a.evaluable))} من الإجابات` },
          ],
        };
      }),
    }));
    const inner = `${contentHead({ eyebrow: eyebrowS2, title: "نسبة التوائم حسب جودة الصورة" })}
${qualityMatrix(levels.map((l) => ({ label: l.label, tone: l.tone })), rows)}`;
    parts.push(slideShell(m, "", inner));
  }

  // 13 — Clean/suspicion accuracy per risk level (four mini plots)
  {
    const m = meta("s2", eyebrowS2);
    const stages = orderedStageAccuracy(model);
    const levelAxis = fitAxis(
      stages.flatMap((s) => {
        const a = accuracyOf(s.counts);
        return [a.cleanAcc, a.suspAcc];
      }),
      60,
      100,
    );
    const cols = stages
      .map((s) => {
        const a = accuracyOf(s.counts);
        const chart = barChart({
          bars: [
            { label: "", value: a.cleanAcc, tone: "green" },
            { label: "", value: a.suspAcc, tone: "red" },
          ],
          ...levelAxis, plotHeight: 440, barMaxWidth: 88, gap: 22, pad: 26, hideCats: true,
          references: [
            ...(overallStats.cleanAcc === null ? [] : [{ value: overallStats.cleanAcc, tone: "avg-green" as const }]),
            ...(overallStats.suspAcc === null ? [] : [{ value: overallStats.suspAcc, tone: "avg-red" as const }]),
          ],
        });
        return `<div class="v3-chart-col">${chart}<div class="v3-level-cap"><b>${esc(s.label)}</b><span>الدقة العامة ${fmtPct(a.overall)} · ${fmtNum(s.evaluable)} إجابة</span></div></div>`;
      })
      .join("\n");
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "الدقتان حسب مستويات المخاطر",
    })}
<div class="v3-levels-chart-grid">${cols}</div>
${legendRow([
      { swatch: "green", text: "دقة السليمة" },
      { swatch: "red", text: "دقة الاشتباه" },
      { dash: "avg-green", text: `متوسط السليمة ${fmtPct(overallStats.cleanAcc)}` },
      { dash: "avg-red", text: `متوسط الاشتباه ${fmtPct(overallStats.suspAcc)}` },
    ], scaleCaption(levelAxis))}`;
    parts.push(slideShell(m, "", inner));
  }

  await yieldToMain();

  // 14 — Section 3 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: copy.s3Ghost,
    kicker: copy.s3Kicker,
    title: "الإفادات",
    description: sectionDesc.s3,
    footItems: [],
    meta: meta("s3", eyebrowS3),
  }));

  // Statements drafted from the results (fixed rules), five per page, each editable in the viewer; then one page of
  // blank lines to write further statements. Empty text leaves are skipped by the editor, so the blanks carry a prompt.
  for (let p = 0; p < statementPages; p++) {
    const chunk = statements.slice(p * STATEMENTS_PER_PAGE, (p + 1) * STATEMENTS_PER_PAGE);
    const isBlank = p === statementPages - 1;
    const items = isBlank
      ? Array.from({ length: STATEMENTS_PER_PAGE }, () => ({ text: STATEMENT_PLACEHOLDER, tag: "", tone: "none" as const }))
      : chunk.map((s) => ({ text: s.text, tag: s.priority, tone: s.priority === "عالية" ? "red" as const : s.priority === "متوسطة" ? "gold" as const : "none" as const }));
    parts.push(slideShell(meta("s3", eyebrowS3), "", `${contentHead({
      eyebrow: eyebrowS3,
      title: isBlank ? "إفادات إضافية" : "أهم الإفادات من نتائج التقرير" + (p > 0 ? YITBA : ""),
      note: isBlank ? "اضغط «تعديل النص» أعلى الصفحة ثم اكتب الإفادة في أي سطر." : "مستخلصة من أرقام التقرير بقواعد ثابتة، ويمكن تعديل أي نص منها.",
    })}
${statementList(items, isBlank ? 0 : p * STATEMENTS_PER_PAGE)}`));
  }


  await yieldToMain();

  // 19 — Agreement with security teams (crossTeamMatrix: L1/L2 vs each team)
  // + the risk-engine band (an honest presentation fold over the rows'
  // engine verdict vs the screening result, reviewer verdict on the splits).
  if (agreementEmpty) {
    const m = meta("s3", eyebrowS3);
    parts.push(slideShell(m, "", `${contentHead({
      eyebrow: eyebrowS3,
      title: "التوافق مع الفرق الأمنية ومحرك المخاطر",
      note: "لا توجد بيانات لهذا التحليل في الملف",
    })}
<p class="v3-note" style="margin-top:40px;font-size:30px;line-height:1.9">لا تتضمن أوراق العيّنة نتائج المعاين أو التفتيش المعاكس أو الوسائل الحية، ولا استهداف محرك المخاطر لصور العيّنة؛ لذلك لا يمكن حساب نسب التوافق مع هذه الجهات دون اختلاق أرقام. تظهر هذه الصفحة تلقائيًا عند توفّر تلك البيانات في الملف.</p>`));
  } else {
    const m = meta("s3", eyebrowS3);
    const matrix = model.resultComparison.crossTeamMatrix;
    const cellOf = (a: string, b: string) =>
      matrix.find((c) => (c.sourceA === a && c.sourceB === b) || (c.sourceA === b && c.sourceB === a));
    const TEAMS = [
      { src: "liveMeans", label: "الوسائل الحية" },
      { src: "manual", label: "المعاين" },
      { src: "opposite", label: "التفتيش المعاكس" },
    ] as const;
    const teams = TEAMS.map((team) => {
      const l1 = cellOf("levelOne", team.src);
      const l2 = cellOf("levelTwo", team.src);
      return {
        label: team.label,
        images: Math.max(l1?.comparable ?? 0, l2?.comparable ?? 0),
        l1Comparable: l1?.comparable ?? 0, l1Agree: l1?.agree ?? 0, l1Rate: l1?.agreementRate ?? null,
        l2Comparable: l2?.comparable ?? 0, l2Agree: l2?.agree ?? 0, l2Rate: l2?.agreementRate ?? null,
      };
    });
    const sum = (f: (x: (typeof teams)[number]) => number) => teams.reduce((s, x) => s + f(x), 0);
    const imagesTotal = sum((x) => x.images);
    const l1Pooled = pct(sum((x) => x.l1Agree), sum((x) => x.l1Comparable));
    const l2Pooled = pct(sum((x) => x.l2Agree), sum((x) => x.l2Comparable));
    const pooled = pct(sum((x) => x.l1Agree + x.l2Agree), sum((x) => x.l1Comparable + x.l2Comparable));
    const teamAxis = fitAxis(teams.flatMap((t) => [t.l1Rate, t.l2Rate]), 50, 85);
    const teamCharts = teams
      .map((team) => {
        const chart = barChart({
          bars: [
            { label: "", value: team.l1Rate, tone: "gold" },
            { label: "", value: team.l2Rate, tone: "blue" },
          ],
          ...teamAxis, barMaxWidth: 78, gap: 14, pad: 18, hideCats: true,
          references: pooled === null ? [] : [{ value: pooled, tone: "gold-dark" }],
        });
        return `<div class="v3-team">${chart}<div class="v3-cat">${team.label}</div></div>`;
      })
      .join("");
    const teamRows: TableCell[][] = teams.map((team) => {
      const total = pct(team.l1Agree + team.l2Agree, team.l1Comparable + team.l2Comparable);
      return [
        { html: team.label },
        { html: fmtNum(team.images), cls: "v-muted" },
        { html: rateCell(team.l1Rate, team.l1Agree), cls: "v-gold" },
        { html: rateCell(team.l2Rate, team.l2Agree), cls: "v-blue" },
        { html: fmtPct(total), cls: "v-navy" },
      ];
    });
    const teamTotals: TableCell[] = [
      { html: "الإجمالي" },
      { html: fmtNum(imagesTotal), cls: "v-navy" },
      { html: rateCell(l1Pooled, sum((x) => x.l1Agree)), cls: "v-gold" },
      { html: rateCell(l2Pooled, sum((x) => x.l2Agree)), cls: "v-blue" },
      { html: fmtPct(pooled), cls: "v-gold" },
    ];

    // Engine band: among engine-TARGETED images, did the screening result
    // agree (also اشتباه)? Where it disagreed, whose side did the quality
    // reviewer take? engineVerdictOf owns the vocabulary mapping.
    let targeted = 0;
    let engineAgree = 0;
    let upheldEngine = 0;
    // A2: the population fold — never rows rebuilt from the sample snapshot (matches deck2).
    for (const row of populationScopedRows(model.rows)) {
      if (engineVerdictOf(row.targetedByRiskEngine) !== "اشتباه") continue;
      targeted += 1;
      if (row.imageResult === "اشتباه") engineAgree += 1;
      else if (row.expertResult === "اشتباه") upheldEngine += 1;
    }
    const engineDisagree = targeted - engineAgree;
    const engineRest = engineDisagree - upheldEngine;
    const seg = (n: number, tone: string, label: string) =>
      n <= 0 || targeted === 0
        ? ""
        : `<div class="v3-engine-seg v3-tone-${tone}" style="width:${((n / targeted) * 100).toFixed(2)}%"><span>${label}</span></div>`;
    const engineBand =
      targeted === 0
        ? `<div class="v3-engine-band"><div class="v3-engine-head"><b>التوافق مع محرك المخاطر</b><span>${copy.engineEmpty}</span></div></div>`
        : `<div class="v3-engine-band">
  <div class="v3-engine-head"><b>التوافق مع محرك المخاطر</b><span>${fmtNum(targeted)} صورة استهدفها المحرك — توافق ${fmtPct(pct(engineAgree, targeted))}</span></div>
  <div class="v3-engine-stats">
    <div class="v3-engine-stat"><b>${fmtPct(pct(engineAgree, targeted))}</b><span>اتفق الفحص مع المحرك (${fmtNum(engineAgree)} صورة)</span></div>
    <div class="v3-engine-stat"><b class="v-red">${fmtNum(engineDisagree)}</b><span>صورة خالف فيها الفحص استهداف المحرك</span></div>
    <div class="v3-engine-stat"><b class="v-gold">${fmtPct(pct(upheldEngine, engineDisagree))}</b><span>من صور الاختلاف أيّدت الجودة المحرك (${fmtNum(upheldEngine)})</span></div>
  </div>
  <div class="v3-engine-bar">${seg(engineAgree, "navy", `اتفاق ${fmtNum(engineAgree)}`)}${seg(upheldEngine, "red", fmtNum(upheldEngine))}${seg(engineRest, "neutral", fmtNum(engineRest))}</div>
</div>`;

    const agreeTitle = "التوافق مع الفرق الأمنية ومحرك المخاطر";
    const inner = `${contentHead({
      eyebrow: eyebrowS3,
      title: agreeTitle,
      note: `${fmtNum(imagesTotal)} صور مشتركة — توافق المستوى الأول ${fmtPct(l1Pooled)} · الثاني ${fmtPct(l2Pooled)}`,
    })}
<div class="v3-agree-grid">
  <div class="v3-agree-col">
    ${chartTitleRow({ title: "التوافق لكل مستوى", asideDash: { tone: "gold", text: `نسبة توافق الفرق الأمنية ${fmtPct(pooled)}` } })}
    <div class="v3-team-charts">${teamCharts}</div>
    ${legendRow([
      { swatch: "gold", text: "المستوى الأول" },
      { swatch: "blue", text: "المستوى الثاني" },
    ], scaleCaption(teamAxis))}
  </div>
  <div class="v3-agree-col">
    ${chartTitleRow({ title: "التفصيل — الأرقام بين قوسين عدد الصور المتوافقة" })}
    ${dataTable({ headers: ["الفريق", "الصور", "المستوى الأول", "المستوى الثاني", "الكلي"], rows: teamRows, totals: teamTotals, firstColWidth: 26, topHeader: [{ label: "", span: 2 }, { label: "التوافق", span: 3, group: true }], groupStart: 2 })}
  </div>
</div>`;
    parts.push(slideShell(m, "", inner));
    // Page 2 (يتبع): the risk-engine band on its own slide so neither page overflows.
    const m2 = meta("s3", eyebrowS3);
    const inner2 = `${contentHead({
      eyebrow: eyebrowS3,
      title: agreeTitle + YITBA,
      note: `${fmtNum(imagesTotal)} صور مشتركة — توافق المستوى الأول ${fmtPct(l1Pooled)} · الثاني ${fmtPct(l2Pooled)}`,
    })}
${engineBand}`;
    parts.push(slideShell(m2, "", inner2));
  }

  await yieldToMain();

  // 21 — Closing
  parts.push(closingSlide({
    org: { ...org, lines: [ORGANIZATION_PATH[1]] },
    kicker: "ختام العرض",
    title: "شكراً",
    closingLine: copy.closingLine,
    metaRows: [
      { label: "فترة التقرير", value: monthLabel },
      { label: "القسم", value: DEPARTMENT },
      { label: "التصنيف", value: CLASSIFICATION, end: true },
    ],
    meta: meta("closing", "ختام العرض"),
  }));

  return parts.join("\n");
}
