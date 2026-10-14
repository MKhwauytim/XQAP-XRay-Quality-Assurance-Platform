// الملاحظات والتوصيات: the report's key observations and the recommendation for each, drafted from its own results by
// fixed rules (no model, no guessing).
//
// Each OBSERVATION says what stands out and what it means, the way an analyst reads the report ("image quality at port X
// is below the other ports, which may weaken prohibited-item detection"). Port observations compare a port with ONE fixed
// baseline per port type: the pooled figure of every land (or sea) port, the same «إجمالي» the report tables show. The numbers
// behind an observation are kept apart from its sentence as `figures` (shown as a separate labelled row under it, and
// on the second sheet of the workbook), so the text stays readable and every observation can still be checked. The
// RECOMMENDATION is a drafted starting point for the owner to edit.
import * as XLSX from "xlsx";
import { fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { buildReportModel } from "../model/reportModel";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import {
  accuracyOf, collectPortAccuracy, collectPortMarkingOnly, collectPortQuality, collectQualityImageOutcomes, sumCounts,
  type FourCounts, type Statement, type StatementFigure, type StatementPriority,
} from "./slides";

/** A group with fewer answers than this is too thin to name in an observation. */
const MIN_BASE = 1000;
/** Per-category cap on named ports, and on the whole list — a list nobody reads helps nobody. */
const MAX_PORTS_PER_TOPIC = 2;
const MAX_STATEMENTS = 15;
const ORDER: Record<StatementPriority, number> = { "عالية": 0, "متوسطة": 1, "للعلم": 2 };

export type PortShare = { name: string; sea: boolean; num: number; den: number };
export type PortOutlier = { name: string; sea: boolean; share: number; baseShare: number; gap: number; den: number };

const groupLabel = (sea: boolean) => (sea ? "المنافذ البحرية" : "المنافذ البرية");

/**
 * Ports whose share differs from their type's BASELINE by at least `minGap` points, in the stated direction.
 * The baseline is ONE fixed figure per port type: the pooled share of every port of that type (the same «إجمالي»
 * the report's port tables show). It does not change with the port being judged, so every observation on the same
 * measure quotes the same comparison number. Only ports with at least `minDen` cases are judged. Biggest gap first.
 */
export function findOutliers(stats: PortShare[], direction: "low" | "high", minDen: number, minGap: number): PortOutlier[] {
  const baseline = (sea: boolean) => {
    const group = stats.filter((s) => s.sea === sea);
    const den = group.reduce((a, s) => a + s.den, 0);
    return den === 0 ? null : (group.reduce((a, s) => a + s.num, 0) / den) * 100;
  };
  const base = { land: baseline(false), sea: baseline(true) };
  const out: PortOutlier[] = [];
  for (const s of stats) {
    const baseShare = s.sea ? base.sea : base.land;
    if (s.den < minDen || baseShare === null) continue;
    const share = (s.num / s.den) * 100;
    const gap = share - baseShare;
    if (direction === "low" ? gap <= -minGap : gap >= minGap) out.push({ name: s.name, sea: s.sea, share, baseShare, gap, den: s.den });
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || (a.name < b.name ? -1 : 1));
}

export function buildStatements(model: ReportModel): Statement[] {
  const out: Statement[] = [];
  const F = (label: string, value: string): StatementFigure => ({ label, value });
  const add = (s: { priority: StatementPriority; topic: string; text: string; recommendation: string; figures: StatementFigure[]; page: string }) =>
    out.push({ ...s, plain: s.text, basis: s.figures.map((f) => `${f.label}: ${f.value}`).join(" | ") });
  const t = model.errorAnalysis.totals;
  const all = accuracyOf(t);
  if (all.evaluable === 0) return out;

  const portAcc = collectPortAccuracy(model);
  const portRows = [...portAcc.land, ...portAcc.sea];

  // ── Land vs sea ───────────────────────────────────────────────────────────────────────────────────────────────
  const land = accuracyOf(sumCounts(portAcc.land.map((p) => p.counts)));
  const sea = accuracyOf(sumCounts(portAcc.sea.map((p) => p.counts)));
  if (land.evaluable >= MIN_BASE && sea.evaluable >= MIN_BASE && land.overall !== null && sea.overall !== null && Math.abs(land.overall - sea.overall) >= 2) {
    const [lowName, highName] = land.overall < sea.overall ? ["البرية", "البحرية"] : ["البحرية", "البرية"];
    add({
      priority: "متوسطة", topic: "المنافذ",
      text: `التوافق في المنافذ ${lowName} أقل من المنافذ ${highName}، فالتحسين فيها أكبر أثرًا على دقة النتائج.`,
      recommendation: `إعطاء المنافذ ${lowName} أولوية في المتابعة، والتأكد من تطبيق معايير الاشتباه بنفس الطريقة لدى الفاحصين فيها بشكل دوري.`,
      figures: [F("معدل الاتفاق · المنافذ البرية", fmtPct(land.overall)), F("معدل الاتفاق · المنافذ البحرية", fmtPct(sea.overall)), F("الإجابات المفحوصة", fmtNum(land.evaluable + sea.evaluable))],
      page: "نتائج الأداء للمنافذ",
    });
  }

  // ── Port outliers: each port against the rest of its type ─────────────────────────────────────────────────────
  const quality = collectPortQuality(model);
  const qualityStats: PortShare[] = portRows.map((p) => {
    const q = quality.get(p.name);
    return { name: p.name, sea: p.sea, num: q?.high ?? 0, den: q?.images ?? 0 };
  });
  for (const o of findOutliers(qualityStats, "low", 300, 10).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: o.gap <= -20 ? "عالية" : "متوسطة", topic: "جودة الصورة",
      text: `جودة الصور الملتقطة في منفذ ${o.name} أقل من إجمالي ${groupLabel(o.sea)}، مما قد يسبب ضعفًا في جودة كشف المواد الممنوعة.`,
      recommendation: `التأكد من جودة التقاط جهاز الأشعة للصور في منفذ ${o.name}، ومتابعة عدة حالات للتأكد من جودة الجهاز مقارنةً بإجمالي ${groupLabel(o.sea)} بشكل شهري.`,
      figures: [F(`صور عالية الجودة · ${o.name}`, fmtPct(o.share)), F(`صور عالية الجودة · إجمالي ${groupLabel(o.sea)}`, fmtPct(o.baseShare)), F(`صور ${o.name} المفحوصة`, fmtNum(o.den))],
      page: "جودة الصور المفحوصة",
    });
  }

  const missedStats: PortShare[] = portRows.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.missedSuspicion, den: p.counts.correctClean + p.counts.missedSuspicion }));
  for (const o of findOutliers(missedStats, "high", 500, 10).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: o.gap >= 20 ? "عالية" : "متوسطة", topic: "الاشتباهات الفائتة",
      text: `نسبة الاشتباهات الفائتة في منفذ ${o.name} أعلى من إجمالي ${groupLabel(o.sea)}.`,
      recommendation: `مراجعة عدة حالات مصنّفة سليمة في منفذ ${o.name} للتأكد من عدم وجود اشتباهات لم تُكتشف، ومقارنة النتائج بإجمالي ${groupLabel(o.sea)} بشكل شهري.`,
      figures: [F(`الاشتباهات الفائتة · ${o.name}`, fmtPct(o.share)), F(`الاشتباهات الفائتة · إجمالي ${groupLabel(o.sea)}`, fmtPct(o.baseShare)), F(`إجابات السليمة في ${o.name}`, fmtNum(o.den))],
      page: "نتائج الأداء للمنافذ",
    });
  }

  const falseStats: PortShare[] = portRows.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.falseSuspicion, den: p.counts.correctSuspicion + p.counts.falseSuspicion }));
  for (const o of findOutliers(falseStats, "high", 300, 10).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: "متوسطة", topic: "الاشتباهات الخاطئة",
      text: `تكثر الاشتباهات الخاطئة في منفذ ${o.name} مقارنة بإجمالي ${groupLabel(o.sea)}.`,
      recommendation: `مراجعة عدة حالات اشتباه في منفذ ${o.name} للتأكد من استحقاقها، وتوضيح معايير الاشتباه للفاحصين لتقليل الاشتباهات غير المستحقة.`,
      figures: [F(`الاشتباهات الخاطئة · ${o.name}`, fmtPct(o.share)), F(`الاشتباهات الخاطئة · إجمالي ${groupLabel(o.sea)}`, fmtPct(o.baseShare)), F(`إجابات الاشتباه في ${o.name}`, fmtNum(o.den))],
      page: "نتائج الأداء للمنافذ",
    });
  }

  // ── Marking (suspicion images only) ───────────────────────────────────────────────────────────────────────────
  const marking = collectPortMarkingOnly(model);
  const markStats: PortShare[] = portRows.map((p) => {
    const m = marking.get(p.name);
    return { name: p.name, sea: p.sea, num: m?.marked ?? 0, den: m?.images ?? 0 };
  });
  const markTotal = markStats.reduce((a, s) => ({ num: a.num + s.num, den: a.den + s.den }), { num: 0, den: 0 });
  const unmarkedShare = markTotal.den > 0 ? 100 - (markTotal.num / markTotal.den) * 100 : null;
  if (unmarkedShare !== null && unmarkedShare >= 25) {
    add({
      priority: unmarkedShare >= 50 ? "عالية" : "متوسطة", topic: "تحديد موقع الاشتباه",
      text: `${unmarkedShare >= 50 ? "أكثر من نصف" : "نسبة كبيرة من"} صور الاشتباه لا يُحدَّد فيها موقع الاشتباه، مما يضعف تحديد وفحص الاشتباه من قبل الوسائل الحية.`,
      recommendation: "التأكد من التزام الفاحصين بتحديد موقع الاشتباه على الصورة عند الاشتباه، ومتابعة نسبة الالتزام بشكل شهري.",
      figures: [F("صور اشتباه بلا تحديد", fmtPct(unmarkedShare)), F("العدد", `${fmtNum(markTotal.den - markTotal.num)} من ${fmtNum(markTotal.den)}`)],
      page: "هل يوجد تحديد؟",
    });
  }
  for (const o of findOutliers(markStats, "low", 100, 15).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: o.gap <= -25 ? "عالية" : "متوسطة", topic: "تحديد موقع الاشتباه",
      text: `تحديد موقع الاشتباه في منفذ ${o.name} أضعف منه في إجمالي ${groupLabel(o.sea)}، مما يؤدي إلى وجود صعوبة في تحديد الاشتباه والتأكد منه من قبل الوسائل الحية.`,
      recommendation: `التأكد من التزام الفاحصين في منفذ ${o.name} بتحديد موقع الاشتباه، ومتابعة نسبة الالتزام مقارنةً بإجمالي ${groupLabel(o.sea)} بشكل شهري.`,
      figures: [F(`صور بتحديد · ${o.name}`, fmtPct(o.share)), F(`صور بتحديد · إجمالي ${groupLabel(o.sea)}`, fmtPct(o.baseShare)), F(`صور اشتباه ${o.name}`, fmtNum(o.den))],
      page: "هل يوجد تحديد؟",
    });
  }

  // ── Level 1 vs level 2 ────────────────────────────────────────────────────────────────────────────────────────
  const lv = collectLevelAccuracyRows(model);
  const lvAll = [...lv.land, ...lv.sea];
  const l1 = accuracyOf(sumCounts(lvAll.map((r) => r.l1.counts)));
  const l2 = accuracyOf(sumCounts(lvAll.map((r) => r.l2.counts)));
  if (l1.overall !== null && l2.overall !== null && Math.abs(l1.overall - l2.overall) >= 2) {
    const [lowN, highN] = l1.overall < l2.overall ? ["الأول", "الثاني"] : ["الثاني", "الأول"];
    add({
      priority: "للعلم", topic: "المستويان",
      text: `إجابات المستوى ${lowN} أقل توافقًا مع رأي أخصائي ضمان جودة الأشعة من إجابات المستوى ${highN}.`,
      recommendation: `مراجعة عدة حالات من المستوى ${lowN} للتأكد من تطبيق معايير الاشتباه بنفس الطريقة المتبعة في المستوى الآخر.`,
      figures: [F("معدل الاتفاق · المستوى الأول", fmtPct(l1.overall)), F("معدل الاتفاق · المستوى الثاني", fmtPct(l2.overall)), F("الإجابات المفحوصة · المستوى الأول / الثاني", `${fmtNum(l1.evaluable)} / ${fmtNum(l2.evaluable)}`)],
      page: "دقة إجابات المستوى الأول والثاني",
    });
  }

  // ── Image quality ↔ agreement (an association: quality is self-reported, so no cause is claimed) ──────────────
  // Same image-level fold as the quality-by-agreement page, so the observation and the page agree.
  const byQ = collectQualityImageOutcomes(model);
  const q = (k: string): FourCounts => byQ.get(`all|${k}`) ?? { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
  const qLow = accuracyOf(q("منخفض"));
  const qHigh = accuracyOf(q("عالي"));
  if (qLow.evaluable > 0 && qHigh.evaluable > 0 && qLow.overall !== null && qHigh.overall !== null && qHigh.overall - qLow.overall >= 5) {
    add({
      priority: "متوسطة", topic: "جودة الصورة",
      text: "تدنّي جودة الصورة يؤدي إلى اشتباهات خاطئة أو اشتباهات فائتة بمعدل أكبر من الصور ذات الجودة العالية.",
      recommendation: "التأكد من جودة التقاط أجهزة الأشعة للصور، ومتابعة الحالات ذات الجودة المنخفضة بشكل شهري لتحسين دقة القرار.",
      figures: [F("اشتباهات خاطئة أو فائتة · جودة منخفضة", fmtPct(100 - qLow.overall)), F("اشتباهات خاطئة أو فائتة · جودة عالية", fmtPct(100 - qHigh.overall)), F("الصور منخفضة الجودة", fmtNum(qLow.evaluable))],
      page: "نسبة التوائم حسب جودة الصورة",
    });
  }

  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ORDER[a.s.priority] - ORDER[b.s.priority] || a.i - b.i)
    .map((x) => x.s)
    .slice(0, MAX_STATEMENTS);
}

