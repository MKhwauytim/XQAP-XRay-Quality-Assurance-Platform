import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import type { SafeWriteProgressPhase } from "../../../../../data/storage/safeWrite";
import type { PopulationAggregateLoadResult } from "../../../../../data/population/populationAggregate";
import type { StageAliasMappings } from "../../../../../data/population/populationConfig";
import { useEffect, useState } from "react";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { Labels } from "../../../../../data/labels/labelsStore";
import DataAccuracyReport, { AccuracyVerdictCard } from "./DataAccuracyReport";
import { compareAccuracyAsync, type AccuracyCompareResult } from "./dataAccuracyCompare";
import PopulationProcessingReport from "./PopulationProcessingReport";
import { AlertTriangle, Check, Download, FolderOpen, Info, Lock, Play, X } from "lucide-react";
import CertScanMatchPreviewPanel from "./CertScanMatchPreviewPanel";
import { formatNumber, formatPercentage } from "./helpers";
import type { ProcessingSummary } from "../processing/populationProcessingTypes";
import "./PhaseTwoReportAndProcessing.css";

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
  /** W-owner-2026-08-12b: active stage alias mappings, threaded down to
   *  `PopulationProcessingReport` so its "معاينة المجتمع النهائي" preview can
   *  render the Arabic stage label instead of the raw stored enum. Sourced
   *  from `index.tsx`'s already-loaded `config.stageMappings` — no new disk read. */
  stageMappings?: Partial<StageAliasMappings>;
  onProcessPopulation: () => void;
  onExportPopulation: () => void;
};

type ProcessingVerdictCardProps = {
  summary: ProcessingSummary | null;
  labels: Labels;
  monthLabel: string;
  hasDiskWorkspace: boolean;
  savedOk: boolean;
  isProcessingPopulation: boolean;
  loadedFromDisk: boolean;
  canProcess: boolean;
  canExport: boolean;
  showExport: boolean;
  onProcessPopulation: () => void;
  onExportPopulation: () => void;
};

/**
 * "نتيجة المعالجة" — the wide column of the 3b verdict row: title + last-run
 * line, the two actions, four stat tiles, and the BI-match info strip. Every
 * figure comes straight off the already-computed `ProcessingSummary`; nothing
 * new is calculated here beyond the ratios the tiles' captions state.
 */
