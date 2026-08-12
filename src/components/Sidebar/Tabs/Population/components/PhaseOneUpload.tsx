import type { ChangeEvent, RefObject } from "react";
import FileUploadCard from "./FileUploadCard";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";

type UploadKey = "riskAgencyData" | "businessIntelligenceData";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

type PhaseOneUploadProps = {
  uploads: Record<UploadKey, UploadState>;
  uploadError: string;
  processingMessage: string;
  isProcessingWorkbooks: boolean;
  /**
   * B13: render-time gate for the file-picker cards — combines upload-data permission with
   * the closed-month and month-loading flags (index.tsx's canUploadNow), matching Phase 4's
   * canDistribute pattern. FileUploadCard has no `disabled` prop of its own (owned by a
   * different bucket), so the cards are visually + interactively disabled via a wrapper here
   * rather than by threading a new prop into FileUploadCard itself.
   */
  canUpload: boolean;
  riskAgencyInputRef: RefObject<HTMLInputElement | null>;
  businessIntelligenceInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (uploadKey: UploadKey) => void;
  onClearFile: (uploadKey: UploadKey) => void;
  onFallbackFileChange: (
    uploadKey: UploadKey,
    event: ChangeEvent<HTMLInputElement>
  ) => void;
  /**
   * W4/W10: once the workbook(s) are parsed (first "التالي" press — see
   * index.tsx's parsePhaseOneWorkbooks/moveToNextPhase), general information
   * read from the raw files is shown here, beneath the upload cards, before the
   * user presses "التالي" again to actually advance and process. Optional/null
   * before parsing (or for callers/tests that don't exercise this path).
   */
  riskWorkbookResult?: RiskWorkbookResult | null;
  biWorkbookResult?: BiWorkbookResult | null;
};

