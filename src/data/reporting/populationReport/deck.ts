import {
  coverSlide,
  contentsSlide,
  sectionDivider,
  contentHead,
  tintedPanel,
  dataTable,
  kpiBand,
  slideShell,
} from "../executive/deck3/slideKit";
import type { SlideMeta, TableCell, KpiCell, OrgBlock } from "../executive/deck3/slideKit";
import { fmtNum, fmtPct, esc } from "../executive/primitives";
import type { PopulationReportModel } from "./model";
import type { PortBreakdown, ResultCounts } from "./types";

const ORG: OrgBlock = { logoUrl: "", orgName: "ضمان جودة الأشعة", lines: [] };

// deck3's dataTable()/kpiBand() do NOT escape their `html` fields themselves
// (same convention as every other deck3 slide) — every cell built from
// data (port names, stage labels, employee display names) must be escaped
// by the caller, here, before it reaches a TableCell.
function resultRow(label: string, counts: ResultCounts): TableCell[] {
  return [
    { html: esc(label) },
    { html: fmtNum(counts.total), cls: "v-navy" },
    { html: fmtNum(counts.سليمة), cls: "v-green" },
    { html: fmtNum(counts.اشتباه), cls: "v-red" },
  ];
}

const RESULT_HEADERS = ["البند", "الإجمالي", "سليمة", "اشتباه"];

function portBreakdownTwoColumn(breakdown: PortBreakdown): string {
  const padTo = Math.max(breakdown.land.length, breakdown.sea.length);
  const rowsFor = (ports: PortBreakdown["land"]) => ports.map((p) => resultRow(p.portName, p.counts));
  const totalsFor = (ports: PortBreakdown["land"], label: string) => {
    const total = { سليمة: 0, اشتباه: 0, total: 0 };
    for (const p of ports) {
      total.سليمة += p.counts.سليمة;
      total.اشتباه += p.counts.اشتباه;
      total.total += p.counts.total;
    }
    return resultRow(label, total);
  };
  return `<div class="v3-two-col">
${tintedPanel({
  variant: "land",
  title: "المنافذ البرية",
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(breakdown.land), totals: totalsFor(breakdown.land, "إجمالي البرية"), padToRows: padTo }),
})}
${tintedPanel({
  variant: "sea",
  title: "المنافذ البحرية",
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(breakdown.sea), totals: totalsFor(breakdown.sea, "إجمالي البحرية"), padToRows: padTo }),
})}
</div>`;
}

