// «الملاحظات والتوصيات» for the port business report.
//
// Same idea as the executive report's buildObservations (deck3/statements.ts):
// every observation is a fixed rule with a condition on the report's own
// figures. When the condition does not hold, the observation is not written.
// Every number in the text and in the figures list is computed here from the
// model; nothing is typed in by hand. Comparisons are always with the three
// workload tiers (the selected port left out of each tier), as on the main slides.

import { fmtNum } from "../executive/primitives";
import type { OutcomeStats, PortReportModel } from "./portReportModel";
import type { LevelOutcomes, WorkloadTierKey } from "./portWorkloadModel";
import type { WorkloadSlideInput } from "./portWorkloadSlides";

export type PortObservationFigure = { label: string; value: string };
export type PortObservation = {
  key: string;
  priority: "عالية" | "متوسطة";
  /** الملاحظة الرئيسية */
  title: string;
  /** The numbers behind the observation (count plus percentage for every rate). */
  figures: PortObservationFigure[];
  /** التوصية */
  recommendation: string;
  /** Where the figures are shown: report slide / workbook sheet. */
  source: string;
};

/** A year-on-year fall in نسبة التوائم of at least this many points is reported. */
export const DECLINE_POINTS = 1;

const pct = (v: number | null, d = 1) => (v === null ? "-" : `${(v * 100).toFixed(d)}%`);
const share = (n: number, of: number) => (of > 0 ? n / of : null);
/** «16,482 من 44,523 (82.9%)»: a rate always as its count plus its percentage. */
const countOf = (n: number, of: number) => `${fmtNum(n)} من ${fmtNum(of)} (${pct(share(n, of))})`;
/** «36,930 (82.9%)»: the short form for the figures row (the denominator is in the slide tables). */
const short = (n: number, of: number) => `${fmtNum(n)} (${pct(share(n, of))})`;
const matchedOf = (o: OutcomeStats) => short(o.matched, o.studied);
const tierName = (label: string) => `مستوى العبء ${label}`;
const tierShort = (label: string) => `عبء ${label}`;

type Rate = { key: "missed" | "falseSuspicion"; name: string };
const RATES: Rate[] = [
  { key: "falseSuspicion", name: "الاشتباه الخاطئ" },
  { key: "missed", name: "الاشتباه الفائت" },
];

