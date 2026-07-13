// Management workbook (بيانات الإدارة) — Wave 3. Adds the missing Excel output to
// the management report, driven by the SAME `ReportModel` as the management
// Document and Deck. Lineage-first layout (management lens): the
// population → sample → studied funnel, per-port performance, per-reviewer
// performance, and status / referral-replacement activity.
//
// Pure over the model + input; the only side effect is `XLSX.writeFile` in the
// `buildManagementWorkbook` wrapper. `buildManagementWorkbookObject` is pure and
// unit-testable.

import * as XLSX from "xlsx";

import { buildReportModel } from "../executive/model/reportModel";
import type { ReportModel } from "../executive/model/reportModel";
import type { DataSufficiencyBand } from "../executive/model/dataSufficiency";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import {
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_SHEET_NAME_AR,
  hasSourceRevisions,
} from "../sourceRevisions";

type Cell = string | number;

const DASH = "—";

function pct(value: number | null | undefined): Cell {
  return value === null || value === undefined ? "" : Number(value.toFixed(2));
}

function text(value: string | null | undefined): Cell {
  if (value === null || value === undefined) return DASH;
  const t = value.trim();
  return t === "" ? DASH : t;
}

const BAND_LABELS: Record<DataSufficiencyBand, string> = {
  sufficient: "كافية",
  limited: "محدودة",
  insufficient: "غير كافية",
  none: "لا توجد",
};

function ratePct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

function summarySheet(m: ReportModel): Cell[][] {
  const s = m.summary;
  return [
    ["تقرير", "بيانات الإدارة"],
    ["الشهر", text(m.summary.monthFolderName)],
    ["الفترة", text(s.periodId)],
    ["كفاية البيانات", BAND_LABELS[m.dataQuality.overallBand]],
    [],
    ["— المؤشرات الرئيسية —", ""],
    ["دقة الفحص٪", pct(s.overallAccuracy)],
    ["كشف الاشتباه٪", pct(s.detectionRate)],
    ["الاشتباه الفائت٪", pct(s.missedSuspicionRate)],
    ["نسبة الإنجاز٪", pct(s.completionRate)],
    [],
    ["— النطاق والتغطية —", ""],
    ["إجمالي المجتمع", m.population.total],
    ["إجمالي العينة", m.sample.total],
    ["تغطية العينة٪", pct(m.sample.coverage)],
    ["المدروسة", m.sample.studied],
    ["المتبقية", m.sample.remaining],
    [],
    ["— جودة البيانات —", ""],
    ["إجمالي القرارات", m.dataQuality.totalDecisionRecords],
    ["قرارات قابلة للتقييم", m.dataQuality.evaluableDecisionRecords],
    ["هوية المفتش مرتبطة (BI)", m.dataQuality.inspectorIdentityMapped ? "نعم" : "لا"],
    ["بيانات BI متاحة", m.dataQuality.biAvailable ? "نعم" : "لا"],
  ];
}

/** Population → Sample → Studied funnel, per stage (the comparison the mission asks for). */
function funnelSheet(m: ReportModel): Cell[][] {
  return [
    ["المستوى", "المجتمع", "العينة", "التغطية٪", "المدروسة", "الإنجاز٪"],
    ...m.population.byStage.map((st) => [
      text(st.stageLabel), st.population, st.sampleSize, pct(st.coverage), st.studied, pct(st.completionRate),
    ]),
    [],
    ["الإجمالي", m.population.total, m.sample.total, pct(m.sample.coverage), m.sample.studied, pct(m.sample.completionRate)],
  ];
}

function portSheet(m: ReportModel): Cell[][] {
  const ports = [...m.portAccuracy].sort((a, b) => {
    if (a.accuracy === null && b.accuracy === null) return 0;
    if (a.accuracy === null) return 1;
    if (b.accuracy === null) return -1;
    return a.accuracy - b.accuracy;
  });
  return [
    ["المنفذ", "قابلة للتقييم", "الدقة٪", "كشف الاشتباه٪", "الاشتباه الفائت٪", "الكفاية"],
    ...ports.map((p) => [
      text(p.key), p.evaluable, pct(p.accuracy), pct(p.detectionRate), pct(p.missedSuspicionRate), BAND_LABELS[p.band],
    ]),
  ];
}

function reviewerSheet(m: ReportModel): Cell[][] {
  const eo = m.employeeOverview;
  if (eo.reviewerProfiles.length === 0) {
    return [["المراجع", "المدروسة", "الدقة٪", "كشف الاشتباه٪", "الاشتباه الفائت٪", "الحالة", "التوصية"], ["لا توجد بيانات مراجعين كافية لهذه الفترة."]];
  }
  return [
    ["المراجع", "المدروسة", "الدقة٪", "كشف الاشتباه٪", "الاشتباه الفائت٪", "الحالة", "التوصية"],
    ...eo.reviewerProfiles.map((p) => [
      text(eo.reviewerDisplayNames[p.username] ?? p.username),
      p.studied, pct(p.overallAccuracy), pct(p.suspiciousDetectionRate), pct(p.missedSuspicionRate),
      p.reliable ? "موثوق" : "غير كافٍ", text(p.recommendedAction),
    ]),
  ];
}

/** Status + referral/replacement activity. Referral-requested count is derived
 *  from the current distribution snapshot when present. */
function statusSheet(m: ReportModel, input: ExecutiveReportInput): Cell[][] {
  const requested = input.distribution
    ? input.distribution.entries.filter((e) => e.status === "replacement-requested").length
    : 0;
  const d = m.distribution;
  return [
    ["الحالة", "العدد", "النسبة٪"],
    ["معيّنة (إجمالي)", d.assigned, ""],
    ["مكتملة", d.completed, pct(ratePct(d.completed, d.assigned))],
    ["قيد الانتظار", d.pending, pct(ratePct(d.pending, d.assigned))],
    ["مستبدلة", d.replaced, pct(ratePct(d.replaced, d.assigned))],
    ["طلبات استبدال (حالية)", requested, pct(ratePct(requested, d.assigned))],
    [],
    ["— الأولويات والإجراءات —", "", ""],
    ...m.actions.filter((a) => a && a.trim().length > 0).map((a, i) => [`${i + 1}`, text(a), ""]),
  ];
}

export function buildManagementWorkbookObject(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): XLSX.WorkBook {
  const model = buildReportModel(input, employeeDisplayNames);
  const wb = XLSX.utils.book_new();
  const append = (name: string, aoa: Cell[][]): void => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };
  append("الملخص الإداري", summarySheet(model));
  append("المجتمع-العينة-المدروس", funnelSheet(model));
  append("الأداء حسب المنفذ", portSheet(model));
  append("أداء المراجعين", reviewerSheet(model));
  append("الحالة والإجراءات", statusSheet(model, input));
  if (hasSourceRevisions(input.sourceRevisions)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sourceRevisionsSheetAoa(input.sourceRevisions)),
      SOURCE_REVISIONS_SHEET_NAME_AR
    );
  }
  return wb;
}

export function buildManagementWorkbook(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  const wb = buildManagementWorkbookObject(input, employeeDisplayNames);
  XLSX.writeFile(wb, `تقرير_الإدارة_${input.monthFolderName}.xlsx`);
}