function ProcessingVerdictCard({
  summary,
  labels,
  monthLabel,
  hasDiskWorkspace,
  savedOk,
  isProcessingPopulation,
  loadedFromDisk,
  canProcess,
  canExport,
  showExport,
  onProcessPopulation,
  onExportPopulation,
}: ProcessingVerdictCardProps) {
  const excludedTotal = summary
    ? summary.duplicateRiskIdRows + summary.removedInvalidResultRows + summary.invalidRiskIdRows
    : 0;
  const keptPercentage =
    summary && summary.riskOriginalRows > 0
      ? (summary.finalPreparedPopulationRows / summary.riskOriginalRows) * 100
      : 0;
  const biUnmatchedPercentage = summary ? Math.max(0, 100 - summary.biMatchPercentage) : 0;
  const certScanProvided = summary?.certScanProvided !== false;

  return (
    <div className="p2-result-card">
      <div className="p2-result-head">
        <div className="p2-result-head-text">
          <h3>{labels.p2_result_title}</h3>
          <p>
            {labels.p2_result_subtitle.replace("{month}", monthLabel)}
            {hasDiskWorkspace && savedOk ? ` · ${labels.p2_result_saved_note}` : ""}
          </p>
        </div>
        <div className="p2-result-actions">
          {showExport && (
            <button
              type="button"
              className="proc-export-btn primary p2-action-export"
              onClick={onExportPopulation}
              disabled={!canExport}
              title={!canExport ? "لا تملك صلاحية تصدير التقارير." : "تصدير المجتمع النهائي Excel"}
            >
              <Download size={15} aria-hidden="true" />
              {labels.p2_result_export_excel}
            </button>
          )}
          <button
            type="button"
            className="proc-run-btn p2-action-process"
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
                <Play size={15} aria-hidden="true" />
                {summary ? labels.p2_result_reprocess : labels.p2_result_process}
              </>
            )}
          </button>
        </div>
      </div>

      {summary ? (
        <>
          <div className="p2-tile-grid">
            <div className="p2-tile">
              <span className="p2-tile-label">{labels.p2_tile_final_population}</span>
              <strong className="p2-tile-value">{formatNumber(summary.finalPreparedPopulationRows)}</strong>
              <span className="p2-tile-caption ok">
                {labels.p2_tile_final_population_caption.replace("{percent}", formatPercentage(keptPercentage))}
              </span>
            </div>
            <div className="p2-tile">
              <span className="p2-tile-label">{labels.p2_tile_excluded}</span>
              <strong className="p2-tile-value danger">{formatNumber(excludedTotal)}</strong>
              <span className="p2-tile-caption">
                {labels.p2_tile_excluded_caption
                  .replace("{duplicates}", formatNumber(summary.duplicateRiskIdRows))
                  .replace("{invalidResults}", formatNumber(summary.removedInvalidResultRows))
                  .replace("{invalidIds}", formatNumber(summary.invalidRiskIdRows))}
              </span>
            </div>
            <div className="p2-tile">
              <span className="p2-tile-label">{labels.p2_tile_certscan_split}</span>
              <strong className="p2-tile-value">
                {certScanProvided
                  ? `${formatNumber(Math.round(summary.certScanPercentage))} / ${formatNumber(Math.round(summary.nonCertScanPercentage))}`
                  : labels.p2_value_empty}
              </strong>
              <span className="p2-tile-caption">
                {certScanProvided
                  ? labels.p2_tile_certscan_caption
                      .replace("{certScan}", formatNumber(summary.certScanRows))
                      .replace("{nonCertScan}", formatNumber(summary.nonCertScanRows))
                  : labels.p2_tile_certscan_unavailable}
              </span>
            </div>
            <div className="p2-tile">
              <span className="p2-tile-label">{labels.p2_tile_bi_fill}</span>
              <strong className="p2-tile-value">{formatNumber(summary.totalBiFilledFields)}</strong>
              <span className="p2-tile-caption">
                {labels.p2_tile_bi_fill_caption.replace("{count}", formatNumber(summary.biFieldFillSummary.length))}
              </span>
            </div>
          </div>

          <div className="p2-info-strip">
            <Info size={15} aria-hidden="true" />
            <span>
              {summary.biProvided
                ? labels.p2_strip_bi_match.replace("{percent}", formatPercentage(biUnmatchedPercentage))
                : labels.p2_strip_bi_missing}
            </span>
          </div>

          {!certScanProvided && (
            <div className="p2-warn-strip" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{labels.p2_strip_certscan_missing}</span>
            </div>
          )}
        </>
      ) : (
        <div className="processing-placeholder">
          <p>لم يتم تنفيذ معالجة المجتمع بعد.</p>
        </div>
      )}
    </div>
  );
}

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
  stageMappings,
  onProcessPopulation,
  onExportPopulation,
}: PhaseTwoReportAndProcessingProps) {
  const labels = useLabels();

  // One comparison pass, shared by the verdict card (hoisted into the verdict
  // row) and the mismatch panels inside DataAccuracyReport. Computed before the
  // early return below so the hook order stays stable.
  //
  // Fix (population, 2026-08-18): this used to run compareAccuracy() fully
  // synchronously inside the useMemo above — over a real population (tens to
  // hundreds of thousands of risk rows) that blocks the main thread for the
  // whole comparison, which is exactly the "app becomes unclickable, worst
  // right after a Phase 1 upload" report: landing on Phase 2 is what first
  // triggers this computation. Runs the chunked async version instead and
  // keeps `accuracy` null (both verdict cards and DataAccuracyReport already
  // render their no-data state on null/undefined) until it resolves.
  // The result is stored WITH the inputs it was computed from, and read back
  // only when those still match. That makes "inputs changed, result not in yet"
  // a derived null rather than a setState — so a stale verdict can never be on
  // screen for even one render, and no state is set synchronously in an effect.
  const [computed, setComputed] = useState<{
    risk: RiskWorkbookResult;
    bi: BiWorkbookResult;
    result: AccuracyCompareResult;
  } | null>(null);
  const accuracy =
    computed && computed.risk === riskWorkbookResult && computed.bi === biWorkbookResult
      ? computed.result
      : null;

  useEffect(() => {
    const risk = riskWorkbookResult;
    const bi = biWorkbookResult;
    if (!risk || !bi) return;
    let cancelled = false;
    compareAccuracyAsync(risk.rows, bi.rows).then((result) => {
      if (cancelled) return;
      setComputed({ risk, bi, result });
    });
    return () => { cancelled = true; };
  }, [riskWorkbookResult, biWorkbookResult]);

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


      {/* ── Verdict row: accuracy verdict + processing outcome ── */}
      <div className={`p2-verdict-row${accuracy ? "" : " no-accuracy"}`}>
        {accuracy && <AccuracyVerdictCard result={accuracy} />}
        <ProcessingVerdictCard
          summary={reportData?.summary ?? null}
          labels={labels}
          monthLabel={monthLabel}
          hasDiskWorkspace={hasDiskWorkspace}
          savedOk={saveToDiskMessage?.type === "ok" && !isSavingToDisk}
          isProcessingPopulation={isProcessingPopulation}
          loadedFromDisk={loadedFromDisk}
          canProcess={canProcess}
          canExport={canExport}
          showExport={populationProcessingResult !== null && !isProcessingPopulation}
          onProcessPopulation={onProcessPopulation}
          onExportPopulation={onExportPopulation}
        />
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

      {riskWorkbookResult && !loadedFromDisk && (
        <CertScanMatchPreviewPanel
          riskRows={riskWorkbookResult.rows}
          certScanPasteText={certScanPasteText}
        />
      )}

      {/* ── Accuracy: mismatching columns + mismatch detail ── */}
      {loadedFromDisk ? (
        <div className="dar-disk-banner p2-banner">
          <FolderOpen size={16} aria-hidden="true" />
          <span>تم تحميل هذا الشهر من القرص — البيانات الأصلية غير متاحة في الجلسة الحالية.
          لعرض تقرير دقة البيانات، ارفع ملفَي وكالة المخاطر و BI من المرحلة الأولى.</span>
        </div>
      ) : !hasBi ? (
        <div className="dar-no-bi p2-banner">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>لم يتم رفع ملف BI — مقارنة الدقة غير متاحة. رفع ملف BI في المرحلة الأولى يتيح تقرير الدقة الكامل.</span>
        </div>
      ) : riskWorkbookResult && biWorkbookResult && accuracy ? (
        // Only rendered once `accuracy` has resolved -- passing `undefined`
        // here while it's still computing would make DataAccuracyReport run
        // its OWN (equally chunked, but redundant) fallback comparison
        // concurrently with this one. The loading note below covers the gap.
        <DataAccuracyReport
          riskRows={riskWorkbookResult.rows}
          biRows={biWorkbookResult.rows}
          result={accuracy}
          verdictHoisted
        />
      ) : riskWorkbookResult && biWorkbookResult ? (
        <div className="upload-warning" role="status">{labels.p2_accuracy_computing}</div>
      ) : null}

      {/* ── Processing detail: BI fill + exclusions, then the final preview ── */}
      {reportData && !isProcessingPopulation && (
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
            stageMappings={stageMappings}
            removedRows={populationProcessingResult?.removedRows}
            duplicateRows={populationProcessingResult?.duplicateRows}
            invalidResultRows={populationProcessingResult?.invalidResultRows}
          />
        </>
      )}
    </section>
  );
}
