// The executive Presentation slides (design §6 / blueprint §3). ~14 curated 16:9
// landscape slides built from a single ReportModel — top-N highlights only, one
// message + one hero visual + the decision each supports. No per-slide recompute,
// no runtime scaling, no emoji. Honesty discipline (§3.7): insufficient-data slides
// state so plainly rather than showing a weak chart.

import type { ReportModel } from "../model/reportModel";
import type { EmployeeByPortLevel, ReviewerAgreementRow } from "../model/aggregates";
import type { ResultSource } from "../model/decisionFactTable";
import { band, isRankable } from "../model/dataSufficiency";
import { donut, gauge, groupedBars, heatmap, rankedBar } from "../ui/charts";
import { icon } from "../ui/icons";
import { fmtNum, fmtPct } from "../primitives";
import {
  cards,
  emptyHero,
  heroChart,
  heroNumber,
  kpiBand,
  kpiTile,
  miniTable,
  numberedList,
  slide,
  split,
  timeline,
} from "./shared";

/** Arabic labels for each cross-team result source. */
const SOURCE_LABEL: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "التفتيش اليدوي",
  opposite: "التفتيش المعاكس",
  liveMeans: "الوسائل الحية",
  review: "المراجع (المعيار)",
};

const UNMAPPED_TITLE = "هوية المفتش غير مرتبطة (لم تتم مطابقة BI)";
const UNMAPPED_DETAIL =
  "تتطلب المساءلة الفردية ربط هوية المفتش من بيانات BI. لم تتم المطابقة هذه الفترة، لذا لا تُعرض أسماء أو أرقام مفتشين ولا تُنسب الدقة لأي فرد.";

/** Aggregate the per-port-per-level inspector rows into one row per inspector. */
type InspectorRollup = {
  inspectorId: string;
  evaluable: number;
  correct: number;
  correctSuspicion: number;
  missedSuspicion: number;
  ports: Set<string>;
};

function rollupInspectors(rows: EmployeeByPortLevel[]): InspectorRollup[] {
  const map = new Map<string, InspectorRollup>();
  for (const r of rows) {
    const cur =
      map.get(r.inspectorId) ??
      {
        inspectorId: r.inspectorId,
        evaluable: 0,
        correct: 0,
        correctSuspicion: 0,
        missedSuspicion: 0,
        ports: new Set<string>(),
      };
    cur.evaluable += r.evaluable;
    cur.correct += r.correctClean + r.correctSuspicion;
    cur.correctSuspicion += r.correctSuspicion;
    cur.missedSuspicion += r.missedSuspicion;
    if (r.portName) cur.ports.add(r.portName);
    map.set(r.inspectorId, cur);
  }
  return [...map.values()];
}

function accuracyOf(r: InspectorRollup): number | null {
  return r.evaluable > 0 ? (r.correct / r.evaluable) * 100 : null;
}

// ── Slide 1 — Title ───────────────────────────────────────────────────────
export function titleSlide(model: ReportModel, issueDate: string): string {
  const body = `
    <div class="title-mark">${icon("shield", 38)}</div>
    <div class="title-kicker">عرض تنفيذي</div>
    <h1>تقرير ضمان جودة فحص الأشعة</h1>
    <div class="title-sub">المجتمع المدروس: ${model.summary.periodId}</div>
    <div class="title-meta">تاريخ الإصدار: ${issueDate}</div>
    <div class="title-rule"></div>
    <div class="title-classify"><span>${icon("shield", 14)}</span>داخلي — للاستخدام التنفيذي</div>
    <div class="title-levels">
      <div class="l1">المستوى الأول</div>
      <div class="l2">المستوى الثاني</div>
      <div class="l3">المراجعة (المعيار)</div>
      <div class="l4">الفرق المساندة</div>
    </div>`;
  return `<section class="slide title-slide" id="slide-title" data-title="الغلاف">
    <div class="slide-inner">${body}</div>
  </section>`;
}

