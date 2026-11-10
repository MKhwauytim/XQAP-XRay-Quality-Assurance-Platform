// Port business report — HTML.
//
// Renders a PortReportModel in the live executive deck's design (deck3): the
// same 1920×1080 `.slide.v3` canvas, viewer shell (buildDeckV3Html), and slide
// kit (cover, glossary, KPI bands, tinted panels, tables, CSS bar charts).
// Layout tweaks are inline styles on deck3's own classes — no stylesheet of
// its own, so it stays in step with the executive deck's look. Terms follow
// the executive report: «نسبة التوائم», «الاشتباه الفائت», «الاشتباه الخاطئ».

import { buildDeckV3Html } from "../executive/deck3/index";
import {
  chartTitleRow,
  contentHead,
  coverSlide,
  dataTable,
  glossarySlide,
  legendRow,
  observationCard,
  orgBlockHtml,
  sectionDivider,
  slideShell,
  tintedPanel,
} from "../executive/deck3/slideKit";
import type { OrgBlock, SlideMeta, TableCell } from "../executive/deck3/slideKit";
import { barChart, groupedBarChart } from "../executive/deck3/chartKit";
import type { ChartTone } from "../executive/deck3/chartKit";
import { esc, fmtNum } from "../executive/primitives";
import { ORGANIZATION_PATH, ZATCA_LOGO_URL } from "../../../branding/organization";
import type { AccuracyTier, OutcomeStats, PortReportModel, ScopeSummary } from "./portReportModel";
import { employeeMinStudied } from "./portReportModel";
import { TIER_LOGIC, workloadAppendixSlide, workloadSlides } from "./portWorkloadSlides";
import { buildPortObservations } from "./portObservations";
import type { WorkloadSlideInput } from "./portWorkloadSlides";

const ORG_NAME = "هيئة الزكاة والضريبة والجمارك";
const DEPARTMENT = ORGANIZATION_PATH[1];
const EMPLOYEE_ROWS_PER_PAGE = 12;
/** One body-row height for every ordinary table, so tables never differ in size page to page. */
const ROW_PX = 56;
/** Ports with fewer studied images are left out of the accuracy ranking. */
const RANKING_MIN_STUDIED = 100;

const S1 = "القسم الأول - مجتمع الحالات الواردة";
const S2 = "القسم الثاني - نتائج الدراسة";
const S3 = "القسم الثالث - أداء الموظفين";

const AGREEMENT = "نسبة التوائم";
const AGREEMENT_DEFINITION = "الحالات التي تم الاتفاق على نتيجتها بين الوسائل الآلية وأخصائي ضمان جودة الأشعة، من إجمالي الحالات المدروسة.";
const MISSED_DEFINITION = "نتيجة أخصائي الوسائل الآلية بأن الإرسالية سليمة، ورأى أخصائي ضمان جودة الأشعة أنها اشتباه.";
const FALSE_DEFINITION = "نتيجة أخصائي الوسائل الآلية بأن الإرسالية اشتباه، ورأى أخصائي ضمان جودة الأشعة أنها سليمة.";
/** A thin black rule between side-by-side blocks (the owner's «خط أسود»). */
const RULE = "border-inline-start:3px solid var(--v3-navy);padding-inline-start:32px;";

/** 0–1 → "82.9%" */
const pct = (v: number | null, digits = 1): string => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);
/** Every percent chart starts at 0 (chart review); 110 leaves room for the value label above a 100% bar. */
const PCT_AXIS = { min: 0, max: 110 };
/** 0–1 → 0–100 for deck3's percent-scaled charts. */
const p100 = (v: number | null): number | null => (v === null ? null : v * 100);

/** The outcome columns every results table shares, in the owner's order. */
// «اشتباه صحيح» and «سليمة صحيحة» are left out (owner, 2026-11-08). Each error count carries its share of
// the studied images, so the missed share + the false share + نسبة التوائم add up to 100%.
const OUTCOME_HEADERS = ["المدروسة", "الاشتباه الفائت", "الاشتباه الخاطئ", AGREEMENT];
const withShare = (n: number, of: number) => `${fmtNum(n)} <span class="v3-sub" style="font-size:16px;color:var(--v3-muted)">(${pct(rate(n, of))})</span>`;
function outcomeCells(label: string, o: OutcomeStats): TableCell[] {
  return [
    { html: esc(label) },
    { html: fmtNum(o.studied), cls: "v-navy" },
    { html: withShare(o.missed, o.studied), cls: "v-red" },
    { html: withShare(o.falseSuspicion, o.studied), cls: "v-gold" },
    { html: pct(o.accuracy), cls: "v-navy" },
  ];
}

/** «المنافذ البرية» → land tint, «المنافذ البحرية» → sea tint, the rest neutral. */
function variantOf(group: string): "land" | "sea" | "all" {
  if (group.includes("البرية") || group.includes("بري")) return "land";
  if (group.includes("البحرية") || group === "منفذ بحري") return "sea";
  return "all";
}

/** Port types in reading order: land, sea, then the rest (e.g. «منفذ جدة»). */
function byTypeOrder(groups: readonly ScopeSummary[]): ScopeSummary[] {
  const rank = (g: ScopeSummary) => ({ land: 0, sea: 1, all: 2 })[variantOf(g.label)];
  return [...groups].sort((x, y) => rank(x) - rank(y));
}

/** Label/value pairs on one line each: wide label column, value at the far (left) end. */
function kvTable(rows: Array<{ label: string; value: string; cls?: string }>): string {
  return `<table class="v3-table" style="--row-h:${ROW_PX}px"><colgroup><col style="width:66%"/><col/></colgroup><tbody>${rows
    .map((r) => `<tr><td style="white-space:nowrap">${esc(r.label)}</td><td class="${r.cls ?? "v-navy"}" style="text-align:left;font-size:24px;white-space:nowrap">${esc(r.value)}</td></tr>`)
    .join("")}</tbody></table>`;
}

/** A big-figure stat column (deck3's population-page stat stack). */
function statStack(items: Array<{ label: string; value: string; tone?: string }>): string {
  return `<div class="v3-pop-stats" style="align-self:stretch">${items
    .map((i) => `<div class="v3-pop-stat"><span>${esc(i.label)}</span><b${i.tone ? ` class="v3-ink-${i.tone}"` : ""}>${esc(i.value)}</b></div>`)
    .join("")}</div>`;
}

/** Page footers are written before the slide count is known; this token is swapped for it afterwards. */
const TOTAL_TOKEN = -1;
const NUM_BASE = 900000;
const W1 = "أثر العبء التشغيلي على المنفذ";

