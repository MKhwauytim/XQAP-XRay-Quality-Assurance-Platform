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
import { computeMarkingImpact } from "../deck2/section3/markingImpact";
import { computeQualityImpactStrata, accuracyGradient } from "../deck2/section3/qualityImpact";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../../branding/organization";
import {
  coverSlide, closingSlide, contentsSlide, glossarySlide, levelDefinitionSlide,
  kpiBand, sectionDivider, tintedPanel, dataTable, matrixGrid, chartTitleRow,
  legendRow, impactColumn, slideShell, contentHead, pad2,
  type OrgBlock, type SlideMeta, type TableCell,
} from "./slideKit";
import { barChart, fitAxis, groupedBarChart, scaleCaption, type ChartBar } from "./chartKit";

/**
 * Max port rows one `.v3-panel` table page can hold without spilling past the
 * fixed 1920×1080 slide (measured live in deck-preview.html against a
 * synthetic 15-land-port fixture, 2026-09-03 — the handoff's own port count
 * fit inside one page and never surfaced this): available row budget = slide
 * content height (1080 − 84 top / 56 bottom padding = 940) − `.v3-head`
 * (122 + 30 margin) − `.v3-page-foot` (60) = 728 for `.v3-two-col`; inside
 * each panel, padding (24×2) + `.v3-panel-head` (49 + 14 margin) + `thead`
 * (63) + `tfoot` (67) = 241 fixed overhead, leaving 487 for body rows at the
 * table's own 58px row height → floor(487/58) = 8. A real workspace with
 * more land or sea ports than this must split into continuation slides
 * (`(يتبع)` in the title) rather than silently overflow the slide's
 * `overflow:hidden` bottom edge.
 */
const ROWS_PER_PORT_PAGE = 8;

/** How many `(يتبع)`-chunked pages a land/sea pair of port tables needs. */
function portPageCount(landCount: number, seaCount: number): number {
  return Math.max(1, Math.ceil(Math.max(landCount, seaCount) / ROWS_PER_PORT_PAGE));
}

function chunkAt<T>(rows: T[], page: number): T[] {
  return rows.slice(page * ROWS_PER_PORT_PAGE, (page + 1) * ROWS_PER_PORT_PAGE);
}
const REPORT_NAME = "تقرير ضمان جودة فحص الأشعة";
const ORG_NAME = "هيئة الزكاة والضريبة والجمارك";
const CLASSIFICATION = "سري";
/** Deck-local cover wording (the shared ORGANIZATION_PATH is left as-is: deck2 and other surfaces still read it). */
const LEGAL_SECTOR = `قطاع ${ORGANIZATION_PATH[0]}`;
const DEPARTMENT = "إدارة الرقابة على الامتثال للمنافذ الجمركية";

const EYEBROW_S1 = "القسم الأول — مجتمع الفحص";
const EYEBROW_S2 = "القسم الثاني — نتائج فحص الجودة";
const EYEBROW_S3 = "القسم الثالث — التحاليل المتقدمة";

// ── Presentation-layer rate helpers ─────────────────────────────────────────

function pct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

/** "98.2% (12,021)" — a rate with its bracketed denominator, muted. */
function rateCell(rate: number | null, count: number): string {
  return `${fmtPct(rate)}<span class="v3-sub"> (${fmtNum(count)})</span>`;
}

/** "21,480 (1,031)" — population figure with its bracketed sample figure. */
function popCell(population: number, sample: number, stacked = false): string {
  // Stacked (5-column port tables of a summary-backed report): the sample figure sits under the population one.
  if (stacked) return `${fmtNum(population)}<br><span class="v3-sub v3-sub-sm">(${fmtNum(sample)})</span>`;
  return `${fmtNum(population)}<span class="v3-sub"> (${fmtNum(sample)})</span>`;
}

type FourCounts = { correctClean: number; correctSuspicion: number; missedSuspicion: number; falseSuspicion: number };

