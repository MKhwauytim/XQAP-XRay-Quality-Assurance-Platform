// Part 1 — Scope & Method. Population at a glance, by port, by stage×port,
// sample & completion, data quality & exclusions. Driven from ReportModel.

import type { ReportModel } from "../model/reportModel";
import { donut, gauge, rankedBar, stackedBars } from "../ui/charts";
import { fmtNum, fmtPct } from "../primitives";
import {
  esc,
  executiveClose,
  figure,
  kpi,
  kpiStrip,
  noteBox,
  page,
  pageHeader,
  panel,
} from "./shared";
import { dataTable } from "./pagination";
import {
  coverageClose,
  populationClose,
} from "./narrative";

const TABS = ["الجزء الأول", "الجزء الثاني", "الجزء الثالث", "الجزء الرابع", "الجزء الخامس"];

function landSeaSplit(model: ReportModel): { land: number; sea: number } {
  // PortProfile carries no port type; infer land/sea from each case's portType via
  // the fact table, counting each case once (LEVEL_1 record).
  let land = 0;
  let sea = 0;
  for (const rec of model.factTable) {
    if (rec.decisionLevel !== "LEVEL_1") continue;
    if (rec.portType && rec.portType.includes("بحر")) sea += 1;
    else land += 1;
  }
  return { land, sea };
}

