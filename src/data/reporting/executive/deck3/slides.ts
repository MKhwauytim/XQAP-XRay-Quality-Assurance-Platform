// The 21 handoff slides (design_handoff_xray_qa_deck, rebuilt 2026-08-26 to
// the handoff's exact layouts), wired to real report data. Every figure comes
// from the shared ReportModel folds or deck2's exported section-3 helpers —
// nothing is re-tallied here beyond presentation-layer rates, and the
// handoff's placeholder numbers never appear. Static Arabic prose (glossary
// definitions, level definitions, section descriptions) is the handoff's own
// locked wording, hardcoded the same way deck2 hardcodes its one-off slide
// copy.
import { yieldToMain } from "../../../storage/yieldToMain";
import { esc, fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { KeyedAccuracy } from "../model/aggregates";
import { collectPortStats, type PortPopRow } from "../deck2/slideKit";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
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
import { barChart, groupedBarChart, type ChartBar } from "./chartKit";

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
const CLASSIFICATION = "داخلي — للاستخدام التنفيذي";

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
function popCell(population: number, sample: number): string {
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
    lines: [`${ORGANIZATION_PATH[0]} — ${ORGANIZATION_PATH[1]}`, ORGANIZATION_PATH[2]],
  };
  const t = model.errorAnalysis.totals;
  const overallStats = accuracyOf(t);

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
  const TOTAL = 21 + (popPages - 1) + (accPages - 1);
  const YITBA = " (يتبع)";

  let nextNum = 1;
  const meta = (sectionKey: string, sectionLabel: string): SlideMeta => ({
    num: nextNum++, total: TOTAL, sectionKey, sectionLabel, footText,
  });

  // 1 — Cover
  parts.push(coverSlide({
    org,
    kicker: "عرض تنفيذي · تقرير شهري",
    title: REPORT_NAME,
    periodLabel: "فترة الدراسة (عيّنة شهر)",
    periodValue: monthLabel,
    metaRows: [
      {
        label: "تاريخ التقرير",
        value: now.toLocaleDateString("ar-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric" }),
      },
      { label: "الإدارة", value: ORGANIZATION_PATH[1] },
      { label: "القسم", value: ORGANIZATION_PATH[2] },
      { label: "التصنيف", value: CLASSIFICATION, end: true },
    ],
    meta: meta("cover", "الغلاف"),
  }));

  // 2 — Contents. Page ranges below section 1 shift with popPages/accPages
  // (slides 8 and 11's own port-table pagination) — derived from the same
  // arithmetic that produces TOTAL above, not re-hardcoded per range.
  const s1End = 7 + popPages;
  const s2Start = s1End + 1;
  const s2End = s2Start + 3 + accPages;
  const s3Start = s2End + 1;
  const s3End = s3Start + 6;
  parts.push(contentsSlide({
    eyebrow: "التقرير التنفيذي",
    title: "محتويات التقرير",
    rows: [
      { index: 1, title: "المعجم", description: "تعريف مستويات المخاطر الأربعة والمصطلحات المستخدمة في التقرير.", topics: "مستويات المخاطر · مصطلحات العيّنة والنتائج", pages: "ص 03–04" },
      { index: 2, title: "مؤشرات الشهر", description: "خلاصة أرقام الشهر في صفحة واحدة.", topics: "المجتمع · العيّنة · التغطية · الدقة", pages: "ص 05" },
      { index: 3, title: "القسم الأول — مجتمع الفحص", description: "حجم مجتمع الشهر وتوزيعه على المستويات والمنافذ، والأساس الذي سُحبت منه العيّنة.", topics: "المستويات الأربعة · المنافذ البرية والبحرية", pages: `ص ${pad2(6)}–${pad2(s1End)}` },
      { index: 4, title: "القسم الثاني — نتائج فحص الجودة", description: "دقة النتائج على مستوى الشهر وحسب المنفذ ومستوى المخاطر.", topics: "النتائج العامة · النتائج حسب المنفذ والمستوى", pages: `ص ${pad2(s2Start)}–${pad2(s2End)}` },
      { index: 5, title: "القسم الثالث — التحاليل المتقدمة", description: "مصفوفة النتائج، دقة المستويين، والتوافق مع الفرق الأمنية ومحرك المخاطر، وأثر التحديد والجودة.", topics: "المصفوفة · التوافق · أثر التحديد والجودة", pages: `ص ${pad2(s3Start)}–${pad2(s3End)}` },
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
          { term: "التغطية", definition: "نسبة حجم العيّنة المسحوبة إلى حجم المجتمع؛ مقياس حجم لا يدل على تمثيل العيّنة للمجتمع." },
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
  const fixedShare = (weight: number) => fmtNum(Math.round(monthlyTarget * weight));
  parts.push(levelDefinitionSlide({
    eyebrow: "المعجم",
    title: "مستويات المخاطر",
    levels: [
      {
        title: "المستوى الأول",
        definition: "الصور التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون استهداف من محرك المخاطر.",
        measures: "انفراد الفحص بالاشتباه دون مؤشرات أخرى.",
        weightLine: "وزن السحب: 100% — حصر كامل لمجتمع المستوى",
        tone: "gold",
      },
      {
        title: "المستوى الثاني",
        definition: "الصور التي استهدفها محرك المخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.",
        measures: "ما يلتقطه محرك المخاطر ولا يُلتقط من قبل أخصائي الوسائل الآلية.",
        weightLine: `وزن السحب: 40% من حصة العدد الثابت — ${fixedShare(0.4)} صورة`,
        tone: "blue",
      },
      {
        title: "المستوى الثالث",
        definition: "الصور التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى.",
        measures: "ما تلتقطه الفرق الأمنية الأخرى ولا يلتقطه الفحص.",
        weightLine: `وزن السحب: 30% من حصة العدد الثابت — ${fixedShare(0.3)} صورة`,
        tone: "green-soft",
      },
      {
        title: "المستوى الرابع",
        definition: "الصور التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين.",
        measures: "ما ثبت فواته بضبط أمني أو باكتشاف خارجي.",
        weightLine: `وزن السحب: 30% من حصة العدد الثابت — ${fixedShare(0.3)} صورة`,
        tone: "red",
      },
    ],
    highlightValue: fmtNum(monthlyTarget),
    highlightTitle: "العيّنة المستهدفة الأساسية شهريًا (صورة)",
    highlightNote: "أوزان المستويات الثاني–الرابع تُسحب من هذا العدد (40% + 30% + 30%)؛ المستوى الأول حصر كامل من مجتمعه خارج هذه الحصة.",
    meta: meta("glossary", "المعجم"),
  }));

  await yieldToMain();

  // 5 — Month KPIs (two 3-cell bands; decision-grain accuracy figures come
  // from errorAnalysis.totals so slides 5/10/15 can never disagree)
  {
    const m = meta("kpis", "مؤشرات الشهر");
    const missedShare = pct(t.missedSuspicion, t.evaluable);
    const inner = `${contentHead({ eyebrow: "خلاصة الشهر", title: "مؤشرات الشهر", large: true })}
${kpiBand([
      { label: "مجتمع الفحص", value: fmtNum(model.population.total), sub: "مجتمع الصور الواردة من وكالة تحليل المخاطر" },
      { label: "العيّنة المسحوبة", value: fmtNum(model.sample.total), sub: "صورة موزّعة على أخصائيي الجودة" },
      { label: "التغطية", value: fmtPct(model.sample.coverage ?? null), valueTone: "gold", sub: "نسبة العينة من المجتمع" },
    ], "top")}
${kpiBand([
      { label: "دقة النتيجة", value: fmtPct(overallStats.overall), valueTone: "green", sub: `من ${fmtNum(t.evaluable)} نتيجة مُقيَّمة` },
      { label: "نسبة تحديد موقع الاشتباه", value: fmtPct(model.imageQuality.markingRate), valueTone: "red", sub: "التزام الفاحصين بتحديد مواضع الاشتباه" },
      { label: "الاشتباهات الفائتة", value: fmtNum(t.missedSuspicion), aside: missedShare === null ? undefined : `${fmtPct(missedShare)} من النتائج`, sub: "صور رأى فيها خبير جودة الأشعة كونها اشتباه لم يرصد من الوسائل الآلية" },
    ], "bottom")}`;
    parts.push(slideShell(m, "", inner));
  }

  // 6 — Section 1 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: "01",
    kicker: "القسم الأول",
    title: "مجتمع الفحص",
    description: "حجم مجتمع الشهر وتوزيعه على مستويات المخاطر والمنافذ، والأساس الذي سُحبت منه العيّنة.",
    footItems: ["مجتمع الفحص والعيّنة حسب المستوى", "التوزيع على المنافذ البرية والبحرية"],
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
  <span class="method${census ? " census" : ""}">${census ? "حصر كامل" : "عدد ثابت"}</span>
</div>`;
      })
      .join("\n");
    const inner = `${contentHead({ eyebrow: EYEBROW_S1, title: "مجتمع الفحص والعيّنة حسب المستوى", large: true })}
<div class="v3-pop-grid">
  <div class="v3-pop-stats">
    <div class="v3-pop-stat"><span>إجمالي المجتمع</span><b>${fmtNum(model.population.total)}</b></div>
    <div class="v3-pop-stat"><span>إجمالي العيّنة</span><b>${fmtNum(model.sample.total)}</b></div>
    <div class="v3-pop-stat"><span>التغطية الكلية</span><b class="v3-ink-gold">${fmtPct(model.sample.coverage ?? null)}</b></div>
  </div>
  <div class="v3-pop-table">
    <div class="v3-pop-hrow"><span>المستوى</span><span>المجتمع</span><span>العدد</span><span>العيّنة</span><span>أسلوب السحب</span></div>
    ${rows}
    <p class="v3-pop-note">الاختيار عشوائي داخل حصة كل مستوى؛ ولا يعكس حجم الحصة أهمية المستوى — لكل مستوى هدف كشف مختلف.</p>
  </div>
</div>`;
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
      ]);
    const totalsOf = (label: string, ports: PortPopRow[]): TableCell[] => {
      const sum = (f: (p: PortPopRow) => number) => ports.reduce((s, p) => s + f(p), 0);
      return [
        { html: label },
        { html: popCell(sum((p) => p.total), sum((p) => p.sampleTotal)), cls: "v-navy" },
        { html: popCell(sum((p) => p.clean), sum((p) => p.sampleClean)), cls: "v-green" },
        { html: popCell(sum((p) => p.suspicious), sum((p) => p.sampleSuspicious)), cls: "v-red" },
      ];
    };
    const coverageNote = (ports: PortPopRow[]) => {
      const total = ports.reduce((s, p) => s + p.total, 0);
      const sample = ports.reduce((s, p) => s + p.sampleTotal, 0);
      return `التغطية ${fmtPct(pct(sample, total))}`;
    };
    const headers = ["المنفذ", "الإجمالي", "سليمة", "اشتباه"];
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

  await yieldToMain();

  // 9 — Section 2 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: "02",
    kicker: "القسم الثاني",
    title: "نتائج فحص الجودة",
    description: "دقة النتائج وتحديد موقع الاشتباه والاشتباهات الفائتة على مستوى الشهر والمنافذ والمستويات.",
    footItems: ["النتائج العامة للشهر", "النتائج حسب المنافذ ومستويات المخاطر"],
    meta: meta("s2", EYEBROW_S2),
  }));

  // 10 — Overall detection accuracy: three-tile band + per-risk-level table
  {
    const m = meta("s2", EYEBROW_S2);
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
      eyebrow: EYEBROW_S2,
      title: "دقة الرصد العامة",
      note: `${fmtNum(t.evaluable)} نتيجة مُقيَّمة — ${fmtNum(overallStats.cleanResults)} نتيجة سليمة و${fmtNum(overallStats.suspResults)} نتيجة اشتباه`,
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
      const m = meta("s2", EYEBROW_S2);
      const land = chunkAt(portAcc.land, page);
      const sea = chunkAt(portAcc.sea, page);
      const padTo = Math.max(land.length, sea.length);
      const isLast = page === accPages - 1;
      const title = "دقة الرصد حسب المنفذ" + (page > 0 ? YITBA : "");
      const inner = `${contentHead({
        eyebrow: EYEBROW_S2,
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

  // 12 — Overall accuracy per port, one chart per type (land 6fr / sea 4fr)
  {
    const m = meta("s2", EYEBROW_S2);
    const barsOf = (ports: PortAccuracyRow[]): ChartBar[] =>
      ports.map((p) => ({ label: p.name, value: accuracyOf(p.counts).overall }));
    const chartOf = (ports: PortAccuracyRow[], tint: "land" | "sea", avg: number | null) =>
      barChart({
        bars: barsOf(ports),
        min: 86, max: 98, tint,
        defaultTone: tint === "land" ? "gold" : "blue",
        references: avg === null ? [] : [{ value: avg, label: `المتوسط ${fmtPct(avg)}`, tone: tint === "land" ? "gold-dark" : "blue-dark" }],
      });
    const inner = `${contentHead({
      eyebrow: EYEBROW_S2,
      title: "الدقة العامة حسب المنفذ",
      note: `متوسط البرية ${fmtPct(landTotals.overall)} · متوسط البحرية ${fmtPct(seaTotals.overall)}`,
    })}
<div class="v3-ports-chart-grid">
  <div class="v3-chart-col">${chartTitleRow({ title: "المنافذ البرية", dot: "land" })}${chartOf(portAcc.land, "land", landTotals.overall)}</div>
  <div class="v3-chart-col">${chartTitleRow({ title: "المنافذ البحرية", dot: "sea" })}${chartOf(portAcc.sea, "sea", seaTotals.overall)}</div>
</div>
${legendRow([
      { swatch: "gold", text: "دقة المنفذ البري" },
      { swatch: "blue", text: "دقة المنفذ البحري" },
      { dash: "muted", text: "متوسط النوع" },
    ], "المقياس من 86% إلى 98%")}`;
    parts.push(slideShell(m, "", inner));
  }

  // 13 — Clean/suspicion accuracy per risk level (four mini plots)
  {
    const m = meta("s2", EYEBROW_S2);
    const stages = orderedStageAccuracy(model);
    const cols = stages
      .map((s) => {
        const a = accuracyOf(s.counts);
        const chart = barChart({
          bars: [
            { label: "", value: a.cleanAcc, tone: "green" },
            { label: "", value: a.suspAcc, tone: "red" },
          ],
          min: 60, max: 100, plotHeight: 440, barMaxWidth: 88, gap: 22, pad: 26, hideCats: true,
          references: [
            ...(overallStats.cleanAcc === null ? [] : [{ value: overallStats.cleanAcc, tone: "avg-green" as const }]),
            ...(overallStats.suspAcc === null ? [] : [{ value: overallStats.suspAcc, tone: "avg-red" as const }]),
          ],
        });
        return `<div class="v3-chart-col">${chart}<div class="v3-level-cap"><b>${esc(s.label)}</b><span>الدقة العامة ${fmtPct(a.overall)} · ${fmtNum(s.evaluable)} نتيجة</span></div></div>`;
      })
      .join("\n");
    const inner = `${contentHead({
      eyebrow: EYEBROW_S2,
      title: "الدقتان حسب مستويات المخاطر",
      note: "الأعمدة بنفس أرقام صفحة دقة الرصد العامة — الخطان المتقطعان متوسطا الشهر",
    })}
<div class="v3-levels-chart-grid">${cols}</div>
${legendRow([
      { swatch: "green", text: "دقة السليمة" },
      { swatch: "red", text: "دقة الاشتباه" },
      { dash: "avg-green", text: `متوسط السليمة ${fmtPct(overallStats.cleanAcc)}` },
      { dash: "avg-red", text: `متوسط الاشتباه ${fmtPct(overallStats.suspAcc)}` },
    ], "المقياس من 60% إلى 100%")}`;
    parts.push(slideShell(m, "", inner));
  }

  await yieldToMain();

  // 14 — Section 3 divider
  parts.push(sectionDivider({
    eyebrow: footText,
    ghost: "03",
    kicker: "القسم الثالث",
    title: "التحاليل المتقدمة",
    description: "ما وراء النسب: مصفوفة النتائج، دقة المستويات، والتوافق مع الفرق الأمنية ومحرك المخاطر، وأثر التحديد وجودة الصورة.",
    footItems: [
      "مصفوفة نتائج الوسائل الآلية · دقة إجابات المستويين",
      "التوافق مع الفرق الأمنية · التوافق مع محرك المخاطر",
      "أثر التحديد · أثر جودة الصورة",
    ],
    meta: meta("s3", EYEBROW_S3),
  }));

  // 15 — Outcome matrix (errorAnalysis.totals verbatim, never recomputed)
  {
    const m = meta("s3", EYEBROW_S3);
    const share = (n: number) => fmtPct(pct(n, t.evaluable));
    const qualityClean = t.correctClean + t.falseSuspicion;
    const qualitySusp = t.missedSuspicion + t.correctSuspicion;
    const inner = `${contentHead({
      eyebrow: EYEBROW_S3,
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
    const m = meta("s3", EYEBROW_S3);
    const l1Missed = allLevelRows.reduce((s, r) => s + r.l1.counts.missedSuspicion, 0);
    const l2Missed = allLevelRows.reduce((s, r) => s + r.l2.counts.missedSuspicion, 0);
    const panel = (variant: "land" | "sea", title: string, a: typeof l1All, missed: number) =>
      tintedPanel({
        variant, title, padLg: true,
        body: `<div class="v3-cmp-rows">
  <div class="v3-cmp-row"><span>النتائج المُقيَّمة</span><b>${fmtNum(a.evaluable)}</b></div>
  <div class="v3-cmp-row"><span>دقة السليمة</span><b class="v-green">${fmtPct(a.cleanAcc)}</b></div>
  <div class="v3-cmp-row"><span>دقة الاشتباه</span><b class="v-red">${fmtPct(a.suspAcc)}</b></div>
  <div class="v3-cmp-row"><span>الدقة العامة</span><b>${fmtPct(a.overall)}</b></div>
  <div class="v3-cmp-row"><span>اشتباهات فائتة</span><b>${fmtNum(missed)} نتيجة</b></div>
</div>`,
      });
    const note =
      l1All.overall !== null && l2All.overall !== null && l1All.suspAcc !== null && l2All.suspAcc !== null
        ? `<p class="v3-note">فرق الدقة العامة بين المستويين ${fmtPct(Math.abs(l1All.overall - l2All.overall))} (${fmtPct(l1All.overall)} مقابل ${fmtPct(l2All.overall)})، وفرق دقة الاشتباه ${fmtPct(Math.abs(l1All.suspAcc - l2All.suspAcc))} (${fmtPct(l1All.suspAcc)} مقابل ${fmtPct(l2All.suspAcc)}).</p>`
        : "";
    const inner = `${contentHead({
      eyebrow: EYEBROW_S3,
      title: "دقة إجابات المستوى الأول والثاني",
      note: "لكل صورة نتيجتان مستقلّتان — نتيجة لكل مستوى",
    })}
<div class="v3-two-col">
  ${panel("land", "المستوى الأول", l1All, l1Missed)}
  ${panel("sea", "المستوى الثاني", l2All, l2Missed)}
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
      const m = meta("s3", EYEBROW_S3);
      const l1Type = accuracyOf(sumCounts(rows.map((r) => r.l1.counts)));
      const l2Type = accuracyOf(sumCounts(rows.map((r) => r.l2.counts)));
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
        min: 86, max: 96, tint,
        groupWidthPct: fixedGroups ? 16.2 : undefined,
        references: typeOverall === null ? [] : [{ value: typeOverall, tone: "muted" }],
      });
      const inner = `${contentHead({
        eyebrow: EYEBROW_S3,
        title,
        note: `${fmtNum(rows.length)} ${tint === "land" ? "منافذ برية" : "منافذ بحرية"} — متوسط النوع ${fmtPct(typeOverall)}`,
      })}
${chartTitleRow({ title: "الدقة العامة لكل مستوى في كل منفذ", asideDash: { tone: "muted", text: `متوسط النوع ${fmtPct(typeOverall)}` } })}
<div class="v3-single-chart">${chart}</div>
${legendRow([
        { swatch: "gold", text: `المستوى الأول — متوسط ${fmtPct(l1Type.overall)}` },
        { swatch: "blue", text: `المستوى الثاني — متوسط ${fmtPct(l2Type.overall)}` },
      ], "المقياس من 86% إلى 96%")}`;
      return slideShell(m, "", inner);
    };
    parts.push(levelPortSlide("دقة المستويين في المنافذ البرية", levelRows.land, "land", landTotals.overall, false));
    parts.push(levelPortSlide("دقة المستويين في المنافذ البحرية", levelRows.sea, "sea", seaTotals.overall, true));
  }

  await yieldToMain();

  // 19 — Agreement with security teams (crossTeamMatrix: L1/L2 vs each team)
  // + the risk-engine band (an honest presentation fold over the rows'
  // engine verdict vs the screening result, reviewer verdict on the splits).
  {
    const m = meta("s3", EYEBROW_S3);
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
    const teamCharts = teams
      .map((team) => {
        const chart = barChart({
          bars: [
            { label: "", value: team.l1Rate, tone: "gold" },
            { label: "", value: team.l2Rate, tone: "blue" },
          ],
          min: 50, max: 85, barMaxWidth: 78, gap: 14, pad: 18, hideCats: true,
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
    for (const row of model.rows) {
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
        ? `<div class="v3-engine-band"><div class="v3-engine-head"><b>التوافق مع محرك المخاطر</b><span>لا توجد صور مستهدفة من محرك المخاطر في عيّنة هذا الشهر.</span></div></div>`
        : `<div class="v3-engine-band">
  <div class="v3-engine-head"><b>التوافق مع محرك المخاطر</b><span>${fmtNum(targeted)} صورة استهدفها المحرك — توافق ${fmtPct(pct(engineAgree, targeted))}</span></div>
  <div class="v3-engine-stats">
    <div class="v3-engine-stat"><b>${fmtPct(pct(engineAgree, targeted))}</b><span>اتفق الفحص مع المحرك (${fmtNum(engineAgree)} صورة)</span></div>
    <div class="v3-engine-stat"><b class="v-red">${fmtNum(engineDisagree)}</b><span>صورة خالف فيها الفحص استهداف المحرك</span></div>
    <div class="v3-engine-stat"><b class="v-gold">${fmtPct(pct(upheldEngine, engineDisagree))}</b><span>من صور الاختلاف أيّدت الجودة المحرك (${fmtNum(upheldEngine)})</span></div>
  </div>
  <div class="v3-engine-bar">${seg(engineAgree, "navy", `اتفاق ${fmtNum(engineAgree)}`)}${seg(upheldEngine, "red", fmtNum(upheldEngine))}${seg(engineRest, "neutral", fmtNum(engineRest))}</div>
</div>`;

    const inner = `${contentHead({
      eyebrow: EYEBROW_S3,
      title: "التوافق مع الفرق الأمنية ومحرك المخاطر",
      note: `${fmtNum(imagesTotal)} صور مشتركة — توافق المستوى الأول ${fmtPct(l1Pooled)} · الثاني ${fmtPct(l2Pooled)}`,
    })}
<div class="v3-agree-grid">
  <div class="v3-agree-col">
    ${chartTitleRow({ title: "التوافق لكل مستوى", asideDash: { tone: "gold", text: `نسبة توافق الفرق الأمنية ${fmtPct(pooled)}` } })}
    <div class="v3-team-charts">${teamCharts}</div>
    ${legendRow([
      { swatch: "gold", text: "المستوى الأول" },
      { swatch: "blue", text: "المستوى الثاني" },
    ], "المقياس من 50% إلى 85%")}
  </div>
  <div class="v3-agree-col">
    ${chartTitleRow({ title: "التفصيل — الأرقام بين قوسين عدد الصور المتوافقة" })}
    ${dataTable({ headers: ["الفريق", "الصور", "المستوى الأول", "المستوى الثاني", "الكلي"], rows: teamRows, totals: teamTotals, firstColWidth: 26 })}
  </div>
</div>
${engineBand}`;
    parts.push(slideShell(m, "", inner));
  }

  await yieldToMain();

  // 20 — Marking + image-quality impact (symmetric split, callouts pinned)
  {
    const m = meta("s3", EYEBROW_S3);
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
    const markingChart = barChart({
      bars: [
        { label: "مع تحديد الموقع", sublabel: `${fmtNum(marking.present.n)} نتيجة`, value: marking.present.accuracy, tone: "green" },
        { label: "دون تحديد", sublabel: `${fmtNum(marking.absent.n)} نتيجة`, value: marking.absent.accuracy, tone: "red" },
      ],
      min: 70, max: 100, barMaxWidth: 120, gap: 34, pad: 44,
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
      min: 70, max: 100, barMaxWidth: 120, gap: 34, pad: 44,
      references: overallRef,
    });
    const qualityTotal = qualityStrata.reduce((s, x) => s + x.n, 0);
    const high = qualityStrata[0];
    const low = qualityStrata[qualityStrata.length - 1];

    const inner = `${contentHead({
      eyebrow: EYEBROW_S3,
      title: "أثر التحديد وجودة الصورة على الدقة",
      note: `عاملان تشغيليان يُفسّران معظم تفاوت الدقة — المتوسط العام ${fmtPct(overallStats.overall)}`,
    })}
<div class="v3-impact-grid">
  ${impactColumn({
      title: "أثر وجود التحديد",
      note: `${fmtNum(marking.present.n)} مقابل ${fmtNum(marking.absent.n)} نتيجة`,
      chartHtml: markingChart,
      calloutValue: markingDelta === null ? "—" : `${markingDelta >= 0 ? "+" : "−"}${Math.abs(markingDelta).toFixed(1)}%`,
      calloutText:
        markingDelta === null
          ? "لا يمكن حساب الفرق — إحدى المجموعتين دون حد الكفاية الإحصائية."
          : `فرق في الدقة العامة (${fmtPct(marking.present.accuracy)} مقابل ${fmtPct(marking.absent.accuracy)}).`,
    })}
  ${impactColumn({
      title: "أثر جودة الصورة",
      note: `${fmtNum(qualityTotal)} نتيجة على ${fmtNum(qualityStrata.length)} فئات جودة`,
      chartHtml: qualityChart,
      calloutValue: gradient === null ? "—" : `−${Math.abs(gradient).toFixed(1)}%`,
      calloutText:
        gradient === null || !high || !low
          ? "لا يمكن حساب الفرق — إحدى فئات الجودة دون حد الكفاية الإحصائية."
          : `فرق بين الصور ${high.level}ة الجودة (${fmtPct(high.accuracy)}) و${low.level}ة الجودة (${fmtPct(low.accuracy)}) — معالجة جودة الالتقاط ترفع الدقة قبل أي تدريب.`,
    })}
</div>
${legendRow([{ dash: "gold", text: `المتوسط العام ${fmtPct(overallStats.overall)}` }], "المقياس من 70% إلى 100%")}`;
    parts.push(slideShell(m, "", inner));
  }

  // 21 — Closing
  parts.push(closingSlide({
    org: { ...org, lines: [ORGANIZATION_PATH[1]] },
    kicker: "ختام العرض",
    title: "شكراً",
    closingLine: "نرحّب بالملاحظات والأسئلة على نتائج الشهر والتقرير.",
    metaRows: [
      { label: "فترة التقرير", value: monthLabel },
      { label: "القسم", value: ORGANIZATION_PATH[2] },
      { label: "التصنيف", value: CLASSIFICATION, end: true },
    ],
    meta: meta("closing", "ختام العرض"),
  }));

  return parts.join("\n");
}
