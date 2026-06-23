import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import { formatNumber, formatPercentage } from "./helpers";
import SummaryCard from "./SummaryCard";

type PopulationProcessingReportProps = {
  result: PopulationProcessingResult;
};

export default function PopulationProcessingReport({
  result
}: PopulationProcessingReportProps) {
  const summary = result.summary;
  const previewRows = result.preparedRows.slice(0, 10);

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

      <div className="prepared-preview-section">
        <h4>معاينة المجتمع النهائي</h4>

        {previewRows.length > 0 ? (
          <div className="prepared-preview-table">
            <div className="prepared-preview-header">
              <span>معرف الأشعة</span>
              <span>اسم المنفذ</span>
              <span>المستوى</span>
              <span>المستوى الأول</span>
              <span>المستوى الثاني</span>
              <span>CertScan</span>
            </div>

            {previewRows.map((row) => (
              <div
                key={`${row.xrayImageId}-${row.sourceRowNumber}`}
                className="prepared-preview-row"
              >
                <span>{row.xrayImageId}</span>
                <span>{row.portName ?? ""}</span>
                <span>{row.stage ?? ""}</span>
                <span>{row.xrayLevelOneResult}</span>
                <span>{row.xrayLevelTwoResult}</span>
                <span>{row.certScanStatus}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="processing-placeholder">
            <p>لا توجد صفوف نهائية بعد تطبيق شروط المعالجة.</p>
          </div>
        )}
      </div>
    </section>
  );
}