export function buildPortReportSlides(m: PortReportModel, workload?: WorkloadSlideInput): string {
  const footText = `تقرير أعمال ${m.displayName} · ${m.periodLabel}`;
  // Employees below the tiering threshold are left out of the list too, as on the tiers page.
  const MIN_TIER_SAMPLE = employeeMinStudied(m.employees);
  const staff = m.employees.filter((e) => e.studied >= MIN_TIER_SAMPLE);
  const excluded = m.employees.filter((e) => e.studied < MIN_TIER_SAMPLE);
  const pagesOf = (n: number) => Math.max(1, Math.ceil(n / EMPLOYEE_ROWS_PER_PAGE));
  const total = TOTAL_TOKEN;
  let n = 1;
  const meta = (key: string, label: string): SlideMeta => ({ num: NUM_BASE + n++, total, sectionKey: key, sectionLabel: label, footText });
  const org: OrgBlock = { logoUrl: ZATCA_LOGO_URL, orgName: ORG_NAME, lines: [`قطاع ${ORGANIZATION_PATH[0]}`, DEPARTMENT] };
  const s = m.selected;
  const a = m.allPorts;
  // Slides go into named buckets and are assembled in the order of the mode below; page numbers are
  // placeholders (NUM_BASE + creation order) until then, renumbered in display order at the end.
  const B: Record<string, string[]> = {};
  const b = (key: string): string[] => (B[key] ??= []);
  // With workload data the report has three main sections, and the earlier sections become appendices أ–د.
  const A1 = workload ? "ملحق أ - مجتمع الحالات الواردة والعينة المدروسة" : S1;
  const A2 = workload ? "ملحق ب - نتائج الدراسة" : S2;
  const A3 = workload ? `ملحق ج - معدل دقة موظفي ${m.displayName}` : S3;
  const SEC3 = workload ? S2 : S3;

  // 1 — Cover
  b("cover").push(
    coverSlide({
      org,
      kicker: "تقرير ضمان جودة فحص الأشعة",
      title: `تقرير أعمال ${m.displayName}`,
      periodLabel: "فترة التقرير",
      periodValue: m.periodLabel,
      metaRows: [
        { label: "المنفذ", value: m.port },
        { label: "الإدارة", value: DEPARTMENT },
        { label: "القسم", value: ORGANIZATION_PATH[2] },
        { label: "التصنيف", value: "سري", end: true },
      ],
      meta: meta("cover", "الغلاف"),
    }),
  );

  // Main body (when the workbook carries row-level population with employee codes):
  // the four workload slides. Everything after them is the appendix.
  if (workload) {
    b("wl").push(...workloadSlides(workload, meta));
    b("obs").push(...observationSlides(m, workload, meta));
    b("appDiv").push(sectionDivider({ eyebrow: footText, ghost: "+", kicker: "الملاحق", title: "الملاحق", description: "", footItems: [], meta: meta("appendix", "الملاحق") }));
  }

  // 2 — Glossary (same wording as the executive report)
  b("gloss").push(
    glossarySlide({
      eyebrow: "المعجم",
      title: "المصطلحات الرئيسية",
      groups: [
        {
          dotTone: "gold",
          title: "مصطلحات المجتمع والدراسة",
          terms: [
            { term: "مجتمع الحالات الواردة", definition: `جميع صور الأشعة الواردة خلال فترة التقرير، موزعة حسب نوع المنفذ (البرية، البحرية، ${m.displayName}).` },
            { term: "الحالات المدروسة", definition: "الصور التي اكتمل فحصها من قبل أخصائي ضمان جودة الأشعة وتشملها أرقام النتائج." },
            { term: AGREEMENT, definition: AGREEMENT_DEFINITION },
          ],
        },
        {
          dotTone: "red",
          title: "مصطلحات النتائج",
          terms: [
            { term: "الاشتباه الفائت", definition: MISSED_DEFINITION },
            { term: "الاشتباه الخاطئ", definition: FALSE_DEFINITION },
          ],
        },
      ],
      meta: meta("glossary", "المعجم"),
    }),
  );
  if (workload) {
    b("gloss").push(
      glossarySlide({
        eyebrow: "المعجم",
        title: "مصطلحات العبء التشغيلي",
        groups: [
          {
            dotTone: "blue",
            title: "العبء والقوة العاملة",
            terms: [
              { term: "الموظف المخصص للمنفذ", definition: "كل من فحص حالة واحدة على الأقل في المنفذ. الإجمالي: عددهم دون تكرار؛ والمتوسط: عددهم في كل شهر." },
              { term: "متوسط عدد الحالات المفحوصة للموظف الواحد", definition: "حالات المنفذ في الشهر ÷ موظفيه، مع جمع حالات من فحص أقل من عُشر المتوسط واحتسابهم موظفين مكافئين." },
              { term: "متوسط الحالات للموظف في الشهر حسب المستوى", definition: "حالات المستوى الأول ÷ موظفي المستوى الأول المخصصين في الشهر، وكذلك المستوى الثاني، بنفس قاعدة الموظف المخصص." },
              { term: "مستوى العبء التشغيلي", definition: TIER_LOGIC },
              { term: "مستوى الدقة", definition: "جميع الموظفين المدروسة حالاتهم (10% من متوسط الحالات المدروسة للموظف فأكثر) في ثلاث فئات متساوية المدى بين أقل نسبة توائم وأعلاها: منخفضة ومتوسطة وعالية." },
            ],
          },
        ],
        meta: meta("glossary", "المعجم"),
      }),
    );
    b("wlApp").push(workloadAppendixSlide(workload, meta));
  }

  // 4 — Section 1 divider
  b("div1").push(
    sectionDivider({ eyebrow: footText, ghost: "01", kicker: workload ? "ملحق أ" : "القسم الأول", title: "مجتمع الحالات الواردة والعينة المدروسة", description: "", footItems: [], meta: meta("s1", A1) }),
  );

  // 5 — Population by port type: land | sea tables, then the selected port as its own figures block.
  // With row-level workload data the main slides already show every port's images, and that
  // source carries no reliable suspicion split, so this page is left out.
  if (!workload) {
    const multi = byTypeOrder(m.groups).filter((g) => g.population > 0 && g.label !== m.group);
    const portTable = (g: ScopeSummary): string => {
      const ports = m.ports.filter((p) => p.group === g.label && p.population > 0).sort((x, y) => y.population - x.population);
      return tintedPanel({
        variant: variantOf(g.label),
        title: g.label,
        note: `${pct(rate(g.population, a.population))} من الإجمالي`,
        body: dataTable({
          headers: ["المنفذ", "الصور", "اشتباه", "النسبة"],
          rows: ports.map((p) => [
            { html: esc(p.label) },
            { html: fmtNum(p.population), cls: "v-navy" },
            { html: fmtNum(p.populationSuspicion), cls: "v-red" },
            { html: pct(rate(p.populationSuspicion, p.population)), cls: "v-red" },
          ]),
          totals: [{ html: "الإجمالي" }, { html: fmtNum(g.population), cls: "v-navy" }, { html: fmtNum(g.populationSuspicion), cls: "v-red" }, { html: pct(rate(g.populationSuspicion, g.population)), cls: "v-red" }],
          firstColWidth: 36,
          compactHeaders: true,
          rowPx: 30,
        }),
      });
    };
    const blocks = multi.map((g) => `<div style="${RULE}min-width:0;display:flex">${portTable(g).replace(/class="v3-panel (land|sea|all)"/, (c) => `${c} style="flex:1;min-height:0"`).replace('<table class="v3-table', '<table style="flex:1" class="pr-pop v3-table').replace('<thead>', '<colgroup><col style="width:46%"/><col/><col/><col/></colgroup><thead>')}</div>`).join("");
    // The selected port in the same panel frame as land/sea, so tops and bottoms line up.
    const own = `<div style="min-width:0;display:flex">${tintedPanel({
      variant: "all",
      title: m.displayName,
      body: statStack([
        { label: "إجمالي الصور", value: fmtNum(s.population) },
        { label: "سليمة", value: fmtNum(s.population - s.populationSuspicion), tone: "green" },
        { label: "اشتباه", value: fmtNum(s.populationSuspicion), tone: "red" },
        { label: "نسبة الاشتباه", value: pct(rate(s.populationSuspicion, s.population)), tone: "gold" },
      ]),
    }).replace('class="v3-panel all"', 'class="v3-panel all" style="flex:1;white-space:nowrap"')}</div>`;
    b("pop").push(
      slideShell(
        meta("s1", A1),
        "",
        `${contentHead({ eyebrow: A1, title: "مجتمع الحالات الواردة حسب نوع المنفذ", note: `جميع المنافذ ${fmtNum(a.population)} صورة · نسبة الاشتباه ${pct(rate(a.populationSuspicion, a.population))}` })}
<div class="v3-two-col" style="grid-template-columns:400px ${multi.map(() => "1fr").join(" ")};gap:32px;align-items:stretch;grid-template-rows:minmax(0,1fr);flex:none;height:740px">${own}${blocks}</div>`,
      ),
    );
  }

  // 6 — Population and studied sample per year: chart on top, compact table beneath.
  // When the source has no yearly population, the pair is shown for the whole period only.
  {
    const yearly = m.years.some((y) => y.population !== null);
    const axisMax = Math.max(1, yearly ? 0 : s.population, ...m.years.map((y) => Math.max(y.population ?? 0, y.studied)));
    // Chart review: on one axis the sample (2,166 of 43,207 in 2024) drew as a sliver next to the
    // population. With yearly figures, population and sample are two charts, each on its own zero-based axis.
    const yearChart = (title: string, values: Array<number | null>, tone: ChartTone): string => {
      const max = Math.max(1, ...values.map((v) => v ?? 0));
      return `<div class="v3-chart-col">${chartTitleRow({ title })}${barChart({ bars: m.years.map((y, i) => ({ label: String(y.year), value: values[i], tone })), min: 0, max: max * 1.2, plotHeight: 300, barMaxWidth: 110, valueFormat: (v) => fmtNum(Math.round(v)) })}</div>`;
    };
    const chart = yearly
      ? `<div class="v3-two-col" style="gap:0;flex:none"><div style="padding-inline-end:28px">${yearChart("المجتمع", m.years.map((y) => y.population || null), "gold")}</div><div style="${RULE}">${yearChart("العينة المدروسة", m.years.map((y) => y.studied || null), "blue")}</div></div>`
      : groupedBarChart({
      groups: yearly
        ? m.years.map((y) => ({ label: String(y.year), a: { label: "", value: y.population || null }, b: { label: "", value: y.studied || null } }))
        : [
            { label: "إجمالي الفترة", a: { label: "", value: s.population }, b: { label: "", value: s.image.studied } },
            ...m.years.map((y) => ({ label: String(y.year), a: { label: "", value: null }, b: { label: "", value: y.studied } })),
          ],
      min: 0,
      max: axisMax * 1.25,
      plotHeight: 300,
      barMaxWidth: 130,
      groupWidthPct: 20,
      toneA: "gold",
      toneB: "blue",
      valueFormat: (v) => fmtNum(Math.round(v)),
    });
    b("pop").push(
      slideShell(
        meta("s1", A1),
        "",
        `${contentHead({ eyebrow: A1, title: `المجتمع والعينة المدروسة في ${m.displayName}`, note: `العينة ${pct(rate(s.image.studied, s.population))} من المجتمع` })}
${yearly ? `<p class="v3-note" style="margin:0 0 10px;font-size:20px">حسب سنة دخول الصورة (المجتمع) وسنة التقاطها (العينة). لكل رسم مقياسه الخاص، ويبدأ كلاهما من الصفر.</p>` : legendRow([{ swatch: "gold", text: "المجتمع" }, { swatch: "blue", text: "العينة المدروسة" }], "المجتمع غير مقسَّم حسب السنة في ملف البيانات")}
${chart}
<div style="margin-top:22px">${
  yearly
    ? dataTable({
        headers: ["السنة", "المجتمع", "العينة المدروسة", "نسبة العينة", ...OUTCOME_HEADERS.slice(1)],
        rows: m.years.map((y) => [
          { html: String(y.year) },
          { html: y.population ? fmtNum(y.population) : "—", cls: "v-gold" },
          ...outcomeCells("", y.image).slice(1, 2),
          { html: pct(rate(y.studied, y.population ?? 0)), cls: "v-muted" },
          ...outcomeCells("", y.image).slice(2),
        ]),
        totals: [
          { html: "الإجمالي" },
          { html: fmtNum(s.population), cls: "v-gold" },
          ...outcomeCells("", s.image).slice(1, 2),
          { html: pct(rate(s.image.studied, s.population)), cls: "v-muted" },
          ...outcomeCells("", s.image).slice(2),
        ],
        firstColWidth: 14,
        compactHeaders: true,
        rowPx: 46,
      })
    : dataTable({ headers: ["السنة", ...OUTCOME_HEADERS], rows: m.years.map((y) => outcomeCells(String(y.year), y.image)), totals: outcomeCells("الإجمالي", s.image), compactHeaders: true, rowPx: 46 })
}</div>`,
      ),
    );
  }

  // 8 — Section 2 divider
  b("div2").push(
    sectionDivider({ eyebrow: footText, ghost: "02", kicker: workload ? "ملحق ب" : "القسم الثاني", title: "نتائج الدراسة", description: "", footItems: [], meta: meta("s2", A2) }),
  );

  // 8 — Outcomes by port type: نسبة التوائم chart on one half, the table on the other
  {
    const types = byTypeOrder(m.groups);
    const chart = barChart({
      bars: [...types.map((g) => ({ label: g.label, value: p100(g.image.accuracy), tone: (g.label === m.group ? "gold" : "navy") as ChartTone })), { label: "جميع المنافذ", value: p100(a.image.accuracy), tone: "blue" as ChartTone }],
      ...PCT_AXIS,
      barMaxWidth: 120,
      plotHeight: 560,
    });
    const row = (label: string, o: OutcomeStats, strong = false): TableCell[] => [
      { html: strong ? `<b>${esc(label)}</b>` : esc(label) },
      { html: fmtNum(o.studied), cls: "v-navy" },
      { html: pct(o.accuracy), cls: "v-navy" },
      { html: withShare(o.missed, o.studied), cls: "v-red" },
      { html: withShare(o.falseSuspicion, o.studied), cls: "v-gold" },
    ];
    b("results").push(
      slideShell(
        meta("s2", A2),
        "",
        `${contentHead({ eyebrow: A2, title: `نتائج دراسة صور ${m.displayName}` })}
<div class="v3-two-col" style="grid-template-columns:1fr 1.25fr;gap:56px">
  <div class="v3-chart-col">${chartTitleRow({ title: `${AGREEMENT} حسب نوع المنفذ` })}${chart}</div>
  <div style="${RULE}display:flex;flex-direction:column">${chartTitleRow({ title: "التفصيل حسب نوع المنفذ" })}<div style="height:560px;display:flex">${dataTable({
    headers: ["نوع المنفذ", "المدروسة", AGREEMENT, "الاشتباه الفائت", "الاشتباه الخاطئ"],
    rows: types.map((g) => row(g.label, g.image, g.label === m.group)),
    totals: row("جميع المنافذ", a.image),
    groupStart: 3,
    firstColWidth: 26,
    compactHeaders: true,
    rowPx: 125,
  }).replace('<table class="v3-table', '<table style="height:100%" class="v3-table')}</div></div>
</div>`,
      ),
    );
  }

  // 10 — Agreement ranking vs all ports (lowest on the right, rising leftward)
  {
    const ranked = m.ports
      .filter((p) => p.image.studied >= RANKING_MIN_STUDIED || p.label === m.port)
      .sort((x, y) => (x.image.accuracy ?? 0) - (y.image.accuracy ?? 0));
    const pos = [...ranked].reverse().findIndex((p) => p.label === m.port) + 1;
    const chart = barChart({
      // The selected port under its display name (the data spells it «ميناء جده الاسلامي»).
      bars: ranked.map((p) => ({ label: p.label === m.port ? m.displayName : p.label, value: p100(p.image.accuracy), tone: p.label === m.port ? "gold" : "navy" })),
      ...PCT_AXIS,
      barMaxWidth: 60,
      references: a.image.accuracy === null ? [] : [{ value: a.image.accuracy * 100, tone: "gold-dark" }],
    });
    b("ranking").push(
      slideShell(
        meta("s2", A2),
        "",
        `${contentHead({ eyebrow: A2, title: `${AGREEMENT}: ${m.displayName} مقابل جميع المنافذ`, note: `المرتبة ${pos} من ${ranked.length} منفذًا` })}
<div class="v3-single-chart">${legendRow([{ swatch: "gold", text: m.displayName }, { dash: "gold", text: `${AGREEMENT} لجميع المنافذ ${pct(a.image.accuracy)}` }], `المنافذ التي دُرس منها ${RANKING_MIN_STUDIED} صورة فأكثر`)}${chart}</div>`,
      ),
    );
  }

  // 10b — Timeline: monthly نسبة التوائم for the selected port vs the other port types
  b("timeline").push(slideShell(meta("s2", A2), "", timelineInner(m, A2)));

  // 11 — Level 1 and level 2 results, one panel per scope
  {
    const levelTable = (sc: ScopeSummary): string =>
      dataTable({
        headers: ["البند", "المستوى الأول", "المستوى الثاني"],
        rows: [
          [{ html: "الحالات المدروسة" }, { html: fmtNum(sc.l1.studied), cls: "v-navy" }, { html: fmtNum(sc.l2.studied), cls: "v-navy" }],
          [{ html: "الاشتباه الفائت" }, { html: fmtNum(sc.l1.missed), cls: "v-red" }, { html: fmtNum(sc.l2.missed), cls: "v-red" }],
          [{ html: "الاشتباه الخاطئ" }, { html: fmtNum(sc.l1.falseSuspicion), cls: "v-gold" }, { html: fmtNum(sc.l2.falseSuspicion), cls: "v-gold" }],
        ],
        totals: [{ html: AGREEMENT }, { html: pct(sc.l1.accuracy), cls: "v-navy" }, { html: pct(sc.l2.accuracy), cls: "v-navy" }],
        firstColWidth: 36,
        compactHeaders: true,
        rowPx: 70,
      });
    b("levels").push(
      slideShell(
        meta("s2", A2),
        "", // printed like every other page, so the PDF page numbers match the footers
        `${contentHead({ eyebrow: A2, title: "نتائج المستوى الأول والمستوى الثاني" })}
<div class="v3-two-col">
  ${tintedPanel({ variant: variantOf(m.group), title: m.displayName, body: levelTable(s) })}
  ${tintedPanel({ variant: "all", title: "جميع المنافذ", body: levelTable(a) })}
</div>`,
      ),
    );
  }

  // 12 — Section 3 divider
  b("div3").push(
    sectionDivider({ eyebrow: footText, ghost: "03", kicker: workload ? "ملحق ج" : "القسم الثالث", title: `معدل دقة موظفي ${m.displayName}`, description: "", footItems: [], meta: meta("s3", S3) }),
  );

  // 13 — Accuracy tiers: three separate sections, each with its own chart and table
  b("tiers").push(slideShell(meta("s3", SEC3), "", tiersInner(m, SEC3)));

  // Staff performance vs the land and sea ports, by level. The source carries
  // employee codes only for some port types, so the comparison is made on the
  // level results themselves (available for every port), not per employee.
  {
    const groups = byTypeOrder(m.groups);
    const chart = groupedBarChart({
      groups: groups.map((g) => ({ label: g.label, a: { label: "", value: p100(g.l1.accuracy) }, b: { label: "", value: p100(g.l2.accuracy) } })),
      ...PCT_AXIS,
      plotHeight: 250,
      groupWidthPct: 26,
    });
    // Each error count with its share of that level's studied answers beneath it.
    const share = (n: number, of: number) => `${fmtNum(n)}<br><span class="v3-sub" style="font-size:15px;color:var(--v3-muted)">(${pct(of ? n / of : null)})</span>`;
    const rows: TableCell[][] = groups.map((g) => [
      { html: g.label === m.group ? `<b>${esc(g.label)}</b>` : g.label === "منفذ بحري" ? `منفذ بحري <span class="v3-sub">(دون ${esc(m.displayName)})</span>` : esc(g.label) },
      { html: fmtNum(g.l1.studied), cls: "v-navy" },
      { html: pct(g.l1.accuracy), cls: "v-gold" },
      { html: share(g.l1.missed, g.l1.studied), cls: "v-red" },
      { html: share(g.l1.falseSuspicion, g.l1.studied), cls: "v-gold" },
      { html: fmtNum(g.l2.studied), cls: "v-navy" },
      { html: pct(g.l2.accuracy), cls: "v-navy" },
      { html: share(g.l2.missed, g.l2.studied), cls: "v-red" },
      { html: share(g.l2.falseSuspicion, g.l2.studied), cls: "v-gold" },
    ]);
        b("staffVs").push(
      slideShell(
        meta("s3", SEC3),
        "",
        `${contentHead({ eyebrow: SEC3, title: `أداء منسوبي ${m.displayName} مقارنة بالمنافذ البرية والبحرية` })}
${legendRow([{ swatch: "gold", text: `${AGREEMENT} - المستوى الأول` }, { swatch: "blue", text: `${AGREEMENT} - المستوى الثاني` }])}
${chart}
<div style="margin-top:22px">${dataTable({ topHeader: [{ label: "", span: 1 }, { label: "المستوى الأول", span: 4, group: true }, { label: "المستوى الثاني", span: 4, group: true }], headers: ["نوع المنفذ", "الإجابات", AGREEMENT, "عدد الاشتباهات الفائتة", "عدد الاشتباهات الخاطئة", "الإجابات", AGREEMENT, "عدد الاشتباهات الفائتة", "عدد الاشتباهات الخاطئة"], rows, groupStart: [1, 5], compactHeaders: true, rowPx: 56 })}</div>
<p class="v3-note" style="margin-top:8px;font-size:21px">المقارنة على مستوى إجابات كل مستوى على حدة. «منفذ بحري» هنا المنافذ البحرية دون ${esc(m.displayName)}.</p>`,
      ),
    );
  }

  // 14.. — Employee table, highest نسبة التوائم first
  const employeeTables = (out: string[], list: typeof staff, key: string, label: string, title: string, note: string): void => {
    const pages = pagesOf(list.length);
    for (let p = 0; p < pages; p++) {
      const rows: TableCell[][] = list.slice(p * EMPLOYEE_ROWS_PER_PAGE, (p + 1) * EMPLOYEE_ROWS_PER_PAGE).map((e) => [
        { html: `${esc(e.name || "—")} <span class="v3-sub">${esc(e.code)}</span>` },
        { html: fmtNum(e.l1Studied), cls: "v-gold" },
        { html: fmtNum(e.l1Matched), cls: "v-gold" },
        { html: fmtNum(e.l2Studied), cls: "v-navy" },
        { html: fmtNum(e.l2Matched), cls: "v-navy" },
        { html: fmtNum(e.studied), cls: "v-navy" },
        { html: fmtNum(e.matched), cls: "v-navy" },
        { html: fmtNum(e.missed), cls: "v-red" },
        { html: fmtNum(e.falseSuspicion), cls: "v-gold" },
        { html: pct(e.accuracy), cls: "v-green" },
      ]);
      out.push(
        slideShell(
          meta(key, label),
          "",
          `${contentHead({ eyebrow: label, title })}
<div class="v3-two-col" style="grid-template-columns:1fr">
${tintedPanel({
  variant: "all",
  title: `${fmtNum(list.length)} موظفًا · ${note}`,
  note: pages > 1 ? `${p + 1} / ${pages}` : undefined,
  body: dataTable({
    headers: ["الموظف", "مدروسة الأول", "متوافقة الأول", "مدروسة الثاني", "متوافقة الثاني", "إجمالي المدروسة", "إجمالي المتوافقة", "الاشتباه الفائت", "الاشتباه الخاطئ", AGREEMENT],
    groupStart: [1, 3, 5],
    rows,
    firstColWidth: 26,
    compactHeaders: true,
    rowPx: 44,
    // No clipped or wrapped names: the name column is widened from 26% to 31%.
  }).replace("<thead>", `<colgroup><col style="width:31%"/>${"<col/>".repeat(9)}</colgroup><thead>`),
})}
</div>
<p class="v3-note" style="margin-top:6px;font-size:20px">${AGREEMENT} للموظف = الإجابات المتوافقة ÷ الإجابات المدروسة في المستويين، والترتيب من الأعلى إلى الأدنى.</p>`,
        ),
      );
    }
  };
  employeeTables(b("emp"), staff, "s3", A3, workload ? `ملحق: منسوبو ${m.displayName}` : `منسوبي ${m.displayName}`, `في المستويين، تمت دراسة ${MIN_TIER_SAMPLE} حالة فأكثر لكل منهم (10% من متوسط الحالات المدروسة للموظف)`);

  // Appendix — employees below the threshold, listed so nobody silently disappears
  if (excluded.length) {
    b("div4").push(sectionDivider({ eyebrow: footText, ghost: "04", kicker: workload ? "ملحق د" : "الملحقات", title: `موظفون تمت دراسة أقل من ${MIN_TIER_SAMPLE} حالة لهم`, description: "", footItems: [], meta: meta("appendix", "الملحقات") }));
    employeeTables(b("empLow"), excluded, "appendix", workload ? `ملحق د - موظفون تمت دراسة أقل من ${MIN_TIER_SAMPLE} حالة لهم` : "الملحقات", `ملحق: منسوبي ${m.displayName} تمت دراسة أقل من ${MIN_TIER_SAMPLE} حالة لهم`, `في المستويين، تمت دراسة أقل من ${MIN_TIER_SAMPLE} حالة لكل منهم (مستبعدون من مستويات الدقة)`);
  }

  // Closing: the authority's mark and the department only.
  b("closing").push(
    slideShell(
      { ...meta("closing", "الختام"), hideFoot: true },
      "v3-closing",
      `<div style="flex:1;display:flex;align-items:center;justify-content:center">${orgBlockHtml({ ...org, lines: [DEPARTMENT] })}</div>`,
    ),
  );
  if (workload) {
    b("div1w").push(sectionDivider({ eyebrow: footText, ghost: "01", kicker: "القسم الأول", title: W1, description: "", footItems: [], meta: meta("w", W1) }));
    b("div2w").push(sectionDivider({ eyebrow: footText, ghost: "02", kicker: "القسم الثاني", title: "نتائج الدراسة", description: "", footItems: [], meta: meta("s2", S2) }));
    b("counts").push(slideShell(meta("s2", S2), "", countsTimelineInner(m, workload)));
    b("popMonthly").push(slideShell(meta("w", W1), "", populationTimelineInner(m, workload, `القسم الأول - ${W1}`)));
    b("div3w").push(sectionDivider({ eyebrow: footText, ghost: "03", kicker: "القسم الثالث", title: "التوصيات", description: "", footItems: [], meta: meta("obs", OBS) }));
  }
  const wl = (key: string) => (B.wl ?? []).filter((x) => x.includes(`data-section="${key}"`));
  // With workload data: three main sections (العبء التشغيلي، نتائج الدراسة، التوصيات), then the appendices.
  // The year-on-year tier comparison sits in ملحق ب; «أداء المنفذ مقارنة بمستويات العبء» (w4) is left out.
  const order: string[][] = workload
    ? [b("cover"), b("div1w"), b("popMonthly"), wl("w1"), wl("w2"), b("div2w"), b("counts"), b("staffVs"), wl("w3"), b("tiers"), b("div3w"), b("obs"), b("appDiv"), b("gloss"), b("wlApp"),
       b("div1"), b("pop"), b("div2"), wl("w5"), b("results"), b("ranking"), b("timeline"), b("levels"), b("div3"), b("emp"), b("div4"), b("empLow"), b("closing")]
    : [b("cover"), b("gloss"), b("div1"), b("pop"), b("div2"), b("results"), b("ranking"), b("timeline"), b("levels"), b("div3"), b("tiers"), b("staffVs"), b("emp"), b("div4"), b("empLow"), b("closing")];
  const html = order.flat().join("\n");
  // Renumber: each placeholder becomes its slide's position in display order.
  const pos = new Map<string, number>();
  for (const mm of html.matchAll(/id="v3-slide-(9\d{5})"/g)) if (!pos.has(mm[1])) pos.set(mm[1], pos.size + 1);
  return html
    .replace(/id="v3-slide-(9\d{5})"/g, (_x, p: string) => `id="v3-slide-${pos.get(p) ?? p}"`)
    .replace(/v3-page-num">(9\d{5}) \//g, (_x, p: string) => `v3-page-num">${String(pos.get(p) ?? p).padStart(2, "0")} /`);
}

const OBS = "الملاحظات والتوصيات";

/**
 * «الملاحظات والتوصيات», one observation per page in the executive report's frame (deck3 observationCard):
 * الملاحظة الرئيسية | الشواهد الجوهرية | التوصية. Each is built by rule from the figures (portObservations.ts).
 */
function observationSlides(m: PortReportModel, w: WorkloadSlideInput, meta: (key: string, label: string) => SlideMeta): string[] {
  const cards = buildPortObservations(m, w).map((o) => ({
    topic: o.topic,
    card: {
      tone: (o.priority === "عالية" ? "red" : "gold") as "red" | "gold",
      title: o.title,
      evidence: o.evidence.map((text) => ({ text, figures: [] })),
      recommendations: o.recommendations,
    },
  }));
  // One type size on every observation page and in every panel (the owner saw the sizes jump between pages and
  // between the main observation and its evidence): the dense scale is never switched on here, and the
  // .pr-obs-even rule below sets one size for all three panels.
  return cards.map(({ topic, card }, i) =>
    slideShell(
      meta("obs", OBS),
      "",
      `${contentHead({ eyebrow: OBS, title: `الملاحظة ${String(i + 1).padStart(2, "0")} - ${topic}` })}
${observationCard(card, false).replace('class="v3-obs-card', 'class="v3-obs-card pr-obs-even')}
${legendRow([{ swatch: "red", text: "أولوية عالية" }, { swatch: "gold", text: "أولوية متوسطة" }], "لون الملاحظة الرئيسية")}`,
    ),
  );
}

export { buildPortObservations };

/** Line colours per port type; the selected port is always gold and drawn on top. */
const LINE_COLOR = { selected: "var(--v3-gold)", land: "var(--v3-green)", sea: "var(--v3-blue)", all: "var(--v3-navy)" } as const;

/**
 * Monthly نسبة التوائم as an inline-SVG line chart. The x axis runs oldest →
 * newest left to right with the month number under each point and the year
 * centred under its months; one line per port type plus all ports (dashed).
 */
function timelineInner(m: PortReportModel, eyebrow = S2): string {
  // Months where no line has enough studied images (e.g. a trailing partial month) are left off the axis.
  const months = m.monthly.filter((x) => x.selected !== null || x.all !== null);
  const head = contentHead({ eyebrow, title: `الخط الزمني لنسبة التوائم في ${m.displayName}`, note: "حسب شهر دخول الصورة" });
  if (months.length < 2) return `${head}<p class="v3-note">لا توجد أشهر كافية لرسم الخط الزمني.</p>`;
  const types = byTypeOrder(m.groups);
  const series = [
    ...types.filter((g) => g.label !== m.group).map((g) => ({ label: g.label, color: LINE_COLOR[variantOf(g.label) === "sea" ? "sea" : "land"], dash: "", width: 3, values: months.map((x) => x.byGroup[g.label] ?? null), avg: g.image.accuracy })),
    { label: "جميع المنافذ", color: LINE_COLOR.all, dash: "8 6", width: 3, values: months.map((x) => x.all), avg: m.allPorts.image.accuracy },
    { label: m.displayName, color: LINE_COLOR.selected, dash: "", width: 6, values: months.map((x) => x.selected), avg: m.selected.image.accuracy },
  ];
  const W = 1760, H = 560, padL = 40, padR = 170, padT = 44, padB = 90;
  const all = series.flatMap((x) => x.values).filter((v): v is number => v !== null);
  // Chart review: the % axis starts at 0 (it started at 30%).
  const lo = 0;
  void all;
  const hi = 105;
  // RTL timeline: the oldest month on the right, the newest on the left; the % axis sits on the right.
  const x = (i: number) => W - padR - ((W - padL - padR) * i) / (months.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v * 100 - lo) / (hi - lo));
  const grid = [];
  for (let g = lo; g <= 100; g += 10) {
    grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(g / 100).toFixed(1)}" y2="${y(g / 100).toFixed(1)}" stroke="var(--v3-hair)" stroke-width="1"/><text x="${W - padR + 78}" y="${(y(g / 100) + 7).toFixed(1)}" text-anchor="start" font-size="20" fill="var(--v3-muted)">${g}%</text>`);
  }
  // Period-average reference lines: all ports behind (navy, dotted), the selected port in gold.
  const avgLine = (v: number | null, color: string, dash: string) =>
    v === null
      ? ""
      : `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  // Their values are named in the strip above the chart, where they cannot collide with the chips.
  grid.push(avgLine(m.allPorts.image.accuracy, LINE_COLOR.all, "2 6"));
  grid.push(avgLine(m.selected.image.accuracy, LINE_COLOR.selected, "12 6"));
  // Value chips: the selected port's figure under each of its points, all ports' figure above its point,
  // each on a background in its line colour so they stay readable where lines cross.
  const chip = (cx: number, cy: number, v: number, color: string) =>
    `<rect x="${(cx - 30).toFixed(1)}" y="${(cy - 13).toFixed(1)}" width="60" height="26" rx="5" fill="${color}"/><text x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--v3-bg)">${(v * 100).toFixed(0)}%</text>`;
  const sel = series[series.length - 1].values;
  const allV = months.map((mo) => mo.all);
  const chips =
    allV.map((v, i) => (v === null ? "" : chip(x(i), y(v) - 24, v, LINE_COLOR.all))).join("") +
    sel.map((v, i) => (v === null ? "" : chip(x(i), y(v) + 26, v, LINE_COLOR.selected))).join("");
  const lines = series
    .map((ser) => {
      // Break the line at months with no studied images instead of bridging them.
      const segs: string[] = [];
      let cur: string[] = [];
      ser.values.forEach((v, i) => {
        if (v === null) { if (cur.length) segs.push(cur.join(" ")); cur = []; return; }
        cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      });
      if (cur.length) segs.push(cur.join(" "));
      const dots = ser.label === m.displayName ? ser.values.map((v, i) => (v === null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6" fill="${ser.color}"/>`)).join("") : "";
      return segs.map((d) => `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.width}" stroke-dasharray="${ser.dash}" stroke-linejoin="round" stroke-linecap="round"/>`).join("") + dots;
    })
    .join("");
  // Month numbers under every point; the year centred under its months, with a rule between years.
  const monthLabels = months.map((mo, i) => `<text x="${x(i).toFixed(1)}" y="${H - padB + 30}" text-anchor="middle" font-size="19" fill="var(--v3-muted)">${Number(mo.monthKey.slice(5))}</text>`).join("");
  const years: Array<{ year: string; from: number; to: number }> = [];
  months.forEach((mo, i) => {
    const yr = mo.monthKey.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === yr) last.to = i;
    else years.push({ year: yr, from: i, to: i });
  });
  const yearLabels = years
    .map((yr, k) => {
      const mid = (x(yr.from) + x(yr.to)) / 2;
      const sep = k > 0 ? `<line x1="${((x(yr.from - 1) + x(yr.from)) / 2).toFixed(1)}" x2="${((x(yr.from - 1) + x(yr.from)) / 2).toFixed(1)}" y1="${padT - 30}" y2="${H - 10}" stroke="var(--v3-navy)" stroke-width="2"/>` : "";
      return `${sep}<text x="${mid.toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="24" font-weight="700" fill="var(--v3-navy)">${yr.year}</text>`;
    })
    .join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" dir="ltr" direction="ltr" role="img" aria-label="الخط الزمني لنسبة التوائم" style="display:block;background:var(--v3-panel)">${grid.join("")}${yearLabels}${lines}${chips}${monthLabels}</svg>`;
  // Legend doubles as the averages table: each line's نسبة التوائم over the whole period, and its lowest/highest month.
  const fmtMonth = (i: number) => `${Number(months[i].monthKey.slice(5))}/${months[i].monthKey.slice(0, 4)}`;
  const legend = series
    .slice()
    .reverse()
    .map((ser) => {
      const idx = ser.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null) as Array<readonly [number, number]>;
      const min = idx.reduce((a, b) => (b[0] < a[0] ? b : a), idx[0]);
      const max = idx.reduce((a, b) => (b[0] > a[0] ? b : a), idx[0]);
      return `<div style="display:flex;align-items:center;gap:12px;font-size:22px;white-space:nowrap"><span style="display:inline-block;width:34px;height:0;border-top:${ser.width}px ${ser.dash ? "dashed" : "solid"} ${ser.color}"></span><b style="color:var(--v3-navy)">${esc(ser.label)}</b><span style="color:var(--v3-muted)">المتوسط ${pct(ser.avg)} · الأدنى ${pct(min[0])} (${fmtMonth(min[1])}) · الأعلى ${pct(max[0])} (${fmtMonth(max[1])})</span></div>`;
    })
    .join("");
  return `${head}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 40px;margin-bottom:8px">${legend}</div>
<p class="v3-note" style="margin:0 0 10px;font-size:20px">الخطان الأفقيان المتقطعان: متوسط ${esc(m.displayName)} للفترة (${pct(m.selected.image.accuracy)}، ذهبي) ومتوسط جميع المنافذ (${pct(m.allPorts.image.accuracy)}، كحلي). أرقام ${esc(m.displayName)} تحت نقاطها، وأرقام جميع المنافذ فوق نقاطها.</p>
${svg}`;
}

