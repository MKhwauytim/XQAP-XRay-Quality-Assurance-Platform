// A4, full-detail, paginated document edition of تقرير المجتمع, built on the
// documentV3 chrome (Task 5). Parallels deck.ts's slide edition but flows
// content across A4 pages instead of fixed slides, and never truncates
// per-employee detail (docPaginateTable chunks it across as many pages as
// needed — see the "paginates rather than truncating" test below).
import {
  docPage,
  docCover,
  docClosing,
  docSectionDivider,
  docPageHeader,
  docKpiStrip,
  docTwoColumn,
  docPaginateTable,
} from "../executive/documentV3/shared";
import { DOCUMENT_V3_CSS } from "../executive/documentV3/theme";
import { fmtNum, fmtPct, esc } from "../executive/primitives";
import { yieldToMain } from "../../storage/yieldToMain";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { computePopulationReportModel } from "./model";
import type { PopulationReportModel, PopulationReportInput } from "./model";
import { RESULT_HEADERS, resultRow, contentsRows } from "./deck";
import { STAGE_LABELS } from "./fold";
import type { PortBreakdown, PopulationReportScope } from "./types";
import { sourceRevisionsFooterHtml, SOURCE_REVISIONS_CSS } from "../sourceRevisions";

// rowsPerPage is set well above any realistic port count (a country's customs
// ports are a small, bounded list) so the [0] chunk below is never actually
// truncating data — a real unbounded list would need per-column pagination
// instead of the fixed two-column layout this page uses. If a future
// workspace ever exceeds this, this is the line to revisit.
const PORT_TABLE_ROWS_PER_PAGE = 60;

function portBreakdownPage(id: string, pageNo: string, title: string, breakdown: PortBreakdown): string {
  return docPage({
    id,
    pageNo,
    title,
    body: `${docPageHeader({ eyebrow: "", title })}
${docTwoColumn({
  land: {
    title: "المنافذ البرية",
    body: docPaginateTable({ headers: RESULT_HEADERS, rows: breakdown.land.map((p) => resultRow(p.portName, p.counts)), rowsPerPage: PORT_TABLE_ROWS_PER_PAGE })[0],
  },
  sea: {
    title: "المنافذ البحرية",
    body: docPaginateTable({ headers: RESULT_HEADERS, rows: breakdown.sea.map((p) => resultRow(p.portName, p.counts)), rowsPerPage: PORT_TABLE_ROWS_PER_PAGE })[0],
  },
})}`,
  });
}

function buildContentsPage(scope: PopulationReportScope): string {
  const rows = contentsRows(scope);
  const items = rows.map((r) => `<li><strong>${esc(r.title)}</strong> — ${esc(r.description)}</li>`).join("");
  return docPage({
    id: "contents",
    pageNo: "00",
    title: "المحتويات",
    body: `${docPageHeader({ eyebrow: "تقرير المجتمع", title: "المحتويات" })}<ul class="doc-contents-list">${items}</ul>`,
  });
}

async function buildSection1Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  let n = 1;
  const pad = (v: number) => String(v).padStart(2, "0");

  pages.push(
    docSectionDivider({ ghost: "١", kicker: "القسم الأول", title: "المجتمع", description: "المجتمع المستلم وكيف تمت معالجته" })
  );

  const summary = model.reconciled.processingSummary;
  pages.push(
    docPage({
      id: "s1-receipt",
      pageNo: pad(n++),
      title: "الاستلام",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "الاستلام" })}
