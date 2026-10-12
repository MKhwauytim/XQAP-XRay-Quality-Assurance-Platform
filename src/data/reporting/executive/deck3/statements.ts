// الإفادات: the report's key statements, drafted from its own results by fixed rules (no model, no guessing).
//
// Each statement is an OBSERVATION and what it means, written the way an analyst reads the report ("image quality at
// port X is below the other ports, which may weaken prohibited-item detection"), not a restated figure. Port
// statements compare a port with the REST of its own type (land / sea) — a port's own volume never props up the average
// it is judged against. The figures behind a statement live in `basis` (second sheet of the statements workbook), so
// every statement can still be checked, and the deck text stays editable prose.
import * as XLSX from "xlsx";
import { fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { buildReportModel } from "../model/reportModel";
import { aggregateDecisions, buildDecisionRecords } from "../model/decisionFactTable";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import {
  accuracyOf, collectPortAccuracy, collectPortMarkingOnly, collectPortQuality, sumCounts,
  type FourCounts, type Statement, type StatementPriority,
} from "./slides";

/** A group with fewer answers than this is too thin to name in a statement. */
const MIN_BASE = 1000;
/** Per-category cap on named ports, and on the whole list — a statement list nobody reads helps nobody. */
const MAX_PORTS_PER_TOPIC = 2;
const MAX_STATEMENTS = 15;
const ORDER: Record<StatementPriority, number> = { "عالية": 0, "متوسطة": 1, "للعلم": 2 };

export type PortShare = { name: string; sea: boolean; num: number; den: number };
export type PortOutlier = { name: string; sea: boolean; share: number; othersShare: number; gap: number; den: number };

const groupLabel = (sea: boolean) => (sea ? "المنافذ البحرية" : "المنافذ البرية");

/**
 * Ports whose share differs from the REST of their type by at least `minGap` points, in the stated direction.
 * Compared with the other ports of the same type that clear `minDen`; when there are none, with every other port.
 * Biggest gap first.
 */
export function findOutliers(stats: PortShare[], direction: "low" | "high", minDen: number, minGap: number): PortOutlier[] {
  const eligible = stats.filter((s) => s.den >= minDen);
  const out: PortOutlier[] = [];
  for (const s of eligible) {
    let others = eligible.filter((o) => o.name !== s.name && o.sea === s.sea);
    if (others.reduce((a, o) => a + o.den, 0) < minDen) others = eligible.filter((o) => o.name !== s.name);
    const den = others.reduce((a, o) => a + o.den, 0);
    if (den === 0) continue;
    const share = (s.num / s.den) * 100;
    const othersShare = (others.reduce((a, o) => a + o.num, 0) / den) * 100;
    const gap = share - othersShare;
    if (direction === "low" ? gap <= -minGap : gap >= minGap) out.push({ name: s.name, sea: s.sea, share, othersShare, gap, den: s.den });
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || (a.name < b.name ? -1 : 1));
}

export function buildStatements(model: ReportModel): Statement[] {
  const out: Statement[] = [];
  const add = (s: { priority: StatementPriority; topic: string; text: string; basis: string; page: string }) =>
    out.push({ ...s, plain: s.text });
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
      basis: `البرية ${fmtPct(land.overall)} من ${fmtNum(land.evaluable)} | البحرية ${fmtPct(sea.overall)} من ${fmtNum(sea.evaluable)}`, page: "نتائج الأداء للمنافذ",
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
      text: `جودة الصور الملتقطة في منفذ ${o.name} أقل من باقي ${groupLabel(o.sea)}، مما قد يسبب ضعفًا في جودة كشف المواد الممنوعة.`,
      basis: `${o.name}: صور عالية الجودة ${fmtPct(o.share)} من ${fmtNum(o.den)} صورة، مقابل ${fmtPct(o.othersShare)} في باقي ${groupLabel(o.sea)}`, page: "جودة الصور المقيّمة",
    });
  }

  const missedStats: PortShare[] = portRows.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.missedSuspicion, den: p.counts.correctClean + p.counts.missedSuspicion }));
  for (const o of findOutliers(missedStats, "high", 500, 10).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: o.gap >= 20 ? "عالية" : "متوسطة", topic: "الاشتباهات الفائتة",
      text: `نسبة الاشتباهات الفائتة في منفذ ${o.name} أعلى من متوسط باقي ${groupLabel(o.sea)}.`,
      basis: `${o.name}: ${fmtPct(o.share)} من ${fmtNum(o.den)} إجابة سليمة، مقابل ${fmtPct(o.othersShare)} في باقي ${groupLabel(o.sea)}`, page: "نتائج الأداء للمنافذ",
    });
  }

  const falseStats: PortShare[] = portRows.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.falseSuspicion, den: p.counts.correctSuspicion + p.counts.falseSuspicion }));
  for (const o of findOutliers(falseStats, "high", 300, 10).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: "متوسطة", topic: "الاشتباهات الخاطئة",
      text: `تكثر الاشتباهات الخاطئة في منفذ ${o.name} مقارنة بباقي ${groupLabel(o.sea)}.`,
      basis: `${o.name}: ${fmtPct(o.share)} من ${fmtNum(o.den)} إجابة اشتباه، مقابل ${fmtPct(o.othersShare)} في باقي ${groupLabel(o.sea)}`, page: "نتائج الأداء للمنافذ",
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
      basis: `${fmtNum(markTotal.den - markTotal.num)} صورة (${fmtPct(unmarkedShare)}) من ${fmtNum(markTotal.den)} صورة اشتباه دون تحديد`, page: "هل يوجد تحديد؟",
    });
  }
  for (const o of findOutliers(markStats, "low", 100, 15).slice(0, MAX_PORTS_PER_TOPIC)) {
    add({
      priority: o.gap <= -25 ? "عالية" : "متوسطة", topic: "تحديد موقع الاشتباه",
      text: `تحديد موقع الاشتباه في منفذ ${o.name} أضعف منه في باقي ${groupLabel(o.sea)}، مما يؤدي إلى وجود صعوبة في تحديد الاشتباه والتأكد منه من قبل الوسائل الحية.`,
      basis: `${o.name}: بتحديد ${fmtPct(o.share)} من ${fmtNum(o.den)} صورة اشتباه، مقابل ${fmtPct(o.othersShare)} في باقي ${groupLabel(o.sea)}`, page: "هل يوجد تحديد؟",
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
      text: `إجابات المستوى ${lowN} أقل توافقًا مع رأي أخصائي الجودة من إجابات المستوى ${highN}.`,
      basis: `الأول ${fmtPct(l1.overall)} من ${fmtNum(l1.evaluable)} | الثاني ${fmtPct(l2.overall)} من ${fmtNum(l2.evaluable)}`, page: "دقة إجابات المستوى الأول والثاني",
    });
  }

  // ── Image quality ↔ agreement (an association: quality is self-reported, so no cause is claimed) ──────────────
  const byQ = aggregateDecisions(buildDecisionRecords(model.rows, "quality"), "decision", (r) => r.imageQuality);
  const q = (k: string): FourCounts => byQ.get(k) ?? { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
  const qLow = accuracyOf(q("منخفض"));
  const qHigh = accuracyOf(q("عالي"));
  if (qLow.evaluable > 0 && qHigh.evaluable > 0 && qLow.overall !== null && qHigh.overall !== null && qHigh.overall - qLow.overall >= 5) {
    add({
      priority: "متوسطة", topic: "جودة الصورة",
      text: "تدنّي جودة الصورة يؤدي إلى اشتباهات خاطئة أو اشتباهات فائتة بمعدل أكبر من الصور ذات الجودة العالية.",
      basis: `منخفضة ${fmtPct(qLow.overall)} من ${fmtNum(qLow.evaluable)} إجابة | عالية ${fmtPct(qHigh.overall)} من ${fmtNum(qHigh.evaluable)} إجابة`, page: "نسبة التوائم حسب جودة الصورة",
    });
  }

  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ORDER[a.s.priority] - ORDER[b.s.priority] || a.i - b.i)
    .map((x) => x.s)
    .slice(0, MAX_STATEMENTS);
}