const TIER_TONE: Record<AccuracyTier["key"], ChartTone> = { low: "red", mid: "gold", high: "green" };

/**
 * Monthly counts for the selected port, opening «نتائج الدراسة»: the studied images in the top band,
 * and the missed and false suspicions among them in the bottom band (owner, 2026-11-10: the received
 * images were replaced by the studied ones, the base of the error counts). The two bands share the RTL
 * month axis of the نسبة التوائم timeline, each on its own zero-based scale.
 */
type BandSeries = { label: string; color: string; band: "top" | "bottom"; values: (number | null)[]; chipDy: number; total: boolean; /** Values are percentages; the legend shows this summary instead of totals. */ percent?: string };
type BandTimeline = { eyebrow: string; title: string; aria: string; topTitle: string; botTitle: string; series: BandSeries[]; notes: string[] };

/** Monthly studied images (top band) with the missed and false suspicions among them (bottom band). */
function countsTimelineInner(m: PortReportModel, w: WorkloadSlideInput): string {
  const months = w.monthlyCounts ?? [];
  const share = (n: number, of: number) => (of ? (100 * n) / of : null);
  const totalOf = (k: "missed" | "falseSuspicion" | "studied") => months.reduce((a0, x0) => a0 + x0[k], 0);
  const notes: string[] = [];
  const firstMissed = months.findIndex((x0) => x0.missed > 0);
  if (firstMissed > 0) notes.push(`لا يوجد اشتباه فائت مسجل في نتائج الدراسة قبل ${Number(months[firstMissed].monthKey.slice(5))}/${months[firstMissed].monthKey.slice(0, 4)}.`);
  notes.push("الخط المتقطع لكل مؤشر: متوسطه الشهري.");
  notes.push("الحالات المدروسة: الصور التي درسها أخصائي ضمان جودة الأشعة في كل شهر. النسبة: عدد الاشتباهات الفائتة أو الخاطئة في الشهر ÷ الحالات المدروسة في الشهر نفسه.");
  return bandTimelineInner(m, months, {
    eyebrow: S2,
    title: "الحالات المدروسة والاشتباهات الفائتة والخاطئة شهرياً",
    aria: "الخط الزمني للحالات المدروسة والاشتباهات",
    topTitle: "الحالات المدروسة (العينة)",
    botTitle: "نسبة الاشتباهات الفائتة والخاطئة من الحالات المدروسة",
    series: [
      { label: "الحالات المدروسة", color: LINE_COLOR.all, band: "top", values: months.map((x0) => x0.studied), chipDy: -24, total: true },
      { label: "نسبة الاشتباهات الفائتة", color: "var(--v3-red)", band: "bottom", values: months.map((x0) => share(x0.missed, x0.studied)), chipDy: -24, total: false, percent: `للفترة ${pct(totalOf("missed") / Math.max(1, totalOf("studied")))}` },
      { label: "نسبة الاشتباهات الخاطئة", color: LINE_COLOR.selected, band: "bottom", values: months.map((x0) => share(x0.falseSuspicion, x0.studied)), chipDy: 26, total: false, percent: `للفترة ${pct(totalOf("falseSuspicion") / Math.max(1, totalOf("studied")))}` },
    ],
    notes,
  });
}

