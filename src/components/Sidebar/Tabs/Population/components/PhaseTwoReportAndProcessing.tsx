import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import type { SafeWriteProgressPhase } from "../../../../../data/storage/safeWrite";
import type { PopulationAggregateLoadResult } from "../../../../../data/population/populationAggregate";
import { useLabels } from "../../../../../data/labels/useLabels";
import DataAccuracyReport from "./DataAccuracyReport";
import PopulationProcessingReport from "./PopulationProcessingReport";
import { AlertTriangle, Check, FolderOpen, Lock, X } from "lucide-react";
import CertScanMatchPreviewPanel from "./CertScanMatchPreviewPanel";

type SaveMessage = { type: "ok" | "error"; text: string } | null;

// B task 2: Arabic label per safeWriteJson phase, shown while the auto-save is
// past processPopulation's own 100% and into the (previously invisible)
// multi-pass disk write for population.final.json.
const SAVE_PROGRESS_LABELS: Record<SafeWriteProgressPhase, string> = {
  "backing-up": "جاري نسخ النسخة الاحتياطية...",
  staging: "جاري تجهيز الملف الجديد...",
  "verifying-staged": "جاري التحقق من الملف المُجهّز...",
  committing: "جاري كتابة الملف النهائي على القرص...",
  "verifying-committed": "جاري التحقق النهائي من الملف المحفوظ...",
};

type PhaseTwoReportAndProcessingProps = {
  riskWorkbookResult: RiskWorkbookResult | null;
  biWorkbookResult: BiWorkbookResult | null;
  processingMessage: string;
  certScanPasteText: string;
  populationProcessingResult: PopulationProcessingResult | null;
  isProcessingPopulation: boolean;
  processingProgressMessage?: string;
  processingProgressPercent?: number;
  monthLabel: string;
  isSavingToDisk: boolean;
  /** B task 2: current safeWriteJson phase for the in-flight auto-save, or null
   *  when not saving / not yet reported. Optional so existing callers/tests that
   *  don't pass it keep working (falls back to the generic "saving" message). */
  saveProgressPhase?: SafeWriteProgressPhase | null;
  saveToDiskMessage: SaveMessage;
  hasDiskWorkspace: boolean;
  /** B13: render-time gate for the process button — process-population permission combined
   *  with the closed-month and month-loading flags (index.tsx's canProcessNow), matching
   *  Phase 4's canDistribute pattern. */
  canProcess: boolean;
  /** B13: render-time gate for the export buttons — export-reports permission combined with
   *  the month-loading flag (index.tsx's canExportNow; export does not write to the
   *  workspace so it is not gated on closed-month, matching handleExportPopulation's
   *  existing handler-side check). */
  canExport: boolean;
  /** True once the month is locked (owner requirement) — population.final.json/
   *  risk.raw.json/bi.raw.json were deliberately never re-read; the processing
   *  report below renders from `populationAggregate` instead. */
  populationLocked?: boolean;
  /** The persisted aggregate for a locked month, or null while unlocked/not yet loaded. */
  populationAggregate?: PopulationAggregateLoadResult | null;
  onProcessPopulation: () => void;
  onExportPopulation: () => void;
};