// ── Slide 2 — Executive summary ────────────────────────────────────────────
export function execSummarySlide(model: ReportModel, num: number, total: number): string {
  const s = model.summary;
  const verdict =
    s.overallAccuracy === null
      ? "لا توجد قرارات قابلة للتقييم بعد لإصدار حُكم على الدقة هذه الفترة."
      : `بلغت دقة فحص المستويين ${fmtPct(s.overallAccuracy)} مع اشتباه فائت ${fmtPct(s.missedSuspicionRate)} — العدسة الأمنية أولًا.`;
  const band = kpiBand([
    kpiTile({ label: "دقة الفحص", value: fmtPct(s.overallAccuracy), tone: "gold" }),
    kpiTile({ label: "اكتشاف الاشتباه", value: fmtPct(s.detectionRate), tone: "blue" }),
    kpiTile({ label: "الاشتباه الفائت", value: fmtPct(s.missedSuspicionRate), tone: "coral" }),
    kpiTile({ label: "التغطية", value: fmtPct(model.sample.coverage), tone: "green" }),
    kpiTile({ label: "الإنجاز", value: fmtPct(s.completionRate), tone: "slate" }),
  ]);
  return slide({
    id: "slide-summary",
    title: "الملخص التنفيذي",
    num,
    total,
    eyebrow: "الملخص التنفيذي",
    iconName: "chart",
    headline: "الحُكم في سطر واحد",
    subhead: verdict,
    body: band,
    decision: "يحدّد جدول أعمال الاجتماع والمؤشرات التي تستحق القرار.",
  });
}

// ── Slide 3 — What we examined ─────────────────────────────────────────────
export function scopeSlide(model: ReportModel, num: number, total: number): string {
  const p = model.population;
  const donutData = [
    { label: "سليمة", value: p.clean },
    { label: "اشتباه", value: p.suspicious },
  ];
  const left = heroNumber({
    value: fmtNum(p.total),
    caption: "إجمالي حالات المجتمع المدروس",
    sub: `${fmtNum(p.byPort.length)} منفذ · العينة ${fmtNum(model.sample.total)} · التغطية ${fmtPct(model.sample.coverage)}`,
    tone: "gold",
  });
  const right = heroChart(donut(donutData, { width: 240, height: 240 }), {
    caption: "توزيع المجتمع: سليمة مقابل اشتباه",
  });
  return slide({
    id: "slide-scope",
    title: "ما الذي فحصناه",
    num,
    total,
    eyebrow: "النطاق",
    iconName: "layers",
    headline: "ما الذي فحصناه — وبأي تغطية",
    subhead: "أساس موثوق: المجتمع كامل، والعينة مسحوبة منه بمنهجية معتمدة.",
    body: split(left, right),
    decision: "الثقة في أساس البيانات قبل قراءة بقية النتائج.",
  });
}

