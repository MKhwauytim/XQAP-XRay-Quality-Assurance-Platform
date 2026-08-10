import { Check, LockOpen } from "lucide-react";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import type { DistributionCurrentData } from "../../../../../data/distribution/distributionTypes";
import type { SampleMasterData } from "../../../../../data/sampling/sampleTypes";
import type { PopulationAggregateLoadResult } from "../../../../../data/population/populationAggregate";
import type { MonthManifestData } from "../../../../../data/population/monthTypes";
import { SYSTEM_AUTO_LOCK_ACTOR } from "../../../../../data/population/monthLock";
import { getLabels } from "../../../../../data/labels/labelsStore";
import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult } from "../processing/populationProcessingTypes";
import { PHASES } from "../populationWorkflowHelpers";
import { getPhaseStatus } from "./helpers";

/**
 * Owner requirement (2026-08-07): the closed-month banner distinguishes a
 * SYSTEM auto-lock (post-distribution, see `useDistributionActions.ts`'s
 * `autoLockWhenFullyDistributed`) from a PERSON manually closing the month,
 * and offers an admin unlock affordance right here (calls the pre-existing,
 * unmodified `reopenMonth` via the caller's `onUnlock`). Pulled out of
 * `PopulationTab` itself purely to stay under `check:complexity`'s
 * per-function complexity budget.
 */
export function ClosedMonthBanner({
  visible,
  manifest,
  canUnlock,
  isUnlocking,
  onUnlock
}: {
  visible: boolean;
  manifest: MonthManifestData | null;
  canUnlock: boolean;
  isUnlocking: boolean;
  onUnlock: () => void;
}) {
  if (!visible) return null;
  const labels = getLabels();
  const closedBy = manifest?.closedBy;
  const lockNote = closedBy === SYSTEM_AUTO_LOCK_ACTOR
    ? labels.msg_month_closed_note_auto_lock
    : closedBy
      ? labels.msg_month_closed_note_closed_by.replace("{user}", closedBy)
      : "";
  return (
    <div className="upload-warning" role="status">
      <span>{labels.msg_month_closed_banner} {lockNote}</span>
      {canUnlock && (
        <button
          type="button"
          className="header-settings-btn"
          style={{ marginInlineStart: 10 }}
          onClick={onUnlock}
          disabled={isUnlocking}
        >
          <LockOpen size={13} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} />
          {isUnlocking ? labels.archive_reopen_month_in_progress : labels.archive_reopen_month_btn}
        </button>
      )}
    </div>
  );
}

export function PopulationHeader({
  canConfigure,
  onOpenSettings
}: {
  canConfigure: boolean;
  onOpenSettings: (mode: "mapping" | "processing") => void;
}) {
  return (
    <PageHeader
      eyebrow="معالجة المجتمع"
      title="معالجة المجتمع"
      subtitle="مسار عمل مخصص لرفع بيانات المجتمع، تحضيرها، اختيار العينة، ثم توزيع العينة على الموظفين داخل النظام."
    >
      <div className="header-settings-stack">
        <button
          type="button"
          className="header-settings-btn"
          onClick={() => onOpenSettings("mapping")}
          aria-label="فتح إعدادات الربط والتصدير"
          disabled={!canConfigure}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          إعدادات الربط والتصدير
        </button>
        <button
          type="button"
          className="header-settings-btn"
          onClick={() => onOpenSettings("processing")}
          aria-label="فتح إعدادات المعالجة"
          disabled={!canConfigure}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3v4"/><path d="M18 3v4"/><path d="M3 9h18"/><path d="M8 14h8"/><path d="M8 18h5"/><rect x="3" y="5" width="18" height="16" rx="2"/>
          </svg>
          إعدادات المعالجة
        </button>
      </div>
    </PageHeader>
  );
}

