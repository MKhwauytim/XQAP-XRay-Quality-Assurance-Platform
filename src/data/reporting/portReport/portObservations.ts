// «الملاحظات والتوصيات» for the port business report.
//
// Same model and wording as the executive report's buildObservations
// (deck3/statements.ts): every observation is a fixed rule with a condition on
// the report's own figures, and is written only when the condition holds. Each
// one is a full-sentence main observation (الملاحظة الرئيسية), supporting facts
// written as sentences with every rate as a count and its percentage (الشواهد
// الجوهرية), and numbered recommendations (التوصية) taken from the same
// catalogue as the executive report. Comparisons are always with the three
// workload tiers, the selected port left out of each tier.

import { fmtNum } from "../executive/primitives";
import { REC } from "../executive/deck3/statements";
import type { OutcomeStats, PortReportModel } from "./portReportModel";
import type { LevelOutcomes, WorkloadTierKey } from "./portWorkloadModel";
import type { WorkloadSlideInput } from "./portWorkloadSlides";

export type PortObservation = {
  key: string;
  priority: "عالية" | "متوسطة";
  /** Short topic for the page title, «الملاحظة 01 - {topic}». */
  topic: string;
  /** الملاحظة الرئيسية: one full sentence. */
  title: string;
  /** الشواهد الجوهرية: one sentence per fact. */
  evidence: string[];
  /** التوصية: numbered on the slide. */
  recommendations: string[];
  /** Where the figures are shown: report slide / workbook sheet. */
  source: string;
};

/** A year-on-year fall in نسبة التوائم of at least this many points is reported. */
export const DECLINE_POINTS = 1;

const pct = (v: number | null, d = 1) => (v === null ? "-" : `${(v * 100).toFixed(d)}%`);
const share = (n: number, of: number) => (of > 0 ? n / of : null);
/** «82.9% من أصل (44,523) صورة مدروسة»: a rate with the count it is taken from. */
const rateOf = (n: number, of: number, unit = "صورة مدروسة") => `${pct(share(n, of))} من أصل (${fmtNum(of)}) ${unit}`;
const tierName = (label: string) => `مستوى العبء ${label}`;

type Rate = { key: "missed" | "falseSuspicion"; name: string; plural: string };
const RATES: Rate[] = [
  { key: "falseSuspicion", name: "الاشتباه الخاطئ", plural: "الاشتباهات الخاطئة" },
  { key: "missed", name: "الاشتباه الفائت", plural: "الاشتباهات الفائتة" },
];
const LEVEL_NAME = { l1: "المستوى الأول", l2: "المستوى الثاني" } as const;

