import type { ChangeEvent, RefObject } from "react";
import FileUploadCard from "./FileUploadCard";

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
};

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
  onFallbackFileChange
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
