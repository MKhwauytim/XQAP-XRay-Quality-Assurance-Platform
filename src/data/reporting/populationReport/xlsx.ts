// xlsx edition of تقرير المجتمع. No visual/escaping concerns here — SheetJS
// cells are data, not rendered HTML, so unlike deck.ts/document.ts there is
// no XSS surface to guard against. STAGE_LABELS is imported from fold.ts
// (not redeclared) — deck.ts and document.ts already share that import.
import * as XLSX from "xlsx";
import { computePopulationReportModel } from "./model";
import type { PopulationReportInput, PopulationReportModel } from "./model";
import { STAGE_LABELS } from "./fold";
import type { PopulationReportScope } from "./types";
import { hasSourceRevisions, sourceRevisionsSheetAoa, SOURCE_REVISIONS_SHEET_NAME_AR } from "../sourceRevisions";

function stageSheetRows(model: PopulationReportModel, source: "reconciled" | "sample") {
  const bucket = model[source];
  return [
    ...bucket.byStage.map((b) => ({ المرحلة: b.stageLabel, الإجمالي: b.counts.total, سليمة: b.counts.سليمة, اشتباه: b.counts.اشتباه })),
    { المرحلة: "الإجمالي", الإجمالي: bucket.totals.total, سليمة: bucket.totals.سليمة, اشتباه: bucket.totals.اشتباه },
  ];
}

function portSheetRows(model: PopulationReportModel, source: "reconciled" | "sample") {
  const { land, sea } = model[source].byPort;
  return [
    ...land.map((p) => ({ المنفذ: p.portName, النوع: "بري", الإجمالي: p.counts.total, سليمة: p.counts.سليمة, اشتباه: p.counts.اشتباه })),
    ...sea.map((p) => ({ المنفذ: p.portName, النوع: "بحري", الإجمالي: p.counts.total, سليمة: p.counts.سليمة, اشتباه: p.counts.اشتباه })),
  ];
}

export async function buildPopulationXlsx(
  input: PopulationReportInput,
  scope: PopulationReportScope = "both"
): Promise<void> {
  const model = computePopulationReportModel(input);
  const wb = XLSX.utils.book_new();

  if (scope !== "sample") {
    const receiptRows = [
      { المصدر: "بيانات المخاطر (Risk)", "إجمالي الصفوف الخام": model.reconciled.riskRawRowCount },
      { المصدر: "بيانات معلومات الأعمال (BI)", "إجمالي الصفوف الخام": model.reconciled.biRawRowCount ?? "لم يتم التوفير" },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receiptRows), "الاستلام");

    const summary = model.reconciled.processingSummary;
    const riskRows = summary
      ? [
          {
            "الصفوف الأصلية": summary.riskOriginalRows,
            "معرّفات صحيحة": summary.validRiskIdRows,
            "معرّفات غير صحيحة": summary.invalidRiskIdRows,
            "بعد إزالة التكرار": summary.rowsAfterDeduplication,
            "نتائج غير صحيحة محذوفة": summary.removedInvalidResultRows,
            "المجتمع النهائي": summary.finalPreparedPopulationRows,
          },
        ]
      : [];
    if (riskRows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riskRows), "المخاطر - قبل وبعد");
    }

    const biRows = summary?.biProvided
      ? summary.biFieldFillSummary.map((f) => ({
          الحقل: f.fieldName,
          "فارغ قبل": f.riskEmptyBefore,
          "تمت التعبئة": f.filledFromBi,
          "لا يزال فارغًا": f.stillEmptyAfter,
          "نسبة التعبئة": f.fillPercentage,
        }))
      : [];
    if (biRows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(biRows), "BI - قبل وبعد");
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stageSheetRows(model, "reconciled")), "المجتمع - المرحلة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(portSheetRows(model, "reconciled")), "المجتمع - المنفذ");
  }

  if (scope !== "population") {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stageSheetRows(model, "sample")), "العينة - المرحلة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(portSheetRows(model, "sample")), "العينة - المنفذ");

    const employeeStageRows = model.distribution.byEmployeeStage.map((emp) => {
      const record: Record<string, string | number> = { الموظف: emp.displayName };
      for (const key of model.distribution.stageKeysPresent) {
        const c = emp.stages[key] ?? { سليمة: 0, اشتباه: 0, total: 0 };
        record[`${STAGE_LABELS[key] ?? key} - الإجمالي`] = c.total;
        record[`${STAGE_LABELS[key] ?? key} - سليمة`] = c.سليمة;
        record[`${STAGE_LABELS[key] ?? key} - اشتباه`] = c.اشتباه;
      }
      record["الإجمالي"] = emp.total.total;
      return record;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeeStageRows), "التوزيع - الموظف والمرحلة");

    const employeePortRows = model.distribution.byEmployeePort.map((emp) => ({
      الموظف: emp.displayName,
      "برية - الإجمالي": emp.ports.land.total,
      "برية - سليمة": emp.ports.land.سليمة,
      "برية - اشتباه": emp.ports.land.اشتباه,
      "بحرية - الإجمالي": emp.ports.sea.total,
      "بحرية - سليمة": emp.ports.sea.سليمة,
      "بحرية - اشتباه": emp.ports.sea.اشتباه,
      الإجمالي: emp.total.total,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeePortRows), "التوزيع - الموظف والمنفذ");

    const certScanRows = model.distribution.certScanByEmployee.map((emp) => ({
      الموظف: emp.displayName,
      CertScan: emp.certScanCount,
      "غير CertScan": emp.nonCertScanCount,
      الإجمالي: emp.total,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(certScanRows), "التوزيع - CertScan");
  }

  if (hasSourceRevisions(input.sourceRevisions)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sourceRevisionsSheetAoa(input.sourceRevisions)),
      SOURCE_REVISIONS_SHEET_NAME_AR
    );
  }

  XLSX.writeFile(wb, `تقرير_المجتمع_${input.monthFolderName}.xlsx`);
}