function formatCount(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

/** W4/W10: compact raw-file receipt — sheet/row counts read straight from the
 *  already-parsed workbook result, no extra reads or processing. */
function RawFileSummaryCard({
  title,
  result,
}: {
  title: string;
  result: RiskWorkbookResult | BiWorkbookResult;
}) {
  return (
    <div className="raw-file-summary-card">
      <strong>{title}</strong>
      <div className="raw-file-summary-stats">
        <span>الصفوف الأصلية: {formatCount(result.totalOriginalRows)}</span>
        <span>الصفوف المقبولة: {formatCount(result.totalNormalizedRows)}</span>
        <span>مستبعدة (بلا معرف أشعة): {formatCount(result.totalExcludedMissingXrayIdCount)}</span>
      </div>
      {result.sheetSummaries.length > 0 && (
        <div className="raw-file-summary-sheets">
          {result.sheetSummaries.map((sheet) => (
            <span key={sheet.sheetName} className="raw-file-summary-sheet-chip">
              {sheet.sheetName}: {formatCount(sheet.normalizedRowCount)}
            </span>
          ))}
        </div>
      )}
      {result.sheetSummaries
        .filter((sheet) => sheet.zeroIdDiagnostic)
        .map((sheet) => (
          <p key={`${sheet.sheetName}-zero-id`} className="raw-file-summary-unknown" role="alert">
            تحذير: ورقة "{sheet.sheetName}" استبعدت كل صفوفها ({formatCount(sheet.originalRowCount)})
            بسبب عدم العثور على معرف أشعة. الأعمدة التي بحث عنها النظام:{" "}
            {sheet.zeroIdDiagnostic!.candidateHeaders.join("، ")}. الأعمدة الموجودة فعلياً في الورقة:{" "}
            {sheet.zeroIdDiagnostic!.presentHeaders.join("، ") || "لا توجد أعمدة"}.
            تحقّق من إعدادات تعيين الأعمدة (Mapping Settings) فقد تكون تشير إلى عمود غير موجود في هذه الورقة.
          </p>
        ))}
      {result.unknownSheetNames.length > 0 && (
        <p className="raw-file-summary-unknown">
          أوراق غير معروفة (غير مدرجة في المجتمع): {result.unknownSheetNames.join("، ")}
        </p>
      )}
    </div>
  );
}

const RISK_AGENCY_INFO_ITEMS = [
  "هذا هو الملف الأساسي المطلوب للانتقال إلى المعالجة.",
  "يتم قراءة ملف Excel كملف خام وليس كجداول Excel، لأن البيانات لا تأتي داخل Table.",
  "يتم التعامل مع أول صف في كل ورقة على أنه صف العناوين، وتبدأ البيانات من الصف الثاني.",
  "يتم حذف الأعمدة الفارغة والصفوف الفارغة قبل أي عملية تطبيع أو دمج.",
  "يتعرف النظام على الأوراق المعروفة مثل: بري، بحري، افراد، وعبور.",
  "أي ورقة غير معروفة يتم تسجيلها في التقرير ولا تدخل في المجتمع النهائي.",
  "يتم توحيد أسماء الأعمدة المختلفة في الأوراق إلى نموذج موحد.",
  "بعد التوحيد، يتم إلحاق جميع الأوراق المعروفة في مجتمع واحد.",
  "يتم استبعاد أي صف لا يحتوي على معرف أشعة، لأن معرف الأشعة هو الحد الأدنى لقبول الصف ضمن مجتمع المعالجة."
];

const BI_INFO_ITEMS = [
  "هذا الملف داعم وليس شرطاً للانتقال إلى مرحلة المعالجة.",
  "إذا تم رفعه، سيقرأ النظام أوراق بحري وارد، بري وارد، بحري صادر، وبري صادر.",
  "يتم التعامل مع أول صف في كل ورقة على أنه صف العناوين.",
  "يتم حذف الأعمدة والصفوف الفارغة قبل التوحيد.",
  "يتم توحيد الأعمدة المختلفة مثل معرف الأشعة، رقم صورة الأشعة، وXRAY_SCAN_ID في حقل موحد.",
  "سيتم استخدام هذا الملف لاحقاً في تعبئة الخانات الفارغة فقط عند وجود تطابق بين معرف الأشعة واسم المنفذ.",
  "عدم رفع هذا الملف لا يمنع تكوين مجتمع وكالة المخاطر ولا يمنع عرض التقرير الأساسي."
];

export default function PhaseOneUpload({
  uploads,
  uploadError,
  processingMessage,
  isProcessingWorkbooks,
  canUpload,
  riskAgencyInputRef,
  businessIntelligenceInputRef,
  onPickFile,
  onClearFile,
  onFallbackFileChange,
  riskWorkbookResult = null,
  biWorkbookResult = null
}: PhaseOneUploadProps) {
  return (
    <section className="upload-phase" aria-label="رفع البيانات">
      <div className="phase-panel-header">
        <div>
          <h2>المرحلة 1: رفع البيانات</h2>
          <p>
            ملف وكالة المخاطر هو الملف الأساسي المطلوب. ملف ذكاء الأعمال داعم
            ويمكن رفعه الآن أو إضافته لاحقاً حسب منطق المعالجة.
          </p>
        </div>
      </div>

      <div
        className="upload-grid"
        aria-disabled={!canUpload}
        title={!canUpload ? "لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل." : undefined}
        style={!canUpload ? { opacity: 0.55, pointerEvents: "none", cursor: "not-allowed" } : undefined}
      >
        <FileUploadCard
          title="بيانات وكالة المخاطر"
          description="ملف أساسي يحتوي على أوراق بري، بحري، افراد، وعبور."
          uploadState={uploads.riskAgencyData}
          onPickFile={() => onPickFile("riskAgencyData")}
          onClearFile={() => onClearFile("riskAgencyData")}
          infoTitle="آلية معالجة بيانات وكالة المخاطر"
          infoContent={RISK_AGENCY_INFO_ITEMS}
          isRequired
        />

        <FileUploadCard
          title="بيانات ذكاء الأعمال"
          description="ملف داعم يحتوي على أوراق بحري وارد، بري وارد، بحري صادر، وبري صادر."
          uploadState={uploads.businessIntelligenceData}
          onPickFile={() => onPickFile("businessIntelligenceData")}
          onClearFile={() => onClearFile("businessIntelligenceData")}
          infoTitle="آلية معالجة بيانات ذكاء الأعمال"
          infoContent={BI_INFO_ITEMS}
        />
      </div>

      {uploadError ? (
        <div className="upload-error" role="alert">
          {uploadError}
        </div>
      ) : null}

      {processingMessage ? (
        <div className="upload-warning" role="status">
          {processingMessage}
        </div>
      ) : null}

      {isProcessingWorkbooks ? (
        <div className="processing-note" role="status">
          جاري قراءة الملفات وتحضير التقرير المصغر...
        </div>
      ) : null}

      {/* W4/W10: general information from the raw files, shown beneath the
          sources once parsed — before the user presses "التالي" again to
          process and move on to the comparison. */}
      {(riskWorkbookResult || biWorkbookResult) && !isProcessingWorkbooks ? (
        <div className="raw-file-summary-section" aria-label="معلومات عامة عن الملفات المرفوعة">
          <h3>معلومات عامة عن الملفات المرفوعة</h3>
          <div className="raw-file-summary-grid">
            {riskWorkbookResult && (
              <RawFileSummaryCard title="بيانات وكالة المخاطر" result={riskWorkbookResult} />
            )}
            {biWorkbookResult && (
              <RawFileSummaryCard title="بيانات ذكاء الأعمال" result={biWorkbookResult} />
            )}
          </div>
          <p className="raw-file-summary-hint">
            اضغط "التالي" مرة أخرى لمعالجة المجتمع وعرض تقرير المقارنة.
          </p>
        </div>
      ) : null}

      <input
        ref={riskAgencyInputRef}
        className="hidden-file-input"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) => onFallbackFileChange("riskAgencyData", event)}
      />

      <input
        ref={businessIntelligenceInputRef}
        className="hidden-file-input"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) =>
          onFallbackFileChange("businessIntelligenceData", event)
        }
      />
    </section>
  );
}
