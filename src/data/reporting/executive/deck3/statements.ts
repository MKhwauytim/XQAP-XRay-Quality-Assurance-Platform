// الملاحظات والتوصيات, fully automated: a catalogue of observation types, each with a trigger condition on the period's
// data. Only the types whose condition holds appear, so the list changes with each period's results. Every observation
// follows the owner's pattern (ownerObservations.ts, 2026-10-15):
//   1. a headline «ارتفاع / انخفاض … حيث شكلت …%»;
//   2. supporting facts: the cut by risk level (المستوى 1–4 — categorical, never a severity ranking) and the land / sea
//      ports that stand out against their port type's pooled total («إجمالي البرية / البحرية»), named with their %;
//   3. numbered recommendations matched to the cause.
// Every number is computed here from the report model; a type whose data is absent never fires. Thin groups never fire
// (minimum bases below). Observations are ordered by priority, then by how far their figure is past its threshold, and capped.
//
// Bases: answers (إجابات) are DECISIONS — each image carries an L1 and an L2 answer, each judged against the
// specialist. Missed = missed ÷ (missed + correct clean); false = false ÷ (false + correct suspicion), the same bases
// the port tables use. Marking, quality and image availability are per IMAGE.
import * as XLSX from "xlsx";
import { fmtNum, fmtPct } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import type { ExecutiveReportInput, ExecutiveReportRow } from "../../executiveReportTypes";
import { buildReportModel } from "../model/reportModel";
import { getStageKey, type StageCountKey } from "../../../population/stageHelpers";
import { STAGE_LABELS_AR } from "../../../population/stageLabels";
import { resolvePortKinds } from "../portKind";
import type { PortShare, Observation, StatementPriority } from "./slides";

export type { PortShare };

/** A port needs at least this many cases on a measure to be named. */
export const PORT_MIN_BASE = 100;
/** A whole-period or per-level figure needs at least this many cases to fire or be quoted. */
export const MIN_BASE = 300;
/** A port is named when its share is at least this many points worse than its port type's total. */
export const PORT_GAP = 10;
const MAX_PORTS = 4;
/** At most this many observations; the strongest are kept. */
export const MAX_OBSERVATIONS = 8;
/** Rows with no port name, or only the port TYPE in the name column, are never named as a port. */
const NOT_A_PORT = new Set(["غير محدد", "منفذ بري", "منفذ بحري"]);

/** Trigger thresholds, one place. `high` fires a «ارتفاع» observation, `low` its positive mirror. */
export const THRESHOLDS = {
  missed: { high: 15, low: 5 },
  falseSusp: { high: 20, low: 10 },
  /** Level 3 (flagged by the risk engine, not suspected by L1/L2): missed share of its answers. */
  levelThreeMissed: 5,
  /** Marked share of suspicion images below this fires. */
  marked: 75,
  /** Medium-or-low quality share of images at or above this fires. */
  poorQuality: 15,
  /** Agreement on high- minus medium/low-quality answers, in points. */
  qualityGap: 5,
  /** Agreement gap between L1 and L2 answers, in points. */
  levelGap: 5,
  /** «لا يوجد صورة» share of studied cases. */
  missingImage: 3,
  /** A port's share of all errors minus its share of all answers, in points. */
  concentration: 15,
} as const;

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

// ── Facts behind the observations ───────────────────────────────────────────────────────────────────────────────

type Outcome = "cc" | "cs" | "ms" | "fs";
/** One judged answer: an L1 or L2 decision on one image against the specialist's result. */
export type Answer = { row: ExecutiveReportRow; level: "l1" | "l2"; stage: StageCountKey; port: string | null; sea: boolean; outcome: Outcome };
/** One image (marking, quality and availability are recorded on the image, not per level). */
export type Image = { row: ExecutiveReportRow; stage: StageCountKey; port: string | null; sea: boolean };