/** The observations and recommendations as a workbook: sheet 1 the table as the report shows it, sheet 2 the figures behind each observation. */
export function buildStatementsWorkbook(statements: Statement[], periodLabel: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    [`الملاحظات والتوصيات المستخلصة من نتائج التقرير - ${periodLabel}`],
    [],
    ["#", "الملاحظة", "التوصية", "الأولوية", "صفحة التقرير"],
    ...statements.map((s, i): Array<string | number> => [i + 1, s.plain, s.recommendation, s.priority, s.page]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 5 }, { wch: 90 }, { wch: 70 }, { wch: 10 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, "الملاحظات والتوصيات");
  const basis = XLSX.utils.aoa_to_sheet([
    ["الأرقام التي تستند إليها الملاحظات"],
    [],
    ["#", "الملاحظة", "الرقم", "القيمة"],
    ...statements.flatMap((s, i): Array<Array<string | number>> => s.figures.map((f) => [i + 1, s.plain, f.label, f.value])),
  ]);
  basis["!cols"] = [{ wch: 5 }, { wch: 90 }, { wch: 50 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, basis, "الأرقام");
  return wb;
}

/** Build and download the observations workbook for a report input (browser). */
export function downloadStatementsWorkbook(input: ExecutiveReportInput, periodLabel: string): void {
  const model = buildReportModel(input, {});
  XLSX.writeFile(buildStatementsWorkbook(buildStatements(model), periodLabel), `الملاحظات_والتوصيات_${periodLabel}.xlsx`, { compression: true });
}
