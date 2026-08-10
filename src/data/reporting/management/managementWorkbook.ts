// Management workbook (بيانات الإدارة) — R3 restructure (2026-08-07). Same
// progress/accountability `ManagementModel` as the management Document and
// Deck (see `managementModel.ts`). Section 1 per stage/level, section 2 per
// port; replacement records with reasons; reassignment total.
//
// Pure over the model + input; the only side effect is `XLSX.writeFile` in the
// `buildManagementWorkbook` wrapper. `buildManagementWorkbookObject` is pure and
// unit-testable.

import * as XLSX from "xlsx";

import type { DistributionCurrentData } from "../../distribution/distributionTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";
import {
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_SHEET_NAME_AR,
  hasSourceRevisions,
} from "../sourceRevisions";
import { computeManagementModel, type ManagementModel, type ManagementBucket } from "./managementModel";

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

function summarySheet(m: ManagementModel): Cell[][] {
  return [
    ["تقرير", "بيانات الإدارة — متابعة الإنجاز والمساءلة"],
    ["الشهر", text(m.monthLabel)],
    ["تاريخ الاشتقاق", text(m.derivedAt)],
    [],
    ["— المؤشرات الرئيسية —", ""],
    ["إجمالي المعيّنة", m.totals.assigned],
    ["مكتملة", m.totals.completed],
    ["قيد الانتظار", m.totals.pending],
    ["طلبات استبدال", m.totals.requested],
    ["مستبدلة", m.totals.replaced],
    ["نسبة الإنجاز٪", pct(m.totals.completionRate)],
    ["إعادة تعيين (إجمالي)", m.reassignments.total],
  ];
}

function bucketSheet(buckets: ManagementBucket[], groupLabel: string): Cell[][] {
  const rows: Cell[][] = [[groupLabel, "الموظف", "المعيّنة", "المكتملة", "الإنجاز٪"]];
  for (const b of buckets) {
    for (const e of b.employees) {
      rows.push([text(b.label), text(e.displayName), e.assigned, e.completed, pct(e.completionRate)]);
    }
    rows.push([`المجموع — ${text(b.label)}`, "", b.totalAssigned, b.totalCompleted, pct(b.completionRate)]);
  }
  if (buckets.length === 0) rows.push(["لا توجد بيانات توزيع بعد.", "", "", "", ""]);
  return rows;
}

function replacementsSheet(m: ManagementModel): Cell[][] {
  const rows: Cell[][] = [
    ["رقم الأشعة", "الموظف", "المنفذ", "السبب", "البديل", "آخر حدث"],
    ...m.replacements.records.map((r) => [
      text(r.xrayImageId), text(r.displayName), text(r.portName), text(r.reason), text(r.replacedById), text(r.lastEventAt),
    ]),
  ];
  if (m.replacements.byReason.length > 0) {
    rows.push([], ["— الأسباب الأكثر تكراراً —", "", "", "", "", ""], ["السبب", "العدد", "", "", "", ""]);
    for (const r of m.replacements.byReason) rows.push([text(r.reason), r.count, "", "", "", ""]);
  }
  return rows;
}

export function buildManagementWorkbookObject(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): XLSX.WorkBook {
  const empty: DistributionCurrentData = {
    monthFolderName: input.monthFolderName, derivedAt: "—",
    totalAssigned: 0, totalCompleted: 0, totalReplaced: 0, totalPending: 0, entries: [],
  };
  const model = computeManagementModel(
    input.distribution ?? empty,
    input.monthFolderName,
    employeeDisplayNames,
    input.distributionEvents ?? [],
    input.replacementReasons ?? {},
  );
  const wb = XLSX.utils.book_new();
  const append = (name: string, aoa: Cell[][]): void => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };
  append("الملخص الإداري", summarySheet(model));
  append("1 · حسب المستوى", bucketSheet(model.byStage, "المستوى"));
  append("2 · حسب المنفذ", bucketSheet(model.byPort, "المنفذ"));
  append("الاستبدال وإعادة التعيين", replacementsSheet(model));
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
