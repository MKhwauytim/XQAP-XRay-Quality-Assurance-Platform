// Part 2 — Inspection Quality (the L1/L2 verdict). Accuracy & detection headline,
// accuracy by port, L1 vs L2, image quality & marking. Driven from ReportModel.

import type { ReportModel } from "../model/reportModel";
import { gauge, groupedBars, rankedBar } from "../ui/charts";
import { fmtNum, fmtPct } from "../primitives";
import { isRankable } from "../model/dataSufficiency";
import {
  executiveClose,
  figure,
  kpi,
  kpiStrip,
  noteBox,
  page,
  pageHeader,
  panel,
  statusChip,
} from "./shared";
import { dataTable } from "./pagination";
import { accuracyClose, levelClose, portAccuracyClose, qualityClose } from "./narrative";

const TABS = ["الجزء الثاني", "الجزء الأول", "الجزء الثالث", "الجزء الرابع", "الجزء الخامس"];

export function buildAccuracyHeadline(model: ReportModel, pageNo: string): string {
  const t = model.errorAnalysis.totals;
  const quad = `<div class="quad">
    <div><h4 class="muted">سليمة صحيحة</h4><div class="metric green">${fmtNum(t.correctClean)}</div></div>
    <div><h4 class="muted">اشتباه صحيح</h4><div class="metric blue">${fmtNum(t.correctSuspicion)}</div></div>
    <div><h4 class="muted">اشتباه فائت</h4><div class="metric coral">${fmtNum(t.missedSuspicion)}</div></div>
    <div><h4 class="muted">اشتباه خاطئ</h4><div class="metric gold">${fmtNum(t.falseSuspicion)}</div></div>
  </div>`;

  const body = `${pageHeader({ iconName: "gauge", eyebrow: "الجزء الثاني · الحُكم", title: "الدقة والكشف", subtitle: "العدسة الأمنية: الاشتباه الفائت أولًا" })}
    ${kpiStrip([
      kpi({ label: "دقة الفحص", value: fmtPct(model.summary.overallAccuracy), tone: "gold" }),
      kpi({ label: "اكتشاف الاشتباه", value: fmtPct(model.summary.detectionRate), tone: "blue" }),
      kpi({ label: "الاشتباه الفائت", value: fmtPct(model.summary.missedSuspicionRate), tone: "coral" }),
      kpi({ label: "الاشتباه الخاطئ", value: fmtPct(model.summary.falseSuspicionRate), tone: "slate" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("الدقة والكشف", `<div class="grid grid-2" style="gap:8px">${figure(gauge(model.summary.overallAccuracy, { width: 220, height: 150 }), { height: 170, caption: "دقة الفحص" })}${figure(gauge(model.summary.detectionRate, { width: 220, height: 150 }), { height: 170, caption: "اكتشاف الاشتباه" })}</div>`, { iconName: "gauge" })}
      ${panel("مصفوفة النتائج", quad, { iconName: "chart" })}
    </div>
    ${executiveClose(accuracyClose(model.summary.overallAccuracy, model.summary.detectionRate, model.summary.missedSuspicionRate))}`;
  return page({ id: "page-accuracy", title: "الدقة والكشف", pageNo, railTabs: TABS, body });
}

export function buildAccuracyByPort(model: ReportModel, pageNo: string): string {
  const ports = [...model.portAccuracy].sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
  const rankable = ports.filter((p) => isRankable(p.band) && p.accuracy !== null);
  const best = rankable[0]?.key ?? null;
  const weakest = rankable.length > 0 ? rankable[rankable.length - 1].key : null;
  const insufficient = ports.filter((p) => !isRankable(p.band)).length;

  const bars = rankable.slice(0, 8).map((p) => ({ label: p.key, value: p.accuracy as number }));
  const rows = ports.map((p) => [
    p.key,
    fmtNum(p.evaluable),
    fmtNum(p.correctSuspicion + p.missedSuspicion),
    isRankable(p.band) ? fmtPct(p.detectionRate) : null,
    isRankable(p.band) ? fmtPct(p.accuracy) : null,
    isRankable(p.band) ? fmtPct(p.missedSuspicionRate) : null,
    bandChip(p.band),
  ]);

  const body = `${pageHeader({ iconName: "port", eyebrow: "الجزء الثاني · الحُكم", title: "الدقة حسب المنفذ", subtitle: "أين نحن أقوى وأين نحتاج دعمًا" })}
    ${kpiStrip([
      kpi({ label: "أعلى دقة", value: best ?? "—", tone: "green" }),
      kpi({ label: "أدنى دقة", value: weakest ?? "—", tone: "coral" }),
      kpi({ label: "منافذ غير كافية", value: fmtNum(insufficient), tone: "slate" }),
    ], 3)}
    <div class="grid grid-2" style="margin-top:14px">
      ${panel("ترتيب الدقة (المنافذ الكافية)", figure(rankedBar(bars, { width: 360 }), { height: 230 }), { iconName: "chart" })}
      ${panel("تفصيل المنافذ", dataTable({
        headers: ["المنفذ", "قرارات", "اشتباه مراجع", "الكشف", "الدقة", "فائت", "الحالة"],
        rows,
      }))}
    </div>
    ${insufficient > 0 ? noteBox("المنافذ ذات البيانات غير الكافية تُوصف ولا تُرتّب (لا تُطبع 0% على مقام فارغ).") : ""}
    ${executiveClose(portAccuracyClose(best, weakest, insufficient))}`;
  return page({ id: "page-acc-port", title: "الدقة حسب المنفذ", pageNo, railTabs: TABS, body });
}

