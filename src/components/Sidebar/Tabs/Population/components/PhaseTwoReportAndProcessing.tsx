import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import type { OrphanScanResult } from "../../../../../data/integrity/orphanScan";
import DataAccuracyReport, { OrphanScanSection } from "./DataAccuracyReport";
import PopulationProcessingReport from "./PopulationProcessingReport";
import { AlertTriangle, Check, FolderOpen, X } from "lucide-react";
import CertScanGrid from "./CertScanGrid";

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

type SaveMessage = { type: "ok" | "error"; text: string } | null;

type PhaseTwoReportAndProcessingProps = {
  riskWorkbookResult: RiskWorkbookResult | null;
  biWorkbookResult: BiWorkbookResult | null;
  processingMessage: string;
  certScanPasteText: string;
  populationProcessingResult: PopulationProcessingResult | null;
  isProcessingPopulation: boolean;
  processingProgressMessage?: string;
  processingProgressPercent?: number;
  saveMonth: number;
  isSavingToDisk: boolean;
  saveToDiskMessage: SaveMessage;
  hasDiskWorkspace: boolean;
  /** B3 referential-integrity orphan scan for the saved month, or null when unavailable. */
  orphanScan?: OrphanScanResult | null;
  onCertScanPasteTextChange: (value: string) => void;
  onProcessPopulation: () => void;
  onExportPopulation: () => void;
  onExportPhaseReport: () => void;
  onMonthChange: (month: number) => void;
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
  saveMonth,
  isSavingToDisk,
  saveToDiskMessage,
  hasDiskWorkspace,
  orphanScan = null,
  onCertScanPasteTextChange,
  onProcessPopulation,
  onExportPopulation,
  onExportPhaseReport,
  onMonthChange,
}: PhaseTwoReportAndProcessingProps) {

  // Show placeholder only when there is absolutely nothing to display
  if (!riskWorkbookResult && !populationProcessingResult) {
    return (
      <section className="placeholder-phase">
        <h2>تقرير البيانات والمعالجة</h2>
        <p>لم يتم تجهيز التقرير المصغر بعد.</p>
      </section>
    );
  }

  const loadedFromDisk = !riskWorkbookResult && populationProcessingResult !== null;
  const hasBi = riskWorkbookResult !== null && biWorkbookResult !== null;

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
            <div className="phase2-month-grid" role="group">
              {ARABIC_MONTHS.map((name, idx) => (
                <button
                  key={idx + 1}
                  type="button"
                  className={`phase2-month-btn${saveMonth === idx + 1 ? " active" : ""}`}
                  onClick={() => onMonthChange(idx + 1)}
                  aria-pressed={saveMonth === idx + 1}
                >
                  {name}
                </button>
              ))}
            </div>
            {isSavingToDisk && (
              <span className="phase2-save-msg" role="status">⏳ جاري الحفظ التلقائي...</span>
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
        {/* B3: referential-integrity orphan scan — independent of BI availability. */}
        <OrphanScanSection scan={orphanScan} />
      </div>

      {/* ── Step B: CertScan + Processing ── */}
      <section className="processing-workspace" aria-label="المعالجة">
        <div className="phase2-substep-header" style={{ marginBottom: "14px" }}>
          <div className="phase2-substep-badge">ب</div>
          <div className="processing-workspace-header">
            <h3>CertScan والمعالجة</h3>
            <p>الصق قائمة CertScan، ثم شغّل معالجة المجتمع.</p>
          </div>
        </div>

        <CertScanGrid initialText={certScanPasteText || undefined} onDataChange={onCertScanPasteTextChange} />

        <div className="proc-action-panel">
          <button
            type="button"
            className="proc-run-btn"
            onClick={onProcessPopulation}
            disabled={isProcessingPopulation || loadedFromDisk}
            title={loadedFromDisk ? "ارفع الملفات من المرحلة الأولى لإعادة المعالجة" : undefined}
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
                {populationProcessingResult ? "إعادة معالجة المجتمع" : "معالجة المجتمع"}
              </>
            )}
          </button>

          {populationProcessingResult && !isProcessingPopulation && (
            <div className="proc-export-row">
              <button
                type="button"
                className="proc-export-btn"
                onClick={onExportPhaseReport}
                title="تصدير تقرير المعالجة"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                </svg>
                تقرير المعالجة
              </button>
              <button
                type="button"
                className="proc-export-btn primary"
                onClick={onExportPopulation}
                title="تصدير المجتمع النهائي Excel"
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

        {populationProcessingResult && !isProcessingPopulation ? (
          <PopulationProcessingReport result={populationProcessingResult} />
        ) : !isProcessingPopulation ? (
          <div className="processing-placeholder">
            <p>لم يتم تنفيذ معالجة المجتمع بعد.</p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
