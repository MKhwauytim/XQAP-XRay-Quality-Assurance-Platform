import {
  coverSlide,
  contentsSlide,
  sectionDivider,
  contentHead,
  tintedPanel,
  dataTable,
  kpiBand,
  slideShell,
  closingSlide,
} from "../executive/deck3/slideKit";
import type { SlideMeta, TableCell, KpiCell, OrgBlock } from "../executive/deck3/slideKit";
import { fmtNum, fmtPct, esc } from "../executive/primitives";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { buildDeckV3Html } from "../executive/deck3";
import { yieldToMain } from "../../storage/yieldToMain";
import type { PopulationReportModel, PopulationReportInput } from "./model";
import { computePopulationReportModel } from "./model";
import type { PortBreakdown, ResultCounts, PopulationReportScope } from "./types";
import { STAGE_LABELS } from "./fold";
import { sourceRevisionsFooterHtml } from "../sourceRevisions";
import { ZATCA_LOGO_URL } from "../../../branding/organization";

const ORG: OrgBlock = { logoUrl: ZATCA_LOGO_URL, orgName: "ضمان جودة الأشعة", lines: [] };

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

// Deck slides render onto a fixed 1920x1080 overflow:hidden canvas
// (deck3/theme.ts) — unlike document.ts's flowing A4 pages, there is no room
// to paginate, so any list beyond a small cap must be capped-and-folded into
// a visible remainder row instead of silently overflowing off-canvas.
function capWithRemainder<T extends { counts: ResultCounts }>(
  items: T[],
  cap: number,
  labelOf: (item: T) => string,
  remainderLabel: string
): Array<{ label: string; counts: ResultCounts }> {
  if (items.length <= cap) return items.map((item) => ({ label: labelOf(item), counts: item.counts }));
  const top = items.slice(0, cap);
  const rest = items.slice(cap);
  const remainder = rest.reduce(
    (acc, item) => ({
      سليمة: acc.سليمة + item.counts.سليمة,
      اشتباه: acc.اشتباه + item.counts.اشتباه,
      total: acc.total + item.counts.total,
    }),
    { سليمة: 0, اشتباه: 0, total: 0 }
  );
  return [
    ...top.map((item) => ({ label: labelOf(item), counts: item.counts })),
    { label: `${remainderLabel} (${rest.length})`, counts: remainder },
  ];
}

const PORT_CAP = 10;
const EMPLOYEE_CAP = 12;

function portBreakdownTwoColumn(breakdown: PortBreakdown): string {
  const landCapped = capWithRemainder(breakdown.land, PORT_CAP, (p) => p.portName, "أخرى");
  const seaCapped = capWithRemainder(breakdown.sea, PORT_CAP, (p) => p.portName, "أخرى");
  const padTo = Math.max(landCapped.length, seaCapped.length);
  const rowsFor = (ports: Array<{ label: string; counts: ResultCounts }>) => ports.map((p) => resultRow(p.label, p.counts));
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
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(landCapped), totals: totalsFor(breakdown.land, "إجمالي البرية"), padToRows: padTo }),
})}
${tintedPanel({
  variant: "sea",
  title: "المنافذ البحرية",
  body: dataTable({ headers: RESULT_HEADERS, rows: rowsFor(seaCapped), totals: totalsFor(breakdown.sea, "إجمالي البحرية"), padToRows: padTo }),
})}
</div>`;
}

export function contentsRows(
  scope: PopulationReportScope
): Array<{ index: number; title: string; description: string; topics: string; pages: string }> {
  const rows: Array<{ index: number; title: string; description: string; topics: string; pages: string }> = [];
  if (scope !== "sample") {
    rows.push({
      index: rows.length + 1,
      title: "المجتمع",
      description: "المجتمع المستلم والمعالج",
      topics: "الاستلام، المعالجة، التوزيع حسب المرحلة والمنفذ",
      pages: "٥",
    });
  }
  if (scope !== "population") {
    rows.push({
      index: rows.length + 1,
      title: "العينة",
      description: "تكوين العينة المسحوبة",
      topics: "حسب المرحلة والمنفذ",
      pages: "٢",
    });
    rows.push({
      index: rows.length + 1,
      title: "التوزيع",
      description: "التوزيع على الموظفين",
      topics: "حسب المرحلة، المنفذ، وCertScan",
      pages: "٣",
    });
  }
  return rows;
}

export function buildSection1Slides(
  model: PopulationReportModel,
  meta: (num: number) => SlideMeta,
  scope: PopulationReportScope = "both"
): string[] {
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
      rows: contentsRows(scope),
      meta: meta(2),
    })
  );

  if (scope === "sample") return slides; // cover + contents only; Section 1's own content is excluded

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

function buildSection2Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta, startNum: number): string[] {
  const slides: string[] = [];

  slides.push(
    sectionDivider({
      eyebrow: "القسم الثاني",
      ghost: "٢",
      kicker: "القسم الثاني",
      title: "العينة",
      description: "العينة المسحوبة من المجتمع، على نفس المحاور",
      footItems: [],
      meta: meta(startNum),
    })
  );

  const sampleStageRows = model.sample.byStage.map((b) => resultRow(b.stageLabel, b.counts));
  slides.push(
    slideShell(
      meta(startNum + 1),
      "",
      `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المرحلة" })}
