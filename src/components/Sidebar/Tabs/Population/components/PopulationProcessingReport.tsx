import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ProcessingSummary, RemovedPopulationRow } from "../processing/populationProcessingTypes";
import { formatNumber, formatPercentage } from "./helpers";
import SummaryCard from "./SummaryCard";

/** The handful of preview-row fields this component's table actually renders —
 *  intentionally narrower than `PreparedPopulationRow` so both a live, freshly
 *  processed result AND a locked month's persisted aggregate (which only ever
 *  carries this stub, see `POPULATION_AGGREGATE_PREVIEW_FIELDS`) can feed it. */
export type PopulationReportPreviewRow = {
  xrayImageId: string;
  sourceRowNumber: number;
  portName: string | null;
  stage: string | null;
  xrayLevelOneResult: string;
  xrayLevelTwoResult: string;
  certScanStatus: string;
};

type PopulationProcessingReportProps = {
  summary: ProcessingSummary;
  previewRows: PopulationReportPreviewRow[];
  /** W8: per-row detail for excluded-during-processing rows, previously only
   *  reachable via the removed "تقرير المعالجة" HTML export (which never actually
   *  showed per-row detail — only aggregate counts). Sourced directly from the
   *  in-memory processing result, no extra reads. Undefined for a locked month
   *  rendered from `populationAggregate` (which never carries these lists) —
   *  the section renders nothing in that case. */
  removedRows?: RemovedPopulationRow[];
  duplicateRows?: RemovedPopulationRow[];
  invalidResultRows?: RemovedPopulationRow[];
};

const DROPPED_ROWS_DISPLAY_CAP = 50;

function droppedRowKey(droppedRow: RemovedPopulationRow, index: number): string {
  return `${droppedRow.xrayImageId ?? "—"}-${droppedRow.sourceRowNumber ?? index}-${index}`;
}

/** W8: collapsible per-row drill-down for one exclusion category (invalid ID,
 *  duplicate, invalid level result). Renders nothing when there are no rows. */
