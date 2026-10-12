// الإفادات: the report's key statements, drafted from its own results by fixed rules (no model, no guessing).
// Every statement carries the figures it rests on and the report page they come from, so each can be checked.
// The deck shows them in section 3 (editable in the viewer); `buildStatementsWorkbook` exports the same list.
import * as XLSX from "xlsx";
import { fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { buildReportModel } from "../model/reportModel";
import { aggregateDecisions, buildDecisionRecords } from "../model/decisionFactTable";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import {
  accuracyOf, collectPortAccuracy, collectPortMarking, orderedStageAccuracy, pct, sumCounts, sumMarking, emptyMarking,
  type FourCounts, type Statement, type StatementPriority,
} from "./slides";

/** A group with fewer answers than this is too thin to name in a statement. */
const MIN_BASE = 1000;
const ORDER: Record<StatementPriority, number> = { "عالية": 0, "متوسطة": 1, "للعلم": 2 };
const top3 = (names: string[]) => names.slice(0, 3).join("، ");

export function buildStatements(model: ReportModel): Statement[] {
  const out: Statement[] = [];
  const t = model.errorAnalysis.totals;
  const all = accuracyOf(t);
  if (all.evaluable === 0) return out;

  // 1 — overall agreement
  const overallP: StatementPriority = (all.overall ?? 100) < 70 ? "عالية" : (all.overall ?? 100) < 80 ? "متوسطة" : "للعلم";
  out.push({
    priority: overallP, topic: "نسبة التوائم العامة",
    text: `بلغت نسبة التوائم العامة بين نتيجة الوسائل الآلية ورأي أخصائي ضمان الجودة ${fmtPct(all.overall)} من ${fmtNum(all.evaluable)} إجابة مدروسة.`,
    plain: overallP === "عالية" ? "نسبة التوائم العامة بين نتيجة الوسائل الآلية ورأي أخصائي ضمان الجودة منخفضة وتستوجب المراجعة."
      : overallP === "متوسطة" ? "نسبة التوائم العامة بين نتيجة الوسائل الآلية ورأي أخصائي ضمان الجودة متوسطة وتحتاج إلى تحسين."
        : "نسبة التوائم العامة بين نتيجة الوسائل الآلية ورأي أخصائي ضمان الجودة جيدة.",
    basis: `${fmtNum(t.correctClean + t.correctSuspicion)} إجابة متفق عليها من ${fmtNum(all.evaluable)}`, page: "نسبة التوائم",
  });

  // 2 — missed suspicion (security risk)
  const missedShare = pct(t.missedSuspicion, all.cleanResults);
  out.push({
    priority: (missedShare ?? 0) >= 20 ? "عالية" : "متوسطة", topic: "الاشتباهات الفائتة",
    text: `بلغت الاشتباهات الفائتة ${fmtNum(t.missedSuspicion)} إجابة (${fmtPct(missedShare)} من إجابات السليمة): نتيجة الوسائل الآلية سليمة ورأى أخصائي ضمان الجودة أنها اشتباه، وهي الأعلى أثرًا أمنيًا.`,
    plain: `الاشتباهات الفائتة ${(missedShare ?? 0) >= 20 ? "مرتفعة" : "ظاهرة"}: إرساليات عدّتها الوسائل الآلية سليمة ورأى أخصائي ضمان الجودة أنها اشتباه، وهي الأعلى أثرًا أمنيًا.`,
    basis: `${fmtNum(t.missedSuspicion)} من ${fmtNum(all.cleanResults)} إجابة سليمة`, page: "نسبة التوائم",
  });

  // 3 — false suspicion (operational cost)
  const falseShare = pct(t.falseSuspicion, all.suspResults);
  out.push({
    priority: (falseShare ?? 0) >= 20 ? "متوسطة" : "للعلم", topic: "الاشتباهات الخاطئة",
    text: `بلغت الاشتباهات الخاطئة ${fmtNum(t.falseSuspicion)} إجابة (${fmtPct(falseShare)} من إجابات الاشتباه): نتيجة الوسائل الآلية اشتباه ورأى أخصائي الجودة أنها سليمة، وتعني كلفة تشغيلية.`,
    plain: `الاشتباهات الخاطئة ${(falseShare ?? 0) >= 20 ? "مرتفعة" : "محدودة"}: إرساليات عدّتها الوسائل الآلية اشتباهًا ورأى أخصائي الجودة أنها سليمة، وتعني كلفة تشغيلية.`,
    basis: `${fmtNum(t.falseSuspicion)} من ${fmtNum(all.suspResults)} إجابة اشتباه`, page: "نسبة التوائم",
  });

  // 4 — risk levels (named only when the level has enough answers)
  const stages = orderedStageAccuracy(model).map((s) => ({ label: s.label, a: accuracyOf(s.counts), c: s.counts })).filter((s) => s.a.evaluable >= MIN_BASE);
  const byAgree = [...stages].filter((s) => s.a.overall !== null).sort((x, y) => (x.a.overall ?? 0) - (y.a.overall ?? 0));
  if (byAgree.length > 1) {
    const lo = byAgree[0];
    const hiAgree = byAgree[byAgree.length - 1];
    out.push({
      priority: (lo.a.overall ?? 100) < 60 ? "عالية" : "متوسطة", topic: "مستويات المخاطر",
      text: `أدنى نسبة توائم بين مستويات المخاطر في ${lo.label}: ${fmtPct(lo.a.overall)} من ${fmtNum(lo.a.evaluable)} إجابة، مقابل ${fmtPct(hiAgree.a.overall)} في ${hiAgree.label}.`,
      plain: `أضعف توافق بين مستويات المخاطر في ${lo.label}، وأقواه في ${hiAgree.label}.`,
      basis: stages.map((s) => `${s.label}: ${fmtPct(s.a.overall)}`).join(" | "), page: "نسبة التوائم",
    });
    const byMissed = [...stages].filter((s) => s.a.cleanResults > 0).sort((x, y) => (pct(y.c.missedSuspicion, y.a.cleanResults) ?? 0) - (pct(x.c.missedSuspicion, x.a.cleanResults) ?? 0));
    const hi = byMissed[0];
    if (hi) {
      const share = pct(hi.c.missedSuspicion, hi.a.cleanResults);
      out.push({
        priority: (share ?? 0) >= 40 ? "عالية" : "متوسطة", topic: "مستويات المخاطر",
        text: `أعلى نسبة اشتباهات فائتة في ${hi.label}: ${fmtNum(hi.c.missedSuspicion)} إجابة (${fmtPct(share)} من إجابات السليمة فيه).`,
        plain: `أعلى نسبة اشتباهات فائتة في ${hi.label}.`,
        basis: `${fmtNum(hi.c.missedSuspicion)} من ${fmtNum(hi.a.cleanResults)}`, page: "نسبة التوائم",
      });
    }
  }

  // 5 — land vs sea, then the ports behind it
  const portAcc = collectPortAccuracy(model);
  const land = accuracyOf(sumCounts(portAcc.land.map((p) => p.counts)));
  const sea = accuracyOf(sumCounts(portAcc.sea.map((p) => p.counts)));
  if (land.evaluable >= MIN_BASE && sea.evaluable >= MIN_BASE && land.overall !== null && sea.overall !== null && Math.abs(land.overall - sea.overall) >= 2) {
    const [lowName, lowV, highName, highV] = land.overall < sea.overall ? ["البرية", land.overall, "البحرية", sea.overall] : ["البحرية", sea.overall, "البرية", land.overall];
    out.push({
      priority: "متوسطة", topic: "المنافذ",
      text: `نسبة التوائم في المنافذ ${lowName} (${fmtPct(lowV)}) أقل منها في المنافذ ${highName} (${fmtPct(highV)}).`,
      plain: `التوافق في المنافذ ${lowName} أقل منه في المنافذ ${highName}.`,
      basis: `البرية ${fmtPct(land.overall)} من ${fmtNum(land.evaluable)} | البحرية ${fmtPct(sea.overall)} من ${fmtNum(sea.evaluable)}`, page: "نتائج الأداء للمنافذ",
    });
  }
  const ports = [...portAcc.land, ...portAcc.sea].map((p) => ({ name: p.name, a: accuracyOf(p.counts), c: p.counts })).filter((p) => p.a.evaluable >= MIN_BASE);
  const lowPorts = [...ports].filter((p) => p.a.overall !== null).sort((x, y) => (x.a.overall ?? 0) - (y.a.overall ?? 0)).slice(0, 3);
  if (lowPorts.length > 0) {
    out.push({
      priority: (lowPorts[0].a.overall ?? 100) < 60 ? "عالية" : "متوسطة", topic: "المنافذ",
      text: `أدنى المنافذ في نسبة التوائم (من المنافذ التي لها ${fmtNum(MIN_BASE)} إجابة فأكثر): ${top3(lowPorts.map((p) => `${p.name} (${fmtPct(p.a.overall)})`))}.`,
      plain: `أضعف المنافذ توافقًا بين نتيجة الوسائل الآلية ورأي الجودة: ${top3(lowPorts.map((p) => p.name))}.`,
      basis: lowPorts.map((p) => `${p.name}: ${fmtNum(p.a.evaluable)} إجابة`).join(" | "), page: "نتائج الأداء للمنافذ",
    });
  }
  const missPorts = [...ports].filter((p) => p.a.cleanResults >= 500).sort((x, y) => (pct(y.c.missedSuspicion, y.a.cleanResults) ?? 0) - (pct(x.c.missedSuspicion, x.a.cleanResults) ?? 0)).slice(0, 3);
  if (missPorts.length > 0) {
    out.push({
      priority: (pct(missPorts[0].c.missedSuspicion, missPorts[0].a.cleanResults) ?? 0) >= 40 ? "عالية" : "متوسطة", topic: "المنافذ",
      text: `أعلى المنافذ في الاشتباهات الفائتة (نسبتها من إجابات السليمة): ${top3(missPorts.map((p) => `${p.name} (${fmtPct(pct(p.c.missedSuspicion, p.a.cleanResults))})`))}.`,
      plain: `أكثر المنافذ في الاشتباهات الفائتة: ${top3(missPorts.map((p) => p.name))}.`,
      basis: missPorts.map((p) => `${p.name}: ${fmtNum(p.c.missedSuspicion)} من ${fmtNum(p.a.cleanResults)}`).join(" | "), page: "نتائج الأداء للمنافذ",
    });
  }

  // 6 — level 1 vs level 2
  const lv = collectLevelAccuracyRows(model);
  const lvAll = [...lv.land, ...lv.sea];
  const l1 = accuracyOf(sumCounts(lvAll.map((r) => r.l1.counts)));
  const l2 = accuracyOf(sumCounts(lvAll.map((r) => r.l2.counts)));
  if (l1.overall !== null && l2.overall !== null && Math.abs(l1.overall - l2.overall) >= 2) {
    const [lowN, lowV, highN, highV] = l1.overall < l2.overall ? ["الأول", l1.overall, "الثاني", l2.overall] : ["الثاني", l2.overall, "الأول", l1.overall];
    out.push({
      priority: "للعلم", topic: "المستويان",
      text: `نسبة التوائم لإجابات المستوى ${lowN} (${fmtPct(lowV)}) أقل منها للمستوى ${highN} (${fmtPct(highV)}).`,
      plain: `التوافق لإجابات المستوى ${lowN} أقل منه للمستوى ${highN}.`,
      basis: `الأول ${fmtPct(l1.overall)} من ${fmtNum(l1.evaluable)} | الثاني ${fmtPct(l2.overall)} من ${fmtNum(l2.evaluable)}`, page: "دقة إجابات المستوى الأول والثاني",
    });
  }

  // 7 — image quality (an association: image quality is self-reported, so no cause is claimed)
  const byQ = aggregateDecisions(buildDecisionRecords(model.rows, "quality"), "decision", (r) => r.imageQuality);
  const q = (k: string): FourCounts => byQ.get(k) ?? { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
  const qLow = accuracyOf(q("منخفض"));
  const qHigh = accuracyOf(q("عالي"));
  if (qLow.evaluable > 0 && qHigh.evaluable > 0 && qLow.overall !== null && qHigh.overall !== null && qHigh.overall - qLow.overall >= 5) {
    out.push({
      priority: "متوسطة", topic: "جودة الصورة",
      text: `تنخفض نسبة التوائم في الصور منخفضة الجودة (${fmtPct(qLow.overall)} من ${fmtNum(qLow.evaluable)} إجابة) عنها في الصور عالية الجودة (${fmtPct(qHigh.overall)} من ${fmtNum(qHigh.evaluable)} إجابة)${qLow.evaluable < MIN_BASE ? "؛ وقاعدة الجودة المنخفضة صغيرة فيُقرأ الفرق بحذر" : ""}.`,
      plain: `ينخفض التوافق في الصور منخفضة الجودة عنه في الصور عالية الجودة${qLow.evaluable < MIN_BASE ? "، وعدد الصور منخفضة الجودة صغير فيُقرأ ذلك بحذر" : ""}.`,
      basis: `منخفضة ${fmtPct(qLow.overall)} | عالية ${fmtPct(qHigh.overall)}`, page: "نسبة التوائم حسب جودة الصورة",
    });
  }

  // 8 — marking, and the images not studied for it
  const marking = collectPortMarking(model);
  const mk = sumMarking([...portAcc.land, ...portAcc.sea].map((p) => marking.get(p.name) ?? emptyMarking()));
  const unmarkedShare = pct(mk.unmarked, mk.images);
  if (mk.images > 0 && unmarkedShare !== null && unmarkedShare >= 25) {
    out.push({
      priority: unmarkedShare >= 50 ? "عالية" : "متوسطة", topic: "تحديد موقع الاشتباه",
      text: `${fmtPct(unmarkedShare)} من صور الاشتباه المدروسة دون تحديد لموضع الاشتباه (${fmtNum(mk.unmarked)} من ${fmtNum(mk.images)} صورة).`,
      plain: `${unmarkedShare >= 50 ? "أكثر من نصف" : "نسبة كبيرة من"} صور الاشتباه المدروسة دون تحديد لموضع الاشتباه.`,
      basis: `${fmtNum(mk.marked)} بتحديد | ${fmtNum(mk.unmarked)} بدون تحديد`, page: "متابعة تحديد موقع الاشتباه وجودة الصور",
    });
  }
  if (mk.unstudied > 0) {
    out.push({
      priority: "للعلم", topic: "اكتمال البيانات",
      text: `${fmtNum(mk.unstudied)} صورة اشتباه لم تُدرس جودتها أو تحديدها، وهي خارج أرقام صفحات التحديد والجودة.`,
      plain: "توجد صور اشتباه لم تُدرس جودتها أو تحديدها، وهي خارج صفحات التحديد والجودة.",
      basis: `${fmtNum(mk.unstudied)} صورة`, page: "متابعة تحديد موقع الاشتباه وجودة الصور",
    });
  }

  return out.map((s, i) => ({ s, i })).sort((a, b) => ORDER[a.s.priority] - ORDER[b.s.priority] || a.i - b.i).map((x) => x.s);
}

/** The statements as a one-sheet workbook, in words only (no figures), the second file next to the report. */
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
  return wb;
}

/** Build and download the statements workbook for a report input (browser). */
export function downloadStatementsWorkbook(input: ExecutiveReportInput, periodLabel: string): void {
  const model = buildReportModel(input, {});
  XLSX.writeFile(buildStatementsWorkbook(buildStatements(model), periodLabel), `الإفادات_المهمة_${periodLabel}.xlsx`, { compression: true });
}