/** Port name to quote, or null for placeholder / untyped ports (never named), plus whether it is a sea port. */
function portOf(kinds: ReturnType<typeof resolvePortKinds>, row: ExecutiveReportRow): { port: string | null; sea: boolean } {
  const name = row.portName?.trim() ?? "";
  const kind = kinds.get(row.portName ?? "غير محدد") ?? "unknown";
  return { port: name && !NOT_A_PORT.has(name) && kind !== "unknown" ? name : null, sea: kind === "sea" };
}

export function collectImages(model: ReportModel): Image[] {
  const kinds = resolvePortKinds(model.rows);
  return model.rows.map((row) => ({ row, stage: getStageKey(row.stage, model.stageMappings), ...portOf(kinds, row) }));
}

/** Every judged answer, with its risk level and port. */
export function collectAnswers(model: ReportModel): Answer[] {
  const out: Answer[] = [];
  for (const img of collectImages(model)) {
    const row = img.row;
    if (row.expertResult === null) continue;
    const truth = row.expertResult === "اشتباه";
    const pairs: Array<["l1" | "l2", string, boolean]> = [["l1", row.levelOneResult, row.levelOneOther !== undefined], ["l2", row.levelTwoResult, row.levelTwoOther !== undefined]];
    for (const [level, answer, other] of pairs) {
      if (other) continue;
      const susp = answer === "اشتباه";
      out.push({ ...img, level, outcome: susp ? (truth ? "cs" : "fs") : truth ? "ms" : "cc" });
    }
  }
  return out;
}

type Ratio = { num: number; den: number };
const share = (r: Ratio) => (r.den === 0 ? null : (r.num / r.den) * 100);
const tally = <T>(items: T[], num: (x: T) => boolean, inBase: (x: T) => boolean): Ratio =>
  items.reduce((a, x) => (inBase(x) ? { num: a.num + (num(x) ? 1 : 0), den: a.den + 1 } : a), { num: 0, den: 0 });

/** Per-port shares of one measure over items carrying a port. */
function portStats<T extends { port: string | null; sea: boolean }>(items: T[], num: (x: T) => boolean, inBase: (x: T) => boolean): PortShare[] {
  const by = new Map<string, PortShare>();
  for (const x of items) {
    if (x.port === null || !inBase(x)) continue;
    const s = by.get(x.port) ?? { name: x.port, sea: x.sea, num: 0, den: 0 };
    by.set(x.port, s);
    s.den++;
    if (num(x)) s.num++;
  }
  return [...by.values()];
}

// ── Wording ─────────────────────────────────────────────────────────────────────────────────────────────────────

const P = (n: number | null) => `(${fmtPct(n ?? 0, 0)})`;
const portWord = (sea: boolean) => (sea ? "المنافذ البحرية" : "المنافذ البرية");
const placeName = (name: string) => `${name.startsWith("ميناء") ? "" : "منفذ "}${name}`;
/** «منفذ البطحاء (45%) وميناء جدة (34%)». */
const portList = (os: PortOutlier[]) => os.map((o) => `${placeName(o.name)} ${P(o.share)}`).join(" و");
const levelName = (k: StageCountKey) => (k === "unknown" ? "مستوى غير محدد" : STAGE_LABELS_AR[k].replace("المستوى", "مستوى المخاطر"));
const LEVELS: StageCountKey[] = ["first", "second", "third", "fourth"];

/** Port facts for one measure: per port type, the ports past `gap` against that type's total. */
function portFacts(stats: PortShare[], what: string, gap = PORT_GAP): string[] {
  const out: string[] = [];
  for (const sea of [false, true]) {
    const os = findOutliers(stats, sea, "high", PORT_MIN_BASE, gap);
    if (os.length) out.push(`تم رصد مستويات عالية من ${what} في ${portList(os)} مقارنة بإجمالي ${portWord(sea)} بمقدار ${P(os[0].baseShare)}.`);
  }
  return out;
}

