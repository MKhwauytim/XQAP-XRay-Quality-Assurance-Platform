// Part 4 — Accountability (L1/L2 inspectors). Employee overview, accuracy-by-
// decision quadrant, one page per port (keyed on inspectorId, with the explicit
// unmapped-BI empty state per §3.4), and a port comparison summary.
// Driven from ReportModel.employeeByPort / portAccuracy.

import type { ReportModel } from "../model/reportModel";
import type { EmployeeByPortLevel, KeyedAccuracy } from "../model/aggregates";
import { quadrantScatter, rankedBar } from "../ui/charts";
import { isRankable } from "../model/dataSufficiency";
import { fmtNum, fmtPct } from "../primitives";
import {
  executiveClose,
  emptyState,
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
import { employeeClose, portAccuracyClose } from "./narrative";

const TABS = ["الجزء الرابع", "الجزء الأول", "الجزء الثاني", "الجزء الثالث", "الجزء الخامس"];

const UNMAPPED_TITLE = "هوية المفتش غير مرتبطة (لم تتم مطابقة BI)";
const UNMAPPED_DETAIL =
  "تتطلب المساءلة الفردية ربط هوية المفتش من بيانات BI. لم تتم المطابقة هذه الفترة، لذا لا تُعرض أسماء أو أرقام مفتشين، ولا تُنسب الدقة لأي فرد.";

function bandChip(b: string): string {
  if (b === "sufficient") return statusChip("stable");
  if (b === "limited") return statusChip("limited");
  return statusChip("insufficient");
}

export function buildEmployeeOverview(model: ReportModel, pageNo: string): string {
  const eo = model.employeeOverview;
  const header = pageHeader({
    iconName: "users",
    eyebrow: "الجزء الرابع · المساءلة",
    title: "النظرة العامة للمفتشين",
    subtitle: "دقة قرارات المستوى الأول والثاني حسب هوية المفتش",
  });

  if (!eo.inspectorIdentityMapped) {
    const body = `${header}
      ${emptyState(UNMAPPED_TITLE, UNMAPPED_DETAIL)}
      ${executiveClose(employeeClose(false, 0, null))}`;
    return page({ id: "page-emp-overview", title: "النظرة العامة للمفتشين", pageNo, railTabs: TABS, body });
  }

  // Aggregate per inspector across levels/ports from employeeByPort.
  const byInspector = aggregateByInspector(model.employeeByPort);
  const rankable = byInspector.filter((e) => isRankable(e.band) && e.accuracy !== null);
  const ranked = [...rankable].sort((a, b) => (b.accuracy as number) - (a.accuracy as number));
  const best = ranked[0]?.inspectorId ?? null;
  const avgAccuracy = avg(rankable.map((e) => e.accuracy as number));

  const bars = ranked.slice(0, 8).map((e) => ({ label: e.inspectorId, value: e.accuracy as number }));
  const rows = byInspector.map((e) => [
    e.inspectorId,
    fmtNum(e.evaluable),
    isRankable(e.band) ? fmtPct(e.accuracy) : null,
    isRankable(e.band) ? fmtPct(e.detectionRate) : null,
    bandChip(e.band),
  ]);

  const body = `${header}
    ${kpiStrip([
      kpi({ label: "مفتشون مقيَّمون", value: fmtNum(eo.evaluatedCount), tone: "gold" }),
      kpi({ label: "إجمالي القرارات", value: fmtNum(eo.totalDecisions), tone: "slate" }),
      kpi({ label: "متوسط الدقة", value: fmtPct(avgAccuracy), tone: "blue" }),
      kpi({ label: "الأعلى دقة", value: best ?? "—", tone: "green" }),
    ], 4)}
    <div class="grid grid-2" style="margin-top:14px">
      ${panel("ترتيب الدقة (الكافية)", figure(rankedBar(bars, { width: 360 }), { height: 230 }), { iconName: "chart" })}
      ${panel("المفتشون", dataTable({ headers: ["المفتش", "قرارات", "الدقة", "الكشف", "الحالة"], rows }))}
    </div>
    ${executiveClose(employeeClose(true, eo.evaluatedCount, avgAccuracy))}`;
  return page({ id: "page-emp-overview", title: "النظرة العامة للمفتشين", pageNo, railTabs: TABS, body });
}

export function buildAccuracyByDecision(model: ReportModel, pageNo: string): string {
  const header = pageHeader({
    iconName: "chart",
    eyebrow: "الجزء الرابع · المساءلة",
    title: "الدقة حسب نوع القرار",
    subtitle: "الدقة × الكشف لكل مفتش",
  });
  if (!model.employeeOverview.inspectorIdentityMapped) {
    const body = `${header}${emptyState(UNMAPPED_TITLE, UNMAPPED_DETAIL)}${executiveClose(employeeClose(false, 0, null))}`;
    return page({ id: "page-emp-decision", title: "الدقة حسب نوع القرار", pageNo, railTabs: TABS, body });
  }

  const byInspector = aggregateByInspector(model.employeeByPort).filter((e) => isRankable(e.band));
  const points = byInspector.map((e) => ({
    label: e.inspectorId,
    x: e.accuracy ?? 0,
    y: e.detectionRate ?? 0,
  }));
  const rows = byInspector.map((e) => [
    e.inspectorId,
    isRankable(e.band) ? fmtPct(e.accuracy) : null,
    isRankable(e.band) ? fmtPct(e.detectionRate) : null,
    isRankable(e.band) ? fmtPct(e.missedSuspicionRate) : null,
  ]);

  const t = model.errorAnalysis.totals;
  const body = `${header}
    ${kpiStrip([
      kpi({ label: "دقة الفحص", value: fmtPct(model.summary.overallAccuracy), tone: "gold" }),
      kpi({ label: "اكتشاف الاشتباه", value: fmtPct(model.summary.detectionRate), tone: "blue" }),
      kpi({ label: "اشتباه فائت", value: fmtNum(t.missedSuspicion), tone: "coral" }),
      kpi({ label: "اشتباه خاطئ", value: fmtNum(t.falseSuspicion), tone: "slate" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("الدقة × الكشف", figure(quadrantScatter(points, { width: 280, height: 260 }), { height: 280, caption: "الأفقي: الدقة · الرأسي: الكشف" }), { iconName: "chart" })}
      ${panel("تفصيل المفتشين", dataTable({ headers: ["المفتش", "الدقة", "الكشف", "فائت"], rows }))}
    </div>
    ${executiveClose({
      shows: "يوزّع المخطط المفتشين حسب الدقة والكشف في أربعة أرباع.",
      matters: "الربع المنخفض في كليهما يمثل أولوية التدخل.",
      action: "توجيه التدريب للمفتشين في الربع منخفض الدقة والكشف.",
    })}`;
  return page({ id: "page-emp-decision", title: "الدقة حسب نوع القرار", pageNo, railTabs: TABS, body });
}

/** One page per port (land first, by volume). Keyed on inspectorId; unmapped → empty state. */
export function buildPerPortPages(model: ReportModel, startPageNo: number): { html: string[]; nextPageNo: number } {
  const html: string[] = [];
  let pageNo = startPageNo;

  // Order ports by population (land inferred via portType in factTable).
  const portOrder = orderedPortNames(model);

  for (const portName of portOrder) {
    const no = String(pageNo).padStart(2, "0");
    pageNo += 1;
    const header = pageHeader({
      iconName: "port",
      eyebrow: "الجزء الرابع · المساءلة",
      title: `المنفذ: ${portName}`,
      subtitle: "أداء المفتشين على هذا المنفذ",
    });

    const portAcc = model.portAccuracy.find((p) => p.key === portName);
    const inspectors = model.employeeByPort.filter((e) => e.portName === portName);

    if (!model.employeeOverview.inspectorIdentityMapped || inspectors.length === 0) {
      const body = `${header}
        ${kpiStrip([
          kpi({ label: "قرارات قابلة للتقييم", value: portAcc ? fmtNum(portAcc.evaluable) : "—", tone: "slate" }),
          kpi({ label: "دقة المنفذ", value: portAcc && isRankable(portAcc.band) ? fmtPct(portAcc.accuracy) : "—", tone: "gold" }),
          kpi({ label: "اشتباه فائت", value: portAcc && isRankable(portAcc.band) ? fmtPct(portAcc.missedSuspicionRate) : "—", tone: "coral" }),
        ], 3)}
        ${emptyState(UNMAPPED_TITLE, UNMAPPED_DETAIL)}
        ${executiveClose(employeeClose(false, 0, null))}`;
      html.push(page({ id: `page-port-${slug(portName)}`, title: `المنفذ: ${portName}`, pageNo: no, railTabs: TABS, body }));
      continue;
    }

    const l1 = inspectors.filter((e) => e.level === "LEVEL_1");
    const l2 = inspectors.filter((e) => e.level === "LEVEL_2");
    const insufficientPort = !portAcc || !isRankable(portAcc.band);

    const inspectorRows = (block: EmployeeByPortLevel[]): (string | null)[][] =>
      block.map((e) => [
        e.inspectorId,
        fmtNum(e.evaluable),
        isRankable(e.band) ? fmtPct(e.accuracy) : null,
        isRankable(e.band) ? fmtPct(e.detectionRate) : null,
        isRankable(e.band) ? fmtPct(e.missedSuspicionRate) : null,
        bandChip(e.band),
      ]);

    const body = `${header}
      ${kpiStrip([
        kpi({ label: "قرارات قابلة للتقييم", value: portAcc ? fmtNum(portAcc.evaluable) : "—", tone: "slate" }),
        kpi({ label: "عدد المفتشين", value: fmtNum(new Set(inspectors.map((e) => e.inspectorId)).size), tone: "blue" }),
        kpi({ label: "دقة المنفذ", value: portAcc && isRankable(portAcc.band) ? fmtPct(portAcc.accuracy) : "—", tone: "gold" }),
        kpi({ label: "اشتباه فائت", value: portAcc && isRankable(portAcc.band) ? fmtPct(portAcc.missedSuspicionRate) : "—", tone: "coral" }),
      ], 4)}
      <div class="grid grid-2" style="margin-top:14px">
        ${panel("المستوى الأول", dataTable({ headers: ["المفتش", "قرارات", "الدقة", "الكشف", "فائت", "الحالة"], rows: inspectorRows(l1) }), { iconName: "layers" })}
        ${panel("المستوى الثاني", dataTable({ headers: ["المفتش", "قرارات", "الدقة", "الكشف", "فائت", "الحالة"], rows: inspectorRows(l2) }), { iconName: "layers" })}
      </div>
      ${insufficientPort ? noteBox("بيانات هذا المنفذ غير كافية للترتيب؛ تُعرض الأرقام للوصف فقط.") : ""}
      ${executiveClose({
        shows: portAcc && isRankable(portAcc.band)
          ? `دقة المنفذ ${fmtPct(portAcc.accuracy)} مع اشتباه فائت ${fmtPct(portAcc.missedSuspicionRate)}.`
          : "بيانات المنفذ غير كافية لاستخلاص دقة موثوقة.",
        matters: "أداء المفتشين على مستوى المنفذ يوجّه الدعم المحلي.",
        action: insufficientPort ? "زيادة حجم العينة على هذا المنفذ قبل اتخاذ قرارات." : "متابعة المفتشين الأقل دقة على هذا المنفذ.",
      })}`;
    html.push(page({ id: `page-port-${slug(portName)}`, title: `المنفذ: ${portName}`, pageNo: no, railTabs: TABS, body }));
  }

  return { html, nextPageNo: pageNo };
}

export function buildPortComparison(model: ReportModel, pageNo: string): string {
  const ports = [...model.portAccuracy];
  const rankable = ports.filter((p) => isRankable(p.band) && p.accuracy !== null);
  const ranked = [...rankable].sort((a, b) => (b.accuracy as number) - (a.accuracy as number));
  const strongest = ranked[0]?.key ?? null;
  const weakest = ranked.length > 0 ? ranked[ranked.length - 1].key : null;
  const insufficient = ports.filter((p) => !isRankable(p.band)).length;
  const highestMissed = [...rankable].sort((a, b) => (b.missedSuspicionRate ?? -1) - (a.missedSuspicionRate ?? -1))[0]?.key ?? null;

  const bars = ranked.slice(0, 8).map((p) => ({ label: p.key, value: p.accuracy as number }));
  const rows = ports.map((p) => [
    p.key,
    fmtNum(p.evaluable),
    isRankable(p.band) ? fmtPct(p.accuracy) : null,
    isRankable(p.band) ? fmtPct(p.detectionRate) : null,
    isRankable(p.band) ? fmtPct(p.missedSuspicionRate) : null,
    isRankable(p.band) ? fmtPct(p.falseSuspicionRate) : null,
    bandChip(p.band),
  ]);

  const body = `${pageHeader({ iconName: "port", eyebrow: "الجزء الرابع · المساءلة", title: "مقارنة المنافذ", subtitle: "الأقوى والأضعف وأعلى اشتباه فائت" })}
    ${kpiStrip([
      kpi({ label: "الأقوى", value: strongest ?? "—", tone: "green" }),
      kpi({ label: "الأضعف", value: weakest ?? "—", tone: "coral" }),
      kpi({ label: "أعلى اشتباه فائت", value: highestMissed ?? "—", tone: "gold" }),
      kpi({ label: "غير كافية", value: fmtNum(insufficient), tone: "slate" }),
    ], 4)}
    <div class="grid grid-2" style="margin-top:14px">
      ${panel("ترتيب دقة المنافذ", figure(rankedBar(bars, { width: 360 }), { height: 230 }), { iconName: "chart" })}
      ${panel("مقارنة المنافذ", dataTable({ headers: ["المنفذ", "قرارات", "الدقة", "الكشف", "فائت", "خاطئ", "الحالة"], rows }))}
    </div>
    ${executiveClose(portAccuracyClose(strongest, weakest, insufficient))}`;
  return page({ id: "page-port-compare", title: "مقارنة المنافذ", pageNo, railTabs: TABS, body });
}

// ── helpers ──────────────────────────────────────────────────────────────────

type InspectorAgg = KeyedAccuracy & { inspectorId: string };

function aggregateByInspector(byPort: EmployeeByPortLevel[]): InspectorAgg[] {
  const map = new Map<string, { evaluable: number; correctClean: number; correctSuspicion: number; missedSuspicion: number; falseSuspicion: number }>();
  for (const e of byPort) {
    const cur = map.get(e.inspectorId) ?? { evaluable: 0, correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
    cur.evaluable += e.evaluable;
    cur.correctClean += e.correctClean;
    cur.correctSuspicion += e.correctSuspicion;
    cur.missedSuspicion += e.missedSuspicion;
    cur.falseSuspicion += e.falseSuspicion;
    map.set(e.inspectorId, cur);
  }
  return [...map.entries()].map(([inspectorId, c]) => {
    const reviewerSusp = c.correctSuspicion + c.missedSuspicion;
    const reviewerClean = c.correctClean + c.falseSuspicion;
    const accuracy = c.evaluable > 0 ? ((c.correctClean + c.correctSuspicion) / c.evaluable) * 100 : null;
    const detectionRate = reviewerSusp > 0 ? (c.correctSuspicion / reviewerSusp) * 100 : null;
    const missedSuspicionRate = reviewerSusp > 0 ? (c.missedSuspicion / reviewerSusp) * 100 : null;
    const suspicionDecisionAccuracy = c.correctSuspicion + c.falseSuspicion > 0 ? (c.correctSuspicion / (c.correctSuspicion + c.falseSuspicion)) * 100 : null;
    const falseSuspicionRate = reviewerClean > 0 ? (c.falseSuspicion / reviewerClean) * 100 : null;
    const b = c.evaluable >= 20 ? "sufficient" : c.evaluable >= 10 ? "limited" : c.evaluable >= 1 ? "insufficient" : "none";
    return {
      key: inspectorId,
      inspectorId,
      ...c,
      accuracy,
      detectionRate,
      missedSuspicionRate,
      suspicionDecisionAccuracy,
      falseSuspicionRate,
      band: b as InspectorAgg["band"],
    };
  });
}

function orderedPortNames(model: ReportModel): string[] {
  // population by port carries volume + we infer land/sea from factTable portType.
  const seaPorts = new Set<string>();
  for (const rec of model.factTable) {
    if (rec.portName && rec.portType && rec.portType.includes("بحر")) seaPorts.add(rec.portName);
  }
  const ports = [...model.population.byPort].sort((a, b) => b.population - a.population);
  const land = ports.filter((p) => !seaPorts.has(p.portName)).map((p) => p.portName);
  const sea = ports.filter((p) => seaPorts.has(p.portName)).map((p) => p.portName);
  return [...land, ...sea];
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9؀-ۿ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "port";
}