function DroppedRowsCategory({ title, rows }: { title: string; rows: RemovedPopulationRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, DROPPED_ROWS_DISPLAY_CAP);
  const extra = rows.length - shown.length;
  return (
    <div className="dropped-rows-category">
      <button
        type="button"
        className="dropped-rows-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="dropped-rows-count">{formatNumber(rows.length)}</span>
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div className="dropped-rows-table" role="table">
          <div className="dropped-rows-row dropped-rows-header" role="row">
            <span>معرف الأشعة</span>
            <span>اسم المنفذ</span>
            <span>رقم الصف المصدر</span>
            <span>الورقة المصدر</span>
            <span>السبب</span>
          </div>
          {shown.map((droppedRow, index) => (
            <div key={droppedRowKey(droppedRow, index)} className="dropped-rows-row" role="row">
              <span>{droppedRow.xrayImageId ?? "—"}</span>
              <span>{droppedRow.portName ?? "—"}</span>
              <span>{droppedRow.sourceRowNumber ?? "—"}</span>
              <span>{droppedRow.sourceSheetName ?? "—"}</span>
              <span>{droppedRow.reason}</span>
            </div>
          ))}
          {extra > 0 && (
            <p className="dropped-rows-more">+{formatNumber(extra)} صفاً إضافياً — التصدير الكامل متاح عبر زر تصدير Excel أعلاه.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** W8: wraps the three exclusion categories; renders nothing when nothing was excluded. */
function DroppedRowsSection({
  removedRows,
  duplicateRows,
  invalidResultRows,
}: {
  removedRows?: RemovedPopulationRow[];
  duplicateRows?: RemovedPopulationRow[];
  invalidResultRows?: RemovedPopulationRow[];
}) {
  const hasAny =
    (removedRows?.length ?? 0) + (duplicateRows?.length ?? 0) + (invalidResultRows?.length ?? 0) > 0;
  if (!hasAny) return null;
  return (
    <div className="dropped-rows-section">
      <h4>تفاصيل الصفوف المستبعدة</h4>
      <DroppedRowsCategory title="معرفات غير صالحة" rows={removedRows ?? []} />
      <DroppedRowsCategory title="مكررات مستبعدة" rows={duplicateRows ?? []} />
      <DroppedRowsCategory title="نتائج مستوى غير صالحة" rows={invalidResultRows ?? []} />
    </div>
  );
}

export default function PopulationProcessingReport({
  summary,
  removedRows,
  duplicateRows,
  invalidResultRows,
}: PopulationProcessingReportProps) {

  const totalExcludedAfterProcessing =
    summary.duplicateRiskIdRows +
    summary.removedInvalidResultRows +
    summary.invalidRiskIdRows;

  return (
    <section className="population-processing-result">
      <div className="processing-summary-grid">
        <SummaryCard
          label="المجتمع النهائي"
          value={summary.finalPreparedPopulationRows}
        />

        <SummaryCard
          label="إجمالي المستبعد بعد المعالجة"
          value={totalExcludedAfterProcessing}
        />

        <SummaryCard
          label="المكررات المستبعدة"
          value={summary.duplicateRiskIdRows}
        />

        <SummaryCard
          label="نتائج غير صالحة"
          value={summary.removedInvalidResultRows}
        />

        <SummaryCard label="CertScan" value={summary.certScanRows} />
        <SummaryCard label="NonCertScan" value={summary.nonCertScanRows} />
        <SummaryCard label="مطابقة BI" value={summary.biMatchedRows} />
        <SummaryCard label="تعبئة من BI" value={summary.totalBiFilledFields} />

        <SummaryCard
          label="معرفات غير صالحة"
          value={summary.invalidRiskIdRows}
        />
      </div>

      <div className="processing-detail-grid">
        <article className="processing-detail-card">
          <h4>نسب CertScan</h4>
          <p>CertScan: {formatPercentage(summary.certScanPercentage)}</p>
          <p>NonCertScan: {formatPercentage(summary.nonCertScanPercentage)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>مطابقة ذكاء الأعمال</h4>
          <p>تم رفع BI: {summary.biProvided ? "نعم" : "لا"}</p>
          <p>نسبة المطابقة: {formatPercentage(summary.biMatchPercentage)}</p>
          <p>غير مطابق: {formatNumber(summary.biUnmatchedRows)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>تنظيف بيانات وكالة المخاطر</h4>
          <p>الأصلية: {formatNumber(summary.riskOriginalRows)}</p>
          <p>بعد حذف المكررات: {formatNumber(summary.rowsAfterDeduplication)}</p>
          <p>النهائية: {formatNumber(summary.finalPreparedPopulationRows)}</p>
        </article>
      </div>

      <div className="bi-fill-summary-section">
        <h4>ملخص تعبئة الخانات من BI</h4>

        <div className="bi-fill-summary-table">
          <div className="bi-fill-summary-header">
            <span>العمود</span>
            <span>فارغ قبل BI</span>
            <span>تمت تعبئته</span>
            <span>بقي فارغاً</span>
            <span>نسبة التعبئة</span>
          </div>

          {summary.biFieldFillSummary.map((field) => (
            <div key={field.fieldName} className="bi-fill-summary-row">
              <span>{field.fieldName}</span>
              <span>{formatNumber(field.riskEmptyBefore)}</span>
              <span>{formatNumber(field.filledFromBi)}</span>
              <span>{formatNumber(field.stillEmptyAfter)}</span>
              <span>{formatPercentage(field.fillPercentage)}</span>
            </div>
          ))}
        </div>
      </div>

      <DroppedRowsSection
        removedRows={removedRows}
        duplicateRows={duplicateRows}
        invalidResultRows={invalidResultRows}
      />
    </section>
  );
}