${dataTable({ headers: RESULT_HEADERS, rows: sampleStageRows, totals: resultRow("الإجمالي", model.sample.totals) })}`
    )
  );

  slides.push(
    slideShell(
      meta(startNum + 2),
      "",
      `${contentHead({ eyebrow: "القسم الثاني", title: "العينة حسب المنفذ" })}
${portBreakdownTwoColumn(model.sample.byPort)}`
    )
  );

  return slides;
}

function employeeStageTable(model: PopulationReportModel): string {
  const headers = ["الموظف", ...model.distribution.stageKeysPresent.map((k) => STAGE_LABELS[k] ?? k), "الإجمالي"];
  const all = model.distribution.byEmployeeStage;
  const top = all.slice(0, EMPLOYEE_CAP);
  const rest = all.slice(EMPLOYEE_CAP);
  const rows: TableCell[][] = top.map((emp) => [
    { html: esc(emp.displayName) },
    ...model.distribution.stageKeysPresent.map((k) => ({ html: fmtNum(emp.stages[k]?.total ?? 0) })),
    { html: fmtNum(emp.total.total), cls: "v-navy" },
  ]);
  if (rest.length > 0) {
    const stageTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const emp of rest) {
      for (const k of model.distribution.stageKeysPresent) {
        stageTotals[k] = (stageTotals[k] ?? 0) + (emp.stages[k]?.total ?? 0);
      }
      grandTotal += emp.total.total;
    }
    rows.push([
      { html: esc(`آخرون (${rest.length})`) },
      ...model.distribution.stageKeysPresent.map((k) => ({ html: fmtNum(stageTotals[k] ?? 0) })),
      { html: fmtNum(grandTotal), cls: "v-navy" },
    ]);
  }
  return dataTable({ headers, rows });
}

function employeePortTable(model: PopulationReportModel): string {
  const headers = ["الموظف", "برية", "بحرية", "الإجمالي"];
  const all = model.distribution.byEmployeePort;
  const top = all.slice(0, EMPLOYEE_CAP);
  const rest = all.slice(EMPLOYEE_CAP);
  const rows: TableCell[][] = top.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.ports.land.total) },
    { html: fmtNum(emp.ports.sea.total) },
    { html: fmtNum(emp.total.total), cls: "v-navy" },
  ]);
  if (rest.length > 0) {
    const land = rest.reduce((sum, emp) => sum + emp.ports.land.total, 0);
    const sea = rest.reduce((sum, emp) => sum + emp.ports.sea.total, 0);
    const total = rest.reduce((sum, emp) => sum + emp.total.total, 0);
    rows.push([
      { html: esc(`آخرون (${rest.length})`) },
      { html: fmtNum(land) },
      { html: fmtNum(sea) },
      { html: fmtNum(total), cls: "v-navy" },
    ]);
  }
  return dataTable({ headers, rows });
}

function certScanTable(model: PopulationReportModel): string {
  const all = model.distribution.certScanByEmployee;
  const top = all.slice(0, EMPLOYEE_CAP);
  const rest = all.slice(EMPLOYEE_CAP);
  const rows: TableCell[][] = top.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.certScanCount), cls: "v-gold" },
    { html: fmtNum(emp.nonCertScanCount) },
    { html: fmtNum(emp.total), cls: "v-navy" },
  ]);
  if (rest.length > 0) {
    const certScanCount = rest.reduce((sum, emp) => sum + emp.certScanCount, 0);
    const nonCertScanCount = rest.reduce((sum, emp) => sum + emp.nonCertScanCount, 0);
    const total = rest.reduce((sum, emp) => sum + emp.total, 0);
    rows.push([
      { html: esc(`آخرون (${rest.length})`) },
      { html: fmtNum(certScanCount), cls: "v-gold" },
      { html: fmtNum(nonCertScanCount) },
      { html: fmtNum(total), cls: "v-navy" },
    ]);
  }
  return dataTable({ headers: ["الموظف", "CertScan", "غير CertScan", "الإجمالي"], rows });
}

function buildSection3Slides(model: PopulationReportModel, meta: (num: number) => SlideMeta, startNum: number): string[] {
  const slides: string[] = [];

  slides.push(
    sectionDivider({
      eyebrow: "القسم الثالث",
      ghost: "٣",
      kicker: "القسم الثالث",
      title: "التوزيع",
      description: "من استلم ماذا، وما هي النتائج",
      footItems: [],
      meta: meta(startNum),
    })
  );

  slides.push(
    slideShell(
      meta(startNum + 1),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمرحلة" })}
${employeeStageTable(model)}`
    )
  );

  slides.push(
    slideShell(
      meta(startNum + 2),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمنفذ" })}
${employeePortTable(model)}`
    )
  );

  slides.push(
    slideShell(
      meta(startNum + 3),
      "",
      `${contentHead({ eyebrow: "القسم الثالث", title: "التوزيع حسب CertScan" })}
${certScanTable(model)}`
    )
  );

  return slides;
}

export async function buildPopulationDeckSlides(
  model: PopulationReportModel,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const includePopulation = scope !== "sample";
  const includeSample = scope !== "population";
  const section1Count = includePopulation ? 6 : 0; // divider + 5 content slides, NOT counting cover/contents
  const totalSlides = 2 /* cover + contents */ + section1Count + (includeSample ? 7 : 0) /* s2(3) + s3(4) */ + 1 /* closing */;
  const s1End = 2 + section1Count;
  const s2End = s1End + (includeSample ? 3 : 0);

  // Cover/contents (and, for scope="sample", the closing slide too) precede
  // or follow sections that may not exist in this scope's slide set — label
  // them with whichever real section is actually adjacent instead of always
  // assuming Section 1/Section 3, so the nav rail never shows a section link
  // for content the report doesn't contain (Fix 5).
  const firstSectionKey = includePopulation ? "s1" : "s2";
  const firstSectionLabel = includePopulation ? "المجتمع" : "العينة";
  const lastSectionKey = includeSample ? "s3" : "s1";
  const lastSectionLabel = includeSample ? "التوزيع" : "المجتمع";

  const meta = (num: number): SlideMeta => {
    let sectionKey: string;
    let sectionLabel: string;
    if (num <= s1End) {
      sectionKey = firstSectionKey;
      sectionLabel = firstSectionLabel;
    } else if (includeSample && num <= s2End) {
      sectionKey = "s2";
      sectionLabel = "العينة";
    } else {
      sectionKey = lastSectionKey;
      sectionLabel = lastSectionLabel;
    }
    return { num, total: totalSlides, sectionKey, sectionLabel, footText: `تقرير المجتمع — ${model.monthLabel}` };
  };

  const parts: string[] = [];
  parts.push(...buildSection1Slides(model, meta, scope));
  await yieldToMain();
  if (includeSample) {
    parts.push(...buildSection2Slides(model, meta, s1End + 1));
    await yieldToMain();
    parts.push(...buildSection3Slides(model, meta, s1End + 4));
    await yieldToMain();
  }
  parts.push(
    closingSlide({
      org: ORG,
      kicker: "تقرير المجتمع",
      title: "نهاية التقرير",
      closingLine: `تقرير المجتمع — ${model.monthLabel}`,
      metaRows: [],
      meta: meta(totalSlides),
    })
  );
  return parts.join("\n");
}

export async function buildPopulationDeck(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const model = computePopulationReportModel(input);
  const slides = await buildPopulationDeckSlides(model, scope);
  return buildDeckV3Html(
    slides,
    model.monthLabel,
    {
      title: "تقرير المجتمع",
      navBrand: "تقرير المجتمع",
      toolbarBrand: "تقرير المجتمع",
    },
    sourceRevisionsFooterHtml(model.sourceRevisions, esc)
  );
}

export async function openPopulationDeck(input: PopulationReportInput, scope: PopulationReportScope = "both"): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(reportWindow, () => buildPopulationDeck(input, scope), `تقرير_المجتمع_${input.monthFolderName}.html`);
}

export type { PopulationReportInput as PopulationDeckInput } from "./model";