/** Monthly population (images received at the port) with the distinct employees who examined them. */
function populationTimelineInner(m: PortReportModel, w: WorkloadSlideInput, eyebrow: string): string {
  const months = (w.monthlyCounts ?? []).filter((x0) => x0.images !== null || x0.employees !== null);
  // A month under half the median month is an incomplete population sheet, not a quiet month.
  const sorted = months.map((x0) => x0.images ?? 0).sort((a0, b0) => a0 - b0);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const thin = months.filter((x0) => (x0.images ?? 0) < median / 2).map((x0) => `${Number(x0.monthKey.slice(5))}/${x0.monthKey.slice(0, 4)} (${fmtNum(x0.images ?? 0)} صورة)`);
  const thinMonths = thin.length ? [`بيانات المجتمع في ملف المصدر غير مكتملة لشهر ${thin.join("، ")}.`] : [];
  return bandTimelineInner(m, months, {
    eyebrow,
    title: "عدد صور الأشعة ومتوسط الموظفين في المنفذ شهرياً",
    aria: "الخط الزمني لمجتمع الحالات الواردة وعدد الموظفين",
    topTitle: "عدد صور الأشعة للمنفذ",
    botTitle: "عدد الموظفين في المنفذ",
    series: [
      { label: "عدد صور الأشعة للمنفذ", color: LINE_COLOR.all, band: "top", values: months.map((x0) => x0.images), chipDy: -24, total: true },
      { label: "متوسط الموظفين في المنفذ", color: LINE_COLOR.selected, band: "bottom", values: months.map((x0) => x0.employees), chipDy: -24, total: false },
    ],
    notes: [...thinMonths, "الخط المتقطع لكل مؤشر: متوسطه الشهري.", "عدد الموظفين: كل موظف فحص صورة واحدة على الأقل في المنفذ خلال الشهر، ويُحسب مرة واحدة. المتوسط: مجموع أعداد الأشهر ÷ عدد الأشهر."],
  });
}