export function buildPopulationGlance(model: ReportModel, pageNo: string): string {
  const { land, sea } = landSeaSplit(model);
  const ports = model.population.byPort.length;
  const movementCounts = new Map<string, number>();
  for (const rec of model.factTable) {
    if (rec.decisionLevel !== "LEVEL_1") continue;
    const m = rec.movementType ?? "غير محدد";
    movementCounts.set(m, (movementCounts.get(m) ?? 0) + 1);
  }
  const movementBars = [...movementCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const body = `${pageHeader({ iconName: "layers", eyebrow: "الجزء الأول · النطاق", title: "مجتمع الحالات في لمحة", subtitle: "الحجم الإجمالي وتوزيع الحركة" })}
    ${kpiStrip([
      kpi({ label: "إجمالي الحالات", value: fmtNum(model.population.total), tone: "gold" }),
      kpi({ label: "بري", value: fmtNum(land), tone: "green" }),
      kpi({ label: "بحري", value: fmtNum(sea), tone: "blue" }),
      kpi({ label: "عدد المنافذ", value: fmtNum(ports), tone: "slate" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("توزيع الحركة (بري / بحري)", figure(donut([
        { label: "بري", value: land },
        { label: "بحري", value: sea },
      ], { width: 220, height: 200 }), { height: 210 }), { iconName: "chart" })}
      ${panel("الحالات حسب نمط الحركة", figure(rankedBar(movementBars, { width: 360, height: 200 }), { height: 210 }), { iconName: "chart" })}
    </div>
    ${executiveClose(populationClose(model.population.total, model.population.suspicionRate, ports))}`;
  return page({ id: "page-pop-glance", title: "مجتمع الحالات في لمحة", pageNo, railTabs: TABS, body });
}

export function buildPopulationByPort(model: ReportModel, pageNo: string): string {
  const ports = [...model.population.byPort].sort((a, b) => b.population - a.population);
  const top = ports[0];
  const topShare = top && model.population.total > 0 ? (top.population / model.population.total) * 100 : null;
  const bars = ports.slice(0, 8).map((p) => ({ label: p.portName, value: p.population }));
  const rows = ports.map((p) => [
    p.portName,
    fmtNum(p.population),
    fmtNum(p.clean),
    fmtNum(p.suspicious),
    fmtPct(p.suspicionRate),
  ]);
  const table = dataTable({
    headers: ["المنفذ", "المجتمع", "سليمة", "اشتباه", "نسبة الاشتباه"],
    rows,
    totalRow: ["الإجمالي", fmtNum(model.population.total), fmtNum(model.population.clean), fmtNum(model.population.suspicious), fmtPct(model.population.suspicionRate)],
  });

  const body = `${pageHeader({ iconName: "port", eyebrow: "الجزء الأول · النطاق", title: "المجتمع حسب المنفذ", subtitle: "التركّز والتوزيع" })}
    ${kpiStrip([
      kpi({ label: "أعلى منفذ", value: top ? top.portName : "—", tone: "gold" }),
      kpi({ label: "حصة أعلى منفذ", value: topShare === null ? "—" : fmtPct(topShare), tone: "blue" }),
      kpi({ label: "عدد المنافذ", value: fmtNum(ports.length), tone: "slate" }),
    ], 3)}
    <div class="grid grid-2" style="margin-top:14px">
      ${panel("أكبر المنافذ", figure(rankedBar(bars, { width: 360 }), { height: 230 }), { iconName: "chart" })}
      ${panel("تفصيل المنافذ", table, { fill: false })}
    </div>
    ${executiveClose(populationClose(model.population.total, model.population.suspicionRate, ports.length))}`;
  return page({ id: "page-pop-port", title: "المجتمع حسب المنفذ", pageNo, railTabs: TABS, body });
}

export function buildPopulationByStage(model: ReportModel, pageNo: string): string {
  const stages = model.population.byStage;
  const stageShare = stages.map((s) => ({ label: s.stageLabel, value: s.population }));
  const rows = stages.map((s) => [s.stageLabel, fmtNum(s.population), fmtNum(s.sampleSize), fmtPct(s.coverage)]);

  const body = `${pageHeader({ iconName: "layers", eyebrow: "الجزء الأول · النطاق", title: "المجتمع حسب المستوى والمنفذ", subtitle: "توزيع الحالات على مستويات الدراسة" })}
    ${kpiStrip(stages.slice(0, 4).map((s, i) => kpi({ label: s.stageLabel, value: fmtNum(s.population), tone: (["gold", "blue", "slate", "coral"][i] ?? "gold") as "gold" })), Math.max(1, Math.min(4, stages.length)))}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("حصة المستويات", figure(donut(stageShare, { width: 220, height: 200 }), { height: 210 }), { iconName: "chart" })}
      ${panel("المستويات والعينة", dataTable({ headers: ["المستوى", "المجتمع", "العينة", "التغطية"], rows }))}
    </div>
    ${executiveClose({
      shows: `توزّعت الحالات على ${fmtNum(stages.length)} مستويات للدراسة.`,
      matters: "توزيع المستويات يوضح أين تتركّز أعباء الفحص والمراجعة.",
      action: "موازنة العينة عبر المستويات بما يضمن تمثيلًا عادلًا.",
    })}`;
  return page({ id: "page-pop-stage", title: "المجتمع حسب المستوى", pageNo, railTabs: TABS, body });
}

export function buildSampleCompletion(model: ReportModel, pageNo: string): string {
  const stageRows = model.population.byStage.map((s) => [
    s.stageLabel,
    fmtNum(s.population),
    fmtNum(s.sampleSize),
    fmtPct(s.coverage),
    fmtNum(s.studied),
    fmtPct(s.completionRate),
  ]);
  const fullPopulation = model.sample.coverage !== null && model.sample.coverage >= 99.5;

  const body = `${pageHeader({ iconName: "scan", eyebrow: "الجزء الأول · المنهجية", title: "العينة والإنجاز", subtitle: "التغطية ونسبة الدراسة" })}
    ${kpiStrip([
      kpi({ label: "المجتمع", value: fmtNum(model.population.total), tone: "slate" }),
      kpi({ label: "العينة", value: fmtNum(model.sample.total), tone: "gold" }),
      kpi({ label: "التغطية", value: fmtPct(model.sample.coverage), tone: "blue" }),
      kpi({ label: "مدروسة", value: fmtNum(model.sample.studied), tone: "green" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("نسبة التغطية", figure(gauge(model.sample.coverage, { width: 240, height: 160 }), { height: 200 }), { iconName: "gauge" })}
      ${panel("العينة حسب المستوى", dataTable({ headers: ["المستوى", "المجتمع", "العينة", "التغطية", "مدروسة", "الإنجاز"], rows: stageRows }))}
    </div>
    ${fullPopulation ? noteBox("تمت دراسة المجتمع بالكامل لهذه الفترة (تغطية 100%).", "check") : ""}
    ${executiveClose(coverageClose(model.sample.coverage, model.sample.completionRate))}`;
  return page({ id: "page-sample", title: "العينة والإنجاز", pageNo, railTabs: TABS, body });
}

export function buildDataQualityExclusions(model: ReportModel, pageNo: string): string {
  const stacked = stackedBars(
    {
      groups: ["البيانات"],
      series: [
        { label: "معالجة", values: [model.population.total] },
        { label: "مستبعدة", values: [Math.max(0, model.dataQuality.totalDecisionRecords / 2 - model.population.total)] },
      ],
    },
    { width: 200, height: 200 },
  );

  const body = `${pageHeader({ iconName: "document", eyebrow: "الجزء الأول · المنهجية", title: "جودة البيانات والاستبعادات", subtitle: "الصدق في عرض النواقص" })}
    ${kpiStrip([
      kpi({ label: "حالات معالجة", value: fmtNum(model.population.total), tone: "green" }),
      kpi({ label: "قرارات قابلة للتقييم", value: fmtNum(model.dataQuality.evaluableDecisionRecords), tone: "gold" }),
      kpi({ label: "حالة BI", value: model.dataQuality.biAvailable ? "متاحة" : "غير متاحة", tone: model.dataQuality.biAvailable ? "blue" : "coral" }),
    ], 3)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("نظرة على المعالجة", figure(stacked, { height: 210 }), { iconName: "chart" })}
      ${panel("ملاحظات جودة البيانات", `
        <ul class="doc-list">
          <li>${esc(model.exclusions.note)}</li>
          <li>${model.dataQuality.inspectorIdentityMapped ? "هوية المفتش مرتبطة عبر BI." : "هوية المفتش غير مرتبطة (لم تتم مطابقة BI) — تُعرض الدقة الفردية كحالة فارغة."}</li>
          <li>القيم الناقصة تُعرض "—" ولا تُحتسب كـ "0%".</li>
        </ul>`)}
    </div>
    ${noteBox(`نطاق كفاية البيانات الإجمالي: ${bandLabel(model.dataQuality.overallBand)}.`, "alert")}
    ${executiveClose({
      shows: `${fmtNum(model.population.total)} حالة معالجة و${fmtNum(model.dataQuality.evaluableDecisionRecords)} قرار قابل للتقييم.`,
      matters: "شفافية الاستبعادات والنواقص شرط لمصداقية النتائج.",
      action: model.dataQuality.biAvailable ? "متابعة اكتمال البيانات للفترات القادمة." : "إكمال مطابقة BI لتفعيل المساءلة الفردية.",
    })}`;
  return page({ id: "page-data-quality", title: "جودة البيانات والاستبعادات", pageNo, railTabs: TABS, body });
}

function bandLabel(b: string): string {
  return b === "sufficient" ? "كافٍ" : b === "limited" ? "محدود" : b === "insufficient" ? "غير كافٍ" : "لا توجد بيانات";
}