export function buildSection1Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta): string[] {
  const slides: string[] = [];

  // 1 — Cover
  slides.push(
    coverSlide({
      org: ORG,
      kicker: "تقرير المجتمع",
      title: "تقرير المجتمع",
      periodLabel: "الفترة",
      periodValue: model.monthLabel,
      metaRows: [{ label: "تاريخ الإصدار", value: new Date().toLocaleDateString("ar-SA") }],
      meta: meta(1),
    })
  );

  // 2 — Contents
  slides.push(
    contentsSlide({
      eyebrow: "تقرير المجتمع",
      title: "المحتويات",
      rows: [
        { index: 1, title: "المجتمع", description: "المجتمع المستلم والمعالج", topics: "الاستلام، المعالجة، التوزيع حسب المرحلة والمنفذ", pages: "٣" },
        { index: 2, title: "العينة", description: "تكوين العينة المسحوبة", topics: "حسب المرحلة والمنفذ", pages: "٢" },
        { index: 3, title: "التوزيع", description: "التوزيع على الموظفين", topics: "حسب المرحلة، المنفذ، وCertScan", pages: "٣" },
      ],
      meta: meta(2),
    })
  );

  // 3 — Section 1 divider
  slides.push(
    sectionDivider({
      eyebrow: "القسم الأول",
      ghost: "١",
      kicker: "القسم الأول",
      title: "المجتمع",
      description: "المجتمع المستلم وكيف تمت معالجته",
      footItems: [],
      meta: meta(3),
    })
  );

  // 4 — Receipt overview: Risk | BI two tables side by side
  const summary = model.reconciled.processingSummary;
  const receiptInner = `${contentHead({ eyebrow: "القسم الأول", title: "الاستلام" })}
<div class="v3-two-col">
${tintedPanel({
  variant: "land",
  title: "بيانات المخاطر (Risk)",
  body: kpiBand(
    [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.riskRawRowCount) } satisfies KpiCell],
    "solo"
  ),
})}
${tintedPanel({
  variant: "sea",
  title: "بيانات معلومات الأعمال (BI)",
  body: kpiBand(
    model.reconciled.biRawRowCount === null
      ? [{ label: "لم يتم توفير BI لهذا الشهر", value: "—" } satisfies KpiCell]
      : [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.biRawRowCount) } satisfies KpiCell],
    "solo"
  ),
})}
</div>`;
  slides.push(slideShell(meta(4), "", receiptInner));

  // 5 — Risk before -> after
  const riskInner = `${contentHead({ eyebrow: "القسم الأول", title: "بيانات المخاطر — قبل وبعد" })}
${
  summary
    ? kpiBand(
        [
          { label: "الصفوف الأصلية", value: fmtNum(summary.riskOriginalRows) },
          { label: "معرّفات صحيحة", value: fmtNum(summary.validRiskIdRows) },
          { label: "بعد إزالة التكرار", value: fmtNum(summary.rowsAfterDeduplication) },
          { label: "المجتمع النهائي", value: fmtNum(summary.finalPreparedPopulationRows), valueTone: "gold" },
        ] satisfies KpiCell[],
        "solo"
      )
    : contentHead({ eyebrow: "", title: "لا تتوفر بيانات المعالجة لهذا الشهر" })
}`;
  slides.push(slideShell(meta(5), "", riskInner));

  // 6 — BI before -> after
  const biRows: TableCell[][] = summary
    ? summary.biFieldFillSummary.map((f) => [
        { html: esc(f.fieldName) },
        { html: fmtNum(f.riskEmptyBefore) },
        { html: fmtNum(f.filledFromBi) },
        { html: fmtNum(f.stillEmptyAfter) },
        { html: fmtPct(f.fillPercentage) },
      ])
    : [];
  const biInner = `${contentHead({ eyebrow: "القسم الأول", title: "بيانات BI — قبل وبعد" })}
${
  summary && summary.biProvided
    ? `${kpiBand(
        [
          { label: "تمت المطابقة", value: fmtNum(summary.biMatchedRows) },
          { label: "لم تتم المطابقة", value: fmtNum(summary.biUnmatchedRows) },
          { label: "نسبة المطابقة", value: fmtPct(summary.biMatchPercentage) },
        ] satisfies KpiCell[],
        "solo"
      )}
${dataTable({ headers: ["الحقل", "فارغ قبل", "تمت التعبئة", "لا يزال فارغًا", "نسبة التعبئة"], rows: biRows })}`
    : contentHead({ eyebrow: "", title: "لم يتم توفير BI لهذا الشهر" })
}`;
  slides.push(slideShell(meta(6), "", biInner));

  // 7 — Reconciled population by stage
  const stageRows = model.reconciled.byStage.map((b) => resultRow(b.stageLabel, b.counts));
  const stageInner = `${contentHead({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المرحلة" })}
${dataTable({ headers: RESULT_HEADERS, rows: stageRows, totals: resultRow("الإجمالي", model.reconciled.totals) })}`;
  slides.push(slideShell(meta(7), "", stageInner));

  // 8 — Reconciled population by port (land/sea)
  const portInner = `${contentHead({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المنفذ" })}
${portBreakdownTwoColumn(model.reconciled.byPort)}`;
  slides.push(slideShell(meta(8), "", portInner));

  return slides;
}

export { resultRow, RESULT_HEADERS, portBreakdownTwoColumn };