// ── Slide 4 — The verdict: L1/L2 accuracy ──────────────────────────────────
export function verdictSlide(model: ReportModel, num: number, total: number): string {
  const s = model.summary;
  const t = model.errorAnalysis.totals;
  // Gate on image-level inspection accuracy (expert vs L1/L2 result) — which does NOT
  // require inspector identity — so the verdict matches the Document and stays populated
  // when BI is unmapped. (Inspector-level evaluability gates the employee slides, not this.)
  if (s.overallAccuracy === null) {
    return slide({
      id: "slide-verdict",
      title: "حُكم الدقة",
      num,
      total,
      eyebrow: "الحُكم",
      iconName: "gauge",
      headline: "دقة المستوى الأول والثاني",
      body: emptyHero(
        "لا توجد قرارات قابلة للتقييم هذه الفترة",
        "يتطلب الحُكم على الدقة وجود صورة ونتيجة مراجع وهوية مفتش. لم تتوفر هذه الشروط بعدد كافٍ هذه الفترة.",
      ),
      decision: "تأجيل الحُكم على الدقة حتى اكتمال البيانات.",
    });
  }
  const quad = `<div class="kpi-band n2" style="gap:12px">
    <div class="kpi-tile green"><div class="kpi-tile-label">سليمة صحيحة</div><div class="kpi-tile-value">${fmtNum(t.correctClean)}</div></div>
    <div class="kpi-tile blue"><div class="kpi-tile-label">اشتباه صحيح</div><div class="kpi-tile-value">${fmtNum(t.correctSuspicion)}</div></div>
    <div class="kpi-tile coral"><div class="kpi-tile-label">اشتباه فائت</div><div class="kpi-tile-value">${fmtNum(t.missedSuspicion)}</div></div>
    <div class="kpi-tile gold"><div class="kpi-tile-label">اشتباه خاطئ</div><div class="kpi-tile-value">${fmtNum(t.falseSuspicion)}</div></div>
  </div>`;
  const left = `<div class="kpi-band n2" style="gap:16px">
      ${heroChart(gauge(s.overallAccuracy, { width: 230, height: 150 }), { height: 170, caption: "دقة الفحص" })}
      ${heroChart(gauge(s.detectionRate, { width: 230, height: 150 }), { height: 170, caption: "اكتشاف الاشتباه" })}
    </div>`;
  return slide({
    id: "slide-verdict",
    title: "حُكم الدقة",
    num,
    total,
    eyebrow: "الحُكم · العدسة الأمنية",
    iconName: "gauge",
    headline: `الاشتباه الفائت ${fmtPct(s.missedSuspicionRate)} — هل ما يفوتنا مقبول؟`,
    subhead: `دقة الفحص ${fmtPct(s.overallAccuracy)} · اكتشاف الاشتباه ${fmtPct(s.detectionRate)}`,
    body: split(left, quad, "even"),
    decision: "هل جودة قرارات المستويين مقبولة أمنيًا أم تتطلب تدخلًا؟",
  });
}

// ── Slide 5 — Where we're strong / weak (ports) ────────────────────────────
export function portsSlide(model: ReportModel, num: number, total: number): string {
  const ports = [...model.portAccuracy].sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
  const rankable = ports.filter((p) => isRankable(p.band) && p.accuracy !== null);
  if (rankable.length === 0) {
    return slide({
      id: "slide-ports",
      title: "القوة والضعف حسب المنفذ",
      num,
      total,
      eyebrow: "أين نركّز",
      iconName: "port",
      headline: "أين نحن أقوى وأين نحتاج دعمًا",
      body: emptyHero(
        "لا توجد منافذ ببيانات كافية للترتيب",
        "تُرتّب المنافذ فقط عند توفّر عدد كافٍ من القرارات القابلة للتقييم. المنافذ الحالية دون هذا الحد فلا تُرتّب.",
      ),
      decision: "توجيه الجهد بعد توفّر بيانات كافية لكل منفذ.",
    });
  }
  const top = rankable.slice(0, 5);
  const bottom = rankable.slice(-5).reverse();
  const bars = rankable.slice(0, 8).map((p) => ({ label: p.key, value: p.accuracy as number }));
  const left = heroChart(rankedBar(bars, { width: 400 }), {
    caption: "ترتيب الدقة (المنافذ الكافية فقط)",
  });
  const right = miniTable({
    headers: ["المنفذ", "الدقة", "الفائت"],
    rows: [
      ...top.slice(0, 3).map((p) => [p.key, fmtPct(p.accuracy), fmtPct(p.missedSuspicionRate)]),
      ...bottom.slice(0, 2).map((p) => [p.key, fmtPct(p.accuracy), fmtPct(p.missedSuspicionRate)]),
    ],
  });
  return slide({
    id: "slide-ports",
    title: "القوة والضعف حسب المنفذ",
    num,
    total,
    eyebrow: "أين نركّز",
    iconName: "port",
    headline: `الأقوى: ${top[0].key} · الأضعف: ${bottom[0].key}`,
    subhead: "المنافذ ذات البيانات غير الكافية تُوصف ولا تُرتّب.",
    body: split(left, right, "wide-left"),
    decision: "أين توجَّه جهود الدعم والمتابعة أولًا.",
  });
}