function accuracyOf(c: FourCounts): {
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

function sumCounts(all: FourCounts[]): FourCounts {
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

type PortAccuracyRow = { name: string; sea: boolean; counts: FourCounts; evaluable: number };

/** model.portAccuracy (the shared decision-combined per-port fold) split into
 *  land/sea using the rows' own portType — mirrors collectPortStats's rule. */
function collectPortAccuracy(model: ReportModel): { land: PortAccuracyRow[]; sea: PortAccuracyRow[] } {
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

/** model.stageAccuracy ordered by the population profile's stage order, so
 *  the accuracy table lists levels 1→4 the way every other slide does. */
function orderedStageAccuracy(model: ReportModel): Array<{ label: string; counts: FourCounts; evaluable: number }> {
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
      eyebrowS3: withPopulation ? EYEBROW_S3 : "القسم الثاني — التحاليل المتقدمة",
      kpiTitle: "المؤشرات الرئيسية",
      kpiEyebrow: "خلاصة التقرير",
      coverKicker: "عرض تنفيذي · تقرير شامل",
      coverPeriodLabel: "فترة الدراسة",
      // No draw weights or monthly target behind completed-only rows.
      weightLines: ["", "", "", ""],
      highlightValue: completedTotal,
      highlightTitle: withPopulation ? "العيّنة المفحوصة" : ceLabels.ce_completed_samples,
      highlightNote: withPopulation ? "العيّنة المفحوصة في الفترة؛ المجتمع مجموع أشهرها من أوراق الملف." : ceLabels.ce_scope_note,
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
): Promise<string> {
  const parts: string[] = [];
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
  const otherResultsNote = otherL1 + otherL2 > 0 ? ` — نتائج أخرى غير مُقيَّمة: المستوى الأول ${fmtNum(otherL1)} · الثاني ${fmtNum(otherL2)}` : "";

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

  // Port lists + pagination, computed up front — slides 8 and 11 (population
  // and accuracy by port) each split into `(يتبع)`-titled continuation pages
  // when a real workspace has more land or sea ports than ROWS_PER_PORT_PAGE
  // fits on one slide (see that constant's doc comment). Hoisted here (rather
  // than left where they used to sit, inline in slides 8/11) because TOTAL —
  // baked into every slide's `meta.total` footer — has to be known before the
  // first slide is built.
  const { land: popLand, sea: popSea } = collectPortStats(model);
  const portAcc = collectPortAccuracy(model);
  const landTotals = accuracyOf(sumCounts(portAcc.land.map((p) => p.counts)));
  const seaTotals = accuracyOf(sumCounts(portAcc.sea.map((p) => p.counts)));
  const popPages = portPageCount(popLand.length, popSea.length);
  const accPages = portPageCount(portAcc.land.length, portAcc.sea.length);
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
  const TOTAL = 24 + (popPages - 1) + (accPages - 1) + popResultsPages - (coNoPop ? sectionOnePages : 0) - (agreementEmpty ? 1 : 0);
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
  const s2End = s2Start + 4 + accPages;
  const s3Start = s2End + 1;
  const s3End = s3Start + 8 - (agreementEmpty ? 1 : 0);
  parts.push(contentsSlide({
    eyebrow: "التقرير التنفيذي",
    title: "محتويات التقرير",
    rows: coNoPop ? [
      { index: 1, title: "المعجم", description: "تعريف مستويات المخاطر الأربعة والمصطلحات المستخدمة في التقرير.", pages: "ص 03–04" },
      { index: 2, title: kpiTitle, description: "خلاصة أرقام العيّنات المكتملة في صفحة واحدة.", pages: "ص 05" },
      { index: 3, title: eyebrowS2, description: "دقة النتائج على مستوى التقرير وحسب المنفذ ومستوى المخاطر.", pages: `ص ${pad2(s2Start)}–${pad2(s2End)}` },
      { index: 4, title: eyebrowS3, description: "مصفوفة النتائج، دقة المستويين، والتوافق مع الفرق الأمنية ومحرك المخاطر، وأثر التحديد والجودة.", pages: `ص ${pad2(s3Start)}–${pad2(s3End)}` },
    ] : [
      { index: 1, title: "المعجم", description: "تعريف مستويات المخاطر الأربعة والمصطلحات المستخدمة في التقرير.", pages: "ص 03–04" },
      { index: 2, title: withPop ? kpiTitle : "مؤشرات الشهر", description: withPop ? "خلاصة أرقام الفترة في صفحة واحدة." : "خلاصة أرقام الشهر في صفحة واحدة.", pages: "ص 05" },
      { index: 3, title: "القسم الأول — مجتمع الفحص", description: withPop ? "حجم مجتمع الفترة وتوزيعه على المستويات والمنافذ ونتائج المستويين." : "حجم مجتمع الشهر وتوزيعه على المستويات والمنافذ، والأساس الذي سُحبت منه العيّنة.", pages: `ص ${pad2(6)}–${pad2(s1End)}` },
      { index: 4, title: "القسم الثاني — نتائج فحص الجودة", description: withPop ? "دقة النتائج على مستوى الفترة وحسب المنفذ ومستوى المخاطر." : "دقة النتائج على مستوى الشهر وحسب المنفذ ومستوى المخاطر.", pages: `ص ${pad2(s2Start)}–${pad2(s2End)}` },
      { index: 5, title: "القسم الثالث — التحاليل المتقدمة", description: "مصفوفة النتائج، دقة المستويين، والتوافق مع الفرق الأمنية ومحرك المخاطر، وأثر التحديد والجودة.", pages: `ص ${pad2(s3Start)}–${pad2(s3End)}` },
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
          ...(coNoPop ? [] : [{ term: "التغطية", definition: "نسبة حجم العيّنة المسحوبة إلى حجم المجتمع؛ مقياس حجم لا يدل على تمثيل العيّنة للمجتمع." }]),
        ],
      },
      {
        dotTone: "red",
        title: "مصطلحات النتائج والجودة",
        terms: [
          { term: "الاشتباه الخاطئ", definition: "نتيجة أخصائي الوسائل الآلية بأن الإرسالية اشتباه، ورأى أخصائي الجودة أنها سليمة." },
          { term: "الاشتباه الفائت", definition: "نتيجة مستوى واحد رأى الصورة سليمة ورأى أخصائي الجودة أنها اشتباه؛ ولكل صورة نتيجتان يُقيَّمان مستقلّين." },
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
    const missedShare = pct(t.missedSuspicion, t.evaluable);
    const inner = `${contentHead({ eyebrow: copy.kpiEyebrow, title: kpiTitle, large: true })}
${kpiBand(coNoPop ? [
      { label: ceLabels.ce_completed_samples, value: completedTotal, sub: ceLabels.ce_scope_note },
      { label: "الاشتباه الصحيح", value: fmtNum(t.correctSuspicion), valueTone: "green", sub: "نتائج اشتباه أكّدها أخصائي الجودة" },
      { label: "الاشتباه الخاطئ", value: fmtNum(t.falseSuspicion), valueTone: "gold", sub: "نتائج اشتباه رأى أخصائي الجودة أنها سليمة" },
    ] : [
      { label: "مجتمع الفحص", value: fmtNum(model.population.total), sub: "مجتمع الصور الواردة من وكالة تحليل المخاطر" },
      { label: withPop ? "العيّنة المفحوصة" : "العيّنة المسحوبة", value: fmtNum(model.sample.total), sub: withPop ? "صورة مكتملة الفحص في التقرير" : "صورة موزّعة على أخصائيي الجودة" },
      { label: "التغطية", value: fmtPct(model.sample.coverage ?? null), valueTone: "gold", sub: "نسبة العينة من المجتمع" },
    ], "top")}
${kpiBand([
      { label: "دقة النتيجة", value: fmtPct(overallStats.overall), valueTone: "green", sub: `من ${fmtNum(t.evaluable)} نتيجة مُقيَّمة` },
      { label: "نسبة تحديد موقع الاشتباه", value: fmtPct(model.imageQuality.markingRate), valueTone: "red", sub: "التزام الفاحصين بتحديد مواضع الاشتباه" },
      { label: "الاشتباهات الفائتة", value: fmtNum(t.missedSuspicion), aside: missedShare === null ? undefined : `${fmtPct(missedShare)} من النتائج`, sub: "صور رأى فيها خبير جودة الأشعة كونها اشتباه لم يرصد من الوسائل الآلية" },
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
    title: "مجتمع الفحص",
    description: withPop ? "حجم مجتمع الفترة (مجموع الأشهر) وتوزيعه على مستويات المخاطر والمنافذ ونتائج المستويين، والأساس الذي سُحبت منه العيّنة." : "حجم مجتمع الشهر وتوزيعه على مستويات المخاطر والمنافذ، والأساس الذي سُحبت منه العيّنة.",
    footItems: withPop ? ["مجتمع الفحص والعيّنة حسب المستوى", "نتائج المستوى الأول والثاني في المجتمع", "التوزيع على المنافذ البرية والبحرية"] : ["مجتمع الفحص والعيّنة حسب المستوى", "التوزيع على المنافذ البرية والبحرية"],
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
        return `<div class="v3-pop-row">
  <span class="name">${esc(s.stageLabel)}</span>
  <div class="v3-pop-bar"><i class="v3-tone-${tone}" style="width:${width.toFixed(1)}%"></i></div>
  <span class="num">${fmtNum(s.population)}</span>
  <span class="num strong">${fmtNum(s.sampleSize)}</span>
  <span class="method${census ? " census" : ""}">${withPop ? `تغطية ${fmtPct(s.coverage)}` : census ? "حصر كامل" : "عدد ثابت"}</span>
</div>`;
      })
      .join("\n");
    const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: "مجتمع الفحص والعيّنة حسب المستوى", large: true })}
<div class="v3-pop-grid">
  <div class="v3-pop-stats">
    <div class="v3-pop-stat"><span>إجمالي المجتمع</span><b>${fmtNum(model.population.total)}</b></div>
    <div class="v3-pop-stat"><span>إجمالي العيّنة</span><b>${fmtNum(model.sample.total)}</b></div>
    <div class="v3-pop-stat"><span>التغطية الكلية</span><b class="v3-ink-gold">${fmtPct(model.sample.coverage ?? null)}</b></div>${withPop ? `
    <div class="v3-pop-stat"><span>مجتمع بنتائج أخرى</span><b>${fmtNum(model.population.other ?? 0)}</b></div>` : ""}
  </div>
  <div class="v3-pop-table">
    <div class="v3-pop-hrow"><span>المستوى</span><span>المجتمع</span><span>العدد</span><span>العيّنة</span><span>${withPop ? "التغطية" : "أسلوب السحب"}</span></div>
    ${rows}
    <p class="v3-pop-note">${withPop ? "التغطية = العيّنة المفحوصة ÷ مجتمع المستوى؛ ولا يعكس حجم المستوى أهميته — لكل مستوى هدف كشف مختلف." : "الاختيار عشوائي داخل حصة كل مستوى؛ ولا يعكس حجم الحصة أهمية المستوى — لكل مستوى هدف كشف مختلف."}</p>
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
      { html: cell(l1.clean, n), cls: "v-green" },
      { html: cell(l1.suspicious, n), cls: "v-red" },
      { html: cell(l1.other, n), cls: "v-gold" },
      { html: cell(l2.clean, n), cls: "v-green" },
      { html: cell(l2.suspicious, n), cls: "v-red" },
      { html: cell(l2.other, n), cls: "v-gold" },
      { html: fmtNum(n), cls: "v-navy" },
    ];
    const stageRows = model.population.byStage.map((st) => {
      const cur = perStage.get(st.stageKey) ?? { n: 0, l1: zero(), l2: zero() };
      return rowFor(st.stageLabel, cur.n, cur.l1, cur.l2);
    });
    const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: "نتائج المستويين في المجتمع", note: `${fmtNum(s.total)} صورة — مجموع أشهر الفترة · إجابات المستوى الأول والثاني لكل مستوى` })}
${dataTable({
      headers: ["المستوى", "الأول: سليمة", "الأول: اشتباه", "الأول: أخرى", "الثاني: سليمة", "الثاني: اشتباه", "الثاني: أخرى", "الإجمالي"],
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
        { html: popCell(p.total, p.sampleTotal, withPop), cls: "v-navy" },
        { html: popCell(p.clean, p.sampleClean, withPop), cls: "v-green" },
        { html: popCell(p.suspicious, p.sampleSuspicious, withPop), cls: "v-red" },
        ...(withPop ? [{ html: fmtNum(p.other ?? 0), cls: "v-gold" }] : []),
      ]);
    const totalsOf = (label: string, ports: PortPopRow[]): TableCell[] => {
      const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
      return [
        { html: label },
        { html: popCell(sum((p) => p.total), sum((p) => p.sampleTotal), withPop), cls: "v-navy" },
        { html: popCell(sum((p) => p.clean), sum((p) => p.sampleClean), withPop), cls: "v-green" },
        { html: popCell(sum((p) => p.suspicious), sum((p) => p.sampleSuspicious), withPop), cls: "v-red" },
        ...(withPop ? [{ html: fmtNum(sum((p) => p.other ?? 0)), cls: "v-gold" }] : []),
      ];
    };
    const coverageNote = (ports: PortPopRow[]) => {
      const total = ports.reduce((s, p) => s + p.total, 0);
      const sample = ports.reduce((s, p) => s + p.sampleTotal, 0);
      return `التغطية ${fmtPct(pct(sample, total))}`;
    };
    const headers = withPop ? ["المنفذ", "الإجمالي", "سليمة", "اشتباه", "نتائج أخرى"] : ["المنفذ", "الإجمالي", "سليمة", "اشتباه"];
    for (let page = 0; page < popPages; page++) {
      const m = meta("s1", EYEBROW_S1);
      const land = chunkAt(popLand, page);
      const sea = chunkAt(popSea, page);
      const padTo = Math.max(land.length, sea.length);
      const isLast = page === popPages - 1;
      const title = "التوزيع على المنافذ البرية والبحرية" + (page > 0 ? YITBA : "");
      const inner = `${contentHead({ eyebrow: EYEBROW_S1, title, note: "المجتمع والرقم بين قوسين العيّنة المسحوبة — مفصولة إلى سليمة واشتباه" })}
<div class="v3-two-col">
  ${tintedPanel({ variant: "land", title: "المنافذ البرية", note: coverageNote(popLand), body: dataTable({ headers, rows: portRows(land), totals: isLast ? totalsOf("إجمالي البرية", popLand) : undefined, padToRows: padTo }) })}
  ${tintedPanel({ variant: "sea", title: "المنافذ البحرية", note: coverageNote(popSea), body: dataTable({ headers, rows: portRows(sea), totals: isLast ? totalsOf("إجمالي البحرية", popSea) : undefined, padToRows: padTo }) })}
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
    description: copy.s2Description,
    footItems: [copy.s2FootLead, "النتائج حسب المنافذ ومستويات المخاطر"],
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
        { html: rateCell(a.cleanAcc, a.cleanResults), cls: "v-green" },
        { html: rateCell(a.suspAcc, a.suspResults), cls: "v-red" },
        { html: rateCell(a.overall, s.evaluable), cls: "v-navy" },
      ];
    });
    const totals: TableCell[] = [
      { html: "الإجمالي" },
      { html: fmtNum(t.evaluable), cls: "v-navy" },
      { html: rateCell(overallStats.cleanAcc, overallStats.cleanResults), cls: "v-green" },
      { html: rateCell(overallStats.suspAcc, overallStats.suspResults), cls: "v-red" },
      { html: rateCell(overallStats.overall, t.evaluable), cls: "v-gold" },
    ];
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "دقة الرصد العامة",
      note: `${fmtNum(t.evaluable)} نتيجة مُقيَّمة — ${fmtNum(overallStats.cleanResults)} نتيجة سليمة و${fmtNum(overallStats.suspResults)} نتيجة اشتباه${otherResultsNote}`,
    })}
${kpiBand([
      { label: "دقة الرصد العامة", value: fmtPct(overallStats.overall), sub: "مرجّحة على مجموع النتائج المُقيَّمة" },
      { label: "دقة السليمة", value: fmtPct(overallStats.cleanAcc), valueTone: "green", sub: `من ${fmtNum(overallStats.cleanResults)} نتيجة سليمة — ${fmtNum(t.missedSuspicion)} منها كانت اشتباهًا فائتًا` },
      { label: "دقة الاشتباه", value: fmtPct(overallStats.suspAcc), valueTone: "red", sub: `من ${fmtNum(overallStats.suspResults)} نتيجة اشتباه — ${fmtNum(t.falseSuspicion)} منها كانت اشتباهًا خاطئًا` },
    ], "solo", true)}
<div class="v3-note" style="margin-top:18px;font-weight:700;color:var(--v3-navy);">الدقتان حسب مستويات المخاطر — الأرقام بين قوسين عدد النتائج المُقيَّمة</div>
${dataTable({ headers: ["المستوى", "النتائج المُقيَّمة", "دقة السليمة", "دقة الاشتباه", "الدقة العامة"], rows: stageRows, totals })}`;
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
    const rowsOf = (ports: PortAccuracyRow[]): TableCell[][] =>
      ports.map((p) => {
        const a = accuracyOf(p.counts);
        return [
          { html: esc(p.name) },
          { html: rateCell(a.cleanAcc, a.cleanResults), cls: "v-green" },
          { html: rateCell(a.suspAcc, a.suspResults), cls: "v-red" },
          { html: rateCell(a.overall, a.evaluable), cls: "v-navy" },
        ];
      });
    const totalsOf = (label: string, a: ReturnType<typeof accuracyOf>): TableCell[] => [
      { html: label },
      { html: rateCell(a.cleanAcc, a.cleanResults), cls: "v-green" },
      { html: rateCell(a.suspAcc, a.suspResults), cls: "v-red" },
      { html: rateCell(a.overall, a.evaluable), cls: "v-gold" },
    ];
    const headers = ["المنفذ", "دقة السليمة", "دقة الاشتباه", "الدقة العامة"];
    for (let page = 0; page < accPages; page++) {
      const m = meta("s2", eyebrowS2);
      const land = chunkAt(portAcc.land, page);
      const sea = chunkAt(portAcc.sea, page);
      const padTo = Math.max(land.length, sea.length);
      const isLast = page === accPages - 1;
      const title = "دقة الرصد حسب المنفذ" + (page > 0 ? YITBA : "");
      const inner = `${contentHead({
        eyebrow: eyebrowS2,
        title,
        note: `الأرقام بين قوسين = عدد النتائج المُقيَّمة · المرجع العام ${fmtPct(overallStats.cleanAcc)} / ${fmtPct(overallStats.suspAcc)} / ${fmtPct(overallStats.overall)}`,
      })}
<div class="v3-two-col">
  ${tintedPanel({ variant: "land", title: "المنافذ البرية", body: dataTable({ headers, rows: rowsOf(land), totals: isLast ? totalsOf("إجمالي البرية", landTotals) : undefined, firstColWidth: 36, padToRows: padTo }) })}
  ${tintedPanel({ variant: "sea", title: "المنافذ البحرية", body: dataTable({ headers, rows: rowsOf(sea), totals: isLast ? totalsOf("إجمالي البحرية", seaTotals) : undefined, firstColWidth: 36, padToRows: padTo }) })}
</div>`;
      parts.push(slideShell(m, "", inner));
    }
  }

  // 12 — Overall accuracy per port: one slide per port type (land, then sea) so each chart has the full width
  // and a 17-port land chart never squeezes the sea chart.
  {
    const barsOf = (ports: PortAccuracyRow[]): ChartBar[] =>
      ports.map((p) => ({ label: p.name, value: accuracyOf(p.counts).overall }));
    const portAxis = fitAxis([...barsOf(portAcc.land), ...barsOf(portAcc.sea)].map((b) => b.value), 86, 98);
    for (const kind of ["land", "sea"] as const) {
      const m = meta("s2", eyebrowS2);
      const isLand = kind === "land";
      const ports = isLand ? portAcc.land : portAcc.sea;
      const avg = isLand ? landTotals.overall : seaTotals.overall;
      const chart = barChart({
        bars: barsOf(ports),
        ...portAxis, tint: kind,
        defaultTone: isLand ? "gold" : "blue",
        references: avg === null ? [] : [{ value: avg, label: `المتوسط ${fmtPct(avg)}`, tone: isLand ? "gold-dark" : "blue-dark" }],
      });
      const inner = `${contentHead({
        eyebrow: eyebrowS2,
        title: isLand ? "الدقة العامة حسب المنفذ — المنافذ البرية" : "الدقة العامة حسب المنفذ — المنافذ البحرية",
        note: `${fmtNum(ports.length)} ${isLand ? "منافذ برية" : "منافذ بحرية"} — متوسط النوع ${fmtPct(avg)}`,
      })}
<div class="v3-single-chart">${chartTitleRow({ title: isLand ? "المنافذ البرية" : "المنافذ البحرية", dot: kind })}${chart}</div>
${legendRow([
        isLand ? { swatch: "gold", text: "دقة المنفذ البري" } : { swatch: "blue", text: "دقة المنفذ البحري" },
        { dash: "muted", text: "متوسط النوع" },
      ], scaleCaption(portAxis))}`;
      parts.push(slideShell(m, "", inner));
    }
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
        return `<div class="v3-chart-col">${chart}<div class="v3-level-cap"><b>${esc(s.label)}</b><span>الدقة العامة ${fmtPct(a.overall)} · ${fmtNum(s.evaluable)} نتيجة</span></div></div>`;
      })
      .join("\n");
    const inner = `${contentHead({
      eyebrow: eyebrowS2,
      title: "الدقتان حسب مستويات المخاطر",
      note: copy.levelsChartNote,
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
    title: "التحاليل المتقدمة",
    description: "ما وراء النسب: مصفوفة النتائج، دقة المستويات، والتوافق مع الفرق الأمنية ومحرك المخاطر، وأثر التحديد وجودة الصورة.",
    footItems: [
      "مصفوفة نتائج الوسائل الآلية · دقة إجابات المستويين",
      "التوافق مع الفرق الأمنية · التوافق مع محرك المخاطر",
      "أثر التحديد · أثر جودة الصورة",
    ],
    meta: meta("s3", eyebrowS3),
  }));

  // 15 — Outcome matrix (errorAnalysis.totals verbatim, never recomputed)
  {
    const m = meta("s3", eyebrowS3);
    const share = (n: number) => fmtPct(pct(n, t.evaluable));
    const qualityClean = t.correctClean + t.falseSuspicion;
    const qualitySusp = t.missedSuspicion + t.correctSuspicion;
    const inner = `${contentHead({
      eyebrow: eyebrowS3,
      title: "مصفوفة نتائج الوسائل الآلية",
      note: `${fmtNum(t.evaluable)} نتيجة مُقيَّمة — نتيجة الفحص مقابل رأي أخصائي الجودة`,
    })}
${matrixGrid({
      colHeads: ["رأي الجودة: سليم", "رأي الجودة: اشتباه"],
      rowLabels: ["نتيجة الوسائل الآلية: سليم", "نتيجة الوسائل الآلية: اشتباه"],
      cells: [
        { value: fmtNum(t.correctClean), caption: `توافق على السليم · ${share(t.correctClean)} من النتائج`, tone: "pos" },
        { value: fmtNum(t.missedSuspicion), caption: `اشتباه فائت · ${share(t.missedSuspicion)} من النتائج`, tone: "neg" },
        { value: fmtNum(t.falseSuspicion), caption: `اشتباه خاطئ · ${share(t.falseSuspicion)} من النتائج`, tone: "neg" },
        { value: fmtNum(t.correctSuspicion), caption: `توافق على الاشتباه · ${share(t.correctSuspicion)} من النتائج`, tone: "pos" },
      ],
      rowSides: [
        { label: "دقة السليمة", value: fmtPct(overallStats.cleanAcc), sub: fmtNum(overallStats.cleanResults) },
        { label: "دقة الاشتباه", value: fmtPct(overallStats.suspAcc), sub: fmtNum(overallStats.suspResults) },
      ],
      totalsLabel: "الإجمالي",
      colTotals: [
        { label: "رأي الجودة: سليم", value: fmtNum(qualityClean), sub: "" },
        { label: "رأي الجودة: اشتباه", value: fmtNum(qualitySusp), sub: "" },
      ],
      grandTotal: { label: "التوافق الكلي", value: fmtPct(overallStats.overall), sub: fmtNum(t.evaluable), gold: true },
    })}
<p class="v3-note">الخطأان غير متكافئين في الأثر: ${fmtNum(t.falseSuspicion)} اشتباهًا خاطئًا تعني كلفة تشغيلية، و${fmtNum(t.missedSuspicion)} اشتباهًا فائتًا تعني مخاطرة أمنية مباشرة.</p>`;
    parts.push(slideShell(m, "", inner));
  }

  // 16 — Level 1 vs Level 2 answers (all ports pooled, five metric rows each)
  const levelRows = collectLevelAccuracyRows(model);
  const allLevelRows = [...levelRows.land, ...levelRows.sea];
  const l1All = accuracyOf(sumCounts(allLevelRows.map((r) => r.l1.counts)));
  const l2All = accuracyOf(sumCounts(allLevelRows.map((r) => r.l2.counts)));
  {
    const m = meta("s3", eyebrowS3);
    const l1Missed = allLevelRows.reduce((s, r) => s + r.l1.counts.missedSuspicion, 0);
    const l2Missed = allLevelRows.reduce((s, r) => s + r.l2.counts.missedSuspicion, 0);
    const panel = (variant: "land" | "sea", title: string, a: typeof l1All, missed: number, other: number) =>
      tintedPanel({
        variant, title, padLg: true,
        body: `<div class="v3-cmp-rows">
  <div class="v3-cmp-row"><span>النتائج المُقيَّمة</span><b>${fmtNum(a.evaluable)}</b></div>
  <div class="v3-cmp-row"><span>دقة السليمة</span><b class="v-green">${fmtPct(a.cleanAcc)}</b></div>
  <div class="v3-cmp-row"><span>دقة الاشتباه</span><b class="v-red">${fmtPct(a.suspAcc)}</b></div>
  <div class="v3-cmp-row"><span>الدقة العامة</span><b>${fmtPct(a.overall)}</b></div>
  <div class="v3-cmp-row"><span>اشتباهات فائتة</span><b>${fmtNum(missed)} نتيجة</b></div>
  <div class="v3-cmp-row"><span>نتائج أخرى (غير مُقيَّمة)</span><b>${fmtNum(other)}</b></div>
</div>`,
      });
    const note =
      l1All.overall !== null && l2All.overall !== null && l1All.suspAcc !== null && l2All.suspAcc !== null
        ? `<p class="v3-note">فرق الدقة العامة بين المستويين ${fmtPct(Math.abs(l1All.overall - l2All.overall))} (${fmtPct(l1All.overall)} مقابل ${fmtPct(l2All.overall)})، وفرق دقة الاشتباه ${fmtPct(Math.abs(l1All.suspAcc - l2All.suspAcc))} (${fmtPct(l1All.suspAcc)} مقابل ${fmtPct(l2All.suspAcc)}).</p>`
        : "";
    const inner = `${contentHead({
      eyebrow: eyebrowS3,
      title: "دقة إجابات المستوى الأول والثاني",
      note: "لكل صورة نتيجتان مستقلّتان — نتيجة لكل مستوى",
    })}
<div class="v3-two-col">
  ${panel("land", "المستوى الأول", l1All, l1Missed, otherL1)}
  ${panel("sea", "المستوى الثاني", l2All, l2Missed, otherL2)}
</div>
${note}`;
    parts.push(slideShell(m, "", inner));
  }

  await yieldToMain();

  // 17/18 — Level 1/2 accuracy per port, land then sea. The sea chart pins
  // each group to a fixed 16.2% slice so its bar width/spacing matches the
  // land chart (the handoff's own trick for unequal port counts).
  {
    const levelPortSlide = (
      title: string,
      rows: typeof levelRows.land,
      tint: "land" | "sea",
      typeOverall: number | null,
      fixedGroups: boolean,
    ) => {
      const m = meta("s3", eyebrowS3);
      const l1Type = accuracyOf(sumCounts(rows.map((r) => r.l1.counts)));
      const l2Type = accuracyOf(sumCounts(rows.map((r) => r.l2.counts)));
      const levelPortAxis = fitAxis(rows.flatMap((r) => [r.l1.accuracy, r.l2.accuracy]), 86, 96);
      const chart = groupedBarChart({
        groups: rows.map((r) => {
          const portOverall = accuracyOf(sumCounts([r.l1.counts, r.l2.counts])).overall;
          return {
            label: r.name,
            sublabel: `العامة ${fmtPct(portOverall)}`,
            a: { label: "المستوى الأول", value: r.l1.accuracy },
            b: { label: "المستوى الثاني", value: r.l2.accuracy },
          };
        }),
        ...levelPortAxis, tint,
        // 16.2% slices only fit ≤ 6 groups (6 × 16.2% ≈ 97% of the plot); more ports share the width evenly.
        groupWidthPct: fixedGroups && rows.length <= 6 ? 16.2 : undefined,
        references: typeOverall === null ? [] : [{ value: typeOverall, tone: "muted" }],
      });
      const inner = `${contentHead({
        eyebrow: eyebrowS3,
        title,
        note: `${fmtNum(rows.length)} ${tint === "land" ? "منافذ برية" : "منافذ بحرية"} — متوسط النوع ${fmtPct(typeOverall)}`,
      })}
${chartTitleRow({ title: "الدقة العامة لكل مستوى في كل منفذ", asideDash: { tone: "muted", text: `متوسط النوع ${fmtPct(typeOverall)}` } })}
<div class="v3-single-chart">${chart}</div>
${legendRow([
        { swatch: "gold", text: `المستوى الأول — متوسط ${fmtPct(l1Type.overall)}` },
        { swatch: "blue", text: `المستوى الثاني — متوسط ${fmtPct(l2Type.overall)}` },
      ], scaleCaption(levelPortAxis))}`;
      return slideShell(m, "", inner);
    };
    parts.push(levelPortSlide("دقة المستويين في المنافذ البرية", levelRows.land, "land", landTotals.overall, false));
    parts.push(levelPortSlide("دقة المستويين في المنافذ البحرية", levelRows.sea, "sea", seaTotals.overall, true));
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
    ${dataTable({ headers: ["الفريق", "الصور", "المستوى الأول", "المستوى الثاني", "الكلي"], rows: teamRows, totals: teamTotals, firstColWidth: 26 })}
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

  // 20 — Marking + image-quality impact (symmetric split, callouts pinned)
  {
    const m = meta("s3", eyebrowS3);
    const marking = computeMarkingImpact(model);
    const quality = computeQualityImpactStrata(model.rows);
    const gradient = accuracyGradient(quality.strata);
    const overallRef =
      overallStats.overall === null
        ? []
        : [{ value: overallStats.overall, tone: "gold" as const }];

    const markingDelta =
      marking.present.accuracy !== null && marking.absent.accuracy !== null
        ? marking.present.accuracy - marking.absent.accuracy
        : null;
    const impactAxis = fitAxis(
      [marking.present.accuracy, marking.absent.accuracy, ...quality.strata.map((s) => s.accuracy)],
      70,
      100,
    );
    const markingChart = barChart({
      bars: [
        { label: "مع تحديد الموقع", sublabel: `${fmtNum(marking.present.n)} نتيجة`, value: marking.present.accuracy, tone: "green" },
        { label: "دون تحديد", sublabel: `${fmtNum(marking.absent.n)} نتيجة`, value: marking.absent.accuracy, tone: "red" },
      ],
      ...impactAxis, barMaxWidth: 120, gap: 34, pad: 44,
      references: overallRef,
    });

    const qualityStrata = quality.strata;
    const qualityTones = ["green", "gold", "red"] as const;
    const qualityChart = barChart({
      bars: qualityStrata.map((s, i) => ({
        label: `جودة ${s.level}`,
        sublabel: `${fmtNum(s.n)} نتيجة`,
        value: s.accuracy,
        tone: qualityTones[Math.min(i, qualityTones.length - 1)],
      })),
      ...impactAxis, barMaxWidth: 120, gap: 34, pad: 44,
      references: overallRef,
    });
    const qualityTotal = qualityStrata.reduce((s, x) => s + x.n, 0);
    const high = qualityStrata[0];
    const low = qualityStrata[qualityStrata.length - 1];

    const impactTitle = "أثر التحديد وجودة الصورة على الدقة";
    const impactNote = `عاملان تشغيليان يُفسّران معظم تفاوت الدقة — المتوسط العام ${fmtPct(overallStats.overall)}`;
    const markingCol = `${impactColumn({
      title: "أثر وجود التحديد",
      note: `${fmtNum(marking.present.n)} مقابل ${fmtNum(marking.absent.n)} نتيجة`,
      chartHtml: markingChart,
      calloutValue: markingDelta === null ? "—" : `${markingDelta >= 0 ? "+" : "−"}${Math.abs(markingDelta).toFixed(1)}%`,
      calloutText:
        markingDelta === null
          ? "لا يمكن حساب الفرق — إحدى المجموعتين دون حد الكفاية الإحصائية."
          : `فرق في الدقة العامة (${fmtPct(marking.present.accuracy)} مقابل ${fmtPct(marking.absent.accuracy)}).`,
    })}`;
    const qualityCol = `${impactColumn({
      title: "أثر جودة الصورة",
      note: `${fmtNum(qualityTotal)} نتيجة على ${fmtNum(qualityStrata.length)} فئات جودة`,
      chartHtml: qualityChart,
      calloutValue: gradient === null ? "—" : `−${Math.abs(gradient).toFixed(1)}%`,
      calloutText:
        gradient === null || !high || !low
          ? "لا يمكن حساب الفرق — إحدى فئات الجودة دون حد الكفاية الإحصائية."
          : `فرق بين الصور ${high.level}ة الجودة (${fmtPct(high.accuracy)}) و${low.level}ة الجودة (${fmtPct(low.accuracy)}) — معالجة جودة الالتقاط ترفع الدقة قبل أي تدريب.`,
    })}`;
    const impactLegend = legendRow([{ dash: "gold", text: `المتوسط العام ${fmtPct(overallStats.overall)}` }], scaleCaption(impactAxis));
    // Two pages — marking, then (يتبع) image quality — one chart each, full width.
    const inner = `${contentHead({ eyebrow: eyebrowS3, title: impactTitle, note: impactNote })}
<div class="v3-impact-grid v3-impact-single">${markingCol}</div>
${impactLegend}`;
    parts.push(slideShell(m, "", inner));
    const m2 = meta("s3", eyebrowS3);
    const inner2 = `${contentHead({ eyebrow: eyebrowS3, title: impactTitle + YITBA, note: impactNote })}
<div class="v3-impact-grid v3-impact-single">${qualityCol}</div>
${impactLegend}`;
    parts.push(slideShell(m2, "", inner2));
  }

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