export function buildPortObservations(m: PortReportModel, w?: WorkloadSlideInput): PortObservation[] {
  const out: PortObservation[] = [];
  const name = m.displayName;
  if (!w) return out;
  const tiers = w.tiers.filter((t) => w.outcomes[t.key].image.studied > 0);
  const sel = w.outcomes.selected;
  if (!tiers.length || sel.image.studied === 0) return out;
  const tierOutcome = (k: WorkloadTierKey): LevelOutcomes => w.outcomes[k];
  /** «بلغت نسبة التوائم في مستوى العبء المنخفض 95.7% من أصل (2,054) صورة مدروسة…» for each tier. */
  const tierAccuracyFacts = (keys = tiers) => keys.map((t) => {
    const o = tierOutcome(t.key).image;
    return `بلغت نسبة التوائم في ${tierName(t.label)} ${rateOf(o.matched, o.studied)}، بعدد (${fmtNum(o.matched)}) صورة متوافقة.`;
  });

  // 1. نسبة التوائم below the tiers.
  {
    const above = tiers.filter((t) => (tierOutcome(t.key).image.accuracy ?? 0) > (sel.image.accuracy ?? 0));
    if (above.length) {
      const all = above.length === tiers.length;
      const unmatched = sel.image.studied - sel.image.matched;
      out.push({
        key: "accuracy",
        priority: all ? "عالية" : "متوسطة",
        topic: "نسبة التوائم",
        title: `انخفاض نسبة التوائم في ${name} مقارنة ${all ? "بمستويات العبء الثلاثة" : `بـ${above.map((t) => tierName(t.label)).join(" و")}`}، حيث بلغت ${pct(sel.image.accuracy)} من إجمالي الصور المدروسة للفترة.`,
        evidence: [
          `بلغت نسبة التوائم في ${name} ${rateOf(sel.image.matched, sel.image.studied)}، بعدد (${fmtNum(sel.image.matched)}) صورة متوافقة و(${fmtNum(unmatched)}) صورة غير متوافقة.`,
          ...tierAccuracyFacts(above),
        ],
        recommendations: [
          REC.rootCause(`لانخفاض نسبة التوائم في ${name}`),
          REC.staff("عدم التوائم"),
        ],
        source: "الأداء حسب مستوى العبء",
      });
    }
  }

  // 2 and 3. الاشتباه الخاطئ / الاشتباه الفائت share above every tier.
  for (const r of RATES) {
    const rate = (o: OutcomeStats) => share(o[r.key], o.studied) ?? 0;
    const mine = rate(sel.image);
    if (!tiers.every((t) => rate(tierOutcome(t.key).image) < mine)) continue;
    out.push({
      key: r.key,
      priority: "عالية",
      topic: r.plural,
      title: `ارتفاع نسبة ${r.plural} في ${name} مقارنة بمستويات العبء الثلاثة، حيث شكلت ما نسبته ${pct(mine)} من إجمالي الصور المدروسة للفترة.`,
      evidence: [
        `بلغ عدد ${r.plural} في ${name} (${fmtNum(sel.image[r.key])}) صورة، أي ${rateOf(sel.image[r.key], sel.image.studied)}.`,
        ...tiers.map((t) => {
          const o = tierOutcome(t.key).image;
          return `بلغت نسبة ${r.plural} في ${tierName(t.label)} ${rateOf(o[r.key], o.studied)}، بعدد (${fmtNum(o[r.key])}) صورة.`;
        }),
      ],
      recommendations: [
        REC.rootCause(`لارتفاع ${r.plural}`),
        REC.staff(r.name),
      ],
      source: "الأداء حسب مستوى العبء",
    });
  }

  // 4. Change between the last two study years.
  {
    const ys = w.yearly.filter((y) => y.selected.image.studied > 0);
    if (ys.length >= 2) {
      const [a, b] = ys.slice(-2);
      const fall = ((a.selected.image.accuracy ?? 0) - (b.selected.image.accuracy ?? 0)) * 100;
      if (fall >= DECLINE_POINTS) {
        // The outcome whose share grew most between the two years is named in the evidence.
        const grown = RATES.map((r) => ({ r, from: share(a.selected.image[r.key], a.selected.image.studied) ?? 0, to: share(b.selected.image[r.key], b.selected.image.studied) ?? 0 }))
          .map((x) => ({ ...x, d: x.to - x.from }))
          .sort((x, y) => y.d - x.d)[0];
        // The three tiers in one line, so the evidence panel does not overflow.
        const tierParts = tiers
          .filter((t) => (a.tiers[t.key]?.image.studied ?? 0) > 0 && (b.tiers[t.key]?.image.studied ?? 0) > 0)
          .map((t) => `${t.label} ${pct(a.tiers[t.key]!.image.accuracy)} ثم ${pct(b.tiers[t.key]!.image.accuracy)}`);
        const tierFacts = tierParts.length ? [`نسبة التوائم في مستويات العبء (${a.year} ثم ${b.year}): ${tierParts.join("، ")}.`] : [];
        out.push({
          key: "decline",
          priority: "عالية",
          topic: `التغير بين ${a.year} و${b.year}`,
          title: `انخفاض نسبة التوائم في ${name} من ${pct(a.selected.image.accuracy)} في ${a.year} إلى ${pct(b.selected.image.accuracy)} في ${b.year}، بفارق (${fall.toFixed(1)}) نقطة.`,
          evidence: [
            `بلغت نسبة التوائم في ${name} ${rateOf(a.selected.image.matched, a.selected.image.studied)} في ${a.year}.`,
            `بلغت نسبة التوائم في ${name} ${rateOf(b.selected.image.matched, b.selected.image.studied)} في ${b.year}.`,
            ...(grown.d > 0
              ? [`ارتفعت نسبة ${grown.r.plural} من ${pct(grown.from)} (${fmtNum(a.selected.image[grown.r.key])} صورة) في ${a.year} إلى ${pct(grown.to)} (${fmtNum(b.selected.image[grown.r.key])} صورة) في ${b.year}.`]
              : []),
            ...tierFacts,
          ],
          recommendations: [
            REC.rootCause(`لانخفاض نسبة التوائم في ${b.year}`),
            REC.periodic(`نسبة التوائم في ${name}`),
          ],
          source: `مقارنة ${a.year} و${b.year}`,
        });
      }
    }
  }

  // 5. Level 1 and level 2 both below every tier's same level.
  {
    const below = (lv: "l1" | "l2") => tiers.every((t) => (tierOutcome(t.key)[lv].accuracy ?? 0) > (sel[lv].accuracy ?? 1));
    if (sel.l1.studied > 0 && sel.l2.studied > 0 && below("l1") && below("l2")) {
      const range = (lv: "l1" | "l2") => {
        const v = tiers.map((t) => tierOutcome(t.key)[lv].accuracy ?? 0);
        return `${pct(Math.min(...v))} و${pct(Math.max(...v))}`;
      };
      out.push({
        key: "levels",
        priority: "متوسطة",
        topic: "المستوى الأول والمستوى الثاني",
        title: `انخفاض نسبة التوائم في المستويين الأول والثاني في ${name} مقارنة بالمستوى نفسه في مستويات العبء الثلاثة.`,
        evidence: (["l1", "l2"] as const).flatMap((lv) => [
          `بلغت نسبة التوائم في ${LEVEL_NAME[lv]} في ${name} ${rateOf(sel[lv].matched, sel[lv].studied, "إجابة")}.`,
          `تراوحت نسبة التوائم في ${LEVEL_NAME[lv]} في مستويات العبء الثلاثة بين ${range(lv)}.`,
        ]),
        recommendations: [
          REC.rootCause(`لانخفاض نسبة التوائم في المستويين الأول والثاني في ${name}`),
          REC.kpi("نسبة التوائم في المستويين الأول والثاني"),
        ],
        source: "نتائج المستوى الأول والمستوى الثاني حسب مستوى العبء التشغيلي",
      });
    }
  }

  // 6. High workload tier with a نسبة التوائم below the low tier.
  {
    const selPort = w.tiers.flatMap((t) => t.ports).find((p) => p.port === w.port);
    const selTier = w.tiers.find((t) => t.ports.some((p) => p.port === w.port));
    const low = w.tiers.find((t) => t.key === "low");
    const lowOutcome = tierOutcome("low").image;
    if (selPort && selTier?.key === "high" && low && lowOutcome.accuracy !== null && (sel.image.accuracy ?? 1) < lowOutcome.accuracy && selPort.perEmployeeMonth !== null) {
      // The tiers are built on all ports together (land and sea), so the comparison is all ports.
      const typeAvg = Object.values(selTier.averages)[0];
      const typeName = "جميع المنافذ";
      out.push({
        key: "workload",
        priority: "متوسطة",
        topic: "عبء العمل",
        title: `ارتفاع عبء العمل في ${name}، حيث يقع في مستوى العبء العالي ونسبة التوائم فيه أقل من مستوى العبء المنخفض.`,
        evidence: [
          `بلغ متوسط عدد الحالات المفحوصة للموظف الواحد في الشهر في ${name} (${fmtNum(Math.round(selPort.perEmployeeMonth))}) حالة في سنة ${w.loadYear}${typeAvg === undefined ? "" : `، مقابل متوسط (${fmtNum(Math.round(typeAvg))}) حالة في ${typeName}`}.`,
          `بلغ متوسط عدد الموظفين في الشهر في ${name} (${fmtNum(Math.round(selPort.employeesPerMonth ?? 0))}) موظفًا.`,
          `بلغت نسبة التوائم في ${name} ${rateOf(sel.image.matched, sel.image.studied)}، مقابل ${rateOf(lowOutcome.matched, lowOutcome.studied)} في ${tierName(low.label)}.`,
        ],
        recommendations: [
          `مراجعة توزيع الموظفين المخصصين لـ ${name} بما يخفض متوسط عدد الحالات المفحوصة للموظف الواحد نحو متوسط ${typeName}.`,
          REC.periodic(`متوسط عدد الحالات المفحوصة للموظف الواحد في ${name}`),
        ],
        source: `تأثير عبء العمل على النتائج (سنة ${w.loadYear})`,
      });
    }
  }

  // 7. Employees in the low accuracy tier.
  {
    const d = m.distribution;
    const lowT = d.tiers.find((t) => t.key === "low");
    if (lowT && lowT.count > 0 && d.tiered > 0) {
      out.push({
        key: "staff",
        priority: "متوسطة",
        topic: "أداء الموظفين",
        title: `وجود (${fmtNum(lowT.count)}) من منسوبي ${name} في فئة الدقة المنخفضة، أي ${pct(share(lowT.count, d.tiered))} من الموظفين المصنفين.`,
        evidence: [
          `بلغ عدد الموظفين المصنفين حسب الدقة (${fmtNum(d.tiered)}) موظفًا، منهم (${fmtNum(lowT.count)}) في الفئة المنخفضة.`,
          `تتراوح نسبة التوائم في الفئة المنخفضة بين ${pct(lowT.from)} و${pct(lowT.to)}، بمتوسط ${pct(lowT.meanAccuracy)}.`,
        ],
        recommendations: [
          `برنامج تدريب موجه للموظفين الـ (${fmtNum(lowT.count)}) في فئة الدقة المنخفضة، ومتابعة نتائجهم بعد التدريب.`,
          REC.kpi("نسبة التوائم لكل موظف"),
        ],
        source: "معدل التوافق لمنسوبي المنفذ / مستويات دقة الموظفين",
      });
    }
  }

  const rank = { "عالية": 0, "متوسطة": 1 } as const;
  return out.map((o, i) => ({ o, i })).sort((a, b) => rank[a.o.priority] - rank[b.o.priority] || a.i - b.i).map((x) => x.o);
}