export default function PhaseTwoReportAndProcessing({
  riskWorkbookResult,
  biWorkbookResult,
  processingMessage,
  certScanPasteText,
  populationProcessingResult,
  isProcessingPopulation,
  processingProgressMessage,
  processingProgressPercent = 0,
  monthLabel,
  isSavingToDisk,
  saveProgressPhase = null,
  saveToDiskMessage,
  hasDiskWorkspace,
  canProcess,
  canExport,
  populationLocked = false,
  populationAggregate = null,
  onProcessPopulation,
  onExportPopulation,
}: PhaseTwoReportAndProcessingProps) {
  const labels = useLabels();

  // Show placeholder only when there is absolutely nothing to display —
  // a locked month with an aggregate loaded counts as "something to display".
  if (!riskWorkbookResult && !populationProcessingResult && !(populationLocked && populationAggregate?.status === "ok")) {
    return (
      <section className="placeholder-phase">
        <h2>تقرير البيانات والمعالجة</h2>
        {populationLocked && populationAggregate && populationAggregate.status !== "ok" ? (
          <div className="upload-warning" role="alert">
            <Lock size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
            {populationAggregate.status === "corrupt"
              ? labels.population_locked_summary_corrupt
              : labels.population_locked_summary_missing}
          </div>
        ) : (
          <p>لم يتم تجهيز التقرير المصغر بعد.</p>
        )}
      </section>
    );
  }

  const loadedFromDisk = !riskWorkbookResult && (populationProcessingResult !== null || populationLocked);
  const hasBi = riskWorkbookResult !== null && biWorkbookResult !== null;
  // W-owner-2026-08-12: the live (freshly processed) path passes the FULL
  // in-memory preparedRows array rather than a fixed slice -- it costs nothing
  // extra (preparedRows already exists in memory from processing) and lets
  // PopulationProcessingReport paginate through it 10 rows at a time. The
  // locked-month aggregate path stays capped at its persisted 10 rows
  // (`PREVIEW_ROW_COUNT` in populationAggregate.ts) -- that snapshot is written
  // to disk specifically so a locked month never has to re-read the full
  // population, so there is no larger array available to page through there.
  const reportData = populationProcessingResult
    ? { summary: populationProcessingResult.summary, previewRows: populationProcessingResult.preparedRows }
    : populationLocked && populationAggregate?.status === "ok"
      ? { summary: populationAggregate.aggregate.summary, previewRows: populationAggregate.aggregate.previewRows }
      : null;

  return (
    <section className="report-processing-phase" aria-label="تقرير البيانات والمعالجة">

      {/* ── Header: title + month picker + save ── */}
      <div className="phase2-header-row">
        <div className="phase2-header-text">
          <h2>المرحلة 2: تقرير البيانات والمعالجة</h2>
          <p>مقارنة دقة البيانات بين وكالة المخاطر و BI، ثم معالجة وحفظ المجتمع.</p>
        </div>

        {hasDiskWorkspace && (
          <div className="phase2-save-panel">
            <span className="phase2-month-label">شهر الحفظ</span>
            <strong className="phase2-month-current">{monthLabel}</strong>
            {isSavingToDisk && (
              <span className="phase2-save-msg" role="status">
                ⏳ {saveProgressPhase ? SAVE_PROGRESS_LABELS[saveProgressPhase] : "جاري الحفظ التلقائي..."}
              </span>
            )}
            {saveToDiskMessage && !isSavingToDisk && (
              <span
                className={`phase2-save-msg ${saveToDiskMessage.type === "ok" ? "ok" : "err"}`}
                role="status"
              >
                {saveToDiskMessage.type === "ok"
                  ? <><Check size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> حُفظ تلقائياً</>
                  : <><X size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> {saveToDiskMessage.text}</>}
              </span>
            )}
          </div>
        )}
      </div>

      {processingMessage && (
        <div className="upload-warning" role="status">{processingMessage}</div>
      )}

      {/* ── Step A: Data Accuracy Report ── */}
      <div className="phase2-substep">
        <div className="phase2-substep-header">
          <div className="phase2-substep-badge">أ</div>
          <div>
            <h3>مقارنة دقة البيانات</h3>
            <p>مطابقة بيانات وكالة المخاطر مع بيانات BI عمود بعمود باستخدام معرف الأشعة.</p>
          </div>
        </div>

        {loadedFromDisk ? (
          <div className="dar-disk-banner" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <FolderOpen size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>تم تحميل هذا الشهر من القرص — البيانات الأصلية غير متاحة في الجلسة الحالية.
            لعرض تقرير دقة البيانات، ارفع ملفَي وكالة المخاطر و BI من المرحلة الأولى.</span>
          </div>
        ) : !hasBi ? (
          <div className="dar-no-bi" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>لم يتم رفع ملف BI — مقارنة الدقة غير متاحة. رفع ملف BI في المرحلة الأولى يتيح تقرير الدقة الكامل.</span>
          </div>
        ) : riskWorkbookResult && biWorkbookResult ? (
          <DataAccuracyReport
            riskRows={riskWorkbookResult.rows}
            biRows={biWorkbookResult.rows}
          />
        ) : null}
      </div>

      {/* ── Step B: Processing ── */}
      <section className="processing-workspace" aria-label="المعالجة">
        <div className="phase2-substep-header" style={{ marginBottom: "14px" }}>
          <div className="phase2-substep-badge">ب</div>
          <div className="processing-workspace-header">
            <h3>المعالجة</h3>
            <p>
              شغّل معالجة المجتمع. قائمة CertScan تُدار الآن من إعدادات المعالجة (شهرية ومتراكمة).
            </p>
          </div>
        </div>

        {riskWorkbookResult && !loadedFromDisk && (
          <CertScanMatchPreviewPanel
            riskRows={riskWorkbookResult.rows}
            certScanPasteText={certScanPasteText}
          />
        )}

        <div className="proc-action-panel">
          <button
            type="button"
            className="proc-run-btn"
            onClick={onProcessPopulation}
            disabled={isProcessingPopulation || loadedFromDisk || !canProcess}
            title={
              !canProcess
                ? "لا تملك صلاحية معالجة المجتمع، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل."
                : loadedFromDisk
                ? "ارفع الملفات من المرحلة الأولى لإعادة المعالجة"
                : undefined
            }
          >
            {isProcessingPopulation ? (
              <>
                <span className="proc-spinner" aria-hidden="true" />
                جاري المعالجة...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {reportData ? "إعادة معالجة المجتمع" : "معالجة المجتمع"}
              </>
            )}
          </button>

          {populationProcessingResult && !isProcessingPopulation && (
            <div className="proc-export-row">
              <button
                type="button"
                className="proc-export-btn primary"
                onClick={onExportPopulation}
                disabled={!canExport}
                title={!canExport ? "لا تملك صلاحية تصدير التقارير." : "تصدير المجتمع النهائي Excel"}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                تصدير Excel
              </button>
            </div>
          )}
        </div>

        {isProcessingPopulation && (
          <div className="processing-progress-wrapper" role="status">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${processingProgressPercent}%` }} />
            </div>
            <p className="progress-bar-label">
              {processingProgressMessage || "جاري المعالجة..."} ({processingProgressPercent}%)
            </p>
          </div>
        )}

        {reportData && !isProcessingPopulation ? (
          <>
            {populationLocked && (
              <div className="upload-warning" role="status">
                <Lock size={13} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
                {labels.population_locked_report_notice}
              </div>
            )}
            <PopulationProcessingReport
              summary={reportData.summary}
              previewRows={reportData.previewRows}
              removedRows={populationProcessingResult?.removedRows}
              duplicateRows={populationProcessingResult?.duplicateRows}
              invalidResultRows={populationProcessingResult?.invalidResultRows}
            />
          </>
        ) : !isProcessingPopulation ? (
          <div className="processing-placeholder">
            <p>لم يتم تنفيذ معالجة المجتمع بعد.</p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