/** The statements as a workbook: sheet 1 in words only (no figures), sheet 2 the figures each statement rests on. */
export function buildStatementsWorkbook(statements: Statement[], periodLabel: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    [`الإفادات المهمة المستخلصة من نتائج التقرير - ${periodLabel}`],
    [],
    ["الأولوية", "الموضوع", "الإفادة", "صفحة التقرير"],
    ...statements.map((s): Array<string | number> => [s.priority, s.topic, s.plain, s.page]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 110 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, "الإفادات المهمة");
  const basis = XLSX.utils.aoa_to_sheet([
    ["الأساس الرقمي للإفادات"],
    [],
    ["الموضوع", "الإفادة", "الأرقام التي تستند إليها", "صفحة التقرير"],
    ...statements.map((s): Array<string | number> => [s.topic, s.plain, s.basis, s.page]),
  ]);
  basis["!cols"] = [{ wch: 22 }, { wch: 90 }, { wch: 80 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, basis, "الأساس الرقمي");
  return wb;
}

/** Build and download the statements workbook for a report input (browser). */
export function downloadStatementsWorkbook(input: ExecutiveReportInput, periodLabel: string): void {
  const model = buildReportModel(input, {});
  XLSX.writeFile(buildStatementsWorkbook(buildStatements(model), periodLabel), `الإفادات_المهمة_${periodLabel}.xlsx`, { compression: true });
}