/** «بلغت نسبة … ضمن مستوى المخاطر …» for the levels with a big enough base, highest share first, at most `max`. */
function levelFacts<T extends { stage: StageCountKey }>(items: T[], num: (x: T) => boolean, inBase: (x: T) => boolean, what: string, unit: string, max = 2): string[] {
  return LEVELS.map((k) => ({ k, r: tally(items.filter((x) => x.stage === k), num, inBase) }))
    .filter((x) => x.r.den >= MIN_BASE && x.r.num > 0)
    .sort((a, b) => (share(b.r) ?? 0) - (share(a.r) ?? 0))
    .slice(0, max)
    .map(({ k, r }) => `بلغت نسبة ${what} ${P(share(r))} من أصل (${fmtNum(r.den)}) ${unit} ضمن ${levelName(k)}.`);
}

// ── Recommendations, by cause ───────────────────────────────────────────────────────────────────────────────────

/** The recommendation wording, shared with the port report's observations (portReport/portObservations.ts). */
export const REC = {
  rootCause: (what: string) => `تحليل الأسباب الجذرية المؤدية ${what} من خلال تحديد عينة من الحالات على أساس كل مستوى من مستويات المخاطر لأغراض إعادة التحليل من الخبراء في مركزية الأشعة.`,
  staff: (what: string) => `رصد وتحليل أداء الموظفين العاملين على المنافذ التي شوهدت فيها مستويات مرتفعة من ${what} خلال فترة التقرير بشكل تراكمي، واتخاذ الإجراءات التصحيحية اللازمة.`,
  seizures: "تحليل الأسباب التي أدت إلى عدم رصد الحالات التي ارتبطت بضبطيات بالرغم من القدرة على اكتشاف الاشتباه بها من واقع الصور المعاد فحصها من ضمان الجودة.",
  device: "فحص عينة من أجهزة الأشعة المرتبطة بالصور منخفضة أو متوسطة الجودة للتحقق من جاهزيتها الفنية.",
  faults: "مراجعة سجل الأعطال وربطه بفترات إنتاج الصور منخفضة الجودة للتحقق من أثر الأعطال على جودة الصور.",
  periodic: (what: string) => `تطوير تقرير دوري من أنظمة التحليل لرصد ${what}، ومتابعتها بشكل شهري.`,
  kpi: (what: string) => `تضمين ${what} ضمن مؤشرات أداء منسوبي الوسائل الآلية.`,
  keep: (what: string) => `توثيق الممارسات التي أدت إلى انخفاض ${what} وتعميمها على المنافذ الأخرى، ومتابعة استمرار النسبة بشكل شهري.`,
};

// ── The catalogue ───────────────────────────────────────────────────────────────────────────────────────────────

export type Ctx = { model: ReportModel; answers: Answer[]; images: Image[] };
type Candidate = { observation: Observation; strength: number };
/** One observation type: `id` for tests and logs; `build` returns null when its trigger does not hold. */
export type ObservationType = { id: string; build: (ctx: Ctx) => Candidate | null };

const make = (priority: StatementPriority, topic: string, title: string, evidence: string[], recommendations: string[], page: string, strength: number): Candidate => ({
  observation: { priority, topic, title, evidence: evidence.map((text) => ({ text, figures: [] })), recommendations, page },
  strength,
});

const isMissed = (a: Answer) => a.outcome === "ms";
const cleanBase = (a: Answer) => a.outcome === "ms" || a.outcome === "cc";
const isFalse = (a: Answer) => a.outcome === "fs";
const suspBase = (a: Answer) => a.outcome === "fs" || a.outcome === "cs";
const agrees = (a: Answer) => a.outcome === "cc" || a.outcome === "cs";
const any = () => true;

