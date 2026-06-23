import {
  createEmptyStageCounts,
  formatNumber,
  type MiniReportData
} from "./helpers";
import SummaryCard from "./SummaryCard";

type MiniWorkbookReportProps = {
  report: MiniReportData;
};

type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
  unknown: number;
};

export default function MiniWorkbookReport({ report }: MiniWorkbookReportProps) {
  const isNotProvided = report.status === "not-provided";
  const hasStageCounts = report.sheets.some(
    (sheet) => sheet.stageCounts !== null
  );

  const totalStageCounts = report.sheets.reduce<StageCounts>(
    (totals, sheet) => {
      const stageCounts = sheet.stageCounts ?? createEmptyStageCounts();

      return {
        first: totals.first + stageCounts.first,
        second: totals.second + stageCounts.second,
        third: totals.third + stageCounts.third,
        fourth: totals.fourth + stageCounts.fourth,
        unknown: totals.unknown + stageCounts.unknown
      };
    },
    createEmptyStageCounts()
  );

  const tableTotals = report.sheets.reduce(
    (totals, sheet) => ({
      originalRowCount: totals.originalRowCount + sheet.originalRowCount,
      normalizedRowCount: totals.normalizedRowCount + sheet.normalizedRowCount,
      excludedMissingXrayIdCount:
        totals.excludedMissingXrayIdCount + sheet.excludedMissingXrayIdCount
    }),
    {
      originalRowCount: 0,
      normalizedRowCount: 0,
      excludedMissingXrayIdCount: 0
    }
  );

  return (
    <article className={`report-card ${isNotProvided ? "muted" : ""}`}>
      <header className="report-card-header">
        <div>
          <h3>{report.title}</h3>
          <p>{report.description}</p>
        </div>

        <span className={`report-status ${isNotProvided ? "muted" : "ok"}`}>
          {isNotProvided ? "اختياري" : "تمت القراءة"}
        </span>
      </header>

      {isNotProvided ? (
        <div className="report-empty-state">
          <p>لم يتم رفع هذا الملف. يمكن المتابعة بملف وكالة المخاطر فقط.</p>
        </div>
      ) : (
        <>
          <div className="report-totals">
            <SummaryCard label="الأصلية" value={report.totalOriginalRows} />
            <SummaryCard
              label="المقبولة قبل المعالجة"
              value={report.totalNormalizedRows}
            />
            <SummaryCard
              label="المستبعدة عند القراءة"
              value={report.totalExcludedMissingXrayIdCount}
            />
            <SummaryCard label="الأوراق" value={report.sheets.length} />
          </div>

          {hasStageCounts ? (
            <div className="report-sheet-table stage-report-table" role="table">
              <div className="report-sheet-header stage-report-row" role="row">
                <span>الورقة</span>
                <span>المستوى الأول</span>
                <span>المستوى الثاني</span>
                <span>المستوى الثالث</span>
                <span>المستوى الرابع</span>
                <span>غير محدد</span>
                <span>إجمالي الصفوف المقبولة</span>
              </div>

              {report.sheets.map((sheet) => {
                const stageCounts =
                  sheet.stageCounts ?? createEmptyStageCounts();

                return (
                  <div
                    key={sheet.sheetName}
                    className="report-sheet-row stage-report-row"
                    role="row"
                  >
                    <span>{sheet.sheetName}</span>
                    <span>{formatNumber(stageCounts.first)}</span>
                    <span>{formatNumber(stageCounts.second)}</span>
                    <span>{formatNumber(stageCounts.third)}</span>
                    <span>{formatNumber(stageCounts.fourth)}</span>
                    <span>{formatNumber(stageCounts.unknown)}</span>
                    <span>{formatNumber(sheet.normalizedRowCount)}</span>
                  </div>
                );
              })}

              <div
                className="report-sheet-row stage-report-row report-total-row"
                role="row"
              >
                <span>المجموع</span>
                <span>{formatNumber(totalStageCounts.first)}</span>
                <span>{formatNumber(totalStageCounts.second)}</span>
                <span>{formatNumber(totalStageCounts.third)}</span>
                <span>{formatNumber(totalStageCounts.fourth)}</span>
                <span>{formatNumber(totalStageCounts.unknown)}</span>
                <span>{formatNumber(report.totalNormalizedRows)}</span>
              </div>
            </div>
          ) : (
            <div className="report-sheet-table" role="table">
              <div className="report-sheet-header standard-report-row" role="row">
                <span>الورقة</span>
                <span>الأصلية</span>
                <span>المقبولة قبل المعالجة</span>
                <span>المستبعدة عند القراءة</span>
              </div>

              {report.sheets.map((sheet) => (
                <div
                  key={sheet.sheetName}
                  className="report-sheet-row standard-report-row"
                  role="row"
                >
                  <span>{sheet.sheetName}</span>
                  <span>{formatNumber(sheet.originalRowCount)}</span>
                  <span>{formatNumber(sheet.normalizedRowCount)}</span>
                  <span>{formatNumber(sheet.excludedMissingXrayIdCount)}</span>
                </div>
              ))}

              <div
                className="report-sheet-row standard-report-row report-total-row"
                role="row"
              >
                <span>المجموع</span>
                <span>{formatNumber(tableTotals.originalRowCount)}</span>
                <span>{formatNumber(tableTotals.normalizedRowCount)}</span>
                <span>{formatNumber(tableTotals.excludedMissingXrayIdCount)}</span>
              </div>
            </div>
          )}

          {report.unknownSheetNames.length > 0 ? (
            <div className="unknown-sheets-warning" role="status">
              <h4>أوراق لم يتم التعرف عليها</h4>
              <p>{report.unknownSheetNames.join("، ")}</p>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