// ── Slide 6 — Does L2 review help ──────────────────────────────────────────
export function levelSlide(model: ReportModel, num: number, total: number): string {
  const k = model.kpis;
  const grouped = groupedBars(
    {
      groups: ["الدقة"],
      series: [
        { label: "المستوى الأول", values: [k.levelOneAccuracy ?? 0] },
        { label: "المستوى الثاني", values: [k.levelTwoAccuracy ?? 0] },
      ],
    },
    { width: 320, height: 260 },
  );
  const right = kpiBand([
    kpiTile({ label: "تصحيح م. الثاني", value: fmtPct(k.levelTwoCorrectionRate), tone: "green" }),
    kpiTile({ label: "تراجع م. الثاني", value: fmtPct(k.levelTwoRegressionRate), tone: "coral" }),
  ]);
  return slide({
    id: "slide-levels",
    title: "هل تساعد المراجعة المزدوجة",
    num,
    total,
    eyebrow: "المحرّكات",
    iconName: "layers",
    headline: "هل تساعد مراجعة المستوى الثاني؟",
    subhead: `دقة م.الأول ${fmtPct(k.levelOneAccuracy)} · دقة م.الثاني ${fmtPct(k.levelTwoAccuracy)}`,
    body: split(heroChart(grouped, { height: 280, caption: "دقة المستويين جنبًا إلى جنب" }), right),
    decision: "الإبقاء على المراجعة المزدوجة أو تعديلها.",
  });
}

// ── Slide 7 — Do others agree our calls (cross-team) ───────────────────────
export function corroborationSlide(model: ReportModel, num: number, total: number): string {
  const rows = model.resultComparison.reviewerAgreement.filter((r) => r.comparable > 0);
  if (rows.length === 0) {
    return slide({
      id: "slide-corroboration",
      title: "هل تتفق الفرق الأخرى",
      num,
      total,
      eyebrow: "التطابق",
      iconName: "users",
      headline: "هل تؤكد الفرق الأخرى قراراتنا؟",
      body: emptyHero(
        "لا توجد مقارنات قابلة للحساب هذه الفترة",
        "يُحسب التطابق فقط على الصور التي لها نتيجة لدى الفريق والمراجع معًا. لم تتوفر نتائج كافية من الفرق الأخرى.",
      ),
      decision: "اعتماد نتائج المراجع كمعيار وحيد حتى تتوفر بيانات الفرق.",
    });
  }
  const sorted = [...rows].sort((a, b) => (b.agreementRate ?? -1) - (a.agreementRate ?? -1));
  const bars = sorted.map((r: ReviewerAgreementRow) => ({
    label: SOURCE_LABEL[r.source],
    value: r.agreementRate ?? 0,
  }));
  const top = sorted[0];
  const right = miniTable({
    headers: ["الفريق", "التطابق", "قابلة للمقارنة"],
    rows: sorted.slice(0, 5).map((r) => [SOURCE_LABEL[r.source], fmtPct(r.agreementRate), fmtNum(r.comparable)]),
  });
  return slide({
    id: "slide-corroboration",
    title: "هل تتفق الفرق الأخرى",
    num,
    total,
    eyebrow: "التطابق",
    iconName: "users",
    headline: `أعلى تطابق مع المراجع: ${SOURCE_LABEL[top.source]} (${fmtPct(top.agreementRate)})`,
    subhead: "الفرق الأخرى دليل مساند — المراجع وحده هو المعيار الذهبي.",
    body: split(heroChart(rankedBar(bars, { width: 400 }), { caption: "تطابق كل فريق مع المراجع" }), right, "wide-left"),
    decision: "مستوى الثقة في حُكم الدقة بناءً على تأكيد الفرق المستقلة.",
  });
}

