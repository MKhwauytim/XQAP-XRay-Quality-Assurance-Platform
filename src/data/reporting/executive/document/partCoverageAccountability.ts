// Part 6a — Coverage & Accountability (R4, 2026-08-07 owner requirement: the
// executive report is "the mix of تقرير العينة و تقرير التوزيع و تقرير الإدارة").
// This part folds in the R2 (distribution) coverage buckets and the R3
// (management) accountability figures that `ReportModel.distributionCoverage`
// / `ReportModel.accountabilityProgress` already carry — computed ONCE by
// `computeDistributionModel` / `computeManagementModel` in reportModel.ts and
// only rendered here, never refolded.
//
// Section list rationale (documented per the task's "propose a concrete
// section list" instruction):
//   Part 1 (existing) — lineage/scope: what was imported, processed, sampled.
//   Part 2/3 (existing) — inspection-quality accuracy + corroboration.
//   Part 4 (existing) — per-inspector accuracy accountability.
//   Part 5 (existing) — risk, priorities, actions.
//   Part 6 (NEW, this file + partEmployeeRows.ts) — operational coverage
//     (R2: per-stage/per-port assignment+completion) and operational
//     accountability (R3: per-employee progress, replacement reasons,
//     reassignment counts), plus the R5 per-employee row listing. Placed
//     LAST so it reads as an appendix-style operational supplement to the
//     accuracy-first narrative in Parts 1-5, and so its addition is purely
//     additive to the existing page sequence (no renumbering of Parts 1-5).

import type { ReportModel } from "../model/reportModel";
import type { DistributionBucket } from "../../distributionReport";
import type { ManagementBucket } from "../../management/managementModel";
import { fmtNum, fmtPct } from "../primitives";
import { emptyState, executiveClose, kpi, kpiStrip, noteBox, page, pageHeader, panel } from "./shared";
import { dataTable } from "./pagination";

const TABS = ["الجزء السادس"];

function coverageBucketTable(buckets: DistributionBucket[]): string {
  if (buckets.length === 0) return emptyState("لا توجد بيانات توزيع بعد.");
  const totalAssigned = buckets.reduce((s, b) => s + b.totalAssigned, 0);
  const totalCompleted = buckets.reduce((s, b) => s + b.totalCompleted, 0);
  return dataTable({
    headers: ["المستوى/المنفذ", "المعيّنة", "المكتملة", "الإنجاز"],
    rows: buckets.map((b) => [b.label, fmtNum(b.totalAssigned), fmtNum(b.totalCompleted), fmtPct(b.completionRate)]),
    totalRow: ["المجموع", fmtNum(totalAssigned), fmtNum(totalCompleted), fmtPct(totalAssigned > 0 ? (totalCompleted / totalAssigned) * 100 : null)],
  });
}

/** Coverage page (R2 reuse): distribution assignment + completion, per stage and per port. */
export function buildCoverageSection(model: ReportModel, pageNo: string): string {
  const cov = model.distributionCoverage;
  const header = pageHeader({
    iconName: "layers",
    eyebrow: "الجزء السادس · التغطية والمساءلة التشغيلية",
    title: "التغطية التشغيلية",
    subtitle: "توزيع العينة وإنجازها حسب المستوى والمنفذ — من تقرير التوزيع (R2)، بلا إعادة احتساب.",
  });

  if (cov === null) {
    const body = `${header}${emptyState("لا يوجد توزيع لهذا الشهر بعد.", "يُبنى هذا القسم من بيانات تقرير التوزيع — وزّع العينة أولاً ليظهر هنا.")}`;
    return page({ id: "page-coverage", title: "التغطية التشغيلية", pageNo, railTabs: TABS, body });
  }

  const body = `${header}
    ${kpiStrip([
      kpi({ label: "عدد المستويات", value: fmtNum(cov.byStage.length), tone: "gold" }),
      kpi({ label: "عدد المنافذ", value: fmtNum(cov.byPort.length), tone: "blue" }),
    ], 2)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("حسب المستوى", coverageBucketTable(cov.byStage), { iconName: "layers" })}
      ${panel("حسب المنفذ", coverageBucketTable(cov.byPort), { iconName: "port" })}
    </div>
    ${executiveClose({
      shows: `تغطية موثّقة عبر ${fmtNum(cov.byStage.length)} مستويات و${fmtNum(cov.byPort.length)} منافذ.`,
      matters: "يربط هذا القسم تقرير التوزيع (R2) بالتحليل التنفيذي في مستند واحد.",
      action: "متابعة المستويات/المنافذ الأقل إنجازاً مع مسؤولي التوزيع.",
    })}`;
  return page({ id: "page-coverage", title: "التغطية التشغيلية", pageNo, railTabs: TABS, body });
}