export function PopulationStatusBar({
  month,
  year,
  population,
  populationAggregate = null,
  sample,
  distribution,
  biWorkbook
}: {
  month: number;
  year: number;
  population: PopulationProcessingResult | null;
  /** Owner requirement: fallback source for the "المجتمع" chip on a locked
   *  month, where `population` is deliberately never populated with row data. */
  populationAggregate?: PopulationAggregateLoadResult | null;
  sample: SampleMasterData | null;
  distribution: DistributionCurrentData | null;
  biWorkbook: BiWorkbookResult | null;
}) {
  const populationRowCount = population
    ? population.preparedRows.length
    : populationAggregate?.status === "ok"
      ? populationAggregate.aggregate.summary.finalPreparedPopulationRows
      : null;
  return (
    <div className="population-status-bar" aria-label="حالة معالجة المجتمع">
      <span className="status-bar-label">الحالة:</span>
      <StatusChip label="الشهر" value={`${month}/${year}`} state="" />
      <StatusChip label="المجتمع" state={populationRowCount !== null ? "ok" : "idle"}
        value={populationRowCount !== null ? `${populationRowCount.toLocaleString("ar-SA-u-nu-latn")} صف` : "—"} />
      <StatusChip label="العينة" state={sample ? "ok" : "idle"}
        value={sample ? `${sample.totalActual.toLocaleString("ar-SA-u-nu-latn")} عنصر` : "—"} />
      <StatusChip label="التوزيع" state={distribution && distribution.totalAssigned > 0 ? "ok" : "idle"}
        value={distribution && distribution.totalAssigned > 0
          ? `${distribution.totalAssigned.toLocaleString("ar-SA-u-nu-latn")} معين` : "—"} />
      <StatusChip label="بيانات BI" state={biWorkbook ? "ok" : "idle"}
        value={biWorkbook ? `${biWorkbook.totalNormalizedRows.toLocaleString("ar-SA-u-nu-latn")} صف` : "غير مرفوع"}
        last />
    </div>
  );
}

function StatusChip({ label, value, state, last = false }: { label: string; value: string; state: string; last?: boolean }) {
  return (
    <>
      <div className="status-chip">
        <span className="status-chip-key">{label}</span>
        <span className={`status-chip-val${state ? ` ${state}` : ""}`}>{value}</span>
      </div>
      {!last && <div className="status-bar-divider" aria-hidden="true" />}
    </>
  );
}

export function PopulationStepper({
  currentPhase,
  completedPhaseIds,
  onSelect
}: {
  currentPhase: number;
  completedPhaseIds: number[];
  onSelect: (phase: number) => void;
}) {
  return (
    <nav className="phase-stepper" aria-label="مراحل معالجة المجتمع">
      {PHASES.map((phase) => {
        const status = getPhaseStatus(phase.id, currentPhase, completedPhaseIds);
        const clickable = status === "completed" || status === "active";
        return (
          <div
            key={phase.id}
            className={`stepper-item ${status}${clickable ? " clickable" : ""}`}
            aria-current={status === "active" ? "step" : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={() => { if (clickable) onSelect(phase.id); }}
            onKeyDown={(event) => {
              if (clickable && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onSelect(phase.id);
              }
            }}
          >
            <div className="stepper-node">
              <div className="stepper-circle" aria-hidden="true">
                {status === "completed" ? <Check size={13} /> : phase.id}
              </div>
              <div className="stepper-text">
                <span className="stepper-num">المرحلة {phase.id}</span>
                <strong className="stepper-title">{phase.title}</strong>
                <span className="stepper-desc">{phase.description}</span>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function PopulationPhaseFooter({
  currentPhase,
  hint,
  busy,
  reading,
  nextDisabled,
  onPrevious,
  onNext
}: {
  currentPhase: number;
  hint: string;
  busy: boolean;
  reading: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <footer className="phase-actions">
      <p className="phase-actions-hint">
        {currentPhase < PHASES.length
          ? <strong>{hint}</strong>
          : <strong>اكتملت جميع المراحل <Check size={14} style={{ verticalAlign: "middle" }} /></strong>}
      </p>
      <button type="button" className="secondary-action" onClick={onPrevious}
        disabled={currentPhase === 1 || busy}>
        السابق →
      </button>
      {currentPhase < PHASES.length && (
        <button type="button" className="primary-action" onClick={onNext} disabled={nextDisabled}>
          {reading ? "جاري القراءة..." : "← التالي"}
        </button>
      )}
    </footer>
  );
}
