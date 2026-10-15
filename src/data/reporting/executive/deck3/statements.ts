// الملاحظات والتوصيات: the report's key observations, drafted from its own results by fixed rules (no model, no guessing),
// in the owner's format (ownerObservations.ts, 2026-10-15): five themes, each a main observation with its headline figure,
// supporting facts by risk level (المستوى — categorical, not a severity ranking) and by port against its port type's
// total («إجمالي البرية / البحرية»), and the owner's numbered recommendations.
//
// Every number is computed here from the report model. Bases:
//  - Answers (إجابات) are DECISIONS: each image carries an L1 and an L2 answer, both judged against the specialist.
//  - Missed = missed suspicions over clean answers (missed + correct clean); false = false suspicions over suspicion
//    answers (false + correct suspicion) — the same bases the port tables use.
//  - Per-level population figures come from the workbook's population totals (`population.summary`).
// A theme whose data is absent is left out; nothing is filled in.
import * as XLSX from "xlsx";
import { fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import { buildReportModel } from "../model/reportModel";
import { getStageKey, type StageCountKey } from "../../../population/stageHelpers";
import { collectPortAccuracy, collectPortMarkingOnly, collectPortQuality, type PortShare, type Observation } from "./slides";

export type { PortShare };

/** A port needs at least this many cases on a measure to be named. */
export const PORT_MIN_BASE = 100;
/** A port is named when its share is at least this many points worse than its port type's total. */
export const PORT_GAP = 10;
/** Low-quality shares are small, so a smaller gap already stands out. */
const LOW_QUALITY_GAP = 5;
const MAX_PORTS = 4;
/** Rows with no port name, or only the port TYPE in the name column, are never named as a port. */
const NOT_A_PORT = new Set(["غير محدد", "منفذ بري", "منفذ بحري"]);

export type PortOutlier = { name: string; sea: boolean; share: number; baseShare: number; den: number };

/** Pooled share of one port type (its «إجمالي»), in %. */
export function typeTotal(stats: PortShare[], sea: boolean): number | null {
  const g = stats.filter((s) => s.sea === sea);
  const den = g.reduce((a, s) => a + s.den, 0);
  return den === 0 ? null : (g.reduce((a, s) => a + s.num, 0) / den) * 100;
}

/** Ports of one type whose share is at least `gap` points above (high) or below (low) the type total. Worst first. */
export function findOutliers(stats: PortShare[], sea: boolean, direction: "low" | "high", minDen = PORT_MIN_BASE, gap = PORT_GAP): PortOutlier[] {
  const base = typeTotal(stats, sea);
  if (base === null) return [];
  return stats
    .filter((s) => s.sea === sea && s.den >= minDen)
    .map((s) => ({ name: s.name, sea, share: (s.num / s.den) * 100, baseShare: base, den: s.den }))
    .filter((o) => (direction === "high" ? o.share - base >= gap : base - o.share >= gap))
    .sort((a, b) => (direction === "high" ? b.share - a.share : a.share - b.share) || (a.name < b.name ? -1 : 1))
    .slice(0, MAX_PORTS);
}

const P = (n: number) => `(${fmtPct(n, 0)})`;
const portWord = (sea: boolean) => (sea ? "المنافذ البحرية" : "المنافذ البرية");
/** «منفذ البطحاء (45%) وميناء جدة (34%)» — a name that already says ميناء gets no «منفذ». */
const portList = (os: PortOutlier[]) => os.map((o) => `${o.name.startsWith("ميناء") ? "" : "منفذ "}${o.name} ${P(o.share)}`).join(" و");

type Decisions = { n: number; cc: number; cs: number; ms: number; fs: number };
const emptyDecisions = (): Decisions => ({ n: 0, cc: 0, cs: 0, ms: 0, fs: 0 });

/** Judged answers per risk level: L1 and L2 each against the specialist's result. */
export function decisionsByLevel(model: ReportModel): Map<StageCountKey, Decisions> {
  const out = new Map<StageCountKey, Decisions>();
  for (const r of model.rows) {
    if (r.expertResult === null) continue;
    const key = getStageKey(r.stage, model.stageMappings);
    const d = out.get(key) ?? emptyDecisions();
    out.set(key, d);
    const answers: Array<[string, boolean]> = [[r.levelOneResult, r.levelOneOther !== undefined], [r.levelTwoResult, r.levelTwoOther !== undefined]];
    for (const [answer, other] of answers) {
      if (other) continue;
      d.n++;
      const susp = answer === "اشتباه";
      const truth = r.expertResult === "اشتباه";
      if (susp && truth) d.cs++;
      else if (susp) d.fs++;
      else if (truth) d.ms++;
      else d.cc++;
    }
  }
  return out;
}

type PopLevel = { answers: number; suspicious: number; images: number; imagesSuspicious: number };

/** Population answers (L1 + L2 per image) and images per risk level, from the workbook's population totals. */
function populationLevels(model: ReportModel): Map<StageCountKey, PopLevel> {
  const out = new Map<StageCountKey, PopLevel>();
  const s = model.population.summary;
  if (!s) return out;
  const get = (raw: string) => {
    const key = getStageKey(raw, model.stageMappings);
    const t = out.get(key) ?? { answers: 0, suspicious: 0, images: 0, imagesSuspicious: 0 };
    out.set(key, t);
    return t;
  };
  for (const [raw, lv] of Object.entries(s.byStageLevels ?? {})) {
    const t = get(raw);
    t.answers += lv.levelOne.clean + lv.levelOne.suspicious + lv.levelTwo.clean + lv.levelTwo.suspicious;
    t.suspicious += lv.levelOne.suspicious + lv.levelTwo.suspicious;
  }
  for (const [raw, b] of Object.entries(s.byStage ?? {})) {
    const t = get(raw);
    t.images += b.total;
    t.imagesSuspicious += b.suspicious;
  }
  return out;
}

const RECS = {
  missed: [
    "تحليل الأسباب التي أدت إلى عدم رصد الحالات التي ارتبطت بضبطيات بالرغم من القدرة على اكتشاف الاشتباه بها من واقع الصور المعاد فحصها من ضمان الجودة.",
    "تحليل الأسباب الجذرية المؤدية لارتفاع الاشتباهات الفائتة من خلال تحديد عينة من الاشتباهات الفائتة التي تم رصدها على أساس كل مستوى من مستويات المخاطر لأغراض إعادة التحليل من الخبراء في مركزية الأشعة.",
    "رصد وتحليل أداء الموظفين العاملين على المنافذ التي شوهدت فيها مستويات مرتفعة من الاشتباه الفائت خلال فترة التقرير بشكل تراكمي، واتخاذ الإجراءات التصحيحية اللازمة.",
  ],
  falseSusp: [
    "تحليل الأسباب الجذرية المؤدية لارتفاع الاشتباهات الخاطئة من خلال تحديد عينة من الاشتباهات الخاطئة التي تم رصدها على أساس كل مستوى من مستويات المخاطر لأغراض إعادة التحليل من الخبراء في مركزية الأشعة.",
    "رصد وتحليل أداء الموظفين العاملين على المنافذ التي شوهدت فيها مستويات مرتفعة من الاشتباه الخاطئ خلال فترة التقرير بشكل تراكمي، واتخاذ الإجراءات التصحيحية اللازمة.",
  ],
  risk: [
    "إعادة فحص عينة من حالات الاشتباه الفائت المرصودة وتحليل الأسباب التي أدت إلى الاشتباه في حال كانت النتيجة بعد الفحص من قبل الشؤون الأمنية بأنها اشتباه.",
    "رصد وتحليل أداء الموظفين العاملين على الحالات التي كان بها اشتباه فائت خلال فترة التقرير بشكل تراكمي، واتخاذ الإجراءات التصحيحية اللازمة.",
    "تحليل الخصائص والعوامل المشتركة للإرساليات ذات مؤشرات المخاطر التي لم تُعد حالات اشتباه، وإحالتها للتحليل والدراسة.",
  ],
  marking: [
    "حصر وتحليل أسباب عدم تحديد مواقع الاشتباه في الصور على مستوى المنافذ.",
    "تضمين صحة واستكمال توثيق مواقع الاشتباه ضمن مؤشرات أداء منسوبي الوسائل الآلية.",
    "تطوير تقرير دوري من أنظمة التحليل لرصد الحالات التي تم تصنيفها كاشتباه دون تحديد موقع الاشتباه، ومتابعة حالات عدم الالتزام.",
  ],
  quality: [
    "فحص عينة من أجهزة الأشعة المرتبطة بالصور منخفضة أو متوسطة الجودة للتحقق من جاهزيتها الفنية.",
    "مراجعة سجل الأعطال وربطه بفترات إنتاج الصور منخفضة الجودة للتحقق من أثر الأعطال على جودة الصور.",
    "تحليل أسباب انخفاض جودة الصور في المنافذ المستهدفة وتنفيذ الإجراءات التصحيحية المناسبة.",
  ],
};

const obs = (topic: string, title: string, evidence: string[], recommendations: string[], page: string): Observation => ({
  priority: "عالية", topic, title, evidence: evidence.map((text) => ({ text, figures: [] })), recommendations, page,
});

/** Port facts for one measure: per port type, the worst ports against that type's total. */
function portFacts(stats: PortShare[], sentence: (ports: string, sea: boolean, base: number) => string, gap = PORT_GAP): string[] {
  const out: string[] = [];
  for (const sea of [false, true]) {
    const os = findOutliers(stats, sea, "high", PORT_MIN_BASE, gap);
    if (os.length) out.push(sentence(portList(os), sea, os[0].baseShare));
  }
  return out;
}

const vsType = (what: string) => (list: string, sea: boolean, base: number) => `تم رصد مستويات عالية من ${what} في ${list} مقارنة بإجمالي ${portWord(sea)} بمقدار ${P(base)}.`;

/** The five observations, in the owner's order. Themes without data are left out. */
export function buildObservations(model: ReportModel): Observation[] {
  const out: Observation[] = [];
  const t = model.errorAnalysis.totals;
  if (t.evaluable === 0) return out;
  const acc = collectPortAccuracy(model);
  const ports = [...acc.land, ...acc.sea].filter((p) => !NOT_A_PORT.has(p.name.trim()));
  const levels = decisionsByLevel(model);
  const pop = populationLevels(model);

  // 1. Missed suspicions
  const missedBase = t.missedSuspicion + t.correctClean;
  if (missedBase > 0) {
    const ev: string[] = [];
    const levelFacts = [
      ["first", "مستوى المخاطر الأول", "والذي يؤكد أنه تم رصد ضبطيات من خلال الفرق الأمنية الأخرى"],
      ["second", "مستوى المخاطر الثاني", "والذي يؤكد الاشتباه من قبل الفرق الأمنية الأخرى"],
    ] as const;
    for (const [key, label, meaning] of levelFacts) {
      const p = pop.get(key);
      if (p && p.answers > 0) ev.push(`بلغت نسبة الاشتباهات المرصودة من الوسائل الآلية ${P((p.suspicious / p.answers) * 100)} من أصل (${fmtNum(p.answers)}) إجابة ضمن ${label} ${meaning}.`);
    }
    ev.push(...portFacts(ports.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.missedSuspicion, den: p.counts.missedSuspicion + p.counts.correctClean })), vsType("الاشتباهات الفائتة")));
    out.push(obs("الاشتباهات الفائتة",
      `ارتفاع عدد الاشتباهات الفائتة التي لم يتم رصدها من قبل أخصائي الوسائل الآلية أثناء مرحلة الفحص، حيث شكلت ما نسبته ${fmtPct((t.missedSuspicion / missedBase) * 100)} من إجابات السليمة للفترة.`,
      ev, RECS.missed, "نتائج الأداء للمنافذ"));
  }

  // 2. False suspicions
  const falseBase = t.falseSuspicion + t.correctSuspicion;
  if (falseBase > 0) {
    const ev: string[] = [];
    const l4 = levels.get("fourth");
    if (l4 && l4.fs + l4.cs > 0) ev.push(`بلغت نسبة الاشتباهات الخاطئة من قبل أخصائي الوسائل الآلية أثناء مرحلة الفحص ${P((l4.fs / (l4.fs + l4.cs)) * 100)} من أصل (${fmtNum(l4.fs + l4.cs)}) إجابة اشتباه ضمن مستوى المخاطر الرابع والذي لم يتم من خلاله الاشتباه بالإرسالية من قبل أي من الفرق الأمنية الأخرى أو التعليم عليها من قبل محرك المخاطر.`);
    ev.push(...portFacts(ports.map((p) => ({ name: p.name, sea: p.sea, num: p.counts.falseSuspicion, den: p.counts.falseSuspicion + p.counts.correctSuspicion })), vsType("الاشتباهات الخاطئة")));
    out.push(obs("الاشتباهات الخاطئة",
      `انخفاض دقة الاشتباه أثناء مرحلة الفحص من قبل أخصائي الوسائل الآلية، حيث شكلت نسبة الاشتباه الخاطئ ${fmtPct((t.falseSuspicion / falseBase) * 100)} من إجمالي إجابات الاشتباه للفترة.`,
      ev, RECS.falseSusp, "نتائج الأداء للمنافذ"));
  }

  // 3. Risk indicators (level 3: shipments flagged by the risk engine)
  const p3 = pop.get("third");
  if (p3 && p3.images > 0) {
    const l3 = levels.get("third");
    const ev = l3 && l3.n > 0
      ? [`بلغت نسبة الاشتباهات الفائتة التي لم يتم رصدها من قبل أخصائي الوسائل الآلية أثناء مرحلة الفحص ${P((l3.ms / l3.n) * 100)} من أصل (${fmtNum(l3.n)}) إجابة ضمن مستوى المخاطر الثالث والذي تم من خلاله التعليم على الإرسالية ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.`]
      : [];
    out.push(obs("مؤشرات المخاطر",
      `انخفاض حاد في التفاعل مع مؤشرات المخاطر التي تم تعليمها على الإرساليات، حيث كانت نسبة الحالات المشتبه بها من قبل الوسائل الآلية ما يشكل ${P((p3.imagesSuspicious / p3.images) * 100)} من أصل (${fmtNum(p3.images)}) صورة.`,
      ev, RECS.risk, "مجتمع الفحص"));
  }

  // 4. Suspicion-location marking (suspicion images only)
  const marking = collectPortMarkingOnly(model);
  const mkAll = [...marking.values()].reduce((a, c) => ({ images: a.images + c.images, marked: a.marked + c.marked }), { images: 0, marked: 0 });
  if (mkAll.images > 0) {
    out.push(obs("تحديد موقع الاشتباه",
      `عدم الالتزام بتحديد مواقع الاشتباهات أثناء فحص الصورة من قبل أخصائي الوسائل الآلية، حيث شكلت نسبة الصور التي تم تحديدها ${P((mkAll.marked / mkAll.images) * 100)} من إجمالي صور الاشتباه خلال الفترة.`,
      portFacts(ports.map((p) => ({ name: p.name, sea: p.sea, num: marking.get(p.name)?.unmarked ?? 0, den: marking.get(p.name)?.images ?? 0 })), vsType("عدم تحديد مواقع الاشتباه في الصور")),
      RECS.marking, "هل يوجد تحديد؟"));
  }

  // 5. Image quality (every studied image)
  const quality = collectPortQuality(model);
  const qAll = [...quality.values()].reduce((a, c) => ({ images: a.images + c.images, poor: a.poor + c.low + c.mid }), { images: 0, poor: 0 });
  if (qAll.images > 0) {
    const q = (lowOnly: boolean) => ports.map((p) => {
      const c = quality.get(p.name);
      return { name: p.name, sea: p.sea, num: c ? (lowOnly ? c.low : c.low + c.mid) : 0, den: c?.images ?? 0 };
    });
    out.push(obs("جودة الصورة",
      `انخفاض جودة صورة الأشعة حيث بلغت نسبة الصور التي تعد جودتها متوسطة أو منخفضة ما نسبته ${P((qAll.poor / qAll.images) * 100)} من أصل (${fmtNum(qAll.images)}) صورة تم فحصها.`,
      [...portFacts(q(true), vsType("الصور المصنفة منخفضة الجودة"), LOW_QUALITY_GAP), ...portFacts(q(false), vsType("الصور المصنفة متوسطة أو منخفضة الجودة"))],
      RECS.quality, "جودة الصور المفحوصة"));
  }
  return out;
}

/** The observations as a workbook: one row per observation as the report shows it. */
export function buildStatementsWorkbook(observations: Observation[], periodLabel: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    [`الملاحظات والتوصيات المستخلصة من نتائج التقرير - ${periodLabel}`],
    [],
    ["#", "الملاحظة الرئيسية", "الشواهد الجوهرية", "التوصية", "صفحة التقرير"],
    ...observations.map((o, i): Array<string | number> => [i + 1, o.title, o.evidence.map((e) => e.text).join("\n"), o.recommendations.map((r, j) => `${j + 1}. ${r}`).join("\n"), o.page]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 5 }, { wch: 60 }, { wch: 100 }, { wch: 80 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "الملاحظات والتوصيات");
  return wb;
}

/** Build and download the observations workbook for a report input (browser). */
export function downloadStatementsWorkbook(input: ExecutiveReportInput, periodLabel: string): void {
  const model = buildReportModel(input, {});
  XLSX.writeFile(buildStatementsWorkbook(buildObservations(model), periodLabel), `الملاحظات_والتوصيات_${periodLabel}.xlsx`, { compression: true });
}