function bandTimelineInner(m: PortReportModel, months: ReadonlyArray<{ monthKey: string }>, o: BandTimeline): string {
  const head = contentHead({ eyebrow: o.eyebrow, title: o.title, note: m.displayName });
  if (months.length < 2) return `${head}<p class="v3-note">لا توجد أشهر كافية لرسم الخط الزمني.</p>`;
  const W = 1760, padL = 40, padR = 170;
  const topT = 44, topH = 210, gap = 80, botH = 210, axisH = 120;
  const H = topT + topH + gap + botH + axisH;
  const botT = topT + topH + gap;
  const x = (i: number) => W - padR - ((W - padL - padR) * i) / (months.length - 1);
  // Axis top: the next 1-1.2-1.6-2-2.4-3-4-5-6-8 step, so four grid lines land on round numbers without flattening the line.
  const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(Math.max(1, v))); return ([1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((k) => k * p >= v) ?? 10) * p; };
  const botPct = o.series.some((s0) => s0.band === "bottom" && s0.percent !== undefined);
  const bandVals = (band: BandSeries["band"]) => o.series.filter((s0) => s0.band === band).flatMap((s0) => s0.values).filter((v): v is number => v !== null);
  const imgMax = nice(Math.max(1, ...bandVals("top")) * 1.15);
  // Percent axes step by whole 5s (20, 40, 60...) so the four grid lines read 5%, 10%, 15%.
  const errMax = botPct ? Math.max(20, Math.ceil((Math.max(1, ...bandVals("bottom")) * 1.25) / 20) * 20) : nice(Math.max(1, ...bandVals("bottom")) * 1.25);
  const yT = (v: number) => topT + topH * (1 - v / imgMax);
  const yB = (v: number) => botT + botH * (1 - v / errMax);
  const grid: string[] = [];
  for (let g = 0; g <= 4; g++) {
    const vt = (imgMax * g) / 4, vb = (errMax * g) / 4;
    grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${yT(vt).toFixed(1)}" y2="${yT(vt).toFixed(1)}" stroke="var(--v3-hair)" stroke-width="1"/><text x="${W - padR + 78}" y="${(yT(vt) + 7).toFixed(1)}" text-anchor="start" font-size="19" fill="var(--v3-muted)">${fmtNum(Math.round(vt))}</text>`);
    grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${yB(vb).toFixed(1)}" y2="${yB(vb).toFixed(1)}" stroke="var(--v3-hair)" stroke-width="1"/><text x="${W - padR + 78}" y="${(yB(vb) + 7).toFixed(1)}" text-anchor="start" font-size="19" fill="var(--v3-muted)">${botPct ? `${Math.round(vb)}%` : fmtNum(Math.round(vb))}</text>`);
  }
  const series = o.series.map((s0) => ({ ...s0, y: s0.band === "top" ? yT : yB }));
  const bottom = series.filter((s0) => s0.band === "bottom");
  const chip = (cx: number, cy: number, text: string, color: string, wpx: number) =>
    `<rect x="${(cx - wpx / 2).toFixed(1)}" y="${(cy - 13).toFixed(1)}" width="${wpx}" height="26" rx="5" fill="${color}"/><text x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--v3-bg)">${text}</text>`;
  const lines = series
    .map((ser) => {
      const d = ser.values.map((v, i) => (v === null ? "" : `${i && ser.values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${ser.y(v).toFixed(1)}`)).join(" ");
      const dots = ser.values.map((v, i) => (v === null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${ser.y(v).toFixed(1)}" r="5" fill="${ser.color}"/>`)).join("");
      const chips = ser.values
        .map((v, i) => {
          if (v === null) return "";
          // The higher of the two error counts gets its chip above its point, the lower one below,
          // so neither chip covers the other line.
          let dy = ser.chipDy;
          if (ser.band === "bottom" && bottom.length === 2) {
            const bi = bottom.indexOf(ser);
            const other = bottom[1 - bi].values[i] ?? 0;
            dy = v >= other ? -24 : 26;
            if (v === other && bi === 1) dy = 26;
          }
          const t = ser.percent !== undefined ? `${v.toFixed(1)}%` : fmtNum(v);
          return chip(x(i), ser.y(v) + dy, t, ser.color, Math.max(40, 12 + t.length * 10));
        })
        .join("");
      const kv = ser.values.filter((v): v is number => v !== null);
      const avgY = kv.length ? ser.y(kv.reduce((a0, b0) => a0 + b0, 0) / kv.length).toFixed(1) : null;
      const avgLine = avgY === null ? "" : `<line x1="${padL}" x2="${W - padR}" y1="${avgY}" y2="${avgY}" stroke="${ser.color}" stroke-width="2" stroke-dasharray="8 6" opacity="0.8"/>`;
      return `${avgLine}<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${chips}`;
    })
    .join("");
  const bandTitle = (y0: number, text: string) => `<text x="${W - padR - 8}" y="${y0}" text-anchor="start" font-size="22" font-weight="700" fill="var(--v3-navy)" direction="rtl">${esc(text)}</text>`;
  const axisY = botT + botH;
  const monthLabels = months.map((mo, i) => `<text x="${x(i).toFixed(1)}" y="${axisY + 64}" text-anchor="middle" font-size="19" fill="var(--v3-muted)">${Number(mo.monthKey.slice(5))}</text>`).join("");
  const years: Array<{ year: string; from: number; to: number }> = [];
  months.forEach((mo, i) => {
    const yr = mo.monthKey.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === yr) last.to = i;
    else years.push({ year: yr, from: i, to: i });
  });
  const yearLabels = years
    .map((yr, k) => {
      const mid = (x(yr.from) + x(yr.to)) / 2;
      const sx = k > 0 ? ((x(yr.from - 1) + x(yr.from)) / 2).toFixed(1) : "";
      const sep = k > 0 ? `<line x1="${sx}" x2="${sx}" y1="${topT - 20}" y2="${H - 10}" stroke="var(--v3-navy)" stroke-width="2"/>` : "";
      return `${sep}<text x="${mid.toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="24" font-weight="700" fill="var(--v3-navy)">${yr.year}</text>`;
    })
    .join("");
  const svg = `<svg data-pptx-image viewBox="0 0 ${W} ${H}" width="100%" height="${H}" dir="ltr" direction="ltr" role="img" aria-label="${esc(o.aria)}" style="display:block;background:var(--v3-panel)">${grid.join("")}${yearLabels}${bandTitle(topT - 14, o.topTitle)}${bandTitle(botT - 14, o.botTitle)}${lines}${monthLabels}</svg>`;
  const known = (vals: (number | null)[]) => vals.filter((v): v is number => v !== null);
  const total = (vals: (number | null)[]) => known(vals).reduce((a0, b0) => a0 + b0, 0);
  const fmtV = (ser: (typeof series)[number], v: number) => (ser.percent !== undefined ? `${v.toFixed(1)}%` : fmtNum(v));
  const ext = (ser: (typeof series)[number]) => {
    let lo = -1, hi = -1;
    ser.values.forEach((v, i) => { if (v === null) return; if (lo < 0 || v < (ser.values[lo] as number)) lo = i; if (hi < 0 || v > (ser.values[hi] as number)) hi = i; });
    const mk = (i: number) => `${fmtV(ser, ser.values[i] as number)} (${Number(months[i].monthKey.slice(5))}/${months[i].monthKey.slice(0, 4)})`;
    return lo < 0 ? "" : ` · الأدنى ${mk(lo)} · الأعلى ${mk(hi)}`;
  };
  const legend = series
    .map((ser) => `<div style="display:flex;align-items:center;gap:12px;font-size:22px;white-space:nowrap"><span style="display:inline-block;width:34px;height:0;border-top:4px solid ${ser.color}"></span><b style="color:var(--v3-navy)">${esc(ser.label)}</b><span style="color:var(--v3-muted)">${ser.percent !== undefined ? ser.percent : `${ser.total ? `الإجمالي ${fmtNum(total(ser.values))} · ` : ""}المتوسط الشهري ${fmtNum(Math.round(total(ser.values) / Math.max(1, known(ser.values).length)))}`}${ext(ser)}</span></div>`)
    .join("");
  const notes = o.notes;
  return `${head}
<div style="display:flex;flex-wrap:wrap;gap:10px 48px;margin-bottom:10px">${legend}</div>
${svg}${notes.length ? `<p class="v3-note" style="margin:6px 0 0;font-size:18px">${notes.map(esc).join(" ")}</p>` : ""}`;
}