// ── Slide 8 — What drives quality (image quality & marking) ────────────────
export function driversSlide(model: ReportModel, num: number, total: number): string {
  const q = model.imageQuality;
  const grouped = groupedBars(
    {
      groups: ["جودة الصور"],
      series: [
        { label: "عالية", values: [q.highQualityCount] },
        { label: "متوسطة", values: [q.mediumQualityCount] },
        { label: "منخفضة", values: [q.lowQualityCount] },
      ],
    },
    { width: 320, height: 260 },
  );
  const right = kpiBand([
    kpiTile({ label: "الجودة المقبولة", value: fmtPct(q.acceptableQualityRate), tone: "gold" }),
    kpiTile({ label: "وجود التحديد", value: fmtPct(q.markingRate), tone: "blue" }),
    kpiTile({ label: "توفر الصورة", value: fmtPct(q.availabilityRate), tone: "green" }),
  ]);
  return slide({
    id: "slide-drivers",
    title: "ما الذي يحرّك الجودة",
    num,
    total,
    eyebrow: "المحرّكات",
    iconName: "scan",
    headline: "ما الذي يرتبط بدقة القرار؟",
    subhead: "العلاقة بين الجودة/التحديد والدقة ارتباطية وليست سببية.",
    body: split(heroChart(grouped, { height: 280, caption: "توزيع جودة الصور" }), right),
    decision: "إصلاحات تشغيلية على جودة الصورة والتحديد.",
  });
}

// ── Slide 9 — Top inspectors (by volume) ───────────────────────────────────
export function topInspectorsSlide(model: ReportModel, num: number, total: number): string {
  if (!model.employeeOverview.inspectorIdentityMapped) {
    return slide({
      id: "slide-top-inspectors",
      title: "أبرز المفتشين",
      num,
      total,
      eyebrow: "المساءلة",
      iconName: "users",
      headline: "أعلى المفتشين حجمًا للقرارات",
      body: emptyHero(UNMAPPED_TITLE, UNMAPPED_DETAIL),
      decision: "ربط هوية المفتش من BI لتفعيل المساءلة الفردية.",
    });
  }
  const rollup = rollupInspectors(model.employeeByPort);
  const topByVolume = [...rollup].sort((a, b) => b.evaluable - a.evaluable).slice(0, 5);
  const rows = topByVolume.map((r) => {
    const acc = accuracyOf(r);
    const rankable = isRankable(band(r.evaluable));
    return [
      r.inspectorId,
      fmtNum(r.evaluable),
      rankable ? fmtPct(acc) : null,
      fmtNum(r.ports.size),
    ];
  });
  return slide({
    id: "slide-top-inspectors",
    title: "أبرز المفتشين",
    num,
    total,
    eyebrow: "المساءلة",
    iconName: "users",
    headline: "أعلى خمسة مفتشين حجمًا للقرارات",
    subhead: "الدقة تُعرض فقط عند توفّر بيانات كافية للمفتش.",
    body: miniTable({
      headers: ["معرّف المفتش", "قرارات قابلة للتقييم", "الدقة", "عدد المنافذ"],
      rows,
    }),
    decision: "التقدير ونمذجة الممارسات الجيدة على الأكثر حجمًا وأثرًا.",
  });
}