function accountabilityBucketTable(buckets: ManagementBucket[]): string {
  if (buckets.length === 0) return emptyState("لا توجد بيانات تقدّم بعد.");
  return dataTable({
    headers: ["المنفذ", "المعيّنة", "المكتملة", "الإنجاز"],
    rows: buckets.slice(0, 10).map((b) => [b.label, fmtNum(b.totalAssigned), fmtNum(b.totalCompleted), fmtPct(b.completionRate)]),
  });
}

/** Accountability page (R3 reuse): replacement reasons, reassignment count, per-port employee progress. */
export function buildAccountabilitySection(model: ReportModel, pageNo: string): string {
  const acc = model.accountabilityProgress;
  const header = pageHeader({
    iconName: "flag",
    eyebrow: "الجزء السادس · التغطية والمساءلة التشغيلية",
    title: "المساءلة التشغيلية",
    subtitle: "تقدّم الموظفين، أسباب الاستبدال، وعدد إعادة التعيين — من تقرير الإدارة (R3)، بلا إعادة احتساب.",
  });

  if (acc === null) {
    const body = `${header}${emptyState("لا يوجد توزيع لهذا الشهر بعد.", "يُبنى هذا القسم من بيانات تقرير الإدارة — وزّع العينة أولاً ليظهر هنا.")}`;
    return page({ id: "page-accountability", title: "المساءلة التشغيلية", pageNo, railTabs: TABS, body });
  }

  const reasonRows = acc.replacements.byReason.map((r) => [r.reason, fmtNum(r.count)]);
  const body = `${header}
    ${kpiStrip([
      kpi({ label: "إجمالي المستبدلة", value: fmtNum(acc.replacements.total), tone: "coral" }),
      kpi({ label: "إعادة التعيين", value: fmtNum(acc.reassignments.total), tone: "blue" }),
    ], 2)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("أسباب الاستبدال", reasonRows.length > 0 ? dataTable({ headers: ["السبب", "العدد"], rows: reasonRows }) : emptyState("لا توجد استبدالات موثّقة بسبب هذا الشهر."), { iconName: "flag" })}
      ${panel("تقدّم أعلى المنافذ", accountabilityBucketTable(acc.byPort), { iconName: "port" })}
    </div>
    ${acc.reassignments.total === 0 && acc.replacements.total === 0
      ? noteBox("لا توجد استبدالات أو إعادة تعيين مسجّلة لهذا الشهر — أو لم تُمرَّر سجلات الأحداث الخام لهذا التوليد.", "alert")
      : ""}
    ${executiveClose({
      shows: `${fmtNum(acc.replacements.total)} استبدال و${fmtNum(acc.reassignments.total)} إعادة تعيين هذا الشهر.`,
      matters: "أسباب الاستبدال المتكررة وإعادة التعيين تكشف اختناقات سير العمل التشغيلي.",
      action: "مراجعة الأسباب الأكثر تكراراً مع الموظفين والمنافذ المعنية.",
    })}`;
  return page({ id: "page-accountability", title: "المساءلة التشغيلية", pageNo, railTabs: TABS, body });
}