function tiersInner(m: PortReportModel, eyebrow = S3): string {
  const d = m.distribution;
  const head = contentHead({ eyebrow, title: `معدل التوافق لمنسوبي ${m.displayName}`, note: `المتوسط ${pct(d.mean)} · الوسيط ${pct(d.median)}` });
  const MIN_TIER_SAMPLE = employeeMinStudied(m.employees);
  if (d.tiers.length === 0) return `${head}<p class="v3-note">لا يوجد موظفون بعدد حالات مدروسة كافٍ (${MIN_TIER_SAMPLE} فأكثر).</p>`;
  const sections = d.tiers
    .map((t, i) => {
      const tone = TIER_TONE[t.key];
      // Each tier is its own chart on its own axis, so a small tier's bars stay readable.
      const bins = d.bins.filter((b) => b.tier === t.key);
      // Chart review: one scale for the three tiers, so 12 employees no longer draws as tall as 34.
      const maxCount = Math.max(1, ...d.bins.map((b) => b.count));
      const chart = barChart({
        bars: bins.map((b) => ({ label: `${pct(b.from, 0)}–${pct(b.to, 0)}`, value: b.count, tone })),
        min: 0,
        max: maxCount * 1.3,
        barMaxWidth: 110,
        gap: 14,
        pad: 10,
        plotHeight: 185,
        valueFormat: (v) => fmtNum(Math.round(v)),
      });
      const table = kvTable([
        { label: "تبدأ من", value: pct(t.from) },
        { label: "تنتهي عند", value: pct(t.to) },
        { label: "عدد الموظفين", value: fmtNum(t.count) },
        { label: "متوسط دقة الموظفين", value: pct(t.meanAccuracy), cls: `v-${tone}` },
        { label: "معدل الاشتباه الفائت", value: pct(t.studied ? t.missed / t.studied : null), cls: "v-red" },
        { label: "معدل الاشتباه الخاطئ", value: pct(t.studied ? t.falseSuspicion / t.studied : null), cls: "v-gold" },
        { label: "متوسط الحالات لكل موظف", value: t.meanStudied === null ? "—" : fmtNum(Math.round(t.meanStudied)), cls: "v-muted" },
      ]);
      return `<div style="display:flex;flex-direction:column;min-width:0;${i > 0 ? RULE : ""}">
  ${chartTitleRow({ title: `دقة ${t.label}`, asideText: `${fmtNum(t.count)} موظفًا` })}
  ${chart}
  <div style="margin-top:16px">${table}</div>
</div>`;
    })
    .join("");
  return `${head}
<div class="v3-two-col" style="grid-template-columns:repeat(3,1fr);gap:32px">${sections}</div>
<p class="v3-note" style="margin-top:8px;font-size:21px">تم احتساب الفئات بناءً على الفرق بين أقل معدل دقة وأعلى معدل دقة مقسومًا على ثلاثة، وكل فئة مقسمة إلى ثلاثة أعمدة. الموظفون المدروسة حالاتهم ${fmtNum(m.employees.length)}: صُنِّف منهم ${fmtNum(d.tiered)} تمت دراسة ${MIN_TIER_SAMPLE} حالة فأكثر لكل منهم (10% من متوسط الحالات المدروسة للموظف)، واستُبعد ${fmtNum(d.untiered)} (في الملحقات).</p>`;
}

