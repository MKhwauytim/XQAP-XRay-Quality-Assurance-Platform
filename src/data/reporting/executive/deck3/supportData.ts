// Supporting data for the executive deck (v3): one worksheet per report page, holding the exact figures that
// page shows plus the counts behind them. Built from the SAME helpers the slides use (exported from slides.ts),
// so a number in a sheet can never disagree with its page. The raw rows themselves (every studied image, every
// answer) are already sheets of the executive workbook; this module only adds the page-level layer on top.
import { getStageKey } from "../../../population/stageHelpers";
import type { ReportModel } from "../model/reportModel";
import { aggregateDecisions, buildDecisionRecords } from "../model/decisionFactTable";
import { collectPortStats } from "../deck2/slideKit";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import {
  accuracyOf, collectPortAccuracy, collectPortMarking, emptyMarking, orderedStageAccuracy, pct, sumCounts, sumMarking,
  type FourCounts, type MarkingCounts,
} from "./slides";

export type SupportCell = string | number;
export type SupportSheet = { name: string; page: string; about: string; aoa: SupportCell[][] };

/** Percentages go into the sheet as numbers with one decimal (a blank cell when the base is empty). */
const p1 = (v: number | null): SupportCell => (v === null ? "" : Math.round(v * 10) / 10);
const n = (v: number | null | undefined): SupportCell => v ?? "";

const FOUR_HEAD = ["الإجابات المفحوصة", "سليمة صحيحة", "اشتباه صحيح", "الاشتباهات الفائتة", "الاشتباهات الخاطئة"];
const RATE_HEAD = ["نسبة التوائم العامة %", "دقة السليمة %", "دقة الاشتباه %", "الفائتة % من إجابات السليمة", "الخاطئة % من إجابات الاشتباه"];

/** Counts of one group of answers → the five count cells. */
function fourCells(c: FourCounts): SupportCell[] {
  return [accuracyOf(c).evaluable, c.correctClean, c.correctSuspicion, c.missedSuspicion, c.falseSuspicion];
}

/** The five rates the port pages show, from the same arithmetic. */
function rateCells(c: FourCounts): SupportCell[] {
  const a = accuracyOf(c);
  return [p1(a.overall), p1(a.cleanAcc), p1(a.suspAcc), p1(pct(c.missedSuspicion, a.cleanResults)), p1(pct(c.falseSuspicion, a.suspResults))];
}