${docTwoColumn({
  land: { title: "بيانات المخاطر (Risk)", body: docKpiStrip([{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.riskRawRowCount) }]) },
  sea: {
    title: "بيانات معلومات الأعمال (BI)",
    body: docKpiStrip(
      model.reconciled.biRawRowCount === null
        ? [{ label: "لم يتم توفير BI لهذا الشهر", value: "—" }]
        : [{ label: "إجمالي الصفوف الخام", value: fmtNum(model.reconciled.biRawRowCount) }]
    ),
  },
})}`,
    })
  );
  await yieldToMain();

  pages.push(
    docPage({
      id: "s1-risk",
      pageNo: pad(n++),
      title: "بيانات المخاطر — قبل وبعد",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "بيانات المخاطر — قبل وبعد" })}
${
  summary
    ? docKpiStrip([
        { label: "الصفوف الأصلية", value: fmtNum(summary.riskOriginalRows) },
        { label: "معرّفات صحيحة", value: fmtNum(summary.validRiskIdRows) },
        { label: "معرّفات غير صحيحة", value: fmtNum(summary.invalidRiskIdRows) },
        { label: "بعد إزالة التكرار", value: fmtNum(summary.rowsAfterDeduplication) },
        { label: "المجتمع النهائي", value: fmtNum(summary.finalPreparedPopulationRows) },
      ])
    : docPageHeader({ eyebrow: "", title: "لا تتوفر بيانات المعالجة لهذا الشهر" })
}`,
    })
  );
  await yieldToMain();

  const biRows = summary
    ? summary.biFieldFillSummary.map((f) => [
        { html: esc(f.fieldName) },
        { html: fmtNum(f.riskEmptyBefore) },
        { html: fmtNum(f.filledFromBi) },
        { html: fmtNum(f.stillEmptyAfter) },
        { html: fmtPct(f.fillPercentage) },
      ])
    : [];
  pages.push(
    docPage({
      id: "s1-bi",
      pageNo: pad(n++),
      title: "بيانات BI — قبل وبعد",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "بيانات BI — قبل وبعد" })}
${
  summary && summary.biProvided
    ? `${docKpiStrip([
        { label: "تمت المطابقة", value: fmtNum(summary.biMatchedRows) },
        { label: "لم تتم المطابقة", value: fmtNum(summary.biUnmatchedRows) },
        { label: "نسبة المطابقة", value: fmtPct(summary.biMatchPercentage) },
      ])}
${docPaginateTable({ headers: ["الحقل", "فارغ قبل", "تمت التعبئة", "لا يزال فارغًا", "نسبة التعبئة"], rows: biRows }).join("")}`
    : docPageHeader({ eyebrow: "", title: "لم يتم توفير BI لهذا الشهر" })
}`,
    })
  );
  await yieldToMain();

  pages.push(
    docPage({
      id: "s1-stage",
      pageNo: pad(n++),
      title: "المجتمع النهائي حسب المرحلة",
      body: `${docPageHeader({ eyebrow: "القسم الأول", title: "المجتمع النهائي حسب المرحلة" })}
${docPaginateTable({
  headers: RESULT_HEADERS,
  rows: model.reconciled.byStage.map((b) => resultRow(b.stageLabel, b.counts)),
  totals: resultRow("الإجمالي", model.reconciled.totals),
}).join("")}`,
    })
  );
  await yieldToMain();

  pages.push(portBreakdownPage("s1-port", pad(n), "المجتمع النهائي حسب المنفذ", model.reconciled.byPort));
  await yieldToMain();

  return pages;
}

async function buildSection2Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  const pad = (v: number) => String(v).padStart(2, "0");
  pages.push(docSectionDivider({ ghost: "٢", kicker: "القسم الثاني", title: "العينة", description: "العينة المسحوبة من المجتمع" }));
  pages.push(
    docPage({
      id: "s2-stage",
      pageNo: pad(1),
      title: "العينة حسب المرحلة",
      body: `${docPageHeader({ eyebrow: "القسم الثاني", title: "العينة حسب المرحلة" })}
