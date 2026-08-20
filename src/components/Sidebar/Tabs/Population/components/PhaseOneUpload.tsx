import { useState, type ChangeEvent, type DragEvent, type RefObject } from "react";
import { AlertTriangle, FileSpreadsheet, Plus, RefreshCw, X } from "lucide-react";
import FileUploadCard from "./FileUploadCard";
import { formatFileSize } from "./helpers";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiUploadEntry, BiWorkbookResult } from "../biData/biDataTypes";
import { MAX_BI_UPLOADS } from "../biData/biDataTypes";
import "./PhaseOneUpload.css";

type UploadKey = "riskAgencyData" | "businessIntelligenceData";

type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

/**
 * The risk-agency file stays a single, REQUIRED upload exactly as before. The
 * BI side became a list: multiple BI files are different populations that share
 * the same sheet patterns and column mappings, and they are appended into one
 * BI population (never deduplicated). Both the "N من 10" pill and the
 * accepted-rows total are derived from `biUploads` at render time.
 */
type PhaseOneUploads = {
  riskAgencyData: UploadState;
  biUploads: BiUploadEntry[];
};

type PhaseOneUploadProps = {
  uploads: PhaseOneUploads;
  uploadError: string;
  processingMessage: string;
  isProcessingWorkbooks: boolean;
  /**
   * B13: render-time gate for the file-picker cards — combines upload-data permission with
   * the closed-month and month-loading flags (index.tsx's canUploadNow), matching Phase 4's
   * canDistribute pattern. Threaded into FileUploadCard's real `disabled` prop (audit finding
   * 12 -- the previous wrapper-only `aria-disabled`/`pointer-events:none` styling blocked a
   * mouse click but left the buttons keyboard-focusable and activatable, and announced
   * nothing to assistive tech). The wrapper's `aria-disabled`/dimming stay as a visual/
   * semantic group-level cue; the buttons themselves now carry the real HTML `disabled`.
   * The denser BI controls follow the same rule: disabled, never hidden-but-focusable.
   */
  canUpload: boolean;
  riskAgencyInputRef: RefObject<HTMLInputElement | null>;
  businessIntelligenceInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (uploadKey: UploadKey) => void;
  onClearFile: (uploadKey: UploadKey) => void;
  onRemoveBiUpload: (id: string) => void;
  /** Owner request (2026-08-18): drag-and-drop onto either source card. */
  onDropFiles: (uploadKey: UploadKey, files: File[]) => void;
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

/** Fill `{name}` placeholders in a label value. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
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
  const labels = useLabels();
  // A merged multi-file BI result can carry the same sheet name more than once
  // (one per source file), so the React key has to include the file it came
  // from — and the array index too, because attaching the SAME file name twice
  // makes even that pair collide ("two children with the same key").
  const sheetKey = (sheet: { sheetName: string; sourceFileName?: string }, index: number) =>
    sheet.sourceFileName
      ? `${index}::${sheet.sourceFileName}::${sheet.sheetName}`
      : `${index}::${sheet.sheetName}`;

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
          {result.sheetSummaries.map((sheet, index) => (
            <span key={sheetKey(sheet, index)} className="raw-file-summary-sheet-chip">
              {sheet.sheetName}: {formatCount(sheet.normalizedRowCount)}
            </span>
          ))}
        </div>
      )}
      {result.sheetSummaries
        .map((sheet, index) => ({ sheet, index }))
        .filter(({ sheet }) => sheet.zeroIdDiagnostic)
        .map(({ sheet, index }) => (
          <p key={`${sheetKey(sheet, index)}-zero-id`} className="raw-file-summary-unknown" role="alert">
            تحذير: ورقة "{sheet.sheetName}" استبعدت كل صفوفها ({formatCount(sheet.originalRowCount)})
            بسبب عدم العثور على معرف أشعة. الأعمدة التي بحث عنها النظام:{" "}
            {sheet.zeroIdDiagnostic!.candidateHeaders.join("، ")}. الأعمدة الموجودة فعلياً في الورقة:{" "}
            {sheet.zeroIdDiagnostic!.presentHeaders.join("، ") || "لا توجد أعمدة"}.
            تحقّق من إعدادات تعيين الأعمدة (Mapping Settings) فقد تكون تشير إلى عمود غير موجود في هذه الورقة.
          </p>
        ))}
      {result.sheetSummaries
        .map((sheet, index) => ({ sheet, index }))
        .flatMap(({ sheet, index }) =>
          (sheet.duplicateHeaders ?? []).map((collision, collisionIndex) => (
            <p
              key={`${sheetKey(sheet, index)}-dup-${collisionIndex}`}
              className="raw-file-summary-unknown"
              role="alert"
            >
              {fill(labels.phase_one_duplicate_headers_warning, {
                sheet: sheet.sheetName,
                normalized: collision.normalized,
                originals: collision.originals.join("، ")
              })}
            </p>
          ))
        )}
      {result.unknownSheetNames.length > 0 && (
        <p className="raw-file-summary-unknown">
          أوراق غير معروفة (غير مدرجة في المجتمع): {result.unknownSheetNames.join("، ")}
        </p>
      )}
    </div>
  );
}

/**
 * Drop-target behaviour shared by both source cards. `preventDefault` on
 * dragover is what makes the element a legal drop target at all; the
 * `isDragOver` flag only drives the visual affordance. Files are handed to the
 * SAME appenders the picker uses, so cap/extension/permission rules apply
 * identically no matter how a file arrives.
 */
function useFileDropZone(disabled: boolean, onFiles: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragProps = {
    onDragOver: (event: DragEvent) => {
      if (disabled) return;
      event.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: (event: DragEvent) => {
      // Ignore bubbles from children still inside the zone.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setIsDragOver(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      onFiles(Array.from(event.dataTransfer?.files ?? []));
    },
  };
  return { isDragOver, dragProps };
}

/**
 * The BI source card: one row per attached file, an add-more zone that disables
 * at the cap, and a derived accepted-rows footer. Replaces the single-file
 * FileUploadCard that used to sit here (the risk card still uses it).
 */
function BiSourceCard({
  entries,
  canUpload,
  onPickFiles,
  onDropFiles,
  onRemove,
}: {
  entries: BiUploadEntry[];
  canUpload: boolean;
  onPickFiles: () => void;
  onDropFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const labels = useLabels();
  const isFull = entries.length >= MAX_BI_UPLOADS;
  const { isDragOver, dragProps } = useFileDropZone(!canUpload || isFull, onDropFiles);
  const remaining = Math.max(0, MAX_BI_UPLOADS - entries.length);
  // Derived, never stored: only files that actually reported a row count count.
  const acceptedTotal = entries.reduce((total, entry) => total + (entry.acceptedRows ?? 0), 0);

  return (
    <article
      className={`bi-source-card${isDragOver ? " is-drag-over" : ""}`}
      aria-disabled={!canUpload}
      {...dragProps}
    >
      <div className="bi-source-card-header">
        <div className="bi-source-card-heading">
          <div className="bi-source-card-title-row">
            <h3>{labels.phase_one_bi_title}</h3>
            <span className="bi-source-badge">{labels.phase_one_bi_optional_badge}</span>
          </div>
          <p>{labels.phase_one_bi_description}</p>
        </div>

        <span className="bi-source-count-pill">
          {fill(labels.phase_one_bi_count_pill, {
            count: formatCount(entries.length),
            max: formatCount(MAX_BI_UPLOADS),
          })}
        </span>
      </div>

      <div className="bi-file-table" role="table" aria-label={labels.phase_one_bi_list_aria}>
        <div className="bi-file-row is-head" role="row">
          <span role="columnheader">{labels.phase_one_bi_col_file}</span>
          <span role="columnheader">{labels.phase_one_bi_col_size}</span>
          <span role="columnheader">{labels.phase_one_bi_col_accepted}</span>
          <span role="columnheader" aria-hidden />
        </div>

        {entries.length === 0 ? (
          <p className="bi-file-empty">{labels.phase_one_bi_empty_list}</p>
        ) : (
          entries.map((entry) => {
            const isParsing = entry.state === "parsing";
            const isError = entry.state === "error";
            // PROD-1: a ready row can carry a non-blocking advisory (the file
            // imported, but its name matched no configured pattern). Amber, not
            // red — the rows ARE in the population.
            const isWarn = !isParsing && !isError && entry.warning !== undefined;
            const subLine = isParsing
              ? labels.phase_one_bi_parsing
              : isError
                ? (entry.error ?? labels.phase_one_bi_no_value)
                : isWarn
                  ? entry.warning!
                  : entry.sheetName;

            return (
              <div className="bi-file-row" role="row" key={entry.id}>
                <span className="bi-file-cell-name" role="cell">
                  <span
                    className={`bi-file-icon ${isParsing ? "is-parsing" : ""} ${isError ? "is-error" : ""} ${isWarn ? "is-warn" : ""}`}
                    aria-hidden
                  >
                    {isParsing ? (
                      <RefreshCw size={15} strokeWidth={1.8} />
                    ) : isError || isWarn ? (
                      <AlertTriangle size={15} strokeWidth={1.8} />
                    ) : (
                      <FileSpreadsheet size={15} strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="bi-file-cell-text">
                    <strong title={entry.file.name}>{entry.file.name}</strong>
                    <span
                      className={`bi-file-sheet ${isParsing ? "is-parsing" : ""} ${isError ? "is-error" : ""} ${isWarn ? "is-warn" : ""}`}
                      role={isError ? "alert" : isWarn ? "status" : undefined}
                      // The sub-line is 10.5px inside a 4-column grid row; a long
                      // message needs to be inspectable without a screenshot.
                      title={subLine}
                    >
                      {subLine}
                    </span>
                  </span>
                </span>

                <span className="bi-file-size" role="cell">
                  {formatFileSize(entry.sizeBytes)}
                </span>

                <span
                  className={`bi-file-accepted ${entry.acceptedRows === null ? "is-empty" : ""}`}
                  role="cell"
                >
                  {entry.acceptedRows === null
                    ? labels.phase_one_bi_no_value
                    : formatCount(entry.acceptedRows)}
                </span>

                <button
                  type="button"
                  className="bi-file-remove"
                  onClick={() => onRemove(entry.id)}
                  disabled={!canUpload}
                  title={labels.phase_one_bi_remove_file}
                  aria-label={`${labels.phase_one_bi_remove_file}: ${entry.file.name}`}
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Disabled at the cap, never hidden: a hidden-but-focusable control is
          exactly the accessibility failure audit finding 12 called out. */}
      <div className={`bi-add-zone ${isFull ? "is-full" : ""}`}>
        <span className="bi-add-zone-text">
          <span className="bi-add-zone-icon" aria-hidden>
            <Plus size={16} strokeWidth={2} />
          </span>
          <span className="bi-add-zone-lines">
            <strong>{labels.phase_one_bi_add_title}</strong>
            <span>
              {isFull
                ? fill(labels.phase_one_bi_cap_reached, { max: formatCount(MAX_BI_UPLOADS) })
                : fill(labels.phase_one_bi_add_hint, {
                    remaining: formatCount(remaining),
                    max: formatCount(MAX_BI_UPLOADS),
                  })}
            </span>
          </span>
        </span>

        <button
          type="button"
          className="bi-add-zone-button"
          onClick={onPickFiles}
          disabled={!canUpload || isFull}
        >
          {labels.phase_one_bi_add_button}
        </button>
      </div>

      <p className="bi-accepted-total">
        {labels.phase_one_bi_total_label} <strong>{formatCount(acceptedTotal)}</strong>
      </p>
    </article>
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
  onRemoveBiUpload,
  onDropFiles,
  onFallbackFileChange,
  riskWorkbookResult = null,
  biWorkbookResult = null
}: PhaseOneUploadProps) {
  // FileUploadCard is shared with other flows, so the risk side's drop target
  // is this thin wrapper rather than a change to the card itself.
  const riskDrop = useFileDropZone(!canUpload, (files) => onDropFiles("riskAgencyData", files));
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
        style={!canUpload ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
      >
        <div
          className={`risk-drop-wrap${riskDrop.isDragOver ? " is-drag-over" : ""}`}
          {...riskDrop.dragProps}
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
            disabled={!canUpload}
          />
        </div>

        <BiSourceCard
          entries={uploads.biUploads}
          canUpload={canUpload}
          onPickFiles={() => onPickFile("businessIntelligenceData")}
          onDropFiles={(files) => onDropFiles("businessIntelligenceData", files)}
          onRemove={onRemoveBiUpload}
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
        multiple
        accept=".xlsx,.xls,.csv"
        onChange={(event) =>
          onFallbackFileChange("businessIntelligenceData", event)
        }
      />
    </section>
  );
}