// ── Slide 10 — Inspectors needing support ──────────────────────────────────
export function supportSlide(model: ReportModel, num: number, total: number): string {
  if (!model.employeeOverview.inspectorIdentityMapped) {
    return slide({
      id: "slide-support",
      title: "مفتشون يحتاجون دعمًا",
      num,
      total,
      eyebrow: "المساءلة",
      iconName: "alert",
      headline: "المفتشون الذين يحتاجون دعمًا مركّزًا",
      body: emptyHero(UNMAPPED_TITLE, UNMAPPED_DETAIL),
      decision: "ربط هوية المفتش من BI قبل توجيه التدريب الفردي.",
    });
  }
  const rollup = rollupInspectors(model.employeeByPort).filter((r) => r.evaluable >= 10);
  const needSupport = [...rollup]
    .sort((a, b) => {
      const am = a.correctSuspicion + a.missedSuspicion > 0 ? a.missedSuspicion / (a.correctSuspicion + a.missedSuspicion) : -1;
      const bm = b.correctSuspicion + b.missedSuspicion > 0 ? b.missedSuspicion / (b.correctSuspicion + b.missedSuspicion) : -1;
      return bm - am;
    })
    .slice(0, 3);
  if (needSupport.length === 0) {
    return slide({
      id: "slide-support",
      title: "مفتشون يحتاجون دعمًا",
      num,
      total,
      eyebrow: "المساءلة",
      iconName: "check",
      headline: "لا يوجد مفتشون ضمن نطاق الأولوية هذه الفترة",
      body: emptyHero(
        "لا توجد حالات أولوية ببيانات كافية",
        "لم يبلغ أي مفتش حد البيانات الكافية مع مؤشر اشتباه فائت يستدعي تدخلًا مركّزًا هذه الفترة.",
      ),
      decision: "الاستمرار في المتابعة الدورية دون تدخل فردي.",
    });
  }
  const items = needSupport.map((r) => {
    const missedRate = r.correctSuspicion + r.missedSuspicion > 0
      ? (r.missedSuspicion / (r.correctSuspicion + r.missedSuspicion)) * 100
      : null;
    return {
      iconName: "alert",
      title: `المفتش ${r.inspectorId}`,
      text: `اشتباه فائت ${fmtPct(missedRate)} على ${fmtNum(r.evaluable)} قرار قابل للتقييم — الدليل: ${fmtNum(r.missedSuspicion)} حالة اشتباه فائتة.`,
      tone: "coral" as const,
    };
  });
  return slide({
    id: "slide-support",
    title: "مفتشون يحتاجون دعمًا",
    num,
    total,
    eyebrow: "المساءلة",
    iconName: "alert",
    headline: "المفتشون الذين يحتاجون دعمًا مركّزًا",
    subhead: "مرتّبون بالاشتباه الفائت (الخطر الأمني الأول) مع توفّر بيانات كافية.",
    body: cards(items, needSupport.length >= 3 ? 3 : 2),
    decision: "تدريب أو متابعة مستهدفة للحالات ذات الخطر الأعلى.",
  });
}

// ── Slide 11 — The biggest risk (missed-suspicion concentration) ───────────
export function riskSlide(model: ReportModel, num: number, total: number): string {
  const byPort = model.errorAnalysis.byPort
    .filter((p) => p.missedSuspicion > 0)
    .sort((a, b) => b.missedSuspicion - a.missedSuspicion);
  if (byPort.length === 0) {
    return slide({
      id: "slide-risk",
      title: "أكبر خطر",
      num,
      total,
      eyebrow: "المخاطر",
      iconName: "shield",
      headline: "أين يتركّز الخطر الأكبر؟",
      body: emptyHero(
        "لا يوجد اشتباه فائت مسجّل هذه الفترة",
        "لم تُرصد حالات اشتباه فائت ضمن القرارات القابلة للتقييم — لا يوجد تركّز خطر يُبرز هذه الفترة.",
      ),
      decision: "لا يلزم تحديد مالك خطر هذه الفترة؛ الاستمرار في الرصد.",
    });
  }
  const matrix = {
    rows: byPort.slice(0, 6).map((p) => p.key),
    cols: ["فائت", "خاطئ"],
    values: byPort.slice(0, 6).map((p) => [p.missedSuspicion, p.falseSuspicion]) as (number | null)[][],
  };
  const topPort = byPort[0];
  const left = heroNumber({
    value: fmtNum(model.errorAnalysis.totals.missedSuspicion),
    caption: "إجمالي حالات الاشتباه الفائت",
    sub: `الأعلى تركّزًا: ${topPort.key} (${fmtNum(topPort.missedSuspicion)} حالة)`,
    tone: "coral",
  });
  return slide({
    id: "slide-risk",
    title: "أكبر خطر",
    num,
    total,
    eyebrow: "المخاطر",
    iconName: "shield",
    headline: "أين يتركّز الاشتباه الفائت؟",
    subhead: "الخطر الأمني الأول: تهديد مُرّ دون اشتباه.",
    body: split(left, heroChart(heatmap(matrix, { width: 300 }), { caption: "تركّز الأخطاء حسب المنفذ" }), "even"),
    decision: "إسناد ملكية الخطر ومعالجة بؤر التركّز.",
  });
}