export function buildLevelComparison(model: ReportModel, pageNo: string): string {
  const k = model.kpis;
  const grouped = groupedBars(
    {
      groups: ["الدقة"],
      series: [
        { label: "المستوى الأول", values: [k.levelOneAccuracy ?? 0] },
        { label: "المستوى الثاني", values: [k.levelTwoAccuracy ?? 0] },
      ],
    },
    { width: 300, height: 200 },
  );

  const body = `${pageHeader({ iconName: "layers", eyebrow: "الجزء الثاني · الحُكم", title: "المستوى الأول مقابل الثاني", subtitle: "هل تساعد المراجعة المزدوجة؟" })}
    ${kpiStrip([
      kpi({ label: "دقة م. الأول", value: fmtPct(k.levelOneAccuracy), tone: "gold" }),
      kpi({ label: "دقة م. الثاني", value: fmtPct(k.levelTwoAccuracy), tone: "blue" }),
      kpi({ label: "تصحيح", value: fmtPct(k.levelTwoCorrectionRate), tone: "green" }),
      kpi({ label: "تراجع", value: fmtPct(k.levelTwoRegressionRate), tone: "coral" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("دقة المستويين", figure(grouped, { height: 210 }), { iconName: "chart" })}
      ${panel("التصحيح مقابل التراجع", `
        <div class="doc-flow">
          <div class="doc-flow-cell good"><span class="muted">تصحيح المستوى الثاني</span><b class="metric green">${fmtPct(k.levelTwoCorrectionRate)}</b></div>
          <div class="doc-flow-cell bad"><span class="muted">تراجع المستوى الثاني</span><b class="metric coral">${fmtPct(k.levelTwoRegressionRate)}</b></div>
          <div class="doc-flow-cell"><span class="muted">معدل اختلاف المستويين</span><b class="metric slate">${fmtPct(k.levelDisagreementRate)}</b></div>
        </div>`)}
    </div>
    ${executiveClose(levelClose(k.levelOneAccuracy, k.levelTwoAccuracy, k.levelTwoCorrectionRate, k.levelTwoRegressionRate))}`;
  return page({ id: "page-levels", title: "المستوى الأول مقابل الثاني", pageNo, railTabs: TABS, body });
}

export function buildQualityImpact(model: ReportModel, pageNo: string): string {
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
    { width: 300, height: 200 },
  );
  const rows = [
    ["توفر الصورة", fmtPct(q.availabilityRate)],
    ["وجود التحديد", fmtPct(q.markingRate)],
    ["الجودة المقبولة", fmtPct(q.acceptableQualityRate)],
    ["جودة عالية", fmtNum(q.highQualityCount)],
    ["جودة متوسطة", fmtNum(q.mediumQualityCount)],
    ["جودة منخفضة", fmtNum(q.lowQualityCount)],
  ];

  const body = `${pageHeader({ iconName: "scan", eyebrow: "الجزء الثاني · المحرّكات", title: "جودة الصورة والتحديد", subtitle: "ما يرتبط بدقة القرار" })}
    ${kpiStrip([
      kpi({ label: "الجودة المقبولة", value: fmtPct(q.acceptableQualityRate), tone: "gold" }),
      kpi({ label: "وجود التحديد", value: fmtPct(q.markingRate), tone: "blue" }),
      kpi({ label: "توفر الصورة", value: fmtPct(q.availabilityRate), tone: "green" }),
    ], 3)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("توزيع جودة الصور", figure(grouped, { height: 210 }), { iconName: "chart" })}
      ${panel("مؤشرات الجودة والتحديد", dataTable({ headers: ["المؤشر", "القيمة"], rows }))}
    </div>
    ${noteBox("العلاقة بين الجودة/التحديد والدقة ارتباطية وليست سببية.")}
    ${executiveClose(qualityClose(q.acceptableQualityRate, q.markingRate))}`;
  return page({ id: "page-quality", title: "جودة الصورة والتحديد", pageNo, railTabs: TABS, body });
}

function bandChip(b: string): string {
  if (b === "sufficient") return statusChip("stable");
  if (b === "limited") return statusChip("limited");
  return statusChip("insufficient");
}