export function buildPortObservations(m: PortReportModel, w?: WorkloadSlideInput): PortObservation[] {
  const out: PortObservation[] = [];
  const name = m.displayName;
  if (!w) return out;
  const tiers = w.tiers.filter((t) => w.outcomes[t.key].image.studied > 0);
  const sel = w.outcomes.selected;
  if (!tiers.length || sel.image.studied === 0) return out;
  const tierOutcome = (k: WorkloadTierKey): LevelOutcomes => w.outcomes[k];
  const unmatched = sel.image.studied - sel.image.matched;

  // 1. نسبة التوائم below the tiers.
  {
    const above = tiers.filter((t) => (tierOutcome(t.key).image.accuracy ?? 0) > (sel.image.accuracy ?? 0));
    if (above.length) {
      const all = above.length === tiers.length;
      out.push({
        key: "accuracy",
        priority: all ? "عالية" : "متوسطة",
        title: all
          ? `نسبة التوائم في ${name} (${pct(sel.image.accuracy)}) أقل من مستويات العبء الثلاثة`
          : `نسبة التوائم في ${name} (${pct(sel.image.accuracy)}) أقل من ${above.map((t) => tierName(t.label)).join(" و")}`,
        figures: [
          { label: `المتوافقة: ${name}`, value: matchedOf(sel.image) },
          ...above.map((t) => ({ label: `المتوافقة: ${tierShort(t.label)}`, value: matchedOf(tierOutcome(t.key).image) })),
        ],
        recommendation: `مراجعة الحالات غير المتوافقة في ${name} وعددها ${countOf(unmatched, sel.image.studied)}، وتحديد أسباب عدم التوائم فيها مع أخصائيي الوسائل الآلية.`,
        source: "الأداء حسب مستوى العبء",
      });
    }
  }

  // 2 and 3. الاشتباه الخاطئ / الاشتباه الفائت share above every tier.
  for (const r of RATES) {
    const rateOf = (o: OutcomeStats) => share(o[r.key], o.studied) ?? 0;
    const mine = rateOf(sel.image);
    if (!tiers.every((t) => rateOf(tierOutcome(t.key).image) < mine)) continue;
    const verb = r.key === "falseSuspicion" ? "مراجعة معايير رفع الاشتباه في" : "مراجعة حالات الاشتباه الفائت في";
    out.push({
      key: r.key,
      priority: "عالية",
      title: `نسبة ${r.name} في ${name} (${pct(mine)}) أعلى من مستويات العبء الثلاثة`,
      figures: [
        { label: `${r.name}: ${name}`, value: short(sel.image[r.key], sel.image.studied) },
        ...tiers.map((t) => ({ label: `${r.name}: ${tierShort(t.label)}`, value: short(tierOutcome(t.key).image[r.key], tierOutcome(t.key).image.studied) })),
      ],
      recommendation: `${verb} ${name} مع أخصائيي الوسائل الآلية، إذ يمثل ${r.name} ${countOf(sel.image[r.key], unmatched)} من الحالات غير المتوافقة.`,
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
        // The outcome whose share grew most between the two years names the focus of the recommendation.
        const grown = RATES.map((r) => ({ r, from: share(a.selected.image[r.key], a.selected.image.studied) ?? 0, to: share(b.selected.image[r.key], b.selected.image.studied) ?? 0 }))
          .map((x) => ({ ...x, d: x.to - x.from }))
          .sort((x, y) => y.d - x.d)[0];
        const tierFigures = tiers
          .filter((t) => (a.tiers[t.key]?.image.studied ?? 0) > 0 && (b.tiers[t.key]?.image.studied ?? 0) > 0)
          .map((t) => ({ label: `${tierShort(t.label)} ${a.year} ثم ${b.year}`, value: `${pct(a.tiers[t.key]!.image.accuracy)} ثم ${pct(b.tiers[t.key]!.image.accuracy)}` }));
        out.push({
          key: "decline",
          priority: "عالية",
          title: `انخفضت نسبة التوائم في ${name} من ${pct(a.selected.image.accuracy)} في ${a.year} إلى ${pct(b.selected.image.accuracy)} في ${b.year} (${fall.toFixed(1)} نقطة)`,
          figures: [
            { label: `المتوافقة ${a.year}`, value: matchedOf(a.selected.image) },
            { label: `المتوافقة ${b.year}`, value: matchedOf(b.selected.image) },
            ...tierFigures,
          ],
          recommendation:
            grown.d > 0
              ? `دراسة أسباب الانخفاض في ${b.year}، ولا سيما ارتفاع ${grown.r.name} من ${countOf(a.selected.image[grown.r.key], a.selected.image.studied)} في ${a.year} إلى ${countOf(b.selected.image[grown.r.key], b.selected.image.studied)} في ${b.year}.`
              : `دراسة أسباب انخفاض نسبة التوائم في ${b.year} مقارنة بسنة ${a.year}.`,
          source: `مقارنة ${a.year} و${b.year}`,
        });
      }
    }
  }

  // 5. Level 1 and level 2 both below every tier's same level.
  {
    const below = (lv: "l1" | "l2") => tiers.every((t) => (tierOutcome(t.key)[lv].accuracy ?? 0) > (sel[lv].accuracy ?? 1));
    if (sel.l1.studied > 0 && sel.l2.studied > 0 && below("l1") && below("l2")) {
      // The level and outcome with the largest share of studied answers is the training focus.
      const focus = (["l1", "l2"] as const)
        .flatMap((lv) => RATES.map((r) => ({ lv, r, n: sel[lv][r.key], of: sel[lv].studied })))
        .sort((x, y) => (share(y.n, y.of) ?? 0) - (share(x.n, x.of) ?? 0))[0];
      const lvName = (lv: "l1" | "l2") => (lv === "l1" ? "المستوى الأول" : "المستوى الثاني");
      const range = (lv: "l1" | "l2") => {
        const v = tiers.map((t) => tierOutcome(t.key)[lv].accuracy ?? 0);
        return `${pct(Math.min(...v))} إلى ${pct(Math.max(...v))}`;
      };
      out.push({
        key: "levels",
        priority: "متوسطة",
        title: `نسبة التوائم في المستويين الأول والثاني في ${name} أقل من مستويات العبء الثلاثة`,
        figures: [
          { label: "المتوافقة: المستوى الأول", value: matchedOf(sel.l1) },
          { label: "المتوافقة: المستوى الثاني", value: matchedOf(sel.l2) },
          { label: "المستوى الأول في مستويات العبء", value: range("l1") },
          { label: "المستوى الثاني في مستويات العبء", value: range("l2") },
        ],
        recommendation: `تدريب موجه لأخصائيي ${lvName(focus.lv)} في ${name} على حالات ${focus.r.name}، وعددها ${countOf(focus.n, focus.of)} من إجابات هذا المستوى.`,
        source: "نتائج المستوى الأول والمستوى الثاني حسب مستوى العبء التشغيلي",
      });
    }
  }

  // 6. High workload tier with a نسبة التوائم below the low tier.
  {
    const selPort = w.tiers.flatMap((t) => t.ports).find((p) => p.port === w.port);
    const selTier = w.tiers.find((t) => t.ports.some((p) => p.port === w.port));
    const low = w.tiers.find((t) => t.key === "low");
    const lowAcc = low ? tierOutcome("low").image.accuracy : null;
    if (selPort && selTier?.key === "high" && low && lowAcc !== null && (sel.image.accuracy ?? 1) < lowAcc && selPort.perEmployeeMonth !== null) {
      const typeAvg = selTier.averages[selPort.type];
      // «منفذ بحري» → «المنافذ البحرية»: the port type the workload bands are built on.
      const typeName = `المنافذ ال${selPort.type.replace("منفذ ", "")}ة`;
      out.push({
        key: "workload",
        priority: "متوسطة",
        title: `${name} في مستوى العبء العالي، ونسبة التوائم فيه أقل من مستوى العبء المنخفض`,
        figures: [
          { label: "الحالات المفحوصة في الشهر للموظف", value: fmtNum(Math.round(selPort.perEmployeeMonth)) },
          { label: `متوسط ${typeName}`, value: typeAvg === undefined ? "-" : fmtNum(Math.round(typeAvg)) },
          { label: `المتوافقة: ${name}`, value: matchedOf(sel.image) },
          { label: `المتوافقة: ${tierShort(low.label)}`, value: matchedOf(tierOutcome("low").image) },
        ],
        recommendation: `مراجعة توزيع الموظفين المخصصين لـ ${name} (متوسط ${fmtNum(Math.round(selPort.employeesPerMonth ?? 0))} موظفًا في الشهر) لخفض متوسط الحالات المفحوصة في الشهر للموظف من ${fmtNum(Math.round(selPort.perEmployeeMonth))} نحو متوسط ${typeName}${typeAvg === undefined ? "" : ` (${fmtNum(Math.round(typeAvg))})`}.`,
        source: `تأثير عبء العمل على النتائج / حدود مستويات العبء (سنة ${w.loadYear})`,
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
        title: `${fmtNum(lowT.count)} من منسوبي ${name} في فئة الدقة المنخفضة`,
        figures: [
          { label: `موظفو الفئة المنخفضة من ${fmtNum(d.tiered)}`, value: short(lowT.count, d.tiered) },
          { label: "حدود الفئة", value: `${pct(lowT.from)} إلى ${pct(lowT.to)}` },
          { label: "متوسط دقتهم", value: pct(lowT.meanAccuracy) },
        ],
        recommendation: `برنامج تدريب موجه للموظفين الـ ${fmtNum(lowT.count)} الذين لا تتجاوز نسبة التوائم لديهم ${pct(lowT.to)}، ومتابعة نتائجهم بعد التدريب.`,
        source: "معدل التوافق لمنسوبي المنفذ / مستويات دقة الموظفين",
      });
    }
  }

  const rank = { "عالية": 0, "متوسطة": 1 } as const;
  return out.map((o, i) => ({ o, i })).sort((a, b) => rank[a.o.priority] - rank[b.o.priority] || a.i - b.i).map((x) => x.o);
}