// ── Slide 12 — Priority actions ────────────────────────────────────────────
export function actionsSlide(model: ReportModel, num: number, total: number): string {
  const actions = model.actions.slice(0, 4);
  const body =
    actions.length > 0
      ? cards(
          actions.map((a) => ({ iconName: "flag", title: "إجراء مقترح", text: a, tone: "gold" as const })),
          actions.length >= 3 ? 3 : 2,
        )
      : emptyHero(
          "لا توجد إجراءات أولوية مولّدة هذه الفترة",
          "تتولّد الإجراءات من نتائج التحليل؛ لم تُنتج البيانات الحالية إجراءات أولوية.",
        );
  return slide({
    id: "slide-actions",
    title: "الإجراءات ذات الأولوية",
    num,
    total,
    eyebrow: "الإجراءات",
    iconName: "flag",
    headline: "الإجراءات القليلة العاجلة",
    subhead: "ما الذي يجب فعله الآن بأكبر أثر.",
    body,
    decision: "اعتماد الإجراءات العاجلة وإسناد ملّاكها.",
  });
}

// ── Slide 13 — Decisions required ──────────────────────────────────────────
export function decisionsSlide(model: ReportModel, num: number, total: number): string {
  const decisions: string[] = [
    "اعتماد عتبات كفاية البيانات النهائية (غير كافٍ / محدود / كافٍ).",
    model.dataQuality.inspectorIdentityMapped
      ? "اعتماد نطاق المساءلة الفردية للمستويين بناءً على هوية المفتش المرتبطة."
      : "اعتماد خطة ربط هوية المفتش من بيانات BI لتفعيل المساءلة الفردية.",
    "اتخاذ قرار بشأن استمرار المراجعة المزدوجة (المستوى الثاني) أو تعديلها.",
    "إقرار سياسة معالجة بؤر الاشتباه الفائت وإسناد ملكيتها.",
  ];
  return slide({
    id: "slide-decisions",
    title: "قرارات مطلوبة",
    num,
    total,
    eyebrow: "القرار",
    iconName: "document",
    headline: "القرارات المطلوبة من القيادة",
    subhead: "طلبات صريحة لتوقيع القيادة.",
    body: numberedList(decisions),
    decision: "توقيع القيادة على الطلبات المذكورة.",
  });
}

// ── Slide 14 — Next period ─────────────────────────────────────────────────
export function nextPeriodSlide(model: ReportModel, num: number, total: number): string {
  void model;
  const steps = [
    { when: "فورًا", what: "إسناد ملّاك الإجراءات العاجلة وبدء المتابعة." },
    { when: "الفترة القادمة", what: "إعادة قياس الدقة والاشتباه الفائت بعد التدخلات." },
    { when: "ربط BI", what: "تفعيل المساءلة الفردية فور ربط هوية المفتش." },
    { when: "مراجعة دورية", what: "اعتماد العتبات النهائية وتثبيت إيقاع التقرير." },
  ];
  return slide({
    id: "slide-next",
    title: "الفترة القادمة",
    num,
    total,
    eyebrow: "المتابعة",
    iconName: "arrow",
    headline: "خطة المتابعة للفترة القادمة",
    subhead: "العتبات المطلوب اعتمادها وإيقاع المتابعة.",
    body: timeline(steps),
    decision: "الالتزام بإيقاع المتابعة واعتماد العتبات.",
  });
}

/** Build every deck slide in order (blueprint §3). Returns the joined HTML. */
export function buildDeckSlides(model: ReportModel, issueDate: string): string {
  const builders: Array<(m: ReportModel, num: number, total: number) => string> = [
    // slide 1 (title) is special — handled separately
    execSummarySlide,
    scopeSlide,
    verdictSlide,
    portsSlide,
    levelSlide,
    corroborationSlide,
    driversSlide,
    topInspectorsSlide,
    supportSlide,
    riskSlide,
    actionsSlide,
    decisionsSlide,
    nextPeriodSlide,
  ];
  const total = builders.length + 1; // +1 for the title slide
  const slides: string[] = [titleSlide(model, issueDate)];
  builders.forEach((build, i) => {
    slides.push(build(model, i + 2, total));
  });
  return slides.join("\n");
}