/** Complete self-contained HTML document for one port. */
export function buildPortReportHtml(m: PortReportModel, workload?: WorkloadSlideInput): string {
  const name = `تقرير أعمال ${m.displayName}`;
  const slides = buildPortReportSlides(m, workload);
  const count = (slides.match(/<section class="slide v3/g) ?? []).length;
  const html = buildDeckV3Html(slides.replaceAll(`/ ${TOTAL_TOKEN}<`, `/ ${count}<`), m.periodLabel, { title: name, navBrand: name, toolbarBrand: name }, "", null); // null = in-viewer text editor on, no saved template
  // Figures centred under their headers; the first (label) column stays right-aligned.
  const centre = ".slide.v3 .v3-table th:not(:first-child),.slide.v3 .v3-table td:not(:first-child){text-align:center;}.slide.v3 .v3-bar span{position:absolute;bottom:100%;margin-bottom:6px;color:var(--v3-navy);white-space:nowrap;z-index:2;}.slide.v3 .v3-bar{padding-top:0;}.slide.v3 .pr-pop td{padding-top:2px;padding-bottom:2px;font-size:22px;height:auto;}.slide.v3 .pr-dense td{font-size:17px;padding-top:0;padding-bottom:0;line-height:1.1;}.slide.v3 .pr-lv td{font-size:21px;white-space:nowrap;}.slide.v3 .pr-dense td:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.slide.v3 .pr-dense th{font-size:16px;}.slide.v3 .pr-dense td:first-child{font-size:16px;}.slide.v3 .pr-wrap td{white-space:normal;overflow:visible;line-height:1.05;}.slide.v3 .pr-tier td{font-size:17px;height:34px;white-space:nowrap;}.slide.v3 .pr-tier td:first-child{font-size:16px;}.slide.v3 .pr-tier th{padding-left:3px;padding-right:3px;font-size:14px;}.slide.v3 .pr-tier td:nth-child(2){font-size:14px;overflow:hidden;text-overflow:ellipsis;}.slide.v3 .v3-table th{white-space:normal;line-height:1.25;vertical-align:bottom;}" +
    ".slide.v3 .pr-yb .v3-bar span{font-size:17px;letter-spacing:0;}.slide.v3 .pr-yb1 .v3-bar span{font-size:15px;letter-spacing:-.3px;}" +
    // No clipped text: the appendix rows grow with a wrapped port name.
    ".slide.v3 .pr-apx td{height:auto;min-height:28px;overflow:visible;font-size:18px;}.slide.v3 .pr-apx td:first-child{font-size:17px;overflow:visible;}" +
    ".slide.v3 .pr-cmp td{font-size:21px;white-space:nowrap;}" +
    // Observations: one size for the main observation, the evidence and the recommendations, on every page.
    ".slide.v3 .pr-obs-even .v3-obs-text,.slide.v3 .pr-obs-even .v3-obs-title{font-size:24px;line-height:1.55;}" +
    ".slide.v3 .pr-obs-even .v3-obs-main .v3-obs-body{align-items:flex-start;}" +
    // Side-by-side panels: one-line titles, so every panel's table starts at the same height.
    ".slide.v3 .pr-eq .v3-panel-title,.slide.v3 .v3-two-col .v3-panel-title{white-space:nowrap;}" +
    ".slide.v3 .pr-eq .v3-panel-head{flex-wrap:nowrap;}";
  // Long dashes out, including the viewer script's escaped ones ("\u2014" in its page counter).
  return html.replace("</style>", `${centre}</style>`).replace(/[\u2013\u2014]/g, "-").replace(/\\u201[34]/g, "-");
}