/** Population suspicion share per level (L1 + L2 answers), from the workbook's population totals. */
function populationSuspicion(model: ReportModel): Map<StageCountKey, Ratio> {
  const out = new Map<StageCountKey, Ratio>();
  for (const [raw, lv] of Object.entries(model.population.summary?.byStageLevels ?? {})) {
    const key = getStageKey(raw, model.stageMappings);
    const t = out.get(key) ?? { num: 0, den: 0 };
    out.set(key, t);
    t.num += lv.levelOne.suspicious + lv.levelTwo.suspicious;
    t.den += lv.levelOne.clean + lv.levelOne.suspicious + lv.levelTwo.clean + lv.levelTwo.suspicious;
  }
  return out;
}

const POP_MEANING: Partial<Record<StageCountKey, string>> = {
  first: "والذي يؤكد أنه تم رصد ضبطيات من خلال الفرق الأمنية الأخرى",
  second: "والذي يؤكد الاشتباه من قبل الفرق الأمنية الأخرى",
};

export const OBSERVATION_TYPES: ObservationType[] = [
  {
    id: "missed-high",
    build: ({ model, answers }) => {
      const r = tally(answers, isMissed, cleanBase);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s < THRESHOLDS.missed.high) return null;
      const pop = populationSuspicion(model);
      const popFacts = (["first", "second"] as const).flatMap((k) => {
        const p = pop.get(k);
        return p && p.den >= MIN_BASE ? [`بلغت نسبة الاشتباهات المرصودة من الوسائل الآلية ${P(share(p))} من أصل (${fmtNum(p.den)}) إجابة ضمن ${levelName(k)} ${POP_MEANING[k]}.`] : [];
      });
      return make("عالية", "الاشتباهات الفائتة",
        `ارتفاع عدد الاشتباهات الفائتة التي لم يتم رصدها من قبل أخصائي الوسائل الآلية أثناء مرحلة الفحص، حيث شكلت ما نسبته ${fmtPct(s)} من إجابات السليمة للفترة.`,
        [...popFacts, ...portFacts(portStats(answers, isMissed, cleanBase), "الاشتباهات الفائتة")],
        [REC.seizures, REC.rootCause("لارتفاع الاشتباهات الفائتة"), REC.staff("الاشتباه الفائت")],
        "نتائج الأداء للمنافذ", (s - THRESHOLDS.missed.high) / THRESHOLDS.missed.high);
    },
  },
  {
    id: "missed-low",
    build: ({ answers }) => {
      const r = tally(answers, isMissed, cleanBase);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s > THRESHOLDS.missed.low) return null;
      return make("للعلم", "الاشتباهات الفائتة",
        `انخفاض نسبة الاشتباهات الفائتة أثناء مرحلة الفحص من قبل أخصائي الوسائل الآلية، حيث شكلت ما نسبته ${fmtPct(s)} فقط من إجابات السليمة للفترة.`,
        [...levelFacts(answers, isMissed, cleanBase, "الاشتباهات الفائتة", "إجابة سليمة"), ...portFacts(portStats(answers, isMissed, cleanBase), "الاشتباهات الفائتة")],
        [REC.keep("الاشتباهات الفائتة"), REC.staff("الاشتباه الفائت")],
        "نتائج الأداء للمنافذ", 0);
    },
  },
  {
    id: "false-high",
    build: ({ answers }) => {
      const r = tally(answers, isFalse, suspBase);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s < THRESHOLDS.falseSusp.high) return null;
      const l4 = tally(answers.filter((a) => a.stage === "fourth"), isFalse, suspBase);
      const l4Fact = l4.den >= MIN_BASE
        ? [`بلغت نسبة الاشتباهات الخاطئة من قبل أخصائي الوسائل الآلية أثناء مرحلة الفحص ${P(share(l4))} من أصل (${fmtNum(l4.den)}) إجابة اشتباه ضمن مستوى المخاطر الرابع والذي لم يتم من خلاله الاشتباه بالإرسالية من قبل أي من الفرق الأمنية الأخرى أو التعليم عليها من قبل محرك المخاطر.`]
        : [];
      return make("عالية", "الاشتباهات الخاطئة",
        `انخفاض دقة الاشتباه أثناء مرحلة الفحص من قبل أخصائي الوسائل الآلية، حيث شكلت نسبة الاشتباه الخاطئ ${fmtPct(s)} من إجمالي إجابات الاشتباه للفترة.`,
        [...l4Fact, ...portFacts(portStats(answers, isFalse, suspBase), "الاشتباهات الخاطئة")],
        [REC.rootCause("لارتفاع الاشتباهات الخاطئة"), REC.staff("الاشتباه الخاطئ")],
        "نتائج الأداء للمنافذ", (s - THRESHOLDS.falseSusp.high) / THRESHOLDS.falseSusp.high);
    },
  },
  {
    id: "false-low",
    build: ({ answers }) => {
      const r = tally(answers, isFalse, suspBase);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s > THRESHOLDS.falseSusp.low) return null;
      return make("للعلم", "الاشتباهات الخاطئة",
        `ارتفاع دقة الاشتباه أثناء مرحلة الفحص من قبل أخصائي الوسائل الآلية، حيث شكلت نسبة الاشتباه الخاطئ ${fmtPct(s)} فقط من إجمالي إجابات الاشتباه للفترة.`,
        [...levelFacts(answers, isFalse, suspBase, "الاشتباهات الخاطئة", "إجابة اشتباه"), ...portFacts(portStats(answers, isFalse, suspBase), "الاشتباهات الخاطئة")],
        [REC.keep("الاشتباهات الخاطئة"), REC.staff("الاشتباه الخاطئ")],
        "نتائج الأداء للمنافذ", 0);
    },
  },
  {
    id: "level-three-missed",
    build: ({ answers }) => {
      const l3 = answers.filter((a) => a.stage === "third");
      const r = tally(l3, isMissed, any);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s < THRESHOLDS.levelThreeMissed) return null;
      return make("عالية", "مؤشرات المخاطر",
        `انخفاض التفاعل مع مؤشرات المخاطر التي تم تعليمها على الإرساليات، حيث بلغت نسبة الاشتباهات الفائتة ${fmtPct(s)} من أصل (${fmtNum(r.den)}) إجابة ضمن مستوى المخاطر الثالث.`,
        ["يمثل مستوى المخاطر الثالث الإرساليات التي تم التعليم عليها من قبل محرك المخاطر ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.", ...portFacts(portStats(l3, isMissed, any), "الاشتباهات الفائتة على الإرساليات المعلَّمة")],
        [
          "إعادة فحص عينة من حالات الاشتباه الفائت المرصودة وتحليل الأسباب التي أدت إلى الاشتباه في حال كانت النتيجة بعد الفحص من قبل الشؤون الأمنية بأنها اشتباه.",
          REC.staff("الاشتباه الفائت على الإرساليات المعلَّمة"),
          "تحليل الخصائص والعوامل المشتركة للإرساليات ذات مؤشرات المخاطر التي لم تُعد حالات اشتباه، وإحالتها للتحليل والدراسة.",
        ],
        "دقة إجابات المستوى الأول والثاني", (s - THRESHOLDS.levelThreeMissed) / THRESHOLDS.levelThreeMissed);
    },
  },
  {
    id: "marking-low",
    build: ({ images }) => {
      const susp = images.filter((i) => i.row.imageResult === "اشتباه" && i.row.hasMarking !== null);
      const r = tally(susp, (i) => i.row.hasMarking === true, any);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s >= THRESHOLDS.marked) return null;
      const unmarked = (i: Image) => i.row.hasMarking === false;
      return make("عالية", "تحديد موقع الاشتباه",
        `عدم الالتزام بتحديد مواقع الاشتباهات أثناء فحص الصورة من قبل أخصائي الوسائل الآلية، حيث شكلت نسبة الصور التي تم تحديدها ${P(s)} من إجمالي صور الاشتباه خلال الفترة.`,
        [...levelFacts(susp, unmarked, any, "صور الاشتباه دون تحديد الموقع", "صورة", 1), ...portFacts(portStats(susp, unmarked, any), "عدم تحديد مواقع الاشتباه في الصور")],
        ["حصر وتحليل أسباب عدم تحديد مواقع الاشتباه في الصور على مستوى المنافذ.", REC.kpi("صحة واستكمال توثيق مواقع الاشتباه"), REC.periodic("الحالات التي تم تصنيفها كاشتباه دون تحديد موقع الاشتباه")],
        "هل يوجد تحديد؟", (THRESHOLDS.marked - s) / THRESHOLDS.marked);
    },
  },
  {
    id: "quality-poor",
    build: ({ images }) => {
      const rated = images.filter((i) => i.row.imageQuality !== null);
      const poor = (i: Image) => i.row.imageQuality === "منخفض" || i.row.imageQuality === "متوسط";
      const r = tally(rated, poor, any);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s < THRESHOLDS.poorQuality) return null;
      return make("متوسطة", "جودة الصورة",
        `انخفاض جودة صورة الأشعة حيث بلغت نسبة الصور التي تعد جودتها متوسطة أو منخفضة ما نسبته ${P(s)} من أصل (${fmtNum(r.den)}) صورة تم فحصها.`,
        [
          ...portFacts(portStats(rated, (i) => i.row.imageQuality === "منخفض", any), "الصور المصنفة منخفضة الجودة", 5),
          ...portFacts(portStats(rated, poor, any), "الصور المصنفة متوسطة أو منخفضة الجودة"),
        ],
        [REC.device, REC.faults, "تحليل أسباب انخفاض جودة الصور في المنافذ المستهدفة وتنفيذ الإجراءات التصحيحية المناسبة."],
        "جودة الصور المفحوصة", (s - THRESHOLDS.poorQuality) / THRESHOLDS.poorQuality);
    },
  },
  {
    id: "quality-linked-errors",
    build: ({ answers }) => {
      // Low-quality answers alone when there are enough of them (medium dilutes the effect); otherwise medium + low together.
      const lowOnly = answers.filter((a) => a.row.imageQuality === "منخفض").length >= MIN_BASE;
      const poorQ = (a: Answer) => a.row.imageQuality === "منخفض" || (!lowOnly && a.row.imageQuality === "متوسط");
      const tier = lowOnly ? "منخفضة الجودة" : "متوسطة أو منخفضة الجودة";
      const highQ = (a: Answer) => a.row.imageQuality === "عالي";
      const lo = answers.filter(poorQ);
      const hi = answers.filter(highQ);
      const sLo = share(tally(lo, agrees, any));
      const sHi = share(tally(hi, agrees, any));
      if (sHi === null || sLo === null || hi.length < MIN_BASE || lo.length < MIN_BASE || sHi - sLo < THRESHOLDS.qualityGap) return null;
      return make("متوسطة", "جودة الصورة",
        `ارتفاع أخطاء الفحص في الصور ${tier}، حيث بلغ معدل الاتفاق مع أخصائي ضمان الجودة ${P(sLo)} فيها مقابل ${P(sHi)} في الصور عالية الجودة.`,
        [
          `بلغت نسبة الاشتباهات الفائتة ${P(share(tally(lo, isMissed, cleanBase)))} في الصور ${tier} مقابل ${P(share(tally(hi, isMissed, cleanBase)))} في الصور عالية الجودة.`,
          `بلغت نسبة الاشتباهات الخاطئة ${P(share(tally(lo, isFalse, suspBase)))} في الصور ${tier} مقابل ${P(share(tally(hi, isFalse, suspBase)))} في الصور عالية الجودة.`,
        ],
        [REC.device, "إعادة التقاط الصورة أو إحالتها للفحص اليدوي عند تصنيف جودتها منخفضة، بدل اتخاذ القرار عليها.", REC.periodic("الصور منخفضة الجودة ونتائج فحصها")],
        "معدل الاتفاق العام حسب جودة الصورة", (sHi - sLo - THRESHOLDS.qualityGap) / THRESHOLDS.qualityGap);
    },
  },
  {
    id: "level-gap",
    build: ({ answers }) => {
      const s1 = share(tally(answers.filter((a) => a.level === "l1"), agrees, any));
      const s2 = share(tally(answers.filter((a) => a.level === "l2"), agrees, any));
      const n1 = answers.filter((a) => a.level === "l1").length;
      const n2 = answers.length - n1;
      if (s1 === null || s2 === null || n1 < MIN_BASE || n2 < MIN_BASE || Math.abs(s1 - s2) < THRESHOLDS.levelGap) return null;
      const lowIsL1 = s1 < s2;
      const [low, high] = lowIsL1 ? ["الأول", "الثاني"] : ["الثاني", "الأول"];
      const mine = answers.filter((a) => a.level === (lowIsL1 ? "l1" : "l2"));
      return make("متوسطة", "المستويان",
        `انخفاض دقة إجابات أخصائيي المستوى ${low} مقارنة بالمستوى ${high}، حيث بلغ معدل الاتفاق مع أخصائي ضمان الجودة ${P(lowIsL1 ? s1 : s2)} مقابل ${P(lowIsL1 ? s2 : s1)}.`,
        [
          `بلغت نسبة الاشتباهات الفائتة في إجابات المستوى ${low} ${P(share(tally(mine, isMissed, cleanBase)))}، ونسبة الاشتباهات الخاطئة ${P(share(tally(mine, isFalse, suspBase)))}.`,
          ...portFacts(portStats(mine, (a) => !agrees(a), any), `عدم الاتفاق في إجابات المستوى ${low}`),
        ],
        [REC.rootCause(`لانخفاض دقة إجابات المستوى ${low}`), `توحيد معايير الاشتباه بين المستويين من خلال ورش عمل مشتركة لأخصائيي المستوى ${low} والمستوى ${high}.`, REC.staff(`عدم الاتفاق في المستوى ${low}`)],
        "دقة إجابات المستوى الأول والثاني", (Math.abs(s1 - s2) - THRESHOLDS.levelGap) / THRESHOLDS.levelGap);
    },
  },
  {
    id: "missing-image",
    build: ({ images }) => {
      const studied = images.filter((i) => i.row.answerStatus === "submitted" && i.row.imageAvailable !== null);
      const missing = (i: Image) => i.row.imageAvailable === false;
      const r = tally(studied, missing, any);
      const s = share(r);
      if (s === null || r.den < MIN_BASE || s < THRESHOLDS.missingImage) return null;
      return make("متوسطة", "توفر الصورة",
        `عدم توفر صورة الأشعة لعدد من الحالات المختارة في العينة، حيث بلغت نسبة الحالات التي لا توجد لها صورة ${P(s)} من أصل (${fmtNum(r.den)}) حالة تمت دراستها.`,
        [...levelFacts(studied, missing, any, "الحالات التي لا توجد لها صورة", "حالة", 1), ...portFacts(portStats(studied, missing, any), "الحالات التي لا توجد لها صورة")],
        ["حصر أسباب عدم توفر صور الأشعة على مستوى المنافذ ومعالجتها مع الجهات الفنية.", REC.periodic("الإرساليات التي تم فحصها دون حفظ صورة الأشعة"), REC.kpi("استكمال حفظ صور الأشعة")],
        "جودة الصور المفحوصة", (s - THRESHOLDS.missingImage) / THRESHOLDS.missingImage);
    },
  },
  {
    id: "error-concentration",
    build: ({ answers }) => {
      const named = answers.filter((a) => a.port !== null);
      const errors = named.filter((a) => !agrees(a)).length;
      if (named.length < MIN_BASE || errors < MIN_BASE) return null;
      const top = portStats(named, (a) => !agrees(a), any)
        .filter((p) => p.den >= PORT_MIN_BASE)
        .map((p) => ({ ...p, errShare: (p.num / errors) * 100, ansShare: (p.den / named.length) * 100 }))
        .sort((a, b) => b.errShare - b.ansShare - (a.errShare - a.ansShare) || (a.name < b.name ? -1 : 1))[0];
      if (!top || top.errShare - top.ansShare < THRESHOLDS.concentration) return null;
      const mine = named.filter((a) => a.port === top.name);
      const place = placeName(top.name);
      return make("عالية", "تركز الأخطاء",
        `تركز أخطاء الفحص في ${place}، حيث شكلت أخطاؤه ${P(top.errShare)} من إجمالي أخطاء الفحص للفترة بينما تمثل إجاباته ${P(top.ansShare)} من إجمالي الإجابات.`,
        [
          `بلغت نسبة الاشتباهات الفائتة في ${place} ${P(share(tally(mine, isMissed, cleanBase)))}، ونسبة الاشتباهات الخاطئة ${P(share(tally(mine, isFalse, suspBase)))}.`,
          ...levelFacts(mine, (a) => !agrees(a), any, `عدم الاتفاق في ${place}`, "إجابة"),
        ],
        [REC.rootCause(`لتركز الأخطاء في ${place}`), `رصد وتحليل أداء الموظفين العاملين في ${place} خلال فترة التقرير بشكل تراكمي، واتخاذ الإجراءات التصحيحية اللازمة.`, REC.periodic(`مؤشرات دقة الفحص في ${place}`)],
        "نتائج الأداء للمنافذ", (top.errShare - top.ansShare - THRESHOLDS.concentration) / THRESHOLDS.concentration);
    },
  },
];