${docPaginateTable({
  headers: RESULT_HEADERS,
  rows: model.sample.byStage.map((b) => resultRow(b.stageLabel, b.counts)),
  totals: resultRow("الإجمالي", model.sample.totals),
}).join("")}`,
    })
  );
  await yieldToMain();
  pages.push(portBreakdownPage("s2-port", pad(2), "العينة حسب المنفذ", model.sample.byPort));
  await yieldToMain();
  return pages;
}

async function buildSection3Pages(model: PopulationReportModel): Promise<string[]> {
  const pages: string[] = [];
  pages.push(docSectionDivider({ ghost: "٣", kicker: "القسم الثالث", title: "التوزيع", description: "من استلم ماذا، وما هي النتائج" }));

  const stageHeaders = ["الموظف", ...model.distribution.stageKeysPresent.map((k) => STAGE_LABELS[k] ?? k), "الإجمالي"];
  const stageRows = model.distribution.byEmployeeStage.map((emp) => [
    { html: esc(emp.displayName) },
    ...model.distribution.stageKeysPresent.map((k) => {
      const c = emp.stages[k] ?? { سليمة: 0, اشتباه: 0, total: 0 };
      return { html: `${fmtNum(c.total)} (${fmtNum(c.سليمة)}/${fmtNum(c.اشتباه)})` };
    }),
    { html: fmtNum(emp.total.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: stageHeaders, rows: stageRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-stage-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب الموظف والمرحلة", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمرحلة" })}${chunk}` }));
    await yieldToMain();
  }

  const portRows = model.distribution.byEmployeePort.map((emp) => [
    { html: esc(emp.displayName) },
    { html: `${fmtNum(emp.ports.land.total)} (${fmtNum(emp.ports.land.سليمة)}/${fmtNum(emp.ports.land.اشتباه)})` },
    { html: `${fmtNum(emp.ports.sea.total)} (${fmtNum(emp.ports.sea.سليمة)}/${fmtNum(emp.ports.sea.اشتباه)})` },
    { html: fmtNum(emp.total.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: ["الموظف", "برية", "بحرية", "الإجمالي"], rows: portRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-port-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب الموظف والمنفذ", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب الموظف والمنفذ" })}${chunk}` }));
    await yieldToMain();
  }

  const certRows = model.distribution.certScanByEmployee.map((emp) => [
    { html: esc(emp.displayName) },
    { html: fmtNum(emp.certScanCount) },
    { html: fmtNum(emp.nonCertScanCount) },
    { html: fmtNum(emp.total) },
  ]);
  for (const chunk of docPaginateTable({ headers: ["الموظف", "CertScan", "غير CertScan", "الإجمالي"], rows: certRows, rowsPerPage: 25 })) {
    pages.push(docPage({ id: `s3-cert-${pages.length}`, pageNo: String(pages.length).padStart(2, "0"), title: "التوزيع حسب CertScan", body: `${docPageHeader({ eyebrow: "القسم الثالث", title: "التوزيع حسب CertScan" })}${chunk}` }));
    await yieldToMain();
  }

  return pages;
}

export async function buildPopulationDocument(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<string> {
  const model = computePopulationReportModel(input);
  const org = { logoUrl: "", orgName: "ضمان جودة الأشعة", lines: [] };
  const pages: string[] = [
    docCover({ org, title: "تقرير المجتمع", periodLabel: "الفترة", periodValue: model.monthLabel, metaRows: [] }),
    buildContentsPage(scope),
  ];
  if (scope !== "sample") pages.push(...(await buildSection1Pages(model)));
  if (scope !== "population") {
    pages.push(...(await buildSection2Pages(model)));
    pages.push(...(await buildSection3Pages(model)));
  }
  pages.push(docClosing({ org, title: "نهاية التقرير", closingLine: `تقرير المجتمع — ${model.monthLabel}` }));
  const footer = sourceRevisionsFooterHtml(model.sourceRevisions, esc);

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>تقرير المجتمع — ${esc(model.monthLabel)}</title>
<style>${DOCUMENT_V3_CSS}${footer ? SOURCE_REVISIONS_CSS : ""}</style></head>
<body><div class="docviewer"><aside class="sidebar no-print"><div class="doc-brand">تقرير المجتمع</div><div class="doc-brand-sub">${esc(model.monthLabel)}</div></aside>
<main class="content">${pages.join("\n")}${footer}</main></div></body></html>`;
}

export async function openPopulationDocument(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(reportWindow, () => buildPopulationDocument(input, scope), `تقرير_المجتمع_${input.monthFolderName}.html`);
}
