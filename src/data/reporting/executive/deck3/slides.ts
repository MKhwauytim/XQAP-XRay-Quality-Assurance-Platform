import { yieldToMain } from "../../../storage/yieldToMain";
import { esc, fmtNum } from "../primitives";
import type { ReportModel } from "../model/reportModel";
import { collectPortStats } from "../deck2/slideKit";
import { collectLevelAccuracyRows } from "../deck2/section3/levelAccuracy";
import { coverageOf, buildAgreementRows, foldReportRows } from "../deck2/section3/riskEngineAgreement";
import { computeMarkingImpact } from "../deck2/section3/markingImpact";
import { computeQualityImpactStrata, accuracyGradient } from "../deck2/section3/qualityImpact";
import { computeReviewerTotals } from "../deck2/section3/sourceAgreement";
import {
  coverSlide, closingSlide, contentsSlide, glossaryCard, glossarySlide,
  levelDefinitionCard, levelDefinitionSlide, kpiGrid, sectionDivider,
  twoPanelTable, matrixSlide, comparisonPanels, impactSplitSlide, pageFoot,
} from "./slideKit";
import { barChart, groupedBarChart } from "./chartKit";

const TOTAL = 21;

export async function buildDeck3Slides(model: ReportModel, monthLabel: string, monthlyTarget: number): Promise<string> {
  const parts: string[] = [];

  // 1 — Cover
  parts.push(coverSlide({
    kicker: "عرض تنفيذي · تقرير شهري",
    title: "تقرير ضمان جودة فحص الأشعة",
    periodLabel: monthLabel,
    metaRows: [
      { label: "تاريخ الإصدار", value: new Date().toLocaleDateString("ar-SA") },
      { label: "القسم", value: "ضمان الجودة" },
    ],
    num: 1, total: TOTAL,
  }));

  // 2 — Contents
  parts.push(contentsSlide({
    rows: [
      { index: 1, title: "المعجم", description: "المصطلحات ومستويات المخاطر", pageRange: "3-4" },
      { index: 2, title: "مؤشرات الشهر", description: "لمحة سريعة عن الأداء", pageRange: "5" },
      { index: 3, title: "المجتمع والتوزيع", description: "المجتمع والعينة حسب المستوى والمنفذ", pageRange: "7-8" },
      { index: 4, title: "الدقة", description: "الدقة العامة، حسب المنفذ وحسب المستوى", pageRange: "10-13" },
      { index: 5, title: "التحليلات المتقدمة", description: "المصفوفة، التوافق، أثر التحديد والجودة", pageRange: "15-20" },
    ],
    num: 2, total: TOTAL,
  }));

  await yieldToMain();

  // 3 — Glossary: terms
  parts.push(glossarySlide({
    title: "المعجم — المصطلحات",
    cards: [
      glossaryCard({ term: "نتائج الوسائل الآلية", definition: "نتيجة تحليل صورة الأشعة بواسطة أنظمة الفحص الآلي.", tone: "gold" }),
      glossaryCard({ term: "صورة", definition: "الوحدة الأساسية للفحص — صورة أشعة واحدة لشحنة أو حاوية.", tone: "blue" }),
      glossaryCard({ term: "نتيجة", definition: "التصنيف المسجل لصورة بعد المراجعة: سليمة أو اشتباه.", tone: "green" }),
      glossaryCard({ term: "نسبة تحديد موقع الاشتباه", definition: "نسبة الصور المشتبه بها التي تم تحديد موقع الاشتباه فيها.", tone: "coral" }),
      glossaryCard({ term: "دقة السليمة / دقة الاشتباه / الدقة العامة", definition: "نسب الدقة المحسوبة لكل تصنيف نتيجة على حدة وللنتيجة العامة.", tone: "slate" }),
    ],
    num: 3, total: TOTAL,
  }));

  // 4 — Glossary: risk levels
  // Locked wording — copied verbatim from the handoff's own HTML
  // (design_handoff_xray_qa_deck/Executive Report Deck v2.dc.html, slide 4,
  // read directly during plan preflight — this is the actual shipped
  // deck text, not the shorter slide-table summary in the spec doc). Do
  // not paraphrase or shorten any of the 4 definition/"ما يقيسه" strings
  // below. Live per-level population/sample share comes from
  // model.population.byStage (already computed, real data) — only the
  // static prose is hardcoded, matching how deck2 hardcodes its own
  // one-off slide copy (see deck2/slides.ts's glossary/riskStages slides).
  const LEVEL_DEFINITIONS = [
    {
      title: "المستوى الأول",
      definition: "الصور التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون استهداف من محرك المخاطر.",
      measures: "انفراد الفحص بالاشتباه دون مؤشرات أخرى.",
      samplingWeight: "وزن السحب: 100% — حصر كامل لمجتمع المستوى",
      tone: "gold" as const,
    },
    {
      title: "المستوى الثاني",
      definition: "الصور التي استهدفها محرك المخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.",
      measures: "ما يلتقطه محرك المخاطر ولا يُلتقط من قبل أخصائي الوسائل الآلية.",
      samplingWeight: "وزن السحب: 40% من حصة العدد الثابت — 2,500 صورة",
      tone: "blue" as const,
    },
    {
      title: "المستوى الثالث",
      definition: "الصور التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى.",
      measures: "ما تلتقطه الفرق الأمنية الأخرى ولا يلتقطه الفحص.",
      samplingWeight: "وزن السحب: 30% من حصة العدد الثابت — 1,875 صورة",
      tone: "green" as const,
    },
    {
      title: "المستوى الرابع",
      definition: "الصور التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين.",
      measures: "ما ثبت فواته بضبط أمني أو باكتشاف خارجي.",
      samplingWeight: "وزن السحب: 30% من حصة العدد الثابت — 1,875 صورة",
      tone: "coral" as const,
    },
  ];
  parts.push(levelDefinitionSlide({
    title: "المعجم — مستويات المخاطر",
    cards: LEVEL_DEFINITIONS.map((lvl, i) => levelDefinitionCard({
      ordinal: String(i + 1),
      title: lvl.title,
      // "definition" carries both the level's scope sentence and its "ما
      // يقيسه" line — levelDefinitionCard (Task 10) only has one prose
      // slot, so join them the same way the handoff's card stacks the two
      // text blocks vertically.
      definition: `${lvl.definition} — ما يقيسه: ${lvl.measures}`,
      samplingWeight: lvl.samplingWeight,
      tone: lvl.tone,
    })),
    // Primary monthly target sample size — real config value (passed in as
    // monthlyTarget, since ReportModel itself doesn't surface config), NOT
    // the handoff's own placeholder 6,250.
    highlightValue: fmtNum(monthlyTarget),
    highlightNote: "أوزان المستويات الثاني–الرابع تُسحب من هذا العدد؛ المستوى الأول حصر كامل من مجتمعه خارج هذه الحصة.",
    num: 4, total: TOTAL,
  }));

  await yieldToMain();

  // 5 — Month KPIs
  parts.push(kpiGrid({
    title: "مؤشرات الشهر",
    cells: [
      { label: "مجتمع الفحص", value: fmtNum(model.population.total) },
      { label: "العيّنة", value: fmtNum(model.sample.total) },
      { label: "التغطية", value: `${(model.sample.coverage ?? 0).toFixed(1)}%` },
      { label: "دقة النتيجة", value: `${(model.summary.overallAccuracy ?? 0).toFixed(1)}%` },
      { label: "نسبة تحديد موقع الاشتباه", value: `${(model.imageQuality.markingRate ?? 0).toFixed(1)}%` },
      { label: "الاشتباهات الفائتة", value: fmtNum(model.errorAnalysis.totals.missedSuspicion) },
    ],
    num: 5, total: TOTAL,
  }));

  // 6 — Section 1 divider
  parts.push(sectionDivider({
    ordinal: "1", title: "المجتمع والعينة",
    description: "توزيع مجتمع الفحص والعينة حسب المستوى والمنفذ.",
    pageList: "7-8", num: 6, total: TOTAL,
  }));

  await yieldToMain();

  // 7 — Population per level (model.population.byStage is already the real
  // per-level population/sample breakdown consumed by deck2's own riskStagesSlide)
  {
    const rows = model.population.byStage
      .map((s) => `<tr><td>${esc(s.stageLabel)}</td><td>${fmtNum(s.population)}</td><td>${fmtNum(s.sampleSize)}</td></tr>`)
      .join("");
    parts.push(twoPanelTable({
      title: "مجتمع الفحص",
      landTitle: "حسب المستوى", landSub: `${fmtNum(model.population.total)} صورة`,
      landRowsHtml: rows, landTotalsHtml: "",
      seaTitle: "العيّنة", seaSub: `${fmtNum(model.sample.total)} صورة`,
      seaRowsHtml: rows, seaTotalsHtml: "",
      theadCells: "<th>المستوى</th><th>المجتمع</th><th>العيّنة</th>",
      num: 7, total: TOTAL,
    }));
  }

  // 8 — Port distribution (reuses deck2's own collectPortStats — same data,
  // no duplicated fold logic)
  {
    const { land, sea } = collectPortStats(model);
    const rowsHtml = (ports: typeof land) =>
      ports.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.total)}(${fmtNum(p.sampleTotal)})</td><td>${fmtNum(p.clean)}(${fmtNum(p.sampleClean)})</td><td>${fmtNum(p.suspicious)}(${fmtNum(p.sampleSuspicious)})</td></tr>`).join("");
    parts.push(twoPanelTable({
      title: "توزيع المنافذ",
      landTitle: "برية", landSub: `تغطية ${(model.sample.coverage ?? 0).toFixed(1)}%`,
      landRowsHtml: rowsHtml(land), landTotalsHtml: "",
      seaTitle: "بحرية", seaSub: `تغطية ${(model.sample.coverage ?? 0).toFixed(1)}%`,
      seaRowsHtml: rowsHtml(sea), seaTotalsHtml: "",
      theadCells: "<th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th>",
      num: 8, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 9 — Section 2 divider
  parts.push(sectionDivider({
    ordinal: "2", title: "الدقة",
    description: "دقة الرصد العامة، حسب المنفذ وحسب المستوى.",
    pageList: "10-13", num: 9, total: TOTAL,
  }));

  // 10 — Overall detection accuracy (model.errorAnalysis.totals, byPort — no
  // new math, same numbers outcomeMatrix.ts already reads verbatim)
  {
    const t = model.errorAnalysis.totals;
    const evaluable = t.evaluable || 1;
    const overall = ((t.correctClean + t.correctSuspicion) / evaluable) * 100;
    const cleanAcc = t.correctClean / ((t.correctClean + t.missedSuspicion) || 1) * 100;
    const suspAcc = t.correctSuspicion / ((t.correctSuspicion + t.falseSuspicion) || 1) * 100;
    parts.push(kpiGrid({
      title: "دقة الرصد العامة",
      cells: [
        { label: "الدقة العامة", value: `${overall.toFixed(1)}%` },
        { label: "دقة السليمة", value: `${cleanAcc.toFixed(1)}%` },
        { label: "دقة الاشتباه", value: `${suspAcc.toFixed(1)}%` },
      ],
      num: 10, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 11 — Accuracy by port (land/sea), 12 — chart
  {
    const byPort = model.portAccuracy; // Aggregates["byPort"] = KeyedAccuracy[]
    const rowsHtml = byPort.map((p) => `<tr><td>${esc(p.key)}</td><td>${((p.accuracyByDecision ?? 0)).toFixed(1)}%</td></tr>`).join("");
    parts.push(twoPanelTable({
      title: "الدقة حسب المنفذ",
      landTitle: "برية", landSub: "", landRowsHtml: rowsHtml, landTotalsHtml: "",
      seaTitle: "بحرية", seaSub: "", seaRowsHtml: rowsHtml, seaTotalsHtml: "",
      theadCells: "<th>المنفذ</th><th>الدقة العامة</th>",
      num: 11, total: TOTAL,
    }));
    const avg = byPort.reduce((s, p) => s + (p.accuracyByDecision ?? 0), 0) / (byPort.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">رسم الدقة حسب المنفذ</h2>${barChart({
      bars: byPort.map((p) => ({ label: p.key, value: p.accuracyByDecision ?? 0 })),
      min: 86, max: 98, referenceValue: avg, referenceLabel: "المتوسط",
    })}${pageFoot(12, TOTAL)}</div></section>`);
  }

  // 13 — Accuracy by level (chart) — reuses Task 1's collectLevelAccuracyRows
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const all = [...land, ...sea];
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">رسم الدقة حسب المستوى</h2>${groupedBarChart({
      groups: all.map((r) => ({
        label: r.name,
        a: { label: "سليمة", value: r.l1.accuracy ?? 0 },
        b: { label: "اشتباه", value: r.l2.accuracy ?? 0 },
      })),
      min: 60, max: 100,
    })}${pageFoot(13, TOTAL)}</div></section>`);
  }

  await yieldToMain();

  // 14 — Section 3 divider
  parts.push(sectionDivider({
    ordinal: "3", title: "التحاليل المتقدمة",
    description: "مصفوفة النتائج، مقارنة المستويين، التوافق مع الفرق والمحرك، وأثر التحديد والجودة.",
    pageList: "15-20", num: 14, total: TOTAL,
  }));

  // 15 — Outcome matrix (model.errorAnalysis.totals verbatim — outcomeMatrix.ts's
  // own header comment confirms this is read, never recomputed)
  {
    const t = model.errorAnalysis.totals;
    const overall = ((t.correctClean + t.correctSuspicion) / (t.evaluable || 1)) * 100;
    parts.push(matrixSlide({
      title: "مصفوفة نتائج الوسائل الآلية",
      topLeft: { label: "توافق سليم", value: fmtNum(t.correctClean) },
      topRight: { label: "اشتباه فائت", value: fmtNum(t.missedSuspicion) },
      bottomLeft: { label: "اشتباه خاطئ", value: fmtNum(t.falseSuspicion) },
      bottomRight: { label: "توافق اشتباه", value: fmtNum(t.correctSuspicion) },
      totalLabel: `الدقة العامة (${fmtNum(t.evaluable)})`,
      totalValue: `${overall.toFixed(1)}%`,
      num: 15, total: TOTAL,
    }));
  }

  // 16 — Level 1 vs Level 2 accuracy (reuses collectLevelAccuracyRows totals)
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const all = [...land, ...sea];
    const sum = (pick: (r: (typeof all)[number]) => { evaluable: number; accuracy: number | null }) => {
      const total = all.reduce((s, r) => s + pick(r).evaluable, 0);
      const weighted = all.reduce((s, r) => s + (pick(r).accuracy ?? 0) * pick(r).evaluable, 0);
      return { total, avg: total ? weighted / total : null };
    };
    const l1 = sum((r) => r.l1);
    const l2 = sum((r) => r.l2);
    parts.push(comparisonPanels({
      title: "دقة إجابات المستوى الأول والثاني",
      leftTitle: "المستوى الأول",
      leftRows: [
        { label: "النتائج المُقيَّمة", value: fmtNum(l1.total) },
        { label: "الدقة العامة", value: `${(l1.avg ?? 0).toFixed(1)}%` },
      ],
      rightTitle: "المستوى الثاني",
      rightRows: [
        { label: "النتائج المُقيَّمة", value: fmtNum(l2.total) },
        { label: "الدقة العامة", value: `${(l2.avg ?? 0).toFixed(1)}%` },
      ],
      num: 16, total: TOTAL,
    }));
  }

  await yieldToMain();

  // 17 — Level 1/2 accuracy, land ports; 18 — sea ports (grouped chart per port)
  {
    const { land, sea } = collectLevelAccuracyRows(model);
    const landAvg = land.reduce((s, r) => s + (r.l1.accuracy ?? 0), 0) / (land.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">دقة المستويين في المنافذ البرية</h2>${groupedBarChart({
      groups: land.map((r) => ({ label: r.name, a: { label: "مستوى 1", value: r.l1.accuracy ?? 0 }, b: { label: "مستوى 2", value: r.l2.accuracy ?? 0 } })),
      min: 86, max: 96, referenceValue: landAvg, referenceLabel: "المتوسط",
    })}${pageFoot(17, TOTAL)}</div></section>`);
    const seaAvg = sea.reduce((s, r) => s + (r.l1.accuracy ?? 0), 0) / (sea.length || 1);
    parts.push(`<section class="slide v3"><div class="slide-inner"><h2 class="v3-h2">دقة المستويين في المنافذ البحرية</h2>${groupedBarChart({
      groups: sea.map((r) => ({ label: r.name, a: { label: "مستوى 1", value: r.l1.accuracy ?? 0 }, b: { label: "مستوى 2", value: r.l2.accuracy ?? 0 } })),
      min: 86, max: 96, referenceValue: seaAvg, referenceLabel: "المتوسط",
    })}${pageFoot(18, TOTAL)}</div></section>`);
  }

  // 19 — Security-team + risk-engine agreement (reuses Task 3's + Task 6's exports)
  {
    const totals = computeReviewerTotals(model.resultComparison.reviewerAgreement);
    const rows = model.rows;
    const coverage = coverageOf(rows);
    const agreementRows = buildAgreementRows(rows);
    const reportFold = foldReportRows(rows);
    parts.push(comparisonPanels({
      title: "توافق النتائج بين المستويات والفرق الأمنية",
      leftTitle: "توافق الفرق الأمنية",
      leftRows: [
        { label: "صور مشتركة", value: fmtNum(totals.totalComparable) },
        { label: "التوافق", value: `${(totals.totalRate ?? 0).toFixed(1)}%` },
      ],
      rightTitle: "التوافق مع محرك المخاطر",
      rightRows: [
        { label: "الصور المستهدفة", value: fmtNum(coverage.recognized) },
        { label: "توافق أيّدت الجودة المحرك", value: fmtNum(reportFold.reviewConfirmed) },
      ],
      num: 19, total: TOTAL,
    }));
    void agreementRows; // available for a richer per-team breakdown if the reviewer wants it added inline above
  }

  await yieldToMain();

  // 20 — Marking + image-quality impact (reuses Task 4's + Task 5's exports)
  {
    const marking = computeMarkingImpact(model);
    const quality = computeQualityImpactStrata(model.rows);
    const gradient = accuracyGradient(quality.strata);
    const markingDelta = (marking.present.accuracy ?? 0) - (marking.absent.accuracy ?? 0);
    parts.push(impactSplitSlide({
      title: "أثر التحديد وجودة الصورة على الدقة",
      left: {
        title: "أثر تحديد موقع الاشتباه",
        chartHtml: barChart({
          bars: [
            { label: "مع تحديد", value: marking.present.accuracy ?? 0 },
            { label: "بدون تحديد", value: marking.absent.accuracy ?? 0 },
          ],
          min: 70, max: 100,
        }),
        calloutValue: `${markingDelta >= 0 ? "+" : ""}${markingDelta.toFixed(1)}%`,
        calloutLabel: `فرق في الدقة العامة (${(marking.present.accuracy ?? 0).toFixed(1)}% مقابل ${(marking.absent.accuracy ?? 0).toFixed(1)}%)`,
      },
      right: {
        title: "أثر جودة الصورة",
        chartHtml: barChart({
          bars: quality.strata.map((s) => ({ label: s.level, value: s.accuracy ?? 0 })),
          min: 70, max: 100,
        }),
        calloutValue: `${(gradient ?? 0) >= 0 ? "+" : ""}${(gradient ?? 0).toFixed(1)}%`,
        calloutLabel: "فرق في الدقة بين أعلى وأدنى مستوى جودة",
      },
      num: 20, total: TOTAL,
    }));
  }

  // 21 — Closing
  parts.push(closingSlide({
    kicker: "ختام العرض",
    title: "شكراً",
    closingLine: "تقرير ضمان جودة فحص الأشعة",
    num: 21, total: TOTAL,
  }));

  return parts.join("\n");
}