const ORDER: Record<StatementPriority, number> = { "عالية": 0, "متوسطة": 1, "للعلم": 2 };

/** Run every observation type; keep those whose trigger holds, by priority then strength, capped. */
export function buildObservations(model: ReportModel, types: ObservationType[] = OBSERVATION_TYPES): Observation[] {
  if (model.errorAnalysis.totals.evaluable === 0) return [];
  const images = collectImages(model);
  const ctx: Ctx = { model, images, answers: collectAnswers(model) };
  return types
    .map((t, i) => ({ c: t.build(ctx), i }))
    .filter((x): x is { c: Candidate; i: number } => x.c !== null)
    .sort((a, b) => ORDER[a.c.observation.priority] - ORDER[b.c.observation.priority] || b.c.strength - a.c.strength || a.i - b.i)
    .slice(0, MAX_OBSERVATIONS)
    .map((x) => x.c.observation);
}

/** The observations as a workbook: one row per observation as the report shows it. */
export function buildStatementsWorkbook(observations: Observation[], periodLabel: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    [`الملاحظات والتوصيات المستخلصة من نتائج التقرير - ${periodLabel}`],
    [],
    ["#", "الملاحظة الرئيسية", "الشواهد الجوهرية", "التوصية", "الأولوية", "صفحة التقرير"],
    ...observations.map((o, i): Array<string | number> => [i + 1, o.title, o.evidence.map((e) => e.text).join("\n"), o.recommendations.map((r, j) => `${j + 1}. ${r}`).join("\n"), o.priority, o.page]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 5 }, { wch: 60 }, { wch: 100 }, { wch: 80 }, { wch: 10 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "الملاحظات والتوصيات");
  return wb;
}

/** Build and download the observations workbook for a report input (browser). */
export function downloadStatementsWorkbook(input: ExecutiveReportInput, periodLabel: string): void {
  const model = buildReportModel(input, {});
  XLSX.writeFile(buildStatementsWorkbook(buildObservations(model), periodLabel), `الملاحظات_والتوصيات_${periodLabel}.xlsx`, { compression: true });
}