export function buildDeckSupportSheets(model: ReportModel): SupportSheet[] {
  const sheets: SupportSheet[] = [];
  const add = (name: string, page: string, about: string, aoa: SupportCell[][]): void => {
    sheets.push({ name, page, about, aoa });
  };

  const totals = model.errorAnalysis.totals;
  const overall = accuracyOf(totals);

  // ── Key indicators (page "المؤشرات الرئيسية") ───────────────────────────────
  add("المؤشرات الرئيسية", "المؤشرات الرئيسية", "الأرقام الكبرى في صفحة المؤشرات، مع تعريف كل رقم.", [
    ["المؤشر", "القيمة", "الوحدة", "كيف يُحسب"],
    ["مجتمع الفحص", model.population.total, "صورة", "كل صور المجتمع في الفترة"],
    ["العيّنة المفحوصة", model.sample.total, "صورة", "الصور المكتملة الفحص في التقرير"],
    ["التغطية الرقابية", p1(model.sample.coverage ?? null), "%", model.population.fromSummary ? "العيّنة المفحوصة ÷ المستهدف (المستوى الأول 100% من مجتمعه، والمستويات الأخرى عدد ثابت شهريًا × أشهر التقرير)" : "العيّنة المفحوصة ÷ مجتمع الفحص"],
    ["الإجابات المفحوصة", overall.evaluable, "إجابة", "لكل صورة إجابتان: المستوى الأول والثاني"],
    ["نسبة التوائم العامة", p1(overall.overall), "%", "الإجابات المتفق عليها ÷ الإجابات المفحوصة"],
    ["الاشتباهات الفائتة", totals.missedSuspicion, "إجابة", "نتيجة سليمة ورأي الجودة اشتباه"],
    ["الاشتباهات الفائتة % من إجابات السليمة", p1(pct(totals.missedSuspicion, overall.cleanResults)), "%", "الفائتة ÷ إجابات السليمة"],
    ["الاشتباهات الخاطئة", totals.falseSuspicion, "إجابة", "نتيجة اشتباه ورأي الجودة سليمة"],
    ["الاشتباهات الخاطئة % من إجابات الاشتباه", p1(pct(totals.falseSuspicion, overall.suspResults)), "%", "الخاطئة ÷ إجابات الاشتباه"],
    ["نسبة تحديد موقع الاشتباه", p1(model.imageQuality.markingRate), "%", "الصور المجاب عن التحديد فيها وعليها تحديد"],
  ]);

  // ── Population by level (page 7) ───────────────────────────────────────────
  add("المجتمع حسب المستوى", "مجتمع الفحص والعيّنة حسب المستوى", "حجم المجتمع والعيّنة والتغطية لكل مستوى.", [
    ["المستوى", "المجتمع (صورة)", "المستهدف (صورة)", "العيّنة (صورة)", "التغطية الرقابية %"],
    ...model.population.byStage.map((s): SupportCell[] => [s.stageLabel, s.population, s.target ?? s.population, s.sampleSize, p1(s.coverage ?? null)]),
    ["الإجمالي", model.population.total, model.population.byStage.reduce((a, s) => a + (s.target ?? s.population), 0), model.sample.total, p1(model.sample.coverage ?? null)],
  ]);

  // ── L1/L2 results across the population (page 8; workbook-backed reports only) ──
  const summary = model.population.summary;
  if (summary) {
    type Tally = { clean: number; suspicious: number; other: number };
    const zero = (): Tally => ({ clean: 0, suspicious: 0, other: 0 });
    const perStage = new Map<string, { n: number; l1: Tally; l2: Tally }>();
    for (const [raw, lv] of Object.entries(summary.byStageLevels)) {
      const key = getStageKey(raw);
      const cur = perStage.get(key) ?? { n: 0, l1: zero(), l2: zero() };
      for (const k of ["clean", "suspicious", "other"] as const) { cur.l1[k] += lv.levelOne[k]; cur.l2[k] += lv.levelTwo[k]; }
      cur.n += lv.levelOne.clean + lv.levelOne.suspicious + lv.levelOne.other;
      perStage.set(key, cur);
    }
    const row = (label: string, total: number, l1: Tally, l2: Tally): SupportCell[] => [
      label, total, l1.clean, l2.clean, l1.suspicious, l2.suspicious, l1.other, l2.other,
    ];
    add("نتائج المستويين بالمجتمع", "نتائج المستويين في المجتمع", "إجابات المستوى الأول والثاني لكل صور المجتمع (سليمة / اشتباه / أخرى).", [
      ["المستوى", "الإجمالي (صورة)", "الأول: سليمة", "الثاني: سليمة", "الأول: اشتباه", "الثاني: اشتباه", "الأول: أخرى", "الثاني: أخرى"],
      ...model.population.byStage.map((st): SupportCell[] => {
        const cur = perStage.get(st.stageKey) ?? { n: 0, l1: zero(), l2: zero() };
        return row(st.stageLabel, cur.n, cur.l1, cur.l2);
      }),
      row("الإجمالي", summary.total, summary.levelOne, summary.levelTwo),
    ]);

    // مصفوفة النتائج (top table of page 8): images per L1 × L2 result combination, first word = level 1's result.
    if (Object.values(summary.byStageLevels).every((lv) => lv.pairs !== undefined)) {
      type Pairs = NonNullable<(typeof summary.byStageLevels)[string]["pairs"]>;
      const zeroPairs = (): Pairs => ({ cleanClean: 0, suspClean: 0, cleanSusp: 0, suspSusp: 0, other: 0 });
      const pairsByStage = new Map<string, Pairs>();
      for (const [raw, lv] of Object.entries(summary.byStageLevels)) {
        const key = getStageKey(raw);
        const cur = pairsByStage.get(key) ?? zeroPairs();
        for (const k of Object.keys(cur) as Array<keyof Pairs>) cur[k] += lv.pairs?.[k] ?? 0;
        pairsByStage.set(key, cur);
      }
      const pairRow = (label: string, c: Pairs): SupportCell[] => [label, c.cleanClean + c.suspClean + c.cleanSusp + c.suspSusp + c.other, c.cleanClean, c.suspClean, c.cleanSusp, c.suspSusp, c.other];
      const sum = zeroPairs();
      for (const c of pairsByStage.values()) for (const k of Object.keys(sum) as Array<keyof Pairs>) sum[k] += c[k];
      add("مصفوفة النتائج", "نتائج المستويين في المجتمع", "عدد الصور في كل تركيبة من نتيجة المستوى الأول ونتيجة المستوى الثاني (الكلمة الأولى = المستوى الأول).", [
        ["المستوى", "الإجمالي (صورة)", "سليمة – سليمة", "اشتباه – سليمة", "سليمة – اشتباه", "اشتباه – اشتباه", "أخرى"],
        ...model.population.byStage.map((st): SupportCell[] => pairRow(st.stageLabel, pairsByStage.get(st.stageKey) ?? zeroPairs())),
        pairRow("الإجمالي", sum),
      ]);
    }
  }

  // ── Population by port (pages 9–10) ────────────────────────────────────────
  const popPorts = collectPortStats(model);
  const popRow = (kind: string, p: (typeof popPorts.land)[number]): SupportCell[] => [
    kind, p.name, p.total, p.sampleTotal, p.clean, p.sampleClean, p.suspicious, p.sampleSuspicious, n(p.other),
  ];
  add("المجتمع حسب المنفذ", "التوزيع على المنافذ البرية / البحرية", "المجتمع والعيّنة لكل منفذ، مفصولة إلى سليمة واشتباه وأخرى.", [
    ["نوع المنفذ", "المنفذ", "المجتمع", "العيّنة", "سليمة (مجتمع)", "سليمة (عيّنة)", "اشتباه (مجتمع)", "اشتباه (عيّنة)", "أخرى (مجتمع)"],
    ...popPorts.land.map((p) => popRow("بري", p)),
    ...popPorts.sea.map((p) => popRow("بحري", p)),
  ]);

  // ── Result agreement by level (page "نسبة التوائم") ─────────────────────────
  const stages = orderedStageAccuracy(model);
  add("نسبة التوائم حسب المستوى", "نسبة التوائم", "الإجابات المفحوصة ونسبة التوائم والاشتباهات الفائتة والخاطئة لكل مستوى مخاطر.", [
    ["المستوى", ...FOUR_HEAD, ...RATE_HEAD],
    ...stages.map((s): SupportCell[] => [s.label, ...fourCells(s.counts), ...rateCells(s.counts)]),
    ["الإجمالي", ...fourCells(totals), ...rateCells(totals)],
  ]);

  // ── Level 1 vs Level 2 (page "دقة إجابات المستوى الأول والثاني") ────────────
  const levelRows = collectLevelAccuracyRows(model);
  const allLevel = [...levelRows.land, ...levelRows.sea];
  const l1 = sumCounts(allLevel.map((r) => r.l1.counts));
  const l2 = sumCounts(allLevel.map((r) => r.l2.counts));
  const otherL1 = model.rows.filter((r) => r.levelOneOther !== undefined).length;
  const otherL2 = model.rows.filter((r) => r.levelTwoOther !== undefined).length;
  add("المستوى الأول والثاني", "دقة إجابات المستوى الأول والثاني", "إجابات كل مستوى مقابل رأي أخصائي الجودة، لكل المنافذ.", [
    ["المستوى", ...FOUR_HEAD, ...RATE_HEAD, "نتائج أخرى (غير مفحوصة)"],
    ["المستوى الأول", ...fourCells(l1), ...rateCells(l1), otherL1],
    ["المستوى الثاني", ...fourCells(l2), ...rateCells(l2), otherL2],
  ]);

  // ── Port results (pages "نتائج الأداء للمنافذ") ────────────────────────────
  const portAcc = collectPortAccuracy(model);
  const portRow = (kind: string, p: { name: string; counts: FourCounts }): SupportCell[] => [kind, p.name, ...fourCells(p.counts), ...rateCells(p.counts)];
  const landTotal = sumCounts(portAcc.land.map((p) => p.counts));
  const seaTotal = sumCounts(portAcc.sea.map((p) => p.counts));
  add("نتائج الأداء حسب المنفذ", "نتائج الأداء للمنافذ البرية / البحرية", "إجابات كل منفذ ونسب التوائم والاشتباهات الفائتة والخاطئة، الأكثر إجابات أولاً.", [
    ["نوع المنفذ", "المنفذ", ...FOUR_HEAD, ...RATE_HEAD],
    ...portAcc.land.map((p) => portRow("بري", p)),
    ["بري", "إجمالي البرية", ...fourCells(landTotal), ...rateCells(landTotal)],
    ...portAcc.sea.map((p) => portRow("بحري", p)),
    ["بحري", "إجمالي البحرية", ...fourCells(seaTotal), ...rateCells(seaTotal)],
  ]);

  // ── Level accuracy by port (pages "دقة المستويين في المنافذ") ───────────────
  const levelHead = (who: string): string[] => [`${who}: الإجابات`, `${who}: نسبة التوائم %`, `${who}: دقة السليمة %`, `${who}: دقة الاشتباه %`, `${who}: الفائتة`, `${who}: الخاطئة`];
  const levelCells = (c: FourCounts): SupportCell[] => {
    const a = accuracyOf(c);
    return [a.evaluable, p1(a.overall), p1(a.cleanAcc), p1(a.suspAcc), c.missedSuspicion, c.falseSuspicion];
  };
  const levelRow = (kind: string, name: string, c1: FourCounts, c2: FourCounts): SupportCell[] => [kind, name, ...levelCells(c1), ...levelCells(c2)];
  add("دقة المستويين حسب المنفذ", "دقة المستويين في المنافذ البرية / البحرية", "إجابات المستوى الأول والثاني لكل منفذ.", [
    ["نوع المنفذ", "المنفذ", ...levelHead("المستوى الأول"), ...levelHead("المستوى الثاني")],
    ...levelRows.land.map((r) => levelRow("بري", r.name, r.l1.counts, r.l2.counts)),
    levelRow("بري", "إجمالي البرية", sumCounts(levelRows.land.map((r) => r.l1.counts)), sumCounts(levelRows.land.map((r) => r.l2.counts))),
    ...levelRows.sea.map((r) => levelRow("بحري", r.name, r.l1.counts, r.l2.counts)),
    levelRow("بحري", "إجمالي البحرية", sumCounts(levelRows.sea.map((r) => r.l1.counts)), sumCounts(levelRows.sea.map((r) => r.l2.counts))),
  ]);

  // ── Marking + image quality (pages "متابعة تحديد موقع الاشتباه وجودة الصور") ──
  const marking = collectPortMarking(model);
  const markHead = ["عدد صور الأشعة", "صور بتحديد", "صور بدون تحديد", "جودة منخفضة", "جودة متوسطة", "جودة عالية", "لم تُدرس جودتها أو تحديدها"];
  const markCells = (c: MarkingCounts): SupportCell[] => [c.images, c.marked, c.unmarked, c.low, c.mid, c.high, c.unstudied];
  const markRows = (kind: string, totalLabel: string, ports: Array<{ name: string }>): SupportCell[][] => [
    ...[...ports]
      .map((p) => ({ name: p.name, c: marking.get(p.name) ?? emptyMarking() }))
      .sort((a, b) => b.c.images - a.c.images || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((r): SupportCell[] => [kind, r.name, ...markCells(r.c)]),
    [kind, totalLabel, ...markCells(sumMarking(ports.map((p) => marking.get(p.name) ?? emptyMarking())))],
  ];
  add("التحديد والجودة حسب المنفذ", "متابعة تحديد موقع الاشتباه وجودة الصور", "صور الاشتباه لكل منفذ: كم عليها تحديد وكم جودتها (الصور التي أُجيب فيها عن السؤالين فقط).", [
    ["نوع المنفذ", "المنفذ", ...markHead],
    ...markRows("بري", "إجمالي البرية", portAcc.land),
    ...markRows("بحري", "إجمالي البحرية", portAcc.sea),
  ]);

  // ── Agreement by image quality (page "نسبة التوائم حسب جودة الصورة") ────────
  const records = buildDecisionRecords(model.rows, "quality");
  const kindOf = (r: { portType: string | null }): "land" | "sea" => ((r.portType ?? "").includes("بحري") ? "sea" : "land");
  const byQuality = aggregateDecisions(records, "decision", (r) => `all|${r.imageQuality}`);
  const byKindQuality = aggregateDecisions(records, "decision", (r) => `${kindOf(r)}|${r.imageQuality}`);
  const qualityRows: SupportCell[][] = [];
  for (const [prefix, label, source] of [["all", "جميع المنافذ", byQuality], ["land", "المنافذ البرية", byKindQuality], ["sea", "المنافذ البحرية", byKindQuality]] as const) {
    for (const [key, name] of [["منخفض", "جودة منخفضة"], ["متوسط", "جودة متوسطة"], ["عالي", "جودة عالية"]] as const) {
      const c = source.get(`${prefix}|${key}`);
      const four: FourCounts = c ?? { correctClean: 0, correctSuspicion: 0, missedSuspicion: 0, falseSuspicion: 0 };
      qualityRows.push([label, name, ...fourCells(four), ...rateCells(four)]);
    }
  }
  add("نسبة التوائم حسب الجودة", "نسبة التوائم حسب جودة الصورة", "نسبة التوائم والاشتباهات الفائتة والخاطئة لكل مستوى جودة، لكل المنافذ وللبرية والبحرية.", [
    ["المنافذ", "جودة الصورة", ...FOUR_HEAD, ...RATE_HEAD],
    ...qualityRows,
  ]);

  // ── Index, first ───────────────────────────────────────────────────────────
  const index: SupportSheet = {
    name: "فهرس بيانات التقرير",
    page: "",
    about: "",
    aoa: [
      ["الورقة", "صفحة التقرير", "ما تحتويه"],
      ...sheets.map((s): SupportCell[] => [s.name, s.page, s.about]),
      ["بيانات الصور", "كل الصفحات", "صف لكل صورة مفحوصة: المنفذ والمستوى والنتائج والتحديد والجودة (المصدر الخام لكل الأرقام)."],
      ["جدول القرارات", "كل صفحات الإجابات", "صف لكل إجابة (مستوى أول وثانٍ لكل صورة) مع نتيجتها مقابل رأي الجودة."],
    ],
  };
  return [index, ...sheets];
}
