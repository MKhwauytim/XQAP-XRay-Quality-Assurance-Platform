// Management report (تقرير الإدارة) — R3 restructure (2026-08-07).
//
// Was previously a "summary cut" of the accuracy-shaped executive `ReportModel`.
// The owner's actual requirement is progress/accountability-shaped: per-employee
// completion progress, replacement counts WITH REASONS, and reassignment
// counts — grouped section 1 per stage/level, section 2 per port (same
// ordering directive as the distribution report, R2). See `managementModel.ts`
// for the full rationale and the model itself; this file only renders it.
//
// Reuses the same document-chrome primitives as the distribution/sample
// reports (`executive/document/shared.ts`, `pagination.ts`) instead of the
// old bespoke CSS block, so all three lineage-style reports share one visual
// identity and one pagination implementation.
//
// SECURITY: every interpolated value (employee names, port/stage labels,
// replacement reasons) routes through the hardened `esc` primitive via the
// shared render helpers. This builder is part of the Wave 3 XSS test set.

import type { DistributionCurrentData } from "../../distribution/distributionTypes";
import { openReportWindow, writeOrCloseOnFailure } from "../htmlReport";
import { yieldToMain } from "../../storage/yieldToMain";
import { esc, fmtNum, fmtPct } from "../executive/primitives";
import { page, pageHeader, kpi, kpiStrip, panel } from "../executive/document/shared";
import { dataTable, paginateRows } from "../executive/document/pagination";
import { buildDocViewer, formatIssueDate } from "../shared/reportChrome";
import { sourceRevisionsFooterHtml } from "../sourceRevisions";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import { computeManagementModel, type ManagementModel, type ManagementBucket } from "./managementModel";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function rotate<T>(arr: T[], by: number): T[] {
  const n = arr.length;
  const k = ((by % n) + n) % n;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

const MGMT_RAILS = ["الأساس", "المستوى", "المنفذ", "الاستبدال"];

function bucketPanel(bucket: ManagementBucket): string {
  return panel(
    `${bucket.label} — ${fmtNum(bucket.totalAssigned)} صورة، ${fmtPct(bucket.completionRate)} إنجاز`,
    dataTable({
      headers: ["الموظف", "المعيّنة", "المكتملة", "الإنجاز"],
      rows: bucket.employees.map((e) => [e.displayName, fmtNum(e.assigned), fmtNum(e.completed), fmtPct(e.completionRate)]),
      totalRow: ["المجموع", fmtNum(bucket.totalAssigned), fmtNum(bucket.totalCompleted), fmtPct(bucket.completionRate)],
    }),
    { iconName: "layers" },
  );
}

const EMPTY_NOTE_STYLE = "color:#667085;font-size:13px;padding:14px;text-align:center;background:#f8fafc;border-radius:8px";

function bucketSectionBody(buckets: ManagementBucket[]): string {
  if (buckets.length === 0) return `<div style="${EMPTY_NOTE_STYLE}">لا توجد بيانات توزيع بعد.</div>`;
  return buckets.map(bucketPanel).join("\n");
}

async function managementDocPages(m: ManagementModel, issueDate: string): Promise<string> {
  const pages: string[] = [];

  // Page 1 — overview / totals.
  pages.push(page({
    id: "m-overview", title: "لمحة الإدارة", pageNo: "01", railTabs: MGMT_RAILS,
    body: `${pageHeader({ iconName: "shield", eyebrow: "تقرير الإدارة", title: `متابعة الإنجاز والمساءلة — ${m.monthLabel}`, subtitle: `تم التوليد: ${m.derivedAt} — تاريخ الإصدار: ${issueDate}` })}
      ${kpiStrip([
        kpi({ label: "إجمالي المعيّنة", value: fmtNum(m.totals.assigned), tone: "slate" }),
        kpi({ label: "مكتملة", value: fmtNum(m.totals.completed), sub: `${fmtPct(m.totals.completionRate)} إنجاز`, tone: "green" }),
        kpi({ label: "طلبات استبدال", value: fmtNum(m.totals.requested), tone: "coral" }),
        kpi({ label: "مستبدلة", value: fmtNum(m.totals.replaced), sub: `${fmtNum(m.reassignments.total)} إعادة تعيين`, tone: "gold" }),
      ])}`,
  }));
  await yieldToMain();

  // Section 1 — per stage/level.
  pages.push(page({
    id: "m-by-stage", title: "القسم 1 — حسب المستوى", pageNo: "02", railTabs: rotate(MGMT_RAILS, 1),
    body: `${pageHeader({ iconName: "layers", eyebrow: "القسم 1", title: "تقدّم الإنجاز حسب المستوى", subtitle: "لكل مستوى: الموظفون ونسبة إنجاز كل منهم من عينته." })}
      ${bucketSectionBody(m.byStage)}`,
  }));
  await yieldToMain();

  // Section 2 — per port.
  pages.push(page({
    id: "m-by-port", title: "القسم 2 — حسب المنفذ", pageNo: "03", railTabs: rotate(MGMT_RAILS, 2),
    body: `${pageHeader({ iconName: "port", eyebrow: "القسم 2", title: "تقدّم الإنجاز حسب المنفذ", subtitle: "لكل منفذ: الموظفون ونسبة إنجاز كل منهم من عينته." })}
      ${bucketSectionBody(m.byPort)}`,
  }));
  await yieldToMain();

  // Replacement / reassignment activity.
  const replHeaders = ["رقم الأشعة", "الموظف", "المنفذ", "السبب", "البديل", "آخر حدث"];
  const replRows = m.replacements.records.map((r) => [r.xrayImageId, r.displayName, r.portName, r.reason ?? "—", r.replacedById ?? "—", r.lastEventAt]);
  const replChunks = paginateRows({ headers: replHeaders, rows: replRows, rowsPerPage: 18 });
  let pageNo = 4;
  const reasonSummary = m.replacements.byReason.length > 0
    ? panel("الأسباب الأكثر تكراراً", dataTable({
        headers: ["السبب", "العدد"],
        rows: m.replacements.byReason.map((r) => [r.reason, fmtNum(r.count)]),
      }), { iconName: "flag" })
    : "";
  if (replChunks.length === 0) {
    pages.push(page({
      id: "m-replacements", title: "الاستبدال وإعادة التعيين", pageNo: pad(pageNo), railTabs: rotate(MGMT_RAILS, 3),
      body: `${pageHeader({ iconName: "flag", eyebrow: "المساءلة", title: "الاستبدال وإعادة التعيين", subtitle: `${fmtNum(m.reassignments.total)} إعادة تعيين مسجَّلة هذا الشهر.` })}
        <div style="${EMPTY_NOTE_STYLE}">لا توجد صور مستبدلة هذا الشهر.</div>`,
    }));
  } else {
    for (let i = 0; i < replChunks.length; i++) {
      const chunk = replChunks[i];
      pages.push(page({
        id: `m-replacements-${i}`, title: i === 0 ? "الاستبدال وإعادة التعيين" : `الاستبدال وإعادة التعيين (${i + 1})`,
        pageNo: pad(pageNo++), railTabs: rotate(MGMT_RAILS, 3),
        body: `${pageHeader({ iconName: "flag", eyebrow: "المساءلة", title: "الاستبدال وإعادة التعيين", subtitle: `${fmtNum(m.replacements.total)} صورة مستبدلة — ${fmtNum(m.reassignments.total)} إعادة تعيين مسجَّلة هذا الشهر.` })}
          ${i === 0 ? reasonSummary : ""}
          ${panel("سجل الاستبدالات", chunk, { iconName: "flag" })}`,
      }));
      await yieldToMain();
    }
  }

  return pages.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the self-contained management-report HTML string for a month. Reads
 *  `input.distribution` (assignment/progress data) — NOT the accuracy model. */
export async function buildManagementReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const empty: DistributionCurrentData = {
    monthFolderName: input.monthFolderName, derivedAt: "—",
    totalAssigned: 0, totalCompleted: 0, totalReplaced: 0, totalPending: 0, entries: [],
  };
  const m = computeManagementModel(
    input.distribution ?? empty,
    input.monthFolderName,
    employeeDisplayNames,
    input.distributionEvents ?? [],
    input.replacementReasons ?? {},
  );
  return buildDocViewer({
    slides: await managementDocPages(m, formatIssueDate()),
    docTitle: `تقرير الإدارة — ${m.monthLabel}`,
    brandTitle: "تقرير الإدارة",
    brandSub: `ضمان جودة الأشعة — ${m.monthLabel}`,
    iconName: "shield",
    footerNote: sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  });
}

/**
 * Opens the target tab synchronously (still inside the click's user gesture,
 * P3-7) BEFORE the now-async `buildManagementReport` build runs, then writes
 * the finished HTML in once ready — same pattern as `openSampleReport`/
 * `openDistributionDocument`. `writeOrCloseOnFailure` closes the
 * already-opened tab instead of abandoning it blank if the build throws.
 */
export async function openManagementReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildManagementReport(input, employeeDisplayNames),
    `تقرير_الإدارة_${input.monthFolderName}.html`,
  );
}
